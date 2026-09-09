package cron

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"
)

func TestFingerprintDeterministic(t *testing.T) {
	a := map[string]string{"%1": "idle", "%2": "active", "%9": "waiting"}
	b := map[string]string{"%9": "waiting", "%1": "idle", "%2": "active"}
	if Fingerprint(a) != Fingerprint(b) {
		t.Errorf("fingerprint depends on map order: %q vs %q", Fingerprint(a), Fingerprint(b))
	}
	c := map[string]string{"%1": "idle", "%2": "active", "%9": "idle"}
	if Fingerprint(a) == Fingerprint(c) {
		t.Error("different states fingerprinted equal")
	}
	// Unknown states are excluded.
	d := map[string]string{"%1": "idle", "%2": "active", "%9": "waiting", "%3": ""}
	if Fingerprint(a) != Fingerprint(d) {
		t.Error("empty state should not affect the fingerprint")
	}
	if Fingerprint(nil) != "" {
		t.Error("nil map should fingerprint empty")
	}
}

func TestParseFingerprintRoundTrip(t *testing.T) {
	m := map[string]string{"%1": "idle", "%2": "active", "%9": "waiting"}
	if got := parseFingerprint(Fingerprint(m)); !reflect.DeepEqual(got, m) {
		t.Errorf("round trip = %v, want %v", got, m)
	}
	if got := parseFingerprint(""); len(got) != 0 {
		t.Errorf("empty fingerprint parsed to %v", got)
	}
	// Garbage lines (an opaque legacy value) degrade to "no panes".
	if got := parseFingerprint("F2\n=idle\n%3=\n"); len(got) != 0 {
		t.Errorf("garbage parsed to %v", got)
	}
}

func TestFingerprintExcluding(t *testing.T) {
	m := map[string]string{"%1": "idle", "%2": "active"}
	if got, want := fingerprintExcluding(m, "%1"), "%2=active\n"; got != want {
		t.Errorf("excluding %%1 = %q, want %q", got, want)
	}
	if got := fingerprintExcluding(m, ""); got != Fingerprint(m) {
		t.Errorf("empty pane should exclude nothing, got %q", got)
	}
	if got := fingerprintExcluding(m, "%7"); got != Fingerprint(m) {
		t.Errorf("absent pane should exclude nothing, got %q", got)
	}
	if len(m) != 2 {
		t.Errorf("input map mutated: %v", m)
	}
}

// TestClassifyDiff pins the transition matrix: `→ waiting`, `→ idle`, and a
// vanished pane are actionable; `→ active` (existing or newly appeared) is
// not; an unknown state fails open.
func TestClassifyDiff(t *testing.T) {
	fp := Fingerprint
	cases := []struct {
		name string
		prev map[string]string
		cur  map[string]string
		want bool
	}{
		{"active→idle", map[string]string{"%5": "active"}, map[string]string{"%5": "idle"}, true},
		{"active→waiting", map[string]string{"%5": "active"}, map[string]string{"%5": "waiting"}, true},
		{"idle→waiting", map[string]string{"%5": "idle"}, map[string]string{"%5": "waiting"}, true},
		{"waiting→idle", map[string]string{"%5": "waiting"}, map[string]string{"%5": "idle"}, true},
		{"idle→active", map[string]string{"%5": "idle"}, map[string]string{"%5": "active"}, false},
		{"waiting→active", map[string]string{"%5": "waiting"}, map[string]string{"%5": "active"}, false},
		{"pane appears active", map[string]string{"%5": "active"}, map[string]string{"%5": "active", "%9": "active"}, false},
		{"pane appears idle", map[string]string{"%5": "active"}, map[string]string{"%5": "active", "%9": "idle"}, true},
		{"pane vanishes", map[string]string{"%5": "active", "%9": "idle"}, map[string]string{"%5": "active"}, true},
		{"unknown state fails open", map[string]string{"%5": "active"}, map[string]string{"%5": "stalled"}, true},
		{"mixed: one ignored, one actionable", map[string]string{"%5": "idle", "%6": "active"}, map[string]string{"%5": "active", "%6": "idle"}, true},
		{"unchanged", map[string]string{"%5": "idle"}, map[string]string{"%5": "idle"}, false},
	}
	for _, c := range cases {
		if got := classifyDiff(fp(c.prev), fp(c.cur)); got != c.want {
			t.Errorf("%s: classifyDiff = %v, want %v", c.name, got, c.want)
		}
	}
}

