package inject

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"
)

// fastProbe shrinks the probe settle/gap so the retry loop runs quickly under
// test, restoring the production values after.
func fastProbe(t *testing.T) {
	t.Helper()
	ps, pg := ProbeSettle, ProbeGap
	ProbeSettle = time.Millisecond
	ProbeGap = time.Millisecond
	t.Cleanup(func() { ProbeSettle, ProbeGap = ps, pg })
}

func fastSubmit(t *testing.T) {
	t.Helper()
	backoff := append([]time.Duration(nil), SubmitBackoff...)
	retries, retrySteps, clears := SubmitRetries, SubmitRetryBackoffSteps, ClearAttempts
	SubmitBackoff = []time.Duration{time.Millisecond, time.Millisecond, time.Millisecond, time.Millisecond, time.Millisecond}
	SubmitRetries = 1
	SubmitRetryBackoffSteps = 3
	ClearAttempts = 4
	t.Cleanup(func() {
		SubmitBackoff = backoff
		SubmitRetries = retries
		SubmitRetryBackoffSteps = retrySteps
		ClearAttempts = clears
	})
}

// fakeTmux is a scriptable inject.Tmux: captures are consumed from
// captureResults in order (falling back to captureResult), and every call is
// recorded in calls for order assertions.
type fakeTmux struct {
	mu             sync.Mutex
	calls          []string
	captureResult  string
	captureResults []string
	captureErr     error
	captureErrs    []error
	setBufferErr   error
	pasteErr       error
	pasteRawErr    error
	enterErr       error
	enterErrs      []error
	keyErr         error
	bufferName     string
	bufferText     string
	pastedPane     string
	pastedRawPane  string
	enteredPane    string
	enterCalled    bool
	enterHook      func()
	pasteHook      func()
	keysSent       [][]string
}

func (f *fakeTmux) record(s string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls = append(f.calls, s)
}

func (f *fakeTmux) callStream() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.calls...)
}

func (f *fakeTmux) CapturePane(_ context.Context, _ string, _ int, _ string) (string, error) {
	f.record("capture-pane")
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.captureErrs) > 0 {
		err := f.captureErrs[0]
		f.captureErrs = f.captureErrs[1:]
		if err != nil {
			return "", err
		}
	} else if f.captureErr != nil {
		return "", f.captureErr
	}
	if len(f.captureResults) > 0 {
		r := f.captureResults[0]
		f.captureResults = f.captureResults[1:]
		return r, nil
	}
	return f.captureResult, nil
}

func (f *fakeTmux) SetBuffer(_ context.Context, name, text, _ string) error {
	f.record("set-buffer")
	f.mu.Lock()
	defer f.mu.Unlock()
	f.bufferName = name
	f.bufferText = text
	return f.setBufferErr
}

func (f *fakeTmux) PasteBuffer(_ context.Context, _, paneID, _ string) error {
	f.record("paste-buffer")
	f.mu.Lock()
	f.pastedPane = paneID
	hook := f.pasteHook
	err := f.pasteErr
	f.mu.Unlock()
	if hook != nil {
		hook()
	}
	return err
}

func (f *fakeTmux) PasteBufferRaw(_ context.Context, _, paneID, _ string) error {
	f.record("paste-buffer-raw")
	f.mu.Lock()
	defer f.mu.Unlock()
	f.pastedRawPane = paneID
	return f.pasteRawErr
}

func (f *fakeTmux) SendEnter(_ context.Context, paneID, _ string) error {
	f.record("send-keys")
	f.mu.Lock()
	f.enterCalled = true
	f.enteredPane = paneID
	hook := f.enterHook
	err := f.enterErr
	if len(f.enterErrs) > 0 {
		err = f.enterErrs[0]
		f.enterErrs = f.enterErrs[1:]
	}
	f.mu.Unlock()
	if hook != nil {
		hook()
	}
	return err
}

func countCalls(calls []string, want string) int {
	count := 0
	for _, call := range calls {
		if call == want {
			count++
		}
	}
	return count
}

func (f *fakeTmux) SendKeys(_ context.Context, paneID, _ string, keys ...string) error {
	f.record("send-keys " + strings.Join(keys, " "))
	f.mu.Lock()
	defer f.mu.Unlock()
	f.keysSent = append(f.keysSent, append([]string{paneID}, keys...))
	return f.keyErr
}

func TestSendRawOrder(t *testing.T) {
	ft := &fakeTmux{}
	err := NewEngine("rk-send-raw").SendRaw(context.Background(), ft, "default", "%5", "a\tb\nc")
	if err != nil {
		t.Fatalf("SendRaw: %v", err)
	}
	if got, want := strings.Join(ft.callStream(), ","), "set-buffer,paste-buffer-raw"; got != want {
		t.Fatalf("calls = %s, want %s", got, want)
	}
	if ft.bufferText != "a\tb\nc" || ft.pastedRawPane != "%5" {
		t.Fatalf("delivery = text %q pane %q", ft.bufferText, ft.pastedRawPane)
	}
	if ft.enterCalled {
		t.Fatal("Enter sent during raw delivery")
	}
}

func TestPressEnterOrder(t *testing.T) {
	ft := &fakeTmux{}
	if err := NewEngine("rk-send-enter").PressEnter(context.Background(), ft, "default", "%5"); err != nil {
		t.Fatalf("PressEnter: %v", err)
	}
	if got, want := strings.Join(ft.callStream(), ","), "send-keys"; got != want {
		t.Fatalf("calls = %s, want %s", got, want)
	}
	if ft.enteredPane != "%5" {
		t.Fatalf("pane = %q, want %%5", ft.enteredPane)
	}
}

