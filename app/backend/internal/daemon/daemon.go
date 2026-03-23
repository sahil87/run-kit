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
	// SessionName is the tmux session name for the daemon.
	SessionName = "rk"
	// WindowName is the tmux window name where `rk serve` runs.
	WindowName = "serve"

	// cmdTimeout is the default timeout for tmux commands.
	cmdTimeout = 5 * time.Second
	// stopPollInterval is how often we check if the process stopped.
	stopPollInterval = 200 * time.Millisecond
)

// target returns the tmux target string "session:window".
func target() string {
	return SessionName + ":" + WindowName
}

// runTmux executes a tmux command on the daemon server, capturing stderr for diagnostics.
func runTmux(ctx context.Context, args ...string) error {
	fullArgs := append([]string{"-L", ServerSocket}, args...)
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

// isRunningCtx checks if the daemon tmux session exists using the provided context.
func isRunningCtx(ctx context.Context) bool {
	return runTmux(ctx, "has-session", "-t", SessionName) == nil
}

// IsRunning returns true if the daemon tmux session exists.
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
// Returns nil if the daemon is not running.
func Stop() error {
	ctx, cancel := context.WithTimeout(context.Background(), cmdTimeout)
	defer cancel()

	if !isRunningCtx(ctx) {
		return nil
	}

	// Send C-c to trigger graceful shutdown.
	if err := runTmux(ctx, "send-keys", "-t", target(), "C-c"); err != nil {
		return fmt.Errorf("sending C-c to daemon: %w", err)
	}

	// Poll until the session disappears or context expires.
	for {
		select {
		case <-ctx.Done():
			// Timeout — kill forcefully with a fresh short context.
			killCtx, killCancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer killCancel()
			if err := runTmux(killCtx, "kill-session", "-t", SessionName); err != nil {
				return fmt.Errorf("killing daemon session after timeout: %w", err)
			}
			return nil
		case <-time.After(stopPollInterval):
			if !isRunningCtx(ctx) {
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
