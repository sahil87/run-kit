package desktop

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

// installedBundlePath returns the bundle path status reads and process probes
// target: the current-name bundle when its Info.plist exists, else the legacy
// pre-rename bundle when only it exists, else the current-name path (so a
// not-installed read resolves to a clean NotExist on the canonical path). The
// legacy fallback exists for one release window — a pre-rename install is the
// same rk-installed app and must read as "installed (older version)", never as
// "not installed".
func (ins *Installer) installedBundlePath() string {
	newPath := ins.AppPath()
	if _, err := os.Stat(filepath.Join(newPath, "Contents", "Info.plist")); err == nil {
		return newPath
	}
	legacyPath := filepath.Join(ins.InstallDir, legacyAppBundleName)
	if _, err := os.Stat(filepath.Join(legacyPath, "Contents", "Info.plist")); err == nil {
		return legacyPath
	}
	return newPath
}

// installedAppName is the running application's name as osascript addresses
// it — derived from the installed bundle path so the quit target can never
// drift from the bundle the installer manages (a legacy install is addressed
// by its own name).
func (ins *Installer) installedAppName() string {
	return strings.TrimSuffix(filepath.Base(ins.installedBundlePath()), ".app")
}

// installedBundlePaths lists every installed bundle path (a bundle counts
// when its Info.plist exists), current name first, then legacy. During the
// rename window both can exist side by side, and process probes must cover
// both — probing only installedBundlePath would miss a live legacy process
// and the swap would delete the running app. When neither exists it returns
// the canonical current-name path so not-installed reads behave as before.
func (ins *Installer) installedBundlePaths() []string {
	paths := make([]string, 0, 2)
	newPath := ins.AppPath()
	if _, err := os.Stat(filepath.Join(newPath, "Contents", "Info.plist")); err == nil {
		paths = append(paths, newPath)
	}
	legacyPath := filepath.Join(ins.InstallDir, legacyAppBundleName)
	if _, err := os.Stat(filepath.Join(legacyPath, "Contents", "Info.plist")); err == nil {
		paths = append(paths, legacyPath)
	}
	if len(paths) == 0 {
		return []string{newPath}
	}
	return paths
}

// runningBundlePath probes each installed bundle for a live process and
// returns the first hit ("" when nothing is running) — the quit flow's
// target when both bundles exist and the legacy one is the live install.
func (ins *Installer) runningBundlePath(ctx context.Context) string {
	for _, path := range ins.installedBundlePaths() {
		probeCtx, cancel := context.WithTimeout(ctx, probeTimeout)
		_, err := ins.Run(probeCtx, "pgrep", "-f", filepath.Join(path, "Contents", "MacOS"))
		cancel()
		if err == nil {
			return path
		}
	}
	return ""
}

// runningAppName is the osascript quit target: the name of the bundle with a
// live process, falling back to installedAppName when nothing probes live
// (message-only contexts).
func (ins *Installer) runningAppName(ctx context.Context) string {
	if path := ins.runningBundlePath(ctx); path != "" {
		return strings.TrimSuffix(filepath.Base(path), ".app")
	}
	return ins.installedAppName()
}

// InstalledVersion derives the installed desktop app's version from its
// Info.plist at check time (CFBundleShortVersionString, read via
// `plutil -extract … raw` through the Runner seam — an argument slice, never a
// constructed shell string). It is never assumed equal to the rk CLI version:
// a CLI upgrade does not move the app (Constitution II — derive, no state
// file). Returns ("", nil) when the app is not installed.
func (ins *Installer) InstalledVersion(ctx context.Context) (string, error) {
	plist := filepath.Join(ins.installedBundlePath(), "Contents", "Info.plist")
	if _, err := os.Stat(plist); err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return "", nil
		}
		return "", fmt.Errorf("checking installed app: %w", err)
	}

	probeCtx, cancel := context.WithTimeout(ctx, probeTimeout)
	defer cancel()
	out, err := ins.Run(probeCtx, "plutil", "-extract", "CFBundleShortVersionString", "raw", "-o", "-", plist)
	if err != nil {
		return "", fmt.Errorf("reading installed app version from %s: %w", plist, err)
	}
	v := strings.TrimSpace(string(out))
	if v == "" {
		return "", fmt.Errorf("empty CFBundleShortVersionString in %s", plist)
	}
	return v, nil
}

// AppRunning reports whether any installed bundle has a live process, matched
// by `pgrep -f` against each bundle's Contents/MacOS path (which also matches
// Electron helper processes — any hit means the app is live). Detection is
// best-effort: pgrep exits 1 on no match, so any error reads as "not running"
// (macOS always ships pgrep; a rare probe failure must not block an install
// that would otherwise succeed). When both the current and legacy bundles
// exist, both are probed — a live legacy process must not read as
// "not running" or the swap would remove it while it runs.
func (ins *Installer) AppRunning(ctx context.Context) bool {
	return ins.runningBundlePath(ctx) != ""
}
