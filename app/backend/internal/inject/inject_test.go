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

// fakeTmux is a scriptable inject.Tmux: captures are consumed from
// captureResults in order (falling back to captureResult), and every call is
// recorded in calls for order assertions.
type fakeTmux struct {
	mu             sync.Mutex
	calls          []string
	captureResult  string
	captureResults []string
	captureErr     error
	setBufferErr   error
	pasteErr       error
	enterErr       error
	bufferName     string
	bufferText     string
	pastedPane     string
	enteredPane    string
	enterCalled    bool
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
	if f.captureErr != nil {
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
	defer f.mu.Unlock()
	f.pastedPane = paneID
	return f.pasteErr
}

func (f *fakeTmux) SendEnter(_ context.Context, paneID, _ string) error {
	f.record("send-keys")
	f.mu.Lock()
	defer f.mu.Unlock()
	f.enterCalled = true
	f.enteredPane = paneID
	return f.enterErr
}

// TestSendOrderAndEnter: a paste whose text newly echoes runs the exact order
// baseline capture → set-buffer → paste-buffer → probe capture → Enter, all
// targeting the pane, through the engine's named buffer.
func TestSendOrderAndEnter(t *testing.T) {
	fastProbe(t)
	ft := &fakeTmux{captureResults: []string{"❯ ", "❯ hello world"}}
	e := NewEngine("rk-send-123")

	if err := e.Send(context.Background(), ft, "default", "%5", "hello world", true); err != nil {
		t.Fatalf("Send: %v", err)
	}
	want := []string{"capture-pane", "set-buffer", "paste-buffer", "capture-pane", "send-keys"}
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
	e := NewEngine("rk-chat-send")

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
}

// TestSendTmuxFailureVerbatim: a substrate failure (paste here) propagates as a
// wrapped tmux error — NOT a ProbeFailure — and no Enter is sent.
func TestSendTmuxFailureVerbatim(t *testing.T) {
	fastProbe(t)
	ft := &fakeTmux{captureResult: "❯ ", pasteErr: errors.New("tmux exploded")}
	e := NewEngine("rk-chat-send")

	err := e.Send(context.Background(), ft, "default", "%5", "hi", true)
	var pf ProbeFailure
	if errors.As(err, &pf) {
		t.Fatalf("err = %v, must not be a ProbeFailure (tmux fault is distinct)", err)
	}
	if err == nil || !strings.Contains(err.Error(), "tmux exploded") {
		t.Fatalf("err = %v, want the wrapped tmux failure", err)
	}
	if ft.enterCalled {
		t.Error("Enter sent despite a paste failure")
	}
}

// TestSendWhitespaceOnlyNeedleFailsClosed: a text that yields no needle fails
// closed BEFORE touching the buffer (defensive — callers reject empty text
// upstream).
func TestSendWhitespaceOnlyNeedleFailsClosed(t *testing.T) {
	ft := &fakeTmux{}
	e := NewEngine("rk-chat-send")

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
	e := NewEngine("rk-chat-send")

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
	e := NewEngine("rk-chat-send")

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
	slow := &fakeTmux{captureResults: []string{"❯ ", "❯ hi"}}
	fast := &fakeTmux{captureResults: []string{"❯ ", "❯ hi"}}
	e1 := NewEngine("rk-chat-send")
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
// ANSI/whitespace normalization.
func TestCountOccurrences(t *testing.T) {
	needle := Needle("please run the tests")
	tests := []struct {
		name        string
		capture     string
		collapsible bool
		want        int
	}{
		{"echo present once", "❯ please run the tests", false, 1},
		{"echo absent", "unrelated scrollback\n❯ ", false, 0},
		{"echo present twice", "❯ please run the tests\n❯ please run the tests", false, 2},
		{"wrapped across rows", "❯ please run the\n  tests", false, 1},
		{"ansi-styled echo", "\x1b[1m❯\x1b[0m please run \x1b[32mthe tests\x1b[0m", false, 1},
		{"multiline chip counted when collapsible", "❯ [Pasted text #1 +12 lines]", true, 1},
		{"multiline chip ignored when not collapsible", "❯ [Pasted text #1 +12 lines]", false, 0},
		{"suffix-less chip counted when collapsible", "❯ [Pasted text #7]", true, 1},
		{"suffix-less chip ignored when not collapsible", "❯ [Pasted text #7]", false, 0},
		{"placeholder singular line", "❯ [Pasted text #3 +1 line]", true, 1},
		{"ansi-styled placeholder", "\x1b[2m[Pasted text #2 +40 lines]\x1b[0m", true, 1},
		{"two chips both forms", "[Pasted text #1 +2 lines]\n[Pasted text #2]", true, 2},
		{"non-placeholder bracketed text", "❯ [some other note]", true, 0},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := CountOccurrences(tt.capture, needle, tt.collapsible); got != tt.want {
				t.Errorf("CountOccurrences(%q, %q, collapsible=%v) = %d, want %d", tt.capture, needle, tt.collapsible, got, tt.want)
			}
		})
	}
}
