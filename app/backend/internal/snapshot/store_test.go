package snapshot

import (
	"os"
	"path/filepath"
	"strconv"
	"testing"
	"time"
)

func testSnap(server string, takenAt time.Time, windowName string) *Snapshot {
	return &Snapshot{
		Server:  server,
		TakenAt: takenAt,
		Sessions: []Session{{
			Name:      "s1",
			CreatedAt: 100,
			Windows: []Window{{
				Index: 1, ID: "@1", Name: windowName,
				Panes: []Pane{{ID: "%0", Index: 0, Cwd: "/tmp", Command: "zsh"}},
			}},
		}},
	}
}

func TestDefaultDirXDGOverride(t *testing.T) {
	t.Setenv("XDG_STATE_HOME", "/custom/state")
	dir, err := DefaultDir()
	if err != nil {
		t.Fatal(err)
	}
	if dir != filepath.Join("/custom/state", "rk", "snapshots") {
		t.Errorf("dir = %s", dir)
	}

	t.Setenv("XDG_STATE_HOME", "")
	dir, err = DefaultDir()
	if err != nil {
		t.Fatal(err)
	}
	home, _ := os.UserHomeDir()
	if dir != filepath.Join(home, ".local", "state", "rk", "snapshots") {
		t.Errorf("default dir = %s", dir)
	}
}

func TestWriteLatestHistoryAndDedup(t *testing.T) {
	s := NewStore(t.TempDir())
	base := time.Date(2026, 8, 5, 12, 0, 0, 0, time.UTC)

	wrote, err := s.Write(testSnap("kit", base, "serve"))
	if err != nil || !wrote {
		t.Fatalf("first write: wrote=%v err=%v", wrote, err)
	}

	// Identical content, later timestamp → dedup skip (no latest rewrite, no
	// history entry).
	wrote, err = s.Write(testSnap("kit", base.Add(time.Minute), "serve"))
	if err != nil {
		t.Fatal(err)
	}
	if wrote {
		t.Error("identical-content write should dedup to a no-op")
	}
	if ts, _ := s.historyTimestamps("kit"); len(ts) != 1 {
		t.Errorf("history count after dedup = %d, want 1", len(ts))
	}

	// Changed content → latest replaced + history appended.
	wrote, err = s.Write(testSnap("kit", base.Add(2*time.Minute), "renamed"))
	if err != nil || !wrote {
		t.Fatalf("changed write: wrote=%v err=%v", wrote, err)
	}
	latest, err := s.LoadLatest("kit")
	if err != nil {
		t.Fatal(err)
	}
	if latest.Sessions[0].Windows[0].Name != "renamed" {
		t.Errorf("latest not replaced: %+v", latest.Sessions[0].Windows[0])
	}
	if ts, _ := s.historyTimestamps("kit"); len(ts) != 2 {
		t.Errorf("history count = %d, want 2", len(ts))
	}

	// History entries are loadable via LoadAt.
	at, err := s.LoadAt("kit", base.Unix())
	if err != nil {
		t.Fatal(err)
	}
	if at.Sessions[0].Windows[0].Name != "serve" {
		t.Errorf("LoadAt returned wrong entry: %+v", at.Sessions[0].Windows[0])
	}
}

