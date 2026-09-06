package cron

import (
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestLoadEntriesTolerant(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "dev.yaml")
	content := `
unknown_top_level: ignored
entries:
  - id: a3f9
    schedule: { kind: every, interval: 1h }
    target: { kind: pane, pane: "%12" }
    payload: "tick"
    unknown_entry_key: ignored
  - id: b4d2
    schedule: { kind: bogus }
    target: { kind: pane, pane: "%12" }
    payload: "bad kind"
  - id: c5e3
    schedule: { kind: every, interval: not-a-duration }
    target: { kind: pane, pane: "%12" }
    payload: "bad duration"
  - just-a-scalar
`
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	entries, diags := LoadEntries(path)
	if len(entries) != 1 || entries[0].ID != "a3f9" {
		t.Fatalf("entries = %+v, want only a3f9", entries)
	}
	if entries[0].Schedule.Interval.Duration != time.Hour {
		t.Errorf("interval = %v", entries[0].Schedule.Interval)
	}
	var reasons []string
	for _, d := range diags {
		reasons = append(reasons, d.Reason)
	}
	// b4d2 (bogus kind), c5e3 (bad duration), and the scalar node.
	if len(diags) != 3 {
		t.Fatalf("diags = %v", reasons)
	}
	for _, d := range diags {
		if d.Reason != "entry-invalid" {
			t.Errorf("diag reason = %q", d.Reason)
		}
	}
}

func TestLoadEntriesAbsentFile(t *testing.T) {
	entries, diags := LoadEntries(filepath.Join(t.TempDir(), "nope.yaml"))
	if entries != nil || diags != nil {
		t.Errorf("absent file: entries=%v diags=%v, want nil/nil", entries, diags)
	}
}

func TestLoadEntriesCorruptFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "dev.yaml")
	if err := os.WriteFile(path, []byte("{{{{ not yaml: ["), 0o600); err != nil {
		t.Fatal(err)
	}
	entries, diags := LoadEntries(path)
	if len(entries) != 0 {
		t.Errorf("entries = %v, want empty", entries)
	}
	if len(diags) != 1 || diags[0].Reason != "entry-file-corrupt" {
		t.Errorf("diags = %+v, want one entry-file-corrupt", diags)
	}
}

