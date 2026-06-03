package tmuxctl

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"
)

// testSocketName builds a unified test socket name: rk-test-<role>-<pid>-<ns>.
// Local copy of the helper in internal/tmux/main_test.go (Go _test.go symbols
// are package-private and cannot be shared across packages). PID-stamping the
// former fixed name rk-tmuxctl-test makes the socket parseable by the automatic
// post-sweep instead of relying on t.Cleanup alone.
func testSocketName(role string) string {
	return fmt.Sprintf("rk-test-%s-%d-%d", role, os.Getpid(), time.Now().UnixNano())
}

// TestIntegration_TmuxControlMode_LatencyTarget exercises the real tmux
// control-mode connection by spinning up an isolated server, opening a
// Client, then triggering a window switch and asserting the generation
// counter advances within the spec's 500ms hard upper bound.
//
// Target: 200ms. Hard upper bound: 500ms. CI flake budget may relax the
// bound up to 500ms; if CI proves flaky, raise the assertion below.
//
// Skipped when tmux is not present on the host.
func TestIntegration_TmuxControlMode_LatencyTarget(t *testing.T) {
	if _, err := exec.LookPath("tmux"); err != nil {
		t.Skip("tmux not available — skipping integration test")
	}

	socket := testSocketName("tmuxctl")

	// Pre-cleanup in case a prior aborted run left the server alive.
	_ = exec.Command("tmux", "-L", socket, "kill-server").Run()

	// Spin up an isolated tmux server with one session.
	out, err := exec.Command("tmux", "-L", socket, "new-session", "-d", "-s", "main").CombinedOutput()
	if err != nil {
		t.Skipf("could not create tmux session (likely no PTY): %v\n%s", err, string(out))
	}
	t.Cleanup(func() {
		_ = exec.Command("tmux", "-L", socket, "kill-server").Run()
	})

	// Add a second window so select-window has somewhere to go.
	if out, err := exec.Command("tmux", "-L", socket, "new-window", "-d", "-t", "main").CombinedOutput(); err != nil {
		t.Fatalf("new-window: %v\n%s", err, string(out))
	}

	sink := &recordingSink{}
	c, err := Open(context.Background(), socket, sink)
	if err != nil {
		if strings.Contains(err.Error(), "PTY") || strings.Contains(err.Error(), "pty") {
			t.Skipf("PTY unavailable: %v", err)
		}
		t.Fatalf("Open: %v", err)
	}
	defer c.Close()

	// Wait for the connection to establish.
	deadline := time.Now().Add(2 * time.Second)
	for {
		sink.mu.Lock()
		est := sink.established
		sink.mu.Unlock()
		if est >= 1 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("did not see OnConnectionEstablished within 2s")
		}
		time.Sleep(10 * time.Millisecond)
	}

	// Trigger a select-window. Generation must advance within 500ms.
	prev := c.Generation()
	start := time.Now()
	if out, err := exec.Command("tmux", "-L", socket, "select-window", "-t", "main:1").CombinedOutput(); err != nil {
		t.Fatalf("select-window: %v\n%s", err, string(out))
	}

	select {
	case <-c.Wait(prev):
		elapsed := time.Since(start)
		t.Logf("control-mode notification arrived in %v", elapsed)
		if elapsed > 500*time.Millisecond {
			t.Errorf("notification took %v, exceeds 500ms hard upper bound", elapsed)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("never observed control-mode notification within 2s")
	}
}

// hasSession reports whether a session of the given name exists on the socket.
func hasSession(t *testing.T, socket, name string) bool {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	return exec.CommandContext(ctx, "tmux", "-L", socket, "has-session", "-t", "="+name).Run() == nil
}

// showGlobalOption reads a server-scoped global tmux option value.
func showGlobalOption(t *testing.T, socket, opt string) string {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "tmux", "-L", socket, "show-options", "-g", "-v", opt).Output()
	if err != nil {
		t.Fatalf("show-options -g %s: %v", opt, err)
	}
	return strings.TrimSpace(string(out))
}

