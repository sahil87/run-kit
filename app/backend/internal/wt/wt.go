// Package wt wraps the fab-kit `wt` worktree CLI for host-app operations
// (Constitution III — wrap, don't reinvent). It carries exactly the two calls
// the Open-in-App feature needs:
//
//   - ListApps — `wt open --list --json`, the host-detected app registry.
//     The flag is NEW on the wt side (wt backlog [qj66]) and MUST NOT be
//     assumed to exist at runtime: an absent wt, an older wt (unknown flag),
//     or malformed output all surface as an error the API layer degrades to
//     an empty registry (fail-silent toolkit discipline).
//   - Open — `wt open <path> -a <app>`, the non-interactive launch path that
//     exists in wt today.
//
// All subprocess calls use exec.CommandContext with explicit argument slices
// and their own timeouts (Constitution I / Process Execution) — callers'
// contexts bound the calls further but never extend them.
package wt

import (
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"strings"
	"time"
)

const (
	// ListTimeout bounds `wt open --list --json` — a read-only registry probe.
	ListTimeout = 5 * time.Second
	// OpenTimeout bounds `wt open <path> -a <app>` — a non-interactive app
	// launch (spawn-and-return, not a build-class operation).
	OpenTimeout = 10 * time.Second
)

// App is one host-detected launch target from `wt open --list --json`.
// Kind is advisory (editor|terminal|file-manager today); unknown values pass
// through untouched.
type App struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	Kind  string `json:"kind,omitempty"`
}

// ListApps runs `wt open --list --json` and returns the parsed registry.
// Errors (wt absent, unknown flag on an older wt, non-zero exit, non-JSON
// output) are returned as-is — the API layer owns the fail-silent-to-[]
// degradation so it stays observable and testable there.
func ListApps(parent context.Context) ([]App, error) {
	ctx, cancel := context.WithTimeout(parent, ListTimeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, "wt", "open", "--list", "--json")
	var stderr strings.Builder
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("wt open --list --json: %w: %s", err, strings.TrimSpace(stderr.String()))
	}
	return parseApps(out)
}

// parseApps decodes the registry JSON tolerantly: the payload must be a JSON
// array of objects; each entry requires non-empty `id` and `label` fields
// (entries missing either are skipped, not fatal); unknown fields are ignored
// (forward-compat with whatever wt adds later). Pure — testable without a wt
// invocation.
func parseApps(data []byte) ([]App, error) {
	var raw []App
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, fmt.Errorf("parsing wt app registry: %w", err)
	}
	apps := make([]App, 0, len(raw))
	for _, a := range raw {
		if a.ID == "" || a.Label == "" {
			continue
		}
		apps = append(apps, a)
	}
	return apps, nil
}

// Open runs `wt open <path> -a <app>`, launching the host app on the given
// folder. The caller is responsible for validating path and app BEFORE this
// call (Constitution I — nothing user-supplied reaches exec unchecked); this
// wrapper only shapes the argv and bounds the subprocess.
func Open(parent context.Context, path, app string) error {
	ctx, cancel := context.WithTimeout(parent, OpenTimeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, "wt", "open", path, "-a", app)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("wt open %s -a %s: %w: %s", path, app, err, strings.TrimSpace(string(out)))
	}
	return nil
}
