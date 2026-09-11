package cron

import (
	"os"
	"sort"
	"strconv"
	"time"

	"gopkg.in/yaml.v3"
)

// watchlist.go — the operator-watchlist reader: the per-item parse of the
// fab-owned operator state file's tracked: list, feeding the sessions
// payload's watchlist join (by pane ID) and the operator staleness timestamp.
//
// EXTERNAL CONTRACT: the file ($XDG_STATE_HOME/fab/operator/<fab-slug>.yaml,
// resolved via FabOperatorStatePath) is fab's schema, read tolerantly: unknown
// keys are ignored, an absent or unparseable file degrades to (nil, 0, false),
// never an error. rk NEVER writes this file.
//
// Primary shape (fab-kit ≥ 2.25, kit migration 2.24.9-to-2.25.0): a top-level
// `tracked:` LIST of items `{id, kind, scope: {pane, repo, session, stage,
// agent, branch, …}, paused, done_at, …}`. An item is a watchlist entry iff
// it carries a string id and a non-empty scope.pane (the join key) and its
// done_at is null: a done-but-unacked item is no longer being watched and
// would otherwise pin a watched row onto a finished or dead pane. paused items
// stay (a probe backoff or user pause is not a removal) and kind is not a
// filter (watched-by-pane is watched, whatever the kind). Malformed items —
// a non-map element, a missing id, a non-map scope — are skipped, never fatal.
//
// Legacy shape (fab-kit ≤ 2.24): a top-level `monitored:` MAP keyed by change
// id. It is read ONLY when the `tracked` key is absent — a one-release dual
// read (fab/backlog.md tracks its retirement). The binary deletes `monitored`
// in the same write that introduces `tracked`, so both-present is residue:
// `tracked` wins by key presence, even as an empty list, so a stale map can
// never resurrect entries after the operator removes the last tracked item.

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

// WatchlistEntry is one watched item: the tracked item's id plus the fields
// the watchlist join needs, lifted from its `scope` block (pane/repo/session/
// stage/agent/branch). fab's other keys (probe, check_every, done_when, then,
// depends_on, last, checked_at, unchanged, failures, added_at, updated_at and
// the scope's stop_stage/spawned_by/merge_mode) are ignored by the tolerant
// read. Kind is the item's `kind` (fab-change, github-pr, shell, …) and is
// "" for a legacy monitored: entry, which carried none; it is not plumbed to
// the sessions payload.
type WatchlistEntry struct {
	ChangeID string // the tracked item id (fab-change: the change ID) / the legacy monitored map's key
	Pane     string // "%N" — the join key onto PaneInfo.PaneID
	Repo     string
	Session  string
	Stage    string
	Agent    string
	Branch   string
	Kind     string
}

// strField extracts a string key from a tolerantly-decoded map ("" for
// missing or non-string values).
func strField(m map[string]any, key string) string {
	s, _ := m[key].(string)
	return s
}

// ParseWatchlist distills the file bytes. ok is false only when the YAML
// itself fails to parse (corrupt). Entries come back sorted by ChangeID so
// the read is deterministic (the list order and the map order are both
// irrelevant to the pane-keyed join). The tracked: list is the primary shape;
// the monitored: map is read only when the tracked key is absent — see the
// file header for the both-present rule.
func ParseWatchlist(data []byte) (entries []WatchlistEntry, lastTickAt int64, ok bool) {
	var raw map[string]any
	if err := yaml.Unmarshal(data, &raw); err != nil {
		return nil, 0, false
	}
	if raw == nil {
		raw = map[string]any{}
	}
	if tracked, present := raw["tracked"]; present {
		entries = parseTrackedItems(tracked)
	} else {
		entries = parseMonitoredMap(raw["monitored"])
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].ChangeID < entries[j].ChangeID })
	return entries, parseTickAt(raw["last_tick_at"]), true
}

// parseTrackedItems is the fab-kit ≥ 2.25 arm: a non-list value yields no
// entries; each element must be a map with a string id, a map scope carrying a
// non-empty pane, and a null done_at (yaml.v3 decodes `done_at: null` to a nil
// interface and a set timestamp to time.Time or string — any non-nil value
// means done). Everything else about the item is ignored.
func parseTrackedItems(v any) []WatchlistEntry {
	items, _ := v.([]any)
	var entries []WatchlistEntry
	for _, el := range items {
		item, _ := el.(map[string]any)
		if item == nil {
			continue
		}
		id := strField(item, "id")
		if id == "" {
			continue
		}
		if item["done_at"] != nil {
			continue
		}
		scope, _ := item["scope"].(map[string]any)
		if scope == nil {
			continue
		}
		pane := strField(scope, "pane")
		if pane == "" {
			continue // nothing to join against (queued fab-change, github-pr, shell, task, note…)
		}
		entries = append(entries, WatchlistEntry{
			ChangeID: id,
			Pane:     pane,
			Repo:     strField(scope, "repo"),
			Session:  strField(scope, "session"),
			Stage:    strField(scope, "stage"),
			Agent:    strField(scope, "agent"),
			Branch:   strField(scope, "branch"),
			Kind:     strField(item, "kind"),
		})
	}
	return entries
}

// parseMonitoredMap is the fab-kit ≤ 2.24 arm (one-release dual read): a
// change-id-keyed map of {pane, repo, session, stage, agent, branch}; a
// non-map value or an entry without a pane yields nothing. Kind stays "" —
// the legacy schema carried none and the reader invents no value.
func parseMonitoredMap(v any) []WatchlistEntry {
	monitored, _ := v.(map[string]any)
	var entries []WatchlistEntry
	for key, mv := range monitored {
		m, _ := mv.(map[string]any)
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
	return entries
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
