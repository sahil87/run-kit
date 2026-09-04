package snapshot

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"testing"
	"time"
)

func closedRec(server, name string) ClosedWindow {
	return ClosedWindow{
		Server:  server,
		Session: "s1",
		Window: Window{
			Index: 1, ID: "@1", Name: name,
			Panes: []Pane{{ID: "%0", Index: 0, Cwd: "/tmp", Command: "zsh"}},
		},
	}
}

// TestPushClosedStampsIDAndClosedAt: the store owns the record identity — id is
// a unix-nanos string, closedAt is stamped at push (callers never set them).
func TestPushClosedStampsIDAndClosedAt(t *testing.T) {
	s := NewStore(t.TempDir())
	before := time.Now().UTC()

	rec, err := s.PushClosed(closedRec("kit", "work"))
	if err != nil {
		t.Fatal(err)
	}
	if !validClosedID(rec.ID) {
		t.Errorf("id = %q, want bare unix-nanos digits", rec.ID)
	}
	if rec.ClosedAt.Before(before) || rec.ClosedAt.Location() != time.UTC {
		t.Errorf("closedAt = %v, want ~now UTC", rec.ClosedAt)
	}
	// The file lands at {server}.closed/{id}.json.
	if _, err := os.Stat(filepath.Join(s.closedDir("kit"), rec.ID+jsonExt)); err != nil {
		t.Errorf("record file missing: %v", err)
	}
}

// TestPushClosedEmptyServerRejected: a serverless record must never address a
// ring directory.
func TestPushClosedEmptyServerRejected(t *testing.T) {
	s := NewStore(t.TempDir())
	if _, err := s.PushClosed(closedRec("", "work")); err == nil {
		t.Fatal("empty server must error")
	}
}

// TestClosedRingCapAndPruneOrder: the 11th push prunes the oldest record; the
// ring holds exactly ClosedRingCap entries, listed newest-first.
func TestClosedRingCapAndPruneOrder(t *testing.T) {
	s := NewStore(t.TempDir())
	pushed := make([]ClosedWindow, 0, ClosedRingCap+1)
	for i := 0; i < ClosedRingCap+1; i++ {
		rec, err := s.PushClosed(closedRec("kit", "w"+strconv.Itoa(i)))
		if err != nil {
			t.Fatal(err)
		}
		pushed = append(pushed, rec)
	}

	list, err := s.ListClosed("kit")
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != ClosedRingCap {
		t.Fatalf("list len = %d, want %d", len(list), ClosedRingCap)
	}
	// Newest-first: the last pushed is first, the oldest survivor last.
	if list[0].ID != pushed[ClosedRingCap].ID {
		t.Errorf("list[0] = %q, want newest %q", list[0].ID, pushed[ClosedRingCap].ID)
	}
	if list[ClosedRingCap-1].ID != pushed[1].ID {
		t.Errorf("list[%d] = %q, want oldest survivor %q", ClosedRingCap-1, list[ClosedRingCap-1].ID, pushed[1].ID)
	}
	// The oldest record's file is gone from disk.
	if _, err := os.Stat(filepath.Join(s.closedDir("kit"), pushed[0].ID+jsonExt)); !os.IsNotExist(err) {
		t.Errorf("oldest record not pruned: %v", err)
	}
	for i := 1; i < len(list); i++ {
		if list[i-1].ClosedAt.Before(list[i].ClosedAt) {
			t.Errorf("list not newest-first at %d: %v < %v", i, list[i-1].ClosedAt, list[i].ClosedAt)
		}
	}
}

// TestListClosedRoundTripsRecord: a pushed record decodes back with the full
// window capture and agent session identity intact.
func TestListClosedRoundTripsRecord(t *testing.T) {
	s := NewStore(t.TempDir())
	want := closedRec("kit", "agent")
	want.Window.Color = "4"
	want.AgentProvider = "claude"
	want.AgentRef = "5d80479e-8f25-46cd-a0d4-e51435508a37"
	rec, err := s.PushClosed(want)
	if err != nil {
		t.Fatal(err)
	}

	list, err := s.ListClosed("kit")
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 1 {
		t.Fatalf("list = %+v", list)
	}
	got := list[0]
	if got.ID != rec.ID || got.Window.Name != "agent" || got.Window.Color != "4" ||
		got.AgentProvider != "claude" || got.AgentRef != want.AgentRef || got.Session != "s1" {
		t.Errorf("round-trip mismatch: %+v", got)
	}
	if len(got.Window.Panes) != 1 || got.Window.Panes[0].Cwd != "/tmp" {
		t.Errorf("panes mismatch: %+v", got.Window.Panes)
	}
}

