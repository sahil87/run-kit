package codeserver

import (
	"os"
	"path/filepath"
	"testing"
)

// Throwaway manual verification against the REAL release tarball (the
// synthetic-fixture lesson). Runs only when RK_REAL_TARBALL points at one.
func TestExtractRealTarballManual(t *testing.T) {
	src := os.Getenv("RK_REAL_TARBALL")
	if src == "" {
		t.Skip("RK_REAL_TARBALL not set")
	}
	dest := t.TempDir()
	if err := extractTarball(src, dest); err != nil {
		t.Fatalf("real tarball extraction failed: %v", err)
	}
	bin := filepath.Join(dest, "bin", "code-server")
	fi, err := os.Stat(bin)
	if err != nil {
		t.Fatalf("bin/code-server missing after extraction: %v", err)
	}
	if fi.Mode().Perm()&0o111 == 0 {
		t.Errorf("bin/code-server not executable: %v", fi.Mode())
	}
	if _, err := filepath.EvalSymlinks(filepath.Join(dest, "node_modules", ".bin", "esvalidate")); err != nil {
		t.Errorf("the reported .bin symlink did not survive extraction: %v", err)
	}
}