func TestSendRawSamePaneSerializesWithSend(t *testing.T) {
	fastProbe(t)
	ft := &fakeTmux{captureResult: "unrelated pane output"}
	engine := NewEngine("rk-send-shared")

	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		_ = engine.Send(context.Background(), ft, "default", "%5", "message", true)
	}()
	go func() {
		defer wg.Done()
		_ = engine.SendRaw(context.Background(), ft, "default", "%5", "raw")
	}()
	wg.Wait()

	sendBlock := []string{"capture-pane", "set-buffer", "paste-buffer"}
	for range ProbeAttempts {
		sendBlock = append(sendBlock, "capture-pane")
	}
	rawBlock := []string{"set-buffer", "paste-buffer-raw"}
	first := append(append([]string(nil), sendBlock...), rawBlock...)
	second := append(append([]string(nil), rawBlock...), sendBlock...)
	got := strings.Join(ft.callStream(), ",")
	if got != strings.Join(first, ",") && got != strings.Join(second, ",") {
		t.Fatalf("same-pane operations interleaved: %v", ft.callStream())
	}
}

func TestSendShortNeedleOccurrenceCounts(t *testing.T) {
	fastProbe(t)
	fastSubmit(t)

	t.Run("flat count fails closed", func(t *testing.T) {
		ft := &fakeTmux{captureResults: []string{"old ok\n❯ ", "❯ ok"}, captureResult: "❯ ok"}
		err := NewEngine("rk-short-flat").Send(context.Background(), ft, "default", "%5", "ok", true)
		var probeErr ProbeFailure
		if !errors.As(err, &probeErr) {
			t.Fatalf("err = %v, want ProbeFailure", err)
		}
		if ft.enterCalled {
			t.Fatal("Enter sent after a flat occurrence count")
		}
	})

	t.Run("fresh occurrence passes", func(t *testing.T) {
		ft := &fakeTmux{captureResults: []string{"old ok\n❯ ", "old ok\n❯ ok", "working"}}
		if err := NewEngine("rk-short-fresh").Send(context.Background(), ft, "default", "%5", "ok", true); err != nil {
			t.Fatalf("Send: %v", err)
		}
		if !ft.enterCalled {
			t.Fatal("Enter was not sent after a fresh occurrence")
		}
	})
}

// TestSendOrderAndEnter: a paste whose text newly echoes runs the exact order
// baseline capture → set-buffer → paste-buffer → probe capture → Enter, all
// targeting the pane, through the engine's named buffer.
func TestSendOrderAndEnter(t *testing.T) {
	fastProbe(t)
	fastSubmit(t)
	ft := &fakeTmux{captureResults: []string{"❯ ", "❯ hello world", "hello world\nworking"}}
	e := NewEngine("rk-send-123")

	if err := e.Send(context.Background(), ft, "default", "%5", "hello world", true); err != nil {
		t.Fatalf("Send: %v", err)
	}
	want := []string{"capture-pane", "set-buffer", "paste-buffer", "capture-pane", "send-keys", "capture-pane"}
	if got := strings.Join(ft.callStream(), ","); got != strings.Join(want, ",") {
		t.Errorf("call order = %v, want %v", got, want)
	}
	if ft.bufferName != "rk-send-123" {
		t.Errorf("buffer = %q, want the engine's named buffer", ft.bufferName)
	}
	if ft.bufferText != "hello world" || ft.pastedPane != "%5" || ft.enteredPane != "%5" {
		t.Errorf("delivery = text %q paste %q enter %q, want the message into %%5", ft.bufferText, ft.pastedPane, ft.enteredPane)
	}
}

// TestSendProbeFailsClosed: the pasted text never echoes across all retries →
// ProbeFailure and NO Enter (never a blind Enter).
func TestSendProbeFailsClosed(t *testing.T) {
	fastProbe(t)
	ft := &fakeTmux{captureResult: "unrelated pane output"}
	e := NewEngine("rk-agent-send")

	err := e.Send(context.Background(), ft, "default", "%5", "hello world", true)
	var pf ProbeFailure
	if !errors.As(err, &pf) {
		t.Fatalf("err = %v, want ProbeFailure", err)
	}
	if ft.enterCalled {
		t.Error("Enter sent despite a failed probe")
	}
	captures := 0
	for _, c := range ft.callStream() {
		if c == "capture-pane" {
			captures++
		}
	}
	if want := 1 + ProbeAttempts; captures != want {
		t.Errorf("captures = %d, want %d (baseline + full bounded retry)", captures, want)
	}
}

// TestSendInsertSkipsEnter: submit=false runs the full sequence up to a passing
// probe, then skips ONLY the Enter (text stays staged).
func TestSendInsertSkipsEnter(t *testing.T) {
	fastProbe(t)
	fastSubmit(t)
	ft := &fakeTmux{captureResults: []string{"❯ ", "❯ stage me"}}
	e := NewEngine("rk-send-9")

	if err := e.Send(context.Background(), ft, "default", "%5", "stage me", false); err != nil {
		t.Fatalf("Send: %v", err)
	}
	want := []string{"capture-pane", "set-buffer", "paste-buffer", "capture-pane"}
	if got := strings.Join(ft.callStream(), ","); got != strings.Join(want, ",") {
		t.Errorf("call order = %v, want %v (no send-keys)", got, want)
	}
	if ft.enterCalled {
		t.Error("Enter sent despite submit=false")
	}
	if len(ft.keysSent) != 0 {
		t.Errorf("keys sent despite submit=false: %v", ft.keysSent)
	}
}

