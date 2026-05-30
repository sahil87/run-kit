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

// TestSweepDeadTestSockets_sparesLivePIDReapsDead proves the PID-scoped
// post-sweep spares a socket owned by a LIVE PID (a concurrent test process)
// while reaping a same-prefix socket owned by a DEAD PID — the concurrent-
// sparing invariant from the spec (Domain C). Both servers live in the real
// /tmp/tmux-<uid>/ dir that sweepDeadTestSockets scans.
func TestSweepDeadTestSockets_sparesLivePIDReapsDead(t *testing.T) {
	if _, err := exec.LookPath("tmux"); err != nil {
		t.Skip("tmux not available — skipping integration test")
	}

	ns := strconv.FormatInt(time.Now().UnixNano(), 10)
	// Live: embeds this live test process's PID → testPIDAlive == true → spared.
	live := fmt.Sprintf("rk-test-sweepspare-%d-%s", os.Getpid(), ns)
	// Dead: embeds a PID above pid_max → ESRCH → reaped.
	dead := fmt.Sprintf("rk-test-sweepspare-%d-%s", deadPID, ns)

	startSocketServer(t, live)
	startSocketServer(t, dead)

	sweepDeadTestSockets()

	if !tmuxSocketLive(t, live) {
		t.Errorf("live-PID socket %q was reaped — the post-sweep must spare it (concurrent process)", live)
	}
	if tmuxSocketLive(t, dead) {
		t.Errorf("dead-PID socket %q survived — the post-sweep must reap it", dead)
	}
}

// TestGetSessionOwnerPID_unsetReturnsEmpty verifies that an un-stamped session
// reads back as "" with no error — the "orphan" signal the sweep treats as
// reapable. Mirrors GetSessionOrder's unset-tolerance contract.
func TestGetSessionOwnerPID_unsetReturnsEmpty(t *testing.T) {
	server := withSessionOrderTmux(t)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	got, err := GetSessionOwnerPID(ctx, server, "boot")
	if err != nil {
		t.Fatalf("GetSessionOwnerPID unset: %v", err)
	}
	if got != "" {
		t.Errorf("got %q, want empty", got)
	}
}

// TestSetSessionOwnerPID_roundTrip stamps @rk_owner_pid on a session and reads
// it back verbatim — the create-side/sweep-side contract that lets the sweep
// spare a live owner and reap a dead one.
func TestSetSessionOwnerPID_roundTrip(t *testing.T) {
	server := withSessionOrderTmux(t)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	want := os.Getpid()
	if err := SetSessionOwnerPID(ctx, server, "boot", want); err != nil {
		t.Fatalf("SetSessionOwnerPID: %v", err)
	}
	got, err := GetSessionOwnerPID(ctx, server, "boot")
	if err != nil {
		t.Fatalf("GetSessionOwnerPID: %v", err)
	}
	if got != strconv.Itoa(want) {
		t.Errorf("owner pid round-trip: got %q, want %q", got, strconv.Itoa(want))
	}
}
