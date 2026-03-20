package daemon

import (
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

// IsRunning returns true if the daemon tmux session exists.
func IsRunning() bool {
	ctx, cancel := context.WithTimeout(context.Background(), cmdTimeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, "tmux", "-L", ServerSocket, "has-session", "-t", SessionName)
	return cmd.Run() == nil
}

// Start creates a new daemon tmux session and sends the serve command.
// Returns an error if a daemon is already running.
func Start() error {
	if IsRunning() {
		return fmt.Errorf("daemon already running")
	}

	ctx, cancel := context.WithTimeout(context.Background(), cmdTimeout)
	defer cancel()

	// Create a detached tmux session with the specified window name.
	create := exec.CommandContext(ctx, "tmux", "-L", ServerSocket,
		"new-session", "-d", "-s", SessionName, "-n", WindowName)
	if err := create.Run(); err != nil {
		return fmt.Errorf("creating tmux session: %w", err)
	}

	// Send the serve command to the pane.
	sendCtx, sendCancel := context.WithTimeout(context.Background(), cmdTimeout)
	defer sendCancel()

	send := exec.CommandContext(sendCtx, "tmux", "-L", ServerSocket,
		"send-keys", "-t", target(), "run-kit serve", "Enter")
	if err := send.Run(); err != nil {
		return fmt.Errorf("sending serve command: %w", err)
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
	interrupt := exec.CommandContext(ctx, "tmux", "-L", ServerSocket,
		"send-keys", "-t", target(), "C-c")
	if err := interrupt.Run(); err != nil {
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

	kill := exec.CommandContext(killCtx, "tmux", "-L", ServerSocket, "kill-session", "-t", SessionName)
	if err := kill.Run(); err != nil {
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