// TestSendTmuxFailureVerbatim: a substrate failure (paste here) propagates as a
// wrapped tmux error — NOT a ProbeFailure — and no Enter is sent.
func TestSendTmuxFailureVerbatim(t *testing.T) {
	fastProbe(t)
	ft := &fakeTmux{captureResult: "❯ ", pasteErr: errors.New("tmux exploded")}
	e := NewEngine("rk-agent-send")

	err := e.Send(context.Background(), ft, "default", "%5", "hi", true)
	var pf ProbeFailure
	if errors.As(err, &pf) {
		t.Fatalf("err = %v, must not be a ProbeFailure (tmux fault is distinct)", err)
	}
	var staged StagedSendFailure
	if errors.As(err, &staged) {
		t.Fatalf("err = %v, must not be a StagedSendFailure before paste succeeds", err)
	}
	var unverified SubmitUnverified
	if errors.As(err, &unverified) {
		t.Fatalf("err = %v, must not be SubmitUnverified before Enter", err)
	}
	if err == nil || !strings.Contains(err.Error(), "tmux exploded") {
		t.Fatalf("err = %v, want the wrapped tmux failure", err)
	}
	if ft.enterCalled {
		t.Error("Enter sent despite a paste failure")
	}
}

func TestSendPostPasteFailuresAreStaged(t *testing.T) {
	fastProbe(t)
	wantErr := errors.New("tmux failed")
	tests := []struct {
		name string
		ops  *fakeTmux
		ctx  func() context.Context
	}{
		{
			name: "probe capture",
			ops: &fakeTmux{
				captureResults: []string{"pane\n❯ "},
				captureErrs:    []error{nil, wantErr},
			},
			ctx: context.Background,
		},
		{
			name: "probe context",
			ops:  &fakeTmux{captureResults: []string{"pane\n❯ "}},
			ctx: func() context.Context {
				ctx, cancel := context.WithCancel(context.Background())
				cancel()
				return ctx
			},
		},
		{
			name: "send Enter",
			ops: &fakeTmux{
				captureResults: []string{"pane\n❯ ", "pane\n❯ hello"},
				enterErr:       wantErr,
			},
			ctx: context.Background,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := NewEngine("rk-send-staged").Send(tt.ctx(), tt.ops, "default", "%5", "hello", true)
			var staged StagedSendFailure
			if !errors.As(err, &staged) {
				t.Fatalf("err = %v, want StagedSendFailure", err)
			}
			var unverified SubmitUnverified
			if errors.As(err, &unverified) {
				t.Fatalf("err = %v, must not be SubmitUnverified", err)
			}
			if tt.name != "probe context" && !errors.Is(err, wantErr) {
				t.Fatalf("err = %v, want wrapped cause %v", err, wantErr)
			}
			if tt.name == "probe context" && !errors.Is(err, context.Canceled) {
				t.Fatalf("err = %v, want wrapped context cancellation", err)
			}
		})
	}
}

func TestSendPrePasteFailuresRemainPlain(t *testing.T) {
	wantErr := errors.New("tmux failed")
	for _, tt := range []struct {
		name string
		ops  *fakeTmux
	}{
		{"set buffer", &fakeTmux{captureResult: "pane\n❯ ", setBufferErr: wantErr}},
		{"paste buffer", &fakeTmux{captureResult: "pane\n❯ ", pasteErr: wantErr}},
	} {
		t.Run(tt.name, func(t *testing.T) {
			err := NewEngine("rk-send-plain").Send(context.Background(), tt.ops, "default", "%5", "hello", true)
			if !errors.Is(err, wantErr) {
				t.Fatalf("err = %v, want wrapped cause %v", err, wantErr)
			}
			var staged StagedSendFailure
			var unverified SubmitUnverified
			var probe ProbeFailure
			if errors.As(err, &staged) || errors.As(err, &unverified) || errors.As(err, &probe) {
				t.Fatalf("err = %v, want plain wrapped error", err)
			}
		})
	}
}

// TestSendWhitespaceOnlyNeedleFailsClosed: a text that yields no needle fails
// closed BEFORE touching the buffer (defensive — callers reject empty text
// upstream).
func TestSendWhitespaceOnlyNeedleFailsClosed(t *testing.T) {
	ft := &fakeTmux{}
	e := NewEngine("rk-agent-send")

	err := e.Send(context.Background(), ft, "default", "%5", "  \n\t ", true)
	var pf ProbeFailure
	if !errors.As(err, &pf) {
		t.Fatalf("err = %v, want ProbeFailure", err)
	}
	if len(ft.callStream()) != 0 {
		t.Errorf("tmux was touched (%v) for a needle-less text", ft.callStream())
	}
}

