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

// InstalledVersion derives the installed desktop app's version from its
// Info.plist at check time (CFBundleShortVersionString, read via
// `plutil -extract … raw` through the Runner seam — an argument slice, never a
// constructed shell string). It is never assumed equal to the rk CLI version:
// a CLI upgrade does not move the app (Constitution II — derive, no state
// file). Returns ("", nil) when the app is not installed.
func (ins *Installer) InstalledVersion(ctx context.Context) (string, error) {
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

// AppRunning reports whether the installed bundle has a live process, matched
// by `pgrep -f` against the bundle's Contents/MacOS path (which also matches
// Electron helper processes — any hit means the bundle is live). Detection is
// best-effort: pgrep exits 1 on no match, so any error reads as "not running"
// (macOS always ships pgrep; a rare probe failure must not block an install
// that would otherwise succeed).
func (ins *Installer) AppRunning(ctx context.Context) bool {
	probeCtx, cancel := context.WithTimeout(ctx, probeTimeout)
	defer cancel()
	_, err := ins.Run(probeCtx, "pgrep", "-f", filepath.Join(ins.AppPath(), "Contents", "MacOS"))
	return err == nil
}
