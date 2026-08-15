package main

import (
	"bytes"
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"rk/internal/snapshot"

	"github.com/spf13/cobra"
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

// newTestSnapshotTree builds a fresh snapshot subtree and returns its children.
// The constructor binds flag vars per instance, so tests drive flags through
// cobra's flag set — there is no shared package flag state to reset.
func newTestSnapshotTree(t *testing.T) (list, show, restore *cobra.Command) {
	t.Helper()
	parent := newSnapshotCmd(false)
	for _, sub := range parent.Commands() {
		switch sub.Name() {
		case "list":
			list = sub
		case "show":
			show = sub
		case "restore":
			restore = sub
		}
	}
	if list == nil || show == nil || restore == nil {
		t.Fatal("snapshot subtree must carry list, show, restore")
	}
	return list, show, restore
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

	list, _, _ := newTestSnapshotTree(t)
	var buf bytes.Buffer
	list.SetOut(&buf)
	if err := list.RunE(list, nil); err != nil {
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
	if err := list.RunE(list, []string{"fabKit1"}); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(buf.String(), "live") || !strings.Contains(buf.String(), "fabKit1") {
		t.Errorf("filtered list wrong: %q", buf.String())
	}

	// Invalid server name is a usage error before any store read.
	if err := list.RunE(list, []string{"bad/name"}); err == nil {
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

	list, _, _ := newTestSnapshotTree(t)
	var buf bytes.Buffer
	list.SetOut(&buf)
	if err := list.RunE(list, nil); err != nil {
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
	if err := list.Flags().Set("all", "true"); err != nil {
		t.Fatal(err)
	}
	if err := list.RunE(list, nil); err != nil {
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

	_, show, _ := newTestSnapshotTree(t)
	var buf bytes.Buffer
	show.SetOut(&buf)
	if err := show.RunE(show, []string{"kit"}); err != nil {
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
	if err := show.RunE(show, []string{"ghost"}); err == nil {
		t.Error("show of unknown server must error")
	}

	// Negative --at is a usage error.
	if err := show.Flags().Set("at", "-5"); err != nil {
		t.Fatal(err)
	}
	if err := show.RunE(show, []string{"kit"}); err == nil {
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

	_, _, restore := newTestSnapshotTree(t)
	var buf bytes.Buffer
	restore.SetOut(&buf)
	if err := restore.RunE(restore, []string{"kit"}); err != nil {
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
	if err := restore.RunE(restore, []string{"../evil"}); err == nil {
		t.Error("invalid server name must error")
	}
}

// TestSnapshotAliasRunsWithDeprecationPointer pins the deprecation-alias
// contract on the EXECUTED-child path: `rk snapshot list` still lists (against
// the temp store seam) AND prints the cobra deprecation pointer. Cobra fires
// Deprecated only on the executed command — never the parent's — which is why
// the alias children carry the same string (see newSnapshotCmd).
func TestSnapshotAliasRunsWithDeprecationPointer(t *testing.T) {
	now := time.Date(2026, 8, 5, 12, 0, 0, 0, time.UTC)
	store := withTestSnapshotStore(t, now)

	stdout, stderr, err := runRootArgs(t, "snapshot", "list")
	if err != nil {
		t.Fatalf("rk snapshot list alias run error: %v", err)
	}
	if !strings.Contains(stdout, "No snapshots found.") {
		t.Errorf("alias must list identically, got stdout: %q", stdout)
	}
	if got := stdout + stderr; !strings.Contains(got, `Command "list" is deprecated, use `+"`rk mux snapshot`") {
		t.Errorf("the executed child must print the deprecation pointer, got stdout: %q stderr: %q", stdout, stderr)
	}
	if !snapshotAliasCmd.Hidden {
		t.Error("the snapshot alias must be hidden from help and the help-dump")
	}

	// The notice also fires on `show` — a successful executed-child path that
	// resolves a snapshot. (Cobra prints the deprecation at the top of
	// execute(), before Args validation, so the pointer appears on failing
	// invocations too; OutOrStderr resolves to the root's SetOut buffer in
	// tests — stderr in production.)
	if _, err := store.Write(cliSnap("kit", now.Add(-time.Minute))); err != nil {
		t.Fatal(err)
	}
	stdout, stderr, err = runRootArgs(t, "snapshot", "show", "kit")
	if err != nil {
		t.Fatalf("rk snapshot show kit alias run error: %v", err)
	}
	if !strings.Contains(stdout, `Snapshot of server "kit"`) {
		t.Errorf("alias show must render identically, got stdout: %q", stdout)
	}
	if got := stdout + stderr; !strings.Contains(got, `Command "show" is deprecated, use `+"`rk mux snapshot`") {
		t.Errorf("the executed show child must print the deprecation pointer, got stdout: %q stderr: %q", stdout, stderr)
	}

	// A child that fails arg validation still classifies usage (exit 2) via the
	// pre-wrapped validator.
	_, _, err = runRootArgs(t, "snapshot", "show")
	if err == nil {
		t.Fatal("rk snapshot show with no arg: expected a usage error, got nil")
	}
	if got := exitCode(err); got != exitUsage {
		t.Errorf("exit code = %d, want %d (usage)", got, exitUsage)
	}
}

// TestMuxSnapshotNoDeprecation pins the other half of the contract: the
// canonical family form `rk mux snapshot list` runs warning-free.
func TestMuxSnapshotNoDeprecation(t *testing.T) {
	now := time.Date(2026, 8, 5, 12, 0, 0, 0, time.UTC)
	withTestSnapshotStore(t, now)

	stdout, stderr, err := runRootArgs(t, "mux", "snapshot", "list")
	if err != nil {
		t.Fatalf("rk mux snapshot list run error: %v", err)
	}
	if !strings.Contains(stdout, "No snapshots found.") {
		t.Errorf("family member must list identically, got stdout: %q", stdout)
	}
	if got := stdout + stderr; strings.Contains(got, "deprecated") {
		t.Errorf("the family form must not print a deprecation warning, got stdout: %q stderr: %q", stdout, stderr)
	}
}

// TestMuxSnapshotRejectsExplicitServerFlag pins the -L guard on the snapshot
// children: an explicitly-set inherited --server is a usage error (exit 2)
// before any store read.
func TestMuxSnapshotRejectsExplicitServerFlag(t *testing.T) {
	for _, args := range [][]string{
		{"mux", "-L", "zzz-nope", "snapshot", "list"},
		{"mux", "-L", "zzz-nope", "snapshot", "show", "kit"},
		{"mux", "-L", "zzz-nope", "snapshot", "restore", "kit"},
	} {
		_, _, err := runRootArgs(t, args...)
		if err == nil {
			t.Errorf("rk %v: expected a usage error, got nil", args)
			continue
		}
		if got := exitCode(err); got != exitUsage {
			t.Errorf("rk %v: exit code = %d, want %d (usage)", args, got, exitUsage)
		}
		if !strings.Contains(err.Error(), "--server") {
			t.Errorf("rk %v: error must name --server, got: %v", args, err)
		}
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
