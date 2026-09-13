package cron

import (
	"context"
	"fmt"
	"os/exec"
	"strings"
	"time"
	"unicode/utf8"
)

// respawn.go — the caller-supplied respawn argv (docs/specs/cron.md § Targets,
// if_absent: respawn). The argv is INTENT carried by the entry file; the tick
// executes it as an argument slice via exec.CommandContext under
// DefaultRespawnTimeout — NEVER a shell string (Constitution I). The command
// owns its own idempotency; a successful respawn never delivers that tick.

// DefaultRespawnTimeout bounds one respawn exec. It must exceed the launched
// agent's own boot + kickoff bound (the cronSessionSpawnTimeout precedent).
const DefaultRespawnTimeout = 90 * time.Second

// respawnOutputTailBytes bounds the captured stdout+stderr tail folded into a
// respawn-failed detail — bounded log lines, enough for a precondition message.
const respawnOutputTailBytes = 200

// RespawnArgv renders the entry's respawn argv for one fire: the exact
// substring {server} in ANY element is replaced with the stamped server name.
// The returned slice is a copy — the entry is never mutated.
func RespawnArgv(e Entry, server string) []string {
	argv := make([]string, len(e.Respawn))
	for i, elem := range e.Respawn {
		argv[i] = strings.ReplaceAll(elem, "{server}", server)
	}
	return argv
}

// RunRespawnFunc is the respawn exec seam: run argv with dir as the working
// directory, returning combined stdout+stderr. Tests inject fakes; a nil
// Deps.RunRespawn selects the production default.
type RunRespawnFunc func(ctx context.Context, argv []string, dir string) ([]byte, error)

// runRespawnExec is the production RunRespawnFunc: an argv-slice
// exec.CommandContext (never a shell string) in the daemon's own environment,
// capturing combined output for the failure detail.
func runRespawnExec(ctx context.Context, argv []string, dir string) ([]byte, error) {
	cmd := exec.CommandContext(ctx, argv[0], argv[1:]...)
	cmd.Dir = dir
	return cmd.CombinedOutput()
}

// respawnDetail folds the error and a ≤200-byte output tail into the failure
// detail (the "respawn-failed: <detail>" log suffix). The cut lands on a rune
// boundary — a byte cut could split a UTF-8 rune and emit an invalid string.
func respawnDetail(err error, output []byte) string {
	tail := strings.TrimSpace(string(output))
	if len(tail) > respawnOutputTailBytes {
		start := len(tail) - respawnOutputTailBytes
		for start < len(tail) && !utf8.RuneStart(tail[start]) {
			start++
		}
		tail = "…" + tail[start:]
	}
	if tail == "" {
		return fmt.Sprintf("%v", err)
	}
	return fmt.Sprintf("%v: %s", err, tail)
}

// kickoffUndeliveredMarker prefixes the stderr line an exit-0 respawn argv
// emits when its kickoff delivery fails; the combined-output capture folds it
// into output.
const kickoffUndeliveredMarker = "kickoff: undelivered reason="

// respawnSuccessOutcome renders the respawn-success log outcome. An exit-0
// respawn can still leave the revived agent unprompted — the argv reports that
// on a kickoffUndeliveredMarker line, and the outcome must carry the reason so
// the log distinguishes a fully-kicked respawn from a silent one. The outcome
// always starts with "respawned": resolvedOutcome and countsTowardRate
// classify respawns on that prefix.
func respawnSuccessOutcome(output []byte) string {
	for line := range strings.Lines(string(output)) {
		if rest, ok := strings.CutPrefix(line, kickoffUndeliveredMarker); ok {
			reason, _, _ := strings.Cut(rest, " ")
			return "respawned (kickoff undelivered: " + reason + ")"
		}
	}
	return "respawned"
}
