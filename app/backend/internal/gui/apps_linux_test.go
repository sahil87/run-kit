//go:build linux

package gui

import (
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"testing"
)

// writeFakeProc plants one fixture process under procRoot with the given
// comm and environ entries.
func writeFakeProc(t *testing.T, procRoot string, pid int, comm string, env ...string) {
	t.Helper()
	dir := filepath.Join(procRoot, strconv.Itoa(pid))
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	blob := []byte{}
	for _, e := range env {
		blob = append(blob, []byte(e)...)
		blob = append(blob, 0)
	}
	if err := os.WriteFile(filepath.Join(dir, "environ"), blob, 0o644); err != nil {
		t.Fatalf("WriteFile environ: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "comm"), []byte(comm+"\n"), 0o644); err != nil {
		t.Fatalf("WriteFile comm: %v", err)
	}
}

func TestRunningApps(t *testing.T) {
	procRoot := t.TempDir()
	writeFakeProc(t, procRoot, 101, "chromium", "DISPLAY=:10", "HOME=/home/u")
	writeFakeProc(t, procRoot, 102, "chromium", "SHELL=/bin/sh", "DISPLAY=:10")
	writeFakeProc(t, procRoot, 103, "xterm", "DISPLAY=:10")
	writeFakeProc(t, procRoot, 104, "xterm", "DISPLAY=:11")
	// Non-pid entries are skipped.
	if err := os.WriteFile(filepath.Join(procRoot, "meminfo"), nil, 0o644); err != nil {
		t.Fatalf("WriteFile meminfo: %v", err)
	}
	// A pid without a readable environ is skipped (the vanished/permission case).
	if err := os.MkdirAll(filepath.Join(procRoot, "105"), 0o755); err != nil {
		t.Fatalf("MkdirAll 105: %v", err)
	}
	// DISPLAY=:100 must not count for :10 (exact entry match).
	writeFakeProc(t, procRoot, 106, "chromium", "DISPLAY=:100")

	apps, err := RunningApps(procRoot, ":10", nil)
	if err != nil {
		t.Fatalf("RunningApps: %v", err)
	}
	want := []App{{Name: "chromium", Count: 2}, {Name: "xterm", Count: 1}}
	if !reflect.DeepEqual(apps, want) {
		t.Errorf("RunningApps(:10) = %v, want %v", apps, want)
	}

	t.Run("excluded pids are skipped", func(t *testing.T) {
		apps, err := RunningApps(procRoot, ":10", map[int]bool{101: true, 102: true})
		if err != nil {
			t.Fatalf("RunningApps: %v", err)
		}
		want := []App{{Name: "xterm", Count: 1}}
		if !reflect.DeepEqual(apps, want) {
			t.Errorf("RunningApps(:10, exclude 101,102) = %v, want %v", apps, want)
		}
	})

	t.Run("the pane tree (WM included) is not counted", func(t *testing.T) {
		// The supervisor launches the WM with DISPLAY in its env, so a raw
		// /proc environ scan matches it; only the pane-tree exclusion keeps
		// openbox out of the apps list.
		wmRoot := t.TempDir()
		writeFakeProc(t, wmRoot, 200, "rk", "HOME=/home/u")
		writeFakeProc(t, wmRoot, 201, "Xtigervnc")
		writeFakeProc(t, wmRoot, 202, "openbox", "DISPLAY=:10")
		writeFakeProc(t, wmRoot, 300, "chromium", "DISPLAY=:10")
		writeFakeStat(t, wmRoot, 200, "rk", 1)
		writeFakeStat(t, wmRoot, 201, "Xtigervnc", 200)
		writeFakeStat(t, wmRoot, 202, "openbox", 200)
		writeFakeStat(t, wmRoot, 300, "chromium", 1)

		apps, err := RunningApps(wmRoot, ":10", ProcessTreePids(wmRoot, 200))
		if err != nil {
			t.Fatalf("RunningApps: %v", err)
		}
		want := []App{{Name: "chromium", Count: 1}}
		if !reflect.DeepEqual(apps, want) {
			t.Errorf("RunningApps(:10, pane tree excluded) = %v, want %v — the WM must not count", apps, want)
		}
	})

	t.Run("other display", func(t *testing.T) {
		apps, err := RunningApps(procRoot, ":11", nil)
		if err != nil {
			t.Fatalf("RunningApps: %v", err)
		}
		want := []App{{Name: "xterm", Count: 1}}
		if !reflect.DeepEqual(apps, want) {
			t.Errorf("RunningApps(:11) = %v, want %v", apps, want)
		}
	})

	t.Run("empty result is a non-nil empty slice", func(t *testing.T) {
		apps, err := RunningApps(procRoot, ":12", nil)
		if err != nil {
			t.Fatalf("RunningApps: %v", err)
		}
		if len(apps) != 0 {
			t.Errorf("RunningApps(:12) = %v, want empty", apps)
		}
	})
}

func TestRunningAppsExcludesDEDaemonsByName(t *testing.T) {
	// A full desktop's session/panel/D-Bus daemons carry the display in their
	// env like any X client; only the user app survives the comm-name filter.
	procRoot := t.TempDir()
	writeFakeProc(t, procRoot, 201, "lxqt-session", "DISPLAY=:10")
	writeFakeProc(t, procRoot, 202, "lxqt-panel", "DISPLAY=:10")
	writeFakeProc(t, procRoot, 203, "dbus-daemon", "DISPLAY=:10")
	writeFakeProc(t, procRoot, 300, "xterm", "DISPLAY=:10")

	apps, err := RunningApps(procRoot, ":10", nil)
	if err != nil {
		t.Fatalf("RunningApps: %v", err)
	}
	want := []App{{Name: "xterm", Count: 1}}
	if !reflect.DeepEqual(apps, want) {
		t.Errorf("RunningApps(:10) = %v, want %v — DE daemons excluded by name", apps, want)
	}
}

func TestRunningAppsExcludesWMHelpersByName(t *testing.T) {
	// WM helpers carry the display in their env like any X client; without the
	// comm-name exclusion they would show in the apps list whenever the pid
	// exclude set is unavailable.
	procRoot := t.TempDir()
	writeFakeProc(t, procRoot, 201, "icewm", "DISPLAY=:10")
	writeFakeProc(t, procRoot, 202, "icewm-session", "DISPLAY=:10")
	writeFakeProc(t, procRoot, 300, "xterm", "DISPLAY=:10")

	apps, err := RunningApps(procRoot, ":10", nil)
	if err != nil {
		t.Fatalf("RunningApps: %v", err)
	}
	want := []App{{Name: "xterm", Count: 1}}
	if !reflect.DeepEqual(apps, want) {
		t.Errorf("RunningApps(:10) = %v, want %v — WM helpers excluded by name", apps, want)
	}
}
