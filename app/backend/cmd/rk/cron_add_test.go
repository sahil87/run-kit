package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"rk/internal/cron"
)

// NOTE (tmux safety): these tests never spawn a tmux subprocess. The window
// role and pane session reads route through the cronWindowRoleFn /
// cronPaneSessionFn seams, which the tests stub; the writes go to a temp
// state dir via stubCronDir.

// cronAddFixedNow pins the created_by.at seam.
const cronAddFixedNow = 1757000000

func stubCronAddSeams(t *testing.T, windowRole string, windowRoleErr error) {
	t.Helper()
	origNow := cronNowFn
	cronNowFn = func() time.Time { return time.Unix(cronAddFixedNow, 0) }
	t.Cleanup(func() { cronNowFn = origNow })
	origRole := cronWindowRoleFn
	cronWindowRoleFn = func(context.Context, string, string) (string, error) {
		return windowRole, windowRoleErr
	}
	t.Cleanup(func() { cronWindowRoleFn = origRole })
	stubCronAddPaneSession(t, "", nil)
}

// stubCronAddPaneSession points the caller-pane session read seam at a fixed
// (ref, err) result.
func stubCronAddPaneSession(t *testing.T, ref string, err error) {
	t.Helper()
	orig := cronPaneSessionFn
	cronPaneSessionFn = func(context.Context, string, string) (string, error) {
		return ref, err
	}
	t.Cleanup(func() { cronPaneSessionFn = orig })
}

// loadCronEntries reads back the entry file for slug from dir.
func loadCronEntries(t *testing.T, dir, slug string) []cron.Entry {
	t.Helper()
	entries, diags := cron.LoadEntries(filepath.Join(dir, slug+".yaml"))
	if len(diags) != 0 {
		t.Fatalf("load diagnostics = %v, want none", diags)
	}
	return entries
}

// TestCronAddEvery: inside a pane on socket work, `add --every 1h` writes a
// schema-valid entry with the caller as creator (pane + now, no session), the
// pane as default target (the window holds no role), the derived name, and
// the assigned id on stdout.
func TestCronAddEvery(t *testing.T) {
	dir := stubCronDir(t)
	stubCronTMUX(t)
	stubCronAddSeams(t, "", nil)
	t.Setenv("TMUX_PANE", "%12")

	stdout, _, err := runCronCmd(t, "add", "check PRs", "--every", "1h")
	if err != nil {
		t.Fatalf("add: %v", err)
	}
	entries := loadCronEntries(t, dir, "work")
	if len(entries) != 1 {
		t.Fatalf("entries = %d, want 1", len(entries))
	}
	e := entries[0]
	if len(e.ID) != 4 {
		t.Errorf("id = %q, want a 4-char assigned id", e.ID)
	}
	if e.Schedule.Kind != cron.ScheduleEvery || e.Schedule.Interval.Duration != time.Hour {
		t.Errorf("schedule = %+v, want every 1h", e.Schedule)
	}
	if e.Payload != "check PRs" || e.Name != "check PRs" {
		t.Errorf("payload/name = %q/%q, want check PRs for both", e.Payload, e.Name)
	}
	if e.Target.Kind != cron.TargetPane || e.Target.Pane != "%12" {
		t.Errorf("target = %+v, want pane %%12", e.Target)
	}
	if e.CreatedBy.Pane != "%12" || e.CreatedBy.At != cronAddFixedNow || e.CreatedBy.Session != "" {
		t.Errorf("created_by = %+v, want {pane %%12, at %d, empty session}", e.CreatedBy, cronAddFixedNow)
	}
	if e.Deliver != cron.DeliverImmediate || e.IfAbsent != cron.IfAbsentSkip {
		t.Errorf("deliver/if_absent = %q/%q, want the defaults", e.Deliver, e.IfAbsent)
	}
	if !strings.Contains(stdout, e.ID) || !strings.Contains(stdout, "every 1h") {
		t.Errorf("stdout = %q, want the assigned id and the entry summary", stdout)
	}
}

