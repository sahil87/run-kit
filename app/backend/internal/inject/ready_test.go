package inject

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"
)

// noSleep makes the readiness poll loop run without real waiting.
func noSleep(time.Duration) {}

// stateScript returns a State func consuming (value, err) pairs in order,
// repeating the last once exhausted.
func stateScript(pairs ...[2]any) func(context.Context, string, string) (string, error) {
	idx := 0
	return func(context.Context, string, string) (string, error) {
		if len(pairs) == 0 {
			return "", nil
		}
		if idx >= len(pairs) {
			idx = len(pairs) - 1
		}
		p := pairs[idx]
		idx++
		state, _ := p[0].(string)
		err, _ := p[1].(error)
		return state, err
	}
}

func sp(state string, err error) [2]any { return [2]any{state, err} }

func TestAwaitReadyEchoClassifies(t *testing.T) {
	fastProbe(t)
	// The state reader errors on every poll (hook-less agent); the capture
	// settles on the third poll, triggering the sentinel probe: paste → novel
	// echo → C-u clear verified against the settled baseline → ReadyByEcho.
	ft := &fakeTmux{captureResults: []string{
		"booting…", "prompt>", "prompt>", // settle on the third poll
		"prompt>",                 // guard recheck: frame unchanged, probe proceeds
		"prompt> #rk-ready-probe", // probe: sentinel newly echoed
		"prompt>",                 // clear verify: baseline restored
	}}
	r, err := AwaitReady(context.Background(), ft, "srv", "%1", ReadyOpts{
		State:      stateScript(sp("", errors.New("no hooks"))),
		BufferName: "rk-ready-test",
		Sleep:      noSleep,
	})
	if err != nil {
		t.Fatalf("AwaitReady() = %v", err)
	}
	if r != ReadyByEcho {
		t.Errorf("readiness = %v, want ReadyByEcho", r)
	}
	if ft.bufferName != "rk-ready-test" || ft.bufferText != "#rk-ready-probe" {
		t.Errorf("probe buffer = (%q, %q), want (rk-ready-test, #rk-ready-probe)", ft.bufferName, ft.bufferText)
	}
	if got := countCalls(ft.callStream(), "send-keys C-u"); got != 1 {
		t.Errorf("C-u clears = %d, want 1 (the probe cleans up after itself)", got)
	}
	if ft.enterCalled {
		t.Error("the probe must never submit (no Enter on any path)")
	}
}

func TestAwaitReadyStaleSentinelNeedsNovelty(t *testing.T) {
	fastProbe(t)
	// The settled screen ALREADY shows the sentinel text (stale occurrence from
	// an earlier probe): only a count INCREASE satisfies the echo check. Here
	// the paste adds a fresh occurrence on top of the stale one.
	settled := "last probe: #rk-ready-probe\nprompt>"
	ft := &fakeTmux{captureResults: []string{
		settled, settled, // settle with the stale sentinel in-frame
		settled,                      // guard recheck
		settled + " #rk-ready-probe", // echo: count 2 > baseline 1
		settled, // clear verify
	}}
	r, err := AwaitReady(context.Background(), ft, "srv", "%1", ReadyOpts{Sleep: noSleep})
	if err != nil || r != ReadyByEcho {
		t.Errorf("AwaitReady() = (%v, %v), want (ReadyByEcho, nil)", r, err)
	}
}

func TestAwaitReadyParkedCarriesSnippet(t *testing.T) {
	fastProbe(t)
	// A settled trust dialog never echoes the sentinel; the probe exhausts, the
	// C-u cleanup leaves the frame unchanged, and the wait returns the parked
	// error IMMEDIATELY (not at deadline) carrying the screen snippet.
	wall := "╭ Do you trust the files in this folder? ╮"
	ft := &fakeTmux{
		captureResults: []string{wall, wall},
		captureResult:  wall, // probe + cleanup captures: never echoes
	}
	_, err := AwaitReady(context.Background(), ft, "srv", "%1", ReadyOpts{Sleep: noSleep})
	if !errors.Is(err, ErrParked) {
		t.Fatalf("AwaitReady() error = %v, want ErrParked", err)
	}
	var parked *ParkedError
	if !errors.As(err, &parked) || !strings.Contains(parked.Snippet, "trust") {
		t.Errorf("parked snippet = %q, want the settled screen's fragment", parked)
	}
	if got := countCalls(ft.callStream(), "capture-pane"); got != 3+ProbeAttempts+1 {
		t.Errorf("captures = %d, want %d (settle + guard recheck + probe + cleanup — an immediate verdict)", got, 3+ProbeAttempts+1)
	}
	if ft.enterCalled {
		t.Error("the probe must never submit (no Enter on any path)")
	}
}

