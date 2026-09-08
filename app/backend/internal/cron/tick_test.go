package cron

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"rk/internal/tmux"
)

// fakeDeliverer records every delivered fire.
type fakeDeliverer struct {
	fires []Fire
}

func (f *fakeDeliverer) Deliver(ctx context.Context, fire Fire) Outcome {
	f.fires = append(f.fires, fire)
	return Outcome{Status: "delivered"}
}

// writeEntryFile writes an entries file for slug into dir.
func writeEntryFile(t *testing.T, dir, slug, body string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, slug+".yaml"), []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
}

const tickEntryYAML = `
entries:
  - id: a3f9
    name: hourly sweep
    schedule: { kind: every, interval: 1h }
    target: { kind: pane, pane: "%%42" }
    payload: "sweep"
    deliver: immediate
    if_absent: skip
    created_by: { session: 4fe2, pane: "%%42", at: %d }
`

// TestTickDeadServerUntouched is the A-016 pin: entry files exist for live1
// and dead1, only live1 enumerates, and the tick issues ZERO tmux commands for
// dead1 — the seam fake fails the test if any call targets it.
func TestTickDeadServerUntouched(t *testing.T) {
	dir := t.TempDir()
	T := backoffBase
	writeEntryFile(t, dir, "live1", sprintfTick(T))
	writeEntryFile(t, dir, "dead1", sprintfTick(T))

	fk := newFakeTmux()
	fk.sessions["live1"] = []tmux.SessionInfo{{Name: "work"}}
	fk.windows["live1"] = map[string][]tmux.WindowInfo{"work": {{WindowID: "@5"}}}
	fk.alive["live1"] = map[string]bool{"%42": true}
	fk.panes["live1"] = map[string]tmux.PaneFacts{"%42": {AgentState: tmux.AgentStateIdle, AgentStateEpoch: T.Unix()}}

	del := &fakeDeliverer{}
	res, err := Tick(context.Background(), Deps{
		Dir: dir,
		Now: func() time.Time { return T },
		ListServers: func(ctx context.Context) ([]string, error) {
			return []string{"live1"}, nil
		},
		Tmux:      fk,
		Deliverer: del,
		OperatorStatePath: func(slug string) (string, error) {
			return filepath.Join(t.TempDir(), slug+".yaml"), nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if fk.callsFor("dead1") != 0 {
		t.Fatalf("tmux calls targeted dead1: %v — a dead socket must never be touched", fk.calls)
	}
	if fk.callsFor("live1") == 0 {
		t.Error("no tmux calls for live1 — facts were never gathered")
	}
	if !hasDiag(res.Diags, "server-not-live") {
		t.Errorf("diags = %v, want a server-not-live diagnostic for dead1", diagReasons(res.Diags))
	}
	if res.Fires != 1 {
		t.Fatalf("fires = %d, want 1 (live1's overdue every entry)", res.Fires)
	}
	if res.Servers != 1 {
		t.Errorf("servers = %d, want 1 (only live1 is swept; dead1 is skipped)", res.Servers)
	}
}

func sprintfTick(T time.Time) string {
	return fmt.Sprintf(tickEntryYAML, T.Add(-2*time.Hour).Unix())
}

// heldAwareDeliverer returns a scripted outcome per call.
type heldAwareDeliverer struct {
	outcomes []Outcome
	calls    int
}

func (d *heldAwareDeliverer) Deliver(ctx context.Context, fire Fire) Outcome {
	o := d.outcomes[min(d.calls, len(d.outcomes)-1)]
	d.calls++
	return o
}

// livePaneRig builds the one-live-server/one-due-entry rig shared by the
// delivery-outcome tests: entry a3f9 (every 1h, anchored 2h back) targeting
// the resolved pane %42 on live1.
func livePaneRig(t *testing.T, dir string, T time.Time) *fakeTmux {
	t.Helper()
	writeEntryFile(t, dir, "live1", sprintfTick(T))
	fk := newFakeTmux()
	fk.sessions["live1"] = []tmux.SessionInfo{{Name: "work"}}
	fk.windows["live1"] = map[string][]tmux.WindowInfo{"work": {{WindowID: "@5"}}}
	fk.alive["live1"] = map[string]bool{"%42": true}
	fk.panes["live1"] = map[string]tmux.PaneFacts{"%42": {AgentState: tmux.AgentStateIdle, AgentStateEpoch: T.Unix()}}
	return fk
}

func tickOnce(t *testing.T, dir string, T time.Time, fk *fakeTmux, deliverer Deliverer) TickResult {
	t.Helper()
	res, err := Tick(context.Background(), Deps{
		Dir: dir,
		Now: func() time.Time { return T },
		ListServers: func(ctx context.Context) ([]string, error) {
			return []string{"live1"}, nil
		},
		Tmux:      fk,
		Deliverer: deliverer,
		OperatorStatePath: func(slug string) (string, error) {
			return filepath.Join(t.TempDir(), slug+".yaml"), nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	return res
}

// TestTickHeldOutcomeSkipsLog: a held (when-idle, busy) outcome appends NO log
// line — the `every` anchor is unchanged, so the fire is due again next tick —
// while delivered and failed outcomes append.
func TestTickHeldOutcomeSkipsLog(t *testing.T) {
	dir := t.TempDir()
	T := backoffBase
	fk := livePaneRig(t, dir, T)
	logPath := filepath.Join(dir, "live1.log")

	// Tick 1: the deliverer holds (busy pane).
	del := &heldAwareDeliverer{outcomes: []Outcome{
		{Status: "held-busy", Detail: "active", Held: true},
		{Status: "delivered"},
		{Status: "failed", Detail: "probe"},
	}}
	res := tickOnce(t, dir, T, fk, del)
	if res.Fires != 0 {
		t.Errorf("held tick: fires = %d, want 0 (nothing delivered)", res.Fires)
	}
	if lines := ReadLog(logPath); len(lines) != 0 {
		t.Fatalf("held tick appended %d log lines, want 0 — a held attempt must never advance the anchor", len(lines))
	}
	if !hasDiag(res.Diags, "delivery-held") {
		t.Errorf("held tick: diags = %v, want delivery-held", diagReasons(res.Diags))
	}

	// Tick 2 (one interval later): the same entry is still due — the anchor
	// never moved — and now delivers.
	res = tickOnce(t, dir, T.Add(30*time.Second), fk, del)
	if res.Fires != 1 {
		t.Fatalf("retry tick: fires = %d, want 1 (the held fire re-fired)", res.Fires)
	}
	lines := ReadLog(logPath)
	if len(lines) != 1 || lines[0].Outcome != "delivered" {
		t.Fatalf("log after retry = %+v, want one delivered line", lines)
	}

	// Tick 3 (past the next due point): a failed delivery appends.
	res = tickOnce(t, dir, T.Add(2*time.Hour), fk, del)
	if res.Fires != 1 {
		t.Fatalf("failed tick: fires = %d, want 1", res.Fires)
	}
	lines = ReadLog(logPath)
	if len(lines) != 2 || lines[1].Outcome != "failed: probe" {
		t.Fatalf("log after failure = %+v, want the failed outcome appended", lines)
	}
}

// fakeNotifier records notify calls and can be scripted to fail.
type fakeNotifier struct {
	calls []notifyCall
	err   error
}

type notifyCall struct{ title, body, url string }

func (n *fakeNotifier) notify(ctx context.Context, title, body, url string) error {
	n.calls = append(n.calls, notifyCall{title, body, url})
	return n.err
}

// absentEntryYAML is one due every-1h entry anchored 2h back whose session
// target never resolves (no pane carries the session id).
const absentEntryYAML = `
entries:
  - id: a3f9
    name: sweep
    schedule: { kind: every, interval: 1h }
    target: { kind: session, session: dead }
    payload: "sweep"
    if_absent: %s
    created_by: { session: s, pane: "%%42", at: %d }
`

// absentRig builds the live1 rig for the if_absent tests: the entry's session
// target resolves to no pane, so the due fire lands in EvalResult.Absent.
func absentRig(t *testing.T, dir string, T time.Time, ifAbsent string) *fakeTmux {
	t.Helper()
	writeEntryFile(t, dir, "live1", fmt.Sprintf(absentEntryYAML, ifAbsent, T.Add(-2*time.Hour).Unix()))
	fk := newFakeTmux()
	fk.sessions["live1"] = []tmux.SessionInfo{{Name: "work"}}
	fk.windows["live1"] = map[string][]tmux.WindowInfo{"work": {{WindowID: "@5"}}}
	return fk
}

func tickOnceN(t *testing.T, dir string, T time.Time, fk *fakeTmux, deliverer Deliverer, notifier func(context.Context, string, string, string) error) TickResult {
	t.Helper()
	res, err := Tick(context.Background(), Deps{
		Dir: dir,
		Now: func() time.Time { return T },
		ListServers: func(ctx context.Context) ([]string, error) {
			return []string{"live1"}, nil
		},
		Tmux:      fk,
		Deliverer: deliverer,
		Notifier:  notifier,
		OperatorStatePath: func(slug string) (string, error) {
			return filepath.Join(t.TempDir(), slug+".yaml"), nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	return res
}

// seedLog appends n lines for the given entry/target/outcome at ts.
func seedLog(t *testing.T, path string, n int, entry, target, outcome string, ts int64) {
	t.Helper()
	for range n {
		if err := AppendLog(path, LogLine{TS: ts, Entry: entry, Target: target, Reason: "schedule", Outcome: outcome}); err != nil {
			t.Fatal(err)
		}
	}
}

// captureSlog routes slog through a buffer for the rate-cap visibility pin,
// restoring the previous default on cleanup.
func captureSlog(t *testing.T) *strings.Builder {
	t.Helper()
	var buf strings.Builder
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&buf, nil)))
	t.Cleanup(func() { slog.SetDefault(prev) })
	return &buf
}

// cronTickEntryYAML is one cron-kind daily-9am entry targeting the resolved
// pane %42 on live1.
const cronTickEntryYAML = `
entries:
  - id: c909
    name: standup
    schedule: { kind: cron, expr: "0 9 * * *" }
    target: { kind: pane, pane: "%%42" }
    payload: "standup"
    created_by: { session: s, pane: "%%42", at: %d }
`

// cronPaneRig builds the live1 rig for the cron tick tests.
func cronPaneRig(t *testing.T, dir string, createdAt time.Time) *fakeTmux {
	t.Helper()
	writeEntryFile(t, dir, "live1", fmt.Sprintf(cronTickEntryYAML, createdAt.Unix()))
	fk := newFakeTmux()
	fk.sessions["live1"] = []tmux.SessionInfo{{Name: "work"}}
	fk.windows["live1"] = map[string][]tmux.WindowInfo{"work": {{WindowID: "@5"}}}
	fk.alive["live1"] = map[string]bool{"%42": true}
	fk.panes["live1"] = map[string]tmux.PaneFacts{"%42": {AgentState: tmux.AgentStateIdle, AgentStateEpoch: createdAt.Unix()}}
	return fk
}

// TestTickCronMissedOneLinePerGap: a daemon gap over a cron occurrence logs
// exactly one `missed` line — the append advances the anchor, so a consecutive
// tick over the same gap logs nothing, and the next occurrence fires normally.
func TestTickCronMissedOneLinePerGap(t *testing.T) {
	dir := t.TempDir()
	createdAt := localTime(2026, 9, 8, 8, 0, 0)
	fk := cronPaneRig(t, dir, createdAt)
	logPath := filepath.Join(dir, "live1.log")

	// Tick at 11:00 — the 9am occurrence is 2h stale, past the grace window.
	del := &fakeDeliverer{}
	res := tickOnce(t, dir, localTime(2026, 9, 9, 11, 0, 0), fk, del)
	if len(del.fires) != 0 {
		t.Errorf("deliverer got %d fires, want 0 (the stale occurrence is logged, not delivered)", len(del.fires))
	}
	lines := ReadLog(logPath)
	if len(lines) != 1 || lines[0].Outcome != "missed" || lines[0].Entry != "c909" {
		t.Fatalf("log = %+v, want one missed line for c909", lines)
	}
	if lines[0].Target != "" {
		t.Errorf("missed line target = %q, want empty (schedule history, not delivery)", lines[0].Target)
	}
	if res.Fires != 1 {
		t.Errorf("fires = %d, want 1 (the missed line counts as activity)", res.Fires)
	}

	// A consecutive tick over the same gap appends nothing — one line per gap,
	// not per tick.
	res = tickOnce(t, dir, localTime(2026, 9, 9, 11, 0, 30), fk, del)
	if lines := ReadLog(logPath); len(lines) != 1 {
		t.Fatalf("log after the second tick = %+v, want the same one missed line", lines)
	}
	if res.Fires != 0 {
		t.Errorf("second tick fires = %d, want 0", res.Fires)
	}

	// The next occurrence (tomorrow 9am, in grace) fires and delivers.
	res = tickOnce(t, dir, localTime(2026, 9, 10, 9, 0, 45), fk, del)
	if len(del.fires) != 1 {
		t.Fatalf("deliverer got %d fires, want the 9am fire", len(del.fires))
	}
	if want := localTime(2026, 9, 10, 9, 0, 0); !del.fires[0].DueAt.Equal(want) {
		t.Errorf("fire DueAt = %v, want the occurrence %v", del.fires[0].DueAt, want)
	}
	lines = ReadLog(logPath)
	if len(lines) != 2 || lines[1].Outcome != "delivered" {
		t.Fatalf("log = %+v, want the missed line plus the delivery", lines)
	}
}

// TestTickCronCatchUpFiresOnceLate: with catch_up: once a stale occurrence
// fires late exactly once (DueAt = now), and the delivery's log line
// re-anchors the entry — the next tick is quiet until the next occurrence.
func TestTickCronCatchUpFiresOnceLate(t *testing.T) {
	dir := t.TempDir()
	createdAt := localTime(2026, 9, 8, 8, 0, 0)
	writeEntryFile(t, dir, "live1", fmt.Sprintf(`
entries:
  - id: c909
    name: standup
    schedule: { kind: cron, expr: "0 9 * * *", catch_up: once }
    target: { kind: pane, pane: "%%42" }
    payload: "standup"
    created_by: { session: s, pane: "%%42", at: %d }
`, createdAt.Unix()))
	fk := newFakeTmux()
	fk.sessions["live1"] = []tmux.SessionInfo{{Name: "work"}}
	fk.windows["live1"] = map[string][]tmux.WindowInfo{"work": {{WindowID: "@5"}}}
	fk.alive["live1"] = map[string]bool{"%42": true}
	fk.panes["live1"] = map[string]tmux.PaneFacts{"%42": {AgentState: tmux.AgentStateIdle, AgentStateEpoch: createdAt.Unix()}}

	now := localTime(2026, 9, 9, 11, 0, 0)
	del := &fakeDeliverer{}
	tickOnce(t, dir, now, fk, del)
	if len(del.fires) != 1 {
		t.Fatalf("deliverer got %d fires, want the one catch-up fire", len(del.fires))
	}
	if !del.fires[0].DueAt.Equal(now) {
		t.Errorf("catch-up DueAt = %v, want now (%v) — late fires opt out of the hold bound", del.fires[0].DueAt, now)
	}
	lines := ReadLog(filepath.Join(dir, "live1.log"))
	if len(lines) != 1 || lines[0].Outcome != "delivered" {
		t.Fatalf("log = %+v, want the catch-up delivery", lines)
	}

	// The gap is closed: a same-day tick fires nothing more.
	tickOnce(t, dir, localTime(2026, 9, 9, 12, 0, 0), fk, del)
	if len(del.fires) != 1 {
		t.Errorf("deliverer got %d fires total, want 1 (at most one late fire per gap)", len(del.fires))
	}
}

// TestTickRateCapTrips: at DefaultTargetRatePerHour counted deliveries to the
// pane within the trailing hour (across ALL entries), the due fire is
// suppressed — nothing typed, a rate-capped line lands, and a Warn names the
// trip. One below the cap, the fire delivers.
func TestTickRateCapTrips(t *testing.T) {
	t.Run("at the cap the fire is suppressed", func(t *testing.T) {
		dir := t.TempDir()
		T := backoffBase
		fk := livePaneRig(t, dir, T)
		logPath := filepath.Join(dir, "live1.log")
		// Another entry's deliveries to the same pane fill the window; a3f9's
		// own anchor is untouched, so it stays due.
		seedLog(t, logPath, DefaultTargetRatePerHour, "zzzz", "%42", "delivered", T.Add(-30*time.Minute).Unix())

		warns := captureSlog(t)
		del := &fakeDeliverer{}
		res := tickOnce(t, dir, T, fk, del)
		if len(del.fires) != 0 {
			t.Errorf("deliverer got %d fires, want 0 (rate-capped)", len(del.fires))
		}
		lines := ReadLog(logPath)
		last := lines[len(lines)-1]
		if last.Outcome != "rate-capped" || last.Entry != "a3f9" || last.Target != "%42" {
			t.Errorf("last log line = %+v, want the rate-capped line for a3f9/%%42", last)
		}
		if !strings.Contains(warns.String(), "rate-capped") {
			t.Errorf("no Warn-level rate-capped message; log = %q", warns.String())
		}
		if res.Fires != 1 {
			t.Errorf("fires = %d, want 1 (the capped suppression is logged)", res.Fires)
		}
	})

	t.Run("one below the cap delivers", func(t *testing.T) {
		dir := t.TempDir()
		T := backoffBase
		fk := livePaneRig(t, dir, T)
		seedLog(t, filepath.Join(dir, "live1.log"), DefaultTargetRatePerHour-1, "zzzz", "%42", "delivered", T.Add(-30*time.Minute).Unix())

		del := &fakeDeliverer{}
		tickOnce(t, dir, T, fk, del)
		if len(del.fires) != 1 {
			t.Errorf("deliverer got %d fires, want 1 (below the cap)", len(del.fires))
		}
	})

	t.Run("old lines fall out of the window", func(t *testing.T) {
		dir := t.TempDir()
		T := backoffBase
		fk := livePaneRig(t, dir, T)
		seedLog(t, filepath.Join(dir, "live1.log"), DefaultTargetRatePerHour, "zzzz", "%42", "delivered", T.Add(-2*rateWindow).Unix())

		del := &fakeDeliverer{}
		tickOnce(t, dir, T, fk, del)
		if len(del.fires) != 1 {
			t.Errorf("deliverer got %d fires, want 1 (lines older than the window don't count)", len(del.fires))
		}
	})
}

// TestTickRateCapOutcomeClasses: only delivery-attempt outcomes count —
// suppressions (rate-capped), recorded misses (skipped-absent, missed), and
// expired holds (held-expired) do not, and held outcomes never reach the log
// at all.
func TestTickRateCapOutcomeClasses(t *testing.T) {
	for _, outcome := range []string{"rate-capped", "skipped-absent", "missed", "held-expired"} {
		t.Run(outcome+" does not count", func(t *testing.T) {
			dir := t.TempDir()
			T := backoffBase
			fk := livePaneRig(t, dir, T)
			seedLog(t, filepath.Join(dir, "live1.log"), DefaultTargetRatePerHour, "zzzz", "%42", outcome, T.Add(-30*time.Minute).Unix())

			del := &fakeDeliverer{}
			tickOnce(t, dir, T, fk, del)
			if len(del.fires) != 1 {
				t.Errorf("deliverer got %d fires, want 1 (%q lines must not trip the cap)", len(del.fires), outcome)
			}
		})
	}
}

// TestTickRateCapAbsentKeysOnEntry: an absent fire's cap key is the entry id
// (its log lines carry no pane) — past the cap, the notify disposition is
// suppressed with a rate-capped line.
func TestTickRateCapAbsentKeysOnEntry(t *testing.T) {
	dir := t.TempDir()
	T := backoffBase
	fk := absentRig(t, dir, T, "notify")
	logPath := filepath.Join(dir, "live1.log")
	// The entry's own notified-absent history fills the window; the 1m
	// interval keeps it due despite the advanced anchor.
	writeEntryFile(t, dir, "live1", fmt.Sprintf(`
entries:
  - id: a3f9
    name: sweep
    schedule: { kind: every, interval: 1m }
    target: { kind: session, session: dead }
    payload: "sweep"
    if_absent: notify
    created_by: { session: s, pane: "%%42", at: %d }
`, T.Add(-2*time.Hour).Unix()))
	seedLog(t, logPath, DefaultTargetRatePerHour, "a3f9", "", "notified-absent", T.Add(-30*time.Minute).Unix())

	nt := &fakeNotifier{}
	tickOnceN(t, dir, T, fk, &fakeDeliverer{}, nt.notify)
	if len(nt.calls) != 0 {
		t.Errorf("notify calls = %d, want 0 (rate-capped)", len(nt.calls))
	}
	lines := ReadLog(logPath)
	if last := lines[len(lines)-1]; last.Outcome != "rate-capped" || last.Entry != "a3f9" {
		t.Errorf("last log line = %+v, want the rate-capped line for a3f9", last)
	}
}

// TestTickRateCapAbsentOtherEntryUnaffected: another entry's notified-absent
// lines do not count against this entry's absent cap.
func TestTickRateCapAbsentOtherEntryUnaffected(t *testing.T) {
	dir := t.TempDir()
	T := backoffBase
	fk := absentRig(t, dir, T, "notify")
	seedLog(t, filepath.Join(dir, "live1.log"), DefaultTargetRatePerHour, "zzzz", "", "notified-absent", T.Add(-30*time.Minute).Unix())

	nt := &fakeNotifier{}
	tickOnceN(t, dir, T, fk, &fakeDeliverer{}, nt.notify)
	if len(nt.calls) != 1 {
		t.Errorf("notify calls = %d, want 1 (another entry's lines must not trip this entry's cap)", len(nt.calls))
	}
}

// TestTickIfAbsentDispositions: skip (and empty) log skipped-absent; notify
// calls the notifier and logs notified-absent; respawn degrades to notify with
// a respawn-unimplemented diagnostic.
func TestTickIfAbsentDispositions(t *testing.T) {
	cases := []struct {
		ifAbsent    string
		wantOutcome string
		wantNotify  bool
		wantDiag    string
	}{
		{"skip", "skipped-absent", false, ""},
		{"notify", "notified-absent", true, ""},
		{"respawn", "notified-absent", true, "respawn-unimplemented"},
	}
	for _, tc := range cases {
		t.Run(tc.ifAbsent, func(t *testing.T) {
			dir := t.TempDir()
			T := backoffBase
			fk := absentRig(t, dir, T, tc.ifAbsent)
			nt := &fakeNotifier{}
			res := tickOnceN(t, dir, T, fk, &fakeDeliverer{}, nt.notify)

			lines := ReadLog(filepath.Join(dir, "live1.log"))
			if len(lines) != 1 || lines[0].Outcome != tc.wantOutcome {
				t.Fatalf("log = %+v, want one %s line", lines, tc.wantOutcome)
			}
			if lines[0].Entry != "a3f9" || lines[0].Target != "" {
				t.Errorf("log line = %+v, want entry a3f9 with no target", lines[0])
			}
			if got := len(nt.calls); (got == 1) != tc.wantNotify {
				t.Errorf("notify calls = %d, wantNotify=%v", got, tc.wantNotify)
			}
			if tc.wantNotify {
				call := nt.calls[0]
				if call.title != "cron: sweep" || !strings.Contains(call.body, "live1") {
					t.Errorf("notify = %+v, want title `cron: sweep`, body naming the server", call)
				}
			}
			if tc.wantDiag != "" && !hasDiag(res.Diags, tc.wantDiag) {
				t.Errorf("diags = %v, want %s", diagReasons(res.Diags), tc.wantDiag)
			}
		})
	}

	t.Run("empty if_absent behaves as skip", func(t *testing.T) {
		dir := t.TempDir()
		T := backoffBase
		fk := absentRig(t, dir, T, "")
		nt := &fakeNotifier{}
		tickOnceN(t, dir, T, fk, &fakeDeliverer{}, nt.notify)
		lines := ReadLog(filepath.Join(dir, "live1.log"))
		if len(lines) != 1 || lines[0].Outcome != "skipped-absent" {
			t.Fatalf("log = %+v, want one skipped-absent line", lines)
		}
		if len(nt.calls) != 0 {
			t.Errorf("notify calls = %d, want 0", len(nt.calls))
		}
	})
}

// TestTickIfAbsentNotifyOncePerDuePeriod: the notified-absent log line
// advances the anchor, so a dead target notifies once per due period, not once
// per tick.
func TestTickIfAbsentNotifyOncePerDuePeriod(t *testing.T) {
	dir := t.TempDir()
	T := backoffBase
	fk := absentRig(t, dir, T, "notify")
	nt := &fakeNotifier{}

	tickOnceN(t, dir, T, fk, &fakeDeliverer{}, nt.notify)
	// One tick later: the entry is not due again (anchor advanced to T).
	res := tickOnceN(t, dir, T.Add(30*time.Second), fk, &fakeDeliverer{}, nt.notify)
	if len(nt.calls) != 1 {
		t.Errorf("notify calls = %d, want 1 — the anchor advance must throttle notify to once per due period", len(nt.calls))
	}
	if lines := ReadLog(filepath.Join(dir, "live1.log")); len(lines) != 1 {
		t.Errorf("log lines = %d, want 1", len(lines))
	}
	if res.Fires != 0 {
		t.Errorf("second tick fires = %d, want 0 (not due)", res.Fires)
	}

	// Past the next due point the entry notifies again.
	tickOnceN(t, dir, T.Add(time.Hour), fk, &fakeDeliverer{}, nt.notify)
	if len(nt.calls) != 2 {
		t.Errorf("notify calls = %d, want 2 after the next due period", len(nt.calls))
	}
}

// TestTickIfAbsentNotifyFailSilent: a notify failure is a diagnostic, never a
// tick error, and the notified-absent line still lands (the anchor advance is
// the notify throttle).
func TestTickIfAbsentNotifyFailSilent(t *testing.T) {
	dir := t.TempDir()
	T := backoffBase
	fk := absentRig(t, dir, T, "notify")
	nt := &fakeNotifier{err: errors.New("push service unreachable")}
	res := tickOnceN(t, dir, T, fk, &fakeDeliverer{}, nt.notify)
	if !hasDiag(res.Diags, "notify-failed") {
		t.Errorf("diags = %v, want notify-failed", diagReasons(res.Diags))
	}
	lines := ReadLog(filepath.Join(dir, "live1.log"))
	if len(lines) != 1 || lines[0].Outcome != "notified-absent" {
		t.Fatalf("log = %+v, want the notified-absent line even on notify failure", lines)
	}
}

// TestTickIfAbsentNotifyDeepLink: the notify carries the operator window's
// activity-tab deep link when a role:operator window resolves on the server,
// and an empty url (tick completing normally) when none does.
func TestTickIfAbsentNotifyDeepLink(t *testing.T) {
	t.Run("operator window resolves", func(t *testing.T) {
		dir := t.TempDir()
		T := backoffBase
		fk := absentRig(t, dir, T, "notify")
		fk.windows["live1"]["work"] = append(fk.windows["live1"]["work"], tmux.WindowInfo{WindowID: "@7", Role: RoleOperator})

		nt := &fakeNotifier{}
		tickOnceN(t, dir, T, fk, &fakeDeliverer{}, nt.notify)
		if len(nt.calls) != 1 {
			t.Fatalf("notify calls = %d, want 1", len(nt.calls))
		}
		if want := "/live1/7?tab=activity"; nt.calls[0].url != want {
			t.Errorf("notify url = %q, want %q", nt.calls[0].url, want)
		}
	})

	t.Run("no operator window fires URL-less and the tick completes", func(t *testing.T) {
		dir := t.TempDir()
		T := backoffBase
		fk := absentRig(t, dir, T, "notify")

		nt := &fakeNotifier{}
		res := tickOnceN(t, dir, T, fk, &fakeDeliverer{}, nt.notify)
		if len(nt.calls) != 1 || nt.calls[0].url != "" {
			t.Errorf("notify calls = %+v, want one URL-less call", nt.calls)
		}
		lines := ReadLog(filepath.Join(dir, "live1.log"))
		if len(lines) != 1 || lines[0].Outcome != "notified-absent" {
			t.Fatalf("log = %+v, want the notified-absent line", lines)
		}
		if res.Fires != 1 {
			t.Errorf("fires = %d, want 1 (the tick completes normally)", res.Fires)
		}
	})
}

// TestTickDeliverLogCursor: one due entry delivers through the seam exactly
// once, the log gains exactly one line with the outcome, and the cursor file
// is written (R15).
func TestTickDeliverLogCursor(t *testing.T) {
	dir := t.TempDir()
	T := backoffBase
	writeEntryFile(t, dir, "live1", sprintfTick(T))

	fk := newFakeTmux()
	fk.sessions["live1"] = []tmux.SessionInfo{{Name: "work"}}
	fk.windows["live1"] = map[string][]tmux.WindowInfo{"work": {{WindowID: "@5"}}}
	fk.alive["live1"] = map[string]bool{"%42": true}
	fk.panes["live1"] = map[string]tmux.PaneFacts{"%42": {AgentState: tmux.AgentStateIdle, AgentStateEpoch: T.Unix()}}

	del := &fakeDeliverer{}
	res, err := Tick(context.Background(), Deps{
		Dir: dir,
		Now: func() time.Time { return T },
		ListServers: func(ctx context.Context) ([]string, error) {
			return []string{"live1"}, nil
		},
		Tmux:      fk,
		Deliverer: del,
		OperatorStatePath: func(slug string) (string, error) {
			return filepath.Join(t.TempDir(), slug+".yaml"), nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if res.Fires != 1 {
		t.Fatalf("fires = %d, want 1", res.Fires)
	}
	if len(del.fires) != 1 {
		t.Fatalf("deliverer got %d fires, want exactly 1", len(del.fires))
	}
	fire := del.fires[0]
	if fire.Entry.ID != "a3f9" || fire.PaneID != "%42" || fire.Reason != FireSchedule || fire.Server != "live1" {
		t.Errorf("fire = %+v", fire)
	}

	// Exactly one log line with the fake's outcome.
	lines := ReadLog(filepath.Join(dir, "live1.log"))
	if len(lines) != 1 {
		t.Fatalf("log lines = %d, want 1", len(lines))
	}
	line := lines[0]
	if line.Entry != "a3f9" || line.Target != "%42" || line.Reason != "schedule" ||
		line.Outcome != "delivered" || line.TS != T.Unix() {
		t.Errorf("log line = %+v", line)
	}

	// The wake cursor was persisted (no wake entries ⇒ empty-but-valid file).
	cursorPath := filepath.Join(dir, "live1.cursor.yaml")
	if _, err := os.Stat(cursorPath); err != nil {
		t.Errorf("cursor not written: %v", err)
	}
}

// TestTickLockContention is the A-017 pin: with the lock held, a tick returns
// immediately — no fires, no log writes, no cursor writes, no error.
func TestTickLockContention(t *testing.T) {
	dir := t.TempDir()
	T := backoffBase
	writeEntryFile(t, dir, "live1", sprintfTick(T))

	release, err := acquireLock(LockPath(dir))
	if err != nil {
		t.Fatal(err)
	}
	defer release()

	del := &fakeDeliverer{}
	res, err := Tick(context.Background(), Deps{
		Dir: dir,
		Now: func() time.Time { return T },
		ListServers: func(ctx context.Context) ([]string, error) {
			t.Error("ListServers called under contention — the lock must gate everything")
			return []string{"live1"}, nil
		},
		Tmux:      newFakeTmux(),
		Deliverer: del,
	})
	if err != nil {
		t.Fatalf("contended tick returned error: %v", err)
	}
	if !res.Held {
		t.Error("contended tick: Held = false, want true so invokers can stay quiet")
	}
	if res.Fires != 0 || len(res.Diags) != 0 || len(del.fires) != 0 {
		t.Errorf("contended tick: fires=%d diags=%v delivered=%d, want all zero", res.Fires, res.Diags, len(del.fires))
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		if e.Name() != "live1.yaml" && e.Name() != ".lock" {
			t.Errorf("contended tick wrote %s", e.Name())
		}
	}
}

// TestTickCorruptEntryFileNeverAborts: a corrupt entry file for a live server
// is a diagnostic, and the tick continues (A-019).
func TestTickCorruptEntryFileNeverAborts(t *testing.T) {
	dir := t.TempDir()
	T := backoffBase
	writeEntryFile(t, dir, "live1", "{{{{ not yaml")

	fk := newFakeTmux()
	fk.sessions["live1"] = []tmux.SessionInfo{}
	res, err := Tick(context.Background(), Deps{
		Dir: dir,
		Now: func() time.Time { return T },
		ListServers: func(ctx context.Context) ([]string, error) {
			return []string{"live1"}, nil
		},
		Tmux:      fk,
		Deliverer: &fakeDeliverer{},
		OperatorStatePath: func(slug string) (string, error) {
			return filepath.Join(t.TempDir(), slug+".yaml"), nil
		},
	})
	if err != nil {
		t.Fatalf("tick aborted on a corrupt entry file: %v", err)
	}
	if !hasDiag(res.Diags, "entry-file-corrupt") {
		t.Errorf("diags = %v, want entry-file-corrupt", diagReasons(res.Diags))
	}
	if res.Fires != 0 {
		t.Errorf("fires = %d, want 0", res.Fires)
	}
}

// TestTickSuppressWhileEndToEnd: a due entry whose guard holds is not
// delivered and not logged (suppression precedes emission, A-009).
func TestTickSuppressWhileEndToEnd(t *testing.T) {
	dir := t.TempDir()
	T := backoffBase
	writeEntryFile(t, dir, "live1", `
entries:
  - id: a3f9
    schedule: { kind: every, interval: 1h }
    suppress_while: [nothing-tracked]
    target: { kind: pane, pane: "%42" }
    payload: "sweep"
    created_by: { session: s, pane: "%42", at: 1 }
`)
	// The fab operator state file: nothing tracked ⇒ the guard holds.
	opDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(opDir, "live1.yaml"), []byte("monitored: []\nwatches: []\nautopilot: []\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	fk := newFakeTmux()
	fk.sessions["live1"] = []tmux.SessionInfo{{Name: "work"}}
	fk.windows["live1"] = map[string][]tmux.WindowInfo{"work": {{WindowID: "@5"}}}
	fk.alive["live1"] = map[string]bool{"%42": true}
	fk.panes["live1"] = map[string]tmux.PaneFacts{"%42": {AgentState: tmux.AgentStateIdle, AgentStateEpoch: T.Unix()}}

	del := &fakeDeliverer{}
	res, err := Tick(context.Background(), Deps{
		Dir: dir,
		Now: func() time.Time { return T },
		ListServers: func(ctx context.Context) ([]string, error) {
			return []string{"live1"}, nil
		},
		Tmux:      fk,
		Deliverer: del,
		OperatorStatePath: func(slug string) (string, error) {
			return filepath.Join(opDir, slug+".yaml"), nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if res.Fires != 0 || len(del.fires) != 0 {
		t.Errorf("suppressed entry delivered: fires=%d delivered=%d", res.Fires, len(del.fires))
	}
	if !hasDiag(res.Diags, "suppressed") {
		t.Errorf("diags = %v, want suppressed", diagReasons(res.Diags))
	}
	if lines := ReadLog(filepath.Join(dir, "live1.log")); len(lines) != 0 {
		t.Errorf("log lines = %d, want 0 — a suppression is never a recorded miss", len(lines))
	}
}

// absentRoleEntryYAML is one due every-1h entry whose role:operator target
// never resolves (no window carries @rk_win_role=operator in the rig).
const absentRoleEntryYAML = `
entries:
  - id: a3f9
    name: operator tick
    schedule: { kind: every, interval: 1h }
    target: { kind: role, role: operator }
    payload: "operator tick"
    if_absent: respawn
    created_by: { pane: "%%42", at: %d }
`

// absentRoleRig builds the live1 rig for the role-target respawn tests: the
// due fire lands in EvalResult.Absent because no window carries the role.
func absentRoleRig(t *testing.T, dir string, T time.Time) *fakeTmux {
	t.Helper()
	writeEntryFile(t, dir, "live1", fmt.Sprintf(absentRoleEntryYAML, T.Add(-2*time.Hour).Unix()))
	fk := newFakeTmux()
	fk.sessions["live1"] = []tmux.SessionInfo{{Name: "work"}}
	fk.windows["live1"] = map[string][]tmux.WindowInfo{"work": {{WindowID: "@5"}}}
	return fk
}

// fakeRespawner records every respawn call and returns a scripted outcome.
type fakeRespawner struct {
	calls   []Fire
	outcome Outcome
}

func (r *fakeRespawner) respawn(ctx context.Context, fire Fire) Outcome {
	r.calls = append(r.calls, fire)
	return r.outcome
}

// tickOnceR is tickOnceN plus the Respawner seam.
func tickOnceR(t *testing.T, dir string, T time.Time, fk *fakeTmux, notifier func(context.Context, string, string, string) error, respawner func(context.Context, Fire) Outcome) TickResult {
	t.Helper()
	res, err := Tick(context.Background(), Deps{
		Dir: dir,
		Now: func() time.Time { return T },
		ListServers: func(ctx context.Context) ([]string, error) {
			return []string{"live1"}, nil
		},
		Tmux:      fk,
		Notifier:  notifier,
		Respawner: respawner,
		OperatorStatePath: func(slug string) (string, error) {
			return filepath.Join(t.TempDir(), slug+".yaml"), nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	return res
}

// TestTickIfAbsentRespawnRoleTarget: a role-target respawn entry with a wired
// Respawner calls it (no notify, no respawn-unimplemented diagnostic) and logs
// the returned outcome — both success and failure. The logged line advances
// the anchor: an immediate re-tick does not re-fire.
func TestTickIfAbsentRespawnRoleTarget(t *testing.T) {
	cases := []struct {
		name        string
		outcome     Outcome
		wantOutcome string
	}{
		{"success", Outcome{Status: "respawned"}, "respawned"},
		{"failure", Outcome{Status: "respawn-failed", Detail: "readiness: parked"}, "respawn-failed: readiness: parked"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			T := backoffBase
			fk := absentRoleRig(t, dir, T)
			rs := &fakeRespawner{outcome: tc.outcome}
			nt := &fakeNotifier{}

			res := tickOnceR(t, dir, T, fk, nt.notify, rs.respawn)
			if len(rs.calls) != 1 {
				t.Fatalf("respawn calls = %d, want 1", len(rs.calls))
			}
			if got := rs.calls[0]; got.Entry.ID != "a3f9" || got.Server != "live1" {
				t.Errorf("respawn fire = entry %q server %q, want a3f9/live1", got.Entry.ID, got.Server)
			}
			if len(nt.calls) != 0 {
				t.Errorf("notify calls = %d, want 0 (the respawn path never degrades to notify)", len(nt.calls))
			}
			if hasDiag(res.Diags, "respawn-unimplemented") {
				t.Errorf("diags = %v, want no respawn-unimplemented", diagReasons(res.Diags))
			}
			lines := ReadLog(filepath.Join(dir, "live1.log"))
			if len(lines) != 1 || lines[0].Outcome != tc.wantOutcome {
				t.Fatalf("log = %+v, want one %q line", lines, tc.wantOutcome)
			}

			// The logged disposition advanced the anchor: not due again at T.
			rs.calls = nil
			res = tickOnceR(t, dir, T, fk, nt.notify, rs.respawn)
			if len(rs.calls) != 0 || res.Fires != 0 {
				t.Errorf("immediate re-tick: respawn calls = %d fires = %d, want 0/0 (anchor advanced)", len(rs.calls), res.Fires)
			}
		})
	}
}

// TestTickIfAbsentRespawnDegradeUnchanged: the notify + respawn-unimplemented
// degrade is byte-for-byte unchanged for every combination outside the new
// branch — a non-role target (respawner wired but never called) and a nil
// respawner (role target included).
func TestTickIfAbsentRespawnDegradeUnchanged(t *testing.T) {
	cases := []struct {
		name     string
		roleTgt  bool
		respawn  func(context.Context, Fire) Outcome // nil = seam unwired
		wantCall bool
	}{
		{"session target, respawner wired", false, (&fakeRespawner{outcome: Outcome{Status: "respawned"}}).respawn, false},
		{"role target, respawner nil", true, nil, false},
		{"session target, respawner nil", false, nil, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			T := backoffBase
			var fk *fakeTmux
			if tc.roleTgt {
				fk = absentRoleRig(t, dir, T)
			} else {
				fk = absentRig(t, dir, T, "respawn")
			}
			nt := &fakeNotifier{}
			res := tickOnceR(t, dir, T, fk, nt.notify, tc.respawn)
			if len(nt.calls) != 1 {
				t.Errorf("notify calls = %d, want 1 (the degrade path)", len(nt.calls))
			}
			if !hasDiag(res.Diags, "respawn-unimplemented") {
				t.Errorf("diags = %v, want respawn-unimplemented", diagReasons(res.Diags))
			}
			lines := ReadLog(filepath.Join(dir, "live1.log"))
			if len(lines) != 1 || lines[0].Outcome != "notified-absent" {
				t.Errorf("log = %+v, want one notified-absent line", lines)
			}
		})
	}
}

// tickOnceS is tickOnceN plus the SessionRespawner seam.
func tickOnceS(t *testing.T, dir string, T time.Time, fk *fakeTmux, notifier func(context.Context, string, string, string) error, sessionRespawner func(context.Context, Fire) Outcome) TickResult {
	t.Helper()
	res, err := Tick(context.Background(), Deps{
		Dir: dir,
		Now: func() time.Time { return T },
		ListServers: func(ctx context.Context) ([]string, error) {
			return []string{"live1"}, nil
		},
		Tmux:             fk,
		Notifier:         notifier,
		SessionRespawner: sessionRespawner,
		OperatorStatePath: func(slug string) (string, error) {
			return filepath.Join(t.TempDir(), slug+".yaml"), nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	return res
}

// TestTickIfAbsentRespawnSessionTarget: a session-target respawn entry with a
// wired SessionRespawner calls it (no notify, no respawn-unimplemented
// diagnostic) and logs the returned outcome — both success and failure.
func TestTickIfAbsentRespawnSessionTarget(t *testing.T) {
	cases := []struct {
		name        string
		outcome     Outcome
		wantOutcome string
	}{
		{"success", Outcome{Status: "respawned"}, "respawned"},
		{"failure", Outcome{Status: "respawn-failed", Detail: "no closed record"}, "respawn-failed: no closed record"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			T := backoffBase
			fk := absentRig(t, dir, T, "respawn")
			rs := &fakeRespawner{outcome: tc.outcome}
			nt := &fakeNotifier{}

			res := tickOnceS(t, dir, T, fk, nt.notify, rs.respawn)
			if len(rs.calls) != 1 {
				t.Fatalf("session respawn calls = %d, want 1", len(rs.calls))
			}
			if got := rs.calls[0]; got.Entry.ID != "a3f9" || got.Server != "live1" {
				t.Errorf("respawn fire = entry %q server %q, want a3f9/live1", got.Entry.ID, got.Server)
			}
			if len(nt.calls) != 0 {
				t.Errorf("notify calls = %d, want 0 (the respawn path never degrades to notify)", len(nt.calls))
			}
			if hasDiag(res.Diags, "respawn-unimplemented") {
				t.Errorf("diags = %v, want no respawn-unimplemented", diagReasons(res.Diags))
			}
			lines := ReadLog(filepath.Join(dir, "live1.log"))
			if len(lines) != 1 || lines[0].Outcome != tc.wantOutcome {
				t.Fatalf("log = %+v, want one %q line", lines, tc.wantOutcome)
			}
		})
	}
}

// TestTickIfAbsentRespawnSessionDegradeUnchanged: outside the new branch the
// notify + respawn-unimplemented degrade is byte-for-byte unchanged — a nil
// session seam, and a pane target even with the seam wired (pane targets can
// never respawn) both degrade verbatim and never call the seam.
func TestTickIfAbsentRespawnSessionDegradeUnchanged(t *testing.T) {
	t.Run("session target, session respawner nil", func(t *testing.T) {
		dir := t.TempDir()
		T := backoffBase
		fk := absentRig(t, dir, T, "respawn")
		nt := &fakeNotifier{}
		res := tickOnceS(t, dir, T, fk, nt.notify, nil)
		if len(nt.calls) != 1 {
			t.Errorf("notify calls = %d, want 1 (the degrade path)", len(nt.calls))
		}
		if !hasDiag(res.Diags, "respawn-unimplemented") {
			t.Errorf("diags = %v, want respawn-unimplemented", diagReasons(res.Diags))
		}
		lines := ReadLog(filepath.Join(dir, "live1.log"))
		if len(lines) != 1 || lines[0].Outcome != "notified-absent" {
			t.Errorf("log = %+v, want one notified-absent line", lines)
		}
	})

	t.Run("pane target, session respawner wired but never called", func(t *testing.T) {
		dir := t.TempDir()
		T := backoffBase
		writeEntryFile(t, dir, "live1", fmt.Sprintf(`
entries:
  - id: a3f9
    name: pane sweep
    schedule: { kind: every, interval: 1h }
    target: { kind: pane, pane: "%%99" }
    payload: "sweep"
    if_absent: respawn
    created_by: { pane: "%%42", at: %d }
`, T.Add(-2*time.Hour).Unix()))
		fk := newFakeTmux()
		fk.sessions["live1"] = []tmux.SessionInfo{{Name: "work"}}
		fk.windows["live1"] = map[string][]tmux.WindowInfo{"work": {{WindowID: "@5"}}}

		rs := &fakeRespawner{outcome: Outcome{Status: "respawned"}}
		nt := &fakeNotifier{}
		res := tickOnceS(t, dir, T, fk, nt.notify, rs.respawn)
		if len(rs.calls) != 0 {
			t.Errorf("session respawn calls = %d, want 0 (pane targets never respawn)", len(rs.calls))
		}
		if len(nt.calls) != 1 {
			t.Errorf("notify calls = %d, want 1 (the degrade path)", len(nt.calls))
		}
		if !hasDiag(res.Diags, "respawn-unimplemented") {
			t.Errorf("diags = %v, want respawn-unimplemented", diagReasons(res.Diags))
		}
		lines := ReadLog(filepath.Join(dir, "live1.log"))
		if len(lines) != 1 || lines[0].Outcome != "notified-absent" {
			t.Errorf("log = %+v, want one notified-absent line", lines)
		}
	})
}

// TestTickRateCapCountsRespawn: respawned/respawn-failed log lines count
// toward the per-target rate cap (keyed on the entry id, like every absent
// disposition) — a persistently-dead operator cannot storm respawns.
func TestTickRateCapCountsRespawn(t *testing.T) {
	for _, outcome := range []string{"respawned", "respawn-failed: parked"} {
		t.Run(outcome, func(t *testing.T) {
			dir := t.TempDir()
			T := backoffBase
			// The 1m interval keeps the entry due despite the seeded lines
			// advancing its anchor (the absent-cap test's shape).
			writeEntryFile(t, dir, "live1", fmt.Sprintf(`
entries:
  - id: a3f9
    name: operator tick
    schedule: { kind: every, interval: 1m }
    target: { kind: role, role: operator }
    payload: "operator tick"
    if_absent: respawn
    created_by: { pane: "%%42", at: %d }
`, T.Add(-2*time.Hour).Unix()))
			fk := newFakeTmux()
			fk.sessions["live1"] = []tmux.SessionInfo{{Name: "work"}}
			fk.windows["live1"] = map[string][]tmux.WindowInfo{"work": {{WindowID: "@5"}}}
			seedLog(t, filepath.Join(dir, "live1.log"), DefaultTargetRatePerHour, "a3f9", "", outcome, T.Add(-30*time.Minute).Unix())

			rs := &fakeRespawner{outcome: Outcome{Status: "respawned"}}
			tickOnceR(t, dir, T, fk, (&fakeNotifier{}).notify, rs.respawn)
			if len(rs.calls) != 0 {
				t.Errorf("respawn calls = %d, want 0 (rate-capped)", len(rs.calls))
			}
			lines := ReadLog(filepath.Join(dir, "live1.log"))
			if last := lines[len(lines)-1]; last.Outcome != "rate-capped" || last.Entry != "a3f9" {
				t.Errorf("last log line = %+v, want the rate-capped line for a3f9", last)
			}
		})
	}
}
