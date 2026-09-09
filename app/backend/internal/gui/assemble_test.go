package gui

import (
	"context"
	"errors"
	"reflect"
	"testing"
	"time"
)

// assembleDeps returns a fully-reachable StatusDeps script — tests override
// the one dep their branch hinges on. XDG_STATE_HOME is isolated so SocketPath
// never touches the developer's real state dir.
func assembleDeps(t *testing.T) StatusDeps {
	t.Helper()
	t.Setenv("XDG_STATE_HOME", t.TempDir())
	return StatusDeps{
		ID:      "host",
		Enabled: true,
		DaemonRunning: func() bool {
			return true
		},
		SessionExists:  func(context.Context) bool { return true },
		SessionOptions: func(context.Context) (string, string, bool) { return ":10", "Xtigervnc", true },
		SessionCreated: func(context.Context) (time.Time, bool) { return time.Unix(1_000_000, 0), true },
		PanePids:       func(context.Context) map[int]bool { return map[int]bool{200: true, 202: true} },
		Probe: func(context.Context, string, string) (Info, error) {
			return Info{Reachable: true, Width: 1920, Height: 1080}, nil
		},
		RunningApps: func(string, map[int]bool) ([]App, error) {
			return []App{{Name: "chromium", Count: 3}}, nil
		},
		LookPath: func(name string) (string, error) { return "/usr/bin/" + name, nil },
		Viewers:  func() int { return 2 },
		Now:      func() time.Time { return time.Unix(1_000_000+4*3600+12*60, 0) },
	}
}

func TestAssembleDisabledShortCircuits(t *testing.T) {
	d := assembleDeps(t)
	d.Enabled = false
	d.Viewers = func() int {
		t.Error("Viewers called while disabled — the short-circuit must fire first")
		return 0
	}

	st := Assemble(context.Background(), d)
	if st.Enabled || st.Session || st.Reachable || st.Reason != "" || len(st.Apps) != 0 {
		t.Errorf("status = %+v, want everything off/empty with no reason", st)
	}
	if st.Apps == nil {
		t.Error("Apps = nil, want the non-nil empty slice (JSON [] never null)")
	}
}

func TestAssembleDaemonDownGatesTmux(t *testing.T) {
	d := assembleDeps(t)
	d.DaemonRunning = func() bool { return false }
	d.SessionExists = func(context.Context) bool {
		t.Error("SessionExists called with the daemon down — a tmux command on a dead socket births a server")
		return false
	}

	st := Assemble(context.Background(), d)
	if st.Reason != SessionAbsentReason {
		t.Errorf("reason = %q, want %q", st.Reason, SessionAbsentReason)
	}
	if st.Viewers != 2 {
		t.Errorf("viewers = %d, want 2 (the count precedes the daemon gate)", st.Viewers)
	}
}

func TestAssembleSessionAbsentReason(t *testing.T) {
	d := assembleDeps(t)
	d.SessionExists = func(context.Context) bool { return false }

	st := Assemble(context.Background(), d)
	if st.Session || st.Reason != SessionAbsentReason {
		t.Errorf("status = %+v, want session=false with reason %q", st, SessionAbsentReason)
	}
}

func TestAssembleReachablePassesThePaneTreeExclude(t *testing.T) {
	d := assembleDeps(t)
	var gotExclude map[int]bool
	d.RunningApps = func(display string, exclude map[int]bool) ([]App, error) {
		gotExclude = exclude
		if display != ":10" {
			t.Errorf("display = %q, want :10 (the stamped display)", display)
		}
		return []App{{Name: "chromium", Count: 3}}, nil
	}

	st := Assemble(context.Background(), d)
	if !st.Reachable || !st.Session {
		t.Fatalf("status = %+v, want reachable+session", st)
	}
	if !reflect.DeepEqual(gotExclude, map[int]bool{200: true, 202: true}) {
		t.Errorf("exclude = %v, want the pane-tree pid set {200, 202}", gotExclude)
	}
	want := Status{
		ID: "host", Enabled: true, Backend: "Xtigervnc", Reachable: true,
		Display: ":10", Width: 1920, Height: 1080, Viewers: 2, Session: true,
		Apps:          []App{{Name: "chromium", Count: 3}},
		UptimeSeconds: 4*3600 + 12*60,
	}
	if st.Socket == "" {
		t.Error("socket empty, want the state-dir host.sock path")
	}
	st.Socket = "" // path shape is state-dir-dependent; asserted non-empty above
	if !reflect.DeepEqual(st, want) {
		t.Errorf("status = %+v, want %+v", st, want)
	}
}

func TestAssemblePanePidsUnavailableExcludesNothing(t *testing.T) {
	d := assembleDeps(t)
	d.PanePids = func(context.Context) map[int]bool { return nil }
	var gotExclude map[int]bool
	var sawExclude bool
	d.RunningApps = func(_ string, exclude map[int]bool) ([]App, error) {
		gotExclude, sawExclude = exclude, true
		return nil, nil
	}

	Assemble(context.Background(), d)
	if !sawExclude || gotExclude != nil {
		t.Errorf("exclude = %v (called %v), want a nil set — same as no exclusion", gotExclude, sawExclude)
	}
}

func TestAssembleBackendExitedReason(t *testing.T) {
	d := assembleDeps(t)
	d.Probe = func(context.Context, string, string) (Info, error) {
		return Info{Reason: "not running"}, nil
	}
	d.RunningApps = func(string, map[int]bool) ([]App, error) {
		t.Error("RunningApps called while unreachable — the apps scan is gated on reachability")
		return nil, nil
	}

	st := Assemble(context.Background(), d)
	if st.Reason != BackendExitedReason("Xtigervnc") {
		t.Errorf("reason = %q, want %q", st.Reason, BackendExitedReason("Xtigervnc"))
	}
	if len(st.Apps) != 0 {
		t.Errorf("apps = %v, want empty while unreachable", st.Apps)
	}
}

func TestAssembleNoBackendReason(t *testing.T) {
	d := assembleDeps(t)
	d.Probe = func(context.Context, string, string) (Info, error) {
		return Info{Reason: "not running"}, nil
	}
	d.LookPath = func(name string) (string, error) { return "", errors.New("not found: " + name) }

	st := Assemble(context.Background(), d)
	if st.Reason != NoBackendReason {
		t.Errorf("reason = %q, want %q", st.Reason, NoBackendReason)
	}
}

func TestAssembleDarwinScreenSharingReason(t *testing.T) {
	defer func(saved string) { goos = saved }(goos)
	goos = "darwin"
	d := assembleDeps(t)
	d.SessionOptions = func(context.Context) (string, string, bool) { return "", MacBackend, true }
	d.Probe = func(context.Context, string, string) (Info, error) {
		return Info{Reason: "dial failed"}, nil
	}

	st := Assemble(context.Background(), d)
	if st.Reason != ScreenSharingOffReason {
		t.Errorf("reason = %q, want %q", st.Reason, ScreenSharingOffReason)
	}
}

func TestAssembleProbeErrorLeavesUnreachable(t *testing.T) {
	d := assembleDeps(t)
	d.Probe = func(context.Context, string, string) (Info, error) {
		return Info{}, errors.New("dial refused")
	}

	st := Assemble(context.Background(), d)
	if st.Reachable || st.Reason != BackendExitedReason("Xtigervnc") {
		t.Errorf("status = %+v, want unreachable with the backend-exited reason", st)
	}
}
