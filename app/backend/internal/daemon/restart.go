package daemon

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"

	"rk/internal/config"
	"rk/internal/ports"
	"rk/internal/tmux"
)

// RestartOptions selects the optional legs of the single restart sequencer.
type RestartOptions struct {
	// Force reclaims the daemon port from a non-daemon holder between stop
	// and start.
	Force bool
	// Full kills the whole rk-daemon tmux server (siblings included) between
	// stop and start.
	Full bool
	// Binary starts with this binary path (EvalSymlinks'd) instead of
	// os.Executable — the upgrade path.
	Binary string
}

// Seams over the sequencing steps (the package's package-var idiom,
// mirroring stopGracePeriod/codeServerSpawn) so tests assert ordering and
// drive failure branches without a tmux server.
var (
	restartIsRunningFn       = IsRunning
	restartStopFn            = Stop
	restartKillServerFn      = KillServer
	restartStartFn           = Start
	restartStartWithBinaryFn = StartWithBinary
	restartFindPortOwnerFn   = ports.FindPortOwner
	restartTerminateOwnerFn  = ports.TerminateOwner
	// restartOriginalTMUXFn reads tmux.OriginalTMUX — the pre-strip $TMUX
	// captured before internal/tmux's init() unsets the env var (reading the
	// env here would always see empty and the Full guard could never fire).
	restartOriginalTMUXFn = func() string { return tmux.OriginalTMUX }
)

// insideDaemonServer reports whether tmuxEnv (the $TMUX value, format
// "socketpath,pid,session") points at the rk-daemon tmux server. Named -L
// sockets materialize as <tmpdir>/tmux-<uid>/<name>, so the socket path's
// basename IS the server name. Empty (not inside tmux) is never inside.
func insideDaemonServer(tmuxEnv string) bool {
	sock, _, _ := strings.Cut(tmuxEnv, ",")
	if sock == "" {
		return false
	}
	return filepath.Base(sock) == ServerSocket
}

// Restart is the single daemon restart sequencer. It owns the ordering
// invariants every restart composition needs, so callers (the CLI's
// `rk daemon restart`, the `rk update` upgrade leg) stay thin wrappers and no
// future caller can forget a step:
//
//  1. Full guard: opts.Full from inside the rk-daemon server is refused
//     (kill-server would kill the invoking pane mid-restart) — in the
//     primitive, so the guard cannot be bypassed.
//  2. Stop() when running.
//  3. opts.Full: KillServer() — release-synchronous w.r.t. the code-server
//     port, so the Start below cannot misclassify the dying sibling as
//     externally managed.
//  4. opts.Force: port-owner lookup + termination of a non-daemon holder.
//     Lookup errors are surfaced (silently proceeding would leave --force
//     failing with an opaque bind error instead of the real cause); a holder
//     identified as the daemon itself is never signaled.
//  5. Start(), or StartWithBinary(opts.Binary) when Binary is non-empty.
func Restart(opts RestartOptions) error {
	if opts.Full && insideDaemonServer(restartOriginalTMUXFn()) {
		return fmt.Errorf("refusing --full from inside the %s tmux server: kill-server would kill this pane mid-restart — run it from a shell outside that server", ServerSocket)
	}

	if restartIsRunningFn() {
		if err := restartStopFn(); err != nil {
			return fmt.Errorf("stopping daemon: %w", err)
		}
	}

	if opts.Full {
		if err := restartKillServerFn(); err != nil {
			return fmt.Errorf("killing the %s tmux server: %w", ServerSocket, err)
		}
	}

	if opts.Force {
		cfg := config.Load()
		ctx := context.Background()
		owner, err := restartFindPortOwnerFn(ctx, cfg.Host, cfg.Port)
		if err != nil {
			return fmt.Errorf("port-owner lookup failed during --force: %w", err)
		}
		if owner != nil && !OwnerIsDaemon(owner) {
			if err := restartTerminateOwnerFn(ctx, owner); err != nil {
				return fmt.Errorf("--force kill of port owner failed: %w", err)
			}
		}
	}

	if opts.Binary != "" {
		if err := restartStartWithBinaryFn(opts.Binary); err != nil {
			return fmt.Errorf("starting daemon: %w", err)
		}
		return nil
	}
	if err := restartStartFn(); err != nil {
		return fmt.Errorf("starting daemon: %w", err)
	}
	return nil
}
