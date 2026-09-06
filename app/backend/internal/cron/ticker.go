package cron

import (
	"context"
	"log/slog"
	"time"

	"rk/internal/settings"
)

// ticker.go — the daemon ticker: the evaluator's default invoker. An isolated
// goroutine sharing no locks with the serving path (the only serialization is
// Tick's own non-blocking flock), bound to the serve context, gated per
// iteration by the cron_ticker setting.

// DefaultTickInterval is the tick cadence. The operator backoff schedule's min
// is 60s, so a 30s poll bounds fire lateness to half the smallest rung;
// wake_on is approximated by the same poll.
const DefaultTickInterval = 30 * time.Second

// tickTimeout bounds one iteration. Overlap is already impossible (Tick's
// flock serializes invokers); the timeout only bounds a hung enumeration.
const tickTimeout = 30 * time.Second

// Ticker invokes Tick on a fixed cadence. The interval, tickFn, and enabled
// seams exist so tests run fast without tmux or a settings file.
type Ticker struct {
	deps     Deps
	interval time.Duration
	tickFn   func(ctx context.Context, deps Deps) (TickResult, error)
	// enabled is the per-iteration settings gate (settings.Load().CronTicker
	// in production): read EVERY iteration so a flip takes effect without a
	// daemon restart.
	enabled func() bool
}

// NewTicker returns a ticker invoking Tick with deps at DefaultTickInterval.
func NewTicker(deps Deps) *Ticker {
	return &Ticker{
		deps:     deps,
		interval: DefaultTickInterval,
		tickFn:   Tick,
		enabled:  func() bool { return settings.Load().CronTicker },
	}
}

// Start launches the tick loop in a goroutine. It exits when ctx is done.
func (t *Ticker) Start(ctx context.Context) {
	go t.run(ctx)
}

func (t *Ticker) run(ctx context.Context) {
	ticker := time.NewTicker(t.interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			t.iterate(ctx)
		}
	}
}

// iterate runs one tick iteration: settings gate → per-tick timeout ctx →
// Tick. A panicking tick is recovered and logged — it skips the iteration,
// never kills the daemon.
func (t *Ticker) iterate(ctx context.Context) {
	defer func() {
		if r := recover(); r != nil {
			slog.Error("cron tick panicked; skipping iteration", "panic", r)
		}
	}()
	if !t.enabled() {
		slog.Debug("cron ticker: cron_ticker off; skipping iteration")
		return
	}
	tickCtx, cancel := context.WithTimeout(ctx, tickTimeout)
	defer cancel()
	if _, err := t.tickFn(tickCtx, t.deps); err != nil {
		slog.Warn("cron tick failed", "err", err)
	}
}