func TestAddGeneratesIDAndWritesAtomically(t *testing.T) {
	t.Setenv("XDG_STATE_HOME", t.TempDir())
	dir, err := DefaultDir()
	if err != nil {
		t.Fatal(err)
	}
	e, err := Add(dir, "dev", Entry{
		Name:     "hourly PR sweep",
		Schedule: Schedule{Kind: ScheduleEvery, Interval: Duration{time.Hour}},
		Target:   Target{Kind: TargetSession, Session: "4fe2"},
		Payload:  "check open PRs",
		Deliver:  DeliverWhenIdle,
		IfAbsent: IfAbsentSkip,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(e.ID) != 4 {
		t.Fatalf("id = %q, want 4 chars", e.ID)
	}
	want := filepath.Join(dir, "dev.yaml")
	st, err := os.Stat(want)
	if err != nil {
		t.Fatalf("entry file not written: %v", err)
	}
	if st.Mode().Perm() != fileMode {
		t.Errorf("mode = %o, want %o", st.Mode().Perm(), fileMode)
	}
	entries, diags := LoadEntries(want)
	if len(diags) != 0 || len(entries) != 1 {
		t.Fatalf("reload: entries=%v diags=%v", entries, diags)
	}
	if !reflect.DeepEqual(entries[0], e) {
		t.Errorf("round trip mismatch:\n got %+v\nwant %+v", entries[0], e)
	}
	// Intent only: no runtime facts leak into the file.
	data, _ := os.ReadFile(want)
	for _, fact := range []string{"last_fired", "next_fire", "rung"} {
		if strings.Contains(string(data), fact) {
			t.Errorf("file contains runtime fact %q", fact)
		}
	}
	// A second add gets a distinct id.
	e2, err := Add(dir, "dev", Entry{
		Schedule: Schedule{Kind: ScheduleEvery, Interval: Duration{time.Minute}},
		Target:   Target{Kind: TargetPane, Pane: "%1"},
		Payload:  "x",
	})
	if err != nil {
		t.Fatal(err)
	}
	if e2.ID == e.ID {
		t.Errorf("duplicate id %q", e2.ID)
	}
}

func TestAddRejectsTraversalSlug(t *testing.T) {
	dir := t.TempDir()
	_, err := Add(dir, "../escape", Entry{
		Schedule: Schedule{Kind: ScheduleEvery, Interval: Duration{time.Minute}},
		Target:   Target{Kind: TargetPane, Pane: "%1"},
		Payload:  "x",
	})
	if err == nil {
		t.Fatal("Add accepted traversal slug")
	}
	// No path outside dir was built.
	if _, err := os.Stat(filepath.Join(dir, "..", "escape.yaml")); !os.IsNotExist(err) {
		t.Errorf("traversal file exists")
	}
	entries, _ := os.ReadDir(dir)
	if len(entries) != 0 {
		t.Errorf("dir not empty: %v", entries)
	}
}

func TestMutations(t *testing.T) {
	dir := t.TempDir()
	entry := Entry{
		Schedule: Schedule{Kind: ScheduleEvery, Interval: Duration{time.Minute}},
		Target:   Target{Kind: TargetPane, Pane: "%1"},
		Payload:  "x",
	}
	e, err := Add(dir, "dev", entry)
	if err != nil {
		t.Fatal(err)
	}

	ok, err := SetMuted(dir, "dev", e.ID, true)
	if err != nil || !ok {
		t.Fatalf("SetMuted: ok=%v err=%v", ok, err)
	}
	ok, err = SetPinned(dir, "dev", e.ID, true)
	if err != nil || !ok {
		t.Fatalf("SetPinned: ok=%v err=%v", ok, err)
	}
	entries, _ := LoadEntries(filepath.Join(dir, "dev.yaml"))
	if !entries[0].Muted || !entries[0].Pinned {
		t.Errorf("after mutations: %+v", entries[0])
	}

	// Absent id ⇒ false, no error, file untouched.
	ok, err = SetMuted(dir, "dev", "zzzz", true)
	if err != nil || ok {
		t.Errorf("SetMuted absent id: ok=%v err=%v", ok, err)
	}
	ok, err = Remove(dir, "dev", "zzzz")
	if err != nil || ok {
		t.Errorf("Remove absent id: ok=%v err=%v", ok, err)
	}

	ok, err = Remove(dir, "dev", e.ID)
	if err != nil || !ok {
		t.Fatalf("Remove: ok=%v err=%v", ok, err)
	}
	entries, _ = LoadEntries(filepath.Join(dir, "dev.yaml"))
	if len(entries) != 0 {
		t.Errorf("entries after remove = %v", entries)
	}
}

func TestMutateRefusesCorruptFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "dev.yaml")
	if err := os.WriteFile(path, []byte("{{{{"), 0o600); err != nil {
		t.Fatal(err)
	}
	_, err := Add(dir, "dev", Entry{
		Schedule: Schedule{Kind: ScheduleEvery, Interval: Duration{time.Minute}},
		Target:   Target{Kind: TargetPane, Pane: "%1"},
		Payload:  "x",
	})
	if err == nil {
		t.Fatal("Add over corrupt file succeeded — existing intent would be dropped")
	}
}

// TestAddEntryCap: Add refuses past MaxEntriesPerServer with a named-cap
// error and leaves the file unchanged; at cap-1 it still adds.
func TestAddEntryCap(t *testing.T) {
	dir := t.TempDir()
	newEntry := func() Entry {
		return Entry{
			Schedule: Schedule{Kind: ScheduleEvery, Interval: Duration{time.Minute}},
			Target:   Target{Kind: TargetPane, Pane: "%1"},
			Payload:  "x",
		}
	}

	// Fill to the cap directly (Add assigns ids; building via saveEntries
	// keeps the fixture deterministic).
	entries := make([]Entry, MaxEntriesPerServer)
	for i := range entries {
		e := newEntry()
		e.ID = fmt.Sprintf("e%03d", i)
		entries[i] = e
	}
	path, err := EntriesPath(dir, "dev")
	if err != nil {
		t.Fatal(err)
	}
	if err := saveEntries(path, entries); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}

	_, err = Add(dir, "dev", newEntry())
	if err == nil || !strings.Contains(err.Error(), "50") {
		t.Fatalf("Add past the cap: err = %v, want a refusal naming the cap", err)
	}
	after, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(before) != string(after) {
		t.Error("entry file changed despite the refused Add")
	}

	// Cap-1 still adds.
	if _, err := Remove(dir, "dev", entries[0].ID); err != nil {
		t.Fatal(err)
	}
	if _, err := Add(dir, "dev", newEntry()); err != nil {
		t.Errorf("Add at cap-1: %v", err)
	}
}

// roleTickSpec is the EnsureRoleEntry test fixture: a role-target entry in the
// operator-tick shape (the production caller's spec).
func roleTickSpec() Entry {
	return Entry{
		Name:     "operator tick",
		Schedule: Schedule{Kind: ScheduleBackoff, Anchor: "operator-idle", Min: Duration{time.Minute}, Max: Duration{30 * time.Minute}},
		Target:   Target{Kind: TargetRole, Role: RoleOperator},
		Payload:  "operator tick",
		Deliver:  DeliverImmediate,
		IfAbsent: IfAbsentRespawn,
		Pinned:   true,
	}
}