// TestPushClosedWritesOnlyNewKeys: a record written post-upgrade carries only
// the agentProvider/agentRef keys — the legacy chatProvider/chatRef keys never
// appear on disk.
func TestPushClosedWritesOnlyNewKeys(t *testing.T) {
	s := NewStore(t.TempDir())
	want := closedRec("kit", "agent")
	want.AgentProvider = "claude"
	want.AgentRef = "5d80479e-8f25-46cd-a0d4-e51435508a37"
	rec, err := s.PushClosed(want)
	if err != nil {
		t.Fatal(err)
	}

	data, err := os.ReadFile(filepath.Join(s.closedDir("kit"), rec.ID+jsonExt))
	if err != nil {
		t.Fatal(err)
	}
	var raw map[string]any
	if err := json.Unmarshal(data, &raw); err != nil {
		t.Fatal(err)
	}
	if raw["agentProvider"] != "claude" || raw["agentRef"] != want.AgentRef {
		t.Errorf("record keys = %v, want agentProvider/agentRef set", raw)
	}
	if _, ok := raw["chatProvider"]; ok {
		t.Errorf("record carries legacy chatProvider key: %v", raw)
	}
	if _, ok := raw["chatRef"]; ok {
		t.Errorf("record carries legacy chatRef key: %v", raw)
	}
}

// TestLoadClosedCoalescesLegacyKeys: a pre-upgrade record (chatProvider/chatRef
// keys only) loads with its resume identity coalesced into the new fields.
func TestLoadClosedCoalescesLegacyKeys(t *testing.T) {
	s := NewStore(t.TempDir())
	if err := os.MkdirAll(s.closedDir("kit"), dirMode); err != nil {
		t.Fatal(err)
	}
	const id = "1700000000000000001"
	legacy := `{
		"id": "` + id + `",
		"closedAt": "2026-09-01T12:00:00Z",
		"server": "kit",
		"session": "s1",
		"window": {"index": 1, "id": "@1", "name": "agent", "panes": [{"id": "%0", "index": 0, "cwd": "/tmp", "command": "claude"}]},
		"chatProvider": "claude",
		"chatRef": "5d80479e-8f25-46cd-a0d4-e51435508a37"
	}`
	if err := os.WriteFile(filepath.Join(s.closedDir("kit"), id+jsonExt), []byte(legacy), fileMode); err != nil {
		t.Fatal(err)
	}

	got, err := s.LoadClosed("kit", id)
	if err != nil || got == nil {
		t.Fatalf("load: %v, %v", got, err)
	}
	if got.AgentProvider != "claude" || got.AgentRef != "5d80479e-8f25-46cd-a0d4-e51435508a37" {
		t.Errorf("coalesced identity = %q/%q, want claude/5d80479e-…", got.AgentProvider, got.AgentRef)
	}
	if got.LegacyChatProvider != "" || got.LegacyChatRef != "" {
		t.Errorf("legacy fields not cleared: %q/%q", got.LegacyChatProvider, got.LegacyChatRef)
	}
}

// TestLoadClosedNewKeysWinOverLegacy: a record carrying BOTH key generations
// resolves to the new keys (mirroring the tmux dual-read rule).
func TestLoadClosedNewKeysWinOverLegacy(t *testing.T) {
	s := NewStore(t.TempDir())
	if err := os.MkdirAll(s.closedDir("kit"), dirMode); err != nil {
		t.Fatal(err)
	}
	const id = "1700000000000000002"
	both := `{
		"id": "` + id + `",
		"closedAt": "2026-09-01T12:00:00Z",
		"server": "kit",
		"session": "s1",
		"window": {"index": 1, "id": "@1", "name": "agent", "panes": []},
		"chatProvider": "codex",
		"chatRef": "old-ref",
		"agentProvider": "claude",
		"agentRef": "new-ref"
	}`
	if err := os.WriteFile(filepath.Join(s.closedDir("kit"), id+jsonExt), []byte(both), fileMode); err != nil {
		t.Fatal(err)
	}

	got, err := s.LoadClosed("kit", id)
	if err != nil || got == nil {
		t.Fatalf("load: %v, %v", got, err)
	}
	if got.AgentProvider != "claude" || got.AgentRef != "new-ref" {
		t.Errorf("identity = %q/%q, want the new keys claude/new-ref", got.AgentProvider, got.AgentRef)
	}
}

