package codeserver

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

// Installer carries the seams and platform configuration for the code-server
// install flow. Construct with New() and override fields as needed; the struct
// (not package vars) holds the http client and platform values so parallel
// tests never race — the internal/desktop Installer idiom.
type Installer struct {
	// Client performs the GitHub API request and the asset download.
	Client *http.Client
	// GOOS / GOARCH name the host platform the asset is selected for
	// (runtime.GOOS/runtime.GOARCH shape; darwin publishes as "macos").
	GOOS   string
	GOARCH string
	// APIBase is the GitHub API origin (overridden by tests with httptest).
	APIBase string
	// Progress receives human progress/decoration output (the caller wires it
	// to the chatter channel, so --quiet suppresses it).
	Progress io.Writer
}

// New returns an Installer with production defaults.
func New() *Installer {
	return &Installer{
		Client:   &http.Client{}, // per-call contexts carry the timeouts
		GOOS:     runtime.GOOS,
		GOARCH:   runtime.GOARCH,
		APIBase:  defaultAPIBase,
		Progress: io.Discard,
	}
}

// InstallResult reports a completed install.
type InstallResult struct {
	// Version is the now-active release version (no leading "v").
	Version string
	// Path is the active version dir (~/.rk/code-server-bin/<version>).
	Path string
	// AlreadyCurrent reports the idempotent skip: the managed install already
	// matched the latest release, so nothing was downloaded or flipped.
	AlreadyCurrent bool
}

// Install resolves the latest code-server release and makes it the active
// managed install under ~/.rk/code-server-bin:
//
//  1. Resolve the latest release + host-platform asset via the GitHub API.
//  2. Idempotency: when the current symlink already names that version, skip
//     (AlreadyCurrent) — nothing is downloaded.
//  3. Download the tarball to a staging dir under code-server-bin/, computing
//     the SHA256 while streaming, bounded by downloadTimeout (~15 min — a
//     generous network bound, per the agreed no-tight-timeout constraint).
//  4. FAIL CLOSED on verification: a missing digest or a mismatch aborts
//     before anything is promoted — no symlink flip, current untouched (R3,
//     Constitution I).
//  5. Extract in-process (gzip+tar — no curl/tar subprocesses, intake
//     assumption 8) into the staging dir, stripping the tarball's top-level
//     directory, preserving mode bits, and recreating symlink entries.
//  6. Promote staging → <version>/ with os.Rename, then flip current via a
//     temp symlink + os.Rename. Both promotions are single-syscall renames on
//     the same filesystem, so a crash leaves either the old world intact or a
//     garbage staging dir — never a torn active install.
//
// The staging dir is removed best-effort on every failure path.
func (ins *Installer) Install(ctx context.Context, home string) (InstallResult, error) {
	rel, err := ins.resolveLatest(ctx)
	if err != nil {
		return InstallResult{}, err
	}

	installed, err := InstalledVersion(home)
	if err != nil {
		return InstallResult{}, fmt.Errorf("reading the active version: %w", err)
	}
	if installed == rel.Version {
		return InstallResult{Version: rel.Version, Path: VersionDir(home, rel.Version), AlreadyCurrent: true}, nil
	}

	if rel.Digest == "" {
		return InstallResult{}, fmt.Errorf("release %s supplied no sha256 digest for %s — refusing to install an unverified binary", rel.Version, rel.AssetName)
	}

	binDir := BinDir(home)
	if err := os.MkdirAll(binDir, 0o755); err != nil {
		return InstallResult{}, fmt.Errorf("creating %s: %w", binDir, err)
	}
	staging, err := os.MkdirTemp(binDir, ".staging-")
	if err != nil {
		return InstallResult{}, fmt.Errorf("creating staging dir under %s: %w", binDir, err)
	}
	// Best-effort cleanup: after a successful promotion the rename has already
	// emptied this path, so the deferred RemoveAll is a no-op.
	defer os.RemoveAll(staging)

	tarball := filepath.Join(staging, rel.AssetName)
	sum, err := ins.download(ctx, rel, tarball)
	if err != nil {
		return InstallResult{}, err
	}
	if !strings.EqualFold(sum, rel.Digest) {
		return InstallResult{}, fmt.Errorf("checksum mismatch for %s: downloaded sha256:%s, release digest sha256:%s — refusing to install an unverified binary", rel.AssetName, sum, rel.Digest)
	}

	fmt.Fprintf(ins.Progress, "Extracting %s...\n", rel.AssetName)
	extractDir := filepath.Join(staging, "tree")
	if err := os.MkdirAll(extractDir, 0o755); err != nil {
		return InstallResult{}, err
	}
	if err := extractTarball(tarball, extractDir); err != nil {
		return InstallResult{}, fmt.Errorf("extracting %s: %w", rel.AssetName, err)
	}
	if err := os.Remove(tarball); err != nil {
		return InstallResult{}, fmt.Errorf("removing staged tarball: %w", err)
	}

	// Promote the extracted tree to its version dir. A leftover from a prior
	// failed run (same version) is cleared first — its presence is proof that
	// run never flipped current.
	dest := VersionDir(home, rel.Version)
	if err := os.RemoveAll(dest); err != nil {
		return InstallResult{}, fmt.Errorf("clearing leftover version dir %s: %w", dest, err)
	}
	if err := os.Rename(extractDir, dest); err != nil {
		return InstallResult{}, fmt.Errorf("promoting staged install to %s: %w", dest, err)
	}

	// Atomic activation: temp symlink + rename over current, so no observer
	// ever sees a missing or partial current.
	tmp := CurrentPath(home) + ".tmp"
	if err := os.Remove(tmp); err != nil && !os.IsNotExist(err) {
		return InstallResult{}, fmt.Errorf("clearing stale temp symlink: %w", err)
	}
	if err := os.Symlink(rel.Version, tmp); err != nil {
		return InstallResult{}, fmt.Errorf("creating temp symlink: %w", err)
	}
	if err := os.Rename(tmp, CurrentPath(home)); err != nil {
		return InstallResult{}, fmt.Errorf("flipping the current symlink: %w", err)
	}

	return InstallResult{Version: rel.Version, Path: dest}, nil
}

