package cron

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

// TestLockContention: a held lock makes the second acquisition fail with the
// ErrTickHeld sentinel — the contention no-op (R14).
func TestLockContention(t *testing.T) {
	path := filepath.Join(t.TempDir(), ".lock")
	release, err := acquireLock(path)
	if err != nil {
		t.Fatal(err)
	}
	defer release()

	if _, err := acquireLock(path); !errors.Is(err, ErrTickHeld) {
		t.Errorf("second acquire = %v, want ErrTickHeld", err)
	}

	release()
	release2, err := acquireLock(path)
	if err != nil {
		t.Fatalf("acquire after release = %v", err)
	}
	release2()
}

func TestLockFileMode(t *testing.T) {
	path := filepath.Join(t.TempDir(), ".lock")
	release, err := acquireLock(path)
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	st, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if st.Mode().Perm() != fileMode {
		t.Errorf("lock mode = %o, want %o", st.Mode().Perm(), fileMode)
	}
}
