package cron

import (
	"errors"
	"io/fs"
	"os"
	"sort"
	"strings"
	"time"

	"gopkg.in/yaml.v3"

	"rk/internal/fsatomic"
)

// wake.go — the `wake_on` poll approximation (R7). A wake_on:
// agent-state-change entry fires when the server-scoped agent-state
// fingerprint differs from the entry's previous observation, debounced per
// entry so a burst coalesces into at most one fire.
//
// The observation lives in a per-server cursor sidecar (<slug>.cursor.yaml) —
// seed-cache class per Constitution II: never authoritative, corrupt/absent
// degrades to a cold start (no edge fire that tick, cursor rewritten), at
// worst one missed or duplicate edge, which tick idempotency absorbs. Per-entry
// debounce means the cursor is keyed by entry id: one entry's fire must not
// advance (and thereby swallow) another entry's pending edge.

// WakeObservation is one entry's last-observed fingerprint and when that
// fingerprint value was first recorded.
type WakeObservation struct {
	Fingerprint string `yaml:"fingerprint"`
	ObservedAt  int64  `yaml:"observed_at"`
}

// WakeCursor is the per-server cursor file's content.
type WakeCursor struct {
	Entries map[string]WakeObservation `yaml:"entries,omitempty"`
}

// clone deep-copies the cursor map so evaluation never mutates its input.
func (c WakeCursor) clone() WakeCursor {
	out := WakeCursor{Entries: map[string]WakeObservation{}}
	for k, v := range c.Entries {
		out.Entries[k] = v
	}
	return out
}

// Fingerprint renders the server-scoped agent-state map (pane id → state) as a
// canonical string. Map order never leaks in (sorted), so equal states always
// fingerprint equal.
func Fingerprint(states map[string]string) string {
	keys := make([]string, 0, len(states))
	for pane, state := range states {
		if state == "" {
			continue
		}
		keys = append(keys, pane)
	}
	sort.Strings(keys)
	var b strings.Builder
	for _, pane := range keys {
		b.WriteString(pane)
		b.WriteByte('=')
		b.WriteString(states[pane])
		b.WriteByte('\n')
	}
	return b.String()
}

// wakeEdge applies the delta-vs-cursor rule for one wake_on entry.
//
//   - no prior observation (cold start): no edge; seed the cursor.
//   - fingerprint unchanged: no edge; keep the observation.
//   - changed, observation older than debounce: fire; the cursor advances.
//   - changed but younger than debounce: HOLD (no fire) and keep the old
//     observation — the edge stays pending and a burst coalesces into at most
//     one fire. (The poll cannot date the change itself, only bound it to
//     after the observation; holding while now−observed_at < debounce is the
//     conservative debounce.)
//
// Returns the edge, the entry's next observation, and a diagnostic reason
// ("", "wake-cold-start", or "wake-debounced").
func wakeEdge(debounce time.Duration, fp string, obs WakeObservation, hasObs bool, now time.Time) (edge bool, next WakeObservation, diag string) {
	if !hasObs {
		return false, WakeObservation{Fingerprint: fp, ObservedAt: now.Unix()}, "wake-cold-start"
	}
	if obs.Fingerprint == fp {
		return false, obs, ""
	}
	if now.Sub(time.Unix(obs.ObservedAt, 0)) < debounce {
		return false, obs, "wake-debounced"
	}
	return true, WakeObservation{Fingerprint: fp, ObservedAt: now.Unix()}, ""
}

// ReadWakeCursor reads the cursor tolerantly: absent or corrupt ⇒ cold start
// (zero cursor, false).
func ReadWakeCursor(path string) (WakeCursor, bool) {
	data, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return WakeCursor{}, false
		}
		return WakeCursor{}, false
	}
	var c WakeCursor
	if err := yaml.Unmarshal(data, &c); err != nil {
		return WakeCursor{}, false
	}
	if len(c.Entries) == 0 {
		return WakeCursor{}, false
	}
	return c, true
}

// WriteWakeCursor persists the cursor atomically.
func WriteWakeCursor(path string, c WakeCursor) error {
	out, err := yaml.Marshal(c)
	if err != nil {
		return err
	}
	return fsatomic.WriteFile(path, out, fileMode)
}
