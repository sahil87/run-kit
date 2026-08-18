package main

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"

	"rk/internal/config"
	"rk/internal/daemon"
	"rk/internal/remote"
	"rk/internal/tmux"

	"github.com/spf13/cobra"
)

// Seam vars for the daemon/remote calls the restart flow makes, so tests can
// drive sequencing and failure branches without a tmux server or ssh — the
// package's established injection idiom (innerServePIDFn, remotesPathFn).
var (
	daemonIsRunningFn  = daemon.IsRunning
	daemonStopFn       = daemon.Stop
	daemonStartFn      = daemon.Start
	daemonKillServerFn = daemon.KillServer
	listTunnelsFn      = remote.ListTunnels
	remoteConnectFn    = remote.Connect
	// restartOriginalTMUXFn reads tmux.OriginalTMUX — the pre-strip $TMUX captured
	// before internal/tmux's init() unsets the env var (reading the env here
	// would always see empty and the --full guard could never fire).
	restartOriginalTMUXFn = func() string { return tmux.OriginalTMUX }
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
the run-kit daemon itself (defensive — should not happen after a successful Stop).

With --full, the ENTIRE rk-daemon tmux server is killed between stop and start —
including the sibling sessions (rk-jobs, rk-code-server, rk-remotes) and the
control anchor — so the start births a genuinely fresh tmux server. Remote
tunnels whose windows were up are reconnected after the start (failures are
reported but do not fail the restart). Refuses to run from a pane inside the
rk-daemon server, where the kill would take down the invoking pane mid-restart.`,
	RunE: func(cmd *cobra.Command, args []string) error {
		force, _ := cmd.Flags().GetBool("force")
		full, _ := cmd.Flags().GetBool("full")

		if full && insideDaemonServer(restartOriginalTMUXFn()) {
			return fmt.Errorf("refusing --full from inside the %s tmux server: kill-server would kill this pane mid-restart — run it from a shell outside that server", daemon.ServerSocket)
		}

		// Capture the up-tunnel set BEFORE anything dies: tunnel state is
		// derived from the rk-remotes windows, which --full is about to kill.
		var reconnect []string
		if full {
			reconnect = upRemoteNames(cmd.Context(), cmd)
		}

		if daemonIsRunningFn() {
			fmt.Fprintln(cmd.OutOrStdout(), "Restarting run-kit daemon...")
			if err := daemonStopFn(); err != nil {
				return fmt.Errorf("stopping daemon: %w", err)
			}
		}

		if full {
			if err := daemonKillServerFn(); err != nil {
				return fmt.Errorf("killing the %s tmux server: %w", daemon.ServerSocket, err)
			}
			fmt.Fprintf(cmd.OutOrStdout(), "Killed the %s tmux server (sibling sessions included)\n", daemon.ServerSocket)
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

		if err := daemonStartFn(); err != nil {
			return fmt.Errorf("starting daemon: %w", err)
		}
		fmt.Fprintf(cmd.OutOrStdout(), "run-kit daemon started (%s/%s/%s)\n",
			daemon.ServerSocket, daemon.SessionName, daemon.WindowName)

		reconnectRemotes(cmd, reconnect)
		return nil
	},
}

// insideDaemonServer reports whether tmuxEnv (the $TMUX value, format
// "socketpath,pid,session") points at the rk-daemon tmux server. Named -L
// sockets materialize as <tmpdir>/tmux-<uid>/<name>, so the socket path's
// basename IS the server name. Empty (not inside tmux) is never inside.
func insideDaemonServer(tmuxEnv string) bool {
	sock, _, _ := strings.Cut(tmuxEnv, ",")
	if sock == "" {
		return false
	}
	return filepath.Base(sock) == daemon.ServerSocket
}

// upRemoteNames derives the registered remotes whose tunnel windows are
// currently up — the set --full reconnects after the fresh start. Store or
// derivation problems degrade to a warning and an empty set: the restart's
// own contract must not fail on remote bookkeeping.
func upRemoteNames(ctx context.Context, cmd *cobra.Command) []string {
	path, err := remotesPathFn()
	if err != nil {
		fmt.Fprintf(cmd.ErrOrStderr(), "warning: skipping remote-tunnel reconnect (store path: %v)\n", err)
		return nil
	}
	f, err := remote.Load(path)
	if err != nil {
		fmt.Fprintf(cmd.ErrOrStderr(), "warning: skipping remote-tunnel reconnect (loading remotes: %v)\n", err)
		return nil
	}
	if len(f.Remotes) == 0 {
		return nil
	}
	tunnels := listTunnelsFn(ctx)
	var up []string
	for _, r := range f.Remotes {
		if tunnels[r.Name] {
			up = append(up, r.Name)
		}
	}
	return up
}

// reconnectRemotes re-runs the idempotent connect flow for each previously-up
// remote. Per-remote failures warn and continue — the restart succeeded; a
// dead remote box has its own recovery (`rk remote connect <name>`). Output
// splits per Principle 9, mirroring `rk remote connect`'s sink routing:
// progress, installed/updated notices, and warnings are stderr chatter; the
// per-remote reconnected-origin outcome line is stdout data.
func reconnectRemotes(cmd *cobra.Command, names []string) {
	if len(names) == 0 {
		return
	}
	out, errOut := cmd.OutOrStdout(), cmd.ErrOrStderr()
	path, pathErr := remotesPathFn()
	for _, name := range names {
		fmt.Fprintf(errOut, "Reconnecting remote %s...\n", name)
		err := pathErr
		if err == nil {
			var res remote.ConnectResult
			res, err = remoteConnectFn(cmd.Context(), path, name, displayVersion(), func(format string, a ...any) {
				fmt.Fprintf(errOut, "  "+format+"\n", a...)
			})
			if err == nil {
				if res.Installed {
					fmt.Fprintf(errOut, "installed rk v%s on %s\n", res.RemoteVersion, name)
				}
				if res.Updated {
					fmt.Fprintf(errOut, "updated rk on %s to v%s\n", name, res.RemoteVersion)
				}
				fmt.Fprintf(out, "Reconnected remote %s (%s)\n", name, res.Origin)
				continue
			}
		}
		fmt.Fprintf(errOut, "warning: reconnecting remote %s failed: %v — run `rk remote connect %s`\n", name, err, name)
	}
}

func init() {
	daemonRestartCmd.Flags().BoolP("force", "f", false, "SIGTERM a non-daemon port holder between stop and start")
	daemonRestartCmd.Flags().Bool("full", false, "Kill the whole rk-daemon tmux server (sibling sessions included) for a fresh server, reconnecting previously-up remote tunnels")
}
