package stt

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	rkarchive "rk/internal/archive"
)

// The whisper.cpp release the installer fetches. Pinned: installs never chase
// "latest" — a version bump is a deliberate, reviewed change.
const whisperVersion = "v1.9.2"

const (
	// whisperReleaseBase is the GitHub release-asset download prefix for the
	// pinned version (the Installer's binBase overrides it in tests).
	whisperReleaseBase = "https://github.com/ggml-org/whisper.cpp/releases/download/" + whisperVersion + "/"
	// modelDownloadBase is the Hugging Face resolve prefix the ggml model files
	// download from (ModelFile supplies the filename).
	modelDownloadBase = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/"

	// maxArchiveBytes bounds the release-archive download; the published
	// Windows zips are tens of MB, so this is a bound on failure, not an
	// expected size.
	maxArchiveBytes = 512 << 20
	// maxModelBytes bounds the model download (the largest ggml model file is
	// ~3GB unquantized).
	maxModelBytes = 4 << 30

	// installDownloadTimeout bounds the whole binary+model transfer —
	// network-transfer-sized for a multi-hundred-MB model on a slow link (an
	// upper bound on failure, not an expected duration).
	installDownloadTimeout = 30 * time.Minute
)

// Pinned SHA256 digests for the pinned release's binary archives, one named
// constant per supported platform, each computed from a downloaded copy of
// the asset. whisper.cpp publishes no darwin CLI archive (the xcframework is
// not a binary) and no windows/arm64 zip — those platforms have no map entry.
const (
	whisperSHA256UbuntuX64    = "46811a3ecf584307480a220b9ef5ff81b7b22dc41577cbc274ce3afc61f753b1"
	whisperSHA256UbuntuARM64  = "7e26fa6a36d9174d5c0bf033ccbc026c3b5e569e2ee787058241346ef5392719"
	whisperSHA256WindowsAMD64 = "49dcc16de826f20bd53d44f947a1ae49dfa81f86cad67a64d80820cb192d674a"
)

// whisperAsset names the pinned release's binary archive for one GOOS/GOARCH.
type whisperAsset struct {
	Name   string
	SHA256 string
}

// whisperAssets is the per-platform asset map for the pinned release. A
// GOOS/GOARCH with no entry has no published prebuilt archive — Install fails
// closed naming the platform gap (never build from source, never fetch an
// unpinned artifact). darwin is the one gap with a first-class fallback: a
// whisper-cli already on PATH (e.g. `brew install whisper-cpp`) lets Install
// fetch just the model.
var whisperAssets = map[string]whisperAsset{
	"linux/amd64":   {Name: "whisper-bin-ubuntu-x64.tar.gz", SHA256: whisperSHA256UbuntuX64},
	"linux/arm64":   {Name: "whisper-bin-ubuntu-arm64.tar.gz", SHA256: whisperSHA256UbuntuARM64},
	"windows/amd64": {Name: "whisper-bin-x64.zip", SHA256: whisperSHA256WindowsAMD64},
}

// modelSHA256 pins per-model digests (ggml filename → SHA256), verified
// fail-closed on download. Only the default model is pinned so far; further
// entries are recorded as their digests are verified.
var modelSHA256 = map[string]string{
	"ggml-small.en-q5_1.bin": "bfdff4894dcb76bbf647d56263ea2a96645423f1669176f4844a1bf8e478ad30",
}

// InstallOptions parameterizes one install run. Progress receives human
// progress lines (the caller wires it to the chatter channel, so --quiet
// suppresses it); nil discards.
type InstallOptions struct {
	ModelTag string
	Progress func(string)
}

// Install fetches the pinned whisper.cpp release binary archive and the model
// file for opts.ModelTag into the state-dir layout, verifying the archive's
// SHA256 against the pinned digest (fail closed on missing/mismatch) and
// enforcing archive containment on extraction. It is EXPLICIT-ONLY — nothing
// in the daemon or the transcribe path calls it. On success it returns the
// post-install probe.
func Install(ctx context.Context, opts InstallOptions) (*Status, error) {
	ins := &installer{
		client:       &http.Client{}, // per-call contexts carry the timeouts
		goos:         runtime.GOOS,
		goarch:       runtime.GOARCH,
		binBase:      whisperReleaseBase,
		modelBase:    modelDownloadBase,
		assets:       whisperAssets,
		modelDigests: modelSHA256,
		progress:     opts.Progress,
	}
	return ins.install(ctx, opts.ModelTag)
}

// installer carries the seams and platform configuration for one install run,
// so parallel tests never race (the codeserver.Installer idiom).
type installer struct {
	client       *http.Client
	goos         string
	goarch       string
	binBase      string
	modelBase    string
	assets       map[string]whisperAsset
	modelDigests map[string]string
	progress     func(string)
}

