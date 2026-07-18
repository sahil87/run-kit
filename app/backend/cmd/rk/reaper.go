package main

import (
	"fmt"
	"io"

	"rk/internal/tmux"

	"github.com/spf13/cobra"
)

var (
	reaperPrefix string
	reaperYes    bool
	reaperForce  bool
	reaperDryRun bool
	reaperAll    bool
)

// reaperListCap is the default per-list display cap (Toolkit Principle 9),
// mirroring `shll changelog`'s 10-release cap for toolkit-wide consistency. It
// is DISPLAY-ONLY: it bounds how many entries a rendered list prints, never
// what is reaped. --all restores the full list on either path.
const reaperListCap = 10

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
since it would match nearly everything (runkit, production).

Each rendered list is capped at 10 entries by default with a stated truncation
notice; the cap is DISPLAY-ONLY (header counts stay exact and --yes/--force
still reap every match) — pass --all to print the full list.`,
	RunE: func(cmd *cobra.Command, args []string) error {
		ctx := cmd.Context()

		// Dry-run is the default. Acting requires an explicit --yes or --force.
		// --dry-run is retained as an explicit alias for the default preview and
		// always wins (forces preview even if --yes/--force were also passed).
		// --force is the ONLY flag that bypasses the dangerous-prefix guard;
		// --yes acts but a short/mistyped prefix is still refused under it.
		act := (reaperYes || reaperForce) && !reaperDryRun

		result, reapErr := tmux.ReapTestServers(ctx, reaperPrefix, act, reaperForce)

		// Reaper output is all data (a dry-run's candidate list is the requested
		// result; an act summary is the record of a destructive mutation), so it
		// flows through the data channel (cmd.OutOrStdout()) and --quiet changes
		// nothing here. Routing through the writer also makes the cap testable.
		out := cmd.OutOrStdout()
		if act {
			renderReapSummary(out, result, reaperAll)
		} else {
			renderDryRun(out, result.DryRunPlan, reaperAll)
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
	reaperCmd.Flags().BoolVar(&reaperAll, "all", false, "print the full list instead of the default 10-entry-per-list cap (display-only)")
}

// renderDryRun lists each candidate annotated with its would-be action and
// states that nothing was touched. The list caps at reaperListCap entries
// unless all is set; the header count is always the full candidate count.
func renderDryRun(w io.Writer, plan []tmux.ReapPlanEntry, all bool) {
	if len(plan) == 0 {
		fmt.Fprintln(w, "Dry run: nothing to reap.")
		return
	}
	fmt.Fprintf(w, "Dry run: %d candidate(s) would be reaped (nothing was touched). Pass --yes to act:\n", len(plan))
	shown := plan
	if !all && len(plan) > reaperListCap {
		shown = plan[:reaperListCap]
	}
	for _, e := range shown {
		fmt.Fprintf(w, "  %-6s %s\n", reapActionLabel(e.Action), e.Name)
	}
	renderTruncationNotice(w, "  ", len(plan), len(shown))
}

// renderReapSummary prints the count and names of killed servers and removed
// sockets/lock files. Each list caps independently at reaperListCap entries
// unless all is set; header counts are always the full totals.
func renderReapSummary(w io.Writer, result tmux.ReapResult, all bool) {
	total := len(result.Killed) + len(result.RemovedSockets)
	if total == 0 {
		fmt.Fprintln(w, "Nothing to reap.")
		return
	}
	fmt.Fprintf(w, "Reaped %d entry(ies):\n", total)
	if len(result.Killed) > 0 {
		fmt.Fprintf(w, "  killed %d live server(s):\n", len(result.Killed))
		renderCappedNames(w, "    ", result.Killed, all)
	}
	if len(result.RemovedSockets) > 0 {
		fmt.Fprintf(w, "  removed %d dead socket(s)/lock file(s):\n", len(result.RemovedSockets))
		renderCappedNames(w, "    ", result.RemovedSockets, all)
	}
}

// renderCappedNames prints up to reaperListCap names (all when `all` is set),
// each indented by prefix, then a truncation notice when the list was capped.
func renderCappedNames(w io.Writer, prefix string, names []string, all bool) {
	shown := names
	if !all && len(names) > reaperListCap {
		shown = names[:reaperListCap]
	}
	for _, name := range shown {
		fmt.Fprintf(w, "%s%s\n", prefix, name)
	}
	renderTruncationNotice(w, prefix, len(names), len(shown))
}

// renderTruncationNotice states, in output, that a list was capped (silent
// truncation reads as completeness — Toolkit Principle 9). It prints nothing
// when the full list was shown (total == shown).
func renderTruncationNotice(w io.Writer, prefix string, total, shown int) {
	if shown >= total {
		return
	}
	fmt.Fprintf(w, "%s… and %d more; pass --all to list all\n", prefix, total-shown)
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
