package cron

import (
	"fmt"
	"reflect"
	"testing"
	"time"
)

func resolvedFacts(state string, epoch int64) TargetFacts {
	return TargetFacts{PaneID: "%12", AgentState: state, StateEpoch: epoch}
}

func diagReasons(diags []Diagnostic) []string {
	var out []string
	for _, d := range diags {
		out = append(out, d.Reason)
	}
	return out
}

func hasDiag(diags []Diagnostic, reason string) bool {
	for _, d := range diags {
		if d.Reason == reason {
			return true
		}
	}
	return false
}

// TestEvaluateDeterministic: equal inputs return deep-equal results (R4) —
// and no package-level state leaks between calls.
func TestEvaluateDeterministic(t *testing.T) {
	T := backoffBase
	entries := []Entry{
		{
			ID:       "a3f9",
			Schedule: Schedule{Kind: ScheduleBackoff, Anchor: "operator-idle", Min: Duration{time.Minute}, Max: Duration{30 * time.Minute}},
			WakeOn:   &WakeOn{Event: WakeAgentStateChange, Scope: WakeScopeServer, Debounce: Duration{10 * time.Second}},
			Target:   Target{Kind: TargetRole, Role: RoleOperator},
			Payload:  "tick",
		},
		{
			ID:       "k7q2",
			Schedule: Schedule{Kind: ScheduleEvery, Interval: Duration{time.Hour}},
			Target:   Target{Kind: TargetSession, Session: "4fe2"},
			Payload:  "sweep",
			CreatedBy: CreatedBy{
				At: T.Add(-2 * time.Hour).Unix(),
			},
		},
		{ID: "m11d", Muted: true, Schedule: Schedule{Kind: ScheduleEvery, Interval: Duration{time.Minute}}, Target: Target{Kind: TargetPane, Pane: "%1"}, Payload: "x"},
	}
	in := EvalInput{
		Server:  "dev",
		Now:     T,
		Entries: entries,
		Facts: map[string]TargetFacts{
			"a3f9": resolvedFacts("idle", T.Add(-time.Minute).Unix()),
			"k7q2": {PaneID: "%31", AgentState: "active", StateEpoch: T.Add(-time.Hour).Unix()},
		},
		Fingerprint: "F1",
		Log:         own(unix(T, -3*time.Minute), unix(T, -time.Minute)),
		Cursor: WakeCursor{Entries: map[string]WakeObservation{
			"a3f9": {Fingerprint: "F0", ObservedAt: T.Add(-time.Minute).Unix()},
		}},
		Operator: OperatorState{Present: true, LastTickAt: T.Add(-time.Hour).Unix(), TrackedCount: 1},
	}
	first := Evaluate(in)
	second := Evaluate(in)
	if !reflect.DeepEqual(first, second) {
		t.Errorf("equal inputs, unequal results:\n%+v\n%+v", first, second)
	}
	// The input cursor must not have been mutated.
	if _, ok := in.Cursor.Entries["a3f9"]; !ok || in.Cursor.Entries["a3f9"].Fingerprint != "F0" {
		t.Errorf("input cursor mutated: %+v", in.Cursor)
	}
}

// TestEvaluateSkips: muted and unknown-kind entries never fire, with distinct
// diagnostics (R9). Cron-kind entries evaluate — from a zero created_by anchor
// the latest occurrence is long stale, so c909 surfaces as missed, not fired.
func TestEvaluateSkips(t *testing.T) {
	T := backoffBase
	entries := []Entry{
		{ID: "m11d", Muted: true, Schedule: Schedule{Kind: ScheduleEvery, Interval: Duration{time.Minute}}, Target: Target{Kind: TargetPane, Pane: "%1"}, Payload: "x", CreatedBy: CreatedBy{At: T.Add(-time.Hour).Unix()}},
		{ID: "c909", Schedule: Schedule{Kind: ScheduleCron, Expr: "*/5 * * * *"}, Target: Target{Kind: TargetPane, Pane: "%2"}, Payload: "x"},
		{ID: "u111", Schedule: Schedule{Kind: "bogus"}, Target: Target{Kind: TargetPane, Pane: "%3"}, Payload: "x"},
	}
	res := Evaluate(EvalInput{
		Server:  "dev",
		Now:     T,
		Entries: entries,
		Facts: map[string]TargetFacts{
			"m11d": resolvedFacts("idle", T.Unix()),
			"c909": resolvedFacts("idle", T.Unix()),
			"u111": resolvedFacts("idle", T.Unix()),
		},
	})
	if len(res.Fires) != 0 {
		t.Fatalf("fires = %+v, want none", res.Fires)
	}
	if len(res.Missed) != 1 || res.Missed[0].Entry.ID != "c909" {
		t.Errorf("missed = %+v, want the one stale cron entry", res.Missed)
	}
	byEntry := map[string]string{}
	for _, d := range res.Diags {
		byEntry[d.EntryID] = d.Reason
	}
	if byEntry["m11d"] != "muted" || byEntry["u111"] != "unknown-schedule-kind" {
		t.Errorf("diags = %v", res.Diags)
	}
	if _, ok := byEntry["c909"]; ok {
		t.Errorf("cron entry carried diagnostic %q — cron-kind evaluates now", byEntry["c909"])
	}
}

