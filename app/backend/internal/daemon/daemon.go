package daemon

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"time"
)

const (
	// ServerSocket is the tmux server socket for the daemon (separate from agent sessions).
	ServerSocket = "rk-daemon"
	// SessionName is the tmux session name for the daemon. Matches the socket
	// name so the combined exact-match target (=rk-daemon) is unambiguous and
	// cannot collide with user-facing sessions via tmux prefix matching.
	SessionName = "rk-daemon"
	// LegacySessionName is the pre-rename session name. Stop/Restart consult
	// this so a daemon started by an older binary can be shut down cleanly
	// during the first upgrade.
	LegacySessionName = "rk"
	// WindowName is the tmux window name where `rk serve` runs.
	WindowName = "serve"

	// cmdTimeout is the default timeout for tmux commands.
	cmdTimeout = 5 * time.Second
	// stopPollInterval is how often we check if the process stopped.
	stopPollInterval = 200 * time.Millisecond
)

// target returns the tmux target string for the daemon's window, with both
// session and window segments anchored (`=`) so tmux performs exact-match
// instead of prefix-match lookup.
func target() string {
	return targetFor(SessionName)
}

// targetFor returns an exact-match window target for the given session name.
func targetFor(session string) string {
	return "=" + session + ":=" + WindowName
}

// serverSocket is the variable form of ServerSocket — overridable in tests so
// integration tests can exercise IsRunning/Stop against an isolated socket
// without touching a production daemon.
var serverSocket = ServerSocket

// runTmux executes a tmux command on the daemon server, capturing stderr for diagnostics.
func runTmux(ctx context.Context, args ...string) error {
	fullArgs := append([]string{"-L", serverSocket}, args...)
	cmd := exec.CommandContext(ctx, "tmux", fullArgs...)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		if stderr.Len() > 0 {
			return fmt.Errorf("%w: %s", err, bytes.TrimSpace(stderr.Bytes()))
		}
		return err
	}
	return nil
}

// sessionExistsCtx returns true if a session with the exact given name exists
// on the daemon socket. The `=` prefix forces exact-match lookup so a prefix
// like "rk" cannot accidentally match "rk-relay-*" or "rk-daemon".
func sessionExistsCtx(ctx context.Context, name string) bool {
	return runTmux(ctx, "has-session", "-t", "="+name) == nil
}

// runningSessionCtx returns the name of the live daemon session — preferring
// the current SessionName, falling back to LegacySessionName for daemons
// started by older binaries. Returns "" if neither exists.
func runningSessionCtx(ctx context.Context) string {
	if sessionExistsCtx(ctx, SessionName) {
		return SessionName
	}
	if sessionExistsCtx(ctx, LegacySessionName) {
		return LegacySessionName
	}
	return ""
}

// isRunningCtx reports whether any (current-or-legacy) daemon session exists.
func isRunningCtx(ctx context.Context) bool {
	return runningSessionCtx(ctx) != ""
}

// IsRunning returns true if the daemon tmux session exists (under the current
// or legacy name).
func IsRunning() bool {
	ctx, cancel := context.WithTimeout(context.Background(), cmdTimeout)
	defer cancel()

	return isRunningCtx(ctx)
}

// Start creates a new daemon tmux session running `rk serve`.
// The command is passed directly to new-session so the session exits when the server exits.
// Uses os.Executable to resolve the current binary, so a locally-built binary restarts itself
// rather than whichever `rk` happens to be in $PATH.
// Returns an error if a daemon is already running.
func Start() error {
	if IsRunning() {
		return fmt.Errorf("daemon already running")
	}

	exe, err := os.Executable()
	if err != nil {
		return fmt.Errorf("resolving executable path: %w", err)
	}
	exe, err = filepath.EvalSymlinks(exe)
	if err != nil {
		return fmt.Errorf("resolving executable symlinks: %w", err)
	}

	return startSession(exe)
}

// StartWithBinary creates a new daemon tmux session using the provided binary path.
// The binPath is resolved via filepath.EvalSymlinks before use, so callers can pass
// a symlink (e.g. the Homebrew bin symlink) that points to the current version.
// Use this instead of Start when the running process's os.Executable path may be stale
// (e.g. after brew upgrade deletes the old Cellar directory).
func StartWithBinary(binPath string) error {
	if IsRunning() {
		return fmt.Errorf("daemon already running")
	}

	exe, err := filepath.EvalSymlinks(binPath)
	if err != nil {
		return fmt.Errorf("resolving executable symlinks: %w", err)
	}

	return startSession(exe)
}

// startSession creates the daemon tmux session with the given resolved binary path.
func startSession(exe string) error {
	ctx, cancel := context.WithTimeout(context.Background(), cmdTimeout)
	defer cancel()

	// Create a detached tmux session that runs the resolved binary directly.
	// When the serve process exits, the session closes automatically.
	if err := runTmux(ctx, "new-session", "-d", "-s", SessionName, "-n", WindowName,
		exe, "serve"); err != nil {
		return fmt.Errorf("creating tmux session: %w", err)
	}

	return nil
}

// Stop sends C-c to the daemon pane and waits up to 5 seconds for it to exit.
// A single context bounds the entire operation (send-keys + polling + kill).
// Returns nil if the daemon is not running. Targets a legacy-named daemon
// (SessionName == LegacySessionName) transparently so users upgrading from
// older binaries can stop/restart without manual cleanup.
func Stop() error {
	ctx, cancel := context.WithTimeout(context.Background(), cmdTimeout)
	defer cancel()

	session := runningSessionCtx(ctx)
	if session == "" {
		return nil
	}

	// Send C-c to trigger graceful shutdown.
	if err := runTmux(ctx, "send-keys", "-t", targetFor(session), "C-c"); err != nil {
		return fmt.Errorf("sending C-c to daemon: %w", err)
	}

	// Poll until the session disappears or context expires.
	for {
		select {
		case <-ctx.Done():
			// Timeout — kill forcefully with a fresh short context.
			killCtx, killCancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer killCancel()
			if err := runTmux(killCtx, "kill-session", "-t", "="+session); err != nil {
				return fmt.Errorf("killing daemon session after timeout: %w", err)
			}
			return nil
		case <-time.After(stopPollInterval):
			if !sessionExistsCtx(ctx, session) {
				return nil
			}
		}
	}
}

// Restart stops the daemon if running, then starts it.
// If no daemon is running, it just starts one.
func Restart() error {
	if IsRunning() {
		if err := Stop(); err != nil {
			return fmt.Errorf("stopping daemon: %w", err)
		}
	}
	return Start()
}

// RestartWithBinary stops the daemon if running, then starts it using the provided binary path.
// Use this instead of Restart when the running process's os.Executable path may be stale.
func RestartWithBinary(binPath string) error {
	if IsRunning() {
		if err := Stop(); err != nil {
			return fmt.Errorf("stopping daemon: %w", err)
		}
	}
	return StartWithBinary(binPath)
}