// TestSendSamePaneSerializes: two concurrent sends to the SAME pane produce two
// contiguous, non-overlapping per-send blocks in the call stream (the per-pane
// lock holds the whole sequence).
func TestSendSamePaneSerializes(t *testing.T) {
	fastProbe(t)
	// Every capture is stale → both sends deterministically fail the probe, so
	// each block is a fixed shape regardless of goroutine order.
	ft := &fakeTmux{captureResult: "❯ stale line"}
	e := NewEngine("rk-agent-send")

	var wg sync.WaitGroup
	for range 2 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_ = e.Send(context.Background(), ft, "default", "%5", "msg", true)
		}()
	}
	wg.Wait()

	var oneBlock []string
	oneBlock = append(oneBlock, "capture-pane", "set-buffer", "paste-buffer")
	for range ProbeAttempts {
		oneBlock = append(oneBlock, "capture-pane")
	}
	want := append(append([]string(nil), oneBlock...), oneBlock...)
	if got := ft.callStream(); strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("same-pane sends interleaved — stream = %v, want two contiguous blocks %v", got, want)
	}
}

// TestSendCrossPaneSetPasteAtomic: concurrent sends to DIFFERENT panes keep the
// set → paste subsequence well-nested (a set-buffer is always immediately
// followed by its paste-buffer — never set,set,…,paste,paste).
func TestSendCrossPaneSetPasteAtomic(t *testing.T) {
	fastProbe(t)
	ft := &fakeTmux{captureResult: "❯ stale line"}
	e := NewEngine("rk-agent-send")

	var wg sync.WaitGroup
	for _, pane := range []string{"%1", "%2"} {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_ = e.Send(context.Background(), ft, "default", pane, "msg", true)
		}()
	}
	wg.Wait()

	inCritical := false
	for _, c := range ft.callStream() {
		switch c {
		case "set-buffer":
			if inCritical {
				t.Fatalf("two set-buffers with no intervening paste: %v", ft.callStream())
			}
			inCritical = true
		case "paste-buffer":
			if !inCritical {
				t.Fatalf("paste-buffer with no preceding set-buffer: %v", ft.callStream())
			}
			inCritical = false
		}
	}
	if inCritical {
		t.Fatalf("a set-buffer never reached its paste-buffer: %v", ft.callStream())
	}
}

// TestSendDistinctEnginesShareNothing: two engines (two buffer owners, e.g. the
// daemon and a CLI invocation) hold no shared locks — a blocked send on one
// engine does not stall the other.
func TestSendDistinctEnginesShareNothing(t *testing.T) {
	fastProbe(t)
	fastSubmit(t)
	slow := &fakeTmux{captureResults: []string{"❯ ", "❯ hi", "hi\nworking"}}
	fast := &fakeTmux{captureResults: []string{"❯ ", "❯ hi", "hi\nworking"}}
	e1 := NewEngine("rk-agent-send")
	e2 := NewEngine("rk-send-42")

	done := make(chan error, 1)
	go func() { done <- e2.Send(context.Background(), fast, "default", "%5", "hi", true) }()
	if err := e1.Send(context.Background(), slow, "default", "%5", "hi", true); err != nil {
		t.Fatalf("e1.Send: %v", err)
	}
	if err := <-done; err != nil {
		t.Fatalf("e2.Send: %v", err)
	}
}

func TestSendChangedFrameReturnsNilWithoutRecovery(t *testing.T) {
	fastProbe(t)
	fastSubmit(t)
	ft := &fakeTmux{captureResults: []string{"❯ ", "pane\n❯ hello", "hello\nworking"}}

	if err := NewEngine("rk-send-fast").Send(context.Background(), ft, "default", "%5", "hello", true); err != nil {
		t.Fatalf("Send: %v", err)
	}
	if captures := countCalls(ft.callStream(), "capture-pane"); captures != 3 {
		t.Fatalf("captures = %d, want baseline + echo + one observation", captures)
	}
	if len(ft.keysSent) != 0 {
		t.Fatalf("recovery keys sent after a changed frame: %v", ft.keysSent)
	}
}

func TestSendStatusChurnReturnsNilWithoutRecovery(t *testing.T) {
	fastProbe(t)
	fastSubmit(t)
	ft := &fakeTmux{captureResults: []string{
		"pane\n❯ ",
		"pane\n❯ hello\nstatus: ready",
		"pane\n❯ hello\nstatus: working",
	}}

	if err := NewEngine("rk-send-busy").Send(context.Background(), ft, "default", "%5", "hello", true); err != nil {
		t.Fatalf("Send: %v", err)
	}
	if !ft.enterCalled {
		t.Fatal("Enter was not sent after the echo probe passed")
	}
	if captures := countCalls(ft.callStream(), "capture-pane"); captures != 3 {
		t.Fatalf("captures = %d, want baseline + echo + one observation", captures)
	}
	if len(ft.keysSent) != 0 {
		t.Fatalf("recovery keys sent after status churn: %v", ft.keysSent)
	}
}

func TestSendObservationWaitsForFourthChangedFrame(t *testing.T) {
	fastProbe(t)
	fastSubmit(t)
	pre := "pane\n❯ hello"
	ft := &fakeTmux{captureResults: []string{"pane\n❯ ", pre, pre, pre, pre, "pane\nhello\nworking"}}

	if err := NewEngine("rk-send-patient").Send(context.Background(), ft, "default", "%5", "hello", true); err != nil {
		t.Fatalf("Send: %v", err)
	}
	if captures := countCalls(ft.callStream(), "capture-pane"); captures != 6 {
		t.Fatalf("captures = %d, want baseline + echo + four observations", captures)
	}
}