// TestEvaluateCronFire: a cron occurrence inside its grace window fires with
// DueAt = the occurrence, reason schedule.
func TestEvaluateCronFire(t *testing.T) {
	now := localTime(2026, 9, 9, 10, 5, 20)
	entry := Entry{
		ID:        "c909",
		Schedule:  Schedule{Kind: ScheduleCron, Expr: "*/5 * * * *"},
		Target:    Target{Kind: TargetPane, Pane: "%2"},
		Payload:   "x",
		CreatedBy: CreatedBy{At: localTime(2026, 9, 9, 9, 0, 0).Unix()},
	}
	in := EvalInput{
		Server: "dev", Now: now, Entries: []Entry{entry},
		Facts: map[string]TargetFacts{"c909": resolvedFacts("idle", now.Unix())},
		Log:   own(localTime(2026, 9, 9, 10, 0, 30).Unix()),
	}
	res := Evaluate(in)
	if len(res.Fires) != 1 {
		t.Fatalf("fires = %+v, want the 10:05 fire", res.Fires)
	}
	fire := res.Fires[0]
	if fire.Reason != FireSchedule || fire.PaneID != "%12" {
		t.Errorf("fire = %+v", fire)
	}
	if want := localTime(2026, 9, 9, 10, 5, 0); !fire.DueAt.Equal(want) {
		t.Errorf("DueAt = %v, want the occurrence %v", fire.DueAt, want)
	}
	if len(res.Missed) != 0 {
		t.Errorf("missed = %+v, want none (the occurrence is in grace)", res.Missed)
	}
	if again := Evaluate(in); !reflect.DeepEqual(res, again) {
		t.Errorf("non-deterministic result:\n first: %+v\nsecond: %+v", res, again)
	}
}

// TestEvaluateCronMissedEmission: a stale occurrence surfaces in
// EvalResult.Missed (target-independent — emitted even when the target fails
// resolution), never as a fire.
func TestEvaluateCronMissedEmission(t *testing.T) {
	now := localTime(2026, 9, 9, 10, 9, 0)
	entry := Entry{
		ID:        "c909",
		Schedule:  Schedule{Kind: ScheduleCron, Expr: "*/5 * * * *"},
		Target:    Target{Kind: TargetSession, Session: "dead"},
		Payload:   "x",
		CreatedBy: CreatedBy{At: localTime(2026, 9, 9, 9, 0, 0).Unix()},
	}
	in := EvalInput{
		Server: "dev", Now: now, Entries: []Entry{entry},
		Facts: map[string]TargetFacts{"c909": {Unresolved: "no pane carries session dead"}},
		Log:   own(localTime(2026, 9, 9, 10, 0, 30).Unix()),
	}
	res := Evaluate(in)
	if len(res.Fires) != 0 || len(res.Absent) != 0 {
		t.Errorf("fires=%+v absent=%+v, want none (the occurrence is stale)", res.Fires, res.Absent)
	}
	if len(res.Missed) != 1 {
		t.Fatalf("missed = %+v, want the one stale occurrence", res.Missed)
	}
	m := res.Missed[0]
	if m.PaneID != "" || m.Reason != FireSchedule || m.Entry.ID != "c909" {
		t.Errorf("missed fire = %+v, want a target-less schedule record", m)
	}
	if want := localTime(2026, 9, 9, 10, 5, 0); !m.DueAt.Equal(want) {
		t.Errorf("missed DueAt = %v, want the stale occurrence %v", m.DueAt, want)
	}
	if again := Evaluate(in); !reflect.DeepEqual(res, again) {
		t.Errorf("non-deterministic result:\n first: %+v\nsecond: %+v", res, again)
	}
}

