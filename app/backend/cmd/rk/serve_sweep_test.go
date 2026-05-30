package main

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"testing"
	"time"

	"rk/internal/tmux"
)

// testSocketName builds a unified test socket name: rk-test-<role>-<pid>-<ns>.
// Local copy of the helper in internal/tmux/main_test.go and api/main_test.go
// (Go _test.go symbols are package-private and cannot be shared across
// packages). The single cmd/rk naming site routes through it so no inline
// "rk-test-..." format string remains.
func testSocketName(role string) string {
	return fmt.Sprintf("rk-test-%s-%d-%d", role, os.Getpid(), time.Now().UnixNano())
}

func TestPidAlive(t *testing.T) {
	// The current process is unambiguously alive.
	if !pidAlive(os.Getpid()) {
		t.Errorf("pidAlive(self) = false, want true")
	}

	// PID 1 (init) always exists; signalling it as a non-root user returns
	// EPERM, which pidAlive MUST treat as alive (spare) — the benign-leak bias.
	if !pidAlive(1) {
		t.Errorf("pidAlive(1) = false, want true (EPERM/own → spare)")
	}

	// A PID that does not exist (kill(pid,0) → ESRCH) is dead. PIDs above the
	// kernel default pid_max (and never recycled into existence here) are a
	// reliable stand-in for "no such process".
	const deadPID = 0x7FFFFFFE
	if pidAlive(deadPID) {
		t.Errorf("pidAlive(%d) = true, want false (ESRCH → dead)", deadPID)
	}
}

func TestRelayOwnerIsDead(t *testing.T) {
	tests := []struct {
		name  string
		owner string
		want  bool
	}{
		{"empty owner is orphan", "", true},
		{"non-integer owner is orphan", "not-a-pid", true},
		{"live owner spared", strconv.Itoa(os.Getpid()), false},
		{"dead owner reaped", "2147483646", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := relayOwnerIsDead(tt.owner); got != tt.want {
				t.Errorf("relayOwnerIsDead(%q) = %v, want %v", tt.owner, got, tt.want)
			}
		})
	}
}

// tmuxL runs a tmux command against an isolated server, failing the test on
// error so setup mistakes surface immediately.
func tmuxL(t *testing.T, server string, args ...string) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	full := append([]string{"-L", server}, args...)
	if out, err := exec.CommandContext(ctx, "tmux", full...).CombinedOutput(); err != nil {
		t.Fatalf("tmux %v: %v\n%s", args, err, out)
	}
}

// TestSweepOrphanedRelaySessions_scoping is an end-to-end check that the sweep
// reaps only dead-owner / unstamped relays and spares a live-owner relay and the
// control anchor. It runs against a real isolated tmux server discoverable by
// tmux.ListServers (named rk-test-<pid>-<ns> so it lands in /tmp/tmux-<uid>/).
func TestSweepOrphanedRelaySessions_scoping(t *testing.T) {
	if _, err := exec.LookPath("tmux"); err != nil {
		t.Skip("tmux not available — skipping integration test")
	}
	server := testSocketName("unit")

	// Bootstrap the isolated server with a non-relay session so it stays alive
	// even after every relay is reaped (server with zero sessions exits).
	bootCtx, cancelBoot := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelBoot()
	if out, err := exec.CommandContext(bootCtx, "tmux", "-L", server,
		"new-session", "-d", "-s", "keepalive").CombinedOutput(); err != nil {
		t.Skipf("could not start isolated tmux server %q: %v\n%s", server, err, out)
	}
	t.Cleanup(func() {
		killCtx, cancelKill := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancelKill()
		_ = exec.CommandContext(killCtx, "tmux", "-L", server, "kill-server").Run()
	})

	live := tmux.RelaySessionPrefix + "live0001"     // stamped with this PID → spared
	dead := tmux.RelaySessionPrefix + "dead0002"     // stamped with a dead PID → reaped
	unstamped := tmux.RelaySessionPrefix + "none003" // no @rk_owner_pid → reaped
	anchor := tmux.ControlAnchorSessionName          // _rk-ctl → never reaped

	for _, name := range []string{live, dead, unstamped, anchor} {
		tmuxL(t, server, "new-session", "-d", "-s", name)
	}
	tmuxL(t, server, "set-option", "-t", live, tmux.OwnerPIDOption, strconv.Itoa(os.Getpid()))
	tmuxL(t, server, "set-option", "-t", dead, tmux.OwnerPIDOption, "2147483646") // > pid_max → dead

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	// The sweep iterates every server in /tmp/tmux-<uid>/. A foreign server may
	// fail to list and surface as an aggregated per-server error — that MUST NOT
	// abort the sweep (A-009), so we log it but still assert on our server's
	// final state below rather than failing on a non-nil aggregate.
	if err := sweepOrphanedRelaySessions(ctx); err != nil {
		t.Logf("sweep returned aggregated per-server error (non-fatal): %v", err)
	}

	listCtx, cancelList := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelList()
	names, err := tmux.ListRawSessionNames(listCtx, server)
	if err != nil {
		t.Fatalf("list sessions after sweep: %v", err)
	}
	survived := make(map[string]bool, len(names))
	for _, n := range names {
		survived[n] = true
	}

	if !survived[live] {
		t.Errorf("live-owner relay %q was reaped, want spared", live)
	}
	if !survived[anchor] {
		t.Errorf("control anchor %q was reaped, want spared", anchor)
	}
	if survived[dead] {
		t.Errorf("dead-owner relay %q survived, want reaped", dead)
	}
	if survived[unstamped] {
		t.Errorf("unstamped relay %q survived, want reaped", unstamped)
	}
}
