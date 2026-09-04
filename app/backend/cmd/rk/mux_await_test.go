package main

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"rk/internal/inject"
	"rk/internal/tmux"
)

// awaitScript drives awaitObserve over a scripted fake: states are consumed
// one per readState call, the clock advances by each sleep, and file/notify
// are observable. Multi-target tests set byPane (pane ID → its own script);
// the top-level fields are the single-target fallback.
type awaitScript struct {
	states   []string // consumed in order; exhaustion returns an error
	goneAt   int      // read index at which the pane dies (-1 = never)
	byPane   map[string]*awaitPaneScript
	files    map[string]bool
	reads    int // total reads across panes
	sleeps   int
	now      time.Time
	notified []string
	readErr  error
}

// awaitPaneScript is one pane's per-read script under --any: states consumed
// in order, dying at read index goneAt (-1 = never).
type awaitPaneScript struct {
	states []string
	goneAt int
	reads  int
}

func (s *awaitScript) deps(t *testing.T) awaitDeps {
	t.Helper()
	return awaitDeps{
		readState: func(_ context.Context, paneID string) (string, bool, error) {
			if s.readErr != nil {
				return "", false, s.readErr
			}
			s.reads++
			if ps, ok := s.byPane[paneID]; ok {
				i := ps.reads
				ps.reads++
				if ps.goneAt >= 0 && i >= ps.goneAt {
					return "", true, nil
				}
				if i >= len(ps.states) {
					t.Fatalf("readState(%s) called beyond the script", paneID)
				}
				return ps.states[i], false, nil
			}
			i := s.reads - 1
			if s.goneAt >= 0 && i >= s.goneAt {
				return "", true, nil
			}
			if i >= len(s.states) {
				t.Fatal("readState called beyond the script")
			}
			return s.states[i], false, nil
		},
		fileStat: func(path string) bool { return s.files[path] },
		sleep: func(_ context.Context, d time.Duration) error {
			s.sleeps++
			s.now = s.now.Add(d)
			return nil
		},
		now:    func() time.Time { return s.now },
		notify: func(_ context.Context, _, body string) { s.notified = append(s.notified, body) },
	}
}

func fastAwaitTick(t *testing.T) {
	t.Helper()
	orig := awaitPollTick
	awaitPollTick = time.Second
	t.Cleanup(func() { awaitPollTick = orig })
}

// TestAwaitAlreadyIdleReturnsImmediately: an already-fired signal returns with
// NO sleep (first check before any sleep — R8).
func TestAwaitAlreadyIdleReturnsImmediately(t *testing.T) {
	fastAwaitTick(t)
	s := &awaitScript{states: []string{tmux.AgentStateIdle}, goneAt: -1}
	report, firedPane, err := awaitObserve(context.Background(), s.deps(t), []string{"%5"}, awaitParams{until: []string{"idle"}})
	if err != nil || report != "idle" || firedPane != "%5" {
		t.Fatalf("report = %q firedPane = %q err = %v, want idle/%%5/nil", report, firedPane, err)
	}
	if s.sleeps != 0 {
		t.Errorf("sleeps = %d, want 0 for a pre-fired signal", s.sleeps)
	}
}

// TestAwaitStateReached: the observer polls until an --until state appears.
func TestAwaitStateReached(t *testing.T) {
	fastAwaitTick(t)
	s := &awaitScript{states: []string{"active", "active", "idle"}, goneAt: -1}
	report, _, err := awaitObserve(context.Background(), s.deps(t), []string{"%5"}, awaitParams{until: []string{"idle"}})
	if err != nil || report != "idle" {
		t.Fatalf("report = %q err = %v", report, err)
	}
	if s.sleeps != 2 {
		t.Errorf("sleeps = %d, want 2 (two not-yet ticks)", s.sleeps)
	}
}

