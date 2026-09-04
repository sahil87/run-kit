package snapshot

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"rk/internal/fsatomic"
)

// ClosedRingCap bounds the per-server recently-closed ring
// ({server}.closed/{unix-nanos}.json); the oldest records beyond it are pruned
// on push. A named constant, not a setting (Constitution IV/VII) — same
// posture as historyRetention/tombstoneRetention.
const ClosedRingCap = 10

// closedSuffix names the per-server recently-closed ring directory. Server
// names are validated to [A-Za-z0-9_-] (no dots), so "<server>.closed" can
// never collide with a server directory — the tombstoneInfix filename-grammar
// argument applied to a directory.
const closedSuffix = ".closed"

// ClosedWindow is one entry on a server's recently-closed stack — a per-window
// recovery backup taken at the kill seam (POST /api/windows/{id}/kill), never
// derivable after: everything reopen needs (the @rk_win_* option set, pane
// cwds, the agent identity) lives only on the window and dies with it.
type ClosedWindow struct {
	ID       string    `json:"id"` // opaque record id (unix-nanos, assigned by the store at push)
	ClosedAt time.Time `json:"closedAt"`
	Server   string    `json:"server"`
	// Session is the owning (non-pin) session at kill time.
	Session string `json:"session"`
	// Window is the full @rk_win_* + panes capture.
	Window Window `json:"window"`
	// AgentProvider / AgentRef are the agent session identity from
	// sessions.ResolveAgentPane's active-pane-first rollup ("" when the window
	// carried no agent pane).
	AgentProvider string `json:"agentProvider,omitempty"`
	AgentRef      string `json:"agentRef,omitempty"`
	// LegacyChatProvider / LegacyChatRef read the previous-generation record
	// keys (chatProvider/chatRef) written before the agentProvider/agentRef
	// key generation; LoadClosed coalesces them into AgentProvider/AgentRef
	// (new keys win) and clears them, so they are never re-written.
	LegacyChatProvider string `json:"chatProvider,omitempty"`
	LegacyChatRef      string `json:"chatRef,omitempty"`
}

// coalesceLegacy folds a pre-rename record's chatProvider/chatRef keys into the
// AgentProvider/AgentRef fields (a present new key wins over the legacy one)
// and clears the legacy fields so a later marshal writes only the new keys.
func (rec *ClosedWindow) coalesceLegacy() {
	if rec.AgentProvider == "" {
		rec.AgentProvider = rec.LegacyChatProvider
	}
	if rec.AgentRef == "" {
		rec.AgentRef = rec.LegacyChatRef
	}
	rec.LegacyChatProvider = ""
	rec.LegacyChatRef = ""
}

// closedDir is the ring's directory under the store root.
func (s *Store) closedDir(server string) string {
	return filepath.Join(s.dir, server+closedSuffix)
}

// validClosedID reports whether id is a bare unix-nanos string — the ring's
// whole filename grammar. Same discipline as the tombstone infix: anything
// else (path separators, dots, non-digits) is rejected before it can address a
// path on disk.
// ValidClosedID reports whether id has the record-id shape (the unix-nanos
// file stem) — the api layer checks it before touching the store so a
// malformed path param is a not-found, never a store fault.
func ValidClosedID(id string) bool { return validClosedID(id) }

