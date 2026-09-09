package cron

import (
	"context"
	"fmt"
	"os/exec"
	"strings"
	"time"
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
// detail (the "respawn-failed: <detail>" log suffix).
func respawnDetail(err error, output []byte) string {
	tail := strings.TrimSpace(string(output))
	if len(tail) > respawnOutputTailBytes {
		tail = "…" + tail[len(tail)-respawnOutputTailBytes:]
	}
	if tail == "" {
		return fmt.Sprintf("%v", err)
	}
	return fmt.Sprintf("%v: %s", err, tail)
}
