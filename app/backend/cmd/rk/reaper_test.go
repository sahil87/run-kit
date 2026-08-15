package main

import (
	"bytes"
	"fmt"
	"strings"
	"testing"

	"rk/internal/tmux"

	"github.com/spf13/cobra"
)

// makePlan builds n dry-run candidate entries, alternating kill/remove actions.
func makePlan(n int) []tmux.ReapPlanEntry {
	plan := make([]tmux.ReapPlanEntry, n)
	for i := range plan {
		action := tmux.ReapActionKill
		if i%2 == 1 {
			action = tmux.ReapActionRemove
		}
		plan[i] = tmux.ReapPlanEntry{Name: fmt.Sprintf("rk-test-%04d", i), Action: action}
	}
	return plan
}

// countEntryRows counts the indented candidate/name rows (two-space or
// four-space prefix) in the rendered output, excluding the header and notice.
func countEntryRows(out string, prefix string) int {
	n := 0
	for _, line := range strings.Split(out, "\n") {
		if strings.HasPrefix(line, prefix) && !strings.Contains(line, "… and ") {
			n++
		}
	}
	return n
}

// TestRenderDryRun_CapsAt10WithExactHeaderAndNotice pins R6/R7: a large dry-run
// caps the printed list at 10 entries, keeps the exact full count in the header,
// and states the truncation with the --all pointer.
func TestRenderDryRun_CapsAt10WithExactHeaderAndNotice(t *testing.T) {
	var buf bytes.Buffer
	renderDryRun(&buf, makePlan(4485), false)
	out := buf.String()

	// Header count is exact (the full candidate count, not the capped count).
	if !strings.Contains(out, "Dry run: 4485 candidate(s) would be reaped") {
		t.Errorf("header must state the exact full count 4485, got: %q", out)
	}
	// At most 10 candidate rows printed.
	if rows := countEntryRows(out, "  "); rows != reaperListCap {
		t.Errorf("dry-run printed %d candidate rows, want %d (the cap)", rows, reaperListCap)
	}
	// Truncation notice states the hidden count and the --all escape hatch.
	wantNotice := fmt.Sprintf("… and %d more; pass --all to list all", 4485-reaperListCap)
	if !strings.Contains(out, wantNotice) {
		t.Errorf("missing truncation notice %q, got: %q", wantNotice, out)
	}
}

// TestRenderDryRun_AllRestoresFullList pins R8: --all prints every candidate row
// and emits no truncation notice.
func TestRenderDryRun_AllRestoresFullList(t *testing.T) {
	var buf bytes.Buffer
	renderDryRun(&buf, makePlan(25), true)
	out := buf.String()

	if rows := countEntryRows(out, "  "); rows != 25 {
		t.Errorf("--all printed %d candidate rows, want 25 (full list)", rows)
	}
	if strings.Contains(out, "… and ") {
		t.Errorf("--all must not emit a truncation notice, got: %q", out)
	}
}

// TestRenderDryRun_NoNoticeAtOrBelowCap pins that a list at or below the cap
// prints fully with no notice (silent truncation only fires when truncating).
func TestRenderDryRun_NoNoticeAtOrBelowCap(t *testing.T) {
	var buf bytes.Buffer
	renderDryRun(&buf, makePlan(reaperListCap), false)
	out := buf.String()
	if rows := countEntryRows(out, "  "); rows != reaperListCap {
		t.Errorf("printed %d rows, want %d (exactly at cap)", rows, reaperListCap)
	}
	if strings.Contains(out, "… and ") {
		t.Errorf("a list exactly at the cap must not emit a notice, got: %q", out)
	}
}

