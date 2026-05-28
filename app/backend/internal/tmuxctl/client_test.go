package tmuxctl

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os/exec"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// recordingSink captures sink callbacks for assertions.
type recordingSink struct {
	mu                sync.Mutex
	lost              int
	established       int
	swcEvents         []SessionWindowChangedEvent
	winAdd            []WindowAddEvent
	winClose          []WindowCloseEvent
	winRenamed        []WindowRenamedEvent
	sessionsChanged   int
	layout            []LayoutChangeEvent
}

func (r *recordingSink) OnSessionWindowChanged(sid, wid string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.swcEvents = append(r.swcEvents, SessionWindowChangedEvent{SessionID: sid, WindowID: wid})
}
func (r *recordingSink) OnWindowAdd(wid string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.winAdd = append(r.winAdd, WindowAddEvent{WindowID: wid})
}
func (r *recordingSink) OnWindowClose(wid string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.winClose = append(r.winClose, WindowCloseEvent{WindowID: wid})
}
func (r *recordingSink) OnWindowRenamed(wid, n string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.winRenamed = append(r.winRenamed, WindowRenamedEvent{WindowID: wid, Name: n})
}
func (r *recordingSink) OnSessionsChanged() {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.sessionsChanged++
}
func (r *recordingSink) OnLayoutChange(wid string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.layout = append(r.layout, LayoutChangeEvent{WindowID: wid})
}
func (r *recordingSink) OnConnectionLost() {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.lost++
}
func (r *recordingSink) OnConnectionEstablished() {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.established++
}

// pipeReader implements io.ReadWriteCloser. The reader half is fed by test
// code; the writer half is a no-op. Closing causes the read to return io.EOF.
type pipeReader struct {
	r io.ReadCloser
	closedOnce sync.Once
}

func (p *pipeReader) Read(b []byte) (int, error)  { return p.r.Read(b) }
func (p *pipeReader) Write(b []byte) (int, error) { return len(b), nil }
func (p *pipeReader) Close() error {
	p.closedOnce.Do(func() { _ = p.r.Close() })
	return nil
}

func newPipeReaderFromBytes(b []byte) *pipeReader {
	pr, pw := io.Pipe()
	go func() {
		_, _ = pw.Write(b)
		// Don't close — the read remains blocked until the test signals
		// EOF by closing the pipeReader (which closes pr).
	}()
	return &pipeReader{r: pr}
}

func newPipeReaderEOF(b []byte) *pipeReader {
	// Write the bytes and immediately close — read will deliver bytes then
	// EOF.
	buf := bytes.NewReader(b)
	rc := io.NopCloser(buf)
	return &pipeReader{r: rc}
}

// fakeSleep returns a sleepFn whose channel only fires when the test calls
// trigger. Allows tests to advance the reconnect FSM deterministically.
type fakeSleep struct {
	mu        sync.Mutex
	pending   []chan struct{}
	durations []time.Duration
}

func (f *fakeSleep) sleep(ctx context.Context, d time.Duration) <-chan struct{} {
	ch := make(chan struct{})
	f.mu.Lock()
	f.pending = append(f.pending, ch)
	f.durations = append(f.durations, d)
	f.mu.Unlock()
	go func() {
		<-ctx.Done()
		// On cancel, close the channel to unblock the sleep too.
		f.mu.Lock()
		defer f.mu.Unlock()
		for _, p := range f.pending {
			select {
			case <-p:
			default:
				close(p)
			}
		}
		f.pending = nil
	}()
	return ch
}

// triggerNext fires the next-pending sleep, returning its duration.
func (f *fakeSleep) triggerNext(t *testing.T, timeout time.Duration) time.Duration {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for {
		f.mu.Lock()
		if len(f.pending) > 0 {
			ch := f.pending[0]
			d := f.durations[0]
			f.pending = f.pending[1:]
			f.durations = f.durations[1:]
			f.mu.Unlock()
			close(ch)
			return d
		}
		f.mu.Unlock()
		if time.Now().After(deadline) {
			t.Fatalf("no pending sleep within %v", timeout)
		}
		time.Sleep(2 * time.Millisecond)
	}
}