// TestIntegration_ResolveBootstrap_AlwaysFloorsAnchor proves the core fix and
// edge case A (restart/reconnect to a server with N existing real sessions):
// even when a real session already exists at connect time, resolveBootstrap
// creates the `_rk-ctl` anchor floor (it previously did NOT), the attach target
// is the REAL session (not the anchor), and productionDial has set exit-empty
// off on the server. This is the self-heal path: the old only-when-empty code
// would leave such a server with no floor, so its later collapse to zero reaped
// the whole server. Change: 260602-a1wo-prevent-exit-empty-server-death.
func TestIntegration_ResolveBootstrap_AlwaysFloorsAnchor(t *testing.T) {
	if _, err := exec.LookPath("tmux"); err != nil {
		t.Skip("tmux not available — skipping integration test")
	}
	socket := testSocketName("tmuxctl")
	_ = exec.Command("tmux", "-L", socket, "kill-server").Run()

	// Pre-seed with a real session, WITHOUT our `-f` config (foreign-server
	// shape) so the default exit-empty=on is what productionDial must flip.
	if out, err := exec.Command("tmux", "-L", socket, "new-session", "-d", "-s", "realwork").CombinedOutput(); err != nil {
		t.Skipf("could not create tmux session (likely no PTY): %v\n%s", err, string(out))
	}
	t.Cleanup(func() { _ = exec.Command("tmux", "-L", socket, "kill-server").Run() })

	// Sanity: the anchor does NOT exist yet (the bug's precondition).
	if hasSession(t, socket, "_rk-ctl") {
		t.Fatal("precondition: _rk-ctl should not exist before connect")
	}

	bootstrap, err := resolveBootstrap(context.Background(), socket)
	if err != nil {
		t.Fatalf("resolveBootstrap: %v", err)
	}

	// R2: attach target is the real session, NOT the anchor (even though
	// `_rk-ctl` sorts ahead of `realwork` in list-sessions output).
	if bootstrap != "realwork" {
		t.Errorf("attach target = %q, want \"realwork\" (prefer real session)", bootstrap)
	}
	// R1: the anchor floor exists regardless of pre-existing real sessions.
	if !hasSession(t, socket, "_rk-ctl") {
		t.Error("R1 violated: _rk-ctl anchor floor not created on a server with a real session")
	}

	// R3 / edge A: a full productionDial sets exit-empty off BEFORE creating
	// the anchor. Drive the whole dial and assert the server option.
	cmd, ptmx, derr := productionDial(context.Background(), socket)
	if derr != nil {
		t.Fatalf("productionDial: %v", derr)
	}
	defer func() {
		_ = ptmx.Close()
		if cmd.Process != nil {
			_ = cmd.Process.Kill()
			_, _ = cmd.Process.Wait()
		}
	}()
	if got := showGlobalOption(t, socket, "exit-empty"); got != "off" {
		t.Errorf("exit-empty after productionDial = %q, want \"off\" (R3 backstop)", got)
	}
}

// TestIntegration_ResolveBootstrap_ConcurrentAnchorBenign proves edge case B:
// two processes racing to create the anchor is benign. The first resolveBootstrap
// creates `_rk-ctl`; a second resolveBootstrap against the same server hits a
// "duplicate session" error inside createAnchor that isDuplicateSessionError
// classifies as benign, so the second call STILL succeeds (no error, anchor
// intact). No cross-process state is introduced (Constitution II). Change:
// 260602-a1wo-prevent-exit-empty-server-death.
//
// Updated by 260602-poka-guard-anchor-no-resurrect: resolveBootstrap no longer
// starts a server (the anchor guard). The server must already be ALIVE before
// the first resolveBootstrap, so this test seeds a live server (an anchor-only
// shape) rather than relying on the removed resurrection path.
func TestIntegration_ResolveBootstrap_ConcurrentAnchorBenign(t *testing.T) {
	if _, err := exec.LookPath("tmux"); err != nil {
		t.Skip("tmux not available — skipping integration test")
	}
	socket := testSocketName("tmuxctl")
	_ = exec.Command("tmux", "-L", socket, "kill-server").Run()

	// Seed a LIVE anchor-only server directly (resolveBootstrap no longer starts
	// one). This reproduces the "only the anchor present" shape the test asserts.
	if out, err := exec.Command("tmux", "-L", socket, "new-session", "-d", "-s", "_rk-ctl").CombinedOutput(); err != nil {
		t.Skipf("could not create tmux session (likely no PTY): %v\n%s", err, string(out))
	}
	t.Cleanup(func() { _ = exec.Command("tmux", "-L", socket, "kill-server").Run() })

	// First resolveBootstrap against the now-live server: probe passes, the
	// anchor already exists (benign duplicate), and _rk-ctl is the attach target.
	if _, err := resolveBootstrap(context.Background(), socket); err != nil {
		t.Fatalf("first resolveBootstrap: %v", err)
	}

	if !hasSession(t, socket, "_rk-ctl") {
		t.Fatal("first resolveBootstrap did not preserve _rk-ctl")
	}

	// Second call simulates a concurrent rk that loses the createAnchor race:
	// createAnchor returns "duplicate session", which must be swallowed.
	got, err := resolveBootstrap(context.Background(), socket)
	if err != nil {
		t.Fatalf("second resolveBootstrap (duplicate anchor must be benign): %v", err)
	}
	// With only the anchor present, the attach target falls back to _rk-ctl.
	if got != "_rk-ctl" {
		t.Errorf("attach target on anchor-only server = %q, want \"_rk-ctl\"", got)
	}
}

