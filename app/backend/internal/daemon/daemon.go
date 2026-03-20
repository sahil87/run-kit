package daemon

import (
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"time"
)

const (
	// ServerSocket is the tmux server socket for the daemon (separate from agent sessions).
	ServerSocket = "rk-daemon"
	// SessionName is the tmux session name for the daemon.
	SessionName = "rk"
	// WindowName is the tmux window name where `run-kit serve` runs.
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

// IsRunning returns true if the daemon tmux session exists.
func IsRunning() bool {
	ctx, cancel := context.WithTimeout(context.Background(), cmdTimeout)
	defer cancel()

	return runTmux(ctx, "has-session", "-t", SessionName) == nil
}

// Start creates a new daemon tmux session running `run-kit serve`.
// The command is passed directly to new-session so the session exits when the server exits.
// Returns an error if a daemon is already running.
func Start() error {
	if IsRunning() {
		return fmt.Errorf("daemon already running")
	}

	ctx, cancel := context.WithTimeout(context.Background(), cmdTimeout)
	defer cancel()

	// Create a detached tmux session that runs `run-kit serve` directly.
	// When the serve process exits, the session closes automatically.
	if err := runTmux(ctx, "new-session", "-d", "-s", SessionName, "-n", WindowName,
		"run-kit", "serve"); err != nil {
		return fmt.Errorf("creating tmux session: %w", err)
	}

	return nil
}

// Stop sends C-c to the daemon pane and waits up to 5 seconds for it to exit.
// Returns nil if the daemon is not running.
func Stop() error {
	if !IsRunning() {
		return nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), cmdTimeout)
	defer cancel()

	// Send C-c to trigger graceful shutdown.
	if err := runTmux(ctx, "send-keys", "-t", target(), "C-c"); err != nil {
		return fmt.Errorf("sending C-c to daemon: %w", err)
	}

	// Poll until the session disappears or timeout.
	deadline := time.Now().Add(cmdTimeout)
	for time.Now().Before(deadline) {
		if !IsRunning() {
			return nil
		}
		time.Sleep(stopPollInterval)
	}

	// Session still exists after timeout — kill it forcefully.
	killCtx, killCancel := context.WithTimeout(context.Background(), cmdTimeout)
	defer killCancel()

	if err := runTmux(killCtx, "kill-session", "-t", SessionName); err != nil {
		return fmt.Errorf("killing daemon session after timeout: %w", err)
	}

	return nil
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
