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
		Schedule: Schedule{Kind: ScheduleBackoff, Min: Duration{time.Minute}, Max: Duration{30 * time.Minute}},
		Target:   Target{Kind: TargetRole, Role: RoleOperator},
		Payload:  "operator tick",
		Deliver:  DeliverImmediate,
		IfAbsent: IfAbsentRespawn,
		Respawn:  []string{"rk", "operator", "-L", "{server}"},
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

// TestMuteWriteRules is the lease write matrix: a lease replaces an indefinite
// flag; an indefinite mute replaces a lease; unmuting clears both; all through
// the atomic read-modify-write, and a corrupt file refuses to mutate.
func TestMuteWriteRules(t *testing.T) {
	newEntry := func(t *testing.T, dir string) Entry {
		t.Helper()
		e, err := Add(dir, "dev", Entry{
			Schedule: Schedule{Kind: ScheduleEvery, Interval: Duration{time.Minute}},
			Target:   Target{Kind: TargetPane, Pane: "%1"},
			Payload:  "x",
		})
		if err != nil {
			t.Fatal(err)
		}
		return e
	}

	t.Run("lease after flag leaves only muted_until", func(t *testing.T) {
		dir := t.TempDir()
		e := newEntry(t, dir)
		if ok, err := SetMuted(dir, "dev", e.ID, true); err != nil || !ok {
			t.Fatalf("SetMuted: ok=%v err=%v", ok, err)
		}
		until := time.Now().Add(5 * time.Minute).Unix()
		if ok, err := SetMuteLease(dir, "dev", e.ID, until); err != nil || !ok {
			t.Fatalf("SetMuteLease: ok=%v err=%v", ok, err)
		}
		entries, _ := LoadEntries(filepath.Join(dir, "dev.yaml"))
		if entries[0].Muted || entries[0].MutedUntil != until {
			t.Errorf("after lease: muted=%v muted_until=%d, want false/%d", entries[0].Muted, entries[0].MutedUntil, until)
		}
		data, _ := os.ReadFile(filepath.Join(dir, "dev.yaml"))
		if strings.Contains(string(data), "muted:") {
			t.Errorf("file still carries the muted: key:\n%s", data)
		}
	})

	t.Run("flag after lease leaves only muted", func(t *testing.T) {
		dir := t.TempDir()
		e := newEntry(t, dir)
		if ok, err := SetMuteLease(dir, "dev", e.ID, time.Now().Add(5*time.Minute).Unix()); err != nil || !ok {
			t.Fatalf("SetMuteLease: ok=%v err=%v", ok, err)
		}
		if ok, err := SetMuted(dir, "dev", e.ID, true); err != nil || !ok {
			t.Fatalf("SetMuted: ok=%v err=%v", ok, err)
		}
		entries, _ := LoadEntries(filepath.Join(dir, "dev.yaml"))
		if !entries[0].Muted || entries[0].MutedUntil != 0 {
			t.Errorf("after mute: muted=%v muted_until=%d, want true/0", entries[0].Muted, entries[0].MutedUntil)
		}
	})

	t.Run("unmute clears both", func(t *testing.T) {
		dir := t.TempDir()
		e := newEntry(t, dir)
		if ok, err := SetMuteLease(dir, "dev", e.ID, time.Now().Add(5*time.Minute).Unix()); err != nil || !ok {
			t.Fatalf("SetMuteLease: ok=%v err=%v", ok, err)
		}
		if ok, err := SetMuted(dir, "dev", e.ID, false); err != nil || !ok {
			t.Fatalf("SetMuted(false): ok=%v err=%v", ok, err)
		}
		data, _ := os.ReadFile(filepath.Join(dir, "dev.yaml"))
		if strings.Contains(string(data), "muted") {
			t.Errorf("file still carries a mute key:\n%s", data)
		}
	})

	t.Run("corrupt file refuses the lease mutation", func(t *testing.T) {
		dir := t.TempDir()
		if err := os.WriteFile(filepath.Join(dir, "dev.yaml"), []byte("{{{{"), 0o600); err != nil {
			t.Fatal(err)
		}
		if _, err := SetMuteLease(dir, "dev", "a3f9", time.Now().Unix()); err == nil {
			t.Fatal("SetMuteLease over a corrupt file succeeded")
		}
	})
}

