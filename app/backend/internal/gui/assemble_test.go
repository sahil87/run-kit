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
		ID:       "host",
		Enabled:  true,
		Geometry: "1600x900",
		DaemonRunning: func() bool {
			return true
		},
		SessionExists:  func(context.Context) bool { return true },
		SessionOptions: func(context.Context) (string, string, string, bool) { return ":10", "Xtigervnc", "", true },
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
	if st.Enabled || st.Session || st.Reachable || st.Reason != "" || len(st.Apps) != 0 || st.Geometry != "" {
		t.Errorf("status = %+v, want everything off/empty with no reason and no geometry", st)
	}
	if st.Apps == nil {
		t.Error("Apps = nil, want the non-nil empty slice (JSON [] never null)")
	}
}

func TestAssembleDisabledCarriesWMCandidates(t *testing.T) {
	defer func(saved string) { goos = saved }(goos)
	goos = "linux"
	d := assembleDeps(t)
	d.Enabled = false
	d.LookPath = stubLookPath("icewm-session", "startlxqt")

	st := Assemble(context.Background(), d)
	want := []WMCandidate{
		{Name: "icewm-session", Label: "IceWM", Kind: "wm", Installed: true},
		{Name: "startlxqt", Label: "LXQt", Kind: "session", Installed: true},
		{Name: "startxfce4", Label: "XFCE", Kind: "session", Hint: "install xfce4 with your package manager"},
		{Name: "startplasma-x11", Label: "Plasma", Kind: "session", Hint: "install plasma with your package manager"},
		{Name: "startlxde", Label: "LXDE", Kind: "session", Hint: "install lxde with your package manager"},
		{Name: "mate-session", Label: "MATE", Kind: "session", Hint: "install mate with your package manager"},
		{Name: "cinnamon-session", Label: "Cinnamon", Kind: "session", Hint: "install cinnamon with your package manager"},
	}
	if !reflect.DeepEqual(st.WMCandidates, want) {
		t.Errorf("disabled WMCandidates = %+v, want %+v (PATH-only derivation precedes the short-circuit)", st.WMCandidates, want)
	}
}

// The disabled document lists every known desktop with its install line when
// nothing resolves — the picker shows choices, not inventory.
func TestAssembleMissingDesktopsCarryHints(t *testing.T) {
	defer func(saved string) { goos = saved }(goos)
	goos = "linux"
	d := assembleDeps(t)
	d.LookPath = stubLookPath("apt-get")

	st := Assemble(context.Background(), d)
	if len(st.WMCandidates) != 7 {
		t.Fatalf("WMCandidates = %+v, want seven missing rows (IceWM + six DEs)", st.WMCandidates)
	}
	if st.WMCandidates[0].Name != "icewm-session" || st.WMCandidates[0].Kind != "wm" {
		t.Errorf("first missing row = %+v, want the IceWM ladder head (kind wm)", st.WMCandidates[0])
	}
	for _, c := range st.WMCandidates {
		if c.Installed || c.Hint == "" {
			t.Errorf("row %+v, want installed:false with a non-empty hint", c)
		}
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
		Geometry:      "1600x900",
		Apps:          []App{{Name: "chromium", Count: 3}},
		UptimeSeconds: 4*3600 + 12*60,
		// wm "" on a reachable display carries the install hint; the
		// resolve-everything LookPath stub detects apt.
		WMHint: "sudo apt install --no-install-recommends icewm",
		WMCandidates: []WMCandidate{
			{Name: "icewm-session", Label: "IceWM", Kind: "wm", Installed: true},
			{Name: "openbox", Label: "openbox", Kind: "wm", Installed: true},
			{Name: "xfwm4", Label: "xfwm4", Kind: "wm", Installed: true},
			{Name: "i3", Label: "i3", Kind: "wm", Installed: true},
			{Name: "kwin_x11", Label: "kwin_x11", Kind: "wm", Installed: true},
			{Name: "x-session-manager", Label: "x-session-manager", Kind: "session", Installed: true},
			{Name: "startlxqt", Label: "LXQt", Kind: "session", Installed: true},
			{Name: "startxfce4", Label: "XFCE", Kind: "session", Installed: true},
			{Name: "startplasma-x11", Label: "Plasma", Kind: "session", Installed: true},
			{Name: "startlxde", Label: "LXDE", Kind: "session", Installed: true},
			{Name: "mate-session", Label: "MATE", Kind: "session", Installed: true},
			{Name: "cinnamon-session", Label: "Cinnamon", Kind: "session", Installed: true},
		},
	}
	if st.Socket == "" {
		t.Error("socket empty, want the state-dir host.sock path")
	}
	st.Socket = "" // path shape is state-dir-dependent; asserted non-empty above
	if !reflect.DeepEqual(st, want) {
		t.Errorf("status = %+v, want %+v", st, want)
	}
}

func TestAssembleWMStampedCarriesNoHint(t *testing.T) {
	d := assembleDeps(t)
	d.SessionOptions = func(context.Context) (string, string, string, bool) {
		return ":10", "Xtigervnc", "icewm-session", true
	}

	st := Assemble(context.Background(), d)
	if st.WM != "icewm-session" {
		t.Errorf("WM = %q, want icewm-session (the stamped value)", st.WM)
	}
	if st.WMHint != "" {
		t.Errorf("WMHint = %q with a WM stamped, want empty", st.WMHint)
	}
}