// TestRenderReapSummary_PerListCap pins R6: the act summary caps killed and
// removed independently at 10 each, with exact header counts and per-list
// notices.
func TestRenderReapSummary_PerListCap(t *testing.T) {
	killed := make([]string, 15)
	for i := range killed {
		killed[i] = fmt.Sprintf("rk-test-kill-%02d", i)
	}
	removed := make([]string, 12)
	for i := range removed {
		removed[i] = fmt.Sprintf("rk-test-rm-%02d", i)
	}

	var buf bytes.Buffer
	renderReapSummary(&buf, tmux.ReapResult{Killed: killed, RemovedSockets: removed}, false)
	out := buf.String()

	// Total header is exact (15 + 12 = 27).
	if !strings.Contains(out, "Reaped 27 entry(ies):") {
		t.Errorf("total header must be exact (27), got: %q", out)
	}
	// Per-list headers are exact.
	if !strings.Contains(out, "killed 15 live server(s):") {
		t.Errorf("killed header must state the exact 15, got: %q", out)
	}
	if !strings.Contains(out, "removed 12 dead socket(s)/lock file(s):") {
		t.Errorf("removed header must state the exact 12, got: %q", out)
	}
	// Each list caps at 10 rows and states its own notice.
	if rows := countEntryRows(out, "    "); rows != 2*reaperListCap {
		t.Errorf("summary printed %d name rows, want %d (10 killed + 10 removed)", rows, 2*reaperListCap)
	}
	if !strings.Contains(out, "… and 5 more; pass --all to list all") {
		t.Errorf("killed list missing its truncation notice (15-10=5), got: %q", out)
	}
	if !strings.Contains(out, "… and 2 more; pass --all to list all") {
		t.Errorf("removed list missing its truncation notice (12-10=2), got: %q", out)
	}
}

// TestRenderReapSummary_AllRestoresFullLists pins R8 on the act-summary path:
// --all prints every killed and removed name with no notices.
func TestRenderReapSummary_AllRestoresFullLists(t *testing.T) {
	killed := make([]string, 15)
	for i := range killed {
		killed[i] = fmt.Sprintf("rk-test-kill-%02d", i)
	}
	removed := make([]string, 12)
	for i := range removed {
		removed[i] = fmt.Sprintf("rk-test-rm-%02d", i)
	}

	var buf bytes.Buffer
	renderReapSummary(&buf, tmux.ReapResult{Killed: killed, RemovedSockets: removed}, true)
	out := buf.String()

	if rows := countEntryRows(out, "    "); rows != 27 {
		t.Errorf("--all printed %d name rows, want 27 (full lists)", rows)
	}
	if strings.Contains(out, "… and ") {
		t.Errorf("--all must not emit any truncation notice, got: %q", out)
	}
}

// TestRenderReapSummary_EmptyIsNothingToReap pins the empty-result path is
// unchanged by the cap.
func TestRenderReapSummary_EmptyIsNothingToReap(t *testing.T) {
	var buf bytes.Buffer
	renderReapSummary(&buf, tmux.ReapResult{}, false)
	if got := strings.TrimSpace(buf.String()); got != "Nothing to reap." {
		t.Errorf("empty result = %q, want %q", got, "Nothing to reap.")
	}
}

// TestReapAllFlagRegistered pins the --all flag surface on both instances —
// the family member and the hidden root alias (help-dump re-verification
// depends on it).
func TestReapAllFlagRegistered(t *testing.T) {
	for name, cmd := range map[string]*cobra.Command{
		"family member (mux reap)": reapFamilyCmd,
		"root alias (reaper)":      reapAliasCmd,
	} {
		f := cmd.Flags().Lookup("all")
		if f == nil {
			t.Errorf("%s is missing the --all flag", name)
			continue
		}
		if f.Value.Type() != "bool" {
			t.Errorf("%s --all type = %q, want bool", name, f.Value.Type())
		}
		if f.DefValue != "false" {
			t.Errorf("%s --all default = %q, want false", name, f.DefValue)
		}
	}
}