// TestAwaitUntilSet: a state SET wakes on any member — waiting reports
// "waiting" (the conversational wake, R8's --until extension).
func TestAwaitUntilSet(t *testing.T) {
	fastAwaitTick(t)
	s := &awaitScript{states: []string{"active", "waiting"}, goneAt: -1}
	report, _, err := awaitObserve(context.Background(), s.deps(t), []string{"%5"}, awaitParams{until: []string{"idle", "waiting"}})
	if err != nil || report != "waiting" {
		t.Fatalf("report = %q err = %v, want waiting", report, err)
	}
}

// TestAwaitFileSignal: the --file signal is OR-composed — it fires while the
// state never reaches an --until state.
func TestAwaitFileSignal(t *testing.T) {
	fastAwaitTick(t)
	s := &awaitScript{
		states: []string{"active", "active", "active"},
		goneAt: -1,
		files:  map[string]bool{},
	}
	deps := s.deps(t)
	// The file appears after the second read.
	origStat := deps.fileStat
	deps.fileStat = func(path string) bool {
		if s.reads >= 2 {
			return true
		}
		return origStat(path)
	}
	report, _, err := awaitObserve(context.Background(), deps, []string{"%5"}, awaitParams{until: []string{"idle"}, file: "/tmp/out"})
	if err != nil || report != "file" {
		t.Fatalf("report = %q err = %v, want file", report, err)
	}
}

// TestAwaitTimeoutReportsRunning: an expiring --timeout reports `running` with
// NO error (exit 0 — the timeout bounds the observer, never the pane).
func TestAwaitTimeoutReportsRunning(t *testing.T) {
	fastAwaitTick(t)
	s := &awaitScript{
		states: []string{"active", "active", "active", "active", "active", "active"},
		goneAt: -1,
	}
	report, firedPane, err := awaitObserve(context.Background(), s.deps(t), []string{"%5"},
		awaitParams{until: []string{"idle"}, timeout: 3 * time.Second})
	if err != nil || report != "running" || firedPane != "" {
		t.Fatalf("report = %q firedPane = %q err = %v, want running/\"\"/nil", report, firedPane, err)
	}
}

// TestAwaitGone: the pane dying mid-wait reports `gone` with an operational
// error (exit 1); the report word is still returned for stdout.
func TestAwaitGone(t *testing.T) {
	fastAwaitTick(t)
	s := &awaitScript{states: []string{"active"}, goneAt: 1}
	report, firedPane, err := awaitObserve(context.Background(), s.deps(t), []string{"%5"}, awaitParams{until: []string{"idle"}})
	if err == nil || exitCode(err) != 1 {
		t.Fatalf("err = %v, want exit-1 operational", err)
	}
	if report != "gone" || firedPane != "%5" {
		t.Errorf("report = %q firedPane = %q, want gone/%%5", report, firedPane)
	}
}

// TestAwaitFiredSignalWinsOverDeath: a file that appears in the SAME tick the
// pane dies still reports `file` (the fired signal wins).
func TestAwaitFiredSignalWinsOverDeath(t *testing.T) {
	fastAwaitTick(t)
	s := &awaitScript{states: []string{"active"}, goneAt: 1, files: map[string]bool{"/tmp/out": true}}
	report, _, err := awaitObserve(context.Background(), s.deps(t), []string{"%5"},
		awaitParams{until: []string{"idle"}, file: "/tmp/out"})
	if err != nil || report != "file" {
		t.Fatalf("report = %q err = %v, want file/nil (fired signal beats pane death)", report, err)
	}
}

// TestAwaitUninstrumentedNoFileErrors: an uninstrumented pane (no
// @rk_agent_state) with no --file errors IMMEDIATELY — nothing observable.
func TestAwaitUninstrumentedNoFileErrors(t *testing.T) {
	fastAwaitTick(t)
	s := &awaitScript{states: []string{""}, goneAt: -1}
	report, _, err := awaitObserve(context.Background(), s.deps(t), []string{"%5"}, awaitParams{until: []string{"idle"}})
	if err == nil {
		t.Fatal("err = nil, want the nothing-observable error")
	}
	if report != "" {
		t.Errorf("report = %q, want none", report)
	}
	if s.sleeps != 0 {
		t.Errorf("sleeps = %d, want an immediate error with no polling", s.sleeps)
	}
}