// TestCronAddScheduleFlagMatrix: exactly one schedule flag is required;
// --min/--max are backoff-only; --every must be positive. All are usage-class
// (exit 2) and leave the state dir untouched.
func TestCronAddScheduleFlagMatrix(t *testing.T) {
	cases := []struct {
		name      string
		args      []string
		wantInErr string
	}{
		{"no schedule flag", []string{"add", "x"}, "exactly one schedule flag"},
		{"two schedule flags", []string{"add", "x", "--every", "1h", "--backoff"}, "exactly one schedule flag"},
		{"min without backoff", []string{"add", "x", "--every", "1h", "--min", "2m"}, "--min/--max only apply with --backoff"},
		{"min with backoff is legal", []string{"add", "x", "--backoff", "--min", "1m"}, ""},
		{"zero every", []string{"add", "x", "--every", "0s"}, "--every must be a positive duration"},
		{"negative every", []string{"add", "x", "--every", "-1h"}, "--every must be a positive duration"},
		{"bad deliver", []string{"add", "x", "--every", "1h", "--deliver", "sometimes"}, "invalid --deliver value"},
		{"bad if-absent", []string{"add", "x", "--every", "1h", "--if-absent", "poke"}, "invalid --if-absent value"},
		{"cron wrong field count", []string{"add", "x", "--cron", "0 3 *"}, "--cron must be a 5-field cron expression"},
		{"cron empty", []string{"add", "x", "--cron", ""}, "--cron must be a 5-field cron expression"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			dir := stubCronDir(t)
			stubCronAddSeams(t, "", nil)
			t.Setenv("TMUX_PANE", "%12")

			_, _, err := runCronCmd(t, tc.args...)
			if tc.wantInErr == "" {
				if err != nil {
					t.Fatalf("%v: err = %v, want success", tc.args, err)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), tc.wantInErr) {
				t.Fatalf("%v: err = %v, want %q", tc.args, err, tc.wantInErr)
			}
			if code := exitCode(err); code != exitUsage {
				t.Errorf("%v: exit code = %d, want %d", tc.args, code, exitUsage)
			}
			if fis, _ := os.ReadDir(dir); len(fis) != 0 {
				t.Errorf("%v: state dir gained %v, want untouched", tc.args, fis)
			}
		})
	}
}

// TestCronAddBackoff: bare --backoff builds the operator-idle ladder with the
// 60s/30m defaults; --min/--max override.
func TestCronAddBackoff(t *testing.T) {
	dir := stubCronDir(t)
	stubCronTMUX(t)
	stubCronAddSeams(t, "", nil)
	t.Setenv("TMUX_PANE", "%12")

	if _, _, err := runCronCmd(t, "add", "tick", "--backoff"); err != nil {
		t.Fatalf("add --backoff: %v", err)
	}
	if _, _, err := runCronCmd(t, "add", "tick2", "--backoff", "--min", "2m", "--max", "5m"); err != nil {
		t.Fatalf("add --backoff --min --max: %v", err)
	}
	entries := loadCronEntries(t, dir, "work")
	if len(entries) != 2 {
		t.Fatalf("entries = %d, want 2", len(entries))
	}
	s := entries[0].Schedule
	if s.Kind != cron.ScheduleBackoff || s.Anchor != "operator-idle" ||
		s.Min.Duration != time.Minute || s.Max.Duration != 30*time.Minute {
		t.Errorf("schedule = %+v, want backoff operator-idle 60s→30m", s)
	}
	s = entries[1].Schedule
	if s.Min.Duration != 2*time.Minute || s.Max.Duration != 5*time.Minute {
		t.Errorf("schedule = %+v, want the 2m/5m overrides", s)
	}
}

// TestCronAddCronExpr: --cron stores the expression as schema-valid intent and
// prints the not-evaluated note to stderr (not stdout).
func TestCronAddCronExpr(t *testing.T) {
	dir := stubCronDir(t)
	stubCronTMUX(t)
	stubCronAddSeams(t, "", nil)
	t.Setenv("TMUX_PANE", "%12")

	stdout, stderr, err := runCronCmd(t, "add", "nightly", "--cron", "0 3 * * *")
	if err != nil {
		t.Fatalf("add --cron: %v", err)
	}
	entries := loadCronEntries(t, dir, "work")
	if len(entries) != 1 || entries[0].Schedule.Kind != cron.ScheduleCron || entries[0].Schedule.Expr != "0 3 * * *" {
		t.Fatalf("entries = %+v, want one cron entry with the stored expression", entries)
	}
	if !strings.Contains(stderr, "not evaluated yet") {
		t.Errorf("stderr = %q, want the not-evaluated note", stderr)
	}
	if strings.Contains(stdout, "not evaluated yet") {
		t.Errorf("stdout = %q — the note is chatter, not data", stdout)
	}
}