func TestAssembleReachableBareCarriesTheWMHint(t *testing.T) {
	d := assembleDeps(t)
	d.LookPath = stubLookPath("apt-get")

	st := Assemble(context.Background(), d)
	if !st.Reachable {
		t.Fatalf("status = %+v, want reachable", st)
	}
	if st.WM != "" {
		t.Errorf("WM = %q, want empty (nothing stamped)", st.WM)
	}
	if want := "sudo apt install --no-install-recommends icewm"; st.WMHint != want {
		t.Errorf("WMHint = %q, want %q", st.WMHint, want)
	}
}

func TestAssembleUnreachableCarriesNoWMHint(t *testing.T) {
	d := assembleDeps(t)
	d.LookPath = stubLookPath("apt-get")
	d.Probe = func(context.Context, string, string) (Info, error) {
		return Info{Reason: "not running"}, nil
	}

	st := Assemble(context.Background(), d)
	if st.Reachable {
		t.Fatalf("status = %+v, want unreachable", st)
	}
	if st.WMHint != "" {
		t.Errorf("WMHint = %q while unreachable, want empty (the reason carries the backend hint)", st.WMHint)
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
	if want := NoBackendReason(d.LookPath); st.Reason != want {
		t.Errorf("reason = %q, want %q", st.Reason, want)
	}
}

func TestAssembleDarwinScreenSharingReason(t *testing.T) {
	defer func(saved string) { goos = saved }(goos)
	goos = "darwin"
	d := assembleDeps(t)
	d.SessionOptions = func(context.Context) (string, string, string, bool) { return "", MacBackend, "", true }
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

func TestAssembleDarwinOmitsUnixSocket(t *testing.T) {
	defer func(saved string) { goos = saved }(goos)
	goos = "darwin"
	d := assembleDeps(t)
	st := Assemble(context.Background(), d)
	if st.Socket != "" {
		t.Errorf("Socket = %q on darwin, want empty — the tcp backend has no host.sock", st.Socket)
	}
}

func TestAssembleLinuxNamesUnixSocket(t *testing.T) {
	defer func(saved string) { goos = saved }(goos)
	goos = "linux"
	d := assembleDeps(t)
	st := Assemble(context.Background(), d)
	want, err := SocketPath("host")
	if err != nil {
		t.Fatalf("SocketPath: %v", err)
	}
	if st.Socket != want {
		t.Errorf("Socket = %q, want %q", st.Socket, want)
	}
}

func TestAssembleReachableBareNilLookPathIsSafe(t *testing.T) {
	d := assembleDeps(t)
	d.LookPath = nil

	st := Assemble(context.Background(), d)
	if !st.Reachable {
		t.Fatalf("status = %+v, want reachable", st)
	}
	if want := "install icewm with your package manager"; st.WMHint != want {
		t.Errorf("WMHint = %q with a nil LookPath, want the generic %q (no probe, no panic)", st.WMHint, want)
	}
}

// Geometry is a pass-through of the gui.geometry setting when enabled:
// "auto" rides the document verbatim like a fixed WxH.
func TestAssembleGeometryPassthrough(t *testing.T) {
	d := assembleDeps(t)
	d.Geometry = GeometryAuto

	st := Assemble(context.Background(), d)
	if st.Geometry != GeometryAuto {
		t.Errorf("Geometry = %q, want %q (auto is a document value, not resolved here)", st.Geometry, GeometryAuto)
	}
}

func TestAssembleLockedFromThePin(t *testing.T) {
	d := assembleDeps(t)
	d.Locked = func(context.Context) bool { return true }

	st := Assemble(context.Background(), d)
	if !st.Locked {
		t.Error("Locked = false, want true when the pin dep reports locked")
	}
}

// The pin is a session-scoped tmux option: no session, no read.
func TestAssembleLockedGatedOnSession(t *testing.T) {
	d := assembleDeps(t)
	d.SessionExists = func(context.Context) bool { return false }
	d.Locked = func(context.Context) bool {
		t.Error("Locked consulted with no rk-gui session")
		return true
	}

	st := Assemble(context.Background(), d)
	if st.Locked {
		t.Error("Locked = true with no session")
	}
}

func TestAssembleHumanInputAgoMS(t *testing.T) {
	d := assembleDeps(t)
	now := d.Now()
	d.HumanInputAt = func() (time.Time, bool) { return now.Add(-1200 * time.Millisecond), true }

	st := Assemble(context.Background(), d)
	if st.HumanInputAgoMS != 1200 {
		t.Errorf("HumanInputAgoMS = %d, want 1200", st.HumanInputAgoMS)
	}

	// No timestamp seen (or the daemon restarted — the map is in-memory):
	// the field stays zero so omitempty drops it from the document.
	d.HumanInputAt = func() (time.Time, bool) { return time.Time{}, false }
	if st := Assemble(context.Background(), d); st.HumanInputAgoMS != 0 {
		t.Errorf("HumanInputAgoMS = %d with no timestamp, want 0 (omitted)", st.HumanInputAgoMS)
	}

	// The CLI wires no hub reader — nil must omit the field, not panic.
	d.HumanInputAt = nil
	if st := Assemble(context.Background(), d); st.HumanInputAgoMS != 0 {
		t.Errorf("HumanInputAgoMS = %d with a nil dep, want 0 (omitted)", st.HumanInputAgoMS)
	}
}

// The ≥ 1 ms clamp keeps "absent" (field omitted) and "just now"
// distinguishable — omitempty would drop a 0.
func TestHumanInputAgoMSClamp(t *testing.T) {
	now := time.Unix(1_000_000, 0)
	if got := HumanInputAgoMS(now, now); got != 1 {
		t.Errorf("HumanInputAgoMS(now, now) = %d, want 1", got)
	}
	if got := HumanInputAgoMS(now.Add(-1500*time.Millisecond), now); got != 1500 {
		t.Errorf("HumanInputAgoMS(-1500ms) = %d, want 1500", got)
	}
}
