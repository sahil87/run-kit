package main

import (
	"fmt"

	"rk/internal/tmux"

	"github.com/spf13/cobra"
)

var reaperDryRun bool

var reaperCmd = &cobra.Command{
	Use:   "reaper",
	Short: "Reap leaked test tmux servers and stale sockets",
	Long: `Reaper is an operator-invoked janitor of last resort. It scans the tmux
socket directory (/tmp/tmux-{uid}/) and reaps leaked Go-test scaffolding:

  - live orphan test servers   → killed (tmux kill-server)
  - dead test sockets          → removed (the daemon already exited)
  - stale *.lock sockets        → removed

Live non-test servers, rk-e2e-* sockets, and the _rk-ctl control anchor are
never touched. There is no PID-liveness gate — matched candidates reap
unconditionally, so the operator running this asserts nothing live needs them.

Use --dry-run to preview the candidates and their classified actions without
killing or removing anything.`,
	RunE: func(cmd *cobra.Command, args []string) error {
		ctx := cmd.Context()

		result, reapErr := tmux.ReapTestServers(ctx, reaperDryRun)

		if reaperDryRun {
			renderDryRun(result.DryRunPlan)
		} else {
			renderReapSummary(result)
		}

		// A partial-failure aggregate error is surfaced after the summary so
		// the operator sees what was reaped even when some entries failed.
		return reapErr
	},
}

func init() {
	reaperCmd.Flags().BoolVar(&reaperDryRun, "dry-run", false, "preview candidates without killing or removing anything")
}

// renderDryRun lists each candidate annotated with its would-be action and
// states that nothing was touched.
func renderDryRun(plan []tmux.ReapPlanEntry) {
	if len(plan) == 0 {
		fmt.Println("Dry run: nothing to reap.")
		return
	}
	fmt.Printf("Dry run: %d candidate(s) would be reaped (nothing was touched):\n", len(plan))
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
		fmt.Printf("  killed %d live test server(s):\n", len(result.Killed))
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