// TestEvaluateCronMissedGuarded: a holding guard suppresses the missed line
// silently — same gating as fires, recorded as a suppressed diagnostic.
func TestEvaluateCronMissedGuarded(t *testing.T) {
	now := localTime(2026, 9, 9, 10, 9, 0)
	entry := Entry{
		ID:            "c909",
		Schedule:      Schedule{Kind: ScheduleCron, Expr: "*/5 * * * *"},
		SuppressWhile: []string{GuardNothingTracked},
		Target:        Target{Kind: TargetPane, Pane: "%2"},
		Payload:       "x",
		CreatedBy:     CreatedBy{At: localTime(2026, 9, 9, 9, 0, 0).Unix()},
	}
	res := Evaluate(EvalInput{
		Server: "dev", Now: now, Entries: []Entry{entry},
		Facts: map[string]TargetFacts{"c909": resolvedFacts("idle", now.Unix())},
		Log:   own(localTime(2026, 9, 9, 10, 0, 30).Unix()),
		// Zero OperatorState: nothing tracked ⇒ the guard holds.
	})
	if len(res.Missed) != 0 || len(res.Fires) != 0 {
		t.Errorf("suppressed missed emitted: missed=%+v fires=%+v", res.Missed, res.Fires)
	}
	if !hasDiag(res.Diags, "suppressed") {
		t.Errorf("diags = %v, want suppressed", diagReasons(res.Diags))
	}
}

// TestEvaluateGuardPrecedesFire: a due entry whose guard holds does NOT fire —
// suppression is a silent skip with a diagnostic, never an error (R8/R9).
func TestEvaluateGuardPrecedesFire(t *testing.T) {
	T := backoffBase
	entry := Entry{
		ID:            "a3f9",
		Schedule:      Schedule{Kind: ScheduleEvery, Interval: Duration{time.Hour}},
		SuppressWhile: []string{GuardNothingTracked},
		Target:        Target{Kind: TargetPane, Pane: "%12"},
		Payload:       "tick",
		CreatedBy:     CreatedBy{At: T.Add(-2 * time.Hour).Unix()},
	}
	facts := map[string]TargetFacts{"a3f9": resolvedFacts("idle", T.Unix())}

	// Guard holds (nothing tracked) ⇒ suppressed, no fire.
	res := Evaluate(EvalInput{Server: "dev", Now: T, Entries: []Entry{entry}, Facts: facts,
		Operator: OperatorState{Present: true}})
	if len(res.Fires) != 0 {
		t.Fatalf("fires = %+v, want suppressed", res.Fires)
	}
	if !hasDiag(res.Diags, "suppressed") {
		t.Errorf("diags = %v, want a suppression diagnostic", diagReasons(res.Diags))
	}

	// Guard does not hold (something tracked) ⇒ fires.
	res = Evaluate(EvalInput{Server: "dev", Now: T, Entries: []Entry{entry}, Facts: facts,
		Operator: OperatorState{Present: true, TrackedCount: 1}})
	if len(res.Fires) != 1 || res.Fires[0].Reason != FireSchedule {
		t.Fatalf("fires = %+v, want one schedule fire", res.Fires)
	}

	// Unknown guard ⇒ diagnostic, never holds, fire proceeds.
	entry.SuppressWhile = []string{"bogus-guard"}
	res = Evaluate(EvalInput{Server: "dev", Now: T, Entries: []Entry{entry}, Facts: facts})
	if len(res.Fires) != 1 || !hasDiag(res.Diags, "unknown-guard") {
		t.Errorf("unknown guard: fires=%+v diags=%v", res.Fires, diagReasons(res.Diags))
	}
}