func TestWriteZeroSessionSnapshotSkipped(t *testing.T) {
	s := NewStore(t.TempDir())
	base := time.Date(2026, 8, 5, 12, 0, 0, 0, time.UTC)
	if _, err := s.Write(testSnap("kit", base, "serve")); err != nil {
		t.Fatal(err)
	}

	// The alive-but-empty floor case: the _rk-ctl anchor keeps the socket up
	// after the last user-facing session closes, so capture succeeds with zero
	// sessions. The write must be skipped — never overwrite a good latest.
	wrote, err := s.Write(&Snapshot{Server: "kit", TakenAt: base.Add(time.Minute)})
	if err != nil {
		t.Fatal(err)
	}
	if wrote {
		t.Error("zero-session write must be skipped")
	}
	latest, err := s.LoadLatest("kit")
	if err != nil {
		t.Fatal(err)
	}
	if latest == nil || len(latest.Sessions) != 1 || latest.Sessions[0].Windows[0].Name != "serve" {
		t.Errorf("good latest was clobbered: %+v", latest)
	}
	if ts, _ := s.historyTimestamps("kit"); len(ts) != 1 {
		t.Errorf("history churned on zero-session write: %d entries", len(ts))
	}

	// A zero-session write with no existing latest is skipped too.
	wrote, err = s.Write(&Snapshot{Server: "fresh", TakenAt: base})
	if err != nil || wrote {
		t.Errorf("fresh zero-session write: wrote=%v err=%v, want skip", wrote, err)
	}
	if latest, _ := s.LoadLatest("fresh"); latest != nil {
		t.Errorf("zero-session snapshot landed: %+v", latest)
	}
}

func TestWriteSameSecondHistoryCollisionBumpsForward(t *testing.T) {
	s := NewStore(t.TempDir())
	base := time.Date(2026, 8, 5, 12, 0, 0, 0, time.UTC)

	// Two content-DIFFERENT writes within the same second: without the
	// collision guard the second would overwrite the first's history entry.
	if _, err := s.Write(testSnap("kit", base, "w1")); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Write(testSnap("kit", base, "w2")); err != nil {
		t.Fatal(err)
	}

	ts, err := s.historyTimestamps("kit")
	if err != nil {
		t.Fatal(err)
	}
	if len(ts) != 2 {
		t.Fatalf("history entries = %d, want 2 (same-second write clobbered)", len(ts))
	}
	if ts[0] != base.Unix() || ts[1] != base.Unix()+1 {
		t.Errorf("history timestamps = %v, want [%d %d]", ts, base.Unix(), base.Unix()+1)
	}
	first, err := s.LoadAt("kit", ts[0])
	if err != nil {
		t.Fatal(err)
	}
	if first.Sessions[0].Windows[0].Name != "w1" {
		t.Errorf("earlier entry clobbered: %+v", first.Sessions[0].Windows[0])
	}
	second, err := s.LoadAt("kit", ts[1])
	if err != nil {
		t.Fatal(err)
	}
	if second.Sessions[0].Windows[0].Name != "w2" {
		t.Errorf("bumped entry wrong: %+v", second.Sessions[0].Windows[0])
	}
}

func TestHistoryPruneToRetention(t *testing.T) {
	s := NewStore(t.TempDir())
	base := time.Date(2026, 8, 5, 12, 0, 0, 0, time.UTC)
	for i := 0; i < historyRetention+5; i++ {
		snap := testSnap("kit", base.Add(time.Duration(i)*time.Minute), "w"+strconv.Itoa(i))
		if _, err := s.Write(snap); err != nil {
			t.Fatal(err)
		}
	}
	ts, err := s.historyTimestamps("kit")
	if err != nil {
		t.Fatal(err)
	}
	if len(ts) != historyRetention {
		t.Errorf("history count = %d, want %d", len(ts), historyRetention)
	}
	// The oldest entries are the pruned ones.
	if ts[0] != base.Add(5*time.Minute).Unix() {
		t.Errorf("oldest surviving = %d, want %d", ts[0], base.Add(5*time.Minute).Unix())
	}
}