// deepFrame builds a pane capture with `scroll` content lines above the prompt
// line — sized between the engine's probe depth and the readiness settle depth
// so a capture-depth mismatch between settle and probe/clear is observable.
func deepFrame(scroll int) string {
	var b strings.Builder
	for i := 0; i < scroll; i++ {
		fmt.Fprintf(&b, "scrollback line %d\n", i)
	}
	return b.String() + "prompt>"
}

func TestAwaitReadyDeepScrollbackEchoClassifies(t *testing.T) {
	fastProbe(t)
	// The settled frame runs deeper than the engine's probe depth: settle,
	// probe, and clear MUST compare captures at one depth, or the baseline
	// equality never holds and a live input box dies as an operational error.
	settled := deepFrame(ProbeCaptureLines + 5)
	ft := &fakeTmux{captureResults: []string{
		settled, settled, // settle
		settled,                      // guard recheck
		settled + " #rk-ready-probe", // probe echo
		settled, // clear verify
	}}
	r, err := AwaitReady(context.Background(), ft, "srv", "%1", ReadyOpts{Sleep: noSleep})
	if err != nil || r != ReadyByEcho {
		t.Errorf("AwaitReady() = (%v, %v), want (ReadyByEcho, nil)", r, err)
	}
}

func TestAwaitReadyDeepScrollbackParked(t *testing.T) {
	fastProbe(t)
	// Same depth invariant on the no-echo path: the post-C-u capture must
	// compare against the settled frame at the SAME depth, or parked is
	// misread as churn and the wait spins to deadline instead of returning.
	settled := deepFrame(ProbeCaptureLines + 5)
	ft := &fakeTmux{
		captureResults: []string{settled, settled},
		captureResult:  settled, // probe + cleanup captures: never echoes
	}
	_, err := AwaitReady(context.Background(), ft, "srv", "%1", ReadyOpts{Sleep: noSleep})
	if !errors.Is(err, ErrParked) {
		t.Fatalf("AwaitReady() error = %v, want ErrParked", err)
	}
	var parked *ParkedError
	if !errors.As(err, &parked) || !strings.Contains(parked.Snippet, "prompt>") {
		t.Errorf("parked snippet = %q, want the settled screen's trailing fragment", parked)
	}
}

func TestAwaitReadyProbeCaptureFailureCleansUp(t *testing.T) {
	fastProbe(t)
	// The paste lands but every probe capture then fails: the sentinel may be
	// staged, so the probe attempts the C-u cleanup before reporting not-yet —
	// a leftover sentinel would pollute the next probe's baseline.
	ft := &fakeTmux{
		captureErrs:    []error{nil, nil, nil}, // settle + guard recheck run clean
		captureResults: []string{"prompt>", "prompt>", "prompt>"},
		captureErr:     errors.New("tmux wedged"),
	}
	_, err := AwaitReady(context.Background(), ft, "srv", "%1", ReadyOpts{
		Deadline: 30 * time.Millisecond,
		Sleep:    noSleep,
	})
	if !errors.Is(err, ErrNotReady) {
		t.Fatalf("AwaitReady() error = %v, want ErrNotReady", err)
	}
	calls := ft.callStream()
	if got := countCalls(calls, "paste-buffer"); got != 1 {
		t.Errorf("paste-buffer calls = %d, want 1 (one probe, then capture errors keep polling)", got)
	}
	if got := countCalls(calls, "send-keys C-u"); got != 1 {
		t.Errorf("C-u calls = %d, want 1 (best-effort cleanup of the possibly-staged sentinel)", got)
	}
}