// TestCronAddOperatorWindowDefaultsRoleTarget: when the caller's window
// carries the operator role, the default target is role:operator.
func TestCronAddOperatorWindowDefaultsRoleTarget(t *testing.T) {
	dir := stubCronDir(t)
	stubCronTMUX(t)
	stubCronAddSeams(t, "operator", nil)
	t.Setenv("TMUX_PANE", "%12")

	if _, _, err := runCronCmd(t, "add", "sweep", "--every", "5m"); err != nil {
		t.Fatalf("add: %v", err)
	}
	entries := loadCronEntries(t, dir, "work")
	if len(entries) != 1 || entries[0].Target.Kind != cron.TargetRole || entries[0].Target.Role != cron.RoleOperator {
		t.Fatalf("entries = %+v, want target role:operator", entries)
	}
	if entries[0].CreatedBy.Pane != "%12" {
		t.Errorf("created_by = %+v, want the caller pane captured", entries[0].CreatedBy)
	}
}

// TestCronAddRoleReadFailureDegradesToPane: a failed window-role read degrades
// the add to the pane target — never an abort.
func TestCronAddRoleReadFailureDegradesToPane(t *testing.T) {
	dir := stubCronDir(t)
	stubCronTMUX(t)
	stubCronAddSeams(t, "", fmt.Errorf("server gone"))
	t.Setenv("TMUX_PANE", "%12")

	_, stderr, err := runCronCmd(t, "add", "sweep", "--every", "5m")
	if err != nil {
		t.Fatalf("add: %v — a role-read failure must not abort the add", err)
	}
	entries := loadCronEntries(t, dir, "work")
	if len(entries) != 1 || entries[0].Target.Kind != cron.TargetPane || entries[0].Target.Pane != "%12" {
		t.Fatalf("entries = %+v, want the pane-target fallback", entries)
	}
	if !strings.Contains(stderr, "window role unreadable") {
		t.Errorf("stderr = %q, want the degradation note", stderr)
	}
}

// TestCronAddAgentPaneDefaultsSessionTarget: the ladder's middle rung — a
// non-operator pane carrying a parsed agent-session ref defaults the target
// to that session (previously the raw pane), and created_by.session records
// the ref.
func TestCronAddAgentPaneDefaultsSessionTarget(t *testing.T) {
	dir := stubCronDir(t)
	stubCronTMUX(t)
	stubCronAddSeams(t, "", nil)
	stubCronAddPaneSession(t, "4fe2abc-1c3b", nil)
	t.Setenv("TMUX_PANE", "%12")

	if _, _, err := runCronCmd(t, "add", "sweep", "--every", "1h"); err != nil {
		t.Fatalf("add: %v", err)
	}
	entries := loadCronEntries(t, dir, "work")
	if len(entries) != 1 || entries[0].Target.Kind != cron.TargetSession || entries[0].Target.Session != "4fe2abc-1c3b" {
		t.Fatalf("entries = %+v, want target session:4fe2abc-1c3b", entries)
	}
	if entries[0].CreatedBy.Session != "4fe2abc-1c3b" || entries[0].CreatedBy.Pane != "%12" {
		t.Errorf("created_by = %+v, want the session ref and caller pane captured", entries[0].CreatedBy)
	}
}

// TestCronAddOperatorWindowKeepsRoleTargetWithSession: the role rung still
// wins over the session rung, and created_by.session is filled regardless of
// the target kind the ladder selected.
func TestCronAddOperatorWindowKeepsRoleTargetWithSession(t *testing.T) {
	dir := stubCronDir(t)
	stubCronTMUX(t)
	stubCronAddSeams(t, "operator", nil)
	stubCronAddPaneSession(t, "4fe2abc-1c3b", nil)
	t.Setenv("TMUX_PANE", "%12")

	if _, _, err := runCronCmd(t, "add", "sweep", "--every", "5m"); err != nil {
		t.Fatalf("add: %v", err)
	}
	entries := loadCronEntries(t, dir, "work")
	if len(entries) != 1 || entries[0].Target.Kind != cron.TargetRole || entries[0].Target.Role != cron.RoleOperator {
		t.Fatalf("entries = %+v, want target role:operator", entries)
	}
	want := cron.CreatedBy{Session: "4fe2abc-1c3b", Pane: "%12", At: cronAddFixedNow}
	if entries[0].CreatedBy != want {
		t.Errorf("created_by = %+v, want %+v", entries[0].CreatedBy, want)
	}
}

