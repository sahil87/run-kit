package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"rk/internal/cron"
)

// NOTE (tmux safety): edit touches disk only (entry file, delivery log, tick
// flock) — server resolution routes through the stubCronTMUX seam, so these
// tests never spawn a tmux subprocess.

const cronEditFixture = `
entries:
  - id: a3f9
    name: hourly sweep
    schedule: { kind: every, interval: 1h }
    target: { kind: pane, pane: "%42" }
    payload: "sweep"
    deliver: immediate
    if_absent: skip
    created_by: { pane: "%42", at: 1756999999 }
  - id: b8k1
    name: op tick
    schedule: { kind: backoff, min: 60s, max: 30m }
    target: { kind: role, role: operator }
    payload: "tick"
`

// cronEditLogLines reads the delivery log for slug from dir.
func cronEditLogLines(t *testing.T, dir, slug string) []cron.LogLine {
	t.Helper()
	return cron.ReadLog(filepath.Join(dir, slug+".log"))
}

// wantRescheduledLine asserts exactly one log line: the edit's anchor reset
// (Reason: edit, Outcome: rescheduled, no target).
func wantRescheduledLine(t *testing.T, dir, slug, id string) {
	t.Helper()
	lines := cronEditLogLines(t, dir, slug)
	if len(lines) != 1 {
		t.Fatalf("log lines = %+v, want exactly one rescheduled line", lines)
	}
	l := lines[0]
	if l.Entry != id || l.Reason != "edit" || l.Outcome != "rescheduled" || l.Target != "" {
		t.Errorf("log line = %+v, want {entry %s, reason edit, outcome rescheduled, no target}", l, id)
	}
}

// TestCronEditSchedule: --idle-every rewrites the stored schedule to the flat
// ladder, appends one rescheduled line (the anchor reset), and prints the
// edited data line with the new schedule summary.
func TestCronEditSchedule(t *testing.T) {
	dir := stubCronDir(t)
	stubCronTMUX(t)
	writeCronFixture(t, dir, "work", cronEditFixture)

	stdout, _, err := runCronCmd(t, "edit", "a3f9", "--idle-every", "3m")
	if err != nil {
		t.Fatalf("edit: %v", err)
	}
	entries := loadCronEntries(t, dir, "work")
	if len(entries) != 2 {
		t.Fatalf("entries = %d, want 2", len(entries))
	}
	s := entries[0].Schedule
	if s.Kind != cron.ScheduleBackoff ||
		s.Min.Duration != 3*time.Minute || s.Max.Duration != 3*time.Minute {
		t.Errorf("schedule = %+v, want the flat ladder backoff 3m→3m", s)
	}
	if entries[0].Payload != "sweep" || entries[0].Target.Pane != "%42" {
		t.Errorf("entry = %+v, want payload/target untouched", entries[0])
	}
	wantRescheduledLine(t, dir, "work", "a3f9")
	if !strings.Contains(stdout, "edited a3f9 hourly sweep [backoff 3m→3m -> pane:%42]") {
		t.Errorf("stdout = %q, want the edited data line with the backoff 3m→3m summary", stdout)
	}
}

// TestCronEditDeliverOnly: a deliver-only edit changes the field and logs the
// rescheduled line (the deliver policy anchors the schedule kinds too).
func TestCronEditDeliverOnly(t *testing.T) {
	dir := stubCronDir(t)
	stubCronTMUX(t)
	writeCronFixture(t, dir, "work", cronEditFixture)

	stdout, _, err := runCronCmd(t, "edit", "a3f9", "--deliver", "skip-if-busy")
	if err != nil {
		t.Fatalf("edit: %v", err)
	}
	entries := loadCronEntries(t, dir, "work")
	if entries[0].Deliver != cron.DeliverSkipIfBusy {
		t.Errorf("deliver = %q, want skip-if-busy", entries[0].Deliver)
	}
	if entries[0].Schedule.Kind != cron.ScheduleEvery || entries[0].Schedule.Interval.Duration != time.Hour {
		t.Errorf("schedule = %+v, want the stored every 1h kept", entries[0].Schedule)
	}
	wantRescheduledLine(t, dir, "work", "a3f9")
	if !strings.Contains(stdout, "edited a3f9 hourly sweep [every 1h -> pane:%42]") {
		t.Errorf("stdout = %q, want the edited data line with the kept schedule", stdout)
	}
}