func TestAwaitReadyStateShortCircuitsProbe(t *testing.T) {
	fastProbe(t)
	// State is checked first every poll: a pane whose hooks stamped state is
	// ready without the sentinel ever being typed.
	ft := &fakeTmux{captureResult: "prompt>"}
	r, err := AwaitReady(context.Background(), ft, "srv", "%1", ReadyOpts{
		State: stateScript(sp("idle:1751790000:4242", nil)),
		Sleep: noSleep,
	})
	if err != nil || r != ReadyByState {
		t.Fatalf("AwaitReady() = (%v, %v), want (ReadyByState, nil)", r, err)
	}
	if got := countCalls(ft.callStream(), "set-buffer"); got != 0 {
		t.Errorf("set-buffer calls = %d, want 0 (no sentinel typed into a state-present pane)", got)
	}
}

func TestAwaitReadyStateWins(t *testing.T) {
	// The captures never settle (an animating boot screen), but the state
	// reader returns a state on the second poll → ReadyByState. State is
	// checked first, so it also wins over a same-poll settle.
	ft := &fakeTmux{captureResults: []string{"frame1", "frame2", "frame3", "frame4"}}
	r, err := AwaitReady(context.Background(), ft, "srv", "%1", ReadyOpts{
		State: stateScript(sp("", nil), sp("idle:1751790000:4242", nil)),
		Sleep: noSleep,
	})
	if err != nil {
		t.Fatalf("AwaitReady() = %v", err)
	}
	if r != ReadyByState {
		t.Errorf("readiness = %v, want ReadyByState", r)
	}
}

func TestAwaitReadyBlankCapturesNeverProbe(t *testing.T) {
	fastProbe(t)
	// A blank pane is not "settled" even when byte-identical; readiness waits
	// for real content to appear and THEN repeat before spending a probe.
	ft := &fakeTmux{captureResults: []string{
		"", "", "  \n", "prompt>", "prompt>", // blank repeats never settle
		"prompt>",                 // guard recheck
		"prompt> #rk-ready-probe", // probe echo
		"prompt>",                 // clear verify
	}}
	r, err := AwaitReady(context.Background(), ft, "srv", "%1", ReadyOpts{Sleep: noSleep})
	if err != nil {
		t.Fatalf("AwaitReady() = %v", err)
	}
	if r != ReadyByEcho {
		t.Errorf("readiness = %v, want ReadyByEcho", r)
	}
	if got := countCalls(ft.callStream(), "set-buffer"); got != 1 {
		t.Errorf("set-buffer calls = %d, want 1 (exactly one probe, after real content settled)", got)
	}
	if ft.bufferName != defaultReadyBuffer {
		t.Errorf("buffer = %q, want the default %q when ReadyOpts.BufferName is unset", ft.bufferName, defaultReadyBuffer)
	}
}

func TestAwaitReadyChurnUnderProbeRePolls(t *testing.T) {
	fastProbe(t)
	// The pane settles, but the frame changes under the probe without echoing
	// (boot resumed): no verdict — the wait re-enters polling, and deadline
	// expiry still yields ErrNotReady. Only ONE probe runs (the churned pane
	// never settles again; captures error out after the script).
	ft := &fakeTmux{
		captureErrs: make([]error, 3+ProbeAttempts+1), // nils: the script window below runs clean (settle + guard recheck + probe + post-C-u)
		captureResults: []string{
			"boot", "boot", // settle
			"boot", // guard recheck
			"boot tick", "boot tock", "boot tick", "boot tock",
			"boot tick", "boot tock", "boot tick", "boot tock", // 8 probe captures, no echo
			"boot resumed", // post-C-u capture: frame changed → not yet
		},
		captureErr: errors.New("tmux wedged"),
	}
	_, err := AwaitReady(context.Background(), ft, "srv", "%1", ReadyOpts{
		Deadline: 30 * time.Millisecond,
		Sleep:    noSleep,
	})
	if !errors.Is(err, ErrNotReady) {
		t.Fatalf("AwaitReady() error = %v, want ErrNotReady", err)
	}
	if got := countCalls(ft.callStream(), "paste-buffer"); got != 1 {
		t.Errorf("paste-buffer calls = %d, want 1 (churn re-polls instead of re-probing)", got)
	}
}

