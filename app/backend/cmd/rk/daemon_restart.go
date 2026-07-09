package main

import (
	"fmt"

	"rk/internal/config"
	"rk/internal/daemon"

	"github.com/spf13/cobra"
)

var daemonRestartCmd = &cobra.Command{
	Use:   "restart",
	Short: "Restart the run-kit daemon",
	Long: `Restart the run-kit daemon — stop the running daemon (if any) then start
a new one.

Without --force, behaves like the historical 'run-kit serve --restart'. If the port
is held by a non-daemon process at the start step, the underlying port-probe
refusal surfaces.

With --force, after stopping the daemon the port is probed and any non-daemon
holder is SIGTERMed BEFORE the new daemon is started. Refuses to --force-kill
the run-kit daemon itself (defensive — should not happen after a successful Stop).`,
	RunE: func(cmd *cobra.Command, args []string) error {
		force, _ := cmd.Flags().GetBool("force")

		if daemon.IsRunning() {
			fmt.Fprintln(cmd.OutOrStdout(), "Restarting run-kit daemon...")
			if err := daemon.Stop(); err != nil {
				return fmt.Errorf("stopping daemon: %w", err)
			}
		}

		if force {
			cfg := config.Load()
			// Surface lookup errors instead of falling through to daemon.Start():
			// if both lsof and ss are unavailable we don't actually know whether
			// the port is free, and silently proceeding would leave --force
			// failing with an opaque bind error instead of the real cause.
			owner, lookupErr := findPortOwner(cmd.Context(), cfg.Host, cfg.Port)
			if lookupErr != nil {
				return fmt.Errorf("port-owner lookup failed during --force: %w", lookupErr)
			}
			if owner != nil && !ownerIsDaemon(owner) {
				if err := terminateOwner(cmd.Context(), owner); err != nil {
					return fmt.Errorf("--force kill of port owner failed: %w", err)
				}
				fmt.Fprintf(cmd.OutOrStdout(), "Killed port owner: PID %d (%s)\n", owner.PID, owner.Command)
			}
		}

		if err := daemon.Start(); err != nil {
			return fmt.Errorf("starting daemon: %w", err)
		}
		fmt.Fprintf(cmd.OutOrStdout(), "run-kit daemon started (%s/%s/%s)\n",
			daemon.ServerSocket, daemon.SessionName, daemon.WindowName)
		return nil
	},
}

func init() {
	daemonRestartCmd.Flags().BoolP("force", "f", false, "SIGTERM a non-daemon port holder between stop and start")
}