// TestCronEditNameOnlyNoLogLine: a name-only edit appends no rescheduled line
// (the schedule anchor must not move).
func TestCronEditNameOnlyNoLogLine(t *testing.T) {
	dir := stubCronDir(t)
	stubCronTMUX(t)
	writeCronFixture(t, dir, "work", cronEditFixture)

	if _, _, err := runCronCmd(t, "edit", "a3f9", "--name", "renamed"); err != nil {
		t.Fatalf("edit: %v", err)
	}
	entries := loadCronEntries(t, dir, "work")
	if entries[0].Name != "renamed" {
		t.Errorf("name = %q, want renamed", entries[0].Name)
	}
	if lines := cronEditLogLines(t, dir, "work"); len(lines) != 0 {
		t.Errorf("log lines = %+v, want none for a name-only edit", lines)
	}
}

// TestCronEditNoopNoLogLine: re-giving the stored schedule is a no-op merge —
// no rescheduled line (a spurious reset would silently delay a due fire).
func TestCronEditNoopNoLogLine(t *testing.T) {
	dir := stubCronDir(t)
	stubCronTMUX(t)
	writeCronFixture(t, dir, "work", cronEditFixture)

	if _, _, err := runCronCmd(t, "edit", "a3f9", "--every", "1h"); err != nil {
		t.Fatalf("edit: %v", err)
	}
	if lines := cronEditLogLines(t, dir, "work"); len(lines) != 0 {
		t.Errorf("log lines = %+v, want none for a no-op schedule edit", lines)
	}
}

// TestCronEditFlagMatrix: the usage-error classes — bare edit, two schedule
// flags, --min without --backoff (even on a stored backoff entry), the
// immutable target flags (cobra's unknown-flag path, exit 2), a bad --deliver,
// and --respawn without the respawn policy. All exit 2 and leave the entry
// file byte-identical.
func TestCronEditFlagMatrix(t *testing.T) {
	cases := []struct {
		name      string
		args      []string
		wantInErr string
	}{
		{"bare edit", []string{"edit", "a3f9"}, "nothing to edit"},
		{"two schedule flags", []string{"edit", "a3f9", "--every", "1h", "--backoff"}, "exactly one schedule flag"},
		{"min without backoff on a backoff entry", []string{"edit", "b8k1", "--min", "1m"}, "--min/--max only apply with --backoff"},
		{"role is immutable", []string{"edit", "a3f9", "--role", "operator"}, "unknown flag"},
		{"session is immutable", []string{"edit", "a3f9", "--session", "abc123"}, "unknown flag"},
		{"pane is immutable", []string{"edit", "a3f9", "--pane", "%9"}, "unknown flag"},
		{"bad deliver", []string{"edit", "a3f9", "--deliver", "sometimes"}, "invalid --deliver value"},
		{"respawn without if-absent respawn", []string{"edit", "a3f9", "--respawn", "rk"}, "--respawn only applies with --if-absent respawn"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			dir := stubCronDir(t)
			stubCronTMUX(t)
			writeCronFixture(t, dir, "work", cronEditFixture)
			before, _ := os.ReadFile(filepath.Join(dir, "work.yaml"))

			_, _, err := runCronCmd(t, tc.args...)
			if err == nil || !strings.Contains(err.Error(), tc.wantInErr) {
				t.Fatalf("%v: err = %v, want %q", tc.args, err, tc.wantInErr)
			}
			if code := exitCode(err); code != exitUsage {
				t.Errorf("%v: exit code = %d, want %d", tc.args, code, exitUsage)
			}
			after, _ := os.ReadFile(filepath.Join(dir, "work.yaml"))
			if string(after) != string(before) {
				t.Errorf("%v: entry file changed on a usage error", tc.args)
			}
			if lines := cronEditLogLines(t, dir, "work"); len(lines) != 0 {
				t.Errorf("%v: log lines = %+v, want none", tc.args, lines)
			}
		})
	}
}

// TestCronEditUnknownID: an unknown id is the rm/mute/pin shape — `no entry
// <id>` on the error stream, exit 1.
func TestCronEditUnknownID(t *testing.T) {
	dir := stubCronDir(t)
	stubCronTMUX(t)
	writeCronFixture(t, dir, "work", cronEditFixture)

	_, _, err := runCronCmd(t, "edit", "zz9z", "--name", "x")
	if err == nil || !strings.Contains(err.Error(), "no entry zz9z") {
		t.Fatalf("err = %v, want no entry zz9z", err)
	}
	if code := exitCode(err); code != 1 {
		t.Errorf("exit code = %d, want 1", code)
	}
}

