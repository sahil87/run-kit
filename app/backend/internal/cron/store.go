package cron

import (
	"errors"
	"fmt"
	"io/fs"
	"os"

	"gopkg.in/yaml.v3"

	"rk/internal/fsatomic"
)

// store.go — the tolerant entry-file load and the atomic mutation helpers.
// Tolerance posture (R2): unknown keys are ignored; a bad entry is skipped
// with a per-entry diagnostic, never failing the file; an absent file is an
// empty set with no error; a file that fails YAML parse entirely is an empty
// set plus one diagnostic — a corrupt file never aborts a tick.

// entryFileRaw decodes the file with each entry kept as a node so one bad
// entry (bad duration, wrong shape) cannot sink the file.
type entryFileRaw struct {
	Entries []yaml.Node `yaml:"entries"`
}

// entryFileOut is the write shape — exactly the intent fields, nothing else.
type entryFileOut struct {
	Entries []Entry `yaml:"entries"`
}

// LoadEntries reads an entry file tolerantly. Absent file ⇒ (nil, nil).
func LoadEntries(path string) ([]Entry, []Diagnostic) {
	data, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return nil, nil
		}
		return nil, []Diagnostic{{Reason: "entry-file-unreadable", Detail: err.Error()}}
	}
	var raw entryFileRaw
	if err := yaml.Unmarshal(data, &raw); err != nil {
		return nil, []Diagnostic{{Reason: "entry-file-corrupt", Detail: err.Error()}}
	}
	var entries []Entry
	var diags []Diagnostic
	for i, node := range raw.Entries {
		var e Entry
		if err := node.Decode(&e); err != nil {
			diags = append(diags, Diagnostic{Reason: "entry-invalid",
				Detail: fmt.Sprintf("entry #%d: %v", i, err)})
			continue
		}
		if err := e.validate(); err != nil {
			diags = append(diags, Diagnostic{EntryID: e.ID, Reason: "entry-invalid",
				Detail: fmt.Sprintf("entry #%d: %v", i, err)})
			continue
		}
		entries = append(entries, e)
	}
	return entries, diags
}

// saveEntries writes the entry file atomically (temp + rename via fsatomic).
func saveEntries(path string, entries []Entry) error {
	out, err := yaml.Marshal(entryFileOut{Entries: entries})
	if err != nil {
		return fmt.Errorf("marshaling entries: %w", err)
	}
	return fsatomic.WriteFile(path, out, fileMode)
}

// loadForMutate reads the entry file for a mutation — a corrupt file is an
// error here (a mutation must never silently drop existing intent).
func loadForMutate(dir, slug string) (path string, entries []Entry, err error) {
	path, err = EntriesPath(dir, slug)
	if err != nil {
		return "", nil, err
	}
	data, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return path, nil, nil
	}
	if err != nil {
		return "", nil, err
	}
	var raw entryFileRaw
	if err := yaml.Unmarshal(data, &raw); err != nil {
		return "", nil, fmt.Errorf("entry file %s is corrupt; refusing to mutate: %w", path, err)
	}
	for i, node := range raw.Entries {
		var e Entry
		if err := node.Decode(&e); err != nil {
			return "", nil, fmt.Errorf("entry file %s entry #%d is corrupt; refusing to mutate: %w", path, i, err)
		}
		entries = append(entries, e)
	}
	return path, entries, nil
}

// MaxEntriesPerServer caps one server's entry file — the cron-spam guard
// against misbehaving creators. Add refuses past it; evaluation defensively
// processes only the first cap-many entries of a (hand-edited) larger file.
const MaxEntriesPerServer = 50

// ValidateRespawnIntent is the add-time gate for if_absent: respawn: role and
// pane targets have no built-in way back (only session targets default to the
// closed-ring resume), so they REQUIRE a caller-supplied respawn argv. It is
// deliberately NOT part of validate(): an existing on-disk entry in this state
// keeps loading and degrades to notify at fire time.
func ValidateRespawnIntent(e Entry) error {
	if e.IfAbsent != IfAbsentRespawn || len(e.Respawn) > 0 {
		return nil
	}
	switch e.Target.Kind {
	case TargetRole, TargetPane:
		return fmt.Errorf("if_absent %q on a %s target requires a respawn command — only session targets have a default (resume)", e.IfAbsent, e.Target.Kind)
	}
	return nil
}