// TestEnsureRoleEntryNarrowUpgrade: an old-shape seeded entry (retired keys,
// no respawn argv, user-tuned max and muted) gains ONLY the spec's respawn
// argv on re-seed — tuning stays, retired keys drop out on the marshal, and
// the call reports created=false.
func TestEnsureRoleEntryNarrowUpgrade(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "dev.yaml")
	oldShape := `
entries:
  - id: a3f9
    name: operator tick
    schedule: { kind: backoff, anchor: idle, min: 60s, max: 45m }
    target: { kind: role, role: operator }
    payload: "operator tick"
    deliver: immediate
    if_absent: respawn
    suppress_while: [operator-loop-fresh, nothing-tracked]
    muted: true
    pinned: true
`
	if err := os.WriteFile(path, []byte(oldShape), 0o600); err != nil {
		t.Fatal(err)
	}

	entry, created, err := EnsureRoleEntry(dir, "dev", roleTickSpec())
	if err != nil {
		t.Fatal(err)
	}
	if created {
		t.Error("created = true on an upgrade, want false")
	}
	if !reflect.DeepEqual(entry.Respawn, []string{"rk", "operator", "-L", "{server}"}) {
		t.Errorf("returned respawn = %v", entry.Respawn)
	}

	entries, diags := LoadEntries(path)
	if len(diags) != 0 || len(entries) != 1 {
		t.Fatalf("reload: entries=%v diags=%v", entries, diags)
	}
	got := entries[0]
	if !reflect.DeepEqual(got.Respawn, []string{"rk", "operator", "-L", "{server}"}) {
		t.Errorf("respawn = %v, want the spec argv", got.Respawn)
	}
	// User tuning survives: max 45m, muted true, and nothing else was touched.
	if got.Schedule.Max.Duration != 45*time.Minute || !got.Muted || !got.Pinned || got.Name != "operator tick" {
		t.Errorf("tuning lost: %+v", got)
	}
	data, _ := os.ReadFile(path)
	for _, retired := range []string{"anchor", "suppress_while"} {
		if strings.Contains(string(data), retired) {
			t.Errorf("file still carries retired key %q:\n%s", retired, data)
		}
	}
}

// TestEnsureRoleEntryNoUpgradeWhenRespawnPresent: a matched entry that already
// carries a respawn argv is a pure no-op — the file is byte-identical after
// the call.
func TestEnsureRoleEntryNoUpgradeWhenRespawnPresent(t *testing.T) {
	dir := t.TempDir()
	if _, created, err := EnsureRoleEntry(dir, "dev", roleTickSpec()); err != nil || !created {
		t.Fatalf("seed: created=%v err=%v", created, err)
	}
	path := filepath.Join(dir, "dev.yaml")
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if _, created, err := EnsureRoleEntry(dir, "dev", roleTickSpec()); err != nil || created {
		t.Fatalf("re-seed: created=%v err=%v", created, err)
	}
	after, _ := os.ReadFile(path)
	if string(before) != string(after) {
		t.Error("re-seed rewrote a file whose entry already carries respawn")
	}
}

// roleTickSpecWithDebounce is roleTickSpec carrying a wake_on debounce, the
// shape the operator seed has.
func roleTickSpecWithDebounce(d time.Duration) Entry {
	spec := roleTickSpec()
	spec.WakeOn = &WakeOn{Event: WakeAgentStateChange, Scope: WakeScopeServer, Debounce: Duration{d}}
	return spec
}

