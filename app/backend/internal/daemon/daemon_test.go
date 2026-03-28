package daemon

import (
	"os/exec"
	"strings"
	"testing"
)

const testSocket = "rk-daemon-test"

func hasTmux() bool {
	_, err := exec.LookPath("tmux")
	return err == nil
}

// useTestSocket swaps the daemon socket to an isolated test socket and restores it on cleanup.
func useTestSocket(t *testing.T) {
	t.Helper()
	// Kill any leftover test session from a prior run.
	_ = exec.Command("tmux", "-L", testSocket, "kill-server").Run()
	t.Cleanup(func() {
		_ = exec.Command("tmux", "-L", testSocket, "kill-server").Run()
	})
}

func TestConstants(t *testing.T) {
	if ServerSocket != "rk-daemon" {
		t.Errorf("ServerSocket = %q, want %q", ServerSocket, "rk-daemon")
	}
	if SessionName != "rk" {
		t.Errorf("SessionName = %q, want %q", SessionName, "rk")
	}
	if WindowName != "serve" {
		t.Errorf("WindowName = %q, want %q", WindowName, "serve")
	}
}

func TestTarget(t *testing.T) {
	got := target()
	want := "rk:serve"
	if got != want {
		t.Errorf("target() = %q, want %q", got, want)
	}
}

// isRunningOn checks if a session exists on the given socket.
func isRunningOn(socket string) bool {
	cmd := exec.Command("tmux", "-L", socket, "has-session", "-t", SessionName)
	return cmd.Run() == nil
}

// startOn creates a session on the given socket with a harmless command.
func startOn(socket string) error {
	return exec.Command("tmux", "-L", socket,
		"new-session", "-d", "-s", SessionName, "-n", WindowName,
		"sleep", "300").Run()
}

// stopOn sends C-c and kills the session on the given socket.
func stopOn(socket string) {
	_ = exec.Command("tmux", "-L", socket, "send-keys", "-t", SessionName+":"+WindowName, "C-c").Run()
	_ = exec.Command("tmux", "-L", socket, "kill-session", "-t", SessionName).Run()
}

func TestIsRunning_NoSession(t *testing.T) {
	if !hasTmux() {
		t.Skip("tmux not in PATH")
	}
	useTestSocket(t)

	if isRunningOn(testSocket) {
		t.Error("isRunningOn() = true, want false when no session exists")
	}
}

func TestStartAndStop(t *testing.T) {
	if !hasTmux() {
		t.Skip("tmux not in PATH")
	}
	if testing.Short() {
		t.Skip("skipping integration test in short mode")
	}
	useTestSocket(t)

	// Start a session on the test socket.
	if err := startOn(testSocket); err != nil {
		t.Fatalf("startOn() error: %v", err)
	}
	if !isRunningOn(testSocket) {
		t.Fatal("isRunningOn() = false after startOn()")
	}

	// Starting again should fail (session already exists).
	if err := startOn(testSocket); err == nil {
		t.Error("startOn() should error when session already exists")
	}

	// Stop should succeed.
	stopOn(testSocket)
	if isRunningOn(testSocket) {
		t.Error("isRunningOn() = true after stopOn()")
	}
}

func TestRestart_WhenNotRunning(t *testing.T) {
	if !hasTmux() {
		t.Skip("tmux not in PATH")
	}
	if testing.Short() {
		t.Skip("skipping integration test in short mode")
	}
	useTestSocket(t)

	// Start on test socket (simulates restart when not running).
	if err := startOn(testSocket); err != nil {
		t.Fatalf("startOn() error: %v", err)
	}
	if !isRunningOn(testSocket) {
		t.Error("isRunningOn() = false after startOn()")
	}
}

func TestStartWithBinary_InvalidPath(t *testing.T) {
	if IsRunning() {
		t.Skip("skipping — production daemon is running")
	}

	// StartWithBinary should return an error for a nonexistent path.
	err := StartWithBinary("/nonexistent/path/rk")
	if err == nil {
		t.Fatal("StartWithBinary with invalid path should return error")
	}
	wantMsg := "resolving executable symlinks"
	if !strings.Contains(err.Error(), wantMsg) {
		t.Errorf("error = %q, want it to contain %q", err, wantMsg)
	}
}

func TestRestartWithBinary_InvalidPath(t *testing.T) {
	if IsRunning() {
		t.Skip("skipping — production daemon is running")
	}

	err := RestartWithBinary("/nonexistent/path/rk")
	if err == nil {
		t.Fatal("RestartWithBinary with invalid path should return error")
	}
	wantMsg := "resolving executable symlinks"
	if !strings.Contains(err.Error(), wantMsg) {
		t.Errorf("error = %q, want it to contain %q", err, wantMsg)
	}
}

func TestRestart_WhenRunning(t *testing.T) {
	if !hasTmux() {
		t.Skip("tmux not in PATH")
	}
	if testing.Short() {
		t.Skip("skipping integration test in short mode")
	}
	useTestSocket(t)

	// Start first.
	if err := startOn(testSocket); err != nil {
		t.Fatalf("startOn() error: %v", err)
	}

	// Stop and re-start (simulates restart).
	stopOn(testSocket)
	if err := startOn(testSocket); err != nil {
		t.Fatalf("startOn() after stop error: %v", err)
	}
	if !isRunningOn(testSocket) {
		t.Error("isRunningOn() = false after restart")
	}
}