func TestAwaitReadyDeadlineErrNotReady(t *testing.T) {
	// Neither signal fires before the deadline: the error wraps ErrNotReady
	// and carries the last capture's trailing snippet. Captures fail once the
	// script is exhausted so the pane never settles; without an IsGone
	// predicate the failures are tolerated as "not yet"; the last good frame
	// is retained for the snippet.
	ft := &fakeTmux{
		captureErrs:    []error{nil, nil, nil},
		captureResults: []string{"tick 1", "tick 2", "tick 3 — still booting"},
		captureErr:     errors.New("pane gone"),
	}
	_, err := AwaitReady(context.Background(), ft, "srv", "%1", ReadyOpts{
		State:    stateScript(sp("", nil)),
		Deadline: 20 * time.Millisecond,
		Sleep:    noSleep,
	})
	if !errors.Is(err, ErrNotReady) {
		t.Fatalf("AwaitReady() error = %v, want ErrNotReady", err)
	}
	if !strings.Contains(err.Error(), "still booting") {
		t.Errorf("error = %q, want the last capture's snippet", err.Error())
	}
}

func TestAwaitReadyCaptureErrorsTolerated(t *testing.T) {
	fastProbe(t)
	// A transient capture failure is a "not yet", not a verdict: the loop
	// recovers, settles, and probes once captures succeed.
	ft := &fakeTmux{
		captureErrs:    []error{fmt.Errorf("tmux wedged")},
		captureResults: []string{"prompt>", "prompt>", "prompt>", "prompt> #rk-ready-probe", "prompt>"},
	}
	r, err := AwaitReady(context.Background(), ft, "srv", "%1", ReadyOpts{Sleep: noSleep})
	if err != nil || r != ReadyByEcho {
		t.Errorf("AwaitReady() = (%v, %v), want (ReadyByEcho, nil)", r, err)
	}
}

func TestAwaitReadyGonePredicateFires(t *testing.T) {
	// A capture error matching the injected gone predicate ends the wait
	// promptly with ErrGone instead of spinning to the deadline.
	isGone := func(err error) bool { return strings.Contains(err.Error(), "can't find pane") }
	ft := &fakeTmux{captureErr: errors.New("can't find pane: %1")}
	_, err := AwaitReady(context.Background(), ft, "srv", "%1", ReadyOpts{
		IsGone: isGone,
		Sleep:  noSleep,
	})
	if !errors.Is(err, ErrGone) {
		t.Fatalf("AwaitReady() error = %v, want ErrGone", err)
	}
	if got := countCalls(ft.callStream(), "capture-pane"); got != 1 {
		t.Errorf("captures = %d, want 1 (gone returns promptly)", got)
	}
}

func TestAwaitReadyGoneMidProbe(t *testing.T) {
	fastProbe(t)
	// The pane dies under the probe: the gone predicate on a probe capture
	// error surfaces ErrGone rather than a false parked/not-yet.
	isGone := func(err error) bool { return strings.Contains(err.Error(), "can't find pane") }
	ft := &fakeTmux{
		captureResults: []string{"prompt>", "prompt>"},
		captureErr:     errors.New("can't find pane: %1"),
	}
	_, err := AwaitReady(context.Background(), ft, "srv", "%1", ReadyOpts{
		IsGone: isGone,
		Sleep:  noSleep,
	})
	if !errors.Is(err, ErrGone) {
		t.Fatalf("AwaitReady() error = %v, want ErrGone", err)
	}
	if errors.Is(err, ErrParked) {
		t.Error("pane death under the probe must not classify as parked")
	}
}

