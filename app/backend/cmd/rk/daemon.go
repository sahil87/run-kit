package main

import (
	"github.com/spf13/cobra"
)

var daemonCmd = &cobra.Command{
	Use:   "daemon",
	Short: "Manage the background rk daemon (tmux-managed rk serve)",
	Long: `Manage the background rk daemon — an rk serve instance running in a
dedicated rk-daemon tmux session. The daemon survives shell exits and SSH
disconnects; the foreground rk serve does not.

Subcommands:
  start    Start the daemon
  stop     Stop the daemon (and optionally reclaim the port)
  restart  Stop and start the daemon
  status   Show daemon state and current port owner

See 'rk daemon <subcommand> --help' for flags on each.`,
}

func init() {
	daemonCmd.AddCommand(daemonStartCmd)
	daemonCmd.AddCommand(daemonStopCmd)
	daemonCmd.AddCommand(daemonRestartCmd)
	daemonCmd.AddCommand(daemonStatusCmd)
}
