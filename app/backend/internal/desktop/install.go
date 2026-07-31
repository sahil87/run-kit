package desktop

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// InstallResult reports a completed install.
type InstallResult struct {
	// Version is the installed release version (no leading "v").
	Version string
	// Path is the installed bundle path.
	Path string
	// Restarted reports that the app was running at the swap boundary and the
	// full quit → swap → relaunch sequence completed. False when the app was
	// not running, and also when the relaunch failed (the update itself still
	// succeeded — see the relaunch warning on Progress). The CLI layer keys
	// the restart-announcement data line on it.
	Restarted bool
}

// Install downloads, verifies, and installs the given release:
//
//  1. Download the DMG to a temp file (SHA256 computed while streaming).
//  2. Verify the SHA256 against the release digest when the API supplied one.
//  3. Mount read-only via `hdiutil attach -nobrowse -readonly -mountpoint`.
//  4. Validate the mounted bundle is named AppBundleName (the install target
//     is derived from that constant, so an unexpectedly-named bundle is
//     refused rather than installed beside the real app).
//  5. Verify the mounted .app with `codesign --verify --deep --strict` —
//     this installer is precisely the code path that bypasses Gatekeeper's
//     own check, so it MUST do the verification itself. A DMG failing either
//     check is discarded with an error and the install target is untouched.
//  6. Stage the new bundle with `ditto` (the macOS-correct tool for
//     preserving bundle metadata and signatures — wrap, don't reinvent) under
//     a temp name INSIDE InstallDir, then atomically replace: remove the old
//     bundle and rename staged → final. The long copy completes before the
//     existing install is touched, so a mid-copy failure never destroys a
//     working install; a failed replace removes the staged copy.
//  7. Re-check AppRunning immediately before the destructive replace (steps
//     1-6 deliberately run while the app may be running — the VSCode
//     stage-then-swap pattern). A running app is handled, not refused: ask it
//     to quit gracefully (osascript, so Electron's shutdown hooks run and the
//     shell captures its last route), wait for process exit (bounded poll),
//     swap, then relaunch the new bundle via `open -a`. If the app does not
//     exit within the bound, abort without swapping — the existing install is
//     untouched and the staged bundle is left in place (its deterministic
//     name is reclaimed by the next run). A relaunch failure is a non-fatal
//     Progress warning: the swap already succeeded.
//  8. Detach the mount in a defer so an aborted install never leaves a stray
//     mount; the temp DMG is removed on every path.
//
// All subprocesses run through the Runner seam (exec.CommandContext with
// argument slices and timeouts).
func (ins *Installer) Install(ctx context.Context, rel Release) (InstallResult, error) {
	dmgPath, err := ins.download(ctx, rel)
	if err != nil {
		return InstallResult{}, err
	}
	defer os.Remove(dmgPath)

	mount, err := os.MkdirTemp("", "run-kit-desktop-mnt-")
	if err != nil {
		return InstallResult{}, fmt.Errorf("creating mountpoint: %w", err)
	}
	// Plain Remove (not RemoveAll): after a clean detach the dir is empty; if
	// the detach failed we must not walk into a still-mounted image. Runs after
	// the detach defer below (LIFO).
	defer os.Remove(mount)

	attachCtx, cancelAttach := context.WithTimeout(ctx, attachTimeout)
	defer cancelAttach()
	if _, err := ins.Run(attachCtx, "hdiutil", "attach", "-nobrowse", "-readonly", "-mountpoint", mount, dmgPath); err != nil {
		return InstallResult{}, fmt.Errorf("mounting DMG: %w", err)
	}
	defer func() {
		// Detach on context.Background(): the parent ctx may already be
		// canceled on a failure path, and the mount must be released anyway.
		detachCtx, cancel := context.WithTimeout(context.Background(), detachTimeout)
		defer cancel()
		if _, derr := ins.Run(detachCtx, "hdiutil", "detach", mount); derr != nil {
			fmt.Fprintf(ins.Progress, "warning: could not detach %s: %v\n", mount, derr)
		}
	}()

	srcApp, err := findAppBundle(mount)
	if err != nil {
		return InstallResult{}, err
	}
	if base := filepath.Base(srcApp); base != AppBundleName {
		return InstallResult{}, fmt.Errorf("mounted DMG contains %q, expected %q — refusing to install an unexpected bundle", base, AppBundleName)
	}

	codesignCtx, cancelCodesign := context.WithTimeout(ctx, codesignTimeout)
	defer cancelCodesign()
	fmt.Fprintf(ins.Progress, "Verifying signature of %s...\n", AppBundleName)
	if _, err := ins.Run(codesignCtx, "codesign", "--verify", "--deep", "--strict", srcApp); err != nil {
		return InstallResult{}, fmt.Errorf("signature verification failed — refusing to install an unverifiable app: %w", err)
	}

	// Stage inside InstallDir (same volume as the final path, so the rename
	// below is atomic). The deterministic dot-prefixed name means a leftover
	// from a previously interrupted run is reclaimed here rather than
	// accumulating.
	dest := ins.AppPath()
	staged := filepath.Join(ins.InstallDir, "."+AppBundleName+".staging")
	if err := os.RemoveAll(staged); err != nil {
		return InstallResult{}, fmt.Errorf("clearing leftover staged bundle %s: %w", staged, err)
	}

	dittoCtx, cancelDitto := context.WithTimeout(ctx, dittoTimeout)
	defer cancelDitto()
	fmt.Fprintf(ins.Progress, "Installing to %s...\n", dest)
	if _, err := ins.Run(dittoCtx, "ditto", srcApp, staged); err != nil {
		os.RemoveAll(staged)
		return InstallResult{}, fmt.Errorf("copying app bundle: %w", err)
	}

	// Swap-boundary running check (the TOCTOU probe): the stage phase above
	// deliberately runs while the app may be live — only the swap needs the
	// app gone. A running app is quit gracefully and relaunched after the
	// swap; if it will not exit within the bound, abort without swapping (the
	// existing install is untouched; the staged bundle's deterministic name
	// self-heals on the next run).
	wasRunning := ins.AppRunning(ctx)
	if wasRunning {
		fmt.Fprintf(ins.Progress, "%s is running — quitting it for the update...\n", appName)
		if err := ins.quitApp(ctx); err != nil {
			return InstallResult{}, err
		}
		if err := ins.waitAppExit(ctx); err != nil {
			return InstallResult{}, err
		}
	}

	if err := os.RemoveAll(dest); err != nil {
		os.RemoveAll(staged)
		return InstallResult{}, fmt.Errorf("removing existing %s: %w", dest, err)
	}
	if err := os.Rename(staged, dest); err != nil {
		os.RemoveAll(staged)
		return InstallResult{}, fmt.Errorf("moving staged bundle into place at %s: %w", dest, err)
	}

	restarted := false
	if wasRunning {
		fmt.Fprintf(ins.Progress, "Relaunching %s...\n", appName)
		if err := ins.relaunchApp(ctx, dest); err != nil {
			// Non-fatal: the swap succeeded — failing here would misreport a
			// completed update. The user can open the app themselves.
			fmt.Fprintf(ins.Progress, "warning: %v — open the app manually\n", err)
		} else {
			restarted = true
		}
	}

	return InstallResult{Version: rel.Version, Path: dest, Restarted: restarted}, nil
}