// TestCronAddRoleReadFailureDegradesToSession: with the role read failed but
// a session ref stamped, the ladder lands on the session rung, not the pane.
func TestCronAddRoleReadFailureDegradesToSession(t *testing.T) {
	dir := stubCronDir(t)
	stubCronTMUX(t)
	stubCronAddSeams(t, "", fmt.Errorf("server gone"))
	stubCronAddPaneSession(t, "4fe2abc-1c3b", nil)
	t.Setenv("TMUX_PANE", "%12")

	_, stderr, err := runCronCmd(t, "add", "sweep", "--every", "5m")
	if err != nil {
		t.Fatalf("add: %v — a role-read failure must not abort the add", err)
	}
	entries := loadCronEntries(t, dir, "work")
	if len(entries) != 1 || entries[0].Target.Kind != cron.TargetSession || entries[0].Target.Session != "4fe2abc-1c3b" {
		t.Fatalf("entries = %+v, want the session-rung fallback", entries)
	}
	if !strings.Contains(stderr, "window role unreadable") {
		t.Errorf("stderr = %q, want the degradation note", stderr)
	}
}

// TestCronAddSessionReadFailureDegradesToPane: a failed pane-session read
// degrades to the pane fallback with a note — never a guess, never an error.
func TestCronAddSessionReadFailureDegradesToPane(t *testing.T) {
	dir := stubCronDir(t)
	stubCronTMUX(t)
	stubCronAddSeams(t, "", nil)
	stubCronAddPaneSession(t, "", fmt.Errorf("server gone"))
	t.Setenv("TMUX_PANE", "%12")

	_, stderr, err := runCronCmd(t, "add", "sweep", "--every", "5m")
	if err != nil {
		t.Fatalf("add: %v — a session-read failure must not abort the add", err)
	}
	entries := loadCronEntries(t, dir, "work")
	if len(entries) != 1 || entries[0].Target.Kind != cron.TargetPane || entries[0].Target.Pane != "%12" {
		t.Fatalf("entries = %+v, want the pane-target fallback", entries)
	}
	if entries[0].CreatedBy.Session != "" {
		t.Errorf("created_by = %+v, want empty session after a failed read", entries[0].CreatedBy)
	}
	if !strings.Contains(stderr, "pane agent session unreadable") {
		t.Errorf("stderr = %q, want the degradation note", stderr)
	}
}

// TestCronAddCreatedBySessionAcrossTargetKinds: created_by.session is filled
// from the caller pane's ref on every in-pane add, whichever target kind the
// explicit flags or the ladder selected.
func TestCronAddCreatedBySessionAcrossTargetKinds(t *testing.T) {
	cases := []struct {
		name       string
		args       []string
		wantTarget cron.Target
	}{
		{"explicit pane", []string{"add", "x", "--every", "1h", "--pane", "%9"}, cron.Target{Kind: cron.TargetPane, Pane: "%9"}},
		{"explicit role", []string{"add", "x", "--every", "1h", "--role", "operator"}, cron.Target{Kind: cron.TargetRole, Role: "operator"}},
		{"explicit session names its own ref", []string{"add", "x", "--every", "1h", "--session", "other-ref"}, cron.Target{Kind: cron.TargetSession, Session: "other-ref"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			dir := stubCronDir(t)
			stubCronTMUX(t)
			stubCronAddSeams(t, "", nil)
			stubCronAddPaneSession(t, "4fe2abc-1c3b", nil)
			t.Setenv("TMUX_PANE", "%12")

			if _, _, err := runCronCmd(t, tc.args...); err != nil {
				t.Fatalf("add: %v", err)
			}
			entries := loadCronEntries(t, dir, "work")
			if len(entries) != 1 || entries[0].Target != tc.wantTarget {
				t.Fatalf("entries = %+v, want target %+v", entries, tc.wantTarget)
			}
			if entries[0].CreatedBy.Session != "4fe2abc-1c3b" {
				t.Errorf("created_by = %+v, want session 4fe2abc-1c3b regardless of target kind", entries[0].CreatedBy)
			}
		})
	}
}

