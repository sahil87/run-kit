package codebridge

import (
	"fmt"
	"os"
	"path/filepath"
)

// StateDir resolves the code-bridge state root: $XDG_STATE_HOME/run-kit/cb
// when the env var is set, else ~/.local/state/run-kit/cb. It MUST mirror
// snapshot.DefaultDir — both the extension and the CLI resolve this path
// independently, so the rules may never drift apart.
func StateDir() (string, error) {
	if v := os.Getenv("XDG_STATE_HOME"); v != "" {
		return filepath.Join(v, "run-kit", "cb"), nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("resolving code-bridge state dir: %w", err)
	}
	return filepath.Join(home, ".local", "state", "run-kit", "cb"), nil
}

// HostsDir is the host-record registry dir, <state dir>/hosts.
func HostsDir() (string, error) {
	dir, err := StateDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "hosts"), nil
}
