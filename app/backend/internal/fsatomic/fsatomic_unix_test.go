//go:build !windows

package fsatomic

import (
	"os"
	"path/filepath"
	"syscall"
	"testing"
)

// Regression: WriteFile must respect the process umask like os.WriteFile —
// the former Chmod-based implementation forced the literal perm, widening
// 0644 writes to world-readable on hardened-umask (077) hosts.
func TestWriteFileRespectsUmask(t *testing.T) {
	old := syscall.Umask(0o077)
	defer syscall.Umask(old)

	path := filepath.Join(t.TempDir(), "state.yaml")
	if err := WriteFile(path, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if got := info.Mode().Perm(); got != 0o600 {
		t.Errorf("perm = %v, want 0600 (0644 masked by umask 077)", got)
	}
}
