package main

import (
	"encoding/json"
	"fmt"

	"rk/internal/config"
	"rk/internal/daemon"

	"github.com/spf13/cobra"
)

// Port-state enum values for the JSON output of `rk daemon status --json`.
const (
	portStateFree         = "free"
	portStateHeldByDaemon = "held-by-daemon"
	portStateHeldByOther  = "held-by-other"
)

// statusReport is the structured form emitted by `rk daemon status --json`.
type statusReport struct {
	Daemon statusDaemon `json:"daemon"`
	Port   statusPort   `json:"port"`
}

type statusDaemon struct {
	Running bool   `json:"running"`
	Socket  string `json:"socket,omitempty"`
	Session string `json:"session,omitempty"`
	Window  string `json:"window,omitempty"`
	Target  string `json:"target,omitempty"`
	PID     int    `json:"pid,omitempty"`
}

type statusPort struct {
	Host          string `json:"host"`
	Port          int    `json:"port"`
	State         string `json:"state"`
	HolderPID     int    `json:"holder_pid,omitempty"`
	HolderCommand string `json:"holder_command,omitempty"`
}

var daemonStatusCmd = &cobra.Command{
	Use:   "status",
	Short: "Show rk daemon state and current port owner",
	Long: `Show rk daemon state and current port owner. Read-only — no
SIGTERM, SIGKILL, or tmux mutation is issued.

Reports:
  - daemon state (running / not running) with socket, session, window, target
  - current port owner (free / held by the rk daemon / held by another process)

Not to be confused with 'rk status' (top-level tmux session summary).`,
	RunE: func(cmd *cobra.Command, args []string) error {
		jsonOut, _ := cmd.Flags().GetBool("json")

		running := daemon.IsRunning()
		var innerPID int
		if running {
			if pid, err := innerServePIDFn(); err == nil {
				innerPID = pid
			}
		}

		cfg := config.Load()
		owner, _ := findPortOwner(cmd.Context(), cfg.Host, cfg.Port)

		state := portStateFree
		if owner != nil {
			if innerPID > 0 && owner.PID == innerPID {
				state = portStateHeldByDaemon
			} else {
				state = portStateHeldByOther
			}
		}

		if jsonOut {
			return writeStatusJSON(cmd, running, innerPID, cfg.Host, cfg.Port, state, owner)
		}
		writeStatusText(cmd, running, innerPID, cfg.Host, cfg.Port, state, owner)
		return nil
	},
}

func init() {
	daemonStatusCmd.Flags().Bool("json", false, "Emit a machine-readable JSON object")
}

func writeStatusJSON(cmd *cobra.Command, running bool, innerPID int, host string, port int, state string, owner *PortOwner) error {
	report := statusReport{
		Daemon: statusDaemon{Running: running},
		Port:   statusPort{Host: host, Port: port, State: state},
	}
	if running {
		report.Daemon.Socket = daemon.ServerSocket
		report.Daemon.Session = daemon.SessionName
		report.Daemon.Window = daemon.WindowName
		report.Daemon.Target = "=" + daemon.SessionName + ":=" + daemon.WindowName
		if innerPID > 0 {
			report.Daemon.PID = innerPID
		}
	}
	if owner != nil {
		report.Port.HolderPID = owner.PID
		report.Port.HolderCommand = owner.Command
	}

	enc := json.NewEncoder(cmd.OutOrStdout())
	enc.SetIndent("", "  ")
	if err := enc.Encode(report); err != nil {
		return fmt.Errorf("encoding status JSON: %w", err)
	}
	return nil
}

func writeStatusText(cmd *cobra.Command, running bool, innerPID int, host string, port int, state string, owner *PortOwner) {
	out := cmd.OutOrStdout()
	if running {
		fmt.Fprintln(out, "Daemon:    running")
		fmt.Fprintf(out, "  Socket:  %s\n", daemon.ServerSocket)
		fmt.Fprintf(out, "  Session: %s (window: %s)\n", daemon.SessionName, daemon.WindowName)
		fmt.Fprintf(out, "  Target:  =%s:=%s\n", daemon.SessionName, daemon.WindowName)
	} else {
		fmt.Fprintln(out, "Daemon:    not running")
		fmt.Fprintf(out, "  Socket:  %s (no live session)\n", daemon.ServerSocket)
	}
	fmt.Fprintln(out)

	switch state {
	case portStateFree:
		fmt.Fprintf(out, "Port:      %s:%d — free\n", host, port)
	case portStateHeldByDaemon:
		fmt.Fprintf(out, "Port:      %s:%d — held by the rk daemon (PID %d)\n", host, port, owner.PID)
	case portStateHeldByOther:
		cmdName := owner.Command
		if cmdName == "" {
			cmdName = "unknown"
		}
		fmt.Fprintf(out, "Port:      %s:%d — held by PID %d (%s, foreground)\n", host, port, owner.PID, cmdName)
		fmt.Fprintf(out, "           To reclaim: `rk daemon stop --force` or `kill %d`\n", owner.PID)
	}
}
