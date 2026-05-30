package api

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
//
// The sweep logic is duplicated from internal/tmux/main_test.go: Go _test.go
// symbols are package-private and cannot be shared across packages, and the spec
// directs a small duplicated helper over exporting test-only logic from
// production code.
func TestMain(m *testing.M) {
	code := m.Run()
	sweepDeadTestSockets()
	os.Exit(code)
}

// testSocketName builds a unified test socket name: rk-test-<role>-<pid>-<ns>.
// Duplicated from internal/tmux/main_test.go (cross-package test privacy).
func testSocketName(role string) string {
	return fmt.Sprintf("rk-test-%s-%d-%d", role, os.Getpid(), time.Now().UnixNano())
}

// testSocketPrefix is the single umbrella prefix every test socket carries.
const testSocketPrefix = "rk-test-"

// parseTestSocketPID extracts the embedded PID from a unified test socket name
// of the form rk-test-<role>-<pid>-<ns>, where <role> MAY contain hyphens. The
// PID is the SECOND-TO-LAST hyphen field. Returns ok=false for a missing
// prefix, too few fields, or a non-numeric PID field.
func parseTestSocketPID(name string) (int, bool) {
	if !strings.HasPrefix(name, testSocketPrefix) {
		return 0, false
	}
	fields := strings.Split(name, "-")
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
// any non-ESRCH ambiguity so the post-sweep leaks rather than reaps a socket
// whose owner may still be running. A non-positive pid is treated as dead: a
// real socket embeds os.Getpid() (≥ 1), and syscall.Kill(0, 0) / negative pids
// target a process group (not a single process) and would otherwise be misread
// as a live owner.
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
// rk-test-* socket this run should reap at TestMain exit: sockets embedding OUR
// OWN pid (os.Getpid() — we are exiting, so they are residue, even though our
// pid is still "alive" during the post-sweep) and sockets embedding a DEAD pid.
// A socket owned by a DIFFERENT live process (a concurrent `go test ./...`
// package) is spared. PID-scoped, never a blanket rk-test-* wipe. Best-effort:
// enumeration or kill failures ignored.
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
		// Spare only OTHER live processes' sockets; reap our own (we are exiting).
		if pid != self && testPIDAlive(pid) {
			continue
		}
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		_ = exec.CommandContext(ctx, "tmux", "-L", name, "kill-server").Run()
		cancel()
	}
}
