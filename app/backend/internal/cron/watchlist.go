package cron

import (
	"os"
	"sort"
	"strconv"
	"time"

	"gopkg.in/yaml.v3"
)

// watchlist.go — the operator-watchlist reader: the per-entry parse of the
// fab-owned operator state file's monitored: map, feeding the sessions
// payload's watchlist join (by pane ID) and the operator staleness timestamp.
//
// EXTERNAL CONTRACT: the file ($XDG_STATE_HOME/fab/operator/<fab-slug>.yaml,
// resolved via FabOperatorStatePath) is fab's schema, read tolerantly: unknown
// keys are ignored, an absent or unparseable file degrades to (nil, 0, false),
// never an error. A monitored entry missing its pane is skipped (nothing to
// join against) rather than failing the whole read. rk NEVER writes this file.

// DefaultWatchlistStaleThreshold is the UI-facing "is the whole monitoring
// system dead" staleness window over the operator's last_tick_at — a
// product-level display threshold only; nothing in cron gates a fire on it.
const DefaultWatchlistStaleThreshold = 15 * time.Minute

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
