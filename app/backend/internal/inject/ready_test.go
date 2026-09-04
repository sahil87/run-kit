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

func TestAwaitReadySettleWins(t *testing.T) {
	// The state reader errors on every poll (hook-less agent); the capture
	// settles on the third poll → ReadyBySettle.
	ft := &fakeTmux{captureResults: []string{"booting…", "prompt>", "prompt>"}}
	r, err := AwaitReady(context.Background(), ft, "srv", "%1", ReadyOpts{
		State: stateScript(sp("", errors.New("no hooks"))),
		Sleep: noSleep,
	})
	if err != nil {
		t.Fatalf("AwaitReady() = %v", err)
	}
	if r != ReadyBySettle {
		t.Errorf("readiness = %v, want ReadyBySettle", r)
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

func TestAwaitReadyBlankCapturesNeverSettle(t *testing.T) {
	// A blank pane is not "settled" even when byte-identical; readiness waits
	// for real content to appear and THEN repeat.
	ft := &fakeTmux{captureResults: []string{"", "", "  \n", "prompt>", "prompt>"}}
	r, err := AwaitReady(context.Background(), ft, "srv", "%1", ReadyOpts{Sleep: noSleep})
	if err != nil {
		t.Fatalf("AwaitReady() = %v", err)
	}
	if r != ReadyBySettle {
		t.Errorf("readiness = %v, want ReadyBySettle", r)
	}
	if got := countCalls(ft.callStream(), "capture-pane"); got != 5 {
		t.Errorf("captures = %d, want 5 (blank repeats must not settle)", got)
	}
}

func TestAwaitReadyDeadlineErrNotReady(t *testing.T) {
	// Neither signal fires before the deadline: the error wraps ErrNotReady
	// and carries the last capture's trailing snippet. Captures fail once the
	// script is exhausted so the pane never settles; the last good frame is
	// retained for the snippet.
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

func TestAwaitReadyNoStateFuncSettles(t *testing.T) {
	// A nil State func disables the state signal outright — settle still works.
	ft := &fakeTmux{captureResults: []string{"up", "up"}}
	r, err := AwaitReady(context.Background(), ft, "srv", "%1", ReadyOpts{Sleep: noSleep})
	if err != nil || r != ReadyBySettle {
		t.Errorf("AwaitReady() = (%v, %v), want (ReadyBySettle, nil)", r, err)
	}
}

func TestAwaitReadyCaptureErrorsToleratedUntilDeadline(t *testing.T) {
	// A transient capture failure is a "not yet", not a verdict: the loop
	// recovers and settles once captures succeed.
	ft := &fakeTmux{
		captureErrs:    []error{fmt.Errorf("tmux wedged")},
		captureResults: []string{"prompt>", "prompt>"},
	}
	r, err := AwaitReady(context.Background(), ft, "srv", "%1", ReadyOpts{Sleep: noSleep})
	if err != nil || r != ReadyBySettle {
		t.Errorf("AwaitReady() = (%v, %v), want (ReadyBySettle, nil)", r, err)
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
	// Capture script: two identical frames settle readiness; then the engine's
	// baseline, the echo probe (needle newly present), and a changed post-Enter
	// frame. The script is consumed in order across BOTH phases.
	const kickoff = "do the thing"
	ft := &fakeTmux{captureResults: []string{
		"boot", "boot", // readiness settle
		"boot",                           // engine baseline (needle count 0)
		"boot\n> do the thing",           // echo probe: needle newly present
		"boot\n> do the thing\nworking…", // post-Enter: frame changed → no claim
	}}
	engine := NewEngine("rk-test")
	r, err := DeliverWhenReady(context.Background(), ft, "srv", "%7", kickoff, true, engine, ReadyOpts{Sleep: noSleep})
	if err != nil {
		t.Fatalf("DeliverWhenReady() = %v", err)
	}
	if r != ReadyBySettle {
		t.Errorf("readiness = %v, want ReadyBySettle", r)
	}
	if ft.bufferText != kickoff || ft.pastedPane != "%7" {
		t.Errorf("delivery = (buffer %q, pane %q), want (%q, %%7)", ft.bufferText, ft.pastedPane, kickoff)
	}
	if !ft.enterCalled {
		t.Error("submit=true must send Enter after the echo probe")
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
	fastProbe(t)
	ft := &fakeTmux{
		captureResults: []string{"up", "up"},
		setBufferErr:   fmt.Errorf("buffer boom"),
	}
	engine := NewEngine("rk-test")
	r, err := DeliverWhenReady(context.Background(), ft, "srv", "%7", "hi", true, engine, ReadyOpts{Sleep: noSleep})
	if err == nil || !strings.Contains(err.Error(), "buffer boom") {
		t.Fatalf("DeliverWhenReady() error = %v, want the wrapped send failure", err)
	}
	if r != ReadyBySettle {
		t.Errorf("readiness = %v, want ReadyBySettle even on send failure", r)
	}
}