func validClosedID(id string) bool {
	if id == "" {
		return false
	}
	for _, r := range id {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

// PushClosed appends rec to its server's ring, assigning the record id
// (unix-nanos) and ClosedAt (now UTC) itself — the filename grammar owner is
// the store, never the caller. Returns the stamped record so the caller can
// report it. Records beyond ClosedRingCap are pruned oldest-first on write
// (same posture as the history/tombstone prunes).
func (s *Store) PushClosed(rec ClosedWindow) (ClosedWindow, error) {
	if rec.Server == "" {
		return rec, fmt.Errorf("closed push: empty server")
	}
	dir := s.closedDir(rec.Server)
	if err := os.MkdirAll(dir, dirMode); err != nil {
		return rec, fmt.Errorf("closed push %s: %w", rec.Server, err)
	}

	now := time.Now().UTC()
	rec.ClosedAt = now
	nanos := now.UnixNano()
	// Same-instant collision guard (the history same-second bump, at nanos
	// resolution): two pushes mapping to one {unix-nanos}.json must not
	// overwrite each other. Bump forward to the next free nanosecond.
	path := filepath.Join(dir, strconv.FormatInt(nanos, 10)+jsonExt)
	for {
		if _, err := os.Lstat(path); err != nil {
			break // free (any other error surfaces on write below)
		}
		nanos++
		path = filepath.Join(dir, strconv.FormatInt(nanos, 10)+jsonExt)
	}
	rec.ID = strconv.FormatInt(nanos, 10)

	data, err := json.MarshalIndent(rec, "", "  ")
	if err != nil {
		return rec, fmt.Errorf("closed push %s: %w", rec.Server, err)
	}
	if err := fsatomic.WriteFile(path, data, fileMode); err != nil {
		return rec, fmt.Errorf("closed push %s: %w", rec.Server, err)
	}
	if err := s.pruneClosed(rec.Server); err != nil {
		return rec, fmt.Errorf("closed prune %s: %w", rec.Server, err)
	}
	return rec, nil
}

// pruneClosed removes the oldest ring entries beyond ClosedRingCap.
func (s *Store) pruneClosed(server string) error {
	ids, err := s.closedIDs(server)
	if err != nil {
		return err
	}
	for len(ids) > ClosedRingCap {
		oldest := ids[0]
		ids = ids[1:]
		if err := os.Remove(filepath.Join(s.closedDir(server), oldest+jsonExt)); err != nil {
			return err
		}
	}
	return nil
}

// closedIDs returns the ring's record ids (the numeric filename stems),
// ascending. A missing ring dir returns an empty slice.
func (s *Store) closedIDs(server string) ([]string, error) {
	entries, err := os.ReadDir(s.closedDir(server))
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	var out []string
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), jsonExt) {
			continue
		}
		stem := strings.TrimSuffix(e.Name(), jsonExt)
		if !validClosedID(stem) {
			continue
		}
		out = append(out, stem)
	}
	// Numeric order, not lexical: ids are unix-nanos of uniform width in
	// practice, but the grammar only promises digits.
	sort.Slice(out, func(i, j int) bool {
		a, _ := strconv.ParseInt(out[i], 10, 64)
		b, _ := strconv.ParseInt(out[j], 10, 64)
		return a < b
	})
	return out, nil
}

// ListClosed returns the server's recently-closed records newest-first. A
// missing ring dir returns an empty list; an undecodable file is skipped (the
// List listing's posture) rather than sinking the whole list.
func (s *Store) ListClosed(server string) ([]ClosedWindow, error) {
	ids, err := s.closedIDs(server)
	if err != nil {
		return nil, err
	}
	var out []ClosedWindow
	for i := len(ids) - 1; i >= 0; i-- {
		rec, err := s.LoadClosed(server, ids[i])
		if err != nil || rec == nil {
			continue
		}
		out = append(out, *rec)
	}
	return out, nil
}

// LoadClosed returns the record for id, or (nil, nil) when absent. Ids that
// are not bare unix-nanos digits are rejected outright (the filename-grammar
// guard — no path component ever reaches disk unvalidated).
func (s *Store) LoadClosed(server, id string) (*ClosedWindow, error) {
	if !validClosedID(id) {
		return nil, fmt.Errorf("closed load %s: invalid record id %q", server, id)
	}
	data, err := os.ReadFile(filepath.Join(s.closedDir(server), id+jsonExt))
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	var rec ClosedWindow
	if err := json.Unmarshal(data, &rec); err != nil {
		return nil, fmt.Errorf("decode closed record %s/%s: %w", server, id, err)
	}
	rec.coalesceLegacy()
	return &rec, nil
}

// DeleteClosed removes the record for id. Idempotent: a missing record is a
// no-op success (dismiss/pop of an already-gone record is not an error).
func (s *Store) DeleteClosed(server, id string) error {
	if !validClosedID(id) {
		return fmt.Errorf("closed delete %s: invalid record id %q", server, id)
	}
	if err := os.Remove(filepath.Join(s.closedDir(server), id+jsonExt)); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("closed delete %s/%s: %w", server, id, err)
	}
	return nil
}