func TestAwaitReadyUnverifiedClearFailsClosed(t *testing.T) {
	fastProbe(t)
	// The sentinel echoes, but C-u cannot restore the settled baseline within
	// the bounded attempts (the composer stays polluted): fail closed with an
	// operational error — never report ready over a staged sentinel.
	ft := &fakeTmux{
		captureResults: []string{"up", "up", "up", "up #rk-ready-probe"},
		captureResult:  "up #rk-ready-probe", // clear captures: sentinel stuck
	}
	_, err := AwaitReady(context.Background(), ft, "srv", "%1", ReadyOpts{Sleep: noSleep})
	if err == nil {
		t.Fatal("AwaitReady() = nil, want the fail-closed clear error")
	}
	if !errors.Is(err, errComposerNotCleared) {
		t.Errorf("error = %v, want the composer-not-cleared sentinel", err)
	}
	if got := countCalls(ft.callStream(), "send-keys C-u"); got != ClearAttempts {
		t.Errorf("C-u attempts = %d, want %d (bounded)", got, ClearAttempts)
	}
}

func TestAwaitReadyPaneModeGuardBeforePaste(t *testing.T) {
	fastProbe(t)
	// The sentinel probe is a delivery path: the pane-mode guard runs before
	// the paste (a scrolled copy-mode pane shows a static frame that settles,
	// then eats the paste — reading as parked without the guard). The guard
	// cannot report whether it cancelled a mode, so a post-guard repaint means
	// the settled baseline is stale: no paste that pass, re-enter polling, and
	// the re-settled real screen classifies normally.
	ft := &fakeTmux{captureResults: []string{
		"scrolled view", "scrolled view", // settle on the copy-mode frame
		"shell>",                  // guard recheck: repaint (a mode was cancelled) → no paste
		"shell>",                  // next poll
		"shell>",                  // settle on the real screen
		"shell>",                  // guard recheck: unchanged, probe proceeds
		"shell> #rk-ready-probe",  // probe echo
		"shell>",                  // clear verify
	}}
	r, err := AwaitReady(context.Background(), ft, "srv", "%1", ReadyOpts{Sleep: noSleep})
	if err != nil || r != ReadyByEcho {
		t.Fatalf("AwaitReady() = (%v, %v), want (ReadyByEcho, nil)", r, err)
	}
	calls := ft.callStream()
	if got := countCalls(calls, "paste-buffer"); got != 1 {
		t.Errorf("paste-buffer calls = %d, want 1 (no paste on the repainted pass)", got)
	}
	if got := countCalls(calls, "clear-pane-mode"); got != 2 {
		t.Errorf("clear-pane-mode calls = %d, want 2 (one per probe entry)", got)
	}
	guard, paste := -1, -1
	for i, c := range calls {
		if c == "clear-pane-mode" && guard == -1 {
			guard = i
		}
		if c == "paste-buffer" && paste == -1 {
			paste = i
		}
	}
	if guard == -1 || (paste != -1 && guard > paste) {
		t.Errorf("call order = %v, want the pane-mode guard before any paste", calls)
	}
}

func TestAwaitReadyContextCancel(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	ft := &fakeTmux{captureResult: "never settles"}
	_, err := AwaitReady(ctx, ft, "srv", "%1", ReadyOpts{Sleep: noSleep})
	if !errors.Is(err, context.Canceled) {
		t.Errorf("AwaitReady() error = %v, want context.Canceled", err)
	}
	if errors.Is(err, ErrNotReady) {
		t.Error("cancellation must not surface as ErrNotReady")
	}
}

func TestReadySnippetBounds(t *testing.T) {
	long := strings.Repeat("x", readySnippetMaxRunes+50) + "tail"
	got := readySnippet(long)
	if len([]rune(got)) != readySnippetMaxRunes || !strings.HasSuffix(got, "tail") {
		t.Errorf("readySnippet = %q (len %d), want the trailing %d runes", got, len([]rune(got)), readySnippetMaxRunes)
	}
	if got := readySnippet("  padded  "); got != "padded" {
		t.Errorf("readySnippet trims whitespace, got %q", got)
	}
}