// Add appends an entry, generating its 4-char id (uniqueness within the
// server's file). The entry's ID field is ignored; the assigned entry is
// returned.
func Add(dir, slug string, e Entry) (Entry, error) {
	if err := EnsureDir(dir); err != nil {
		return Entry{}, err
	}
	path, entries, err := loadForMutate(dir, slug)
	if err != nil {
		return Entry{}, err
	}
	if len(entries) >= MaxEntriesPerServer {
		return Entry{}, fmt.Errorf("server %s already holds the maximum %d cron entries", slug, MaxEntriesPerServer)
	}
	taken := make(map[string]bool, len(entries))
	for _, existing := range entries {
		taken[existing.ID] = true
	}
	id, err := newID(taken)
	if err != nil {
		return Entry{}, err
	}
	e.ID = id
	if err := e.validate(); err != nil {
		return Entry{}, err
	}
	if err := ValidateRespawnIntent(e); err != nil {
		return Entry{}, err
	}
	if err := saveEntries(path, append(entries, e)); err != nil {
		return Entry{}, err
	}
	return e, nil
}

// EnsureRoleEntry seeds a role-target entry if this server has none yet. It
// scans the existing entries for a Target{Kind: TargetRole, Role:
// spec.Target.Role} match; a miss calls Add with spec (created=true). On a
// hit the ONLY mutations are two narrow upgrades, written in one save when
// either applies (the marshal drops any retired keys as a side effect):
//
//   - if_absent: respawn with an empty respawn argv takes the spec's non-empty
//     argv;
//   - a wake_on debounce strictly BELOW the spec's (same event) is raised to
//     it — a sub-poll debounce is a dead knob, while a user who tuned it higher
//     keeps their value.
//
// Every other field (min/max, muted, name, payload…) is the user's tuning and
// is never reconciled. The role target is the idempotency key, not any field
// value.
func EnsureRoleEntry(dir, slug string, spec Entry) (entry Entry, created bool, err error) {
	// The (kind, role) pair is the idempotency key: a mistargeted spec must
	// fail loudly, never plant a non-role entry the scan can never match.
	if spec.Target.Kind != TargetRole || spec.Target.Role == "" {
		return Entry{}, false, fmt.Errorf("EnsureRoleEntry requires a role target with a non-empty role, got kind %q role %q", spec.Target.Kind, spec.Target.Role)
	}
	path, entries, err := loadForMutate(dir, slug)
	if err != nil {
		return Entry{}, false, err
	}
	for i, e := range entries {
		if e.Target.Kind == TargetRole && e.Target.Role == spec.Target.Role {
			upgraded := false
			if e.IfAbsent == IfAbsentRespawn && len(e.Respawn) == 0 && len(spec.Respawn) > 0 {
				entries[i].Respawn = spec.Respawn
				upgraded = true
			}
			if e.WakeOn != nil && spec.WakeOn != nil && e.WakeOn.Event == spec.WakeOn.Event &&
				e.WakeOn.Debounce.Duration < spec.WakeOn.Debounce.Duration {
				w := *e.WakeOn
				w.Debounce = spec.WakeOn.Debounce
				entries[i].WakeOn = &w
				upgraded = true
			}
			if upgraded {
				if err := saveEntries(path, entries); err != nil {
					return Entry{}, false, err
				}
			}
			return entries[i], false, nil
		}
	}
	entry, err = Add(dir, slug, spec)
	if err != nil {
		return Entry{}, false, err
	}
	return entry, true, nil
}

// Remove deletes the entry with the given id. Returns false when absent.
func Remove(dir, slug, id string) (bool, error) {
	path, entries, err := loadForMutate(dir, slug)
	if err != nil {
		return false, err
	}
	kept := entries[:0:0]
	found := false
	for _, e := range entries {
		if e.ID == id {
			found = true
			continue
		}
		kept = append(kept, e)
	}
	if !found {
		return false, nil
	}
	return true, saveEntries(path, kept)
}

// setFlag flips a bool field on the entry with the given id.
func setFlag(dir, slug, id string, set func(*Entry)) (bool, error) {
	path, entries, err := loadForMutate(dir, slug)
	if err != nil {
		return false, err
	}
	for i := range entries {
		if entries[i].ID == id {
			set(&entries[i])
			return true, saveEntries(path, entries)
		}
	}
	return false, nil
}

// SetMuted mutes/unmutes the entry with the given id. An indefinite mute
// clears any lease (indefinite wins); unmuting clears both. Returns false when
// absent.
func SetMuted(dir, slug, id string, muted bool) (bool, error) {
	return setFlag(dir, slug, id, func(e *Entry) {
		e.Muted = muted
		e.MutedUntil = 0
	})
}

// SetMuteLease mutes the entry with the given id until the given unix time —
// a bounded mute, so it clears the indefinite flag (an earlier plain mute
// does not outlive the lease). Returns false when absent.
func SetMuteLease(dir, slug, id string, until int64) (bool, error) {
	return setFlag(dir, slug, id, func(e *Entry) {
		e.Muted = false
		e.MutedUntil = until
	})
}

// SetPinned pins/unpins the entry with the given id. Returns false when absent.
func SetPinned(dir, slug, id string, pinned bool) (bool, error) {
	return setFlag(dir, slug, id, func(e *Entry) { e.Pinned = pinned })
}
