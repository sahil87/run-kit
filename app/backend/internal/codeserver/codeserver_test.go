package codeserver

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLayoutPaths(t *testing.T) {
	home := t.TempDir()
	if got, want := BinDir(home), filepath.Join(home, ".rk", "code-server-bin"); got != want {
		t.Errorf("BinDir = %q, want %q", got, want)
	}
	if got, want := VersionDir(home, "4.132.0"), filepath.Join(home, ".rk", "code-server-bin", "4.132.0"); got != want {
		t.Errorf("VersionDir = %q, want %q", got, want)
	}
	if got, want := CurrentPath(home), filepath.Join(home, ".rk", "code-server-bin", "current"); got != want {
		t.Errorf("CurrentPath = %q, want %q", got, want)
	}
	if got, want := BinaryPath(home), filepath.Join(home, ".rk", "code-server-bin", "current", "bin", "code-server"); got != want {
		t.Errorf("BinaryPath = %q, want %q", got, want)
	}
}

func TestInstalledVersionAbsent(t *testing.T) {
	got, err := InstalledVersion(t.TempDir())
	if err != nil || got != "" {
		t.Errorf("InstalledVersion = %q, %v — want \"\", nil (absence is a state)", got, err)
	}
}

func TestInstalledVersionReadsSymlinkTarget(t *testing.T) {
	home := t.TempDir()
	// A RELATIVE target (the form Install writes) must basename to the version.
	if err := os.MkdirAll(VersionDir(home, "4.132.0"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink("4.132.0", CurrentPath(home)); err != nil {
		t.Fatal(err)
	}
	got, err := InstalledVersion(home)
	if err != nil || got != "4.132.0" {
		t.Errorf("InstalledVersion = %q, %v — want 4.132.0, nil", got, err)
	}
}

func TestManagedBinaryRequiresExecutable(t *testing.T) {
	home := t.TempDir()
	bin := filepath.Join(VersionDir(home, "4.132.0"), "bin")
	if err := os.MkdirAll(bin, 0o755); err != nil {
		t.Fatal(err)
	}
	exe := filepath.Join(bin, "code-server")
	if err := os.WriteFile(exe, []byte("#!/bin/sh\n"), 0o644); err != nil { // NOT executable
		t.Fatal(err)
	}
	if got := ManagedBinary(home); got != "" {
		t.Errorf("ManagedBinary = %q, want \"\" (no current symlink)", got)
	}
	if err := os.Symlink("4.132.0", CurrentPath(home)); err != nil {
		t.Fatal(err)
	}
	if got := ManagedBinary(home); got != "" {
		t.Errorf("ManagedBinary = %q, want \"\" (binary not executable)", got)
	}
	if err := os.Chmod(exe, 0o755); err != nil {
		t.Fatal(err)
	}
	want := BinaryPath(home)
	if got := ManagedBinary(home); got != want {
		t.Errorf("ManagedBinary = %q, want %q", got, want)
	}
}
