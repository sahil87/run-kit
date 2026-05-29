package main

import (
	"fmt"

	"rk/internal/config"
	"rk/internal/daemon"

	"github.com/spf13/cobra"
)

var daemonRestartCmd = &cobra.Command{
	Use:   "restart",
	Short: "Restart the rk daemon",
	Long: `Restart the rk daemon — stop the running daemon (if any) then start
a new one.

Without --force, behaves like the historical 'rk serve --restart'. If the port
is held by a non-daemon process at the start step, the underlying port-probe
refusal surfaces.

With --force, after stopping the daemon the port is probed and any non-daemon
holder is SIGTERMed BEFORE the new daemon is started. Refuses to --force-kill
the rk daemon itself (defensive — should not happen after a successful Stop).`,
	RunE: func(cmd *cobra.Command, args []string) error {
		force, _ := cmd.Flags().GetBool("force")

		if daemon.IsRunning() {
			fmt.Fprintln(cmd.OutOrStdout(), "Restarting rk daemon...")
			if err := daemon.Stop(); err != nil {
				return fmt.Errorf("stopping daemon: %w", err)
			}
		}

		if force {
			cfg := config.Load()
			owner, _ := findPortOwner(cmd.Context(), cfg.Host, cfg.Port)
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
		fmt.Fprintf(cmd.OutOrStdout(), "rk daemon started (%s/%s/%s)\n",
			daemon.ServerSocket, daemon.SessionName, daemon.WindowName)
		return nil
	},
}

func init() {
	daemonRestartCmd.Flags().BoolP("force", "f", false, "SIGTERM a non-daemon port holder between stop and start")
}