func (ins *installer) note(format string, a ...any) {
	if ins.progress != nil {
		ins.progress(fmt.Sprintf(format, a...))
	}
}

// install runs the full provisioning flow:
//
//  1. Platform gate: the pinned release's asset map and digest table decide —
//     no asset or no recorded digest for this platform fails closed.
//  2. Idempotency: a probe reporting the pinned version and the model already
//     present skips every download.
//  3. Download the archive under a staging dir inside RootDir, computing the
//     SHA256 while streaming; verify against the pinned digest.
//  4. Extract in-process (zip or tar.gz — no external tar/unzip subprocesses)
//     with two-layer containment: lexical ../absolute rejection plus
//     symlink-resolution containment on every write.
//  5. Promote staging → bin/ and the model → models/ with os.Rename on the
//     same filesystem, then record the VERSION file Probe reports.
//
// A failed run leaves the previous install untouched and the staging dir is
// removed best-effort.
func (ins *installer) install(ctx context.Context, modelTag string) (*Status, error) {
	if modelTag == "" {
		modelTag = DefaultModelTag
	}
	platform := ins.goos + "/" + ins.goarch
	asset, hasAsset := ins.assets[platform]
	pathBin := ""
	if !hasAsset {
		// No published archive for this platform: a whisper-cli already on PATH
		// (e.g. brew's whisper-cpp on macOS) downgrades this run to a model-only
		// fetch; without one there is nothing to install.
		if p, lookErr := exec.LookPath(binName); lookErr == nil {
			pathBin = p
		} else {
			return nil, fmt.Errorf("whisper.cpp %s publishes no prebuilt binary for %s — install the CLI separately (on macOS: `brew install whisper-cpp`), then re-run `rk voice install` to fetch the model", whisperVersion, platform)
		}
	}
	if hasAsset && asset.SHA256 == "" {
		// Invariant guard: a cleared pin fails closed rather than installing an
		// unverified binary.
		return nil, fmt.Errorf("no pinned SHA256 recorded for %s (whisper.cpp %s on %s) — refusing to install an unverified binary", asset.Name, whisperVersion, platform)
	}

	if st := Probe(modelTag); st.Installed && (st.Version == whisperVersion || (pathBin != "" && st.BinPath == pathBin)) {
		ins.note("whisper %s with model %s is already current", st.Version, ModelFile(modelTag))
		st := Probe(modelTag)
		return &st, nil
	}

	root, err := RootDir()
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(root, 0o755); err != nil {
		return nil, fmt.Errorf("creating %s: %w", root, err)
	}
	staging, err := os.MkdirTemp(root, ".install-")
	if err != nil {
		return nil, fmt.Errorf("creating staging dir under %s: %w", root, err)
	}
	// Best-effort cleanup: after a successful promotion the renames have
	// already emptied the interesting paths out of staging.
	defer os.RemoveAll(staging)

	dlCtx, cancel := context.WithTimeout(ctx, installDownloadTimeout)
	defer cancel()

	if hasAsset {
		archive := filepath.Join(staging, asset.Name)
		sum, err := ins.download(dlCtx, ins.binBase+asset.Name, archive, maxArchiveBytes, asset.Name)
		if err != nil {
			return nil, err
		}
		if !strings.EqualFold(sum, asset.SHA256) {
			return nil, fmt.Errorf("checksum mismatch for %s: downloaded sha256:%s, pinned sha256:%s — refusing to install an unverified binary", asset.Name, sum, asset.SHA256)
		}

		ins.note("Extracting %s...", asset.Name)
		tree := filepath.Join(staging, "tree")
		if err := os.MkdirAll(tree, 0o755); err != nil {
			return nil, err
		}
		if err := rkarchive.Extract(archive, tree); err != nil {
			return nil, fmt.Errorf("extracting %s: %w", asset.Name, err)
		}
		// Release archives wrap their payload in a single top-level directory
		// (whisper-bin-ubuntu-x64/, Release/); collapse that nesting so the
		// binary lands at the tree's top level BESIDE its sibling shared
		// libraries ($ORIGIN resolution) — the binary is never moved out of
		// its library directory.
		if err := rkarchive.FlattenSingleRootDir(tree); err != nil {
			return nil, fmt.Errorf("normalizing %s: %w", asset.Name, err)
		}

		// The archive must actually carry the CLI binary (top level or under a
		// bin/ directory); promote nothing otherwise. The binary is moved to the
		// canonical top-level path so the probe's fixed layout holds regardless of
		// the archive's nesting.
		binInTree, err := findBinEntry(tree)
		if err != nil {
			return nil, fmt.Errorf("extracting %s: %w", asset.Name, err)
		}
		canonicalBin := filepath.Join(tree, binName)
		if binInTree != canonicalBin {
			if err := os.Rename(binInTree, canonicalBin); err != nil {
				return nil, fmt.Errorf("normalizing the %s path: %w", binName, err)
			}
		}

		// Promote the extracted tree to bin/ — a leftover from a prior failed run
		// is cleared first; the rename is a single syscall on the same filesystem.
		binDir := filepath.Join(root, "bin")
		if err := os.RemoveAll(binDir); err != nil {
			return nil, fmt.Errorf("clearing previous %s: %w", binDir, err)
		}
		if err := os.Rename(tree, binDir); err != nil {
			return nil, fmt.Errorf("promoting staged install to %s: %w", binDir, err)
		}
		bin, err := findBinEntry(binDir)
		if err != nil {
			return nil, err
		}
		if err := os.Chmod(bin, 0o755); err != nil {
			return nil, fmt.Errorf("making %s executable: %w", bin, err)
		}
		if err := os.WriteFile(filepath.Join(binDir, versionFile), []byte(whisperVersion+"\n"), 0o644); err != nil {
			return nil, fmt.Errorf("recording the install version: %w", err)
		}
	} else {
		ins.note("Using whisper-cli from PATH: %s", pathBin)
	}

	if err := ins.installModel(dlCtx, root, modelTag, staging); err != nil {
		return nil, err
	}

	st := Probe(modelTag)
	return &st, nil
}

