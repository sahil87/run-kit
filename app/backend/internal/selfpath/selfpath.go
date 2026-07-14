// Package selfpath resolves the running binary's own on-disk executable path and
// detects a Homebrew ("brew") install via its Cellar path marker. Both the CLI
// upgrade command (cmd/rk/upgrade.go) and the web update handler (api/update.go)
// share these so the brew-install detection cannot drift between the two entry
// points into the same self-upgrade behavior.
package selfpath

import (
	"os"
	"path/filepath"
	"strings"
)

// CellarMarker is the Cellar path segment that identifies a Homebrew-installed
// run-kit binary (e.g. /opt/homebrew/Cellar/run-kit/0.5.3/bin/run-kit). A daemon
// not installed via brew cannot self-upgrade through `brew upgrade`.
const CellarMarker = "/Cellar/run-kit/"

// Resolve returns this binary's on-disk executable path, following symlinks. It
// is the default behind both upgrade.go's resolveExeFn and update.go's
// resolveSelfPathFn seams. When the symlink cannot be resolved it falls back to
// the raw os.Executable path rather than erroring.
func Resolve() (string, error) {
	exePath, err := os.Executable()
	if err != nil {
		return "", err
	}
	resolved, err := filepath.EvalSymlinks(exePath)
	if err != nil {
		resolved = exePath
	}
	return resolved, nil
}

// IsBrewInstalled reports whether the given resolved executable path is a
// Homebrew install (contains CellarMarker).
func IsBrewInstalled(resolvedPath string) bool {
	return strings.Contains(resolvedPath, CellarMarker)
}
