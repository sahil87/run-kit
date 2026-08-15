package main

import (
	"context"
	"fmt"

	"rk/internal/tmux"

	"github.com/spf13/cobra"
)

// rk mux kill <target> — kill a pane, gated on its reconciled @rk_agent_state
// (rk's twin is safer than fab's ungated `fab pane kill`): `active` and
// `waiting` panes REFUSE — never kill a working agent, and never silently drop
// a pane holding a pending human question; `idle` and unknown kill. --force
// skips the gate (the target's existence is still validated). Refusals name
// the state on stderr, exit 1, and perform no tmux mutation. On success stdout
// carries exactly one report line: `killed %N`. Exit codes follow the toolkit
// convention: 0 success, 1 operational (refusal, missing pane, tmux failure),
// 2 usage. No daemon dependency (the rk present pattern).

var muxKillForceFlag bool

var muxKillCmd = &cobra.Command{
	Use:   "kill <target> [--force]",
	Short: "Kill a pane, gated on its agent state",
	Long: "Kill the target pane, gated on its reconciled @rk_agent_state: a pane " +
		"whose agent is active or waiting (a pending human question) is refused " +
		"— the refusal names the state on stderr, exits 1, and touches nothing. " +
		"Idle and uninstrumented panes are killed. --force skips the gate; the " +
		"target's existence is still validated.\n\n" +
		"Targets: %N (pane), @N (window — resolves to its agent pane), " +
		"=session:window (exact). Bare session:window names are rejected.",
	Example: `  rk mux kill %12
  rk mux kill %12 --force
  rk mux kill @3`,
	Args: usageArgs(cobra.ExactArgs(1)),
	RunE: func(cmd *cobra.Command, args []string) error {
		return runMuxKill(cmd, args[0])
	},
}

func init() {
	muxKillCmd.Flags().BoolVar(&muxKillForceFlag, "force", false,
		"Skip the agent-state gate (the target must still exist)")
}

// muxKill*Fn are package-level seams so runMuxKill can be tested without a
// live tmux server (the mux_send.go pattern); the defaults delegate to
// internal/tmux.
var (
	muxKillAgentStateFn = func(ctx context.Context, paneID, server string) (string, error) {
		return tmux.PaneAgentState(ctx, paneID, server)
	}
	muxKillPaneExistsFn = func(ctx context.Context, paneID, server string) (bool, error) {
		return tmux.PaneExists(ctx, paneID, server)
	}
	muxKillPaneFn = func(ctx context.Context, paneID, server string) error {
		return tmux.KillPaneCtx(ctx, paneID, server)
	}
)

// runMuxKill is the testable core: parse → resolve → gate → kill → report.
func runMuxKill(cmd *cobra.Command, target string) error {
	pt, err := tmux.ParsePaneTarget(target)
	if err != nil {
		return usageError(err)
	}

	parent := cmd.Context()
	if parent == nil {
		parent = context.Background()
	}
	ctx, cancel := context.WithTimeout(parent, muxCmdTimeout)
	defer cancel()

	server := muxServer()
	sink := newSink(cmd)

	paneID, err := resolvePaneTarget(ctx, pt, server)
	if err != nil {
		return err
	}

	// The agent-state gate. --force skips it but the target's existence is
	// still validated (the mux_send.go --force pattern).
	if muxKillForceFlag {
		ok, err := muxKillPaneExistsFn(ctx, paneID, server)
		if err != nil {
			return fmt.Errorf("check target pane: %w", err)
		}
		if !ok {
			return fmt.Errorf("pane %s does not exist", paneID)
		}
	} else {
		state, err := muxKillAgentStateFn(ctx, paneID, server)
		if err != nil {
			return fmt.Errorf("read agent state: %w", err)
		}
		switch state {
		case tmux.AgentStateActive, tmux.AgentStateWaiting:
			return fmt.Errorf("refusing to kill pane %s: agent is %s (use --force to kill anyway)", paneID, state)
		}
	}

	if err := muxKillPaneFn(ctx, paneID, server); err != nil {
		return fmt.Errorf("kill-pane: %w", err)
	}
	sink.Dataf("killed %s\n", paneID)
	return nil
}