// findBinEntry locates the whisper-cli binary inside an extracted tree (top
// level or under a bin/ directory, with or without the .exe suffix the Windows
// archives carry).
func findBinEntry(tree string) (string, error) {
	for _, candidate := range []string{
		filepath.Join(tree, binName),
		filepath.Join(tree, binName+".exe"),
		filepath.Join(tree, "bin", binName),
		filepath.Join(tree, "bin", binName+".exe"),
	} {
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			return candidate, nil
		}
	}
	return "", fmt.Errorf("archive contains no %s binary", binName)
}

// installModel downloads the model file into models/, skipping the transfer
// when the file is already present. The staging file lives inside RootDir so
// the final rename stays on one filesystem. A pinned digest (modelSHA256) is
// verified fail-closed when present; absent entries download unpinned (see the
// map's comment).
func (ins *installer) installModel(ctx context.Context, root, modelTag, staging string) error {
	dest, err := ModelPath(modelTag)
	if err != nil {
		return err
	}
	if info, err := os.Stat(dest); err == nil && !info.IsDir() && info.Size() > 0 {
		ins.note("Model %s already present", filepath.Base(dest))
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
		return fmt.Errorf("creating %s: %w", filepath.Dir(dest), err)
	}
	staged := filepath.Join(staging, filepath.Base(dest))
	sum, err := ins.download(ctx, ins.modelBase+filepath.Base(dest), staged, maxModelBytes, filepath.Base(dest))
	if err != nil {
		return err
	}
	if pinned, ok := ins.modelDigests[filepath.Base(dest)]; ok {
		if !strings.EqualFold(sum, pinned) {
			return fmt.Errorf("checksum mismatch for %s: downloaded sha256:%s, pinned sha256:%s — refusing to install an unverified model", filepath.Base(dest), sum, pinned)
		}
	}
	if err := os.Rename(staged, dest); err != nil {
		return fmt.Errorf("promoting model to %s: %w", dest, err)
	}
	return nil
}

// download fetches url to dest, computing the SHA256 while streaming and
// refusing a body over maxBytes, and returns the hex digest.
func (ins *installer) download(ctx context.Context, url, dest string, maxBytes int64, label string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", err
	}
	resp, err := ins.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("downloading %s: %w", label, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("downloading %s: HTTP %d", label, resp.StatusCode)
	}

	tmp, err := os.Create(dest)
	if err != nil {
		return "", fmt.Errorf("creating staged file: %w", err)
	}
	ins.note("Downloading %s...", label)
	hasher := sha256.New()
	_, copyErr := io.Copy(io.MultiWriter(tmp, hasher), io.LimitReader(resp.Body, maxBytes+1))
	closeErr := tmp.Close()
	if copyErr != nil {
		return "", fmt.Errorf("downloading %s: %w", label, copyErr)
	}
	if closeErr != nil {
		return "", fmt.Errorf("writing %s: %w", dest, closeErr)
	}
	if info, err := os.Stat(dest); err != nil {
		return "", fmt.Errorf("checking %s: %w", dest, err)
	} else if info.Size() > maxBytes {
		return "", fmt.Errorf("downloading %s: exceeds the %d-byte limit", label, maxBytes)
	}
	return hex.EncodeToString(hasher.Sum(nil)), nil
}
