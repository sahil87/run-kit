package main

import (
	"context"
	"fmt"

	"rk/internal/tmux"
	"rk/internal/validate"

	"github.com/spf13/cobra"
)

// rk mux adopt <server> — convert an external (unmarked) tmux server into an
// rk-managed one: stamp @rk_srv_managed first, then source the managed conf via
// tmux.ReloadConfig; a failed reload best-effort unmarks, so a stamped server
// whose conf never applied is never left behind. An operator-tier member: the
// socket name is its positional argument, so an explicitly-set inherited -L is
// rejected (the new/reap/snapshot/init-conf pattern). Adopt requires a live
// server (tmux.ServerAlive probe; dead/absent is operational, exit 1) and is
// idempotent by contract (the bulk-migration role): an already-managed target
// — including rk-daemon by derivation — prints `already managed <name>` and
// exits 0 with no mutation. Non-interactive — invocation is consent. Adopt
// never auto-assigns a server color, and no un-adopt verb exists. On success
// stdout carries exactly one report line: `adopted <name>`; diagnostics ride
// stderr. Exit codes follow the toolkit convention: 0 success, 1 operational
// (dead socket, tmux failure, reload failure), 2 usage. No daemon dependency
// (the rk present pattern).

var muxAdoptCmd = &cobra.Command{
	Use:   "adopt <server>",
	Short: "Adopt an external tmux server into run-kit management",
	Long: "Adopt an external (unmarked) tmux server into run-kit management: " +
		"stamp @rk_srv_managed on it, then source run-kit's managed tmux config. " +
		"If the config reload fails, the stamp is rolled back — a stamped " +
		"server whose config never applied is never left behind.\n\n" +
		"Adopt is idempotent: an already-managed server (including rk-daemon) " +
		"prints 'already managed <server>' and exits 0 with no mutation. " +
		"There is no un-adopt verb — adopting is semi-irreversible: the " +
		"server's own config returns only on server restart. Adopt never " +
		"assigns a server color.\n\n" +
		"The server must be live; a dead or absent socket is an operational " +
		"error (exit 1). stdout carries exactly one report line: " +
		"adopted <server>.",
	Example: `  rk mux adopt ext1`,
	Args:    usageArgs(cobra.ExactArgs(1)),
	RunE: func(cmd *cobra.Command, args []string) error {
		return runMuxAdopt(cmd, args[0])
	},
}

// muxAdopt*Fn are package-level seams so runMuxAdopt can be tested without a
// live tmux server (the muxNew*Fn pattern); the defaults delegate to
// internal/tmux.
var (
	muxAdoptServerAliveFn = func(ctx context.Context, server string) error {
		return tmux.ServerAlive(ctx, server)
	}
	muxAdoptIsManagedFn = func(ctx context.Context, server string) (bool, error) {
		return tmux.IsManagedServer(ctx, server)
	}
	muxAdoptMarkManagedFn = func(ctx context.Context, server string) error {
		return tmux.MarkServerManaged(ctx, server)
	}
	muxAdoptUnmarkManagedFn = func(ctx context.Context, server string) error {
		return tmux.UnmarkServerManaged(ctx, server)
	}
	muxAdoptReloadConfigFn = func(server string) error {
		return tmux.ReloadConfig(server)
	}
	muxAdoptMigrateLegacyFn = func(ctx context.Context, server string) (bool, error) {
		return tmux.MigrateLegacyOptionsReport(ctx, server)
	}
)

// runMuxAdopt is the testable core: reject -L → validate → probe live →
// idempotency check → stamp → reload → report.
func runMuxAdopt(cmd *cobra.Command, name string) error {
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

	// Adopt requires a live server: set-option -s and source-file both need a
	// running tmux process, so a dead or absent socket is operational.
	if err := muxAdoptServerAliveFn(ctx, name); err != nil {
		return fmt.Errorf("server %s is not running: %w", name, err)
	}

	managed, err := muxAdoptIsManagedFn(ctx, name)
	if err != nil {
		return fmt.Errorf("probe managed state of %s: %w", name, err)
	}
	sink := newSink(cmd)
	if managed {
		sink.Dataf("already managed %s\n", name)
		return nil
	}

	if err := muxAdoptMarkManagedFn(ctx, name); err != nil {
		return fmt.Errorf("mark server %s managed: %w", name, err)
	}
	if err := muxAdoptReloadConfigFn(name); err != nil {
		// Rollback under a fresh bound derived from the parent (not the
		// probe-consumed ctx — the mux_new mark pattern): a slow probe must
		// not hand the unmark an exhausted deadline. A stamped server whose
		// conf never applied is never left behind.
		unmarkCtx, unmarkCancel := context.WithTimeout(parent, muxCmdTimeout)
		defer unmarkCancel()
		_ = muxAdoptUnmarkManagedFn(unmarkCtx, name)
		return fmt.Errorf("reload config on %s: %w", name, err)
	}

	sink.Dataf("adopted %s\n", name)

	// Legacy-option sweep — unconditional (not the daemon's once-guard): the
	// CLI is the operator's explicit retry verb. A sweep failure does not
	// fail the adopt (the conf landed; the sweep re-runs on attach). The
	// report line prints only when legacy names moved — a clean server stays
	// silent (toolkit quiet-success posture).
	changed, err := muxAdoptMigrateLegacyFn(ctx, name)
	if err != nil {
		_, _ = fmt.Fprintf(cmd.ErrOrStderr(), "legacy option sweep on %s failed: %v\n", name, err)
	} else if changed {
		sink.Dataf("migrated legacy options on %s\n", name)
	}
	return nil
}