// TestClient_DispatchAndGenerationBump verifies that a notification is parsed,
// dispatched, generation is bumped, and Wait() unblocks.
func TestClient_DispatchAndGenerationBump(t *testing.T) {
	resetLoggedUnknowns()
	sink := &recordingSink{}

	// Stream: %begin then a session-window-changed notification.
	stream := []byte("%begin 1 1 0\n%session-window-changed $1 @42\n")
	rwc := newPipeReaderFromBytes(stream)
	dial := func(ctx context.Context, socket string) (*exec.Cmd, io.ReadWriteCloser, error) {
		// Return a benign cmd that never actually runs (Process=nil).
		return &exec.Cmd{}, rwc, nil
	}
	c, err := openWith(context.Background(), "test", sink, dial, realSleep)
	if err != nil {
		t.Fatalf("openWith: %v", err)
	}

	// Wait for generation > 0.
	deadline := time.Now().Add(2 * time.Second)
	for c.Generation() == 0 {
		if time.Now().After(deadline) {
			t.Fatalf("generation never advanced")
		}
		time.Sleep(5 * time.Millisecond)
	}
	if c.Generation() != 1 {
		t.Fatalf("expected generation=1, got %d", c.Generation())
	}

	sink.mu.Lock()
	if len(sink.swcEvents) != 1 || sink.swcEvents[0].SessionID != "$1" || sink.swcEvents[0].WindowID != "@42" {
		sink.mu.Unlock()
		t.Fatalf("unexpected sink events: %+v", sink.swcEvents)
	}
	if sink.established != 1 {
		sink.mu.Unlock()
		t.Fatalf("expected 1 established, got %d", sink.established)
	}
	sink.mu.Unlock()

	// Wait(0) — already advanced, returns closed channel immediately.
	select {
	case <-c.Wait(0):
	case <-time.After(100 * time.Millisecond):
		t.Fatal("Wait(0) did not return after advance")
	}

	_ = c.Close()
}

// TestClient_WaitBlocksUntilEvent ensures Wait(after) returns a not-yet-closed
// channel when generation == after, and closes when an event arrives.
func TestClient_WaitBlocksUntilEvent(t *testing.T) {
	resetLoggedUnknowns()
	sink := &recordingSink{}

	pr, pw := io.Pipe()
	rwc := &pipeReader{r: pr}

	dial := func(ctx context.Context, socket string) (*exec.Cmd, io.ReadWriteCloser, error) {
		return &exec.Cmd{}, rwc, nil
	}
	c, err := openWith(context.Background(), "test", sink, dial, realSleep)
	if err != nil {
		t.Fatalf("openWith: %v", err)
	}
	defer c.Close()

	// Begin-handshake first.
	_, _ = pw.Write([]byte("%begin 1 1 0\n"))

	// Snapshot the current (post-handshake) generation, then wait for >.
	prev := c.Generation()
	waitCh := c.Wait(prev)

	// Channel should not be closed yet.
	select {
	case <-waitCh:
		t.Fatal("Wait returned before any event")
	case <-time.After(50 * time.Millisecond):
	}

	// Send a session-window-changed → should close waitCh.
	_, _ = pw.Write([]byte("%session-window-changed $1 @1\n"))
	select {
	case <-waitCh:
	case <-time.After(2 * time.Second):
		t.Fatal("Wait did not close after event")
	}
}

// TestClient_BackoffSequence drives the FSM through dial failures, asserting
// the 250ms / 500ms / 1s / 2s / 5s / 5s sequence.
func TestClient_BackoffSequence(t *testing.T) {
	resetLoggedUnknowns()
	sink := &recordingSink{}
	fs := &fakeSleep{}

	dialAttempts := atomic.Int32{}
	dial := func(ctx context.Context, socket string) (*exec.Cmd, io.ReadWriteCloser, error) {
		dialAttempts.Add(1)
		// First call (initial Open) must succeed; subsequent calls fail.
		if dialAttempts.Load() == 1 {
			// Return a reader that immediately EOFs to trigger the
			// reconnect path.
			return &exec.Cmd{}, newPipeReaderEOF(nil), nil
		}
		return nil, nil, errors.New("dial failed")
	}

	c, err := openWith(context.Background(), "test", sink, dial, fs.sleep)
	if err != nil {
		t.Fatalf("openWith: %v", err)
	}
	defer c.Close()

	// After the initial read EOFs, the readLoop calls sleep before dialing.
	// Expected sequence (cap at 5s): 250ms, 500ms, 1s, 2s, 5s, 5s ...
	want := []time.Duration{250 * time.Millisecond, 500 * time.Millisecond, time.Second, 2 * time.Second, 5 * time.Second, 5 * time.Second}
	for i, w := range want {
		got := fs.triggerNext(t, 2*time.Second)
		if got != w {
			t.Errorf("backoff step %d: want %v, got %v", i, w, got)
		}
	}
}

