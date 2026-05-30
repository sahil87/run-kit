package api

import (
	"os"
	"testing"
)

// TestParseTestSocketPID covers the api package's copy of the TestMain pre-sweep
// PID parser. Names without a parseable owner PID (fixed-name shared sockets,
// foreign servers, malformed) MUST report ok=false so the pre-sweep leaves them
// untouched.
func TestParseTestSocketPID(t *testing.T) {
	cases := []struct {
		name    string
		wantPID int
		wantOK  bool
	}{
		{"rk-test-29701-1780032043508597000", 29701, true},
		{"rk-relay-test-20089-1780031796792405000", 20089, true},
		{"rk-daemon-test", 0, false},
		{"rk-tmuxctl-test", 0, false},
		{"rk-e2e", 0, false},
		{"rk-e2e-multi-632360", 0, false},
		{"default", 0, false},
		{"rk-test-notapid-123", 0, false},
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

// TestTestPIDAlive asserts the api copy of the pre-sweep liveness predicate.
func TestTestPIDAlive(t *testing.T) {
	if !testPIDAlive(os.Getpid()) {
		t.Errorf("testPIDAlive(self) = false, want true")
	}
	const deadPID = 0x7FFFFFFE
	if testPIDAlive(deadPID) {
		t.Errorf("testPIDAlive(%d) = true, want false (ESRCH → dead)", deadPID)
	}
}