func TestSendTrapRetriesAfterBaselineMatchedClear(t *testing.T) {
	fastProbe(t)
	fastSubmit(t)
	pre := "pane\n❯ hello"
	ft := &fakeTmux{captureResults: []string{
		"pane\n❯ ", pre,
		pre, pre, pre, pre, pre,
		"pane\n❯ ",
		pre,
		"pane\nhello\nworking",
	}}

	if err := NewEngine("rk-send-retry").Send(context.Background(), ft, "default", "%5", "hello", true); err != nil {
		t.Fatalf("Send: %v", err)
	}
	calls := ft.callStream()
	if countCalls(calls, "paste-buffer") != 2 || countCalls(calls, "send-keys") != 2 {
		t.Fatalf("calls = %v, want two pastes and two Enters", calls)
	}
	if countCalls(calls, "send-keys C-u") != 1 {
		t.Fatalf("calls = %v, want one baseline-matching clear", calls)
	}
}

func TestSendRetryExhaustionIsUnverified(t *testing.T) {
	fastProbe(t)
	fastSubmit(t)
	pre := "pane\n❯ hello"
	ft := &fakeTmux{
		captureResult: pre,
		captureResults: []string{
			"pane\n❯ ", pre,
			pre, pre, pre, pre, pre,
			"pane\n❯ ", pre,
			pre, pre, pre,
		},
	}

	err := NewEngine("rk-send-retry").Send(context.Background(), ft, "default", "%5", "hello", true)
	var unverified SubmitUnverified
	if !errors.As(err, &unverified) {
		t.Fatalf("err = %v, want SubmitUnverified", err)
	}
	var probeFailure ProbeFailure
	if errors.As(err, &probeFailure) {
		t.Fatalf("err = %v, must remain distinct from ProbeFailure", err)
	}
	if captures := countCalls(ft.callStream(), "capture-pane"); captures != 12 {
		t.Fatalf("captures = %d, want baseline + two echo probes + five initial observations + one clear + three retry observations", captures)
	}
}

func TestSendInconclusiveDoesNotRetry(t *testing.T) {
	fastProbe(t)
	fastSubmit(t)
	SubmitBackoff = nil
	ft := &fakeTmux{captureResults: []string{"pane\n❯ ", "pane\n❯ hello"}}

	err := NewEngine("rk-send-inconclusive").Send(context.Background(), ft, "default", "%5", "hello", true)
	var unverified SubmitUnverified
	if !errors.As(err, &unverified) {
		t.Fatalf("err = %v, want SubmitUnverified", err)
	}
	calls := ft.callStream()
	if countCalls(calls, "paste-buffer") != 1 || countCalls(calls, "send-keys C-u") != 0 {
		t.Fatalf("calls = %v, inconclusive submit must not clear or re-paste", calls)
	}
}

func TestSendMultilineClearRequiresBaselineEquality(t *testing.T) {
	fastProbe(t)
	fastSubmit(t)
	baseline := "pane\n❯ "
	pre := "pane\n❯ first\nsecond\nthird"
	ft := &fakeTmux{captureResults: []string{
		baseline, pre,
		pre, pre, pre, pre, pre,
		"pane\n❯ first\nsecond", "pane\n❯ first", baseline,
		pre, "pane\nhello\nworking",
	}}

	if err := NewEngine("rk-send-clear").Send(context.Background(), ft, "default", "%5", "first\nsecond\nthird", true); err != nil {
		t.Fatalf("Send: %v", err)
	}
	calls := ft.callStream()
	if got := countCalls(calls, "send-keys C-u"); got != 3 {
		t.Fatalf("clear attempts = %d, want one per staged line", got)
	}
	thirdClear, secondPaste, clears, pastes := -1, -1, 0, 0
	for i, call := range calls {
		switch call {
		case "send-keys C-u":
			clears++
			if clears == 3 {
				thirdClear = i
			}
		case "paste-buffer":
			pastes++
			if pastes == 2 {
				secondPaste = i
			}
		}
	}
	if thirdClear < 0 || secondPaste <= thirdClear {
		t.Fatalf("calls = %v, second paste occurred before baseline equality", calls)
	}
}

func TestSendClearExhaustionNeverRepastes(t *testing.T) {
	fastProbe(t)
	fastSubmit(t)
	baseline := "pane\n❯ "
	pre := "pane\n❯ first\nsecond\nthird"
	ft := &fakeTmux{captureResults: []string{
		baseline, pre,
		pre, pre, pre, pre, pre,
		"pane\n❯ first\nsecond", "pane\n❯ first", "pane\n❯ first", "pane\n❯ first",
	}}

	err := NewEngine("rk-send-clear").Send(context.Background(), ft, "default", "%5", "first\nsecond\nthird", true)
	var unverified SubmitUnverified
	if !errors.As(err, &unverified) {
		t.Fatalf("err = %v, want SubmitUnverified", err)
	}
	calls := ft.callStream()
	if countCalls(calls, "paste-buffer") != 1 || countCalls(calls, "set-buffer") != 1 {
		t.Fatalf("calls = %v, a composer that never cleared was re-pasted", calls)
	}
	if countCalls(calls, "send-keys C-u") != ClearAttempts {
		t.Fatalf("calls = %v, want the full clear budget", calls)
	}
}