// TestEvaluateWakeUnionAndDebounce: wake fires OR'd with the schedule; a held
// (debounced) edge does not fire; cold start seeds the cursor without firing.
func TestEvaluateWakeUnionAndDebounce(t *testing.T) {
	T := backoffBase
	entry := Entry{
		ID:       "a3f9",
		Schedule: Schedule{Kind: ScheduleEvery, Interval: Duration{time.Hour}},
		WakeOn:   &WakeOn{Event: WakeAgentStateChange, Scope: WakeScopeServer, Debounce: Duration{10 * time.Second}},
		Target:   Target{Kind: TargetPane, Pane: "%12"},
		Payload:  "tick",
		CreatedBy: CreatedBy{
			At: T.Unix(), // schedule NOT due
		},
	}
	facts := map[string]TargetFacts{"a3f9": resolvedFacts("idle", T.Unix())}
	base := EvalInput{Server: "dev", Now: T, Entries: []Entry{entry}, Facts: facts, Fingerprint: "F2"}

	// Cold start: no cursor observation ⇒ no edge fire, fresh cursor seeded.
	res := Evaluate(base)
	if len(res.Fires) != 0 {
		t.Fatalf("cold start fired: %+v", res.Fires)
	}
	obs, ok := res.NextCursor.Entries["a3f9"]
	if !ok || obs.Fingerprint != "F2" || obs.ObservedAt != T.Unix() {
		t.Errorf("cold start cursor = %+v", res.NextCursor)
	}
	if !hasDiag(res.Diags, "wake-cold-start") {
		t.Errorf("cold start diag missing: %v", diagReasons(res.Diags))
	}

	// Edge older than debounce ⇒ wake fire with reason wake.
	in := base
	in.Cursor = WakeCursor{Entries: map[string]WakeObservation{"a3f9": {Fingerprint: "F1", ObservedAt: T.Add(-time.Minute).Unix()}}}
	res = Evaluate(in)
	if len(res.Fires) != 1 || res.Fires[0].Reason != FireWake {
		t.Fatalf("wake fire = %+v", res.Fires)
	}

	// Edge younger than debounce ⇒ held.
	in.Cursor = WakeCursor{Entries: map[string]WakeObservation{"a3f9": {Fingerprint: "F1", ObservedAt: T.Add(-5 * time.Second).Unix()}}}
	res = Evaluate(in)
	if len(res.Fires) != 0 || !hasDiag(res.Diags, "wake-debounced") {
		t.Errorf("debounced: fires=%+v diags=%v", res.Fires, diagReasons(res.Diags))
	}

	// No edge ⇒ no fire.
	in.Cursor = WakeCursor{Entries: map[string]WakeObservation{"a3f9": {Fingerprint: "F2", ObservedAt: T.Add(-time.Minute).Unix()}}}
	res = Evaluate(in)
	if len(res.Fires) != 0 {
		t.Errorf("no-edge fired: %+v", res.Fires)
	}

	// Unknown wake event ⇒ diagnostic, no fire.
	bad := entry
	bad.WakeOn = &WakeOn{Event: "bogus"}
	res = Evaluate(EvalInput{Server: "dev", Now: T, Entries: []Entry{bad}, Facts: facts, Fingerprint: "F2"})
	if len(res.Fires) != 0 || !hasDiag(res.Diags, "unknown-wake-event") {
		t.Errorf("unknown wake event: fires=%+v diags=%v", res.Fires, diagReasons(res.Diags))
	}
}

// TestEvaluateScheduleWakeBothDue: when both predicates are due the fire is
// emitted once with reason schedule.
func TestEvaluateScheduleWakeBothDue(t *testing.T) {
	T := backoffBase
	entry := Entry{
		ID:       "a3f9",
		Schedule: Schedule{Kind: ScheduleEvery, Interval: Duration{time.Hour}},
		WakeOn:   &WakeOn{Event: WakeAgentStateChange, Debounce: Duration{10 * time.Second}},
		Target:   Target{Kind: TargetPane, Pane: "%12"},
		Payload:  "tick",
		CreatedBy: CreatedBy{
			At: T.Add(-2 * time.Hour).Unix(),
		},
	}
	res := Evaluate(EvalInput{
		Server: "dev", Now: T, Entries: []Entry{entry},
		Facts:       map[string]TargetFacts{"a3f9": resolvedFacts("idle", T.Unix())},
		Fingerprint: "F2",
		Cursor:      WakeCursor{Entries: map[string]WakeObservation{"a3f9": {Fingerprint: "F1", ObservedAt: T.Add(-time.Minute).Unix()}}},
	})
	if len(res.Fires) != 1 || res.Fires[0].Reason != FireSchedule {
		t.Fatalf("fires = %+v, want one schedule fire", res.Fires)
	}
}