// runRootArgs drives args through the real production Execute() seam with
// captured stdout/stderr, resetting every piece of shared command state the
// run touches (the runMuxCmd pattern, generalized to non-mux args).
func runRootArgs(t *testing.T, args ...string) (string, string, error) {
	t.Helper()
	resetRootFlagState(t)
	resetMuxFlags()
	var outBuf, errBuf bytes.Buffer
	rootCmd.SetOut(&outBuf)
	rootCmd.SetErr(&errBuf)
	rootCmd.SetArgs(args)
	t.Cleanup(func() {
		rootCmd.SetOut(nil)
		rootCmd.SetErr(nil)
		rootCmd.SetArgs(nil)
		resetMuxFlags()
		resetFlagChanged(reapFamilyCmd, "prefix", "yes", "force", "dry-run", "all")
		resetFlagChanged(reapAliasCmd, "prefix", "yes", "force", "dry-run", "all")
		resetFlagChanged(initConfFamilyCmd, "force")
		resetFlagChanged(initConfAliasCmd, "force")
		for _, parent := range []*cobra.Command{snapshotFamilyCmd, snapshotAliasCmd} {
			for _, sub := range parent.Commands() {
				resetFlagChanged(sub, "all", "at")
			}
		}
	})
	err := rootCmd.Execute()
	return outBuf.String(), errBuf.String(), err
}

// TestReapAliasRunsWithDeprecationPointer pins the deprecation-alias contract:
// the old root form `rk reaper` still runs (dry-run default, identical output
// and exit code) AND prints the cobra deprecation pointer naming `rk mux reap`.
// The non-matching prefix keeps the dry-run scan read-only and empty.
func TestReapAliasRunsWithDeprecationPointer(t *testing.T) {
	stdout, stderr, err := runRootArgs(t, "reaper", "--prefix", "rk-test-reap-alias-nomatch")
	if err != nil {
		t.Fatalf("rk reaper alias run error: %v", err)
	}
	if !strings.Contains(stdout, "Dry run: nothing to reap.") {
		t.Errorf("alias must run the dry run identically, got stdout: %q", stdout)
	}
	if got := stdout + stderr; !strings.Contains(got, `Command "reaper" is deprecated, use `+"`rk mux reap`") {
		t.Errorf("alias must print the deprecation pointer naming `rk mux reap`, got stdout: %q stderr: %q", stdout, stderr)
	}
	if !reapAliasCmd.Hidden {
		t.Error("the reaper alias must be hidden from help and the help-dump")
	}
}

// TestMuxReapNoDeprecation pins the other half of the contract: the canonical
// family form `rk mux reap` runs warning-free.
func TestMuxReapNoDeprecation(t *testing.T) {
	stdout, stderr, err := runRootArgs(t, "mux", "reap", "--prefix", "rk-test-reap-alias-nomatch")
	if err != nil {
		t.Fatalf("rk mux reap run error: %v", err)
	}
	if !strings.Contains(stdout, "Dry run: nothing to reap.") {
		t.Errorf("family member must run the dry run identically, got stdout: %q", stdout)
	}
	if got := stdout + stderr; strings.Contains(got, "deprecated") {
		t.Errorf("the family form must not print a deprecation warning, got stdout: %q stderr: %q", stdout, stderr)
	}
}

// TestMuxReapRejectsExplicitServerFlag pins the -L guard: an explicitly-set
// inherited --server on a non-messaging member is a usage error (exit 2) and
// the engine never runs (empty stdout — nothing scanned, nothing reaped).
func TestMuxReapRejectsExplicitServerFlag(t *testing.T) {
	stdout, _, err := runRootArgs(t, "mux", "-L", "zzz-nope", "reap")
	if err == nil {
		t.Fatal("rk mux -L zzz-nope reap: expected a usage error, got nil")
	}
	if got := exitCode(err); got != exitUsage {
		t.Errorf("exit code = %d, want %d (usage)", got, exitUsage)
	}
	if !strings.Contains(err.Error(), "--server") {
		t.Errorf("error must name --server, got: %v", err)
	}
	if stdout != "" {
		t.Errorf("the reaper engine must not run past the guard, got stdout: %q", stdout)
	}
}