// TestIntegration_ResolveBootstrap_DeadServerDeclines proves the core poka fix
// (R1): a reconnect/dial to a server that has been killed MUST decline (return a
// non-nil error) WITHOUT resurrecting it. Before the guard, resolveBootstrap's
// createAnchor ran `tmux new-session`, which implicitly started the dead server —
// so a kill never stuck while rk serve's reconnect FSM was alive. Now the
// probe-first ordering sees no server and returns errServerDead, and crucially NO
// server exists on the socket afterward.
// Change: 260602-poka-guard-anchor-no-resurrect.
func TestIntegration_ResolveBootstrap_DeadServerDeclines(t *testing.T) {
	if _, err := exec.LookPath("tmux"); err != nil {
		t.Skip("tmux not available — skipping integration test")
	}
	socket := testSocketName("tmuxctl")
	// Ensure no server is running on this socket (the kill / dead-server state
	// the reconnect FSM re-dials into).
	_ = exec.Command("tmux", "-L", socket, "kill-server").Run()
	t.Cleanup(func() { _ = exec.Command("tmux", "-L", socket, "kill-server").Run() })

	// Sanity: the server really is dead before we probe.
	if serverIsAlive(t, socket) {
		t.Fatalf("precondition: server on %q must be dead before the probe", socket)
	}

	bootstrap, err := resolveBootstrap(context.Background(), socket)
	if err == nil {
		t.Fatalf("resolveBootstrap on a dead server returned nil error (bootstrap=%q); expected decline", bootstrap)
	}
	if !errors.Is(err, errServerDead) {
		t.Errorf("resolveBootstrap dead-server error = %v, want errServerDead", err)
	}

	// The crux: resolveBootstrap must NOT have resurrected the server. No anchor,
	// and no server at all, may exist on the socket afterward.
	if serverIsAlive(t, socket) {
		t.Error("R1 violated: a server was (re)started on the dead socket — kill would not stick")
	}
	if hasSession(t, socket, "_rk-ctl") {
		t.Error("R1 violated: _rk-ctl anchor was created on a dead server (resurrection)")
	}
}

// serverIsAlive reports whether a tmux server is listening on the socket, using
// the same side-effect-free list-sessions probe the implementation relies on.
// It must NOT itself start a server (so it can verify "stays dead").
func serverIsAlive(t *testing.T, socket string) bool {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	return exec.CommandContext(ctx, "tmux", "-L", socket, "list-sessions").Run() == nil
}

