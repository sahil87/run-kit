package tmux

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
)

// productionDaemonServer is the tmux server name of the live production daemon
// (mirrors internal/daemon.ServerSocket). The reaper hard-skips it
// unconditionally — even under an explicit --prefix --force — so a broad or
// mistyped prefix can never take down production. Kept as a local literal
// rather than importing internal/daemon: there is no existing import edge
// between internal/tmux and internal/daemon, and the reaper only needs the
// name to refuse it.
const productionDaemonServer = "rk-daemon"

// minSafePrefixLen is the shortest prefix the reaper will act on without
// --force. An empty prefix or one of length <= 3 (e.g. "rk-") matches nearly
// everything (runkit, runWork, production) and is almost always a typo.
const minSafePrefixLen = 3

// ReapAction is the single action the reaper takes for one socket-dir
// candidate. It is exported so the thin cobra command can label dry-run
// plan entries without re-deriving the classification.
type ReapAction int

const (
	// ReapActionSkip leaves the candidate untouched. Under the brute-force
	// reaper this is only the unconditional skips (_rk-ctl control anchor,
	// live rk-daemon production server) and any name that does not match the
	// operator's prefix.
	ReapActionSkip ReapAction = iota
	// ReapActionKill kills a live matched tmux server via KillServer.
	ReapActionKill
	// ReapActionRemove removes a matched socket or *.lock file via os.Remove.
	ReapActionRemove
)

// classifyReap decides what the brute-force reaper does with a single
// socket-dir candidate, given the operator-supplied prefix.
//
// It is a PURE function — no I/O, no real tmux, no liveness probe — so the
// full classification matrix is unit-testable without spawning servers. The
// thin I/O routine (reapCandidates) executes the returned action.
//
// Unlike the prior PID-probing classifier, this version reasons by NAME and
// FILE KIND only:
//   - name is the _rk-ctl control anchor, or the live rk-daemon production
//     server → skip UNCONDITIONALLY (even when it matches the prefix). The
//     dry-run default alone is not sufficient protection for production.
//   - name does not start with prefix → skip.
//   - name matches AND ends in LockSocketSuffix (a regular .lock file) →
//     remove (no .lock-inherits-base-server reasoning anymore).
//   - name matches AND its server is live → kill.
//   - name matches AND its server is a dead socket → remove.
//
// The live/dead distinction is the ONLY thing that requires touching the
// outside world, and it is supplied by the caller (serverLive) rather than
// probed here, keeping classifyReap pure.
func classifyReap(name, prefix string, serverLive bool) ReapAction {
	if name == ControlAnchorSessionName || name == productionDaemonServer {
		return ReapActionSkip
	}
	if !strings.HasPrefix(name, prefix) {
		return ReapActionSkip
	}
	if strings.HasSuffix(name, LockSocketSuffix) {
		return ReapActionRemove
	}
	if serverLive {
		return ReapActionKill
	}
	return ReapActionRemove
}

// ReapPlanEntry pairs a candidate name with the action the reaper would take.
// Used to populate ReapResult.DryRunPlan so the command can print a preview.
type ReapPlanEntry struct {
	Name   string
	Action ReapAction
}

// ReapResult summarizes a reaper run.
//
//   - Killed         — names of live matched servers that were killed.
//   - RemovedSockets — names of dead sockets and *.lock files removed.
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
// It is brute-force-by-prefix: every socket, *.lock file, and live server whose
// name starts with prefix is matched. There is NO liveness probe used to decide
// match (live servers are killed, dead sockets removed), NO e2e exclusion, and
// NO .lock-inherits-base-server reasoning. The operator who runs it asserts
// nothing live needs the matched sockets — see the command's Long help for the
// operating contract (do not run while tests are in progress).
//
// Bare `rk reaper` passes prefix="rk-test". The _rk-ctl anchor and the live
// rk-daemon production server are hard-skipped unconditionally.
//
// Two independent gates control behavior:
//   - act: when false (the default), the matched actions are recorded in
//     DryRunPlan and nothing is touched (dry-run preview); when true, matched
//     servers/sockets are actually reaped. Set by --yes or --force.
//   - force: bypasses the dangerous-prefix guard (empty or length <= 3). Set
//     ONLY by --force. --yes acts but does NOT bypass the guard, so a short
//     or mistyped prefix is still refused under --yes alone.
//
// The dangerous-prefix guard (empty or length <= 3) refuses unless force is
// true — and it refuses regardless of act, so a dry-run with a dangerous prefix
// also reports the refusal rather than previewing a near-everything match.
//
// Per-entry failures are logged via slog and skipped — a single failure MUST
// NOT abort the sweep. An aggregate error describing the failed entries is
// returned at the end (nil when every entry succeeded).
func ReapTestServers(ctx context.Context, prefix string, act, force bool) (ReapResult, error) {
	if len(prefix) <= minSafePrefixLen && !force {
		return ReapResult{}, fmt.Errorf(
			"refusing prefix %q: empty or <= %d chars matches nearly everything (runkit, production); pass --force to override",
			prefix, minSafePrefixLen)
	}
	candidates, err := ScanSocketDir(ctx)
	if err != nil {
		return ReapResult{}, fmt.Errorf("scan socket dir: %w", err)
	}
	return reapCandidates(ctx, socketDirPath(), prefix, candidates, probeServerAlive, act)
}

// reapCandidates is the I/O-performing core of the reaper, split out from
// ReapTestServers so tests can drive it against a temp dir with a fake prober
// (no real tmux server required). It classifies each candidate against prefix,
// then executes the action unless act is false (dry-run preview).
func reapCandidates(
	ctx context.Context,
	dir string,
	prefix string,
	candidates []string,
	probe func(ctx context.Context, name string) bool,
	act bool,
) (ReapResult, error) {
	var result ReapResult
	var errs []string

	for _, name := range candidates {
		// A liveness probe is only needed to decide kill (live server) vs
		// remove (dead socket) for a matched, non-.lock candidate. Skip the
		// (subprocess-spawning) probe for unmatched names, the unconditional
		// skips, and .lock files — classifyReap ignores serverLive for those.
		var serverLive bool
		if probeNeeded(name, prefix) {
			serverLive = probe(ctx, name)
		}
		action := classifyReap(name, prefix, serverLive)
		if action == ReapActionSkip {
			continue
		}

		if !act {
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

// probeNeeded reports whether reapCandidates must probe a candidate's liveness
// to classify it. Only a matched, non-.lock candidate that is not one of the
// unconditional skips needs the probe (live → kill vs. dead → remove); every
// other candidate is decided by name alone. Kept in lock-step with
// classifyReap so the probe (a tmux subprocess) is skipped for names whose
// action does not depend on it.
func probeNeeded(name, prefix string) bool {
	if name == ControlAnchorSessionName || name == productionDaemonServer {
		return false
	}
	if !strings.HasPrefix(name, prefix) {
		return false
	}
	return !strings.HasSuffix(name, LockSocketSuffix)
}
