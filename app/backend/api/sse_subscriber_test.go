package api

import (
	"context"
	"fmt"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"rk/internal/sessions"
	"rk/internal/tmux"
)

// stubSubscriber is a test WindowChangeSubscriber: callers manually advance
// per-server generation via Bump(), which closes the wait channel of any
// outstanding Wait callers.
type stubSubscriber struct {
	mu       sync.Mutex
	gen      map[string]int64
	waiters  map[string][]chan struct{}
}

func newStubSubscriber() *stubSubscriber {
	return &stubSubscriber{
		gen:     map[string]int64{},
		waiters: map[string][]chan struct{}{},
	}
}

func (s *stubSubscriber) Generation(server string) int64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.gen[server]
}

func (s *stubSubscriber) Wait(server string, after int64) <-chan struct{} {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.gen[server] > after {
		ch := make(chan struct{})
		close(ch)
		return ch
	}
	w := make(chan struct{})
	s.waiters[server] = append(s.waiters[server], w)
	return w
}

// Covers always reports true: the stub models a control-covered server (Bump
// wakes its Wait channel event-driven), so the hub may use the long safety
// interval. Tests that need the uncovered fast-poll path use neverSubscriber.
func (s *stubSubscriber) Covers(string) bool { return true }

func (s *stubSubscriber) Bump(server string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.gen[server]++
	for _, w := range s.waiters[server] {
		close(w)
	}
	s.waiters[server] = nil
}

// fetchTracker counts FetchSessions calls per server. We use it to assert
// that a Bump on the subscriber wakes the poll loop sooner than the
// safety-net ticker would.
type fetchTracker struct {
	mu     sync.Mutex
	count  atomic.Int64
	result map[string][]sessions.ProjectSession
}

func (f *fetchTracker) FetchSessions(ctx context.Context, server string) ([]sessions.ProjectSession, error) {
	f.count.Add(1)
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.result[server], nil
}

// TestSSE_EventDrivenWakesOnSubscriberBump verifies that when a subscriber is
// wired and a Bump fires, the SSE loop snapshots+broadcasts sooner than the
// safety-net cadence would.
func TestSSE_EventDrivenWakesOnSubscriberBump(t *testing.T) {
	sub := newStubSubscriber()
	tracker := &fetchTracker{
		result: map[string][]sessions.ProjectSession{
			"kits": {{
				Name: "s1",
				Windows: []tmux.WindowInfo{
					{Index: 0, Name: "w0", IsActiveWindow: true},
				},
			}},
		},
	}
	hub := newSSEHub(tracker, nil)
	hub.subscriber = sub
	hub.safetyInterval = 5 * time.Second // long enough that the test
	// would clearly fail if it had to wait for the timer.

	client := &sseClient{ch: make(chan []byte, 8), server: "kits"}
	hub.addClient(client)
	t.Cleanup(func() { hub.removeClient(client) })

	// Drain the bootstrap snapshot.
	select {
	case <-client.ch:
	case <-time.After(2 * time.Second):
		t.Fatal("no bootstrap snapshot delivered")
	}

	// Drain initial board bootstrap if pending.
	drainDeadline := time.Now().Add(200 * time.Millisecond)
	for time.Now().Before(drainDeadline) {
		select {
		case <-client.ch:
		default:
			time.Sleep(20 * time.Millisecond)
		}
	}

	prevFetches := tracker.count.Load()

	// Change the result and bump — loop should wake and broadcast.
	tracker.mu.Lock()
	tracker.result["kits"] = []sessions.ProjectSession{{
		Name: "s1",
		Windows: []tmux.WindowInfo{
			{Index: 0, Name: "w0", IsActiveWindow: false},
			{Index: 1, Name: "w1", IsActiveWindow: true},
		},
	}}
	tracker.mu.Unlock()

	// Give the loop a moment to enter waitForNext before bumping.
	time.Sleep(50 * time.Millisecond)
	bumpTime := time.Now()
	sub.Bump("kits")

	// Look for a fresh `event: sessions` payload that includes w1. Skip
	// any metrics or heartbeat events.
	deadline := time.After(2 * time.Second)
	var got string
	var allReceived []string
loop:
	for {
		select {
		case b := <-client.ch:
			got = string(b)
			allReceived = append(allReceived, got)
			if strings.Contains(got, "event: sessions") && strings.Contains(got, "\"w1\"") {
				break loop
			}
		case <-deadline:
			t.Fatalf("never observed event-driven snapshot containing w1 (received %d events: %v, fetches: %d→%d, gen: %d)",
				len(allReceived), allReceived, prevFetches, tracker.count.Load(), sub.Generation("kits"))
		}
	}

	elapsed := time.Since(bumpTime)
	if elapsed > 1*time.Second {
		t.Errorf("event-driven snapshot took %v (want sub-second when subscriber bumps)", elapsed)
	}
}

