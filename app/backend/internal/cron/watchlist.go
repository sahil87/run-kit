package cron

import (
	"os"
	"sort"
	"time"

	"gopkg.in/yaml.v3"
)

// watchlist.go — the operator-watchlist reader: the per-entry parse of the
// fab-owned operator state file's monitored: map, feeding the sessions
// payload's watchlist join (by pane ID) and the operator staleness timestamp.
//
// EXTERNAL CONTRACT: the file ($XDG_STATE_HOME/fab/operator/<server-slug>.yaml,
// resolved via FabOperatorStatePath) is fab's schema — the same tolerant-read
// class as guards.go's ReadOperatorState: unknown keys are ignored, an absent
// or unparseable file degrades to (nil, 0, false), never an error. A monitored
// entry missing its pane is skipped (nothing to join against) rather than
// failing the whole read. rk NEVER writes this file.

// DefaultWatchlistStaleThreshold is the UI-facing "is the whole monitoring
// system dead" staleness window over the operator's last_tick_at. Distinct
// from DefaultOperatorLoopFreshThreshold — that one gates the short-fuse
// in-session-loop suppress guard; this is the longer product-level number.
const DefaultWatchlistStaleThreshold = 15 * time.Minute

// WatchlistEntry is one monitored change: the map key plus the fields the
// watchlist join needs. The schema mirrors fab-kit's monitoredEntry
// (operator_state.go: pane/repo/session/stage/agent/branch, keyed by an
// opaque change id); fab's extra keys (stop_stage, spawned_by, depends_on,
// enrolled_at, last_transition) are ignored by the tolerant read.
type WatchlistEntry struct {
	ChangeID string // the monitored map's key
	Pane     string // "%N" — the join key onto PaneInfo.PaneID
	Repo     string
	Session  string
	Stage    string
	Agent    string
	Branch   string
}

// strField extracts a string key from a tolerantly-decoded map ("" for
// missing or non-string values).
func strField(m map[string]any, key string) string {
	s, _ := m[key].(string)
	return s
}

// ParseWatchlist distills the file bytes. ok is false only when the YAML
// itself fails to parse (corrupt). Entries come back sorted by ChangeID so
// the read is deterministic; a non-map monitored: shape yields no entries.
func ParseWatchlist(data []byte) (entries []WatchlistEntry, lastTickAt int64, ok bool) {
	var raw map[string]any
	if err := yaml.Unmarshal(data, &raw); err != nil {
		return nil, 0, false
	}
	if raw == nil {
		raw = map[string]any{}
	}
	monitored, _ := raw["monitored"].(map[string]any)
	for key, v := range monitored {
		m, _ := v.(map[string]any)
		if m == nil {
			continue
		}
		pane := strField(m, "pane")
		if pane == "" {
			continue // nothing to join against
		}
		entries = append(entries, WatchlistEntry{
			ChangeID: key,
			Pane:     pane,
			Repo:     strField(m, "repo"),
			Session:  strField(m, "session"),
			Stage:    strField(m, "stage"),
			Agent:    strField(m, "agent"),
			Branch:   strField(m, "branch"),
		})
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].ChangeID < entries[j].ChangeID })
	return entries, parseTickAt(raw["last_tick_at"]), true
}

// ReadWatchlist reads the fab operator state file tolerantly: absent or
// corrupt ⇒ (nil, 0, false), never an error.
func ReadWatchlist(path string) (entries []WatchlistEntry, lastTickAt int64, present bool) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, 0, false
	}
	entries, lastTickAt, ok := ParseWatchlist(data)
	if !ok {
		return nil, 0, false
	}
	return entries, lastTickAt, true
}
