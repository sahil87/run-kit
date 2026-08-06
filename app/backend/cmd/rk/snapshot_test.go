package main

import (
	"bytes"
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"rk/internal/snapshot"
)

// withTestSnapshotStore points the command layer at a temp-dir store and a
// pinned clock for the test's duration.
func withTestSnapshotStore(t *testing.T, now time.Time) *snapshot.Store {
	t.Helper()
	store := snapshot.NewStore(t.TempDir())
	origStore, origNow := newSnapshotStore, snapshotNow
	newSnapshotStore = func() (*snapshot.Store, error) { return store, nil }
	snapshotNow = func() time.Time { return now }
	t.Cleanup(func() {
		newSnapshotStore, snapshotNow = origStore, origNow
	})
	return store
}

func cliSnap(server string, takenAt time.Time) *snapshot.Snapshot {
	return &snapshot.Snapshot{
		Server:  server,
		TakenAt: takenAt,
		Sessions: []snapshot.Session{{
			Name:      "alpha",
			CreatedAt: takenAt.Add(-time.Hour).Unix(),
			Windows: []snapshot.Window{{
				Index: 1, ID: "@1", Name: "serve", Active: true,
				Panes: []snapshot.Pane{{ID: "%0", Index: 0, Cwd: "/proj", Command: "claude"}},
			}},
		}},
	}
}

func TestSnapshotListRendersLiveAndDied(t *testing.T) {
	now := time.Date(2026, 8, 5, 12, 0, 0, 0, time.UTC)
	store := withTestSnapshotStore(t, now)

	if _, err := store.Write(cliSnap("kit", now.Add(-2*time.Minute))); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Write(cliSnap("fabKit1", now.Add(-3*time.Hour))); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Tombstone("fabKit1", now.Add(-time.Hour), true); err != nil {
		t.Fatal(err)
	}

	var buf bytes.Buffer
	snapshotListCmd.SetOut(&buf)
	snapshotListAll = false
	if err := snapshotListCmd.RunE(snapshotListCmd, nil); err != nil {
		t.Fatal(err)
	}
	out := buf.String()

	if !strings.Contains(out, "2 snapshot(s):") {
		t.Errorf("header missing: %q", out)
	}
	if !strings.Contains(out, "kit") || !strings.Contains(out, "live") {
		t.Errorf("live row missing: %q", out)
	}
	if !strings.Contains(out, "died 1h ago (audited)") {
		t.Errorf("died/audited state missing: %q", out)
	}
	if !strings.Contains(out, "2m") { // live snapshot age
		t.Errorf("age column missing: %q", out)
	}

	// Server filter narrows to one row.
	buf.Reset()
	if err := snapshotListCmd.RunE(snapshotListCmd, []string{"fabKit1"}); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(buf.String(), "live") || !strings.Contains(buf.String(), "fabKit1") {
		t.Errorf("filtered list wrong: %q", buf.String())
	}

	// Invalid server name is a usage error before any store read.
	if err := snapshotListCmd.RunE(snapshotListCmd, []string{"bad/name"}); err == nil {
		t.Error("invalid server name must error")
	}
}

func TestSnapshotListCapsWithTruncationNotice(t *testing.T) {
	now := time.Date(2026, 8, 5, 12, 0, 0, 0, time.UTC)
	store := withTestSnapshotStore(t, now)
	for i := 0; i < snapshotListCap+4; i++ {
		if _, err := store.Write(cliSnap(fmt.Sprintf("srv%02d", i), now.Add(-time.Duration(i)*time.Minute))); err != nil {
			t.Fatal(err)
		}
	}

	var buf bytes.Buffer
	snapshotListCmd.SetOut(&buf)
	snapshotListAll = false
	if err := snapshotListCmd.RunE(snapshotListCmd, nil); err != nil {
		t.Fatal(err)
	}
	out := buf.String()
	if !strings.Contains(out, fmt.Sprintf("%d snapshot(s):", snapshotListCap+4)) {
		t.Errorf("header must carry the exact count: %q", out)
	}
	wantNotice := fmt.Sprintf("… and %d more; pass --all to list all", 4)
	if !strings.Contains(out, wantNotice) {
		t.Errorf("missing truncation notice %q in %q", wantNotice, out)
	}

	// --all lifts the cap.
	buf.Reset()
	snapshotListAll = true
	defer func() { snapshotListAll = false }()
	if err := snapshotListCmd.RunE(snapshotListCmd, nil); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(buf.String(), "pass --all") {
		t.Errorf("--all must not truncate: %q", buf.String())
	}
}

