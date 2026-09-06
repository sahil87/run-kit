package cron

import (
	"context"
	"sync/atomic"
	"testing"
	"time"
)

// newTestTicker returns a Ticker on a 5ms interval with a counting tick seam.
func newTestTicker() (*Ticker, *atomic.Int64) {
	var calls atomic.Int64
	tk := NewTicker(Deps{})
	tk.interval = 5 * time.Millisecond
	tk.enabled = func() bool { return true }
	tk.tickFn = func(ctx context.Context, deps Deps) (TickResult, error) {
		calls.Add(1)
		return TickResult{}, nil
	}
	return tk, &calls
}

// waitForCalls polls until the tick seam has been called n times.
func waitForCalls(t *testing.T, calls *atomic.Int64, n int64) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for calls.Load() < n {
		if time.Now().After(deadline) {
			t.Fatalf("tick calls = %d, want >= %d within 5s", calls.Load(), n)
		}
		time.Sleep(time.Millisecond)
	}
}

func TestTickerInvokesTickOnCadence(t *testing.T) {
	tk, calls := newTestTicker()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	tk.Start(ctx)
	waitForCalls(t, calls, 2)
}

func TestTickerSettingGateSkipsIteration(t *testing.T) {
	tk, calls := newTestTicker()
	var on atomic.Bool
	tk.enabled = on.Load

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	tk.Start(ctx)
	time.Sleep(50 * time.Millisecond)
	if got := calls.Load(); got != 0 {
		t.Fatalf("gate off: tick calls = %d, want 0", got)
	}

	// Flipping the setting on takes effect on the next iteration — no restart.
	on.Store(true)
	waitForCalls(t, calls, 1)
}

func TestTickerSurvivesTickPanic(t *testing.T) {
	tk, calls := newTestTicker()
	tk.tickFn = func(ctx context.Context, deps Deps) (TickResult, error) {
		if calls.Add(1) == 1 {
			panic("boom")
		}
		return TickResult{}, nil
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	tk.Start(ctx)
	// The first iteration panics; later iterations still run on schedule.
	waitForCalls(t, calls, 3)
}

func TestTickerStopsOnContextDone(t *testing.T) {
	tk, calls := newTestTicker()
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		tk.run(ctx)
		close(done)
	}()
	waitForCalls(t, calls, 1)
	cancel()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("ticker did not stop after context cancellation")
	}
}

// TestTickerIterationTimeout: the tick runs under a per-iteration timeout ctx
// — a tick observing the deadline sees it fire at ~tickTimeout.
func TestTickerIterationTimeout(t *testing.T) {
	tk, _ := newTestTicker()
	deadlineSeen := make(chan time.Duration, 1)
	tk.tickFn = func(ctx context.Context, deps Deps) (TickResult, error) {
		d, ok := ctx.Deadline()
		if !ok {
			t.Error("tick ctx carries no deadline")
			return TickResult{}, nil
		}
		deadlineSeen <- time.Until(d)
		return TickResult{}, nil
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	tk.Start(ctx)
	select {
	case d := <-deadlineSeen:
		if d <= 0 || d > tickTimeout {
			t.Errorf("tick deadline = %v from now, want within (0, %v]", d, tickTimeout)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("tick never ran")
	}
}
