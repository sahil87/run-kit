package daemon

import (
	"context"
	"fmt"
	"net"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"
)

// testSocketName builds a unified test socket name: rk-test-<role>-<pid>-<ns>.
// Local copy of the helper in internal/tmux/main_test.go (Go _test.go symbols
// are package-private and cannot be shared across packages). PID-stamping the
// former fixed name rk-daemon-test makes the socket parseable by the automatic
// post-sweep instead of relying on t.Cleanup alone.
func testSocketName(role string) string {
	return fmt.Sprintf("rk-test-%s-%d-%d", role, os.Getpid(), time.Now().UnixNano())
}

// testSocket is the daemon package's isolated test socket. Was a fixed
// rk-daemon-test; now PID-stamped under the unified umbrella. Computed once per
// test binary so every helper that targets it (useTestSocket, withServerSocket,
// startOn/stopOn) shares the same name.
var testSocket = testSocketName("daemon")

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

// withStopTiming shrinks Stop()'s grace period and poll interval for the
// duration of the test and restores them on cleanup. Shrinking the grace
// period lets a test deterministically drive Stop() into its timeout/kill
// branch — the code path the rk-update restart bug lived in — without burning
// the full 12s wall-clock. Mirrors the withServerSocket test seam.
func withStopTiming(t *testing.T, grace, poll time.Duration) {
	t.Helper()
	origGrace, origPoll := stopGracePeriod, stopPollInterval
	stopGracePeriod, stopPollInterval = grace, poll
	t.Cleanup(func() { stopGracePeriod, stopPollInterval = origGrace, origPoll })
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

// startSelfExitingOn creates a session whose inner command HONORS SIGINT (C-c)
// AND also self-exits after a fixed short delay, so the session vanishes on its
// own within a bounded, signal-delivery-independent window. Unlike startOn's
// `sleep 300` (ignores C-c, stays alive), and unlike a pure `trap … INT` shell
// (whose exit timing depends on C-c delivery latency and so races a short grace
// period under load), the fixed `sleep` bounds teardown deterministically:
// pair it with a grace period several times larger and the session is reliably
// gone before the grace timer fires — no wall-clock race. delaySec is the
// fixed self-exit delay in seconds (fractional ok, e.g. "0.2").
func startSelfExitingOn(socket, session, delaySec string) error {
	return exec.Command("tmux", "-L", socket,
		"new-session", "-d", "-s", session, "-n", WindowName,
		"sh", "-c", "trap 'exit 0' INT; sleep "+delaySec+"; exit 0").Run()
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

	// Pin RK_HOST/RK_PORT to a known-free port so the port-probe guard
	// (added by the deterministic-daemon-lifecycle change) passes and we
	// reach the symlink-resolution path this test is asserting against.
	port := freeTCPPort(t)
	t.Setenv("RK_HOST", "127.0.0.1")
	t.Setenv("RK_PORT", fmt.Sprintf("%d", port))

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

	// Pin RK_HOST/RK_PORT to a known-free port (see TestStartWithBinary_InvalidPath).
	port := freeTCPPort(t)
	t.Setenv("RK_HOST", "127.0.0.1")
	t.Setenv("RK_PORT", fmt.Sprintf("%d", port))

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

// TestStop_TimeoutThenSessionVanished is the regression test for the rk-update
// restart bug: Stop() reported a non-nil error on a graceful shutdown that
// actually SUCCEEDED, aborting RestartWithBinary before the new binary launched.
//
// The bug lived ONLY in the timeout/kill branch: when the inner serve's graceful
// shutdown outlasted Stop()'s budget, the grace timer fired, and by kill-time the
// session had finished exiting — so `kill-session` returned `can't find session`,
// which old code wrapped as a fatal error.
//
// Reaching that branch deterministically requires the session to be LIVE at the
// initial lookup, then GONE by the kill-branch re-probe — without a wall-clock
// race. We construct that ordering with a wide margin:
//   - poll interval set huge (1h) so the happy-path poll arm can never fire;
//     the grace timer is the only select arm that can win.
//   - the session self-exits at a FIXED 200ms (startSelfExitingOn), independent
//     of C-c delivery latency, so teardown completes in a tight, bounded window.
//   - the grace period is 2s — 10x the self-exit delay — so the session is
//     reliably gone (≈1.8s margin) before the grace timer fires and Stop()
//     re-probes. No event-ordering race remains even under CPU/tmux load.
//
// Why this is the real guard: the PRE-EXISTING TestStop_LegacySessionName uses
// `sleep 300` (ignores C-c) and always hits the kill path with a LIVE session,
// which old code handled fine. The very first version of THIS test used the full
// 12s grace, so the session vanished in the happy-path poll loop and the test
// passed against buggy code — proving nothing. Here the huge poll interval
// bypasses the happy path and forces the timeout/kill branch — the only code the
// fix touches. This test FAILS against pre-fix daemon.go (kill against the
// vanished session → `can't find session` error) and PASSES against the fix.
func TestStop_TimeoutThenSessionVanished(t *testing.T) {
	if !hasTmux() {
		t.Skip("tmux not in PATH")
	}
	if testing.Short() {
		t.Skip("skipping integration test in short mode")
	}
	useTestSocket(t)
	withServerSocket(t, testSocket)
	// Grace (2s) ≫ the session's fixed 200ms self-exit, and poll interval huge so
	// only the grace timer fires. Stop() therefore takes the timeout/kill branch
	// with the session already gone — the exact bug condition — with no race.
	withStopTiming(t, 2*time.Second, time.Hour)

	if err := startSelfExitingOn(testSocket, SessionName, "0.2"); err != nil {
		t.Fatalf("startSelfExitingOn() error: %v", err)
	}
	if !IsRunning() {
		t.Fatal("IsRunning() = false; expected true for the freshly started session")
	}

	// Stop() sends C-c and waits; the session self-exits at ~200ms, well before
	// the 2s grace timer. When the timer fires, the fix's re-probe under a fresh
	// context finds the session already gone and returns nil. Pre-fix code ran
	// kill-session against the vanished session and returned a `can't find
	// session` error — aborting the rk-update restart.
	err := Stop()
	if err != nil {
		t.Fatalf("Stop() = %v; a session that exits on its own during the wait must report success, not a kill error", err)
	}
	if IsRunning() {
		t.Error("IsRunning() = true after Stop(); the self-exiting session should be gone")
	}
}

// TestStop_TimeoutStuckSessionIsKilled pins the OTHER side of the kill branch: a
// session that does NOT honor C-c and is STILL ALIVE when the grace timer fires
// must be force-killed (not silently reported as a successful stop). Uses
// startOn's `sleep 300` (ignores C-c) so the session is reliably alive at the
// timeout; Stop()'s re-probe finds it present, kill-session succeeds, and Stop()
// returns nil. A restart round-trip then confirms a fresh session comes back up.
// Guards against an over-broad "always return nil" regression of the fix.
//
// (The remaining sub-branch — kill-session itself failing while the session is
// still alive, which surfaces a wrapped error — is correct by inspection but not
// unit-tested: provoking a kill failure on a genuinely live session would
// require process/IPC injection beyond this integration test's reach.)
func TestStop_TimeoutStuckSessionIsKilled(t *testing.T) {
	if !hasTmux() {
		t.Skip("tmux not in PATH")
	}
	if testing.Short() {
		t.Skip("skipping integration test in short mode")
	}
	useTestSocket(t)
	withServerSocket(t, testSocket)
	withStopTiming(t, time.Nanosecond, time.Hour)

	// sleep 300 ignores C-c, so the session is still alive when the (instantly
	// expired) grace period sends Stop() into the kill branch.
	if err := startOn(testSocket, SessionName); err != nil {
		t.Fatalf("startOn() error: %v", err)
	}
	if !IsRunning() {
		t.Fatal("IsRunning() = false; expected true for the freshly started session")
	}

	// Re-probe finds the session alive → kill-session runs and succeeds → nil.
	if err := Stop(); err != nil {
		t.Fatalf("Stop() = %v; killing a live stuck session should succeed", err)
	}
	if IsRunning() {
		t.Error("IsRunning() = true after Stop(); the stuck session should have been killed")
	}

	// Restart round-trip: after a successful stop, a fresh session must come
	// back up — the end-to-end behavior `rk update` relies on.
	if err := startOn(testSocket, SessionName); err != nil {
		t.Fatalf("startOn() after Stop() error: %v; restart round-trip must bring a fresh session back up", err)
	}
	if !IsRunning() {
		t.Error("IsRunning() = false after restart; a fresh session should be up")
	}
}

// TestProbeHost verifies loopback substitution for wildcard/empty/IPv6
// unspecified hosts. A serve bound to those wildcards is reachable on
// loopback, and dialing the wildcard itself is platform-inconsistent — so
// the port-probe must rewrite to 127.0.0.1.
func TestProbeHost(t *testing.T) {
	tests := []struct {
		in, want string
	}{
		{"", "127.0.0.1"},
		{"0.0.0.0", "127.0.0.1"},
		{"::", "127.0.0.1"},
		{"127.0.0.1", "127.0.0.1"},
		{"10.0.0.1", "10.0.0.1"},
		{"example.com", "example.com"},
	}
	for _, tc := range tests {
		t.Run(fmt.Sprintf("host=%q", tc.in), func(t *testing.T) {
			if got := probeHost(tc.in); got != tc.want {
				t.Errorf("probeHost(%q) = %q, want %q", tc.in, got, tc.want)
			}
		})
	}
}

// freeTCPPort grabs an ephemeral port, closes the listener, and returns the
// port number. The window between Close and the next bind is racy in theory,
// but in practice the kernel does not immediately re-issue the port — good
// enough for a unit test asserting "port is free."
func freeTCPPort(t *testing.T) int {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("net.Listen: %v", err)
	}
	port := ln.Addr().(*net.TCPAddr).Port
	if err := ln.Close(); err != nil {
		t.Fatalf("listener Close: %v", err)
	}
	return port
}

// TestPortInUse_Free asserts the probe returns false when nothing is bound.
func TestPortInUse_Free(t *testing.T) {
	port := freeTCPPort(t)
	if portInUse("127.0.0.1", port) {
		t.Errorf("portInUse(127.0.0.1, %d) = true, want false (port should be free)", port)
	}
}

// TestPortInUse_Held asserts the probe returns true when a listener is
// accepting connections on the target.
func TestPortInUse_Held(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("net.Listen: %v", err)
	}
	defer ln.Close()
	port := ln.Addr().(*net.TCPAddr).Port

	if !portInUse("127.0.0.1", port) {
		t.Errorf("portInUse(127.0.0.1, %d) = false, want true (listener is bound)", port)
	}
}