func TestSendSubmittedTranscriptNeverRepastes(t *testing.T) {
	fastProbe(t)
	fastSubmit(t)
	baseline := "pane\n❯ "
	pre := "pane\n❯ hello"
	transcript := "pane\nhello\n❯ "
	ft := &fakeTmux{captureResults: []string{
		baseline, pre,
		pre, pre, pre, pre, pre,
		transcript, transcript, transcript, transcript,
	}}

	err := NewEngine("rk-send-transcript").Send(context.Background(), ft, "default", "%5", "hello", true)
	var unverified SubmitUnverified
	if !errors.As(err, &unverified) {
		t.Fatalf("err = %v, want SubmitUnverified", err)
	}
	calls := ft.callStream()
	if countCalls(calls, "paste-buffer") != 1 || countCalls(calls, "set-buffer") != 1 {
		t.Fatalf("calls = %v, submitted transcript triggered a second paste", calls)
	}
}

func TestSendCancellationDuringVerification(t *testing.T) {
	fastProbe(t)
	fastSubmit(t)
	ctx, cancel := context.WithCancel(context.Background())
	ft := &fakeTmux{
		captureResults: []string{"pane\n❯ ", "pane\n❯ hello"},
		enterHook:      cancel,
	}

	err := NewEngine("rk-send-cancel").Send(ctx, ft, "default", "%5", "hello", true)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("err = %v, want wrapped context cancellation", err)
	}
	var unverified SubmitUnverified
	if !errors.As(err, &unverified) {
		t.Fatalf("err = %v, want SubmitUnverified", err)
	}
}

func TestSendVerificationCaptureErrorPropagates(t *testing.T) {
	fastProbe(t)
	fastSubmit(t)
	wantErr := errors.New("capture failed")
	ft := &fakeTmux{
		captureResults: []string{"pane\n❯ ", "pane\n❯ hello"},
		captureErrs:    []error{nil, nil, wantErr},
	}

	err := NewEngine("rk-send-error").Send(context.Background(), ft, "default", "%5", "hello", true)
	if !errors.Is(err, wantErr) {
		t.Fatalf("err = %v, want observation capture error", err)
	}
	var unverified SubmitUnverified
	if !errors.As(err, &unverified) {
		t.Fatalf("err = %v, want SubmitUnverified", err)
	}
}

func TestSendRetryFailureClassification(t *testing.T) {
	fastProbe(t)
	fastSubmit(t)
	wantErr := errors.New("retry failed")
	baseline := "pane\n❯ "
	preFrame := "pane\n❯ hello"
	retryCaptures := func() []string {
		captures := []string{baseline, preFrame}
		for range SubmitBackoff {
			captures = append(captures, preFrame)
		}
		return append(captures, baseline, preFrame)
	}

	t.Run("probe capture after repaste is staged", func(t *testing.T) {
		captures := retryCaptures()
		errs := make([]error, len(captures))
		errs[len(errs)-1] = wantErr
		ops := &fakeTmux{captureResults: captures, captureErrs: errs}
		err := NewEngine("rk-send-retry-probe").Send(context.Background(), ops, "default", "%5", "hello", true)
		var staged StagedSendFailure
		if !errors.As(err, &staged) || !errors.Is(err, wantErr) {
			t.Fatalf("err = %v, want StagedSendFailure wrapping %v", err, wantErr)
		}
	})

	t.Run("retry Enter failure is staged", func(t *testing.T) {
		ops := &fakeTmux{captureResults: retryCaptures(), enterErrs: []error{nil, wantErr}}
		err := NewEngine("rk-send-retry-enter").Send(context.Background(), ops, "default", "%5", "hello", true)
		var staged StagedSendFailure
		if !errors.As(err, &staged) || !errors.Is(err, wantErr) {
			t.Fatalf("err = %v, want StagedSendFailure wrapping %v", err, wantErr)
		}
	})

	t.Run("verification failure after retry Enter is unverified", func(t *testing.T) {
		captures := retryCaptures()
		captures = append(captures, preFrame)
		errs := make([]error, len(captures))
		errs[len(errs)-1] = wantErr
		ops := &fakeTmux{captureResults: captures, captureErrs: errs}
		err := NewEngine("rk-send-retry-verify").Send(context.Background(), ops, "default", "%5", "hello", true)
		var unverified SubmitUnverified
		if !errors.As(err, &unverified) || !errors.Is(err, wantErr) {
			t.Fatalf("err = %v, want SubmitUnverified wrapping %v", err, wantErr)
		}
	})

	t.Run("clear failure after initial Enter is unverified", func(t *testing.T) {
		captures := retryCaptures()
		ops := &fakeTmux{captureResults: captures[:len(captures)-2], keyErr: wantErr}
		err := NewEngine("rk-send-retry-clear").Send(context.Background(), ops, "default", "%5", "hello", true)
		var unverified SubmitUnverified
		if !errors.As(err, &unverified) || !errors.Is(err, wantErr) {
			t.Fatalf("err = %v, want SubmitUnverified wrapping %v", err, wantErr)
		}
	})
}

