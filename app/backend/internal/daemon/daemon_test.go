package daemon

import (
	"os/exec"
	"testing"
)

func hasTmux() bool {
	_, err := exec.LookPath("tmux")
	return err == nil
}

func cleanupDaemon(t *testing.T) {
	t.Helper()
	// Kill any leftover test daemon session.
	_ = exec.Command("tmux", "-L", ServerSocket, "kill-server").Run()
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

func TestIsRunning_NoSession(t *testing.T) {
	if !hasTmux() {
		t.Skip("tmux not in PATH")
	}
	cleanupDaemon(t)
	t.Cleanup(func() { cleanupDaemon(t) })

	if IsRunning() {
		t.Error("IsRunning() = true, want false when no session exists")
	}
}

func TestStartAndStop(t *testing.T) {
	if !hasTmux() {
		t.Skip("tmux not in PATH")
	}
	if testing.Short() {
		t.Skip("skipping integration test in short mode")
	}
	cleanupDaemon(t)
	t.Cleanup(func() { cleanupDaemon(t) })

	// Start should succeed.
	if err := Start(); err != nil {
		t.Fatalf("Start() error: %v", err)
	}
	if !IsRunning() {
		t.Fatal("IsRunning() = false after Start()")
	}

	// Start again should fail (already running).
	if err := Start(); err == nil {
		t.Error("Start() should error when daemon is already running")
	}

	// Stop should succeed.
	if err := Stop(); err != nil {
		t.Fatalf("Stop() error: %v", err)
	}
	if IsRunning() {
		t.Error("IsRunning() = true after Stop()")
	}

	// Stop again should be a no-op (not an error).
	if err := Stop(); err != nil {
		t.Errorf("Stop() on stopped daemon: %v", err)
	}
}

func TestRestart_WhenNotRunning(t *testing.T) {
	if !hasTmux() {
		t.Skip("tmux not in PATH")
	}
	if testing.Short() {
		t.Skip("skipping integration test in short mode")
	}
	cleanupDaemon(t)
	t.Cleanup(func() { cleanupDaemon(t) })

	// Restart when not running should start a new daemon.
	if err := Restart(); err != nil {
		t.Fatalf("Restart() error: %v", err)
	}
	if !IsRunning() {
		t.Error("IsRunning() = false after Restart()")
	}
}

func TestRestart_WhenRunning(t *testing.T) {
	if !hasTmux() {
		t.Skip("tmux not in PATH")
	}
	if testing.Short() {
		t.Skip("skipping integration test in short mode")
	}
	cleanupDaemon(t)
	t.Cleanup(func() { cleanupDaemon(t) })

	// Start a daemon first.
	if err := Start(); err != nil {
		t.Fatalf("Start() error: %v", err)
	}

	// Restart should stop then start.
	if err := Restart(); err != nil {
		t.Fatalf("Restart() error: %v", err)
	}
	if !IsRunning() {
		t.Error("IsRunning() = false after Restart()")
	}
}
