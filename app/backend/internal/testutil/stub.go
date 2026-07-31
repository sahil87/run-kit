// Package testutil provides shared test scaffolding for the backend test
// suite: stub executables on disk/PATH and deadline-poll wait loops. It is a
// regular (non-_test) package so helpers are importable from _test.go files
// across packages.
package testutil

import (
	"os"
	"path/filepath"
	"testing"
)

// WriteStub writes an executable script named `name` into `dir` (0o755).
// Fails the test on write error.
func WriteStub(t *testing.T, dir, name, script string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, name), []byte(script), 0o755); err != nil {
		t.Fatalf("WriteFile stub %s: %v", name, err)
	}
}

// StubOnPath writes an executable script named `name` into a fresh t.TempDir()
// and PREPENDS that dir to PATH (preserving the original, restored via t.Setenv
// cleanup). Returns the dir. This is the opt-in PATH layer — callers that want
// PATH *replacement* call WriteStub and do t.Setenv("PATH", dir) themselves.
func StubOnPath(t *testing.T, name, script string) string {
	t.Helper()
	dir := t.TempDir()
	WriteStub(t, dir, name, script)
	t.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))
	return dir
}