// TestPortInUse_LoopbackSubstitution verifies that probing host "0.0.0.0"
// dials loopback — exercising the wildcard-substitution path against a real
// listener bound to 127.0.0.1.
func TestPortInUse_LoopbackSubstitution(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("net.Listen: %v", err)
	}
	defer ln.Close()
	port := ln.Addr().(*net.TCPAddr).Port

	if !portInUse("0.0.0.0", port) {
		t.Errorf("portInUse(0.0.0.0, %d) = false; expected loopback substitution to detect 127.0.0.1 listener", port)
	}
}

// TestStart_RefusesWhenPortInUse verifies the port-probe guard in Start():
// when something is already listening on the configured port (foreground-serve
// scenario), Start() must refuse with an error containing the spec-mandated
// substrings, and must NOT create a tmux session on the daemon socket.
func TestStart_RefusesWhenPortInUse(t *testing.T) {
	if !hasTmux() {
		t.Skip("tmux not in PATH")
	}
	if IsRunning() {
		t.Skip("skipping — production daemon is running")
	}
	useTestSocket(t)
	withServerSocket(t, testSocket)

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("net.Listen: %v", err)
	}
	defer ln.Close()
	port := ln.Addr().(*net.TCPAddr).Port

	t.Setenv("RK_HOST", "127.0.0.1")
	t.Setenv("RK_PORT", fmt.Sprintf("%d", port))

	err = Start()
	if err == nil {
		t.Fatal("Start() returned nil; expected port-in-use refusal")
	}
	msg := err.Error()
	for _, want := range []string{"already serving on", "not under the rk-daemon", "RK_PORT"} {
		if !strings.Contains(msg, want) {
			t.Errorf("Start() error = %q; want it to contain %q", msg, want)
		}
	}
	if isRunningOn(testSocket) {
		t.Error("Start() created a daemon session despite port-in-use refusal")
	}
}