func TestWakeEdge(t *testing.T) {
	T := backoffBase
	debounce := 60 * time.Second
	none := time.Time{}
	workerActive := Fingerprint(map[string]string{"%5": "active"})
	workerIdle := Fingerprint(map[string]string{"%5": "idle"})
	workerWaiting := Fingerprint(map[string]string{"%5": "waiting"})

	// Cold start: no observation ⇒ no edge, fresh seeded observation.
	edge, next, diag := wakeEdge(debounce, workerIdle, WakeObservation{}, false, none, false, T)
	if edge || diag != "wake-cold-start" {
		t.Errorf("cold start: edge=%v diag=%q", edge, diag)
	}
	if next.Fingerprint != workerIdle || next.ObservedAt != T.Unix() {
		t.Errorf("cold start seeded %+v", next)
	}

	// No change ⇒ no edge, observation kept.
	obs := WakeObservation{Fingerprint: workerActive, ObservedAt: T.Unix()}
	edge, next, diag = wakeEdge(debounce, workerActive, obs, true, none, false, T.Add(time.Hour))
	if edge || diag != "" || next != obs {
		t.Errorf("no-change: edge=%v diag=%q next=%+v", edge, diag, next)
	}

	// Actionable change with no own delivery ever ⇒ fires, cursor advances.
	now := T.Add(time.Minute)
	edge, next, diag = wakeEdge(debounce, workerIdle, obs, true, none, false, now)
	if !edge || diag != "" {
		t.Errorf("no-delivery change: edge=%v diag=%q, want fire", edge, diag)
	}
	if next.Fingerprint != workerIdle || next.ObservedAt != now.Unix() {
		t.Errorf("post-fire observation %+v", next)
	}

	// Actionable change 20s after an own delivery ⇒ HOLD: no fire, OLD
	// observation kept so the edge stays pending.
	edge, next, diag = wakeEdge(debounce, workerIdle, obs, true, T, true, T.Add(20*time.Second))
	if edge || diag != "wake-debounced" || next != obs {
		t.Errorf("held change: edge=%v diag=%q next=%+v, want held", edge, diag, next)
	}
	// The same edge 70s after the delivery fires.
	edge, next, _ = wakeEdge(debounce, workerIdle, obs, true, T, true, T.Add(70*time.Second))
	if !edge || next.Fingerprint != workerIdle {
		t.Errorf("post-hold: edge=%v next=%+v, want fire", edge, next)
	}
	// A burst while held still coalesces: the pending edge fires once with
	// the latest fingerprint.
	edge, next, _ = wakeEdge(debounce, workerWaiting, obs, true, T, true, T.Add(61*time.Second))
	if !edge || next.Fingerprint != workerWaiting {
		t.Errorf("burst coalesce: edge=%v next=%+v, want one fire with latest fp", edge, next)
	}

	// Ignored transition (→ active): no fire, cursor ADVANCES — even inside
	// the hold window.
	idleObs := WakeObservation{Fingerprint: workerIdle, ObservedAt: T.Unix()}
	edge, next, diag = wakeEdge(debounce, workerActive, idleObs, true, T, true, T.Add(5*time.Second))
	if edge || diag != "wake-ignored-transition" {
		t.Errorf("ignored: edge=%v diag=%q", edge, diag)
	}
	if next.Fingerprint != workerActive || next.ObservedAt != T.Add(5*time.Second).Unix() {
		t.Errorf("ignored transition should advance the cursor, got %+v", next)
	}

	// Zero debounce fires immediately after a delivery.
	edge, _, _ = wakeEdge(0, workerIdle, obs, true, T, true, T.Add(time.Nanosecond))
	if !edge {
		t.Error("zero debounce should fire on any actionable edge")
	}
}