// TestIntegration_ResolveBootstrap_LiveServerSucceeds proves R2 + R3 together on a
// real tmux server: a freshly-created LIVE server still passes the probe, the
// `_rk-ctl` anchor is created, and the attach target is correct. It exercises two
// live shapes back to back on the same server:
//
//	(R2) a live server with a real session → attach target is the real session;
//	(R3) the alive-but-zero-real-session floor → after killing the real session
//	     (leaving only the anchor), the probe still passes and `_rk-ctl` is
//	     returned, never declined.
//
// Change: 260602-poka-guard-anchor-no-resurrect.
func TestIntegration_ResolveBootstrap_LiveServerSucceeds(t *testing.T) {
	if _, err := exec.LookPath("tmux"); err != nil {
		t.Skip("tmux not available — skipping integration test")
	}
	socket := testSocketName("tmuxctl")
	_ = exec.Command("tmux", "-L", socket, "kill-server").Run()

	// Freshly create a LIVE server with one real session (the first-connect shape).
	if out, err := exec.Command("tmux", "-L", socket, "new-session", "-d", "-s", "realwork").CombinedOutput(); err != nil {
		t.Skipf("could not create tmux session (likely no PTY): %v\n%s", err, string(out))
	}
	t.Cleanup(func() { _ = exec.Command("tmux", "-L", socket, "kill-server").Run() })

	// R2: live server → succeeds, returns the real session, creates the anchor.
	bootstrap, err := resolveBootstrap(context.Background(), socket)
	if err != nil {
		t.Fatalf("R2: resolveBootstrap on a fresh live server declined unexpectedly: %v", err)
	}
	if bootstrap != "realwork" {
		t.Errorf("R2: attach target = %q, want \"realwork\" (prefer the real session)", bootstrap)
	}
	if !hasSession(t, socket, "_rk-ctl") {
		t.Error("R2: _rk-ctl anchor floor not created on a live server")
	}

	// R3: collapse to the alive-but-zero-real-session floor — kill the only real
	// session, leaving just the `_rk-ctl` anchor. The server is still alive
	// (anchor holds it up), so the probe must pass and resolveBootstrap must
	// return the anchor, NOT decline.
	if out, err := exec.Command("tmux", "-L", socket, "kill-session", "-t", "=realwork").CombinedOutput(); err != nil {
		t.Fatalf("kill-session realwork: %v\n%s", err, string(out))
	}
	if !serverIsAlive(t, socket) {
		t.Skip("server collapsed after killing the real session — anchor floor not holding (separate concern, out of poka scope)")
	}
	got, err := resolveBootstrap(context.Background(), socket)
	if err != nil {
		t.Fatalf("R3: resolveBootstrap on an alive-but-zero-real-session server declined: %v", err)
	}
	if got != "_rk-ctl" {
		t.Errorf("R3: attach target on anchor-only server = %q, want \"_rk-ctl\"", got)
	}
}

// TestIsDuplicateSessionError_TmuxText guards the benign-race classifier against
// tmux's actual "duplicate session" stderr without needing a live server, so the
// edge-case-B handling stays covered even where tmux is absent.
func TestIsDuplicateSessionError_TmuxText(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want bool
	}{
		{"nil", nil, false},
		{"duplicate session", errors.New("duplicate session: _rk-ctl"), true},
		{"already exists variant", errors.New("session already exists"), true},
		{"unrelated", errors.New("no server running"), false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := isDuplicateSessionError(tc.err); got != tc.want {
				t.Errorf("isDuplicateSessionError(%v) = %v, want %v", tc.err, got, tc.want)
			}
		})
	}
}

// TestIsServerDeadError_TmuxText guards the dead-vs-alive classifier (R1) against
// tmux's actual "no server running" / "failed to connect" stderr without needing
// a live server, so the decline behavior stays covered even where tmux is absent.
// It checks the text in both the error string AND a captured-stderr-only shape
// (mirroring how createAnchor folds stderr into the message), and confirms that
// unrelated failures are NOT misclassified as a dead server (which would wrongly
// decline a live server).
// Change: 260602-poka-guard-anchor-no-resurrect.
func TestIsServerDeadError_TmuxText(t *testing.T) {
	cases := []struct {
		name   string
		err    error
		stderr string
		want   bool
	}{
		{"nil", nil, "", false},
		{"no server running in stderr", errors.New("exit status 1"), "no server running on /tmp/x\n", true},
		{"failed to connect in stderr", errors.New("exit status 1"), "failed to connect to server\n", true},
		{"socket file missing in stderr", errors.New("exit status 1"), "error connecting to /tmp/x (No such file or directory)\n", true},
		{"no server running in err string", errors.New("tmux: no server running on /tmp/x"), "", true},
		{"failed to connect in err string", errors.New("failed to connect to server"), "", true},
		{"socket file missing in err string", errors.New("error connecting to /tmp/x (No such file or directory)"), "", true},
		{"unrelated failure not dead", errors.New("exit status 1"), "duplicate session: _rk-ctl\n", false},
		{"timeout-like not dead", errors.New("signal: killed"), "", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := isServerDeadError(tc.err, tc.stderr); got != tc.want {
				t.Errorf("isServerDeadError(%v, %q) = %v, want %v", tc.err, tc.stderr, got, tc.want)
			}
		})
	}
}