// TestReapStaleDaemonSocket_NoOp asserts that reaping when no server is
// running on the daemon socket does not panic, block, or otherwise misbehave.
// `kill-server` returns "no server running on …" which the reap suppresses to
// slog.Debug — the caller observes no signal at all.
func TestReapStaleDaemonSocket_NoOp(t *testing.T) {
	if !hasTmux() {
		t.Skip("tmux not in PATH")
	}
	useTestSocket(t)
	withServerSocket(t, testSocket)

	ctx, cancel := context.WithTimeout(context.Background(), cmdTimeout)
	defer cancel()

	// Sanity: no server should be running on the test socket.
	if isRunningOn(testSocket) {
		t.Fatal("test socket unexpectedly has a running session")
	}

	// Should not panic or block.
	reapStaleDaemonSocket(ctx)
}

// TestInnerServePID_NoSession verifies that the helper errors out cleanly when
// no daemon session exists.
func TestInnerServePID_NoSession(t *testing.T) {
	if !hasTmux() {
		t.Skip("tmux not in PATH")
	}
	useTestSocket(t)
	withServerSocket(t, testSocket)

	pid, err := InnerServePID()
	if err == nil {
		t.Errorf("InnerServePID() = (%d, nil); expected error when no daemon session exists", pid)
	}
	if pid != 0 {
		t.Errorf("InnerServePID() pid = %d; expected 0 on error", pid)
	}
}

// TestInnerServePID_Running verifies the helper returns a positive PID for a
// live daemon session on the test socket.
func TestInnerServePID_Running(t *testing.T) {
	if !hasTmux() {
		t.Skip("tmux not in PATH")
	}
	if testing.Short() {
		t.Skip("skipping integration test in short mode")
	}
	useTestSocket(t)
	withServerSocket(t, testSocket)

	if err := startOn(testSocket, SessionName); err != nil {
		t.Fatalf("startOn() error: %v", err)
	}

	pid, err := InnerServePID()
	if err != nil {
		t.Fatalf("InnerServePID() error: %v", err)
	}
	if pid <= 0 {
		t.Errorf("InnerServePID() = %d; expected positive PID", pid)
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
