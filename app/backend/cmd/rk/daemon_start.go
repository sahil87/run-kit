package main

import (
	"errors"
	"fmt"
	"strings"

	"rk/internal/config"
	"rk/internal/daemon"

	"github.com/spf13/cobra"
)

// innerServePIDFn is the package-level hook for resolving the daemon's inner
// serve PID. Tests substitute it to drive --force self-recognition without
// touching tmux.
var innerServePIDFn = daemon.InnerServePID

// portInUseSubstring is the marker substring present in the daemon-package
// port-probe refusal error. The --force path uses it to decide whether the
// underlying Start() failure is the port-in-use mode (eligible for owner kill)
// or some other failure (return as-is).
const portInUseSubstring = "already serving on"

var daemonStartCmd = &cobra.Command{
	Use:   "start",
	Short: "Start the rk daemon",
	Long: `Start the rk daemon — an rk serve instance running in a dedicated
rk-daemon tmux session.

Without --force, behaves like the historical 'rk serve -d': calls daemon.Start()
and surfaces the port-probe refusal if another process holds the port.

With --force, on a port-in-use refusal: locates the port owner via lsof/ss and
SIGTERMs it (with graceful-then-forceful escalation), then retries the start.
Refuses to --force-kill the rk daemon itself.`,
	RunE: func(cmd *cobra.Command, args []string) error {
		force, _ := cmd.Flags().GetBool("force")

		err := daemon.Start()
		if err == nil {
			fmt.Fprintf(cmd.OutOrStdout(), "rk daemon started (%s/%s/%s)\n",
				daemon.ServerSocket, daemon.SessionName, daemon.WindowName)
			return nil
		}
		if !force || !isPortInUseErr(err) {
			return err
		}

		cfg := config.Load()
		owner, lookupErr := findPortOwner(cmd.Context(), cfg.Host, cfg.Port)
		if lookupErr != nil {
			return fmt.Errorf("port held but owner lookup failed: %w (original: %v)", lookupErr, err)
		}
		if owner == nil {
			// Port appears free now — original Start() error is the source of truth.
			return err
		}
		if ownerIsDaemon(owner) {
			return errors.New("daemon already running on port; refusing to --force-kill self")
		}
		if killErr := terminateOwner(cmd.Context(), owner); killErr != nil {
			return fmt.Errorf("--force kill of PID %d (%s) failed: %w", owner.PID, owner.Command, killErr)
		}
		fmt.Fprintf(cmd.OutOrStdout(), "Killed port owner: PID %d (%s)\n", owner.PID, owner.Command)

		if err := daemon.Start(); err != nil {
			return fmt.Errorf("starting daemon after --force port reclaim: %w", err)
		}
		fmt.Fprintf(cmd.OutOrStdout(), "rk daemon started (%s/%s/%s)\n",
			daemon.ServerSocket, daemon.SessionName, daemon.WindowName)
		return nil
	},
}

func init() {
	daemonStartCmd.Flags().BoolP("force", "f", false, "SIGTERM a non-daemon port owner before starting")
}

// isPortInUseErr reports whether the daemon-package Start() error is the
// port-probe refusal mode (vs daemon-already-running, executable-resolve
// failure, etc).
func isPortInUseErr(err error) bool {
	return err != nil && strings.Contains(err.Error(), portInUseSubstring)
}

// ownerIsDaemon reports whether the PortOwner is the rk daemon's inner serve
// PID. Uses the injectable innerServePIDFn hook so tests can drive the
// self-recognition branch.
func ownerIsDaemon(owner *PortOwner) bool {
	pid, err := innerServePIDFn()
	if err != nil || pid <= 0 {
		return false
	}
	return pid == owner.PID
}