// download fetches the release asset to a temp file under a generous
// network-sized timeout, computing the SHA256 while streaming. The checksum is
// compared against the release digest when one was supplied; a mismatch
// discards the download. Progress goes to ins.Progress (the chatter channel —
// suppressed by --quiet).
func (ins *Installer) download(ctx context.Context, rel Release) (string, error) {
	dlCtx, cancel := context.WithTimeout(ctx, downloadTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(dlCtx, http.MethodGet, rel.AssetURL, nil)
	if err != nil {
		return "", err
	}
	if ins.Token != "" {
		req.Header.Set("Authorization", "Bearer "+ins.Token)
	}
	resp, err := ins.Client.Do(req)
	if err != nil {
		return "", fmt.Errorf("downloading %s: %w", rel.AssetName, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("downloading %s: HTTP %d", rel.AssetName, resp.StatusCode)
	}

	tmp, err := os.CreateTemp("", "run-kit-desktop-*.dmg")
	if err != nil {
		return "", fmt.Errorf("creating temp file: %w", err)
	}
	if resp.ContentLength > 0 {
		fmt.Fprintf(ins.Progress, "Downloading %s (%d MB)...\n", rel.AssetName, resp.ContentLength>>20)
	} else {
		fmt.Fprintf(ins.Progress, "Downloading %s...\n", rel.AssetName)
	}

	hasher := sha256.New()
	progress := &progressPrinter{w: ins.Progress, total: resp.ContentLength}
	_, copyErr := io.Copy(io.MultiWriter(tmp, hasher, progress), resp.Body)
	closeErr := tmp.Close()
	if copyErr != nil || closeErr != nil {
		os.Remove(tmp.Name())
		if copyErr != nil {
			return "", fmt.Errorf("downloading %s: %w", rel.AssetName, copyErr)
		}
		return "", fmt.Errorf("writing %s: %w", tmp.Name(), closeErr)
	}

	sum := hex.EncodeToString(hasher.Sum(nil))
	if rel.Digest == "" {
		fmt.Fprintf(ins.Progress, "note: release supplied no digest for %s; relying on signature verification\n", rel.AssetName)
	} else if !strings.EqualFold(sum, rel.Digest) {
		os.Remove(tmp.Name())
		return "", fmt.Errorf("checksum mismatch for %s: downloaded sha256:%s, release digest sha256:%s — discarding download", rel.AssetName, sum, rel.Digest)
	}
	return tmp.Name(), nil
}

// findAppBundle locates the .app bundle at the top level of the mounted image.
func findAppBundle(mount string) (string, error) {
	entries, err := os.ReadDir(mount)
	if err != nil {
		return "", fmt.Errorf("reading mounted DMG: %w", err)
	}
	for _, e := range entries {
		if strings.HasSuffix(e.Name(), ".app") {
			return filepath.Join(mount, e.Name()), nil
		}
	}
	return "", fmt.Errorf("no .app bundle found in mounted DMG at %s", mount)
}

// progressPrinter writes download progress to w every 10% when the total size
// is known (and stays silent otherwise — a missing Content-Length must not
// spam per-chunk lines). It is an io.Writer so it can ride the download's
// MultiWriter without buffering the payload.
type progressPrinter struct {
	w       io.Writer
	total   int64
	written int64
	lastPct int
}

func (p *progressPrinter) Write(b []byte) (int, error) {
	p.written += int64(len(b))
	if p.total > 0 {
		if pct := int(p.written * 100 / p.total); pct >= p.lastPct+10 {
			p.lastPct = pct - pct%10
			fmt.Fprintf(p.w, "  %d%% (%d/%d MB)\n", p.lastPct, p.written>>20, p.total>>20)
		}
	}
	return len(b), nil
}