// TestWakeEdgeReplay replays the 2026-09-10 01:05–01:07 runKit poll sequence
// through Evaluate: the operator %683 (the entry's target) flipping idle↔active
// never fires; a worker %690 appearing idle and %685 completing (→ idle) do; a
// worker starting (→ active) does not. Deliveries are far enough back that
// the hold never engages — the self-exclusion alone must stop the loop.
func TestWakeEdgeReplay(t *testing.T) {
	T := backoffBase
	entry := Entry{
		ID:       "9de2",
		Schedule: Schedule{Kind: ScheduleEvery, Interval: Duration{24 * time.Hour}},
		WakeOn:   &WakeOn{Event: WakeAgentStateChange, Scope: WakeScopeServer, Debounce: Duration{60 * time.Second}},
		Target:   Target{Kind: TargetRole, Role: RoleOperator},
		Payload:  "operator tick",
		CreatedBy: CreatedBy{
			At: T.Unix(),
		},
	}
	facts := map[string]TargetFacts{"9de2": {PaneID: "%683", AgentState: "idle", StateEpoch: T.Unix()}}
	polls := []struct {
		name   string
		states map[string]string
		fire   bool
	}{
		{"seed", map[string]string{"%683": "idle", "%685": "active"}, false},
		{"operator goes active after a tick", map[string]string{"%683": "active", "%685": "active"}, false},
		{"operator back to idle", map[string]string{"%683": "idle", "%685": "active"}, false},
		{"%690 appears idle", map[string]string{"%683": "idle", "%685": "active", "%690": "idle"}, true},
		{"%690 starts working", map[string]string{"%683": "active", "%685": "active", "%690": "active"}, false},
		{"%685 completes", map[string]string{"%683": "idle", "%685": "idle", "%690": "active"}, true},
		{"operator flips only", map[string]string{"%683": "active", "%685": "idle", "%690": "active"}, false},
	}
	cursor := WakeCursor{}
	now := T.Add(time.Hour)
	for _, p := range polls {
		now = now.Add(30 * time.Second)
		res := Evaluate(EvalInput{
			Server: "runKit", Now: now, Entries: []Entry{entry}, Facts: facts,
			States: p.states, Cursor: cursor,
		})
		fired := len(res.Fires) == 1 && res.Fires[0].Reason == FireWake
		if fired != p.fire {
			t.Errorf("%s: fired=%v, want %v (diags %v)", p.name, fired, p.fire, diagReasons(res.Diags))
		}
		cursor = res.NextCursor
	}
}

func TestWakeCursorRoundTrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "dev.cursor.yaml")
	if _, ok := ReadWakeCursor(path); ok {
		t.Error("absent cursor should read as cold start")
	}
	in := WakeCursor{Entries: map[string]WakeObservation{
		"a3f9": {Fingerprint: "F1", ObservedAt: 1700000000},
	}}
	if err := WriteWakeCursor(path, in); err != nil {
		t.Fatal(err)
	}
	out, ok := ReadWakeCursor(path)
	if !ok || out.Entries["a3f9"] != in.Entries["a3f9"] {
		t.Errorf("round trip = %+v, %v", out, ok)
	}
	st, _ := os.Stat(path)
	if st.Mode().Perm() != fileMode {
		t.Errorf("mode = %o, want %o", st.Mode().Perm(), fileMode)
	}
}

// TestWakeCursorCorrupt: a corrupt cursor degrades to a cold start, never an
// error (A-018).
func TestWakeCursorCorrupt(t *testing.T) {
	path := filepath.Join(t.TempDir(), "dev.cursor.yaml")
	if err := os.WriteFile(path, []byte("{{{{"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, ok := ReadWakeCursor(path); ok {
		t.Error("corrupt cursor should read as cold start")
	}
	// An empty/garbage-but-parseable file with no entries is also a cold start.
	if err := os.WriteFile(path, []byte("entries: {}\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, ok := ReadWakeCursor(path); ok {
		t.Error("entryless cursor should read as cold start")
	}
}
