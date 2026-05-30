package api

import (
	"os"
	"testing"
)

// TestParseTestSocketPID covers the api package's copy of the TestMain
// post-sweep PID parser. Under the unified rk-test-<role>-<pid>-<ns> rule the
// PID is the SECOND-TO-LAST hyphen field, so hyphenated roles parse
// unambiguously. Names without a parseable owner PID (foreign servers,
// malformed) MUST report ok=false so the post-sweep leaves them untouched.
func TestParseTestSocketPID(t *testing.T) {
	cases := []struct {
		name    string
		wantPID int
		wantOK  bool
	}{
		{"rk-test-unit-48213-1717050000000000000", 48213, true},
		{"rk-test-e2e-multi-48213-1717050000000000000", 48213, true},
		{"rk-test-e2e-coupling-48213-1717050000000000000", 48213, true},
		{"runkit", 0, false},
		{"rk-relay-3f9a1c2b", 0, false},
		{"rk-e2e", 0, false},
		{"rk-daemon", 0, false},
		{"default", 0, false},
		{"rk-test-unit", 0, false},
		{"rk-test", 0, false},
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

// TestTestPIDAlive asserts the api copy of the post-sweep liveness predicate.
func TestTestPIDAlive(t *testing.T) {
	if !testPIDAlive(os.Getpid()) {
		t.Errorf("testPIDAlive(self) = false, want true")
	}
	const deadPID = 0x7FFFFFFE
	if testPIDAlive(deadPID) {
		t.Errorf("testPIDAlive(%d) = true, want false (ESRCH → dead)", deadPID)
	}
}