// TestAwaitAfterActive: --after-active requires the active→idle round-trip — an
// already-idle pane does NOT count until an active sighting precedes it.
func TestAwaitAfterActive(t *testing.T) {
	fastAwaitTick(t)
	s := &awaitScript{states: []string{"idle", "idle", "active", "idle"}, goneAt: -1}
	report, _, err := awaitObserve(context.Background(), s.deps(t), []string{"%5"},
		awaitParams{until: []string{"idle"}, afterActive: true})
	if err != nil || report != "idle" {
		t.Fatalf("report = %q err = %v", report, err)
	}
	if s.reads != 4 {
		t.Errorf("reads = %d, want 4 (pre-active idle readings must not count)", s.reads)
	}
}

// TestAwaitReadFailure: a substrate read failure (not a death) propagates as an
// operational error with no report.
func TestAwaitReadFailure(t *testing.T) {
	fastAwaitTick(t)
	s := &awaitScript{goneAt: -1, readErr: context.DeadlineExceeded}
	report, _, err := awaitObserve(context.Background(), s.deps(t), []string{"%5"}, awaitParams{until: []string{"idle"}})
	if err == nil {
		t.Fatal("err = nil, want the read failure")
	}
	if report != "" {
		t.Errorf("report = %q, want none", report)
	}
}

func TestParseUntilStates(t *testing.T) {
	for _, ok := range []string{"idle", "idle,waiting", "active,waiting,idle", " idle , waiting "} {
		if _, err := parseUntilStates(ok); err != nil {
			t.Errorf("parseUntilStates(%q) err = %v, want nil", ok, err)
		}
	}
	for _, bad := range []string{"", "busy", "idle,busy", "idle,idle", "Idle"} {
		if _, err := parseUntilStates(bad); err == nil {
			t.Errorf("parseUntilStates(%q) = nil error, want rejection", bad)
		}
	}
}

// TestMuxAwaitCmdEndToEnd drives `rk mux await` through the real cobra path
// with faked deps: an already-idle pane reports `idle` immediately; --notify
// fires the default message; a gone pane prints `gone` and exits 1.
func TestMuxAwaitCmdEndToEnd(t *testing.T) {
	fastAwaitTick(t)
	s := &awaitScript{states: []string{tmux.AgentStateIdle}, goneAt: -1}
	f := &muxFake{}
	installMuxFakes(t, f)

	origDeps := muxAwaitDepsFn
	muxAwaitDepsFn = func(string) awaitDeps { return s.deps(t) }
	t.Cleanup(func() { muxAwaitDepsFn = origDeps })

	stdout, _, err := runMuxCmd(t, "await", "%5", "--notify")
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	if stdout != "idle\n" {
		t.Errorf("stdout = %q, want the one-word idle report", stdout)
	}
	if len(s.notified) != 1 || s.notified[0] != "agent %5 is idle" {
		t.Errorf("notify = %v, want the default-derived message", s.notified)
	}

	// gone → report + exit 1.
	s2 := &awaitScript{states: []string{"active"}, goneAt: 1}
	muxAwaitDepsFn = func(string) awaitDeps { return s2.deps(t) }
	stdout, _, err = runMuxCmd(t, "await", "%5")
	if err == nil || exitCode(err) != 1 {
		t.Fatalf("gone: err = %v, want exit 1", err)
	}
	if stdout != "gone\n" {
		t.Errorf("gone: stdout = %q", stdout)
	}
}

// TestMuxAwaitWindowTarget: a window target resolves to its agent pane before
// the wait begins.
func TestMuxAwaitWindowTarget(t *testing.T) {
	fastAwaitTick(t)
	s := &awaitScript{states: []string{tmux.AgentStateIdle}, goneAt: -1}
	f := &muxFake{}
	installMuxFakes(t, f)

	var readPane string
	deps := s.deps(t)
	origRead := deps.readState
	deps.readState = func(ctx context.Context, paneID string) (string, bool, error) {
		readPane = paneID
		return origRead(ctx, paneID)
	}
	origDeps := muxAwaitDepsFn
	muxAwaitDepsFn = func(string) awaitDeps { return deps }
	t.Cleanup(func() { muxAwaitDepsFn = origDeps })

	stdout, _, err := runMuxCmd(t, "await", "@3")
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	if readPane != "%7" {
		t.Errorf("await read pane %q, want the resolved agent pane %%7", readPane)
	}
	if stdout != "idle\n" {
		t.Errorf("stdout = %q, want the one-word idle report", stdout)
	}
}

