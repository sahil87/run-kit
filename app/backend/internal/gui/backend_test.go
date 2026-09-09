package gui

import (
	"errors"
	"reflect"
	"testing"
)

// stubLookPath resolves the named binaries to "/usr/bin/<name>" and reports
// everything else absent.
func stubLookPath(names ...string) func(string) (string, error) {
	present := make(map[string]bool, len(names))
	for _, n := range names {
		present[n] = true
	}
	return func(name string) (string, error) {
		if present[name] {
			return "/usr/bin/" + name, nil
		}
		return "", errors.New("not found")
	}
}

func TestResolveBackend(t *testing.T) {
	defer func(saved string) { goos = saved }(goos)

	t.Run("darwin is screen-sharing", func(t *testing.T) {
		goos = "darwin"
		name, path := ResolveBackend(stubLookPath())
		if name != "screen-sharing" || path != "" {
			t.Errorf("ResolveBackend() = (%q, %q), want (screen-sharing, \"\")", name, path)
		}
	})

	t.Run("Xtigervnc first", func(t *testing.T) {
		goos = "linux"
		name, path := ResolveBackend(stubLookPath("Xtigervnc", "Xvnc"))
		if name != "Xtigervnc" || path != "/usr/bin/Xtigervnc" {
			t.Errorf("ResolveBackend() = (%q, %q), want Xtigervnc", name, path)
		}
	})

	t.Run("Xvnc fallback", func(t *testing.T) {
		goos = "linux"
		name, path := ResolveBackend(stubLookPath("Xvnc"))
		if name != "Xvnc" || path != "/usr/bin/Xvnc" {
			t.Errorf("ResolveBackend() = (%q, %q), want the Xvnc fallback", name, path)
		}
	})

	t.Run("neither resolves to empty", func(t *testing.T) {
		goos = "linux"
		name, path := ResolveBackend(stubLookPath())
		if name != "" || path != "" {
			t.Errorf("ResolveBackend() = (%q, %q), want (\"\", \"\")", name, path)
		}
	})
}

func TestBackendArgv(t *testing.T) {
	got := BackendArgv("/usr/bin/Xtigervnc", ":10", "/state/run-kit/gui/host.sock")
	want := []string{
		"/usr/bin/Xtigervnc", ":10",
		"-rfbunixpath", "/state/run-kit/gui/host.sock",
		"-rfbport", "-1",
		"-SecurityTypes", "None",
		"-AlwaysShared",
		"-AcceptSetDesktopSize",
		"-geometry", "1920x1080",
		"-FrameRate=60",
		"-desktop", "run-kit",
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("BackendArgv() = %v, want %v", got, want)
	}

	// The TCP port is pinned off in every argv — find "-rfbport" and assert
	// the following element.
	for i, arg := range got {
		if arg == "-rfbport" {
			if i+1 >= len(got) || got[i+1] != "-1" {
				t.Fatalf("-rfbport followed by %v, want -1 (nothing may listen on TCP)", got[i+1:])
			}
			return
		}
	}
	t.Fatal("-rfbport missing from BackendArgv")
}

func TestResolveWM(t *testing.T) {
	t.Run("ladder order", func(t *testing.T) {
		argv, ok := ResolveWM(stubLookPath("xfwm4", "openbox", "i3"))
		if !ok || !reflect.DeepEqual(argv, []string{"openbox"}) {
			t.Errorf("ResolveWM() = %v, %v, want [openbox], true (first ladder hit)", argv, ok)
		}
		argv, ok = ResolveWM(stubLookPath("kwin_x11", "i3"))
		if !ok || !reflect.DeepEqual(argv, []string{"i3"}) {
			t.Errorf("ResolveWM() = %v, %v, want [i3], true", argv, ok)
		}
	})

	t.Run("x-session-manager wraps in dbus-run-session", func(t *testing.T) {
		argv, ok := ResolveWM(stubLookPath("x-session-manager"))
		if !ok || !reflect.DeepEqual(argv, []string{"dbus-run-session", "--", "x-session-manager"}) {
			t.Errorf("ResolveWM() = %v, %v, want [dbus-run-session -- x-session-manager], true", argv, ok)
		}
	})

	t.Run("none found", func(t *testing.T) {
		if argv, ok := ResolveWM(stubLookPath()); ok || argv != nil {
			t.Errorf("ResolveWM() = %v, %v, want nil, false", argv, ok)
		}
	})
}
