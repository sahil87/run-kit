package tmux

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"testing"
	"time"
)

// deadPID is above the typical pid_max, so syscall.Kill returns ESRCH and the
// owner is treated as dead. Matches cmd/rk/serve_sweep_test.go's convention.
const deadPID = 0x7FFFFFFE

// TestParseTestSocketPID covers the PID extraction the TestMain post-sweep
// relies on to decide which sockets carry a parseable owner PID. Under the
// unified rk-test-<role>-<pid>-<ns> rule the PID is the SECOND-TO-LAST hyphen
// field, so roles with hyphens (e2e-multi) parse unambiguously. Names without a
// parseable PID (foreign servers, malformed) MUST report ok=false so the
// post-sweep leaves them untouched.
func TestParseTestSocketPID(t *testing.T) {
	cases := []struct {
		name    string
		wantPID int
		wantOK  bool
	}{
		// Simple single-token role — PID is the second-to-last field.
		{"rk-test-unit-48213-1717050000000000000", 48213, true},
		// Hyphenated multi-token roles — second-to-last-field rule is robust.
		{"rk-test-e2e-multi-48213-1717050000000000000", 48213, true},
		{"rk-test-e2e-coupling-48213-1717050000000000000", 48213, true},

		// Non-test names (no rk-test- prefix) → ok=false.
		{"runkit", 0, false},
		{"rk-relay-3f9a1c2b", 0, false},
		{"rk-e2e", 0, false},
		{"rk-daemon", 0, false},
		{"default", 0, false},

		// Too few fields → ok=false.
		{"rk-test-unit", 0, false},
		{"rk-test", 0, false},

		// Non-numeric second-to-last field → ok=false.
		{"rk-test-unit-abc-1717050000000000000", 0, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			pid, ok := parseTestSocketPID(tc.name)
			if ok != tc.wantOK || pid != tc.wantPID {
				t.Errorf("parseTestSocketPID(%q) = (%d, %v), want (%d, %v)",
					tc.name, pid, ok, tc.wantPID, tc.wantOK)
			}
		})
	}
}

// TestTestPIDAlive asserts the post-sweep's liveness predicate: the current
// process is alive, and a PID above pid_max that names no process is dead.
func TestTestPIDAlive(t *testing.T) {
	if !testPIDAlive(os.Getpid()) {
		t.Errorf("testPIDAlive(self) = false, want true")
	}
	if testPIDAlive(deadPID) {
		t.Errorf("testPIDAlive(%d) = true, want false (ESRCH → dead)", deadPID)
	}
}

// tmuxSocketLive reports whether a tmux server is reachable on the given socket
// name (i.e. the post-sweep did NOT reap it).
func tmuxSocketLive(t *testing.T, name string) bool {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	return exec.CommandContext(ctx, "tmux", "-L", name, "list-sessions").Run() == nil
}

// startSocketServer spins up an isolated tmux server on the given socket name
// and registers cleanup. Skips the test if the server cannot be created.
func startSocketServer(t *testing.T, name string) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if out, err := exec.CommandContext(ctx, "tmux", "-L", name,
		"new-session", "-d", "-s", "keepalive", "-x", "80", "-y", "24").CombinedOutput(); err != nil {
		t.Skipf("could not start isolated tmux server %q: %v\n%s", name, err, out)
	}
	t.Cleanup(func() {
		_ = exec.Command("tmux", "-L", name, "kill-server").Run()
	})
}

// startOtherLivePID spawns a throwaway child process and returns its PID,
// registering cleanup to kill it. It stands in for a CONCURRENT test process
// (a different `go test ./...` package): a live PID that is NOT this process's
// own os.Getpid(). The post-sweep must spare sockets owned by such a PID.
func startOtherLivePID(t *testing.T) int {
	t.Helper()
	// `sleep` lives long enough to stay alive across the sweep; killed on cleanup.
	cmd := exec.Command("sleep", "30")
	if err := cmd.Start(); err != nil {
		t.Skipf("could not spawn a stand-in concurrent process: %v", err)
	}
	pid := cmd.Process.Pid
	t.Cleanup(func() {
		_ = cmd.Process.Kill()
		_, _ = cmd.Process.Wait()
	})
	if pid == os.Getpid() {
		t.Fatalf("stand-in pid %d collided with self — cannot test the other-live-PID branch", pid)
	}
	return pid
}

// TestSweepDeadTestSockets_reapsOwnAndDeadSparesOtherLive proves the post-sweep's
// three-way invariant (spec Domain C), the one Copilot flagged the original test
// did not exercise:
//
//   - OWN-PID socket (os.Getpid()) → REAPED. The post-sweep runs at TestMain
//     exit; this run's own rk-test-* sockets are residue even though our pid is
//     still "alive". (The original test wrongly expected own-pid to be spared.)
//   - OTHER-live-PID socket (a concurrent test process) → SPARED.
//   - DEAD-PID socket → REAPED.
//
// All three servers live in the real /tmp/tmux-<uid>/ dir sweepDeadTestSockets
// scans.
func TestSweepDeadTestSockets_reapsOwnAndDeadSparesOtherLive(t *testing.T) {
	if _, err := exec.LookPath("tmux"); err != nil {
		t.Skip("tmux not available — skipping integration test")
	}

	ns := strconv.FormatInt(time.Now().UnixNano(), 10)
	otherPID := startOtherLivePID(t)

	// Own: this run's pid → reaped (we are exiting).
	own := fmt.Sprintf("rk-test-sweepspare-%d-%s", os.Getpid(), ns)
	// Other-live: a different live process → spared (concurrent package).
	otherLive := fmt.Sprintf("rk-test-sweepspare-%d-%s", otherPID, ns)
	// Dead: a PID above pid_max → ESRCH → reaped.
	dead := fmt.Sprintf("rk-test-sweepspare-%d-%s", deadPID, ns)

	startSocketServer(t, own)
	startSocketServer(t, otherLive)
	startSocketServer(t, dead)

	sweepDeadTestSockets()

	if tmuxSocketLive(t, own) {
		t.Errorf("own-PID socket %q survived — the post-sweep must reap this run's own residue at exit", own)
	}
	if !tmuxSocketLive(t, otherLive) {
		t.Errorf("other-live-PID socket %q was reaped — the post-sweep must spare a concurrent process's socket", otherLive)
	}
	if tmuxSocketLive(t, dead) {
		t.Errorf("dead-PID socket %q survived — the post-sweep must reap it", dead)
	}
}
