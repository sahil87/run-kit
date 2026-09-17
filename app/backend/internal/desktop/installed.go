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

// InstalledVersion derives the installed desktop app's version at check time.
// On darwin it reads <root>/Run Kit.app/Contents/Info.plist
// (CFBundleShortVersionString, via `plutil -extract … raw` through the Runner
// seam — an argument slice, never a constructed shell string); on linux it
// reads the current symlink's target basename. It is never assumed equal to
// the rk CLI version: a CLI upgrade does not move the app (Constitution II —
// derive, no state file). Returns ("", nil) when the app is not installed.
func (ins *Installer) InstalledVersion(ctx context.Context) (string, error) {
	if ins.GOOS == "linux" {
		root, err := ins.effectiveInstallDir()
		if err != nil {
			return "", err
		}
		return installedVersionLinux(root)
	}
	plist := filepath.Join(ins.AppPath(), "Contents", "Info.plist")
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

// AppRunning reports whether the installed app has a live process. On darwin
// it is a `pgrep -f` against the bundle's Contents/MacOS path (which also
// matches Electron helper processes — any hit means the bundle is live); on
// linux it is `pgrep -f` against the installed version dir's ELF path (see
// linux.go). Detection is best-effort: pgrep exits 1 on no match, so any
// error reads as "not running" (a rare probe failure must not block an
// install that would otherwise succeed).
func (ins *Installer) AppRunning(ctx context.Context) bool {
	if ins.GOOS == "linux" {
		root, err := ins.effectiveInstallDir()
		if err != nil {
			return false
		}
		return ins.appRunningLinux(ctx, root)
	}
	probeCtx, cancel := context.WithTimeout(ctx, probeTimeout)
	defer cancel()
	_, err := ins.Run(probeCtx, "pgrep", "-f", filepath.Join(ins.AppPath(), "Contents", "MacOS"))
	return err == nil
}