// TestMuxAwaitUsageErrors: bad targets and bad --until values are usage errors
// (exit 2) with empty stdout.
func TestMuxAwaitUsageErrors(t *testing.T) {
	f := &muxFake{}
	installMuxFakes(t, f)
	for _, args := range [][]string{
		{"await", "bare:name"},
		{"await", "%5", "--until", "busy"},
		{"await", "%5", "--timeout", "-1"},
	} {
		stdout, _, err := runMuxCmd(t, args...)
		if err == nil || exitCode(err) != exitUsage {
			t.Errorf("args %v: err = %v, want usage exit 2", args, err)
		}
		if stdout != "" {
			t.Errorf("args %v: stdout = %q, want empty", args, stdout)
		}
	}
}

// TestAwaitObserverDeadlineIsItsOwnTimeout: the observer's bound is its OWN
// --timeout, never the caller's context — a generous parent ctx must not cut
// the wait short, so a 150ms observer timeout reports `running` even with a
// 30s ctx behind it (the command layer used to wrap the whole loop in a 5s
// budget, making every longer wait unreachable). Real clock, real sleeps.
func TestAwaitObserverDeadlineIsItsOwnTimeout(t *testing.T) {
	orig := awaitPollTick
	awaitPollTick = 10 * time.Millisecond
	t.Cleanup(func() { awaitPollTick = orig })

	deps := awaitDeps{
		readState: func(context.Context, string) (string, bool, error) { return "active", false, nil },
		fileStat:  func(string) bool { return false },
		sleep:     sleepCtxCmd,
		now:       time.Now,
		notify:    func(context.Context, string, string) {},
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	start := time.Now()
	report, _, err := awaitObserve(ctx, deps, []string{"%5"}, awaitParams{until: []string{"idle"}, timeout: 150 * time.Millisecond})
	if err != nil || report != "running" {
		t.Fatalf("report = %q err = %v, want running/nil at the observer's own timeout", report, err)
	}
	if elapsed := time.Since(start); elapsed < 150*time.Millisecond {
		t.Errorf("returned after %v, before the observer's own 150ms timeout", elapsed)
	}
}

// TestAwaitParentCancelAborts: the parent ctx is the observer's CANCELLATION
// path (Ctrl-C) — a cancelled ctx aborts promptly even with a far longer
// observer timeout.
func TestAwaitParentCancelAborts(t *testing.T) {
	orig := awaitPollTick
	awaitPollTick = 10 * time.Millisecond
	t.Cleanup(func() { awaitPollTick = orig })

	deps := awaitDeps{
		readState: func(context.Context, string) (string, bool, error) { return "active", false, nil },
		fileStat:  func(string) bool { return false },
		sleep:     sleepCtxCmd,
		now:       time.Now,
		notify:    func(context.Context, string, string) {},
	}
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()

	start := time.Now()
	_, _, err := awaitObserve(ctx, deps, []string{"%5"}, awaitParams{until: []string{"idle"}, timeout: 30 * time.Second})
	if err == nil {
		t.Fatal("err = nil, want the ctx cancellation to abort the wait")
	}
	if elapsed := time.Since(start); elapsed > 5*time.Second {
		t.Errorf("abort took %v — the parent cancellation did not reach the loop", elapsed)
	}
}

// TestAwaitAnySecondPaneWakes: the any-of sweep wakes on the FIRST member in
// listed order whose state is in --until — a later pane can fire while earlier
// panes stay active, and it is named as the firing pane.
func TestAwaitAnySecondPaneWakes(t *testing.T) {
	fastAwaitTick(t)
	s := &awaitScript{byPane: map[string]*awaitPaneScript{
		"%1": {states: []string{"active", "active"}, goneAt: -1},
		"%5": {states: []string{"active", "waiting"}, goneAt: -1},
	}}
	report, firedPane, err := awaitObserve(context.Background(), s.deps(t), []string{"%1", "%5"},
		awaitParams{until: []string{"idle", "waiting"}})
	if err != nil || report != "waiting" || firedPane != "%5" {
		t.Fatalf("report = %q firedPane = %q err = %v, want waiting/%%5/nil", report, firedPane, err)
	}
	if s.sleeps != 1 {
		t.Errorf("sleeps = %d, want 1 (second sweep fires)", s.sleeps)
	}
}

// TestAwaitAnyAlreadyFiredMemberReturnsImmediately: an already-fired member
// returns on the FIRST sweep with NO sleep — the poll-after-arm guarantee on
// the multi-target path (backlog [tqkt] MUST (b)).
func TestAwaitAnyAlreadyFiredMemberReturnsImmediately(t *testing.T) {
	fastAwaitTick(t)
	s := &awaitScript{byPane: map[string]*awaitPaneScript{
		"%1": {states: []string{"active"}, goneAt: -1},
		"%5": {states: []string{"idle"}, goneAt: -1},
	}}
	report, firedPane, err := awaitObserve(context.Background(), s.deps(t), []string{"%1", "%5"},
		awaitParams{until: []string{"idle"}})
	if err != nil || report != "idle" || firedPane != "%5" {
		t.Fatalf("report = %q firedPane = %q err = %v, want idle/%%5/nil", report, firedPane, err)
	}
	if s.sleeps != 0 {
		t.Errorf("sleeps = %d, want 0 for a pre-fired member", s.sleeps)
	}
}

// TestAwaitAnyAfterActivePerPane: --after-active is tracked PER pane — %5
// being idle since arm never fires without ITS OWN active sighting, and %1's
// active flip does not unlock it.
func TestAwaitAnyAfterActivePerPane(t *testing.T) {
	fastAwaitTick(t)
	s := &awaitScript{byPane: map[string]*awaitPaneScript{
		"%1": {states: []string{"active", "active", "idle"}, goneAt: -1},
		"%5": {states: []string{"idle", "idle", "idle"}, goneAt: -1},
	}}
	report, firedPane, err := awaitObserve(context.Background(), s.deps(t), []string{"%5", "%1"},
		awaitParams{until: []string{"idle"}, afterActive: true})
	if err != nil || report != "idle" || firedPane != "%1" {
		t.Fatalf("report = %q firedPane = %q err = %v, want idle/%%1/nil (%%5 never went active)", report, firedPane, err)
	}
	if s.byPane["%5"].reads != 3 {
		t.Errorf("%%5 reads = %d, want 3 (its idle readings never counted)", s.byPane["%5"].reads)
	}
}

// TestAwaitAnySignalWinsOverSameSweepDeath: a state signal on a later member
// in the SAME sweep beats an earlier member's death — the sweep continues
// past the gone pane and reports the fired signal.
func TestAwaitAnySignalWinsOverSameSweepDeath(t *testing.T) {
	fastAwaitTick(t)
	s := &awaitScript{byPane: map[string]*awaitPaneScript{
		"%1": {states: []string{"active"}, goneAt: 1},
		"%5": {states: []string{"active", "waiting"}, goneAt: -1},
	}}
	report, firedPane, err := awaitObserve(context.Background(), s.deps(t), []string{"%1", "%5"},
		awaitParams{until: []string{"waiting"}})
	if err != nil || report != "waiting" || firedPane != "%5" {
		t.Fatalf("report = %q firedPane = %q err = %v, want waiting/%%5/nil (fired signal beats death)", report, firedPane, err)
	}
}

// TestAwaitAnyGoneWakesWhenNothingFired: a member death with no same-sweep
// signal reports `gone` naming the dead pane, with an operational error
// (exit 1) — immediate death detection for armed panes.
func TestAwaitAnyGoneWakesWhenNothingFired(t *testing.T) {
	fastAwaitTick(t)
	s := &awaitScript{byPane: map[string]*awaitPaneScript{
		"%1": {states: []string{"active", "active"}, goneAt: 2},
		"%5": {states: []string{"active", "active", "active"}, goneAt: -1},
	}}
	report, firedPane, err := awaitObserve(context.Background(), s.deps(t), []string{"%1", "%5"},
		awaitParams{until: []string{"idle"}})
	if err == nil || exitCode(err) != 1 {
		t.Fatalf("err = %v, want exit-1 operational", err)
	}
	if report != "gone" || firedPane != "%1" {
		t.Errorf("report = %q firedPane = %q, want gone/%%1", report, firedPane)
	}
}

// TestAwaitAnyUninstrumentedMemberFailsArm: an uninstrumented member (no
// @rk_agent_state) with no --file fails the WHOLE arm on the first sweep,
// naming the offending pane.
func TestAwaitAnyUninstrumentedMemberFailsArm(t *testing.T) {
	fastAwaitTick(t)
	s := &awaitScript{byPane: map[string]*awaitPaneScript{
		"%1": {states: []string{"active"}, goneAt: -1},
		"%9": {states: []string{""}, goneAt: -1},
	}}
	report, _, err := awaitObserve(context.Background(), s.deps(t), []string{"%1", "%9"},
		awaitParams{until: []string{"idle"}})
	if err == nil {
		t.Fatal("err = nil, want the nothing-observable error")
	}
	if report != "" {
		t.Errorf("report = %q, want none", report)
	}
	if s.sleeps != 0 {
		t.Errorf("sleeps = %d, want an immediate failure with no polling", s.sleeps)
	}
}

// TestAwaitAnyEarlyMatchStillFailsOnLaterUninstrumented: the FIRST sweep is
// the arm validation — a match on an earlier member is held until every member
// proved observable, so a later uninstrumented pane still fails the whole arm
// (the unobservable error outranks the held match), naming the offending pane.
func TestAwaitAnyEarlyMatchStillFailsOnLaterUninstrumented(t *testing.T) {
	fastAwaitTick(t)
	s := &awaitScript{byPane: map[string]*awaitPaneScript{
		"%1": {states: []string{"idle"}, goneAt: -1},
		"%9": {states: []string{""}, goneAt: -1},
	}}
	report, firedPane, err := awaitObserve(context.Background(), s.deps(t), []string{"%1", "%9"},
		awaitParams{until: []string{"idle"}})
	if err == nil {
		t.Fatal("err = nil, want the nothing-observable error despite %1's first-sweep match")
	}
	if !strings.Contains(err.Error(), "%9") {
		t.Errorf("err = %q, want it to name the uninstrumented pane %%9", err)
	}
	if report != "" || firedPane != "" {
		t.Errorf("report = %q firedPane = %q, want none (error outranks the held match)", report, firedPane)
	}
	if s.sleeps != 0 {
		t.Errorf("sleeps = %d, want an immediate first-sweep failure", s.sleeps)
	}
}

// TestAwaitAnyTimeoutReportsRunning: the whole-invocation observer bound
// reports bare `running` (no pane) on expiry, exit 0.
func TestAwaitAnyTimeoutReportsRunning(t *testing.T) {
	fastAwaitTick(t)
	s := &awaitScript{byPane: map[string]*awaitPaneScript{
		"%1": {states: []string{"active", "active", "active", "active"}, goneAt: -1},
		"%5": {states: []string{"active", "active", "active", "active"}, goneAt: -1},
	}}
	report, firedPane, err := awaitObserve(context.Background(), s.deps(t), []string{"%1", "%5"},
		awaitParams{until: []string{"idle"}, timeout: 3 * time.Second})
	if err != nil || report != "running" || firedPane != "" {
		t.Fatalf("report = %q firedPane = %q err = %v, want running/\"\"/nil", report, firedPane, err)
	}
}

// TestMuxAwaitAnyCmdEndToEnd: `rk mux await --any` through the real cobra path
// — the multi-target report appends the firing pane (`waiting %5`), and the
// default --notify message carries it.
func TestMuxAwaitAnyCmdEndToEnd(t *testing.T) {
	fastAwaitTick(t)
	s := &awaitScript{byPane: map[string]*awaitPaneScript{
		"%1": {states: []string{"active"}, goneAt: -1},
		"%5": {states: []string{"waiting"}, goneAt: -1},
	}}
	f := &muxFake{}
	installMuxFakes(t, f)

	origDeps := muxAwaitDepsFn
	muxAwaitDepsFn = func(string) awaitDeps { return s.deps(t) }
	t.Cleanup(func() { muxAwaitDepsFn = origDeps })

	stdout, _, err := runMuxCmd(t, "await", "--any", "%1", "%5", "--until", "waiting", "--notify")
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	if stdout != "waiting %5\n" {
		t.Errorf("stdout = %q, want the multi-target report with the firing pane", stdout)
	}
	if len(s.notified) != 1 || s.notified[0] != "agent %5 is waiting" {
		t.Errorf("notify = %v, want the default message naming the firing pane", s.notified)
	}
}

// TestMuxAwaitAnyWindowAndDuplicateTargets: full grammar per member (a window
// target resolves up front), and two targets resolving to the same pane are a
// usage error naming the duplicate.
func TestMuxAwaitAnyWindowAndDuplicateTargets(t *testing.T) {
	fastAwaitTick(t)
	f := &muxFake{}
	installMuxFakes(t, f)

	s := &awaitScript{byPane: map[string]*awaitPaneScript{
		"%1": {states: []string{"active"}, goneAt: -1},
		"%7": {states: []string{"idle"}, goneAt: -1},
	}}
	origDeps := muxAwaitDepsFn
	muxAwaitDepsFn = func(string) awaitDeps { return s.deps(t) }
	t.Cleanup(func() { muxAwaitDepsFn = origDeps })

	// @3 resolves to %7 via the muxFake window map.
	stdout, _, err := runMuxCmd(t, "await", "--any", "%1", "@3")
	if err != nil {
		t.Fatalf("window target: err = %v", err)
	}
	if stdout != "idle %7\n" {
		t.Errorf("window target: stdout = %q, want the resolved agent pane named", stdout)
	}

	// %1 and =work:editor both resolve to %7's family — use %1 + a window that
	// resolves to %1 for a true duplicate.
	f.windowPanes["@4"] = "%1"
	stdout, _, err = runMuxCmd(t, "await", "--any", "%1", "@4")
	if err == nil || exitCode(err) != exitUsage {
		t.Fatalf("duplicate: err = %v, want usage exit 2", err)
	}
	if stdout != "" {
		t.Errorf("duplicate: stdout = %q, want empty", stdout)
	}
}

// TestMuxAwaitAnyUsageErrors: multi-target without --any is a usage error
// (exactly one target in single-target mode), and a bad grammar member under
// --any is rejected per member.
func TestMuxAwaitAnyUsageErrors(t *testing.T) {
	f := &muxFake{}
	installMuxFakes(t, f)
	for _, args := range [][]string{
		{"await", "%1", "%2"},                 // two targets without --any
		{"await", "--any", "%1", "bare:name"}, // bad grammar per member
	} {
		stdout, _, err := runMuxCmd(t, args...)
		if err == nil || exitCode(err) != exitUsage {
			t.Errorf("args %v: err = %v, want usage exit 2", args, err)
		}
		if stdout != "" {
			t.Errorf("args %v: stdout = %q, want empty", args, stdout)
		}
	}
}

// readyCall records one muxAwaitReadyFn invocation for the --ready tests.
type readyCall struct {
	pane    string
	timeout time.Duration
}

// stubAwaitReady points the --ready wait seam at a fake returning (readiness,
// err), recording the pane and timeout it was called with.
func stubAwaitReady(t *testing.T, readiness inject.Readiness, err error) *readyCall {
	t.Helper()
	rec := &readyCall{}
	orig := muxAwaitReadyFn
	muxAwaitReadyFn = func(_ context.Context, _, paneID string, timeout time.Duration) (inject.Readiness, error) {
		rec.pane, rec.timeout = paneID, timeout
		return readiness, err
	}
	t.Cleanup(func() { muxAwaitReadyFn = orig })
	return rec
}

// TestMuxAwaitReadyReports: --ready reports which readiness signal fired, and
// --timeout reaches the wait seam in seconds.
func TestMuxAwaitReadyReports(t *testing.T) {
	f := &muxFake{}
	installMuxFakes(t, f)
	for _, tc := range []struct {
		name      string
		readiness inject.Readiness
		want      string
	}{
		{"state signal", inject.ReadyByState, "ready %5 (state)\n"},
		{"settle signal", inject.ReadyBySettle, "ready %5 (settled)\n"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rec := stubAwaitReady(t, tc.readiness, nil)
			stdout, _, err := runMuxCmd(t, "await", "%5", "--ready", "--timeout", "120")
			if err != nil {
				t.Fatalf("err = %v", err)
			}
			if stdout != tc.want {
				t.Errorf("stdout = %q, want %q", stdout, tc.want)
			}
			if rec.pane != "%5" || rec.timeout != 120*time.Second {
				t.Errorf("wait call = (pane %q, timeout %s), want (%%5, 120s)", rec.pane, rec.timeout)
			}
		})
	}
}

