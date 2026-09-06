package main

import (
	"context"
	"time"

	"rk/internal/cron"

	"github.com/spf13/cobra"
)

// rk cron tick — the invoker verb: one evaluation sweep across every live
// server via cron.Tick with production defaults (zero-value Deps: flock,
// live-server filter, TMUX scrub, tolerant load). No Deliverer is wired — the
// delivery wave substitutes the injection engine behind that seam; until then
// fires record outcome no-deliverer. A held lock is a clean, quiet exit 0 (no
// output — skip-on-contention is correct because ticks are idempotent). -L is
// rejected: the sweep is all-live-servers by design.

// cronTickTimeout bounds the whole sweep; the per-call tmux timeouts apply
// underneath (Constitution §I).
const cronTickTimeout = 60 * time.Second

// cronTickDepsFn / cronTickRunFn are the seams so the verb is testable without
// live servers: tests inject a temp Dir (and a stubbed server list) through
// the deps, or stub the run outright.
var (
	cronTickDepsFn = func() cron.Deps { return cron.Deps{} }
	cronTickRunFn  = func(ctx context.Context, deps cron.Deps) (cron.TickResult, error) {
		return cron.Tick(ctx, deps)
	}
)

var cronTickCmd = &cobra.Command{
	Use:   "tick",
	Short: "Run one cron evaluation sweep across every live server",
	Long: "Run one cron tick: load every live server's entry file, evaluate due " +
		"fires, record deliveries, and persist the wake cursors. The sweep is " +
		"flock-guarded and idempotent — safe to invoke repeatedly or " +
		"concurrently; a held lock exits 0 quietly. Delivery is not wired yet, " +
		"so fires record outcome no-deliverer. -L does not apply: the sweep " +
		"covers every live server.",
	Args: usageArgs(cobra.NoArgs),
	RunE: func(cmd *cobra.Command, _ []string) error {
		return runCronTick(cmd)
	},
}

func runCronTick(cmd *cobra.Command) error {
	if err := cronRejectInheritedServerFlag(cmd); err != nil {
		return err
	}
	parent := cmd.Context()
	if parent == nil {
		parent = context.Background()
	}
	ctx, cancel := context.WithTimeout(parent, cronTickTimeout)
	defer cancel()

	res, err := cronTickRunFn(ctx, cronTickDepsFn())
	if err != nil {
		return err
	}
	if res.Held {
		return nil
	}
	newSink(cmd).Dataf("tick: %d servers swept, %d fires, %d diagnostics\n", res.Servers, res.Fires, len(res.Diags))
	return nil
}