// TestClient_CloseCancelsReconnect ensures Close() interrupts an in-flight
// backoff sleep and terminates the read loop.
func TestClient_CloseCancelsReconnect(t *testing.T) {
	resetLoggedUnknowns()
	sink := &recordingSink{}
	fs := &fakeSleep{}

	dialN := atomic.Int32{}
	dial := func(ctx context.Context, socket string) (*exec.Cmd, io.ReadWriteCloser, error) {
		dialN.Add(1)
		if dialN.Load() == 1 {
			return &exec.Cmd{}, newPipeReaderEOF(nil), nil
		}
		// Block forever — Close should cancel before this is called again.
		return nil, nil, errors.New("should not be called after Close")
	}

	c, err := openWith(context.Background(), "test", sink, dial, fs.sleep)
	if err != nil {
		t.Fatalf("openWith: %v", err)
	}

	// Give the readLoop time to hit the first sleep.
	time.Sleep(20 * time.Millisecond)

	closeDone := make(chan struct{})
	go func() {
		_ = c.Close()
		close(closeDone)
	}()
	select {
	case <-closeDone:
	case <-time.After(2 * time.Second):
		t.Fatal("Close did not return")
	}
}

// TestClient_OpenErrorPropagates verifies that an initial dial failure is
// returned synchronously from Open.
func TestClient_OpenErrorPropagates(t *testing.T) {
	resetLoggedUnknowns()
	sink := &recordingSink{}
	dial := func(ctx context.Context, socket string) (*exec.Cmd, io.ReadWriteCloser, error) {
		return nil, nil, errors.New("PTY allocation failed")
	}
	_, err := openWith(context.Background(), "test", sink, dial, realSleep)
	if err == nil {
		t.Fatal("expected error from Open on initial dial failure")
	}
}

// TestClient_BackoffResetsOnFirstNonBeginEvent verifies that the reset-on-read
// invariant: after backoff has grown to 5s, a successful reconnect that yields
// a notification SHALL reset backoff to 250ms.
func TestClient_BackoffResetsOnFirstNonBeginEvent(t *testing.T) {
	resetLoggedUnknowns()
	sink := &recordingSink{}
	fs := &fakeSleep{}

	dialN := atomic.Int32{}
	// We'll deliver two streams: first a successful read that immediately
	// EOFs (no notifications, so backoff grows on next reconnect), then
	// a stream with a real notification followed by EOF, then a successful
	// reconnect — should reset backoff.
	streams := [][]byte{
		// initial: %begin then EOF
		[]byte("%begin 1 1 0\n"),
		// stream #2: %begin + notification then EOF — backoff resets
		[]byte("%begin 1 1 0\n%sessions-changed\n"),
		// stream #3: %begin then EOF — next backoff after this should
		// be the initial value since the previous reconnect saw a
		// notification.
		[]byte("%begin 1 1 0\n"),
	}
	dial := func(ctx context.Context, socket string) (*exec.Cmd, io.ReadWriteCloser, error) {
		idx := int(dialN.Add(1)) - 1
		if idx >= len(streams) {
			return nil, nil, errors.New("dial exhausted")
		}
		return &exec.Cmd{}, newPipeReaderEOF(streams[idx]), nil
	}

	c, err := openWith(context.Background(), "test", sink, dial, fs.sleep)
	if err != nil {
		t.Fatalf("openWith: %v", err)
	}
	defer c.Close()

	// After EOF on stream 0 → sleep 250ms (initial backoff).
	if got := fs.triggerNext(t, 2*time.Second); got != 250*time.Millisecond {
		t.Fatalf("after stream 0, want 250ms, got %v", got)
	}
	// Stream 1 delivers a notification — backoff resets. EOF → sleep 250ms.
	if got := fs.triggerNext(t, 2*time.Second); got != 250*time.Millisecond {
		t.Fatalf("after stream 1 (reset), want 250ms, got %v", got)
	}
}

// TestClient_DispatchOrderPreserved ensures multi-line streams dispatch in
// arrival order.
func TestClient_DispatchOrderPreserved(t *testing.T) {
	resetLoggedUnknowns()
	sink := &recordingSink{}
	stream := []byte("%begin 1 1 0\n%window-add @1\n%window-add @2\n%window-add @3\n")
	rwc := newPipeReaderFromBytes(stream)
	dial := func(ctx context.Context, socket string) (*exec.Cmd, io.ReadWriteCloser, error) {
		return &exec.Cmd{}, rwc, nil
	}
	c, err := openWith(context.Background(), "test", sink, dial, realSleep)
	if err != nil {
		t.Fatalf("openWith: %v", err)
	}
	defer c.Close()

	deadline := time.Now().Add(2 * time.Second)
	for c.Generation() < 3 {
		if time.Now().After(deadline) {
			t.Fatalf("only saw generation=%d", c.Generation())
		}
		time.Sleep(5 * time.Millisecond)
	}

	sink.mu.Lock()
	defer sink.mu.Unlock()
	if len(sink.winAdd) != 3 {
		t.Fatalf("expected 3 winAdd, got %d", len(sink.winAdd))
	}
	if sink.winAdd[0].WindowID != "@1" || sink.winAdd[1].WindowID != "@2" || sink.winAdd[2].WindowID != "@3" {
		t.Fatalf("order not preserved: %+v", sink.winAdd)
	}
}