// TestEnsureRoleEntryDebounceBackfill: a matched entry whose wake_on debounce
// is below the spec's is raised to it in one save; every other field survives.
func TestEnsureRoleEntryDebounceBackfill(t *testing.T) {
	dir := t.TempDir()
	if _, created, err := EnsureRoleEntry(dir, "dev", roleTickSpecWithDebounce(10*time.Second)); err != nil || !created {
		t.Fatalf("seed: created=%v err=%v", created, err)
	}
	path := filepath.Join(dir, "dev.yaml")
	if ok, err := SetMuted(dir, "dev", mustOnlyEntry(t, path).ID, true); err != nil || !ok {
		t.Fatal("mute the seeded entry (user tuning to survive)")
	}

	entry, created, err := EnsureRoleEntry(dir, "dev", roleTickSpecWithDebounce(60*time.Second))
	if err != nil {
		t.Fatal(err)
	}
	if created {
		t.Error("created = true on an upgrade, want false")
	}
	if entry.WakeOn == nil || entry.WakeOn.Debounce.Duration != 60*time.Second {
		t.Errorf("returned debounce = %+v, want 60s", entry.WakeOn)
	}
	got := mustOnlyEntry(t, path)
	if got.WakeOn == nil || got.WakeOn.Debounce.Duration != 60*time.Second {
		t.Errorf("persisted debounce = %+v, want 60s", got.WakeOn)
	}
	if !got.Muted || got.WakeOn.Event != WakeAgentStateChange || got.WakeOn.Scope != WakeScopeServer || !got.Pinned {
		t.Errorf("tuning lost: %+v", got)
	}
}

// TestEnsureRoleEntryNoDebounceDowngrade: a debounce at or above the spec's is
// the user's — the file is byte-identical after the call.
func TestEnsureRoleEntryNoDebounceDowngrade(t *testing.T) {
	dir := t.TempDir()
	if _, created, err := EnsureRoleEntry(dir, "dev", roleTickSpecWithDebounce(5*time.Minute)); err != nil || !created {
		t.Fatalf("seed: created=%v err=%v", created, err)
	}
	path := filepath.Join(dir, "dev.yaml")
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	for _, d := range []time.Duration{60 * time.Second, 5 * time.Minute} {
		if _, created, err := EnsureRoleEntry(dir, "dev", roleTickSpecWithDebounce(d)); err != nil || created {
			t.Fatalf("re-seed(%v): created=%v err=%v", d, created, err)
		}
		after, _ := os.ReadFile(path)
		if string(before) != string(after) {
			t.Errorf("re-seed(%v) rewrote a file whose debounce is already ≥ spec", d)
		}
	}
}

