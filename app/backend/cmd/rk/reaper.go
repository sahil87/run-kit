package main

import (
	"fmt"

	"rk/internal/tmux"

	"github.com/spf13/cobra"
)

var (
	reaperPrefix string
	reaperYes    bool
	reaperForce  bool
	reaperDryRun bool
)

var reaperCmd = &cobra.Command{
	Use:   "reaper",
	Short: "Reap leaked test tmux servers and stale sockets by prefix",
	Long: `Reaper is an operator-invoked janitor of last resort. It scans the tmux
socket directory (/tmp/tmux-{uid}/) and reaps EVERY artifact whose name starts
with the prefix — brute-force-by-prefix, with no liveness protection:

  - live matched servers   → killed (tmux kill-server)
  - matched dead sockets   → removed (the daemon already exited)
  - matched *.lock files   → removed

Bare "run-kit reaper" is equivalent to "run-kit reaper --prefix rk-test", matching every
rk-test* server, socket, and lock file. Pass --prefix to target a different
family (e.g. --prefix proj reaps proj*).

There is NO PID-liveness gate: a matched candidate reaps unconditionally, so
the operator running this asserts that nothing live needs the matched sockets.
DO NOT run run-kit reaper (bare or --prefix) while tests are running — it will kill
their live tmux servers. The automatic post-sweep in TestMain protects
concurrent test processes; this manual tool relies on the human.

Dry-run is the DEFAULT. Bare "run-kit reaper" (and --prefix) print the match list
with each entry's classified action (kill/remove) and touch NOTHING. Pass --yes
(or --force) to actually reap.

The _rk-ctl control anchor and the live rk-daemon production server are skipped
UNCONDITIONALLY, even under --prefix and even with --yes/--force. An empty
prefix or one of 3 characters or fewer (e.g. "rk-") is refused unless --force,
since it would match nearly everything (runkit, production).`,
	RunE: func(cmd *cobra.Command, args []string) error {
		ctx := cmd.Context()

		// Dry-run is the default. Acting requires an explicit --yes or --force.
		// --dry-run is retained as an explicit alias for the default preview and
		// always wins (forces preview even if --yes/--force were also passed).
		// --force is the ONLY flag that bypasses the dangerous-prefix guard;
		// --yes acts but a short/mistyped prefix is still refused under it.
		act := (reaperYes || reaperForce) && !reaperDryRun

		result, reapErr := tmux.ReapTestServers(ctx, reaperPrefix, act, reaperForce)

		if act {
			renderReapSummary(result)
		} else {
			renderDryRun(result.DryRunPlan)
		}

		// A partial-failure aggregate error is surfaced after the summary so
		// the operator sees what was reaped even when some entries failed.
		return reapErr
	},
}

func init() {
	reaperCmd.Flags().StringVar(&reaperPrefix, "prefix", "rk-test", "socket-name prefix to match (bare reaper ≡ --prefix rk-test)")
	reaperCmd.Flags().BoolVar(&reaperYes, "yes", false, "actually reap matched servers/sockets (default is dry-run preview)")
	reaperCmd.Flags().BoolVar(&reaperForce, "force", false, "act, and bypass the dangerous-prefix guard (empty or ≤3-char prefix)")
	reaperCmd.Flags().BoolVar(&reaperDryRun, "dry-run", false, "explicit alias for the default preview-only behavior")
}

// renderDryRun lists each candidate annotated with its would-be action and
// states that nothing was touched.
func renderDryRun(plan []tmux.ReapPlanEntry) {
	if len(plan) == 0 {
		fmt.Println("Dry run: nothing to reap.")
		return
	}
	fmt.Printf("Dry run: %d candidate(s) would be reaped (nothing was touched). Pass --yes to act:\n", len(plan))
	for _, e := range plan {
		fmt.Printf("  %-6s %s\n", reapActionLabel(e.Action), e.Name)
	}
}

// renderReapSummary prints the count and names of killed servers and removed
// sockets/lock files.
func renderReapSummary(result tmux.ReapResult) {
	total := len(result.Killed) + len(result.RemovedSockets)
	if total == 0 {
		fmt.Println("Nothing to reap.")
		return
	}
	fmt.Printf("Reaped %d entry(ies):\n", total)
	if len(result.Killed) > 0 {
		fmt.Printf("  killed %d live server(s):\n", len(result.Killed))
		for _, name := range result.Killed {
			fmt.Printf("    %s\n", name)
		}
	}
	if len(result.RemovedSockets) > 0 {
		fmt.Printf("  removed %d dead socket(s)/lock file(s):\n", len(result.RemovedSockets))
		for _, name := range result.RemovedSockets {
			fmt.Printf("    %s\n", name)
		}
	}
}

// reapActionLabel renders a human-readable label for a dry-run plan entry's
// action. The reaper only records kill/remove entries in the dry-run plan, so
// the skip case is never expected here.
func reapActionLabel(a tmux.ReapAction) string {
	switch a {
	case tmux.ReapActionKill:
		return "kill"
	case tmux.ReapActionRemove:
		return "remove"
	default:
		return "skip"
	}
}
