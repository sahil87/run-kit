// Package selfpath resolves the running binary's own on-disk executable path and
// detects a Homebrew ("brew") install via its Cellar path marker. Both the CLI
// upgrade command (cmd/rk/upgrade.go) and the web update handler (api/update.go)
// share these so the brew-install detection cannot drift between the two entry
// points into the same self-upgrade behavior.
//
// Two resolvers, two audiences. Resolve names the binary that is actually
// running — the input brew detection needs (the Cellar marker) and the path the
// daemon's own respawn wants. Stable names the path that survives a
// `brew upgrade`: on a Homebrew install the old keg is deleted, so any process
// spawned to outlive this binary's version (a tmux session's argv, an RK_BIN
// env element, a shell chain) must carry the brew-prefix symlink instead.
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

// StableFor maps a resolved executable path to the path that survives a
// Homebrew upgrade. A Cellar path (…/Cellar/run-kit/<version>/bin/run-kit)
// becomes the brew-prefix symlink <prefix>/bin/run-kit, which brew repoints on
// every upgrade; any other path is returned unchanged. Pure string derivation —
// it never stats the result, because during `brew upgrade` the stable symlink
// dangles for a moment and a stat-then-fallback would re-pin the Cellar path.
func StableFor(resolved string) string {
	idx := strings.Index(resolved, CellarMarker)
	if idx == -1 {
		return resolved
	}
	return resolved[:idx] + "/bin/run-kit"
}

// Stable is Resolve followed by StableFor: the path to hand to processes that
// outlive this binary's version (spawn argv, env such as RK_BIN, shell chains).
// Callers that need the real on-disk binary (brew detection, the daemon's own
// respawn) keep using Resolve.
func Stable() (string, error) {
	resolved, err := Resolve()
	if err != nil {
		return "", err
	}
	return StableFor(resolved), nil
}
