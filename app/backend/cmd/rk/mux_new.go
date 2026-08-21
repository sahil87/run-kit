package main

import (
	"context"
	"fmt"

	"rk/internal/tmux"
	"rk/internal/validate"

	"github.com/spf13/cobra"
)

// rk mux new <name> [--ephemeral] — create a detached tmux server on socket
// <name> through the same server-birth path the create-server API flow uses
// (tmux.CreateSession: env sanitization, CWD anchored to ServerBirthDir),
// with one session named <name>. An operator-tier member: the socket name is
// its positional argument, so an explicitly-set inherited -L is rejected (the
// reap/snapshot/init-conf pattern). A live server already answering on the
// socket refuses (exit 1, nothing touched); a dead/stale socket proceeds.
// --ephemeral marks the fresh server @rk_ephemeral 1 (tmux.EphemeralOption)
// before the command returns — and a failed mark best-effort kills the
// just-created server, so a --ephemeral invocation never leaves an unmarked
// scratch server behind. On success stdout carries exactly one report line:
// `created <name>`. Exit codes follow the toolkit convention: 0 success,
// 1 operational (collision, tmux failure, mark failure), 2 usage. No daemon
// dependency (the rk present pattern).

var muxNewEphemeralFlag bool

var muxNewCmd = &cobra.Command{
	Use:   "new <name> [--ephemeral]",
	Short: "Create a detached tmux server on socket <name>",
	Long: "Create a detached tmux server listening on socket <name>, with one " +
		"session named <name>, through run-kit's server-birth path (sanitized " +
		"environment, home-anchored CWD) — the sanctioned way for agents and " +
		"scripts to create scratch servers instead of improvising raw " +
		"new-session calls.\n\n" +
		"Pass --ephemeral to mark the new server @rk_ephemeral 1 before the " +
		"command returns, opting it into the `rk mux reap --ephemeral` bulk " +
		"cleanup sweep and out of layout-snapshot coverage. If the mark fails, " +
		"the just-created server is killed — a --ephemeral invocation never " +
		"leaves an unmarked server behind.\n\n" +
		"A live server already answering on <name> is a refusal (exit 1, " +
		"nothing touched); a dead or stale socket proceeds. stdout carries " +
		"exactly one report line: `created <name>`.",
	Example: `  rk mux new scratch1
  rk mux new scratch2 --ephemeral`,
	Args: usageArgs(cobra.ExactArgs(1)),
	RunE: func(cmd *cobra.Command, args []string) error {
		return runMuxNew(cmd, args[0])
	},
}

func init() {
	muxNewCmd.Flags().BoolVar(&muxNewEphemeralFlag, "ephemeral", false,
		"Mark the new server "+tmux.EphemeralOption+" 1 (creator opt-out: reaped by rk mux reap --ephemeral, skipped by layout snapshots)")
}

// muxNew*Fn are package-level seams so runMuxNew can be tested without a
// live tmux server (the mux_kill.go pattern); the defaults delegate to
// internal/tmux.
var (
	muxNewServerAliveFn = func(ctx context.Context, server string) error {
		return tmux.ServerAlive(ctx, server)
	}
	muxNewCreateSessionFn = func(name, cwd, server string) error {
		return tmux.CreateSession(name, cwd, server)
	}
	muxNewMarkEphemeralFn = func(ctx context.Context, server string) error {
		return tmux.MarkServerEphemeral(ctx, server)
	}
	muxNewKillServerFn = func(server string) error {
		return tmux.KillServer(server)
	}
)

// runMuxNew is the testable core: reject -L → validate → probe → create →
// (optionally) mark → report.
func runMuxNew(cmd *cobra.Command, name string) error {
	if err := muxRejectInheritedServerFlag(cmd); err != nil {
		return err
	}
	if msg := validate.ValidateServerName(name); msg != "" {
		return usageError(fmt.Errorf("invalid server name: %s", msg))
	}

	parent := cmd.Context()
	if parent == nil {
		parent = context.Background()
	}
	ctx, cancel := context.WithTimeout(parent, muxCmdTimeout)
	defer cancel()

	// A live server on the socket refuses — creating over it would attach to
	// (or fight) someone else's server. A dead/stale socket fails the probe
	// and proceeds: new-session starts a fresh server over it.
	if err := muxNewServerAliveFn(ctx, name); err == nil {
		return fmt.Errorf("server %s is already running", name)
	}

	if err := muxNewCreateSessionFn(name, "", name); err != nil {
		return fmt.Errorf("create server %s: %w", name, err)
	}

	if muxNewEphemeralFlag {
		if err := muxNewMarkEphemeralFn(ctx, name); err != nil {
			// A failed mark must not leave an unmarked scratch server behind
			// (that is the exact leak this verb exists to prevent) — the
			// server is milliseconds old and owned by this invocation.
			_ = muxNewKillServerFn(name)
			return fmt.Errorf("mark server %s ephemeral: %w", name, err)
		}
	}

	sink := newSink(cmd)
	sink.Dataf("created %s\n", name)
	return nil
}
