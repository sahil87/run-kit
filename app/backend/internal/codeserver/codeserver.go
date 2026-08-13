// Package codeserver owns the rk-managed code-server install: the versioned
// directory layout under ~/.rk/code-server-bin, GitHub release resolution, and
// the download-verify-extract-flip install flow. It has zero tmux coupling —
// the daemon (internal/daemon) and the CLI (cmd/rk) both consume it, mirroring
// the desktop-installer precedent (install engine as a library, callers stay
// thin).
//
// Layout (user-decided):
//
//	~/.rk/code-server-bin/<version>/   one extracted release per version dir,
//	                                   top-level tarball directory stripped, so
//	                                   the binary is <version>/bin/code-server
//	~/.rk/code-server-bin/current      symlink → <version>; activation is an
//	                                   atomic symlink flip (temp symlink +
//	                                   os.Rename), never a remove+recreate
//
// The layout is derived from the filesystem at call time (Constitution II) —
// InstalledVersion reads the current symlink's target; there is no registry.
package codeserver

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
)

const (
	// binDirName is the managed-install root under ~/.rk.
	binDirName = "code-server-bin"
	// currentLinkName is the symlink beside the version dirs pointing at the
	// active version.
	currentLinkName = "current"
)

// BinDir is the managed-install root: ~/.rk/code-server-bin. Its existence is
// the ownership signal — a host without it has a user-managed (or no)
// code-server, which rk never touches.
func BinDir(home string) string {
	return filepath.Join(home, ".rk", binDirName)
}

// VersionDir is the install dir for one release version (no leading "v").
func VersionDir(home, version string) string {
	return filepath.Join(BinDir(home), version)
}

// CurrentPath is the activation symlink whose target names the active version.
func CurrentPath(home string) string {
	return filepath.Join(BinDir(home), currentLinkName)
}

// BinaryPath is the code-server entry script of the active managed install.
func BinaryPath(home string) string {
	return filepath.Join(CurrentPath(home), "bin", "code-server")
}

// InstalledVersion reads the active version from the current symlink's target
// basename. A missing symlink (nothing managed) yields ("", nil) — absence is
// a state, not an error; any other read failure is returned.
func InstalledVersion(home string) (string, error) {
	target, err := os.Readlink(CurrentPath(home))
	if errors.Is(err, fs.ErrNotExist) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return filepath.Base(target), nil
}

// ManagedBinary is the daemon's rung-1 resolution: the absolute binary path of
// the active managed install, verified to exist and be executable, or "" when
// no managed install is usable (the ladder then falls through to PATH).
func ManagedBinary(home string) string {
	path := BinaryPath(home)
	info, err := os.Stat(path)
	if err != nil || !info.Mode().IsRegular() || info.Mode().Perm()&0o111 == 0 {
		return ""
	}
	return path
}
