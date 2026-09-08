package cron

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"rk/internal/tmux"
)

// gcEntryYAML renders one due every-1h entry with the given inline target,
// optional extra flag lines (pinned/muted), and created_by.at.
func gcEntryYAML(target, flags string, createdAt int64) string {
	return fmt.Sprintf(`
entries:
  - id: a3f9
    name: sweep
    schedule: { kind: every, interval: 1h }
    target: { %s }
    payload: "sweep"
%s
    created_by: { session: s, pane: "%%42", at: %d }
`, target, flags, createdAt)
}

// gcRig is the live1 rig where no target resolves: one window with no panes,
// no agent-session carrier, no role carrier, no live pane.
func gcRig(t *testing.T, dir string, entryYAML string) *fakeTmux {
	t.Helper()
	writeEntryFile(t, dir, "live1", entryYAML)
	fk := newFakeTmux()
	fk.sessions["live1"] = []tmux.SessionInfo{{Name: "work"}}
	fk.windows["live1"] = map[string][]tmux.WindowInfo{"work": {{WindowID: "@5"}}}
	return fk
}

func gcEntryPresent(t *testing.T, dir string) bool {
	t.Helper()
	entries, diags := LoadEntries(filepath.Join(dir, "live1.yaml"))
	if len(diags) != 0 {
		t.Fatalf("load diags = %v", diagReasons(diags))
	}
	for _, e := range entries {
		if e.ID == "a3f9" {
			return true
		}
	}
	return false
}

func hasOutcome(lines []LogLine, outcome string) bool {
	for _, l := range lines {
		if l.Outcome == outcome {
			return true
		}
	}
	return false
}

// TestTickOrphanGC is the R5 truth table over one never-resolved entry created
// `age` ago (no prior log lines — orphaned-since falls back to created_by.at):
// pinned exempt, muted expires, role never subject, pane kind expires,
// under-TTL survives.
func TestTickOrphanGC(t *testing.T) {
	over := OrphanTTL + 24*time.Hour
	under := OrphanTTL - 24*time.Hour
	cases := []struct {
		name        string
		target      string
		flags       string
		age         time.Duration
		wantExpired bool
	}{
		{"session over TTL expires", "kind: session, session: dead", "", over, true},
		{"pinned session survives", "kind: session, session: dead", "    pinned: true", over, false},
		{"muted session expires", "kind: session, session: dead", "    muted: true", over, true},
		{"role never subject", "kind: role, role: operator", "", over, false},
		{"dead pane expires", `kind: pane, pane: "%99"`, "", over, true},
		{"session under TTL survives", "kind: session, session: dead", "", under, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			T := backoffBase
			fk := gcRig(t, dir, gcEntryYAML(tc.target, tc.flags, T.Add(-tc.age).Unix()))
			tickOnce(t, dir, T, fk, &fakeDeliverer{})

			if got := gcEntryPresent(t, dir); got == tc.wantExpired {
				t.Fatalf("entry present = %v, want expired=%v", got, tc.wantExpired)
			}
			lines := ReadLog(filepath.Join(dir, "live1.log"))
			if got := hasOutcome(lines, "expired-orphan"); got != tc.wantExpired {
				t.Errorf("expired-orphan line present = %v, want %v (log = %+v)", got, tc.wantExpired, lines)
			}
		})
	}
}

// TestTickOrphanGCExpiryShape: the expiry removes the entry via the Remove
// path and appends exactly one expired-orphan line naming the entry — the
// audit trail, never silent.
func TestTickOrphanGCExpiryShape(t *testing.T) {
	dir := t.TempDir()
	T := backoffBase
	fk := gcRig(t, dir, gcEntryYAML("kind: session, session: dead", "", T.Add(-(OrphanTTL+24*time.Hour)).Unix()))
	res := tickOnce(t, dir, T, fk, &fakeDeliverer{})

	if gcEntryPresent(t, dir) {
		t.Fatal("entry still present after expiry")
	}
	lines := ReadLog(filepath.Join(dir, "live1.log"))
	var exp []LogLine
	for _, l := range lines {
		if l.Outcome == "expired-orphan" {
			exp = append(exp, l)
		}
	}
	if len(exp) != 1 {
		t.Fatalf("expired-orphan lines = %+v, want exactly one", exp)
	}
	if exp[0].Entry != "a3f9" || exp[0].TS != T.Unix() {
		t.Errorf("expired-orphan line = %+v, want entry a3f9 at tick time", exp[0])
	}
	// The due-but-absent disposition line also landed before expiry removed
	// the entry (GC runs after the dispositions).
	if !hasOutcome(lines, "skipped-absent") {
		t.Errorf("log = %+v, want the tick's skipped-absent line alongside the expiry", lines)
	}
	if res.Fires != 2 {
		t.Errorf("fires = %d, want 2 (the absent disposition and the expiry each log a line)", res.Fires)
	}
}

