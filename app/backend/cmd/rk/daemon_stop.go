package main

import (
	"errors"
	"fmt"

	"rk/internal/config"
	"rk/internal/daemon"

	"github.com/spf13/cobra"
)

var daemonStopCmd = &cobra.Command{
	Use:   "stop",
	Short: "Stop the rk daemon",
	Long: `Stop the rk daemon.

Without --force, behaves like the historical 'rk serve --stop': calls
daemon.Stop() when running, prints "rk daemon not running" when no daemon
session exists. The port is not probed.

With --force, after stopping the daemon (if running) the port is probed and
any non-daemon holder is SIGTERMed (with graceful-then-forceful escalation).
Useful for reclaiming a port held by a foreground 'rk serve' or stale process.`,
	RunE: func(cmd *cobra.Command, args []string) error {
		force, _ := cmd.Flags().GetBool("force")

		wasRunning := daemon.IsRunning()
		if wasRunning {
			if err := daemon.Stop(); err != nil {
				return fmt.Errorf("stopping daemon: %w", err)
			}
			fmt.Fprintln(cmd.OutOrStdout(), "rk daemon stopped")
		}
		if !force {
			if !wasRunning {
				fmt.Fprintln(cmd.OutOrStdout(), "rk daemon not running")
			}
			return nil
		}

		cfg := config.Load()
		// --force's contract is "ensure the port is free at exit", so a lookup
		// failure must be surfaced rather than treated as "no holder" — silently
		// declaring success when we couldn't actually check would defeat the
		// purpose of the flag.
		owner, lookupErr := findPortOwner(cmd.Context(), cfg.Host, cfg.Port)
		if lookupErr != nil {
			return fmt.Errorf("port-owner lookup failed during --force: %w", lookupErr)
		}
		if owner == nil {
			return nil
		}
		if ownerIsDaemon(owner) {
			return errors.New("port still held by what appears to be our daemon; manual investigation needed")
		}
		if err := terminateOwner(cmd.Context(), owner); err != nil {
			return fmt.Errorf("--force kill of PID %d (%s) failed: %w", owner.PID, owner.Command, err)
		}
		fmt.Fprintf(cmd.OutOrStdout(), "Killed port owner: PID %d (%s)\n", owner.PID, owner.Command)
		return nil
	},
}

func init() {
	daemonStopCmd.Flags().BoolP("force", "f", false, "SIGTERM any non-daemon port holder after stopping")
}
