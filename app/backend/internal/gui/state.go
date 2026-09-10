// Package gui owns the pure host-GUI backend logic: state paths, display
// selection, backend/WM resolution and argv, the RFB probe, the running-apps
// scan, and the shared status document. Nothing here touches tmux or imports
// internal/daemon — the session lifecycle lives in internal/daemon/gui.go,
// which imports this package (the only cycle-free direction, since the daemon
// boot hook must call ensure).
package gui

import (
	"fmt"
	"os"
	"path/filepath"
)

// maxSocketPathBytes caps the unix socket path length: struct sockaddr_un's
// sun_path holds 108 bytes on Linux (including the NUL terminator), so a
// socket path beyond this bound can never be bound.
const maxSocketPathBytes = 100

// StateDir resolves the GUI state root: $XDG_STATE_HOME/run-kit/gui when the
// env var is set, else ~/.local/state/run-kit/gui. Mirrors
// codebridge.StateDir's rule for its own tenant.
func StateDir() (string, error) {
	if v := os.Getenv("XDG_STATE_HOME"); v != "" {
		return filepath.Join(v, "run-kit", "gui"), nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("resolving gui state dir: %w", err)
	}
	return filepath.Join(home, ".local", "state", "run-kit", "gui"), nil
}

// SocketPath is the RFB unix socket for one GUI id: <StateDir>/<id>.sock.
func SocketPath(id string) (string, error) {
	dir, err := StateDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, id+".sock"), nil
}

// ValidateSocketPath rejects a socket path longer than maxSocketPathBytes —
// the unix sun_path cap makes such a path unbindable.
func ValidateSocketPath(path string) error {
	if len(path) > maxSocketPathBytes {
		return fmt.Errorf("socket path %q exceeds %d bytes (unix sun_path cap)", path, maxSocketPathBytes)
	}
	return nil
}