// TestListClosedMissingDirIsEmpty: a server with no ring dir lists empty, never
// an error.
func TestListClosedMissingDirIsEmpty(t *testing.T) {
	s := NewStore(filepath.Join(t.TempDir(), "missing"))
	list, err := s.ListClosed("ghost")
	if err != nil || len(list) != 0 {
		t.Errorf("missing-dir list = %v, %v", list, err)
	}
}

// TestLoadClosedHitMiss: load-by-id returns the record, (nil, nil) for an
// absent id, and rejects ids outside the filename grammar before touching disk.
func TestLoadClosedHitMiss(t *testing.T) {
	s := NewStore(t.TempDir())
	rec, err := s.PushClosed(closedRec("kit", "work"))
	if err != nil {
		t.Fatal(err)
	}

	got, err := s.LoadClosed("kit", rec.ID)
	if err != nil || got == nil {
		t.Fatalf("load: %v, %v", got, err)
	}
	if got.Window.Name != "work" {
		t.Errorf("loaded wrong record: %+v", got)
	}

	missing, err := s.LoadClosed("kit", "9999999999999999999")
	if err != nil || missing != nil {
		t.Errorf("absent id = %v, %v — want (nil, nil)", missing, err)
	}

	for _, bad := range []string{"", "../x", "1.json", "12a3", "1/2", "-1"} {
		if _, err := s.LoadClosed("kit", bad); err == nil {
			t.Errorf("id %q must be rejected", bad)
		}
		if err := s.DeleteClosed("kit", bad); err == nil {
			t.Errorf("delete id %q must be rejected", bad)
		}
	}
}

// TestDeleteClosed: delete removes the record; a missing record is a no-op
// success.
func TestDeleteClosed(t *testing.T) {
	s := NewStore(t.TempDir())
	rec, err := s.PushClosed(closedRec("kit", "work"))
	if err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteClosed("kit", rec.ID); err != nil {
		t.Fatal(err)
	}
	if got, _ := s.LoadClosed("kit", rec.ID); got != nil {
		t.Errorf("record still present after delete: %+v", got)
	}
	// Repeat delete (and a never-existing id) are no-op successes.
	if err := s.DeleteClosed("kit", rec.ID); err != nil {
		t.Errorf("repeat delete: %v", err)
	}
	if err := s.DeleteClosed("ghost", "1"); err != nil {
		t.Errorf("ghost delete: %v", err)
	}
}

// TestClosedRingDoesNotCollideWithServerDirs: the {server}.closed directory
// must not interfere with the existing store listings (live latest, history,
// tombstones) for the same server.
func TestClosedRingDoesNotCollideWithServerDirs(t *testing.T) {
	s := NewStore(t.TempDir())
	base := time.Date(2026, 8, 29, 12, 0, 0, 0, time.UTC)
	if _, err := s.Write(testSnap("kit", base, "serve")); err != nil {
		t.Fatal(err)
	}
	if _, err := s.PushClosed(closedRec("kit", "work")); err != nil {
		t.Fatal(err)
	}

	// The latest snapshot and its history are untouched by the ring.
	if snap, err := s.LoadLatest("kit"); err != nil || snap == nil {
		t.Errorf("latest lost to ring push: %v, %v", snap, err)
	}
	if ts, _ := s.historyTimestamps("kit"); len(ts) != 1 {
		t.Errorf("history count = %d, want 1", len(ts))
	}
	// Store.List walks {server}.json files only; a .closed dir is not a row.
	rows, err := s.List("kit")
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || rows[0].Server != "kit" {
		t.Errorf("rows = %+v, want one kit row", rows)
	}
	// The ring is per-server: another server's ring is unaffected.
	if list, _ := s.ListClosed("other"); len(list) != 0 {
		t.Errorf("other server's ring = %+v, want empty", list)
	}
}