// TestSSE_SafetyTickerFiresWithoutSubscriber verifies the legacy fallback:
// no subscriber means snapshots are driven by the timer alone.
func TestSSE_SafetyTickerFiresWithoutSubscriber(t *testing.T) {
	tracker := &fetchTracker{
		result: map[string][]sessions.ProjectSession{
			"kits": {{Name: "s1"}},
		},
	}
	hub := newSSEHub(tracker, nil)
	hub.safetyInterval = 50 * time.Millisecond

	client := &sseClient{ch: make(chan []byte, 16), server: "kits"}
	hub.addClient(client)
	t.Cleanup(func() { hub.removeClient(client) })

	// Drain bootstrap.
	select {
	case <-client.ch:
	case <-time.After(time.Second):
		t.Fatal("no bootstrap")
	}

	// Mutate the result and wait for the ticker to deliver an updated
	// payload.
	tracker.mu.Lock()
	tracker.result["kits"] = []sessions.ProjectSession{{Name: "s1"}, {Name: "s2"}}
	tracker.mu.Unlock()

	deadline := time.After(1 * time.Second)
	for {
		select {
		case b := <-client.ch:
			if strings.Contains(string(b), "s2") {
				return
			}
		case <-deadline:
			t.Fatalf("never observed ticker-driven snapshot containing s2")
		}
	}
}

// neverSubscriber is a WindowChangeSubscriber whose Wait channel never closes
// for any server — models the PTY-unavailable case where supervisorSubscriber
// has no Client for the requested socket. The SSE loop MUST fall through to
// the safety-net timer rather than spinning on a pre-closed channel.
type neverSubscriber struct{}

func (neverSubscriber) Generation(string) int64 { return 0 }
func (neverSubscriber) Wait(string, int64) <-chan struct{} {
	// Fresh never-closing channel per call so the loop's repeat invocations
	// each get a distinct channel object.
	return make(chan struct{})
}

// Covers reports false: neverSubscriber models the no-Client case, so every
// server is uncovered and the hub must use the fast safety cadence.
func (neverSubscriber) Covers(string) bool { return false }

// TestSSE_PTYUnavailableDoesNotBusyLoop is the regression test for the
// PTY-unavailable busy-loop fix: when the WindowChangeSubscriber returns a
// never-closing Wait channel for a server (because Get(server) returned nil),
// the SSE poll loop MUST honor the safety-net cadence rather than spinning
// on FetchSessions every loop iteration.
func TestSSE_PTYUnavailableDoesNotBusyLoop(t *testing.T) {
	tracker := &fetchTracker{
		result: map[string][]sessions.ProjectSession{
			"kits": {{Name: "s1"}},
		},
	}
	hub := newSSEHub(tracker, nil)
	hub.subscriber = neverSubscriber{}
	// 200ms safety interval so a healthy loop ticks ~5 times per second;
	// a busy-loop would call FetchSessions hundreds of times in 250ms.
	hub.safetyInterval = 200 * time.Millisecond

	client := &sseClient{ch: make(chan []byte, 32), server: "kits"}
	hub.addClient(client)
	t.Cleanup(func() { hub.removeClient(client) })

	// Drain bootstrap.
	select {
	case <-client.ch:
	case <-time.After(time.Second):
		t.Fatal("no bootstrap snapshot delivered")
	}

	// Snapshot the fetch count, then wait one safety interval + slack and
	// re-check. A correct loop will fetch ~1-2 times in 250ms (one
	// post-bootstrap tick at most). A busy-loop would fetch many tens or
	// hundreds of times.
	start := tracker.count.Load()
	time.Sleep(250 * time.Millisecond)
	got := tracker.count.Load() - start

	if got > 5 {
		t.Errorf("FetchSessions called %d times in 250ms — looks like a busy-loop (want <= 5 when safety interval is 200ms)", got)
	}
}