// TestCronEditIfAbsentClearsRespawn: setting a non-respawn --if-absent clears
// the stored respawn argv (an argv without the policy is dead weight), and an
// if-absent-only edit logs no rescheduled line.
func TestCronEditIfAbsentClearsRespawn(t *testing.T) {
	dir := stubCronDir(t)
	stubCronTMUX(t)
	writeCronFixture(t, dir, "work", `
entries:
  - id: r5p1
    name: respawner
    schedule: { kind: every, interval: 1h }
    target: { kind: session, session: 4fe2abc }
    payload: "tick"
    if_absent: respawn
    respawn: [rk, operator]
`)

	if _, _, err := runCronCmd(t, "edit", "r5p1", "--if-absent", "skip"); err != nil {
		t.Fatalf("edit: %v", err)
	}
	entries := loadCronEntries(t, dir, "work")
	if len(entries) != 1 {
		t.Fatalf("entries = %d, want 1", len(entries))
	}
	if entries[0].IfAbsent != cron.IfAbsentSkip {
		t.Errorf("if_absent = %q, want skip", entries[0].IfAbsent)
	}
	if len(entries[0].Respawn) != 0 {
		t.Errorf("respawn = %v, want cleared", entries[0].Respawn)
	}
	if lines := cronEditLogLines(t, dir, "work"); len(lines) != 0 {
		t.Errorf("log lines = %+v, want none for an if-absent-only edit", lines)
	}
}

// TestCronEditPreservesFlagsAndCreator: mute/pin/created_by/target survive a
// schedule edit byte-for-byte — edit never touches identity or flag fields.
func TestCronEditPreservesFlagsAndCreator(t *testing.T) {
	dir := stubCronDir(t)
	stubCronTMUX(t)
	writeCronFixture(t, dir, "work", `
entries:
  - id: a3f9
    name: hourly sweep
    schedule: { kind: every, interval: 1h }
    target: { kind: pane, pane: "%42" }
    payload: "sweep"
    pinned: true
    muted: true
    created_by: { session: 4fe2abc, pane: "%42", at: 1756999999 }
`)

	if _, _, err := runCronCmd(t, "edit", "a3f9", "--every", "30m"); err != nil {
		t.Fatalf("edit: %v", err)
	}
	entries := loadCronEntries(t, dir, "work")
	if len(entries) != 1 {
		t.Fatalf("entries = %d, want 1", len(entries))
	}
	e := entries[0]
	if e.Schedule.Interval.Duration != 30*time.Minute {
		t.Errorf("schedule = %+v, want every 30m", e.Schedule)
	}
	want := cron.CreatedBy{Session: "4fe2abc", Pane: "%42", At: 1756999999}
	if !e.Pinned || !e.Muted || e.CreatedBy != want || e.Target.Pane != "%42" || e.Payload != "sweep" {
		t.Errorf("entry = %+v, want pinned/muted/created_by/target/payload preserved", e)
	}
	wantRescheduledLine(t, dir, "work", "a3f9")
}

// TestCronEditHelpText: the verb's help states the replace semantics and the
// target/creator immutability rule, and the parent lists the new verb.
func TestCronEditHelpText(t *testing.T) {
	if !strings.Contains(cronEditCmd.Use, "edit <id>") {
		t.Errorf("edit Use = %q, want the <id> positional", cronEditCmd.Use)
	}
	for _, want := range []string{
		"to retarget, add a new entry — a target change is a different entry",
		"REPLACES",
		"rescheduled",
	} {
		if !strings.Contains(cronEditCmd.Long, want) {
			t.Errorf("edit Long missing %q", want)
		}
	}
	if !strings.Contains(cronCmd.Short, "edit") {
		t.Errorf("cron parent Short = %q, want edit in the verb list", cronCmd.Short)
	}
	if !strings.Contains(cronCmd.Long, "`edit`") {
		t.Errorf("cron parent Long = %q, want the edit sentence", cronCmd.Long)
	}
	if f := cronEditCmd.Flags().Lookup("role"); f != nil {
		t.Error("edit must not define --role — the target is immutable")
	}
	if f := cronEditCmd.Flags().Lookup("session"); f != nil {
		t.Error("edit must not define --session — the target is immutable")
	}
	if f := cronEditCmd.Flags().Lookup("pane"); f != nil {
		t.Error("edit must not define --pane — the target is immutable")
	}
}
