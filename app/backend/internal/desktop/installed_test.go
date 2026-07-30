package desktop

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

// writeFakeBundle creates <dir>/Run Kit.app/Contents/Info.plist (content is
// irrelevant — the version read goes through the stubbed plutil runner).
func writeFakeBundle(t *testing.T, dir string) string {
	t.Helper()
	contents := filepath.Join(dir, AppBundleName, "Contents")
	if err := os.MkdirAll(contents, 0o755); err != nil {
		t.Fatal(err)
	}
	plist := filepath.Join(contents, "Info.plist")
	if err := os.WriteFile(plist, []byte("fake"), 0o644); err != nil {
		t.Fatal(err)
	}
	return plist
}

func TestInstalledVersionNotInstalled(t *testing.T) {
	ins := New()
	ins.InstallDir = t.TempDir()
	ins.Run = func(_ context.Context, name string, args ...string) ([]byte, error) {
		t.Fatalf("unexpected subprocess for a missing app: %s %v", name, args)
		return nil, nil
	}
	v, err := ins.InstalledVersion(context.Background())
	if err != nil {
		t.Fatalf("InstalledVersion: %v", err)
	}
	if v != "" {
		t.Errorf("version = %q, want empty (not installed)", v)
	}
}

func TestInstalledVersionReadsPlist(t *testing.T) {
	dir := t.TempDir()
	plist := writeFakeBundle(t, dir)

	ins := New()
	ins.InstallDir = dir
	var gotName string
	var gotArgs []string
	ins.Run = func(_ context.Context, name string, args ...string) ([]byte, error) {
		gotName, gotArgs = name, args
		return []byte("3.12.2\n"), nil
	}

	v, err := ins.InstalledVersion(context.Background())
	if err != nil {
		t.Fatalf("InstalledVersion: %v", err)
	}
	if v != "3.12.2" {
		t.Errorf("version = %q, want 3.12.2", v)
	}
	if gotName != "plutil" {
		t.Errorf("runner name = %q, want plutil", gotName)
	}
	wantArgs := []string{"-extract", "CFBundleShortVersionString", "raw", "-o", "-", plist}
	if !reflect.DeepEqual(gotArgs, wantArgs) {
		t.Errorf("plutil args = %v, want %v", gotArgs, wantArgs)
	}
}

func TestInstalledVersionProbeFailure(t *testing.T) {
	dir := t.TempDir()
	writeFakeBundle(t, dir)

	ins := New()
	ins.InstallDir = dir
	ins.Run = func(_ context.Context, _ string, _ ...string) ([]byte, error) {
		return nil, errors.New("plutil exploded")
	}
	if _, err := ins.InstalledVersion(context.Background()); err == nil {
		t.Error("expected an error from a failing plist probe, got nil")
	}
}

func TestAppRunning(t *testing.T) {
	ins := New()
	ins.InstallDir = "/Applications"

	var gotName string
	var gotArgs []string
	ins.Run = func(_ context.Context, name string, args ...string) ([]byte, error) {
		gotName, gotArgs = name, args
		return []byte("123\n"), nil
	}
	if !ins.AppRunning(context.Background()) {
		t.Error("AppRunning = false with a matching pgrep, want true")
	}
	if gotName != "pgrep" {
		t.Errorf("runner name = %q, want pgrep", gotName)
	}
	wantArgs := []string{"-f", filepath.Join("/Applications", AppBundleName, "Contents", "MacOS")}
	if !reflect.DeepEqual(gotArgs, wantArgs) {
		t.Errorf("pgrep args = %v, want %v", gotArgs, wantArgs)
	}

	// pgrep exiting non-zero (no match, or a rare probe failure) reads as
	// not-running — best-effort detection must not block an install.
	ins.Run = func(_ context.Context, _ string, _ ...string) ([]byte, error) {
		return nil, errors.New("exit status 1")
	}
	if ins.AppRunning(context.Background()) {
		t.Error("AppRunning = true with a failing pgrep, want false")
	}
}