func TestSnapshotShowPrintsLayoutTree(t *testing.T) {
	now := time.Date(2026, 8, 5, 12, 0, 0, 0, time.UTC)
	store := withTestSnapshotStore(t, now)
	if _, err := store.Write(cliSnap("kit", now.Add(-time.Minute))); err != nil {
		t.Fatal(err)
	}

	var buf bytes.Buffer
	snapshotShowCmd.SetOut(&buf)
	snapshotShowAt = 0
	if err := snapshotShowCmd.RunE(snapshotShowCmd, []string{"kit"}); err != nil {
		t.Fatal(err)
	}
	out := buf.String()
	for _, want := range []string{
		`Snapshot of server "kit"`,
		"session alpha",
		"window 1: serve  (active)",
		"pane 0: /proj  [claude]",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("show output missing %q:\n%s", want, out)
		}
	}

	// Unknown server errors.
	if err := snapshotShowCmd.RunE(snapshotShowCmd, []string{"ghost"}); err == nil {
		t.Error("show of unknown server must error")
	}

	// Negative --at is a usage error.
	snapshotShowAt = -5
	defer func() { snapshotShowAt = 0 }()
	if err := snapshotShowCmd.RunE(snapshotShowCmd, []string{"kit"}); err == nil {
		t.Error("negative --at must error")
	}
}

func TestSnapshotRestoreRendersReport(t *testing.T) {
	now := time.Date(2026, 8, 5, 12, 0, 0, 0, time.UTC)
	store := withTestSnapshotStore(t, now)
	if _, err := store.Write(cliSnap("kit", now.Add(-time.Minute))); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Tombstone("kit", now, false); err != nil {
		t.Fatal(err)
	}

	var gotServer string
	var gotSnap *snapshot.Snapshot
	origRestore := snapshotRestoreFn
	snapshotRestoreFn = func(ctx context.Context, server string, snap *snapshot.Snapshot) (*snapshot.Report, error) {
		gotServer = server
		gotSnap = snap
		return &snapshot.Report{
			Server: snap.Server,
			Sessions: []snapshot.RestoredSession{{
				Name: "alpha",
				Windows: []snapshot.RestoredWindow{{
					Index: 1, Name: "serve", Panes: 1,
					FormerCommands: []string{"claude"},
					Notes:          []string{"cwd /gone missing on disk — pane at server default dir"},
				}},
			}},
			Skipped: []string{`session "alpha" window 3 (agent): index in use`},
		}, nil
	}
	t.Cleanup(func() { snapshotRestoreFn = origRestore })

	var buf bytes.Buffer
	snapshotRestoreCmd.SetOut(&buf)
	snapshotRestoreAt = 0
	if err := snapshotRestoreCmd.RunE(snapshotRestoreCmd, []string{"kit"}); err != nil {
		t.Fatal(err)
	}
	if gotSnap == nil || gotSnap.Server != "kit" || gotSnap.DiedAt == nil {
		t.Fatalf("restore engine received wrong snapshot: %+v", gotSnap)
	}
	if gotServer != "kit" {
		t.Fatalf("restore engine received server %q, want the validated CLI argument", gotServer)
	}
	out := buf.String()
	for _, want := range []string{
		`Restored server "kit"`,
		"window 1: serve — 1 pane(s)  was running: claude",
		"note: cwd /gone missing",
		"Skipped:",
		"nothing was relaunched",
		"tmux -L kit attach",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("report missing %q:\n%s", want, out)
		}
	}

	// Invalid server name is rejected before store/engine.
	if err := snapshotRestoreCmd.RunE(snapshotRestoreCmd, []string{"../evil"}); err == nil {
		t.Error("invalid server name must error")
	}
}

func TestFormatSnapshotAge(t *testing.T) {
	now := time.Date(2026, 8, 5, 12, 0, 0, 0, time.UTC)
	origNow := snapshotNow
	snapshotNow = func() time.Time { return now }
	t.Cleanup(func() { snapshotNow = origNow })

	cases := map[string]string{
		now.Add(-30 * time.Second).Format(time.RFC3339Nano): "30s",
		now.Add(-5 * time.Minute).Format(time.RFC3339Nano):  "5m",
		now.Add(-26 * time.Hour).Format(time.RFC3339Nano):   "1d",
	}
	for in, want := range cases {
		ts, _ := time.Parse(time.RFC3339Nano, in)
		if got := formatSnapshotAge(ts); got != want {
			t.Errorf("formatSnapshotAge(%s) = %q, want %q", in, got, want)
		}
	}
	if got := formatSnapshotAge(time.Time{}); got != "-" {
		t.Errorf("zero time = %q, want -", got)
	}
}