// A repaint is provider-neutral evidence only that the observation phase must
// make no claim and preserve the pre-existing success behavior.
func TestVerifySubmitClassifiesChangesAsNoClaim(t *testing.T) {
	fastSubmit(t)
	tests := []struct {
		name string
		pre  string
		post string
	}{
		{"bare composer", "log\n❯ hello", "log\nhello\nworking"},
		{"boxed composer", "┌ input ┐\n│ hello │\n└───────┘", "┌ input ┐\n│       │\n└───────┘"},
		{"collapsed paste", "❯ [Pasted text #2 +4 lines]", "submitted\n◐ working"},
		{"status line only", "hello\nstatus: ready", "hello\nstatus: working"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ft := &fakeTmux{captureResults: []string{tt.post}}
			verdict, err := verifySubmit(context.Background(), ft, "default", "%5", tt.pre, Needle("hello"), false, false, 0, []time.Duration{time.Millisecond})
			if err != nil {
				t.Fatalf("verifySubmit: %v", err)
			}
			if verdict != observationNoClaim {
				t.Fatalf("verdict = %v, want no claim", verdict)
			}
		})
	}
}

func TestVerifySubmitEvidenceUsesProbePredicate(t *testing.T) {
	needle := Needle("please review the implementation")
	tests := []struct {
		name  string
		frame string
		want  observationVerdict
	}{
		{"collapsed paste chip", "pane\n❯ [Pasted text #3 +4 lines]", observationNonSubmission},
		{"raw echo without chip", "pane\n❯ please review the implementation", observationNonSubmission},
		{"no chip or raw echo", "pane\n❯ ", observationInconclusive},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ft := &fakeTmux{captureResults: []string{tt.frame}}
			verdict, err := verifySubmit(context.Background(), ft, "default", "%5", tt.frame, needle, true, false, 0, []time.Duration{time.Millisecond})
			if err != nil {
				t.Fatalf("verifySubmit: %v", err)
			}
			if verdict != tt.want {
				t.Fatalf("verdict = %v, want %v", verdict, tt.want)
			}
		})
	}
}

func TestSanitize(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want string
	}{
		{"plain text unchanged", "hello world", "hello world"},
		{"newline preserved", "line one\nline two", "line one\nline two"},
		{"tab preserved", "col1\tcol2", "col1\tcol2"},
		{"CRLF normalized to LF", "line one\r\nline two", "line one\nline two"},
		{"lone CR normalized to LF", "line one\rline two", "line one\nline two"},
		{"ESC stripped leaving inert 201~", "before\x1b[201~after", "before[201~after"},
		{"NUL stripped", "a\x00b", "ab"},
		{"BEL stripped", "a\x07b", "ab"},
		{"DEL stripped", "a\x7fb", "ab"},
		{"C1 CSI stripped", "a\u009bb", "ab"},
		{"other C1 stripped", "a\u0085b", "ab"},
		{"emoji preserved", "ship it 🚀", "ship it 🚀"},
		{"all-control collapses to empty", "\x1b\x00\x07\x7f\u009b", ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := Sanitize(tt.in); got != tt.want {
				t.Errorf("Sanitize(%q) = %q, want %q", tt.in, got, tt.want)
			}
		})
	}
}

func TestNeedle(t *testing.T) {
	tests := []struct {
		name string
		text string
		want string
	}{
		{"single line", "hello world", "helloworld"},
		{"last non-empty line wins", "first\nsecond line\n\n", "secondline"},
		{"length-capped from the end", strings.Repeat("a", 100), strings.Repeat("a", NeedleMaxLen)},
		{"whitespace stripped", "  spaced   out  ", "spacedout"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := Needle(tt.text); got != tt.want {
				t.Errorf("Needle(%q) = %q, want %q", tt.text, got, tt.want)
			}
		})
	}
}

// TestCountOccurrences pins the counting rules the baseline-comparison probe
// rests on: raw needle, collapsible-gated placeholder (BOTH chip forms),
// imageish-gated image chip, ANSI/whitespace normalization.
func TestCountOccurrences(t *testing.T) {
	needle := Needle("please run the tests")
	tests := []struct {
		name        string
		capture     string
		collapsible bool
		imageish    bool
		want        int
	}{
		{"echo present once", "❯ please run the tests", false, false, 1},
		{"echo absent", "unrelated scrollback\n❯ ", false, false, 0},
		{"echo present twice", "❯ please run the tests\n❯ please run the tests", false, false, 2},
		{"wrapped across rows", "❯ please run the\n  tests", false, false, 1},
		{"ansi-styled echo", "\x1b[1m❯\x1b[0m please run \x1b[32mthe tests\x1b[0m", false, false, 1},
		{"multiline chip counted when collapsible", "❯ [Pasted text #1 +12 lines]", true, false, 1},
		{"multiline chip ignored when not collapsible", "❯ [Pasted text #1 +12 lines]", false, false, 0},
		{"suffix-less chip counted when collapsible", "❯ [Pasted text #7]", true, false, 1},
		{"suffix-less chip ignored when not collapsible", "❯ [Pasted text #7]", false, false, 0},
		{"placeholder singular line", "❯ [Pasted text #3 +1 line]", true, false, 1},
		{"ansi-styled placeholder", "\x1b[2m[Pasted text #2 +40 lines]\x1b[0m", true, false, 1},
		{"two chips both forms", "[Pasted text #1 +2 lines]\n[Pasted text #2]", true, false, 2},
		{"non-placeholder bracketed text", "❯ [some other note]", true, false, 0},
		{"image chip counted when imageish", "❯ [Image #1]", false, true, 1},
		{"image chip ignored when not imageish", "❯ [Image #1]", false, false, 0},
		{"image chip ignored under collapsible alone", "❯ [Image #1]", true, false, 0},
		{"paste chip not counted by imageish alone", "❯ [Pasted text #7]", false, true, 0},
		{"ansi-styled image chip", "\x1b[2m[Image #4]\x1b[0m", false, true, 1},
		{"two image chips", "[Image #1]\n❯ [Image #2]", false, true, 2},
		{"needle and image chip add", "❯ please run the tests\n❯ [Image #3]", false, true, 2},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := CountOccurrences(tt.capture, needle, tt.collapsible, tt.imageish); got != tt.want {
				t.Errorf("CountOccurrences(%q, %q, collapsible=%v, imageish=%v) = %d, want %d", tt.capture, needle, tt.collapsible, tt.imageish, got, tt.want)
			}
		})
	}
}

