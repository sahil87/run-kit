package tmux

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"
)

// TestMain post-sweeps dead-PID test sockets AFTER all tests run, self-healing
// residue this run leaked when a test was SIGKILLed / panicked / OOMed before
// its t.Cleanup(kill-server) could fire. The pre-sweep was dropped: the manual
// `rk reaper` is the only by-hand cleanup for cross-run SIGKILL residue.
//
// The sweep is PID-scoped: a socket is reaped only when its embedded PID parses
// AND is dead, so a concurrently running `go test ./...` package (a separate
// live process) is never killed.
func TestMain(m *testing.M) {
	code := m.Run()
	sweepDeadTestSockets()
	os.Exit(code)
}

// testSocketName builds a unified test socket name: rk-test-<role>-<pid>-<ns>.
// All test naming sites route through this helper so the format string lives in
// one place. <pid> is os.Getpid() (the live test binary) and <ns> is a
// hyphen-free nanosecond token, so parseTestSocketPID can recover the PID as
// the second-to-last hyphen field regardless of how many hyphens <role> has.
func testSocketName(role string) string {
	return fmt.Sprintf("rk-test-%s-%d-%d", role, os.Getpid(), time.Now().UnixNano())
}

// testSocketPrefix is the single umbrella prefix every test socket carries.
const testSocketPrefix = "rk-test-"

// parseTestSocketPID extracts the embedded PID from a unified test socket name
// of the form rk-test-<role>-<pid>-<ns>, where <role> MAY contain hyphens
// (e2e-multi, e2e-coupling). The PID is the SECOND-TO-LAST hyphen field (the
// one immediately before the hyphen-free <ns>), so parsing is independent of
// the role's segment count.
//
// Returns ok=false when the name lacks the rk-test- prefix, has too few fields
// to carry both a PID and an <ns>, or the second-to-last field is not numeric.
func parseTestSocketPID(name string) (int, bool) {
	if !strings.HasPrefix(name, testSocketPrefix) {
		return 0, false
	}
	fields := strings.Split(name, "-")
	// Need at least: "rk", "test", <role>, <pid>, <ns> → 5 fields. Guarding on
	// len < 2 is the minimum to index len-2; a name like "rk-test" (2 fields,
	// no role/pid/ns) must fail, so require the PID field to be after the
	// prefix segments too.
	if len(fields) < 5 {
		return 0, false
	}
	pid, err := strconv.Atoi(fields[len(fields)-2])
	if err != nil {
		return 0, false
	}
	return pid, true
}

// testPIDAlive mirrors cmd/rk/serve_sweep.go:pidAlive — biased toward "alive" on
// any non-ESRCH ambiguity (EPERM, etc.) so the post-sweep leaks rather than
// reaps a socket whose owner may still be running. Duplicated here (small,
// test-only) rather than exporting test-scoped logic from production code.
// A non-positive pid is treated as dead: a real socket embeds os.Getpid()
// (≥ 1), and syscall.Kill(0, 0) / negative pids target a process group (not a
// single process) and would otherwise be misread as a live owner.
func testPIDAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	err := syscall.Kill(pid, 0)
	if err == nil {
		return true
	}
	return !errors.Is(err, syscall.ESRCH)
}

// sweepDeadTestSockets enumerates /tmp/tmux-<uid>/ and kill-servers every
// rk-test-* socket that this run should reap at TestMain exit:
//
//   - sockets embedding OUR OWN pid (os.Getpid()) — this run is exiting, so its
//     own rk-test-* sockets are now residue. They must be reaped even though our
//     pid is still "alive" while the post-sweep executes; otherwise the
//     post-sweep is a no-op for the very residue it exists to clean (the common
//     single-package / last-package-in-`go test ./...` case).
//   - sockets embedding a DEAD pid — leaked by an earlier crashed run.
//
// A socket whose embedded pid belongs to a DIFFERENT, still-live process (a
// concurrent `go test ./...` package running as its own process) is spared.
// Names without a parseable pid are left untouched. Best-effort: enumeration or
// kill failures are ignored — a leaked socket is harmless residue, and never
// blocking tests is the priority.
//
// Edge: once we exit, our pid may be recycled by a later concurrent run. That
// run's own post-sweep reaps its own residue the same way, so any of ours it
// did not catch is reaped by the manual `rk reaper` (the documented
// last-resort for un-catchable residue).
func sweepDeadTestSockets() {
	self := os.Getpid()
	socketDir := "/tmp/tmux-" + strconv.Itoa(os.Getuid())
	entries, err := os.ReadDir(socketDir)
	if err != nil {
		return
	}
	for _, e := range entries {
		name := e.Name()
		pid, ok := parseTestSocketPID(name)
		if !ok {
			continue
		}
		// Spare only OTHER live processes' sockets. Our own pid is "alive" now
		// but we are exiting, so our sockets are reapable residue.
		if pid != self && testPIDAlive(pid) {
			continue
		}
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		_ = exec.CommandContext(ctx, "tmux", "-L", name, "kill-server").Run()
		cancel()
	}
}
