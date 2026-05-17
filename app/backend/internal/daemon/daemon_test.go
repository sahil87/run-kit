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

// withServerSocket redirects the daemon package's runTmux to the test socket
// for the duration of the test, so IsRunning/Stop can be exercised without
// touching a real production daemon.
func withServerSocket(t *testing.T, socket string) {
	t.Helper()
	orig := serverSocket
	serverSocket = socket
	t.Cleanup(func() { serverSocket = orig })
}

func TestConstants(t *testing.T) {
	if ServerSocket != "rk-daemon" {
		t.Errorf("ServerSocket = %q, want %q", ServerSocket, "rk-daemon")
	}
	if SessionName != "rk-daemon" {
		t.Errorf("SessionName = %q, want %q", SessionName, "rk-daemon")
	}
	if LegacySessionName != "rk" {
		t.Errorf("LegacySessionName = %q, want %q", LegacySessionName, "rk")
	}
	if WindowName != "serve" {
		t.Errorf("WindowName = %q, want %q", WindowName, "serve")
	}
}

func TestTarget(t *testing.T) {
	got := target()
	want := "=rk-daemon:=serve"
	if got != want {
		t.Errorf("target() = %q, want %q", got, want)
	}
}

func TestTargetFor_Legacy(t *testing.T) {
	got := targetFor(LegacySessionName)
	want := "=rk:=serve"
	if got != want {
		t.Errorf("targetFor(legacy) = %q, want %q", got, want)
	}
}

// hasSessionOn checks if the given session exists on the socket using exact match.
func hasSessionOn(socket, session string) bool {
	cmd := exec.Command("tmux", "-L", socket, "has-session", "-t", "="+session)
	return cmd.Run() == nil
}

// isRunningOn checks if the current-name session exists on the given socket.
func isRunningOn(socket string) bool {
	return hasSessionOn(socket, SessionName)
}

// startOn creates a session with the given name on the socket using a harmless command.
func startOn(socket, session string) error {
	return exec.Command("tmux", "-L", socket,
		"new-session", "-d", "-s", session, "-n", WindowName,
		"sleep", "300").Run()
}

// stopOn sends C-c and kills the named session on the given socket.
func stopOn(socket, session string) {
	_ = exec.Command("tmux", "-L", socket, "send-keys",
		"-t", "="+session+":="+WindowName, "C-c").Run()
	_ = exec.Command("tmux", "-L", socket, "kill-session", "-t", "="+session).Run()
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
	if err := startOn(testSocket, SessionName); err != nil {
		t.Fatalf("startOn() error: %v", err)
	}
	if !isRunningOn(testSocket) {
		t.Fatal("isRunningOn() = false after startOn()")
	}

	// Starting again should fail (session already exists).
	if err := startOn(testSocket, SessionName); err == nil {
		t.Error("startOn() should error when session already exists")
	}

	// Stop should succeed.
	stopOn(testSocket, SessionName)
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
	if err := startOn(testSocket, SessionName); err != nil {
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

// TestIsRunning_IgnoresPrefixCollision is the regression test for the bug
// that motivated the SessionName rename + `=` anchors. A leftover relay-style
// session "rk-relay-deadbeef" (prefix-matches the legacy name "rk") must not
// be misidentified as a running daemon.
func TestIsRunning_IgnoresPrefixCollision(t *testing.T) {
	if !hasTmux() {
		t.Skip("tmux not in PATH")
	}
	if testing.Short() {
		t.Skip("skipping integration test in short mode")
	}
	useTestSocket(t)
	withServerSocket(t, testSocket)

	// Plant a session whose name only collides under prefix matching.
	if err := startOn(testSocket, "rk-relay-deadbeef"); err != nil {
		t.Fatalf("startOn(relay) error: %v", err)
	}

	if IsRunning() {
		t.Error("IsRunning() = true; expected false — relay session must not " +
			"prefix-match the daemon session lookup")
	}
}

// TestStop_LegacySessionName verifies the upgrade path: a daemon started by
// an older binary under the legacy name "rk" can still be stopped by the new
// Stop() implementation.
func TestStop_LegacySessionName(t *testing.T) {
	if !hasTmux() {
		t.Skip("tmux not in PATH")
	}
	if testing.Short() {
		t.Skip("skipping integration test in short mode")
	}
	useTestSocket(t)
	withServerSocket(t, testSocket)

	// Simulate a legacy daemon running under the old session name.
	if err := startOn(testSocket, LegacySessionName); err != nil {
		t.Fatalf("startOn(legacy) error: %v", err)
	}
	if !IsRunning() {
		t.Fatal("IsRunning() = false; expected true for legacy-named daemon")
	}

	if err := Stop(); err != nil {
		t.Fatalf("Stop() error: %v", err)
	}
	if IsRunning() {
		t.Error("IsRunning() = true after Stop(); legacy session should be gone")
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
	if err := startOn(testSocket, SessionName); err != nil {
		t.Fatalf("startOn() error: %v", err)
	}

	// Stop and re-start (simulates restart).
	stopOn(testSocket, SessionName)
	if err := startOn(testSocket, SessionName); err != nil {
		t.Fatalf("startOn() after stop error: %v", err)
	}
	if !isRunningOn(testSocket) {
		t.Error("isRunningOn() = false after restart")
	}
}
