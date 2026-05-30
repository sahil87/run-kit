package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"syscall"

	"rk/internal/tmux"
)

// pidAlive reports whether pid names a live process, biased toward "alive" on
// any ambiguity so the sweep leaks rather than wrongly kills (leak-not-kill).
// syscall.Kill(pid, 0) is the canonical liveness probe:
//   - nil   → process exists and is signalable → alive (spare)
//   - ESRCH → no such process → dead (reap)
//   - EPERM → process exists but owned by another user → alive (spare)
//   - other → ambiguous → alive (spare)
//
// A non-positive pid is treated as dead (reap): a real owner is always a
// concrete os.Getpid() (≥ 1), so 0 or negative is a malformed/invalid stamp.
// This guard is also necessary for correctness — syscall.Kill(0, 0) and
// negative pids target a process group, not a single process, and would
// otherwise return nil and be misread as a live owner that is spared forever.
//
// This deliberately differs from daemon_portowner.go:processAlive (which treats
// EPERM as dead): that predicate guards a forceful SIGTERM/SIGKILL where erring
// toward "dead" is safe, whereas here erring toward "alive" avoids reaping a
// live instance's relay. The single-uid socket model (ListServers scans only
// /tmp/tmux-<uid>/) means EPERM is not an expected owner state; sparing it is
// the benign-leak direction (see spec Requirement: pidAlive ownership semantics).
func pidAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	err := syscall.Kill(pid, 0)
	if err == nil {
		return true
	}
	return !errors.Is(err, syscall.ESRCH)
}

// relayOwnerIsDead reports whether a relay's @rk_owner_pid value identifies an
// owner that is gone — i.e. the relay is reapable. An empty owner is a legacy/
// unstamped or crashed-predecessor orphan (reap). A non-integer owner is
// malformed and treated as an orphan (reap) defensively. Otherwise the relay is
// reaped only when its owner PID is not alive. A live owner spares the relay.
func relayOwnerIsDead(owner string) bool {
	if owner == "" {
		return true
	}
	pid, err := strconv.Atoi(owner)
	if err != nil {
		return true
	}
	return !pidAlive(pid)
}

// sweepOrphanedRelaySessions reaps rk-relay-* sessions whose owning rk serve
// instance is gone, across every known tmux server. Runs synchronously at
// startup before HTTP listeners bind to eliminate races with new relays.
//
// Each relay is stamped at creation with @rk_owner_pid (the owning rk serve
// PID). The sweep reads that option and reaps a relay only when the owner is
// absent (unstamped/legacy) or dead — a live sibling's relays (e2e backend, an
// air rebuild, a second instance) are spared so their open terminals survive.
//
// Read scope is unchanged: ListServers still scans every socket so the UI keeps
// seeing foreign servers (rk-e2e-*). Only the destructive reap is scoped, by PID
// ownership.
//
// Per-server failures (list, owner-read, or kill) are logged and accumulated —
// they MUST NOT abort the sweep or block server startup. The caller
// (serveCmd.RunE) MAY log the aggregate error but SHALL continue startup either
// way.
//
// Uses ListRawSessionNames (not the filtered ListSessions) because the user-
// facing filter would hide the ephemerals we are trying to reap.
func sweepOrphanedRelaySessions(ctx context.Context) error {
	servers, err := tmux.ListServers(ctx)
	if err != nil {
		slog.Error("relay sweep: list servers failed", "err", err)
		return fmt.Errorf("list servers: %w", err)
	}
	var perServerErrs []string
	killed := 0
	for _, server := range servers {
		names, err := tmux.ListRawSessionNames(ctx, server)
		if err != nil {
			slog.Warn("relay sweep: list sessions failed", "server", server, "err", err)
			perServerErrs = append(perServerErrs, fmt.Sprintf("%s: %v", server, err))
			continue
		}
		for _, name := range names {
			if !strings.HasPrefix(name, tmux.RelaySessionPrefix) {
				continue
			}
			// Defense-in-depth: the tmuxctl anchor `_rk-ctl` is not prefixed
			// with `rk-relay-`, so the check above already excludes it. The
			// explicit guard below documents that the anchor is owned by
			// tmuxctl and must NEVER be reaped here even if naming changes.
			if name == tmux.ControlAnchorSessionName {
				continue
			}
			// Owner-PID scoping: spare relays whose owning rk serve is alive.
			owner, err := tmux.GetSessionOwnerPID(ctx, server, name)
			if err != nil {
				slog.Warn("relay sweep: owner-pid read failed", "server", server, "session", name, "err", err)
				perServerErrs = append(perServerErrs, fmt.Sprintf("%s/%s: %v", server, name, err))
				continue
			}
			if !relayOwnerIsDead(owner) {
				continue
			}
			if err := tmux.KillSessionCtx(ctx, server, name); err != nil {
				slog.Warn("relay sweep: kill failed", "server", server, "session", name, "err", err)
				perServerErrs = append(perServerErrs, fmt.Sprintf("%s/%s: %v", server, name, err))
				continue
			}
			killed++
		}
	}
	if killed > 0 {
		slog.Info("relay sweep: reaped orphan ephemerals", "count", killed)
	}
	if len(perServerErrs) > 0 {
		return fmt.Errorf("relay sweep partial failures: %s", strings.Join(perServerErrs, "; "))
	}
	return nil
}
