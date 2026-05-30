package tmux

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
)

// ReapAction is the single action the reaper takes for one socket-dir
// candidate. It is exported so the thin cobra command can label dry-run
// plan entries without re-deriving the classification.
type ReapAction int

const (
	// ReapActionSkip leaves the candidate untouched (live non-test servers,
	// the _rk-ctl control anchor, rk-e2e-* sockets — anything not matched by
	// IsGoTestServerName, and any matched-but-protected name).
	ReapActionSkip ReapAction = iota
	// ReapActionKill kills the live orphan test server via KillServer.
	ReapActionKill
	// ReapActionRemove removes the stale socket file via os.Remove (dead test
	// sockets and stale *.lock files).
	ReapActionRemove
)

// classifyReap decides what the reaper should do with a single socket-dir
// candidate, given its name and whether its probe succeeded (daemon alive).
//
// It is a PURE function — no I/O, no real tmux — so the full classification
// matrix is unit-testable without spawning servers. The thin I/O routine
// (reapCandidates) executes the returned action.
//
// Rules (checked in this order):
//   - name ends in ".lock"                       → removeSocket (lock files
//     carry no test prefix, so they need an explicit branch)
//   - name == ControlAnchorSessionName (_rk-ctl)  → skip (owned by tmuxctl)
//   - IsGoTestServerName(name) && probeAlive      → kill (live orphan test server)
//   - IsGoTestServerName(name) && !probeAlive     → removeSocket (dead test socket)
//   - otherwise                                   → skip (live/dead non-test
//     servers, including rk-e2e-* which IsGoTestServerName already excludes)
func classifyReap(name string, probeAlive bool) ReapAction {
	if strings.HasSuffix(name, ".lock") {
		return ReapActionRemove
	}
	if name == ControlAnchorSessionName {
		return ReapActionSkip
	}
	if IsGoTestServerName(name) {
		if probeAlive {
			return ReapActionKill
		}
		return ReapActionRemove
	}
	return ReapActionSkip
}

// ReapPlanEntry pairs a candidate name with the action the reaper would take.
// Used to populate ReapResult.DryRunPlan so the command can print a preview.
type ReapPlanEntry struct {
	Name   string
	Action ReapAction
}

// ReapResult summarizes a reaper run.
//
//   - Killed         — names of live orphan test servers that were killed.
//   - RemovedSockets — names of dead test sockets and *.lock files removed.
//   - DryRunPlan     — populated only on a dry-run: every classified candidate
//     that would be acted on (kill or remove), so the caller can preview.
type ReapResult struct {
	Killed         []string
	RemovedSockets []string
	DryRunPlan     []ReapPlanEntry
}

// ReapTestServers is the operator-invoked janitor for leaked test tmux servers
// and stale sockets in the tmux socket directory (/tmp/tmux-{uid}/).
//
// It enumerates RAW socket-dir candidates via ScanSocketDir (NOT ListServers,
// which silently drops dead sockets — exactly the leak shape we must reap),
// probes each for liveness, classifies it via classifyReap, and — unless
// dryRun is set — performs the action: KillServer for live orphan test
// servers, os.Remove for dead test sockets and *.lock files.
//
// Per-entry failures are logged via slog and skipped — a single failure MUST
// NOT abort the sweep. An aggregate error describing the failed entries is
// returned at the end (nil when every entry succeeded), mirroring
// sweepOrphanedRelaySessions.
func ReapTestServers(ctx context.Context, dryRun bool) (ReapResult, error) {
	candidates, err := ScanSocketDir(ctx)
	if err != nil {
		return ReapResult{}, fmt.Errorf("scan socket dir: %w", err)
	}
	return reapCandidates(ctx, socketDirPath(), candidates, probeServerAlive, dryRun)
}

// reapCandidates is the I/O-performing core of the reaper, split out from
// ReapTestServers so tests can drive it against a temp dir with a fake prober
// (no real tmux server required). It probes and classifies each candidate,
// then executes the action unless dryRun is set.
func reapCandidates(
	ctx context.Context,
	dir string,
	candidates []string,
	probe func(ctx context.Context, name string) bool,
	dryRun bool,
) (ReapResult, error) {
	var result ReapResult
	var errs []string

	for _, name := range candidates {
		action := classifyReap(name, probe(ctx, name))
		if action == ReapActionSkip {
			continue
		}

		if dryRun {
			result.DryRunPlan = append(result.DryRunPlan, ReapPlanEntry{Name: name, Action: action})
			continue
		}

		switch action {
		case ReapActionKill:
			if err := KillServer(name); err != nil {
				slog.Warn("reaper: kill failed", "server", name, "err", err)
				errs = append(errs, fmt.Sprintf("kill %s: %v", name, err))
				continue
			}
			result.Killed = append(result.Killed, name)
		case ReapActionRemove:
			path := filepath.Join(dir, name)
			if err := os.Remove(path); err != nil {
				slog.Warn("reaper: remove failed", "socket", path, "err", err)
				errs = append(errs, fmt.Sprintf("remove %s: %v", name, err))
				continue
			}
			result.RemovedSockets = append(result.RemovedSockets, name)
		}
	}

	if len(errs) > 0 {
		return result, fmt.Errorf("reaper partial failures: %s", strings.Join(errs, "; "))
	}
	return result, nil
}