// TestTickOrphanGCResolvedThisTickSurvives: an entry whose target resolves in
// this tick's facts is never expired, even with a log-history absent streak
// older than the TTL.
func TestTickOrphanGCResolvedThisTickSurvives(t *testing.T) {
	dir := t.TempDir()
	T := backoffBase
	writeEntryFile(t, dir, "live1", gcEntryYAML("kind: session, session: sess-1", "", T.Add(-(OrphanTTL+24*time.Hour)).Unix()))
	fk := newFakeTmux()
	fk.sessions["live1"] = []tmux.SessionInfo{{Name: "work"}}
	fk.windows["live1"] = map[string][]tmux.WindowInfo{"work": {{
		WindowID: "@5",
		Panes:    []tmux.PaneInfo{{PaneID: "%10", AgentState: tmux.AgentStateIdle, AgentSessionRef: "sess-1"}},
	}}}
	fk.panes["live1"] = map[string]tmux.PaneFacts{"%10": {AgentState: tmux.AgentStateIdle, AgentStateEpoch: T.Unix()}}
	// A continuous absent streak older than the TTL — history alone would
	// expire the entry.
	seedLog(t, filepath.Join(dir, "live1.log"), 3, "a3f9", "", "skipped-absent", T.Add(-(OrphanTTL + time.Hour)).Unix())

	del := &fakeDeliverer{}
	tickOnce(t, dir, T, fk, del)
	if len(del.fires) != 1 {
		t.Errorf("deliverer got %d fires, want 1 (the target resolved this tick)", len(del.fires))
	}
	if !gcEntryPresent(t, dir) {
		t.Error("entry expired despite resolving this tick")
	}
	if lines := ReadLog(filepath.Join(dir, "live1.log")); hasOutcome(lines, "expired-orphan") {
		t.Errorf("log = %+v, want no expired-orphan line", lines)
	}
}

// TestTickOrphanGCDerivedStreak: expiry keys on the derived trailing-run
// start, not created_by.at — a delivered line inside the TTL window bounds
// the streak even for a much older entry, and a streak that reaches the TTL
// expires regardless of entry age.
func TestTickOrphanGCDerivedStreak(t *testing.T) {
	t.Run("recent delivery bounds the streak", func(t *testing.T) {
		dir := t.TempDir()
		T := backoffBase
		// Created 30d ago, but delivered 3d ago: the trailing absent run
		// starts after the delivery — under TTL, survives.
		fk := gcRig(t, dir, gcEntryYAML("kind: session, session: dead", "", T.Add(-30*24*time.Hour).Unix()))
		logPath := filepath.Join(dir, "live1.log")
		seedLog(t, logPath, 1, "a3f9", "%10", "delivered", T.Add(-3*24*time.Hour).Unix())
		seedLog(t, logPath, 2, "a3f9", "", "skipped-absent", T.Add(-2*24*time.Hour).Unix())

		tickOnce(t, dir, T, fk, &fakeDeliverer{})
		if !gcEntryPresent(t, dir) {
			t.Error("entry expired despite a delivered line 3d ago bounding the streak")
		}
	})

	t.Run("streak over TTL expires an old entry", func(t *testing.T) {
		dir := t.TempDir()
		T := backoffBase
		// Created 30d ago, delivered 9d ago, absent ever since: the run's
		// oldest line is over the TTL.
		fk := gcRig(t, dir, gcEntryYAML("kind: session, session: dead", "", T.Add(-30*24*time.Hour).Unix()))
		logPath := filepath.Join(dir, "live1.log")
		seedLog(t, logPath, 1, "a3f9", "%10", "delivered", T.Add(-9*24*time.Hour).Unix())
		seedLog(t, logPath, 2, "a3f9", "", "skipped-absent", T.Add(-(OrphanTTL + time.Hour)).Unix())

		tickOnce(t, dir, T, fk, &fakeDeliverer{})
		if gcEntryPresent(t, dir) {
			t.Error("entry survived despite a trailing absent run older than the TTL")
		}
		if lines := ReadLog(logPath); !hasOutcome(lines, "expired-orphan") {
			t.Errorf("log = %+v, want the expired-orphan line", lines)
		}
	})
}