// TestEnsureRoleEntryRejectsNonRoleSpec: a spec that does not target a
// concrete role is an error and plants nothing — the (kind, role) pair is the
// idempotency key, so a caller bug must surface at the call, not as a silent
// seed the scan can never match.
func TestEnsureRoleEntryRejectsNonRoleSpec(t *testing.T) {
	dir := t.TempDir()
	for _, spec := range []Entry{
		{Target: Target{Kind: TargetSession, Session: "s1"}},
		{Target: Target{Kind: TargetRole}},
	} {
		if _, _, err := EnsureRoleEntry(dir, "dev", spec); err == nil {
			t.Errorf("EnsureRoleEntry(%+v) err = nil, want a role-target validation error", spec.Target)
		}
	}
	entries, diags := LoadEntries(filepath.Join(dir, "dev.yaml"))
	if len(entries) != 0 || len(diags) != 0 {
		t.Errorf("entries=%v diags=%v, want nothing planted by a rejected spec", entries, diags)
	}
}

// TestEnsureRoleEntrySeedsOnEmpty: an absent entry file gains exactly one
// entry with the spec's fields and created=true.
func TestEnsureRoleEntrySeedsOnEmpty(t *testing.T) {
	dir := t.TempDir()
	entry, created, err := EnsureRoleEntry(dir, "dev", roleTickSpec())
	if err != nil {
		t.Fatal(err)
	}
	if !created {
		t.Error("created = false, want true on an empty file")
	}
	if len(entry.ID) != 4 {
		t.Errorf("id = %q, want an Add-assigned 4-char id", entry.ID)
	}
	entries, diags := LoadEntries(filepath.Join(dir, "dev.yaml"))
	if len(diags) != 0 || len(entries) != 1 {
		t.Fatalf("reload: entries=%v diags=%v, want exactly one entry", entries, diags)
	}
	if !reflect.DeepEqual(entries[0], entry) {
		t.Errorf("round trip mismatch:\n got %+v\nwant %+v", entries[0], entry)
	}
}

// TestEnsureRoleEntryIdempotentAndNeverMutates: a second call returns the
// existing entry unmodified with created=false — including after the user has
// edited it (muted, renamed, payload changed). The role target is the whole
// idempotency key; no field value is reconciled.
func TestEnsureRoleEntryIdempotentAndNeverMutates(t *testing.T) {
	dir := t.TempDir()
	first, created, err := EnsureRoleEntry(dir, "dev", roleTickSpec())
	if err != nil || !created {
		t.Fatalf("seed: entry=%+v created=%v err=%v", first, created, err)
	}

	// The user edits the seeded entry (mute + rename + new payload).
	if ok, err := SetMuted(dir, "dev", first.ID, true); err != nil || !ok {
		t.Fatalf("SetMuted: ok=%v err=%v", ok, err)
	}
	path := filepath.Join(dir, "dev.yaml")
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	edited := strings.Replace(string(before), "operator tick", "user renamed tick", 1)
	if err := os.WriteFile(path, []byte(edited), 0o600); err != nil {
		t.Fatal(err)
	}
	before, _ = os.ReadFile(path)

	second, created, err := EnsureRoleEntry(dir, "dev", roleTickSpec())
	if err != nil {
		t.Fatal(err)
	}
	if created {
		t.Error("created = true on re-seed, want false")
	}
	if second.ID != first.ID || !second.Muted || second.Name != "user renamed tick" {
		t.Errorf("returned entry = %+v, want the user's edited entry as-is", second)
	}
	after, _ := os.ReadFile(path)
	if string(before) != string(after) {
		t.Error("re-seed rewrote the entry file — a user's edit must never be reconciled away")
	}
}

// TestEnsureRoleEntryRoleScoped: the match keys on the role VALUE, not the
// target kind — an entry targeting a different role does not count as seeded
// (generality pin: only RoleOperator is defined today, so this uses a
// synthetic second role to prove the key is (kind, role), never kind alone).
func TestEnsureRoleEntryRoleScoped(t *testing.T) {
	dir := t.TempDir()
	other := roleTickSpec()
	other.Target.Role = "sentinel"
	if _, err := Add(dir, "dev", other); err != nil {
		t.Fatal(err)
	}
	entry, created, err := EnsureRoleEntry(dir, "dev", roleTickSpec())
	if err != nil {
		t.Fatal(err)
	}
	if !created {
		t.Error("created = false with only a sentinel-role entry present, want true")
	}
	if entry.Target.Role != RoleOperator {
		t.Errorf("seeded role = %q, want %q", entry.Target.Role, RoleOperator)
	}
	entries, _ := LoadEntries(filepath.Join(dir, "dev.yaml"))
	if len(entries) != 2 {
		t.Errorf("entries = %d, want both the sentinel and the seeded operator entry", len(entries))
	}
}