// TestEvaluateWakeFireCarriesNoRung: a wake-triggered fire on a backoff entry
// is not a ladder fire — Rung is 0 even though the ladder computed a rung.
func TestEvaluateWakeFireCarriesNoRung(t *testing.T) {
	T := backoffBase
	entry := Entry{
		ID:       "a3f9",
		Schedule: Schedule{Kind: ScheduleBackoff, Anchor: "operator-idle", Min: Duration{60 * time.Second}, Max: Duration{30 * time.Minute}},
		WakeOn:   &WakeOn{Event: WakeAgentStateChange, Scope: WakeScopeServer, Debounce: Duration{10 * time.Second}},
		Target:   Target{Kind: TargetRole, Role: RoleOperator},
		Payload:  "operator tick",
	}
	// Same ladder setup as TestEvaluateBackoffFire: at T+6m the schedule is
	// NOT due (the ladder sits at rung 3), but the wake edge fires.
	log := own(unix(T, time.Minute), unix(T, 3*time.Minute))
	facts := map[string]TargetFacts{"a3f9": resolvedFacts("idle", unix(T, 3*time.Minute+5*time.Second))}
	res := Evaluate(EvalInput{
		Server: "dev", Now: T.Add(6 * time.Minute), Entries: []Entry{entry}, Facts: facts, Log: log,
		Fingerprint: "F2",
		Cursor:      WakeCursor{Entries: map[string]WakeObservation{"a3f9": {Fingerprint: "F1", ObservedAt: T.Add(5 * time.Minute).Unix()}}},
	})
	if len(res.Fires) != 1 || res.Fires[0].Reason != FireWake {
		t.Fatalf("fires = %+v, want one wake fire", res.Fires)
	}
	if res.Fires[0].Rung != 0 {
		t.Errorf("rung = %d, want 0 for a wake fire", res.Fires[0].Rung)
	}
}

// TestEvaluateTargetUnresolved: a due fire with an unresolvable target is
// skipped with a diagnostic, not an error (R16).
func TestEvaluateTargetUnresolved(t *testing.T) {
	T := backoffBase
	entry := Entry{
		ID:       "a3f9",
		Schedule: Schedule{Kind: ScheduleEvery, Interval: Duration{time.Hour}},
		Target:   Target{Kind: TargetSession, Session: "dead"},
		Payload:  "tick",
		CreatedBy: CreatedBy{
			At: T.Add(-2 * time.Hour).Unix(),
		},
	}
	res := Evaluate(EvalInput{
		Server: "dev", Now: T, Entries: []Entry{entry},
		Facts: map[string]TargetFacts{"a3f9": {Unresolved: "no pane carries session dead"}},
	})
	if len(res.Fires) != 0 || !hasDiag(res.Diags, "target-unresolved") {
		t.Errorf("fires=%+v diags=%v", res.Fires, diagReasons(res.Diags))
	}
}

// TestEvaluateBackoffFire: the full backoff path through Evaluate — the
// anchor-join scenario end to end, including the emitted rung.
func TestEvaluateBackoffFire(t *testing.T) {
	T := backoffBase
	entry := Entry{
		ID:       "a3f9",
		Schedule: Schedule{Kind: ScheduleBackoff, Anchor: "operator-idle", Min: Duration{60 * time.Second}, Max: Duration{30 * time.Minute}},
		Target:   Target{Kind: TargetRole, Role: RoleOperator},
		Payload:  "operator tick",
	}
	// Deliveries at T+1m and T+3m; raw idle epoch 5s after the T+3m delivery
	// (attributed). Evaluated at T+7m the entry is due at rung 3.
	log := own(unix(T, time.Minute), unix(T, 3*time.Minute))
	facts := map[string]TargetFacts{"a3f9": resolvedFacts("idle", unix(T, 3*time.Minute+5*time.Second))}

	res := Evaluate(EvalInput{Server: "dev", Now: T.Add(7 * time.Minute), Entries: []Entry{entry}, Facts: facts, Log: log})
	if len(res.Fires) != 1 {
		t.Fatalf("fires = %+v, want the rung-3 fire", res.Fires)
	}
	if res.Fires[0].Rung != 3 {
		t.Errorf("rung = %d, want 3 (self-resetting-ladder check)", res.Fires[0].Rung)
	}
	if res.Fires[0].Reason != FireSchedule || res.Fires[0].PaneID != "%12" {
		t.Errorf("fire = %+v", res.Fires[0])
	}

	// Not yet due at T+6m.
	res = Evaluate(EvalInput{Server: "dev", Now: T.Add(6 * time.Minute), Entries: []Entry{entry}, Facts: facts, Log: log})
	if len(res.Fires) != 0 {
		t.Errorf("fired early at T+6m: %+v", res.Fires)
	}
}