func TestDeliverWhenReadyComposite(t *testing.T) {
	fastProbe(t)
	fastSubmit(t)
	// Capture script: two identical frames settle readiness; the sentinel echo
	// probe and its clear; then the engine's baseline, the echo probe (needle
	// newly present), and a changed post-Enter frame. The script is consumed
	// in order across BOTH phases.
	const kickoff = "do the thing"
	ft := &fakeTmux{captureResults: []string{
		"boot", "boot", // readiness settle
		"boot",                           // guard recheck
		"boot #rk-ready-probe",           // readiness probe: sentinel echoed
		"boot",                           // sentinel clear verify
		"boot",                           // engine baseline (needle count 0)
		"boot\n> do the thing",           // echo probe: needle newly present
		"boot\n> do the thing\nworking…", // post-Enter: frame changed → no claim
	}}
	engine := NewEngine("rk-test")
	r, err := DeliverWhenReady(context.Background(), ft, "srv", "%7", kickoff, true, engine, ReadyOpts{Sleep: noSleep})
	if err != nil {
		t.Fatalf("DeliverWhenReady() = %v", err)
	}
	if r != ReadyByEcho {
		t.Errorf("readiness = %v, want ReadyByEcho", r)
	}
	if ft.bufferText != kickoff || ft.pastedPane != "%7" {
		t.Errorf("delivery = (buffer %q, pane %q), want (%q, %%7)", ft.bufferText, ft.pastedPane, kickoff)
	}
	if !ft.enterCalled {
		t.Error("submit=true must send Enter after the echo probe")
	}
}

func TestDeliverWhenReadyParkedSkipsSend(t *testing.T) {
	fastProbe(t)
	// A parked classification is an AwaitReady error, so delivery is never
	// attempted into the wall — fail closed with no special-casing.
	wall := "╭ trust this folder? ╮"
	ft := &fakeTmux{
		captureResults: []string{wall, wall},
		captureResult:  wall,
	}
	engine := NewEngine("rk-test")
	_, err := DeliverWhenReady(context.Background(), ft, "srv", "%7", "hi", true, engine, ReadyOpts{Sleep: noSleep})
	if !errors.Is(err, ErrParked) {
		t.Fatalf("DeliverWhenReady() error = %v, want ErrParked", err)
	}
	if got := countCalls(ft.callStream(), "set-buffer"); got != 1 {
		t.Errorf("set-buffer calls = %d, want 1 (the sentinel probe only — no delivery attempted)", got)
	}
	if ft.bufferText != "#rk-ready-probe" {
		t.Errorf("buffer text = %q, want only the sentinel — the prompt is never staged into a wall", ft.bufferText)
	}
	if ft.enterCalled {
		t.Error("no Enter on a parked pane")
	}
}

func TestDeliverWhenReadyAwaitFailureSkipsSend(t *testing.T) {
	ft := &fakeTmux{captureResults: []string{"a", "b", "c"}}
	engine := NewEngine("rk-test")
	_, err := DeliverWhenReady(context.Background(), ft, "srv", "%7", "hi", true, engine, ReadyOpts{
		Deadline: 20 * time.Millisecond,
		Sleep:    noSleep,
	})
	if !errors.Is(err, ErrNotReady) {
		t.Fatalf("DeliverWhenReady() error = %v, want ErrNotReady", err)
	}
	if got := countCalls(ft.callStream(), "set-buffer"); got != 0 {
		t.Errorf("set-buffer calls = %d, want 0 (no send without readiness)", got)
	}
}

func TestDeliverWhenReadySendFailureReturnsReadiness(t *testing.T) {
	// Readiness via the state signal (a set-buffer failure would otherwise also
	// break the sentinel probe's own paste).
	ft := &fakeTmux{
		captureResult: "up",
		setBufferErr:  fmt.Errorf("buffer boom"),
	}
	engine := NewEngine("rk-test")
	r, err := DeliverWhenReady(context.Background(), ft, "srv", "%7", "hi", true, engine, ReadyOpts{
		State: stateScript(sp("idle:1751790000:4242", nil)),
		Sleep: noSleep,
	})
	if err == nil || !strings.Contains(err.Error(), "buffer boom") {
		t.Fatalf("DeliverWhenReady() error = %v, want the wrapped send failure", err)
	}
	if r != ReadyByState {
		t.Errorf("readiness = %v, want ReadyByState even on send failure", r)
	}
}