// TestUpdateMergesFields: an apply that sets Schedule and Deliver leaves every
// other field identical after reload; a merged entry that fails validate()
// writes nothing; an absent id is (Entry{}, false, nil); a corrupt file
// refuses to mutate.
func TestUpdateMergesFields(t *testing.T) {
	newEntry := func(t *testing.T, dir string) Entry {
		t.Helper()
		e, err := Add(dir, "dev", Entry{
			Name:     "sweep",
			Schedule: Schedule{Kind: ScheduleEvery, Interval: Duration{time.Hour}},
			Target:   Target{Kind: TargetSession, Session: "4fe2"},
			Payload:  "check open PRs",
			IfAbsent: IfAbsentRespawn,
			Respawn:  []string{"rk", "operator"},
			CreatedBy: CreatedBy{
				Session: "4fe2",
				Pane:    "%7",
				At:      time.Now().Add(-time.Hour).Unix(),
			},
		})
		if err != nil {
			t.Fatal(err)
		}
		return e
	}

	t.Run("merge leaves every other field identical", func(t *testing.T) {
		dir := t.TempDir()
		e := newEntry(t, dir)
		if ok, err := SetMuted(dir, "dev", e.ID, true); err != nil || !ok {
			t.Fatalf("SetMuted: ok=%v err=%v", ok, err)
		}
		until := time.Now().Add(5 * time.Minute).Unix()
		if ok, err := SetMuteLease(dir, "dev", e.ID, until); err != nil || !ok {
			t.Fatalf("SetMuteLease: ok=%v err=%v", ok, err)
		}
		if ok, err := SetPinned(dir, "dev", e.ID, true); err != nil || !ok {
			t.Fatalf("SetPinned: ok=%v err=%v", ok, err)
		}
		path := filepath.Join(dir, "dev.yaml")
		before := mustOnlyEntry(t, path)

		newSchedule := Schedule{Kind: ScheduleBackoff, Min: Duration{3 * time.Minute}, Max: Duration{3 * time.Minute}}
		merged, ok, err := Update(dir, "dev", e.ID, func(e *Entry) {
			e.Schedule = newSchedule
			e.Deliver = DeliverWhenIdle
		})
		if err != nil || !ok {
			t.Fatalf("Update: ok=%v err=%v", ok, err)
		}
		if merged.Schedule != newSchedule || merged.Deliver != DeliverWhenIdle {
			t.Errorf("merged = %+v, want the new schedule and deliver", merged)
		}

		after := mustOnlyEntry(t, path)
		if after.Schedule != newSchedule || after.Deliver != DeliverWhenIdle {
			t.Errorf("reloaded schedule/deliver = %v/%q", after.Schedule, after.Deliver)
		}
		if after.ID != before.ID || after.Name != before.Name ||
			after.Target != before.Target || after.Payload != before.Payload ||
			after.IfAbsent != before.IfAbsent || !reflect.DeepEqual(after.Respawn, before.Respawn) ||
			after.Pinned != before.Pinned || after.Muted != before.Muted ||
			after.MutedUntil != before.MutedUntil || after.CreatedBy != before.CreatedBy {
			t.Errorf("identity fields drifted:\nbefore %+v\nafter  %+v", before, after)
		}
	})

	t.Run("a merge failing validate writes nothing", func(t *testing.T) {
		dir := t.TempDir()
		e := newEntry(t, dir)
		path := filepath.Join(dir, "dev.yaml")
		before, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		_, _, err = Update(dir, "dev", e.ID, func(e *Entry) {
			e.Schedule = Schedule{Kind: ScheduleBackoff, Min: Duration{5 * time.Minute}, Max: Duration{time.Minute}}
		})
		if err == nil {
			t.Fatal("Update with max < min succeeded")
		}
		after, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		if string(before) != string(after) {
			t.Error("entry file changed despite the rejected merge")
		}
	})

	t.Run("absent id is the Remove shape", func(t *testing.T) {
		dir := t.TempDir()
		newEntry(t, dir)
		merged, ok, err := Update(dir, "dev", "zzzz", func(e *Entry) { e.Name = "nope" })
		if err != nil || ok || !reflect.DeepEqual(merged, Entry{}) {
			t.Errorf("Update absent id: merged=%+v ok=%v err=%v, want zero/false/nil", merged, ok, err)
		}
	})

	t.Run("apply cannot move identity fields", func(t *testing.T) {
		dir := t.TempDir()
		e := newEntry(t, dir)
		path := filepath.Join(dir, "dev.yaml")
		before := mustOnlyEntry(t, path)

		merged, ok, err := Update(dir, "dev", e.ID, func(e *Entry) {
			e.ID = "zzzz"
			e.Target = Target{Kind: TargetPane, Pane: "%99"}
			e.CreatedBy = CreatedBy{}
			e.Muted = true
			e.MutedUntil = 123
			e.Pinned = true
			e.Name = "renamed"
		})
		if err != nil || !ok {
			t.Fatalf("Update: ok=%v err=%v", ok, err)
		}
		if merged.Name != "renamed" {
			t.Errorf("merged.Name = %q, want the apply's edit kept", merged.Name)
		}
		after := mustOnlyEntry(t, path)
		if after.ID != before.ID || after.Target != before.Target ||
			after.CreatedBy != before.CreatedBy || after.Muted != before.Muted ||
			after.MutedUntil != before.MutedUntil || after.Pinned != before.Pinned {
			t.Errorf("identity fields moved:\nbefore %+v\nafter  %+v", before, after)
		}
	})

	t.Run("corrupt file refuses to mutate", func(t *testing.T) {
		dir := t.TempDir()
		if err := os.WriteFile(filepath.Join(dir, "dev.yaml"), []byte("{{{{"), 0o600); err != nil {
			t.Fatal(err)
		}
		_, _, err := Update(dir, "dev", "a3f9", func(e *Entry) { e.Name = "nope" })
		if err == nil || !strings.Contains(err.Error(), "refusing to mutate") {
			t.Errorf("Update over a corrupt file: err = %v, want refusing to mutate", err)
		}
	})
}

func mustOnlyEntry(t *testing.T, path string) Entry {
	t.Helper()
	entries, diags := LoadEntries(path)
	if len(diags) != 0 || len(entries) != 1 {
		t.Fatalf("reload: entries=%v diags=%v", entries, diags)
	}
	return entries[0]
}