// TestIsBareImagePath pins the image-chip gate: only a whitespace-trimmed
// single line ending in a recognized image extension qualifies — the one paste
// shape the TUI may render as an "[Image #N]" chip.
func TestIsBareImagePath(t *testing.T) {
	tests := []struct {
		name string
		text string
		want bool
	}{
		{"bare png path", "/wt/.uploads/260904-shot.png", true},
		{"bare jpg path", "/wt/.uploads/a.jpg", true},
		{"bare jpeg path", "/wt/.uploads/a.jpeg", true},
		{"bare gif path", "/wt/.uploads/a.gif", true},
		{"bare webp path", "/wt/.uploads/a.webp", true},
		{"uppercase extension", "/wt/.uploads/SHOT.PNG", true},
		{"trailing newline trimmed", "/wt/.uploads/a.png\n", true},
		{"surrounding whitespace trimmed", "  /wt/.uploads/a.png\t", true},
		{"path with spaces", "/wt/.uploads/screen shot 1.png", true},
		{"relative path", "shot.png", true},
		{"svg excluded", "/wt/.uploads/a.svg", false},
		{"bmp excluded", "/wt/.uploads/a.bmp", false},
		{"mixed text and path", "look at /wt/.uploads/a.png please", false},
		{"two newline-separated paths", "/a/b.png\n/c/d.jpg", false},
		{"extension not at end", "/wt/.uploads/a.png.txt", false},
		{"empty", "", false},
		{"whitespace only", " \n\t", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := isBareImagePath(tt.text); got != tt.want {
				t.Errorf("isBareImagePath(%q) = %v, want %v", tt.text, got, tt.want)
			}
		})
	}
}

// TestSendImageChipEcho covers the imageish echo arm end to end: a bare
// image-path paste the TUI renders as an "[Image #N]" chip (never the raw
// path) passes the probe via the chip, a stale chip stays a baseline floor,
// a fresh chip beats a stale one, and a raw-text echo (the file does not
// exist, so no chip renders) still passes via the needle arm.
func TestSendImageChipEcho(t *testing.T) {
	fastProbe(t)
	fastSubmit(t)
	const path = "/wt/.uploads/260904-121530-shot.png"

	t.Run("fresh chip passes without raw echo", func(t *testing.T) {
		ft := &fakeTmux{captureResults: []string{"❯ ", "❯ [Image #1]", "working"}}
		if err := NewEngine("rk-img-fresh").Send(context.Background(), ft, "default", "%5", path, true); err != nil {
			t.Fatalf("Send: %v", err)
		}
		if !ft.enterCalled {
			t.Fatal("Enter was not sent after a fresh image chip")
		}
	})

	t.Run("stale chip is a floor to beat", func(t *testing.T) {
		ft := &fakeTmux{captureResult: "❯ [Image #1]"}
		err := NewEngine("rk-img-stale").Send(context.Background(), ft, "default", "%5", path, true)
		var pf ProbeFailure
		if !errors.As(err, &pf) {
			t.Fatalf("err = %v, want ProbeFailure", err)
		}
		if ft.enterCalled {
			t.Fatal("Enter sent on a stale image chip")
		}
	})

	t.Run("fresh chip beats a stale one", func(t *testing.T) {
		ft := &fakeTmux{captureResults: []string{"sent [Image #1]\n❯ ", "sent [Image #1]\n❯ [Image #2]", "working"}}
		if err := NewEngine("rk-img-incr").Send(context.Background(), ft, "default", "%5", path, true); err != nil {
			t.Fatalf("Send: %v", err)
		}
		if !ft.enterCalled {
			t.Fatal("Enter was not sent after the count rose past the stale chip")
		}
	})

	t.Run("raw echo still passes for an imageish paste", func(t *testing.T) {
		ft := &fakeTmux{captureResults: []string{"❯ ", "❯ " + path, "working"}}
		if err := NewEngine("rk-img-raw").Send(context.Background(), ft, "default", "%5", path, true); err != nil {
			t.Fatalf("Send: %v", err)
		}
		if !ft.enterCalled {
			t.Fatal("Enter was not sent after a raw-needle echo of an image path")
		}
	})

	t.Run("chip does not pass a non-imageish paste", func(t *testing.T) {
		ft := &fakeTmux{captureResult: "❯ [Image #1]"}
		err := NewEngine("rk-img-plain").Send(context.Background(), ft, "default", "%5", "hello world", true)
		var pf ProbeFailure
		if !errors.As(err, &pf) {
			t.Fatalf("err = %v, want ProbeFailure", err)
		}
		if ft.enterCalled {
			t.Fatal("Enter sent for plain text on the strength of an image chip")
		}
	})
}