// TestMuxAwaitReadyTimeoutReportsRunning: a readiness deadline keeps the await
// family's timeout contract — `running` on stdout, exit 0 — and --notify fires
// on that report.
func TestMuxAwaitReadyTimeoutReportsRunning(t *testing.T) {
	f := &muxFake{}
	installMuxFakes(t, f)
	stubAwaitReady(t, 0, inject.ErrNotReady)
	s := &awaitScript{goneAt: -1}
	origDeps := muxAwaitDepsFn
	muxAwaitDepsFn = func(string) awaitDeps { return s.deps(t) }
	t.Cleanup(func() { muxAwaitDepsFn = origDeps })

	stdout, _, err := runMuxCmd(t, "await", "%5", "--ready", "--timeout", "5", "--notify")
	if err != nil {
		t.Fatalf("err = %v, want nil (timeout is a report, not a failure)", err)
	}
	if stdout != "running\n" {
		t.Errorf("stdout = %q, want the running report", stdout)
	}
	if len(s.notified) != 1 || s.notified[0] != "agent %5 is running" {
		t.Errorf("notify = %v, want the default-derived message", s.notified)
	}
}

// TestMuxAwaitReadyOperationalError: a non-deadline wait failure (e.g. the
// pane died) is an operational error, exit 1, with no report line.
func TestMuxAwaitReadyOperationalError(t *testing.T) {
	f := &muxFake{}
	installMuxFakes(t, f)
	stubAwaitReady(t, 0, fmt.Errorf("read pane state: boom"))
	stdout, _, err := runMuxCmd(t, "await", "%5", "--ready")
	if err == nil || exitCode(err) != 1 {
		t.Fatalf("err = %v, want exit 1", err)
	}
	if stdout != "" {
		t.Errorf("stdout = %q, want empty", stdout)
	}
}

// TestMuxAwaitReadyFlagConflicts: --ready is mutually exclusive with the
// state/file conditions and the multi-target arm (usage error, exit 2).
func TestMuxAwaitReadyFlagConflicts(t *testing.T) {
	f := &muxFake{}
	installMuxFakes(t, f)
	for _, args := range [][]string{
		{"await", "%5", "--ready", "--until", "waiting"},
		{"await", "%5", "--ready", "--file", "/tmp/x"},
		{"await", "%5", "--ready", "--after-active"},
		{"await", "--any", "%5", "%6", "--ready"},
	} {
		stdout, _, err := runMuxCmd(t, args...)
		if err == nil || exitCode(err) != exitUsage {
			t.Errorf("args %v: err = %v, want usage exit 2", args, err)
		}
		if stdout != "" {
			t.Errorf("args %v: stdout = %q, want empty", args, stdout)
		}
	}
}