// TestCronAddExplicitTargetFlags: --role/--pane/--session override
// auto-capture, are mutually exclusive (any pairing), and are validated.
func TestCronAddExplicitTargetFlags(t *testing.T) {
	cases := []struct {
		name       string
		args       []string
		wantErr    string
		wantTarget cron.Target
	}{
		{"role operator", []string{"add", "x", "--every", "1h", "--role", "operator"}, "", cron.Target{Kind: cron.TargetRole, Role: "operator"}},
		{"pane id", []string{"add", "x", "--every", "1h", "--pane", "%9"}, "", cron.Target{Kind: cron.TargetPane, Pane: "%9"}},
		{"session ref", []string{"add", "x", "--every", "1h", "--session", "4fe2abc-1c3b-4f7e-9a2d-8b5c4e1f0a37"}, "", cron.Target{Kind: cron.TargetSession, Session: "4fe2abc-1c3b-4f7e-9a2d-8b5c4e1f0a37"}},
		{"role and pane", []string{"add", "x", "--every", "1h", "--role", "operator", "--pane", "%9"}, "mutually exclusive", cron.Target{}},
		{"role and session", []string{"add", "x", "--every", "1h", "--role", "operator", "--session", "abc123"}, "mutually exclusive", cron.Target{}},
		{"pane and session", []string{"add", "x", "--every", "1h", "--pane", "%9", "--session", "abc123"}, "mutually exclusive", cron.Target{}},
		{"all three", []string{"add", "x", "--every", "1h", "--role", "operator", "--pane", "%9", "--session", "abc123"}, "mutually exclusive", cron.Target{}},
		{"bad role", []string{"add", "x", "--every", "1h", "--role", "manager"}, "invalid --role value", cron.Target{}},
		{"bad pane", []string{"add", "x", "--every", "1h", "--pane", "9"}, "invalid --pane value", cron.Target{}},
		{"bad session", []string{"add", "x", "--every", "1h", "--session", "has space"}, "invalid --session value", cron.Target{}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			dir := stubCronDir(t)
			stubCronTMUX(t)
			stubCronAddSeams(t, "", nil)
			t.Setenv("TMUX_PANE", "%12")

			_, _, err := runCronCmd(t, tc.args...)
			if tc.wantErr != "" {
				if err == nil || !strings.Contains(err.Error(), tc.wantErr) {
					t.Fatalf("err = %v, want %q", err, tc.wantErr)
				}
				if code := exitCode(err); code != exitUsage {
					t.Errorf("exit code = %d, want %d", code, exitUsage)
				}
				if fis, _ := os.ReadDir(dir); len(fis) != 0 {
					t.Errorf("state dir gained %v — a usage error must precede any write", fis)
				}
				return
			}
			if err != nil {
				t.Fatalf("add: %v", err)
			}
			entries := loadCronEntries(t, dir, "work")
			if len(entries) != 1 || entries[0].Target != tc.wantTarget {
				t.Fatalf("entries = %+v, want target %+v", entries, tc.wantTarget)
			}
		})
	}
}

