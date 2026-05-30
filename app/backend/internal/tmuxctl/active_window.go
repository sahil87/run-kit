package tmuxctl

import "sync"

// ActiveWindowTracker is a concurrency-safe, in-memory store of the last-active
// window id (`@wid`) per tmux session group for a SINGLE tmux server. One
// instance is owned by each Client; the Client's read-loop goroutine is the
// sole writer, while the SSE/REST fetch path reads via Snapshot/Get.
//
// It holds two maps guarded by one RWMutex:
//
//   - byGroup: session-group name → last-active `@wid`. Written from
//     `%session-window-changed` (latest-event-wins) and re-seeded on connect.
//   - sidGroup: tmux session id (`$sid`) → its session-group name. Used to
//     resolve the `$sid` carried by `%session-window-changed` to a group in
//     O(1), refreshed wholesale on `%sessions-changed` and on connect.
//
// The tracker is in-memory only — it mirrors kernel-observable tmux state and
// introduces no database, file, or ORM (Constitution §II). Reads MUST NOT
// block the read loop and the read loop's writes MUST NOT block SSE reads;
// both are bounded map operations under a short-lived lock.
type ActiveWindowTracker struct {
	mu       sync.RWMutex
	byGroup  map[string]string // group name → active @wid
	sidGroup map[string]string // $sid → group name
}

// NewActiveWindowTracker returns an empty tracker ready for concurrent use.
func NewActiveWindowTracker() *ActiveWindowTracker {
	return &ActiveWindowTracker{
		byGroup:  map[string]string{},
		sidGroup: map[string]string{},
	}
}

// Set records wid as the active window for group, overwriting any prior value
// (latest-event-wins). An empty group or wid is ignored.
func (t *ActiveWindowTracker) Set(group, wid string) {
	if group == "" || wid == "" {
		return
	}
	t.mu.Lock()
	t.byGroup[group] = wid
	t.mu.Unlock()
}

// Get returns the tracked active `@wid` for group and whether an entry exists.
func (t *ActiveWindowTracker) Get(group string) (string, bool) {
	t.mu.RLock()
	wid, ok := t.byGroup[group]
	t.mu.RUnlock()
	return wid, ok
}

// SetSidGroup records the group that the session id sid belongs to. An empty
// sid or group is ignored.
func (t *ActiveWindowTracker) SetSidGroup(sid, group string) {
	if sid == "" || group == "" {
		return
	}
	t.mu.Lock()
	t.sidGroup[sid] = group
	t.mu.Unlock()
}

// ResolveGroup returns the group for the given session id and whether it is
// known. A miss is the normal case for a session newer than the last
// %sessions-changed refresh; callers MUST tolerate it without erroring.
func (t *ActiveWindowTracker) ResolveGroup(sid string) (string, bool) {
	t.mu.RLock()
	group, ok := t.sidGroup[sid]
	t.mu.RUnlock()
	return group, ok
}

// ReplaceSidGroups atomically replaces the entire `$sid`→group map. Used on
// %sessions-changed and on connect to refresh the resolution map in one shot.
// A nil map clears the table. The supplied map is copied so the caller may
// retain or mutate it afterwards.
func (t *ActiveWindowTracker) ReplaceSidGroups(m map[string]string) {
	next := make(map[string]string, len(m))
	for sid, group := range m {
		next[sid] = group
	}
	t.mu.Lock()
	t.sidGroup = next
	t.mu.Unlock()
}

// SeedGroups atomically replaces the group→`@wid` map with the supplied seed.
// Used on connect to re-seed Tier 1 from a live `list-windows` query so the
// tracker holds the genuinely-active window before the first event arrives. A
// nil map clears the table. The supplied map is copied.
func (t *ActiveWindowTracker) SeedGroups(m map[string]string) {
	next := make(map[string]string, len(m))
	for group, wid := range m {
		if group == "" || wid == "" {
			continue
		}
		next[group] = wid
	}
	t.mu.Lock()
	t.byGroup = next
	t.mu.Unlock()
}

// Snapshot returns a copy of the group→`@wid` map for the read path, decoupled
// from the live map so the caller can iterate without holding the lock.
func (t *ActiveWindowTracker) Snapshot() map[string]string {
	t.mu.RLock()
	out := make(map[string]string, len(t.byGroup))
	for group, wid := range t.byGroup {
		out[group] = wid
	}
	t.mu.RUnlock()
	return out
}
