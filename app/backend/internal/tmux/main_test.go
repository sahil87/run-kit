package tmux

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"
)

// TestMain pre-sweeps dead-PID test sockets before any test runs, self-healing
// residue from a prior `go test` that was SIGKILLed / panicked / OOMed before
// its t.Cleanup(kill-server) could fire. The PID is embedded as the second
// hyphen field of the helper-generated names (rk-test-<pid>-<ns>,
// rk-relay-test-<pid>-<ns>); a socket is reaped only when that PID parses AND is
// dead, so a concurrently running `go test` (live PID) and the fixed-name shared
// sockets (rk-daemon-test, rk-tmuxctl-test, which have no parseable PID) are
// never touched.
func TestMain(m *testing.M) {
	sweepDeadTestSockets()
	os.Exit(m.Run())
}

// testSocketPrefixes are the PID-embedding socket-name prefixes the pre-sweep
// targets. The PID immediately follows the prefix. Fixed-name sockets
// (rk-daemon-test, rk-tmuxctl-test) intentionally match neither.
var testSocketPrefixes = []string{"rk-relay-test-", "rk-test-"}

// parseTestSocketPID extracts the embedded PID from a test socket name of the
// form rk-test-<pid>-<ns> or rk-relay-test-<pid>-<ns>. It returns ok=false for
// any name that does not carry a parseable PID after a known prefix — including
// the fixed-name shared sockets rk-daemon-test / rk-tmuxctl-test, and any
// foreign or malformed name. rk-relay-test- is checked before rk-test- only for
// clarity; the two prefixes are disjoint (rk-test- never prefixes rk-relay-*).
func parseTestSocketPID(name string) (int, bool) {
	for _, prefix := range testSocketPrefixes {
		rest, found := strings.CutPrefix(name, prefix)
		if !found {
			continue
		}
		// The PID is the leading hyphen-delimited field of the remainder.
		pidField, _, _ := strings.Cut(rest, "-")
		pid, err := strconv.Atoi(pidField)
		if err != nil {
			return 0, false
		}
		return pid, true
	}
	return 0, false
}

// testPIDAlive mirrors cmd/rk/serve_sweep.go:pidAlive — biased toward "alive" on
// any non-ESRCH ambiguity (EPERM, etc.) so the pre-sweep leaks rather than
// reaps a socket whose owner may still be running. Duplicated here (small,
// test-only) rather than exporting test-scoped logic from production code.
func testPIDAlive(pid int) bool {
	err := syscall.Kill(pid, 0)
	if err == nil {
		return true
	}
	return !errors.Is(err, syscall.ESRCH)
}

// sweepDeadTestSockets enumerates /tmp/tmux-<uid>/ and kill-servers every
// rk-test-* / rk-relay-test-* socket whose embedded PID is parseable AND dead.
// Best-effort: enumeration or kill failures are ignored — a leaked socket is
// harmless residue, and never blocking tests is the priority.
func sweepDeadTestSockets() {
	socketDir := "/tmp/tmux-" + strconv.Itoa(os.Getuid())
	entries, err := os.ReadDir(socketDir)
	if err != nil {
		return
	}
	for _, e := range entries {
		name := e.Name()
		pid, ok := parseTestSocketPID(name)
		if !ok || testPIDAlive(pid) {
			continue
		}
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		_ = exec.CommandContext(ctx, "tmux", "-L", name, "kill-server").Run()
		cancel()
	}
}
