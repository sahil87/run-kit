package testutil

import (
	"testing"
	"time"
)

// waitPollInterval is the fixed cadence WaitUntil re-checks its condition at.
const waitPollInterval = 50 * time.Millisecond

// WaitUntil polls cond every ~50ms until it returns true or timeout elapses.
// cond is checked before the first sleep, so an already-true condition returns
// immediately. Returns whether cond succeeded — the fall-through variant: the
// caller asserts (or t.Errorf's) after.
func WaitUntil(t *testing.T, timeout time.Duration, cond func() bool) bool {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for {
		if cond() {
			return true
		}
		if time.Now().After(deadline) {
			return false
		}
		time.Sleep(waitPollInterval)
	}
}

// MustWaitUntil is the fail-on-expiry variant: t.Fatalf(msg, args...) when
// WaitUntil returns false. args are evaluated at call time — for a failure
// message that must embed state computed during the wait, use
// `if !WaitUntil(...) { t.Fatalf(...) }` instead.
func MustWaitUntil(t *testing.T, timeout time.Duration, cond func() bool, msg string, args ...any) {
	t.Helper()
	if !WaitUntil(t, timeout, cond) {
		t.Fatalf(msg, args...)
	}
}
