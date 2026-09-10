package cron

import (
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"
)

func editTestEntry(t *testing.T, dir string) Entry {
	t.Helper()
	e, err := Add(dir, "dev", Entry{
		Name:     "sweep",
		Schedule: Schedule{Kind: ScheduleEvery, Interval: Duration{time.Hour}},
		Target:   Target{Kind: TargetSession, Session: "4fe2"},
		Payload:  "check open PRs",
	})
	if err != nil {
		t.Fatal(err)
	}
	return e
}

func editTestLog(t *testing.T, dir string) []LogLine {
	t.Helper()
	path, err := LogPath(dir, "dev")
	if err != nil {
		t.Fatal(err)
	}
	return ReadLog(path)
}

// TestEditDeliverChangeLogsRescheduled: a deliver-only change appends exactly
// one `rescheduled` line — Reason "edit", no target — while the entry file
// gains the new policy.
func TestEditDeliverChangeLogsRescheduled(t *testing.T) {
	dir := t.TempDir()
	e := editTestEntry(t, dir)
	now := time.Unix(1_700_010_000, 0)

	merged, ok, err := Edit(dir, "dev", e.ID, now, func(e *Entry) {
		e.Deliver = DeliverWhenIdle
	})
	if err != nil || !ok {
		t.Fatalf("Edit: ok=%v err=%v", ok, err)
	}
	if merged.Deliver != DeliverWhenIdle {
		t.Errorf("merged.Deliver = %q, want %q", merged.Deliver, DeliverWhenIdle)
	}

	lines := editTestLog(t, dir)
	if len(lines) != 1 {
		t.Fatalf("log lines = %+v, want exactly one rescheduled line", lines)
	}
	want := LogLine{TS: now.Unix(), Entry: e.ID, Reason: "edit", Outcome: "rescheduled"}
	if lines[0] != want {
		t.Errorf("log line = %+v, want %+v (no target)", lines[0], want)
	}
}

// TestEditScheduleChangeLogsRescheduled: a schedule change also appends the
// reset line, with the new schedule persisted.
func TestEditScheduleChangeLogsRescheduled(t *testing.T) {
	dir := t.TempDir()
	e := editTestEntry(t, dir)
	now := time.Unix(1_700_010_000, 0)

	flat := Schedule{Kind: ScheduleBackoff, Min: Duration{3 * time.Minute}, Max: Duration{3 * time.Minute}}
	merged, ok, err := Edit(dir, "dev", e.ID, now, func(e *Entry) {
		e.Schedule = flat
	})
	if err != nil || !ok {
		t.Fatalf("Edit: ok=%v err=%v", ok, err)
	}
	if merged.Schedule != flat {
		t.Errorf("merged.Schedule = %+v, want %+v", merged.Schedule, flat)
	}
	if lines := editTestLog(t, dir); len(lines) != 1 || lines[0].Outcome != "rescheduled" {
		t.Errorf("log lines = %+v, want one rescheduled line", lines)
	}
}

// TestEditNoRescheduledLine: name-only edits and merges that re-set the
// identical schedule and deliver append nothing — a no-op reset would
// silently delay a due fire by a period.
func TestEditNoRescheduledLine(t *testing.T) {
	t.Run("name-only edit", func(t *testing.T) {
		dir := t.TempDir()
		e := editTestEntry(t, dir)
		merged, ok, err := Edit(dir, "dev", e.ID, time.Now(), func(e *Entry) {
			e.Name = "renamed"
		})
		if err != nil || !ok || merged.Name != "renamed" {
			t.Fatalf("Edit: merged=%+v ok=%v err=%v", merged, ok, err)
		}
		if lines := editTestLog(t, dir); len(lines) != 0 {
			t.Errorf("log lines = %+v, want none for a name-only edit", lines)
		}
	})

	t.Run("identical schedule and deliver", func(t *testing.T) {
		dir := t.TempDir()
		e := editTestEntry(t, dir)
		_, ok, err := Edit(dir, "dev", e.ID, time.Now(), func(e *Entry) {
			e.Schedule = Schedule{Kind: ScheduleEvery, Interval: Duration{time.Hour}}
			e.Deliver = ""
		})
		if err != nil || !ok {
			t.Fatalf("Edit: ok=%v err=%v", ok, err)
		}
		if lines := editTestLog(t, dir); len(lines) != 0 {
			t.Errorf("log lines = %+v, want none for a no-op edit", lines)
		}
	})
}

// TestEditUnknownID: an absent id is (Entry{}, false, nil) and appends no log
// line.
func TestEditUnknownID(t *testing.T) {
	dir := t.TempDir()
	editTestEntry(t, dir)
	merged, ok, err := Edit(dir, "dev", "zzzz", time.Now(), func(e *Entry) {
		e.Deliver = DeliverWhenIdle
	})
	if err != nil || ok || !reflect.DeepEqual(merged, Entry{}) {
		t.Errorf("Edit absent id: merged=%+v ok=%v err=%v, want zero/false/nil", merged, ok, err)
	}
	if lines := editTestLog(t, dir); len(lines) != 0 {
		t.Errorf("log lines = %+v, want none for an unknown id", lines)
	}
}

// TestEditContention: while another invoker holds the tick flock past the
// retry budget, Edit returns ErrEditContention and writes nothing.
func TestEditContention(t *testing.T) {
	dir := t.TempDir()
	e := editTestEntry(t, dir)
	release, err := acquireLock(LockPath(dir))
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	path := filepath.Join(dir, "dev.yaml")
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}

	_, ok, err := Edit(dir, "dev", e.ID, time.Now(), func(e *Entry) {
		e.Deliver = DeliverWhenIdle
	})
	if !errors.Is(err, ErrEditContention) || ok {
		t.Errorf("Edit under contention: ok=%v err=%v, want false and ErrEditContention", ok, err)
	}
	after, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(before) != string(after) {
		t.Error("entry file changed despite the contention")
	}
	if lines := editTestLog(t, dir); len(lines) != 0 {
		t.Errorf("log lines = %+v, want none under contention", lines)
	}
}

// TestEditAcquiresAReleasedLock: ordinary contention resolves within the
// budget — a lock released shortly after the call starts does not fail Edit.
func TestEditAcquiresAReleasedLock(t *testing.T) {
	dir := t.TempDir()
	e := editTestEntry(t, dir)
	release, err := acquireLock(LockPath(dir))
	if err != nil {
		t.Fatal(err)
	}
	go func() {
		time.Sleep(3 * editLockRetryInterval)
		release()
	}()
	_, ok, err := Edit(dir, "dev", e.ID, time.Now(), func(e *Entry) {
		e.Deliver = DeliverWhenIdle
	})
	if err != nil || !ok {
		t.Errorf("Edit past transient contention: ok=%v err=%v, want true/nil", ok, err)
	}
}
