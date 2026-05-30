package tmux

import (
	"context"
	"os"
	"strconv"
	"testing"
	"time"
)

// TestParseTestSocketPID covers the PID extraction the TestMain pre-sweep relies
// on to decide which sockets carry a parseable owner PID. Names that do not
// (fixed-name shared sockets, foreign servers, malformed) MUST report ok=false
// so the pre-sweep leaves them untouched.
func TestParseTestSocketPID(t *testing.T) {
	cases := []struct {
		name    string
		wantPID int
		wantOK  bool
	}{
		// PID-embedding helper sockets — parse the second hyphen field.
		{"rk-test-29701-1780032043508597000", 29701, true},
		{"rk-relay-test-20089-1780031796792405000", 20089, true},

		// Fixed-name shared sockets — no parseable PID, never reaped.
		{"rk-daemon-test", 0, false},
		{"rk-tmuxctl-test", 0, false},

		// Foreign / user-facing servers — not targeted by the pre-sweep.
		{"rk-e2e", 0, false},
		{"rk-e2e-multi-632360", 0, false},
		{"default", 0, false},

		// Malformed: known prefix but non-numeric PID field.
		{"rk-test-notapid-123", 0, false},
		{"rk-test--123", 0, false},
		{"rk-test-", 0, false},
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

// TestTestPIDAlive asserts the pre-sweep's liveness predicate: the current
// process is alive, and a PID above pid_max that names no process is dead.
func TestTestPIDAlive(t *testing.T) {
	if !testPIDAlive(os.Getpid()) {
		t.Errorf("testPIDAlive(self) = false, want true")
	}
	const deadPID = 0x7FFFFFFE
	if testPIDAlive(deadPID) {
		t.Errorf("testPIDAlive(%d) = true, want false (ESRCH → dead)", deadPID)
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