// TestSSE_WaitForNextDoesNotLeakGoroutines is the regression test for the
// goroutine leak in waitForNext: the previous implementation spawned a
// goroutine that blocked on timer.C and was abandoned when a subscriber
// fired first. We verify the goroutine count does not grow unboundedly when
// the subscriber wins the race repeatedly.
func TestSSE_WaitForNextDoesNotLeakGoroutines(t *testing.T) {
	sub := newStubSubscriber()
	tracker := &fetchTracker{
		result: map[string][]sessions.ProjectSession{
			"kits": {{Name: "s1"}},
		},
	}
	hub := newSSEHub(tracker, nil)
	hub.subscriber = sub
	hub.safetyInterval = 5 * time.Second // safety timer never wins.

	client := &sseClient{ch: make(chan []byte, 64), server: "kits"}
	hub.addClient(client)
	t.Cleanup(func() {
		hub.removeClient(client)
		// Allow the poll loop to observe zero clients and exit before
		// we record the post-test goroutine count.
		time.Sleep(50 * time.Millisecond)
	})

	// Drain bootstrap.
	select {
	case <-client.ch:
	case <-time.After(time.Second):
		t.Fatal("no bootstrap")
	}

	// Let the loop settle into waitForNext.
	time.Sleep(50 * time.Millisecond)
	baseline := runtime.NumGoroutine()

	// Fire many bumps in a row. Each one wakes waitForNext, runs the
	// loop body, and re-enters waitForNext. With the old goroutine leak
	// each iteration would orphan one timer-reader goroutine.
	const iterations = 200
	for i := 0; i < iterations; i++ {
		// Drain pending events so the SSE client channel doesn't fill.
		for len(client.ch) > 0 {
			<-client.ch
		}
		sub.Bump("kits")
		time.Sleep(2 * time.Millisecond)
	}

	// Give the loop a moment to settle back into waitForNext after the
	// last bump, and drain any trailing events.
	time.Sleep(100 * time.Millisecond)
	for len(client.ch) > 0 {
		<-client.ch
	}
	time.Sleep(50 * time.Millisecond)

	after := runtime.NumGoroutine()
	// Allow a small slack — runtime + test framework can fluctuate. A
	// real leak would show ~200 extra goroutines, so a threshold of 20
	// is generous but well below the leak signal.
	if after-baseline > 20 {
		t.Errorf("goroutine count grew by %d after %d bumps (baseline %d, after %d) — possible leak in waitForNext",
			after-baseline, iterations, baseline, after)
	}
}

// coverageSubscriber is a WindowChangeSubscriber whose Covers result is driven
// by a per-server map. Generation/Wait are inert (never fire) — this stub
// exists only to exercise safetyIntervalEffective's coverage branching.
type coverageSubscriber struct{ covered map[string]bool }

func (coverageSubscriber) Generation(string) int64            { return 0 }
func (coverageSubscriber) Wait(string, int64) <-chan struct{} { return make(chan struct{}) }
func (c coverageSubscriber) Covers(server string) bool        { return c.covered[server] }

// TestSafetyIntervalEffective verifies the per-server interval selection that
// fixes the SSE-sync latency: the long control-mode interval applies only when
// EVERY watched server is covered; one uncovered server (e.g. an rk-test-*
// server the supervisor skips) forces the fast cadence so its external changes
// surface within the test timeout instead of waiting for the 12s backstop.
func TestSafetyIntervalEffective(t *testing.T) {
	t.Run("no subscriber -> legacy fast", func(t *testing.T) {
		h := newSSEHub(&fetchTracker{}, nil)
		if got := h.safetyIntervalEffective([]string{"any"}); got != legacyPollInterval {
			t.Fatalf("got %v, want %v", got, legacyPollInterval)
		}
	})
	t.Run("all covered -> long safety interval", func(t *testing.T) {
		h := newSSEHub(&fetchTracker{}, nil)
		h.subscriber = coverageSubscriber{covered: map[string]bool{"a": true, "b": true}}
		if got := h.safetyIntervalEffective([]string{"a", "b"}); got != safetyPollInterval {
			t.Fatalf("got %v, want %v", got, safetyPollInterval)
		}
	})
	t.Run("any uncovered -> legacy fast", func(t *testing.T) {
		h := newSSEHub(&fetchTracker{}, nil)
		h.subscriber = coverageSubscriber{covered: map[string]bool{"a": true, "rk-test-e2e": false}}
		if got := h.safetyIntervalEffective([]string{"a", "rk-test-e2e"}); got != legacyPollInterval {
			t.Fatalf("got %v, want %v (an uncovered server must force the fast cadence)", got, legacyPollInterval)
		}
	})
	t.Run("explicit override wins", func(t *testing.T) {
		h := newSSEHub(&fetchTracker{}, nil)
		h.subscriber = coverageSubscriber{covered: map[string]bool{}}
		h.safetyInterval = 99 * time.Millisecond
		if got := h.safetyIntervalEffective([]string{"uncovered"}); got != 99*time.Millisecond {
			t.Fatalf("got %v, want explicit override 99ms", got)
		}
	})
}

// Silence unused-import warning if the kit changes shape.
var _ = fmt.Sprintf