// download fetches the release asset to dest, computing the SHA256 while
// streaming (bounded by downloadTimeout), and returns the hex digest.
func (ins *Installer) download(ctx context.Context, rel Release, dest string) (string, error) {
	dlCtx, cancel := context.WithTimeout(ctx, downloadTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(dlCtx, http.MethodGet, rel.AssetURL, nil)
	if err != nil {
		return "", err
	}
	resp, err := ins.Client.Do(req)
	if err != nil {
		return "", fmt.Errorf("downloading %s: %w", rel.AssetName, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("downloading %s: HTTP %d", rel.AssetName, resp.StatusCode)
	}

	tmp, err := os.Create(dest)
	if err != nil {
		return "", fmt.Errorf("creating staged tarball: %w", err)
	}
	if resp.ContentLength > 0 {
		fmt.Fprintf(ins.Progress, "Downloading %s (%d MB)...\n", rel.AssetName, resp.ContentLength>>20)
	} else {
		fmt.Fprintf(ins.Progress, "Downloading %s...\n", rel.AssetName)
	}
	hasher := sha256.New()
	_, copyErr := io.Copy(io.MultiWriter(tmp, hasher), resp.Body)
	closeErr := tmp.Close()
	if copyErr != nil {
		return "", fmt.Errorf("downloading %s: %w", rel.AssetName, copyErr)
	}
	if closeErr != nil {
		return "", fmt.Errorf("writing %s: %w", dest, closeErr)
	}
	return hex.EncodeToString(hasher.Sum(nil)), nil
}

// extractTarball unpacks the .tar.gz at src into dest, stripping the
// tarball's single top-level directory (code-server-<ver>-<os>-<arch>/), so
// the binary lands at dest/bin/code-server. Mode bits are preserved (the
// bin/code-server entry script and bundled node must stay executable) and
// symlink entries are recreated. Entries that would escape dest (absolute
// paths, ".." components, absolute or escaping symlink targets) are refused —
// the tarball is digest-verified but dest-escape is cheap to guarantee.
func extractTarball(src, dest string) error {
	f, err := os.Open(src)
	if err != nil {
		return err
	}
	defer f.Close()
	gz, err := gzip.NewReader(f)
	if err != nil {
		return err
	}
	defer gz.Close()

	tr := tar.NewReader(gz)
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}

		// Strip the tarball's single top-level directory component
		// (code-server-<ver>-<os>-<arch>/) so the binary lands at
		// dest/bin/code-server. The escape check runs on the RAW components
		// first — cleaning before checking would collapse a malicious ".."
		// into an innocent-looking relative path.
		name := filepath.ToSlash(hdr.Name)
		for _, comp := range strings.Split(name, "/") {
			if comp == ".." {
				return fmt.Errorf("refusing tar entry escaping the install dir: %q", hdr.Name)
			}
		}
		clean := filepath.ToSlash(filepath.Clean(name))
		i := strings.Index(clean, "/")
		if i < 0 {
			continue // the top-level dir itself
		}
		rel := clean[i+1:]
		if rel == "" {
			continue
		}
		if filepath.IsAbs(rel) {
			return fmt.Errorf("refusing tar entry escaping the install dir: %q", hdr.Name)
		}
		target := filepath.Join(dest, filepath.FromSlash(rel))

		switch hdr.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(target, hdr.FileInfo().Mode().Perm()); err != nil {
				return err
			}
		case tar.TypeReg:
			if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
				return err
			}
			out, err := os.OpenFile(target, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, hdr.FileInfo().Mode().Perm())
			if err != nil {
				return err
			}
			_, copyErr := io.Copy(out, tr)
			closeErr := out.Close()
			if copyErr != nil {
				return copyErr
			}
			if closeErr != nil {
				return closeErr
			}
		case tar.TypeSymlink:
			link := hdr.Linkname
			if filepath.IsAbs(link) || strings.HasPrefix(filepath.ToSlash(filepath.Clean(link)), "../") {
				return fmt.Errorf("refusing symlink escaping the install dir: %q -> %q", hdr.Name, link)
			}
			if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
				return err
			}
			if err := os.Symlink(link, target); err != nil {
				return err
			}
		default:
			// Hardlinks, devices, fifos: not expected in a code-server release
			// tarball — skip rather than invent a filesystem node.
		}
	}
}