// TestTickOrphanGCNeverFiredFallback: a never-fired entry (no log lines)
// expires off the created_by.at fallback — the disposition's just-appended
// absent line must not reset the streak to now (the GC pass derives from the
// pre-disposition log).
func TestTickOrphanGCNeverFiredFallback(t *testing.T) {
	dir := t.TempDir()
	T := backoffBase
	fk := gcRig(t, dir, gcEntryYAML("kind: session, session: dead", "", T.Add(-(OrphanTTL+time.Hour)).Unix()))
	tickOnce(t, dir, T, fk, &fakeDeliverer{})
	if gcEntryPresent(t, dir) {
		t.Error("never-fired entry survived past the TTL — the created_by.at fallback did not hold")
	}
	if lines := ReadLog(filepath.Join(dir, "live1.log")); !hasOutcome(lines, "expired-orphan") {
		t.Errorf("log = %+v, want the expired-orphan line", lines)
	}
}

// TestTickOrphanGCRespawnedThisTickSurvives: a successful same-tick respawn is
// resolution the pre-disposition facts and gcLog cannot see — the entry MUST
// survive the GC pass (expiring it would delete the intent right after
// reviving its agent). A failed respawn is absent-class and still expires.
func TestTickOrphanGCRespawnedThisTickSurvives(t *testing.T) {
	cases := []struct {
		name        string
		outcome     Outcome
		wantExpired bool
	}{
		{"respawned survives", Outcome{Status: "respawned"}, false},
		{"respawn-failed expires", Outcome{Status: "respawn-failed", Detail: "no ring record"}, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			T := backoffBase
			fk := gcRig(t, dir, gcEntryYAML("kind: session, session: dead", "    if_absent: respawn", T.Add(-(OrphanTTL+24*time.Hour)).Unix()))
			tickOnceS(t, dir, T, fk, func(context.Context, string, string, string) error { return nil },
				func(context.Context, Fire) Outcome { return tc.outcome })

			if got := gcEntryPresent(t, dir); got == tc.wantExpired {
				t.Fatalf("entry present = %v, want expired=%v", got, tc.wantExpired)
			}
			lines := ReadLog(filepath.Join(dir, "live1.log"))
			if got := hasOutcome(lines, "expired-orphan"); got != tc.wantExpired {
				t.Errorf("expired-orphan line present = %v, want %v (log = %+v)", got, tc.wantExpired, lines)
			}
		})
	}
}

// TestTickOrphanGCDeadServerUntouched: an orphan entry on a dead server is
// never expired — GC inherits the tick's live-server filter.
func TestTickOrphanGCDeadServerUntouched(t *testing.T) {
	dir := t.TempDir()
	T := backoffBase
	writeEntryFile(t, dir, "dead1", gcEntryYAML("kind: session, session: dead", "", T.Add(-(OrphanTTL+24*time.Hour)).Unix()))

	res, err := Tick(context.Background(), Deps{
		Dir: dir,
		Now: func() time.Time { return T },
		ListServers: func(ctx context.Context) ([]string, error) {
			return []string{}, nil // no live servers
		},
		Tmux:      newFakeTmux(),
		Deliverer: &fakeDeliverer{},
		OperatorStatePath: func(slug string) (string, error) {
			return filepath.Join(t.TempDir(), slug+".yaml"), nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if res.Servers != 0 {
		t.Errorf("servers = %d, want 0 (no live servers swept)", res.Servers)
	}
	entries, diags := LoadEntries(filepath.Join(dir, "dead1.yaml"))
	if len(diags) != 0 || len(entries) != 1 {
		t.Errorf("dead-server entries = %+v diags = %v, want the entry untouched", entries, diagReasons(diags))
	}
	if _, err := os.Stat(filepath.Join(dir, "dead1.log")); err == nil {
		t.Error("a log file was written for a dead server")
	}
}