// TestCronAddOutsideTmux: without $TMUX_PANE an explicit target flag is
// required (a typed command must not guess); with one, the add proceeds with
// a pane-less creator (created_by.at is still set — it anchors `every`).
func TestCronAddOutsideTmux(t *testing.T) {
	t.Run("no target flag is a usage error", func(t *testing.T) {
		dir := stubCronDir(t)
		stubCronAddSeams(t, "", nil)
		t.Setenv("TMUX_PANE", "")

		_, _, err := runCronCmd(t, "add", "x", "--every", "1h", "-L", "work")
		if err == nil || !strings.Contains(err.Error(), "pass --role, --pane, or --session") {
			t.Fatalf("err = %v, want the explicit-target error", err)
		}
		if code := exitCode(err); code != exitUsage {
			t.Errorf("exit code = %d, want %d", code, exitUsage)
		}
		if fis, _ := os.ReadDir(dir); len(fis) != 0 {
			t.Errorf("state dir gained %v, want untouched", fis)
		}
	})
	t.Run("explicit target works with a pane-less creator", func(t *testing.T) {
		dir := stubCronDir(t)
		stubCronAddSeams(t, "", nil)
		t.Setenv("TMUX_PANE", "")

		if _, _, err := runCronCmd(t, "add", "x", "--every", "1h", "--role", "operator", "-L", "work"); err != nil {
			t.Fatalf("add: %v", err)
		}
		entries := loadCronEntries(t, dir, "work")
		want := cron.CreatedBy{At: cronAddFixedNow}
		if len(entries) != 1 || entries[0].CreatedBy != want {
			t.Fatalf("entries = %+v, want one entry with created_by.at set and no pane", entries)
		}
	})
	t.Run("explicit session target outside tmux", func(t *testing.T) {
		dir := stubCronDir(t)
		stubCronAddSeams(t, "", nil)
		t.Setenv("TMUX_PANE", "")

		if _, _, err := runCronCmd(t, "add", "x", "--every", "1h", "--session", "4fe2abc", "-L", "work"); err != nil {
			t.Fatalf("add: %v", err)
		}
		entries := loadCronEntries(t, dir, "work")
		want := cron.Target{Kind: cron.TargetSession, Session: "4fe2abc"}
		if len(entries) != 1 || entries[0].Target != want {
			t.Fatalf("entries = %+v, want target %+v", entries, want)
		}
		if entries[0].CreatedBy.Session != "" {
			t.Errorf("created_by = %+v, want empty session outside tmux", entries[0].CreatedBy)
		}
	})
}

// TestCronAddMalformedTmuxPane: a set-but-malformed $TMUX_PANE is an error,
// never an unvalidated subprocess argument.
func TestCronAddMalformedTmuxPane(t *testing.T) {
	stubCronDir(t)
	stubCronTMUX(t)
	stubCronAddSeams(t, "", nil)
	t.Setenv("TMUX_PANE", "not-a-pane")

	_, _, err := runCronCmd(t, "add", "x", "--every", "1h")
	if err == nil || !strings.Contains(err.Error(), "malformed $TMUX_PANE") {
		t.Fatalf("err = %v, want the malformed-pane error", err)
	}
}

// TestCronAddNameTruncatesAt40Runes: the derived --name default is the payload
// cut to 40 runes (rune-safe, not byte-safe).
func TestCronAddNameTruncatesAt40Runes(t *testing.T) {
	dir := stubCronDir(t)
	stubCronTMUX(t)
	stubCronAddSeams(t, "", nil)
	t.Setenv("TMUX_PANE", "%12")

	payload := strings.Repeat("é", 50)
	if _, _, err := runCronCmd(t, "add", payload, "--every", "1h"); err != nil {
		t.Fatalf("add: %v", err)
	}
	entries := loadCronEntries(t, dir, "work")
	if len(entries) != 1 {
		t.Fatalf("entries = %d, want 1", len(entries))
	}
	if got := []rune(entries[0].Name); len(got) != 40 {
		t.Errorf("name = %d runes, want 40", len(got))
	}
	if entries[0].Payload != payload {
		t.Error("payload truncated — only the name derives from the prefix")
	}
}

// TestCronAddCorruptFileRefusesToMutate: a corrupt entry file makes add exit
// non-zero and leaves the file byte-identical.
func TestCronAddCorruptFileRefusesToMutate(t *testing.T) {
	dir := stubCronDir(t)
	stubCronTMUX(t)
	stubCronAddSeams(t, "", nil)
	t.Setenv("TMUX_PANE", "%12")

	path := filepath.Join(dir, "work.yaml")
	corrupt := []byte("{{{{ not yaml")
	if err := os.WriteFile(path, corrupt, 0o600); err != nil {
		t.Fatal(err)
	}
	_, _, err := runCronCmd(t, "add", "x", "--every", "1h")
	if err == nil || !strings.Contains(err.Error(), "refusing to mutate") {
		t.Fatalf("err = %v, want the refusing-to-mutate error", err)
	}
	after, _ := os.ReadFile(path)
	if string(after) != string(corrupt) {
		t.Error("corrupt entry file was modified — a failed add must not truncate it")
	}
}
