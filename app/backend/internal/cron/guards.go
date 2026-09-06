package cron

import (
	"errors"
	"io/fs"
	"os"
	"strconv"
	"time"

	"gopkg.in/yaml.v3"
)

// guards.go — the `suppress_while` guards (R8). Guards are evaluated at fire
// time; while any holds, the fire is skipped silently (a suppression
// diagnostic, never an error, never a recorded miss).
//
// EXTERNAL CONTRACT: both guards read the fab-owned operator state file
// ($XDG_STATE_HOME/fab/operator/<server-slug>.yaml). That schema is fab's —
// the same tolerant-read class as the .status.yaml and .fab-dispatch/ reads:
// unknown keys are ignored, and an absent or unparseable file degrades to the
// cold posture: operator-loop-fresh does NOT hold (no fresh stamp exists),
// nothing-tracked DOES hold (nothing is tracked).

// DefaultOperatorLoopFreshThreshold is the default freshness window for the
// operator-loop-fresh guard: above the in-session loop's short-cadence ticks,
// below the operator tick's backoff min×2. C4 tunes the seeded value.
const DefaultOperatorLoopFreshThreshold = 120 * time.Second

// OperatorState is the tolerant distillation of the fab operator state file.
type OperatorState struct {
	// Present is true when the file existed and parsed (possibly empty).
	Present bool
	// LastTickAt is the file's last_tick_at (unix seconds; 0 = none/unknown).
	LastTickAt int64
	// TrackedCount is the size of monitored + watches + autopilot.
	TrackedCount int
}

// trackedLen counts the entries of a monitored/watches/autopilot value of
// unknown shape: lists and maps by length, a present scalar as 1 (unknown
// shape ⇒ conservatively tracked), nil as 0.
func trackedLen(v any) int {
	switch t := v.(type) {
	case nil:
		return 0
	case []any:
		return len(t)
	case map[string]any:
		return len(t)
	default:
		return 1
	}
}

// parseTickAt accepts unix seconds (number or string) or an RFC3339 string.
func parseTickAt(v any) int64 {
	switch t := v.(type) {
	case int:
		return int64(t)
	case int64:
		return t
	case float64:
		return int64(t)
	case string:
		if n, err := strconv.ParseInt(t, 10, 64); err == nil {
			return n
		}
		if ts, err := time.Parse(time.RFC3339, t); err == nil {
			return ts.Unix()
		}
	case time.Time:
		// yaml.v3 decodes ISO-8601 timestamps to time.Time on its own.
		return t.Unix()
	}
	return 0
}

// ParseOperatorState distills the file bytes. ok is false only when the YAML
// itself fails to parse (corrupt).
func ParseOperatorState(data []byte) (OperatorState, bool) {
	var raw map[string]any
	if err := yaml.Unmarshal(data, &raw); err != nil {
		return OperatorState{}, false
	}
	if raw == nil {
		raw = map[string]any{}
	}
	return OperatorState{
		Present:      true,
		LastTickAt:   parseTickAt(raw["last_tick_at"]),
		TrackedCount: trackedLen(raw["monitored"]) + trackedLen(raw["watches"]) + trackedLen(raw["autopilot"]),
	}, true
}

// ReadOperatorState reads the fab operator state file tolerantly: absent or
// corrupt ⇒ zero state (Present false), never an error.
func ReadOperatorState(path string) OperatorState {
	data, err := os.ReadFile(path)
	if err != nil {
		if !errors.Is(err, fs.ErrNotExist) {
			return OperatorState{}
		}
		return OperatorState{}
	}
	st, ok := ParseOperatorState(data)
	if !ok {
		return OperatorState{}
	}
	return st
}

// guardHolds evaluates one named guard. known is false for an unrecognized
// guard name — an unknown guard never holds and the evaluator emits a
// diagnostic for it.
func guardHolds(name string, st OperatorState, now time.Time, freshThreshold time.Duration) (holds, known bool) {
	switch name {
	case GuardOperatorLoopFresh:
		return st.Present && st.LastTickAt > 0 &&
			now.Unix()-st.LastTickAt <= int64(freshThreshold/time.Second), true
	case GuardNothingTracked:
		return st.TrackedCount == 0, true
	default:
		return false, false
	}
}
