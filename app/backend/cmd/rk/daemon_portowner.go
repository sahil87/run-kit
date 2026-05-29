package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"
)

// portOwnerCmdTimeout bounds every lsof/ss/ps subprocess invocation per
// Constitution §I (Process Execution: 5-10s for short-lived helpers).
const portOwnerCmdTimeout = 5 * time.Second

// terminateOwnerPollInterval is how often terminateOwner re-checks whether the
// targeted PID has exited after SIGTERM.
const terminateOwnerPollInterval = 200 * time.Millisecond

// terminateOwnerGracePeriod is how long terminateOwner waits for graceful exit
// after SIGTERM before escalating to SIGKILL.
const terminateOwnerGracePeriod = 5 * time.Second

// PortOwner describes a process listening on a TCP port.
type PortOwner struct {
	PID     int
	Command string // basename of the executable (e.g., "rk", "node")
	Source  string // "lsof" or "ss" — diagnostic, not load-bearing
}

// findPortOwner is the package-level lookup hook used by daemon subcommands.
// Tests substitute it to drive --force paths without spawning lsof/ss.
var findPortOwner = findPortOwnerImpl

// findPortOwnerImpl returns the process listening on the given TCP port, or
// (nil, nil) when no listener is found. The host argument is accepted for
// display/diagnostic purposes only — the underlying queries are port-only
// (both `lsof -ti:<port>` and `ss -tlnp '( sport = :<port> )'` cover loopback
// and wildcard binds without a host filter).
//
// Returns (nil, error) only when both lsof and ss fail (e.g., neither tool is
// on PATH, or both errored unexpectedly).
func findPortOwnerImpl(ctx context.Context, host string, port int) (*PortOwner, error) {
	_ = host // documented as display-only; not used in the lookup
	owner, lsofErr := findPortOwnerLsof(ctx, port)
	if lsofErr == nil {
		return owner, nil
	}
	owner, ssErr := findPortOwnerSS(ctx, port)
	if ssErr == nil {
		return owner, nil
	}
	return nil, fmt.Errorf("port-owner lookup failed: lsof: %v; ss: %v", lsofErr, ssErr)
}

// findPortOwnerLsof runs `lsof -ti:<port>` and returns the first PID listed.
// Returns (nil, nil) when lsof prints no PIDs (nobody listening).
// Returns (nil, error) when lsof is missing, errors with no useful output, or
// stdout cannot be parsed as a PID.
func findPortOwnerLsof(ctx context.Context, port int) (*PortOwner, error) {
	if _, err := exec.LookPath("lsof"); err != nil {
		return nil, fmt.Errorf("lsof not on PATH: %w", err)
	}

	cctx, cancel := context.WithTimeout(ctx, portOwnerCmdTimeout)
	defer cancel()

	cmd := exec.CommandContext(cctx, "lsof", "-ti:"+strconv.Itoa(port))
	out, err := cmd.Output()
	// lsof exits non-zero with empty stdout when nothing matches — treat that
	// as "no holder" rather than an error.
	if err != nil {
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) && len(strings.TrimSpace(string(out))) == 0 {
			return nil, nil
		}
		return nil, fmt.Errorf("lsof failed: %w", err)
	}

	pidStr := strings.TrimSpace(string(out))
	if pidStr == "" {
		return nil, nil
	}
	// lsof may print multiple PIDs (e.g., multi-process listeners). Take the first.
	if i := strings.IndexAny(pidStr, " \n"); i >= 0 {
		pidStr = pidStr[:i]
	}
	pid, err := strconv.Atoi(pidStr)
	if err != nil {
		return nil, fmt.Errorf("parsing lsof PID %q: %w", pidStr, err)
	}

	owner := &PortOwner{PID: pid, Source: "lsof"}
	owner.Command = resolveCommand(cctx, pid)
	return owner, nil
}

// ssUsersPattern extracts pid=N from the ss -tlnp "users:(...,pid=12345,...)" field.
var ssUsersPattern = regexp.MustCompile(`pid=(\d+)`)

// findPortOwnerSS runs `ss -tlnp '( sport = :<port> )'` and parses the
// `users:(...,pid=N,...)` field from stdout. Returns (nil, nil) when no row
// matches; (nil, error) when ss is missing or stdout cannot be parsed.
func findPortOwnerSS(ctx context.Context, port int) (*PortOwner, error) {
	if _, err := exec.LookPath("ss"); err != nil {
		return nil, fmt.Errorf("ss not on PATH: %w", err)
	}

	cctx, cancel := context.WithTimeout(ctx, portOwnerCmdTimeout)
	defer cancel()

	filter := fmt.Sprintf("( sport = :%d )", port)
	cmd := exec.CommandContext(cctx, "ss", "-tlnp", filter)
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("ss failed: %w", err)
	}

	matches := ssUsersPattern.FindSubmatch(out)
	if matches == nil {
		return nil, nil
	}
	pid, err := strconv.Atoi(string(matches[1]))
	if err != nil {
		return nil, fmt.Errorf("parsing ss PID %q: %w", matches[1], err)
	}

	owner := &PortOwner{PID: pid, Source: "ss"}
	owner.Command = resolveCommand(cctx, pid)
	return owner, nil
}

// resolveCommand returns the basename of the executable for the given PID, or
// the empty string on failure. Linux reads `/proc/<pid>/comm`; macOS shells
// out to `ps -p <pid> -o comm=`.
func resolveCommand(ctx context.Context, pid int) string {
	if runtime.GOOS == "linux" {
		data, err := os.ReadFile(fmt.Sprintf("/proc/%d/comm", pid))
		if err != nil {
			return ""
		}
		return strings.TrimSpace(string(data))
	}

	cctx, cancel := context.WithTimeout(ctx, portOwnerCmdTimeout)
	defer cancel()

	out, err := exec.CommandContext(cctx, "ps", "-p", strconv.Itoa(pid), "-o", "comm=").Output()
	if err != nil {
		return ""
	}
	return filepath.Base(strings.TrimSpace(string(out)))
}

// terminateOwner sends SIGTERM to the owner PID and polls for exit up to
// terminateOwnerGracePeriod; if the PID is still alive at the deadline,
// escalates to SIGKILL. Mirrors daemon.Stop's graceful-then-forceful pattern.
// Signal delivery uses syscall.Kill — never a shell `kill` invocation.
func terminateOwner(ctx context.Context, owner *PortOwner) error {
	if owner == nil {
		return nil
	}
	if err := syscall.Kill(owner.PID, syscall.SIGTERM); err != nil {
		return fmt.Errorf("SIGTERM to PID %d: %w", owner.PID, err)
	}

	deadline := time.Now().Add(terminateOwnerGracePeriod)
	for time.Now().Before(deadline) {
		if !processAlive(owner.PID) {
			return nil
		}
		select {
		case <-ctx.Done():
			// Caller cancelled — stop polling but do not escalate.
			return ctx.Err()
		case <-time.After(terminateOwnerPollInterval):
		}
	}

	// Grace period elapsed — escalate.
	if err := syscall.Kill(owner.PID, syscall.SIGKILL); err != nil {
		return fmt.Errorf("SIGKILL to PID %d: %w", owner.PID, err)
	}
	// One final poll for housekeeping; ignore the result.
	time.Sleep(terminateOwnerPollInterval)
	return nil
}

// processAlive reports whether the given PID is still alive. syscall.Kill with
// signal 0 is the canonical liveness probe — returns nil iff the process exists
// and the caller has permission to signal it.
func processAlive(pid int) bool {
	return syscall.Kill(pid, 0) == nil
}
