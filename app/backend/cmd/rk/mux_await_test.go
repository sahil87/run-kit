package main

import (
	"context"
	"testing"
	"time"

	"rk/internal/tmux"
)

// awaitScript drives awaitObserve over a scripted fake: states are consumed one
// per readState call, the clock advances by each sleep, and file/notify are
// observable.
type awaitScript struct {
	states   []string // consumed in order; exhaustion returns an error
	goneAt   int      // read index at which the pane dies (-1 = never)
	files    map[string]bool
	reads    int
	sleeps   int
	now      time.Time
	notified []string
	readErr  error
}

func (s *awaitScript) deps(t *testing.T) awaitDeps {
	t.Helper()
	return awaitDeps{
		readState: func(_ context.Context, _ string) (string, bool, error) {
			if s.readErr != nil {
				return "", false, s.readErr
			}
			i := s.reads
			s.reads++
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
	report, err := awaitObserve(context.Background(), s.deps(t), "%5", awaitParams{until: []string{"idle"}})
	if err != nil || report != "idle" {
		t.Fatalf("report = %q err = %v, want idle/nil", report, err)
	}
	if s.sleeps != 0 {
		t.Errorf("sleeps = %d, want 0 for a pre-fired signal", s.sleeps)
	}
}

// TestAwaitStateReached: the observer polls until an --until state appears.
func TestAwaitStateReached(t *testing.T) {
	fastAwaitTick(t)
	s := &awaitScript{states: []string{"active", "active", "idle"}, goneAt: -1}
	report, err := awaitObserve(context.Background(), s.deps(t), "%5", awaitParams{until: []string{"idle"}})
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
	report, err := awaitObserve(context.Background(), s.deps(t), "%5", awaitParams{until: []string{"idle", "waiting"}})
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
	report, err := awaitObserve(context.Background(), deps, "%5", awaitParams{until: []string{"idle"}, file: "/tmp/out"})
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
	report, err := awaitObserve(context.Background(), s.deps(t), "%5",
		awaitParams{until: []string{"idle"}, timeout: 3 * time.Second})
	if err != nil || report != "running" {
		t.Fatalf("report = %q err = %v, want running/nil", report, err)
	}
}

// TestAwaitGone: the pane dying mid-wait reports `gone` with an operational
// error (exit 1); the report word is still returned for stdout.
func TestAwaitGone(t *testing.T) {
	fastAwaitTick(t)
	s := &awaitScript{states: []string{"active"}, goneAt: 1}
	report, err := awaitObserve(context.Background(), s.deps(t), "%5", awaitParams{until: []string{"idle"}})
	if err == nil || exitCode(err) != 1 {
		t.Fatalf("err = %v, want exit-1 operational", err)
	}
	if report != "gone" {
		t.Errorf("report = %q, want gone", report)
	}
}

// TestAwaitFiredSignalWinsOverDeath: a file that appears in the SAME tick the
// pane dies still reports `file` (the fired signal wins).
func TestAwaitFiredSignalWinsOverDeath(t *testing.T) {
	fastAwaitTick(t)
	s := &awaitScript{states: []string{"active"}, goneAt: 1, files: map[string]bool{"/tmp/out": true}}
	report, err := awaitObserve(context.Background(), s.deps(t), "%5",
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
	report, err := awaitObserve(context.Background(), s.deps(t), "%5", awaitParams{until: []string{"idle"}})
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
	report, err := awaitObserve(context.Background(), s.deps(t), "%5",
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
	report, err := awaitObserve(context.Background(), s.deps(t), "%5", awaitParams{until: []string{"idle"}})
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
	report, err := awaitObserve(ctx, deps, "%5", awaitParams{until: []string{"idle"}, timeout: 150 * time.Millisecond})
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
	_, err := awaitObserve(ctx, deps, "%5", awaitParams{until: []string{"idle"}, timeout: 30 * time.Second})
	if err == nil {
		t.Fatal("err = nil, want the ctx cancellation to abort the wait")
	}
	if elapsed := time.Since(start); elapsed > 5*time.Second {
		t.Errorf("abort took %v — the parent cancellation did not reach the loop", elapsed)
	}
}