func TestTombstoneStampsAndRenames(t *testing.T) {
	s := NewStore(t.TempDir())
	base := time.Date(2026, 8, 5, 12, 0, 0, 0, time.UTC)
	if _, err := s.Write(testSnap("kit", base, "serve")); err != nil {
		t.Fatal(err)
	}

	died := base.Add(time.Hour)
	created, err := s.Tombstone("kit", died, true)
	if err != nil {
		t.Fatal(err)
	}
	if !created {
		t.Error("Tombstone should report created=true when a latest existed")
	}

	// Latest is gone.
	if snap, err := s.LoadLatest("kit"); err != nil || snap != nil {
		t.Fatalf("latest should be gone: snap=%v err=%v", snap, err)
	}
	// Tombstone exists, stamped.
	tomb, err := s.LoadAt("kit", died.Unix())
	if err != nil {
		t.Fatal(err)
	}
	if tomb.DiedAt == nil || !tomb.DiedAt.Equal(died) {
		t.Errorf("diedAt = %v, want %v", tomb.DiedAt, died)
	}
	if !tomb.AuditedKill {
		t.Error("auditedKill not stamped")
	}
	// Resolve falls back to the newest tombstone when no latest exists.
	resolved, err := s.Resolve("kit", 0)
	if err != nil {
		t.Fatal(err)
	}
	if resolved.DiedAt == nil {
		t.Error("Resolve did not return the tombstone")
	}

	// Tombstoning a server with no latest is a no-op.
	created, err = s.Tombstone("ghost", died, false)
	if err != nil {
		t.Fatalf("no-latest tombstone should be a no-op: %v", err)
	}
	if created {
		t.Error("Tombstone should report created=false when no latest existed")
	}
}

func TestTombstonePruneToRetention(t *testing.T) {
	s := NewStore(t.TempDir())
	base := time.Date(2026, 8, 5, 12, 0, 0, 0, time.UTC)
	for i := 0; i < tombstoneRetention+3; i++ {
		if _, err := s.Write(testSnap("kit", base.Add(time.Duration(i)*time.Minute), "w"+strconv.Itoa(i))); err != nil {
			t.Fatal(err)
		}
		if _, err := s.Tombstone("kit", base.Add(time.Duration(i)*time.Minute+30*time.Second), false); err != nil {
			t.Fatal(err)
		}
	}
	ts, err := s.tombstoneTimestamps("kit")
	if err != nil {
		t.Fatal(err)
	}
	if len(ts) != tombstoneRetention {
		t.Errorf("tombstone count = %d, want %d", len(ts), tombstoneRetention)
	}
}

func TestListMixesLiveAndTombstones(t *testing.T) {
	s := NewStore(t.TempDir())
	base := time.Date(2026, 8, 5, 12, 0, 0, 0, time.UTC)

	if _, err := s.Write(testSnap("kit", base.Add(time.Hour), "serve")); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Write(testSnap("fabKit1", base, "agents")); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Tombstone("fabKit1", base.Add(time.Minute), false); err != nil {
		t.Fatal(err)
	}

	rows, err := s.List("")
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 2 {
		t.Fatalf("rows = %+v", rows)
	}
	// Newest-first: kit (base+1h) before fabKit1 (base).
	if rows[0].Server != "kit" || rows[0].DiedAt != nil || rows[0].HistoryCount != 1 {
		t.Errorf("row 0 = %+v", rows[0])
	}
	if rows[1].Server != "fabKit1" || rows[1].DiedAt == nil {
		t.Errorf("row 1 = %+v", rows[1])
	}
	if rows[1].Sessions != 1 || rows[1].Windows != 1 {
		t.Errorf("row 1 counts = %+v", rows[1])
	}

	// Filtered listing.
	rows, err = s.List("fabKit1")
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || rows[0].Server != "fabKit1" {
		t.Errorf("filtered rows = %+v", rows)
	}

	// Missing dir lists empty.
	empty := NewStore(filepath.Join(t.TempDir(), "missing"))
	rows, err = empty.List("")
	if err != nil || rows != nil {
		t.Errorf("missing-dir list = %v, %v", rows, err)
	}
}

func TestContentEqualIgnoresTakenAt(t *testing.T) {
	base := time.Date(2026, 8, 5, 12, 0, 0, 0, time.UTC)
	a := testSnap("kit", base, "serve")
	b := testSnap("kit", base.Add(time.Hour), "serve")
	if !ContentEqual(a, b) {
		t.Error("snapshots differing only in takenAt should be content-equal")
	}
	c := testSnap("kit", base, "other")
	if ContentEqual(a, c) {
		t.Error("different layouts should not be content-equal")
	}
	if ContentEqual(a, nil) || !ContentEqual(nil, nil) {
		t.Error("nil handling wrong")
	}
}
