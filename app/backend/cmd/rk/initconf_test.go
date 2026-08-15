package main

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"rk/internal/tmux"
)

// withTempConfigPath points the init-conf scaffold target at a temp dir for
// the test's duration, returning the config path.
func withTempConfigPath(t *testing.T) string {
	t.Helper()
	orig := tmux.DefaultConfigPath
	dest := filepath.Join(t.TempDir(), ".rk", "tmux.conf")
	tmux.DefaultConfigPath = dest
	t.Cleanup(func() { tmux.DefaultConfigPath = orig })
	return dest
}

// TestInitConfScaffoldsConfigAndDropIn pins the scaffold behavior on a fresh
// instance: both files land, the report prints via the cmd writer, a rerun
// without --force refuses, and --force overwrites.
func TestInitConfScaffoldsConfigAndDropIn(t *testing.T) {
	dest := withTempConfigPath(t)
	cmd := newInitConfCmd("init-conf", false)

	var buf bytes.Buffer
	cmd.SetOut(&buf)
	if err := cmd.RunE(cmd, nil); err != nil {
		t.Fatalf("init-conf run error: %v", err)
	}
	if !strings.Contains(buf.String(), "Wrote "+dest) {
		t.Errorf("report must print via the cmd writer, got: %q", buf.String())
	}
	if !strings.Contains(buf.String(), "Drop-in configs: "+filepath.Join(filepath.Dir(dest), "tmux.d")) {
		t.Errorf("drop-in line missing, got: %q", buf.String())
	}

	data, err := os.ReadFile(dest)
	if err != nil {
		t.Fatalf("config not written: %v", err)
	}
	if !bytes.Equal(data, tmux.DefaultConfigBytes()) {
		t.Error("written config must match the embedded default bytes")
	}
	if fi, err := os.Stat(filepath.Join(filepath.Dir(dest), "tmux.d")); err != nil || !fi.IsDir() {
		t.Errorf("tmux.d/ drop-in dir not created: %v", err)
	}

	// Rerun without --force refuses; with --force overwrites.
	if err := cmd.RunE(cmd, nil); err == nil {
		t.Error("rerun without --force must refuse to overwrite")
	}
	if err := cmd.Flags().Set("force", "true"); err != nil {
		t.Fatal(err)
	}
	if err := cmd.RunE(cmd, nil); err != nil {
		t.Errorf("--force rerun error: %v", err)
	}
}

// TestInitConfAliasRunsWithDeprecationPointer pins the deprecation-alias
// contract: the old root form `rk init-conf` still scaffolds (into the temp
// target) AND prints the cobra deprecation pointer naming `rk mux init-conf`,
// while the family form stays warning-free.
func TestInitConfAliasRunsWithDeprecationPointer(t *testing.T) {
	withTempConfigPath(t)

	stdout, stderr, err := runRootArgs(t, "init-conf")
	if err != nil {
		t.Fatalf("rk init-conf alias run error: %v", err)
	}
	if !strings.Contains(stdout, "Wrote ") {
		t.Errorf("alias must scaffold identically, got stdout: %q", stdout)
	}
	if got := stdout + stderr; !strings.Contains(got, `Command "init-conf" is deprecated, use `+"`rk mux init-conf`") {
		t.Errorf("alias must print the deprecation pointer naming `rk mux init-conf`, got stdout: %q stderr: %q", stdout, stderr)
	}
	if !initConfAliasCmd.Hidden {
		t.Error("the init-conf alias must be hidden from help and the help-dump")
	}

	// The family form (--force, since the alias run already wrote the config)
	// runs warning-free.
	_, stderr, err = runRootArgs(t, "mux", "init-conf", "--force")
	if err != nil {
		t.Fatalf("rk mux init-conf --force run error: %v", err)
	}
	if strings.Contains(stderr, "deprecated") {
		t.Errorf("the family form must not print a deprecation warning, got stderr: %q", stderr)
	}
}

// TestMuxInitConfRejectsExplicitServerFlag pins the -L guard: an explicitly-set
// inherited --server is a usage error (exit 2) and NOTHING is written.
func TestMuxInitConfRejectsExplicitServerFlag(t *testing.T) {
	dest := withTempConfigPath(t)

	_, _, err := runRootArgs(t, "mux", "-L", "zzz-nope", "init-conf")
	if err == nil {
		t.Fatal("rk mux -L zzz-nope init-conf: expected a usage error, got nil")
	}
	if got := exitCode(err); got != exitUsage {
		t.Errorf("exit code = %d, want %d (usage)", got, exitUsage)
	}
	if !strings.Contains(err.Error(), "--server") {
		t.Errorf("error must name --server, got: %v", err)
	}
	if _, statErr := os.Stat(dest); !os.IsNotExist(statErr) {
		t.Error("the guard must fire before any write — config file must not exist")
	}
}