// TestEvaluateAbsentFires: a due entry whose target did not resolve surfaces
// in EvalResult.Absent (empty PaneID) instead of being dropped — the tick
// orchestrator applies the entry's if_absent policy from there.
func TestEvaluateAbsentFires(t *testing.T) {
	T := backoffBase
	entry := Entry{
		ID:       "a3f9",
		Schedule: Schedule{Kind: ScheduleEvery, Interval: Duration{time.Hour}},
		Target:   Target{Kind: TargetSession, Session: "dead"},
		Payload:  "tick",
		IfAbsent: IfAbsentNotify,
		CreatedBy: CreatedBy{
			At: T.Add(-2 * time.Hour).Unix(),
		},
	}
	in := EvalInput{
		Server: "dev", Now: T, Entries: []Entry{entry},
		Facts: map[string]TargetFacts{"a3f9": {Unresolved: "no pane carries session dead"}},
	}
	res := Evaluate(in)
	if len(res.Fires) != 0 {
		t.Errorf("fires = %+v, want none (target unresolved)", res.Fires)
	}
	if len(res.Absent) != 1 {
		t.Fatalf("absent = %+v, want the one due-but-unresolved fire", res.Absent)
	}
	fire := res.Absent[0]
	if fire.PaneID != "" || fire.Entry.ID != "a3f9" || fire.Reason != FireSchedule {
		t.Errorf("absent fire = %+v, want empty PaneID on entry a3f9", fire)
	}
	if !hasDiag(res.Diags, "target-unresolved") {
		t.Errorf("diags = %v, want target-unresolved", diagReasons(res.Diags))
	}

	// Determinism covers the new field: equal inputs, deep-equal results.
	if again := Evaluate(in); !reflect.DeepEqual(res, again) {
		t.Errorf("non-deterministic result:\n first: %+v\nsecond: %+v", res, again)
	}
}

// TestEvaluateAbsentFireGuarded: guards are evaluated before an absent fire is
// emitted — a suppressed absent fire is a silent diagnostic (no emission, so
// no notify and no log line downstream).
func TestEvaluateAbsentFireGuarded(t *testing.T) {
	T := backoffBase
	entry := Entry{
		ID:            "a3f9",
		Schedule:      Schedule{Kind: ScheduleEvery, Interval: Duration{time.Hour}},
		SuppressWhile: []string{GuardNothingTracked},
		Target:        Target{Kind: TargetSession, Session: "dead"},
		Payload:       "tick",
		IfAbsent:      IfAbsentNotify,
		CreatedBy:     CreatedBy{At: T.Add(-2 * time.Hour).Unix()},
	}
	res := Evaluate(EvalInput{
		Server: "dev", Now: T, Entries: []Entry{entry},
		Facts: map[string]TargetFacts{"a3f9": {Unresolved: "no pane carries session dead"}},
		// Zero OperatorState: nothing tracked ⇒ the guard holds.
	})
	if len(res.Absent) != 0 || len(res.Fires) != 0 {
		t.Errorf("suppressed absent fire emitted: fires=%+v absent=%+v", res.Fires, res.Absent)
	}
	if !hasDiag(res.Diags, "suppressed") {
		t.Errorf("diags = %v, want suppressed", diagReasons(res.Diags))
	}
}

// TestEvaluateEntryCapDefense: a (hand-edited) file past MaxEntriesPerServer
// evaluates only the first cap-many entries; the excess are skipped with
// entry-cap-exceeded diagnostics.
func TestEvaluateEntryCapDefense(t *testing.T) {
	T := backoffBase
	entries := make([]Entry, MaxEntriesPerServer+2)
	for i := range entries {
		entries[i] = Entry{
			ID:        fmt.Sprintf("e%03d", i),
			Schedule:  Schedule{Kind: ScheduleEvery, Interval: Duration{time.Minute}},
			Target:    Target{Kind: TargetPane, Pane: "%1"},
			Payload:   "x",
			CreatedBy: CreatedBy{At: T.Add(-time.Hour).Unix()},
		}
	}
	res := Evaluate(EvalInput{Server: "dev", Now: T, Entries: entries})
	if len(res.Fires) != MaxEntriesPerServer {
		t.Errorf("fires = %d, want %d (only the first cap-many entries evaluate)", len(res.Fires), MaxEntriesPerServer)
	}
	capDiags := 0
	for _, d := range res.Diags {
		if d.Reason == "entry-cap-exceeded" {
			capDiags++
		}
	}
	if capDiags != 2 {
		t.Errorf("entry-cap-exceeded diagnostics = %d, want 2; diags = %v", capDiags, diagReasons(res.Diags))
	}
}
