package sessions

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"rk/internal/tmux"
)

func TestProjectRootDerivation(t *testing.T) {
	tests := []struct {
		name     string
		windows  []tmux.WindowInfo
		wantRoot string
	}{
		{
			name: "project root from first window",
			windows: []tmux.WindowInfo{
				{Index: 0, Name: "main", WorktreePath: "/home/user/project"},
				{Index: 1, Name: "build", WorktreePath: "/tmp/build"},
			},
			wantRoot: "/home/user/project",
		},
		{
			name:     "empty windows returns empty root",
			windows:  []tmux.WindowInfo{},
			wantRoot: "",
		},
		{
			name: "single window",
			windows: []tmux.WindowInfo{
				{Index: 0, Name: "dev", WorktreePath: "/home/user/code"},
			},
			wantRoot: "/home/user/code",
		},
		{
			name: "first window has empty path",
			windows: []tmux.WindowInfo{
				{Index: 0, Name: "main", WorktreePath: ""},
				{Index: 1, Name: "sub", WorktreePath: "/home/user/other"},
			},
			wantRoot: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			projectRoot := ""
			if len(tt.windows) > 0 {
				projectRoot = tt.windows[0].WorktreePath
			}
			if projectRoot != tt.wantRoot {
				t.Errorf("projectRoot = %q, want %q", projectRoot, tt.wantRoot)
			}
		})
	}
}

func TestProjectSessionStruct(t *testing.T) {
	ps := ProjectSession{
		Name: "my-project",
		Windows: []tmux.WindowInfo{
			{Index: 0, Name: "main", WorktreePath: "/home/user/project", Activity: "active", IsActiveWindow: true},
			{Index: 1, Name: "build", WorktreePath: "/tmp/build", Activity: "idle", IsActiveWindow: false},
		},
	}

	if ps.Name != "my-project" {
		t.Errorf("Name = %q, want %q", ps.Name, "my-project")
	}
	if len(ps.Windows) != 2 {
		t.Fatalf("Windows count = %d, want 2", len(ps.Windows))
	}
	if ps.Windows[0].IsActiveWindow != true {
		t.Error("Windows[0].IsActiveWindow should be true")
	}
	if ps.Windows[1].IsActiveWindow != false {
		t.Error("Windows[1].IsActiveWindow should be false")
	}
}

func TestProjectSessionNameFieldJSON(t *testing.T) {
	ps := ProjectSession{Name: "test"}
	data, err := json.Marshal(ps)
	if err != nil {
		t.Fatalf("json.Marshal failed: %v", err)
	}
	var decoded ProjectSession
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("json.Unmarshal failed: %v", err)
	}
	if decoded.Name != "test" {
		t.Errorf("round-trip Name = %q, want %q", decoded.Name, "test")
	}
}

func TestPaneMapEntryParsing(t *testing.T) {
	change := "260313-abc-feature"
	stage := "apply"

	// The JSON still carries the legacy agent_state / agent_idle_duration /
	// pr_url / pr_number keys fab may emit; since 260705-dmex the slimmed
	// paneMapEntry no longer has those fields, so they MUST be ignored without
	// error — the join consumes only change/stage/display_state.
	jsonData := `[
		{"session":"dev","window_index":0,"pane":"%0","tab":"main","worktree":"/home/user/project","change":"260313-abc-feature","stage":"apply","agent_state":"active","agent_idle_duration":null,"pr_url":"https://x/pull/1","pr_number":1},
		{"session":"dev","window_index":1,"pane":"%1","tab":"build","worktree":"/tmp/build","change":null,"stage":null,"agent_state":null,"agent_idle_duration":null}
	]`

	var entries []paneMapEntry
	if err := json.Unmarshal([]byte(jsonData), &entries); err != nil {
		t.Fatalf("failed to parse pane-map JSON: %v", err)
	}

	if len(entries) != 2 {
		t.Fatalf("got %d entries, want 2", len(entries))
	}

	// First entry: fab tier proper (change/stage) populated.
	e0 := entries[0]
	if e0.Session != "dev" {
		t.Errorf("entries[0].Session = %q, want %q", e0.Session, "dev")
	}
	if e0.WindowIndex != 0 {
		t.Errorf("entries[0].WindowIndex = %d, want 0", e0.WindowIndex)
	}
	if e0.Change == nil || *e0.Change != change {
		t.Errorf("entries[0].Change = %v, want %q", e0.Change, change)
	}
	if e0.Stage == nil || *e0.Stage != stage {
		t.Errorf("entries[0].Stage = %v, want %q", e0.Stage, stage)
	}

	// Second entry: non-fab pane with null fields
	e1 := entries[1]
	if e1.Change != nil {
		t.Errorf("entries[1].Change = %v, want nil", e1.Change)
	}
	if e1.Stage != nil {
		t.Errorf("entries[1].Stage = %v, want nil", e1.Stage)
	}
}

func TestDerefStr(t *testing.T) {
	val := "hello"
	if got := derefStr(&val); got != "hello" {
		t.Errorf("derefStr(&%q) = %q, want %q", val, got, "hello")
	}
	if got := derefStr(nil); got != "" {
		t.Errorf("derefStr(nil) = %q, want empty", got)
	}
}

func TestPaneMapJoinPopulatesPerWindowFabFields(t *testing.T) {
	// Since 260705-dmex the pane-map join carries only the fab tier proper
	// (change/stage/display_state); agent state comes from @rk_agent_state, not
	// the pane map. The join now attributes entries by stable pane ID against
	// the fresh window snapshot (see joinPaneMapByWindow), not by positional key.
	change := "260313-abc-feature"
	stage := "apply"

	// Fetch-time map keyed by pane ID (as keyPaneEntries produces).
	paneMap := map[string]paneMapEntry{
		"%0": {Session: "dev", WindowIndex: 0, Pane: "%0", Change: &change, Stage: &stage},
		"%1": {Session: "dev", WindowIndex: 1, Pane: "%1", Change: &change, Stage: strPtr("review")},
	}

	data := []sessionData{{
		info: tmux.SessionInfo{Name: "dev"},
		windows: []tmux.WindowInfo{
			{Index: 0, WindowID: "@0", Name: "main", Panes: []tmux.PaneInfo{{PaneID: "%0"}}},
			{Index: 1, WindowID: "@1", Name: "build", Panes: []tmux.PaneInfo{{PaneID: "%1"}}},
			{Index: 2, WindowID: "@2", Name: "test", Panes: []tmux.PaneInfo{{PaneID: "%2"}}},
		},
	}}

	enrich := joinPaneMapByWindow(paneMap, data)
	windows := data[0].windows
	for j := range windows {
		if entry, ok := enrich[windows[j].WindowID]; ok {
			windows[j].FabChange = derefStr(entry.Change)
			windows[j].FabStage = derefStr(entry.Stage)
		}
	}

	// Window 0: fab pane, apply stage
	if windows[0].FabChange != change {
		t.Errorf("windows[0].FabChange = %q, want %q", windows[0].FabChange, change)
	}
	if windows[0].FabStage != stage {
		t.Errorf("windows[0].FabStage = %q, want %q", windows[0].FabStage, stage)
	}

	// Window 1: fab pane, review stage
	if windows[1].FabChange != change {
		t.Errorf("windows[1].FabChange = %q, want %q", windows[1].FabChange, change)
	}
	if windows[1].FabStage != "review" {
		t.Errorf("windows[1].FabStage = %q, want %q", windows[1].FabStage, "review")
	}

	// Window 2: no matching pane-map entry — fab fields remain empty
	if windows[2].FabChange != "" {
		t.Errorf("windows[2].FabChange = %q, want empty", windows[2].FabChange)
	}
	if windows[2].FabStage != "" {
		t.Errorf("windows[2].FabStage = %q, want empty", windows[2].FabStage)
	}
}

func TestPaneMapNilLeavesAllFieldsEmpty(t *testing.T) {
	// When fetchPaneMap fails, paneMap is nil — all fab fields stay empty.
	var paneMap map[string]paneMapEntry

	data := []sessionData{{
		info: tmux.SessionInfo{Name: "dev"},
		windows: []tmux.WindowInfo{
			{Index: 0, WindowID: "@0", Name: "main", Panes: []tmux.PaneInfo{{PaneID: "%0"}}},
			{Index: 1, WindowID: "@1", Name: "build", Panes: []tmux.PaneInfo{{PaneID: "%1"}}},
		},
	}}

	enrich := joinPaneMapByWindow(paneMap, data)
	if len(enrich) != 0 {
		t.Fatalf("nil paneMap should yield no enrichment, got %d entries", len(enrich))
	}

	windows := data[0].windows
	for j := range windows {
		if entry, ok := enrich[windows[j].WindowID]; ok {
			windows[j].FabChange = derefStr(entry.Change)
			windows[j].FabStage = derefStr(entry.Stage)
		}
	}

	for i, w := range windows {
		if w.FabChange != "" {
			t.Errorf("windows[%d].FabChange = %q, want empty", i, w.FabChange)
		}
		if w.FabStage != "" {
			t.Errorf("windows[%d].FabStage = %q, want empty", i, w.FabStage)
		}
	}
}

// TestWindowBranchRepo covers the branch/repo selection that feeds the
// PR-from-branch derivation (260705-dmex): the active pane's branch wins, else
// the first pane with a branch; no branch → ("", "").
func TestWindowBranchRepo(t *testing.T) {
	t.Run("active pane with a branch wins", func(t *testing.T) {
		w := tmux.WindowInfo{Panes: []tmux.PaneInfo{
			{Cwd: "/repo/a", GitBranch: "feat-a", IsActive: false},
			{Cwd: "/repo/b", GitBranch: "feat-b", IsActive: true},
		}}
		repo, branch := windowBranchRepo(&w)
		if repo != "/repo/b" || branch != "feat-b" {
			t.Errorf("got (%q, %q), want (/repo/b, feat-b)", repo, branch)
		}
	})

	t.Run("falls back to first pane with a branch when active has none", func(t *testing.T) {
		w := tmux.WindowInfo{Panes: []tmux.PaneInfo{
			{Cwd: "/repo/a", GitBranch: "", IsActive: true},
			{Cwd: "/repo/b", GitBranch: "feat-b", IsActive: false},
		}}
		repo, branch := windowBranchRepo(&w)
		if repo != "/repo/b" || branch != "feat-b" {
			t.Errorf("got (%q, %q), want (/repo/b, feat-b)", repo, branch)
		}
	})

	t.Run("no pane has a branch yields empty", func(t *testing.T) {
		w := tmux.WindowInfo{Panes: []tmux.PaneInfo{
			{Cwd: "/repo/a", GitBranch: "", IsActive: true},
			{Cwd: "/repo/b", GitBranch: ""},
		}}
		repo, branch := windowBranchRepo(&w)
		if repo != "" || branch != "" {
			t.Errorf("got (%q, %q), want empty", repo, branch)
		}
	})
}

func TestPaneMapEntryParsesDisplayState(t *testing.T) {
	// Three wire shapes: present with a value, explicit JSON null, and absent
	// key (fab < 2.1.7 omits display_state entirely).
	jsonData := `[
		{"session":"dev","window_index":0,"pane":"%0","tab":"main","worktree":"/p","change":"260612-epqk-x","stage":"review-pr","display_state":"done","agent_state":null,"agent_idle_duration":null},
		{"session":"dev","window_index":1,"pane":"%1","tab":"build","worktree":"/b","change":"260612-epqk-x","stage":"apply","display_state":null,"agent_state":null,"agent_idle_duration":null},
		{"session":"dev","window_index":2,"pane":"%2","tab":"old","worktree":"/o","change":null,"stage":null,"agent_state":null,"agent_idle_duration":null}
	]`

	var entries []paneMapEntry
	if err := json.Unmarshal([]byte(jsonData), &entries); err != nil {
		t.Fatalf("failed to parse pane-map JSON: %v", err)
	}
	if len(entries) != 3 {
		t.Fatalf("got %d entries, want 3", len(entries))
	}

	// Entry 0: display_state present with a value.
	if entries[0].DisplayState == nil || *entries[0].DisplayState != "done" {
		t.Errorf("entries[0].DisplayState = %v, want %q", entries[0].DisplayState, "done")
	}
	// Entry 1: explicit JSON null → nil pointer.
	if entries[1].DisplayState != nil {
		t.Errorf("entries[1].DisplayState = %v, want nil", entries[1].DisplayState)
	}
	// Entry 2: key absent (older fab) → nil pointer.
	if entries[2].DisplayState != nil {
		t.Errorf("entries[2].DisplayState = %v, want nil", entries[2].DisplayState)
	}
}

func TestPaneMapJoinPopulatesDisplayState(t *testing.T) {
	change := "260612-epqk-x"
	stage := "review-pr"

	// Fetch-time map keyed by pane ID (as keyPaneEntries produces).
	paneMap := map[string]paneMapEntry{
		// Parked change: display_state "done".
		"%0": {Session: "dev", WindowIndex: 0, Pane: "%0", Change: &change, Stage: &stage, DisplayState: strPtr("done")},
		// Entry present but display_state null/absent (older fab).
		"%1": {Session: "dev", WindowIndex: 1, Pane: "%1", Change: &change, Stage: &stage, DisplayState: nil},
	}

	data := []sessionData{{
		info: tmux.SessionInfo{Name: "dev"},
		windows: []tmux.WindowInfo{
			{Index: 0, WindowID: "@20", Name: "main", Panes: []tmux.PaneInfo{{PaneID: "%0"}}},
			{Index: 1, WindowID: "@21", Name: "build", Panes: []tmux.PaneInfo{{PaneID: "%1"}}},
			{Index: 2, WindowID: "@22", Name: "test", Panes: []tmux.PaneInfo{{PaneID: "%2"}}}, // no matching entry
		},
	}}

	// Exercise the real join helper, then map DisplayState through derefStr.
	enrichByWindowID := joinPaneMapByWindow(paneMap, data)
	windows := data[0].windows
	for j := range windows {
		if entry, ok := enrichByWindowID[windows[j].WindowID]; ok {
			windows[j].FabStage = derefStr(entry.Stage)
			windows[j].FabDisplayState = derefStr(entry.DisplayState)
		}
	}

	// Window 0: parked → FabDisplayState "done".
	if windows[0].FabDisplayState != "done" {
		t.Errorf("windows[0].FabDisplayState = %q, want %q", windows[0].FabDisplayState, "done")
	}
	if windows[0].FabStage != stage {
		t.Errorf("windows[0].FabStage = %q, want %q", windows[0].FabStage, stage)
	}
	// Window 1: nil DisplayState → empty string after derefStr.
	if windows[1].FabDisplayState != "" {
		t.Errorf("windows[1].FabDisplayState = %q, want empty", windows[1].FabDisplayState)
	}
	// Window 2: no pane-map entry → field stays empty.
	if windows[2].FabDisplayState != "" {
		t.Errorf("windows[2].FabDisplayState = %q, want empty", windows[2].FabDisplayState)
	}
}

// TestPaneMapJoinFollowsWindowIDAcrossSwap is the regression test for the bug
// this change fixes (260713-d07t). It simulates a `swap-window`: a pane map
// captured BEFORE the swap (cached, positionally at indices 0/1) is joined
// against a FRESH snapshot where the two windows' INDICES have swapped but the
// panes and window IDs travel with their windows. Each window's fab fields MUST
// follow its window ID (its actual pane), not the list index.
//
// This asserts identity is immune to the 5s pane-map cache staleness. Under the
// OLD positional (session:index) join this test FAILS: window @A would receive
// window @B's change (and vice-versa) because after the swap @A sits at the
// index @B's entry was keyed to.
func TestPaneMapJoinFollowsWindowIDAcrossSwap(t *testing.T) {
	changeA := "260101-aaaa-window-a"
	changeB := "260202-bbbb-window-b"

	// Pane map captured BEFORE the swap. keyPaneEntries keys by pane ID, so the
	// entries carry pane IDs (%10 in window @A, %20 in window @B) and the
	// pre-swap indices (0 and 1). The cache is not refreshed after the swap.
	paneMap := map[string]paneMapEntry{
		"%10": {Session: "dev", WindowIndex: 0, Pane: "%10", Change: &changeA, Stage: strPtr("apply"), DisplayState: strPtr("active")},
		"%20": {Session: "dev", WindowIndex: 1, Pane: "%20", Change: &changeB, Stage: strPtr("review"), DisplayState: strPtr("failed")},
	}

	// Fresh snapshot AFTER swap-window: window @A (pane %10) now sits at index 1,
	// window @B (pane %20) now sits at index 0. Window IDs and panes travel;
	// indices swapped.
	data := []sessionData{{
		info: tmux.SessionInfo{Name: "dev"},
		windows: []tmux.WindowInfo{
			{Index: 0, WindowID: "@B", Name: "b", Panes: []tmux.PaneInfo{{PaneID: "%20"}}},
			{Index: 1, WindowID: "@A", Name: "a", Panes: []tmux.PaneInfo{{PaneID: "%10"}}},
		},
	}}

	enrich := joinPaneMapByWindow(paneMap, data)

	// Window @A must still carry changeA (follows its pane, not its new index 1).
	entryA, ok := enrich["@A"]
	if !ok {
		t.Fatalf("no enrichment for window @A")
	}
	if derefStr(entryA.Change) != changeA {
		t.Errorf("@A change = %q, want %q (must follow window ID, not index)", derefStr(entryA.Change), changeA)
	}
	if derefStr(entryA.Stage) != "apply" || derefStr(entryA.DisplayState) != "active" {
		t.Errorf("@A stage/state = %q/%q, want apply/active", derefStr(entryA.Stage), derefStr(entryA.DisplayState))
	}

	// Window @B must still carry changeB (follows its pane, not its new index 0).
	entryB, ok := enrich["@B"]
	if !ok {
		t.Fatalf("no enrichment for window @B")
	}
	if derefStr(entryB.Change) != changeB {
		t.Errorf("@B change = %q, want %q (must follow window ID, not index)", derefStr(entryB.Change), changeB)
	}
	if derefStr(entryB.Stage) != "review" || derefStr(entryB.DisplayState) != "failed" {
		t.Errorf("@B stage/state = %q/%q, want review/failed", derefStr(entryB.Stage), derefStr(entryB.DisplayState))
	}
}

// TestPaneMapJoinEmptyPaneFallback verifies the legacy positional fallback: a
// fetch-time entry with an empty Pane field (hypothetical older fab JSON that
// omits the pane ID) is keyed positionally by keyPaneEntries and must still
// enrich its window via the join's legacy "session:index" fallback, since no
// pane of the fresh window matches a pane-ID key.
func TestPaneMapJoinEmptyPaneFallback(t *testing.T) {
	change := "260303-cccc-legacy"

	// keyPaneEntries stores an empty-Pane entry under the legacy positional key.
	entries := []paneMapEntry{
		{Session: "dev", WindowIndex: 1, Pane: "", Change: &change, Stage: strPtr("hydrate")},
	}
	paneMap := keyPaneEntries(entries)
	if _, ok := paneMap["dev:1"]; !ok {
		t.Fatalf("empty-Pane entry not keyed positionally as dev:1; got keys %v", paneMap)
	}

	// Fresh window at index 1 whose pane IDs are NOT in the map — join must fall
	// back to the positional key.
	data := []sessionData{{
		info: tmux.SessionInfo{Name: "dev"},
		windows: []tmux.WindowInfo{
			{Index: 0, WindowID: "@0", Panes: []tmux.PaneInfo{{PaneID: "%0"}}},
			{Index: 1, WindowID: "@1", Panes: []tmux.PaneInfo{{PaneID: "%9"}}},
		},
	}}

	enrich := joinPaneMapByWindow(paneMap, data)

	got, ok := enrich["@1"]
	if !ok {
		t.Fatalf("window @1 not enriched via legacy positional fallback")
	}
	if derefStr(got.Change) != change || derefStr(got.Stage) != "hydrate" {
		t.Errorf("@1 change/stage = %q/%q, want %q/hydrate", derefStr(got.Change), derefStr(got.Stage), change)
	}
	// Window @0 has no matching entry and no positional fallback → not enriched.
	if _, ok := enrich["@0"]; ok {
		t.Errorf("window @0 unexpectedly enriched")
	}
}

// TestKeyPaneEntriesKeyShapes verifies keyPaneEntries keys by pane ID when
// present, falls back to the legacy positional key for empty Pane, and that the
// two key shapes never collide (pane IDs start with '%').
func TestKeyPaneEntriesKeyShapes(t *testing.T) {
	change := "260404-dddd-x"
	entries := []paneMapEntry{
		{Session: "dev", WindowIndex: 0, Pane: "%3", Change: &change},
		{Session: "dev", WindowIndex: 0, Pane: ""}, // empty Pane → positional key "dev:0"
	}
	m := keyPaneEntries(entries)
	if len(m) != 2 {
		t.Fatalf("got %d keys, want 2 (pane-ID + positional, no collision): %v", len(m), m)
	}
	if e, ok := m["%3"]; !ok || derefStr(e.Change) != change {
		t.Errorf("pane-ID key %%3 missing or wrong change: ok=%v entry=%+v", ok, e)
	}
	if _, ok := m["dev:0"]; !ok {
		t.Errorf("positional key dev:0 missing for empty-Pane entry")
	}
}

func TestFetchPaneMapFabNotOnPath(t *testing.T) {
	// When `fab` is not reachable via $PATH, fetchPaneMap MUST return a
	// non-nil error and a nil map. We force the failure by clearing PATH
	// for the duration of this test.
	t.Setenv("PATH", "")
	m, err := fetchPaneMap("")
	if err == nil {
		t.Error("expected error when fab is not on PATH, got nil")
	}
	if m != nil {
		t.Errorf("expected nil map, got %v", m)
	}
}

// tmuxSocketDir returns the directory tmux places named server sockets in,
// matching tmux's own rule: ${TMUX_TMPDIR:-/tmp}/tmux-<euid>/. Honoring
// TMUX_TMPDIR (not hard-coding /tmp) and using the EFFECTIVE uid matters so the
// socket-file cleanup targets the real path when tests run with TMUX_TMPDIR set
// — otherwise the rk-test-* socket leaks despite the cleanup. (Verified
// empirically: with TMUX_TMPDIR=DIR the socket lands at DIR/tmux-<euid>/<name>.)
func tmuxSocketDir() string {
	base := os.Getenv("TMUX_TMPDIR")
	if base == "" {
		base = "/tmp"
	}
	return filepath.Join(base, fmt.Sprintf("tmux-%d", os.Geteuid()))
}

// TestFetchPaneMapIntegration exercises the real subprocess invocation path.
// Skips when `fab` or `tmux` is not on PATH (CI without them installed).
//
// fetchPaneMap runs `fab pane map` from a neutral (non-project) dir, so the fab
// router dispatches the globally-installed fab version regardless of any
// project pin — no per-repo config setup is needed here (this is the whole
// point of the cross-project version-independence fix). We just need a real
// `fab` on PATH and a live socket to query.
//
// The test targets a freshly-booted, isolated rk-test-* tmux server rather than
// the ambient default socket: `fab pane map --all-sessions` runs
// `tmux list-sessions`, which exits non-zero when the resolved socket has no
// live server. Relying on whatever server happens to be running (or not) under
// the test process made this flaky — green inside a tmux pane, red under a bare
// `go test`. Booting our own server makes the real parse+key path
// deterministic and lets us assert it actually returned the session we created.
func TestFetchPaneMapIntegration(t *testing.T) {
	if _, err := exec.LookPath("fab"); err != nil {
		t.Skip("fab router not available on PATH")
	}
	if _, err := exec.LookPath("tmux"); err != nil {
		t.Skip("tmux not available on PATH")
	}

	// Boot an isolated tmux server with one known session so the subprocess
	// path has a live socket to list. The rk-test- prefix opts the socket into
	// the unified reaper sweep (`rk reaper`) if t.Cleanup never fires (SIGKILL
	// / panic). The embedded pid + nanosecond suffix keep it unique per run.
	server := fmt.Sprintf("rk-test-sessions-%d-%d", os.Getpid(), time.Now().UnixNano())
	const bootSession = "panemap-boot"
	bootCtx, cancelBoot := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelBoot()
	boot := exec.CommandContext(bootCtx, "tmux", "-L", server,
		"new-session", "-d", "-s", bootSession, "-x", "80", "-y", "24")
	if out, err := boot.CombinedOutput(); err != nil {
		t.Skipf("could not start isolated tmux server %q: %v\n%s", server, err, out)
	}
	t.Cleanup(func() {
		killCtx, cancelKill := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancelKill()
		_ = exec.CommandContext(killCtx, "tmux", "-L", server, "kill-server").Run()
		// kill-server stops the server but leaves the socket file behind. This
		// package has no TestMain post-sweep (unlike internal/tmux), so remove
		// the stale socket ourselves to avoid leaking rk-test-* residue.
		_ = os.Remove(filepath.Join(tmuxSocketDir(), server))
	})

	// The subprocess call SHALL succeed against the live isolated server, and
	// the booted session SHALL appear — proving the real parse+key path ran,
	// not merely that "empty is tolerated".
	paneMap, err := fetchPaneMap(server)
	if err != nil {
		t.Fatalf("fetchPaneMap(%q) error: %v", server, err)
	}
	found := false
	for _, e := range paneMap {
		if e.Session == bootSession {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("fetchPaneMap did not return booted session %q; got %d entries: %+v",
			bootSession, len(paneMap), paneMap)
	}
}

// TestPaneMapJoinFirstSeenWhenNeitherChangeBound verifies the join-time
// selection semantics (formerly asserted at fetch-time dedup): when a single
// window has two candidate panes and neither is change-bound, the FIRST-seen
// pane (pane order within the window) is selected. Both pane orderings are
// exercised to prove pane order — not content — decides.
func TestPaneMapJoinFirstSeenWhenNeitherChangeBound(t *testing.T) {
	firstEntry := paneMapEntry{Session: "dev", WindowIndex: 0, Pane: "%0", Change: nil}
	secondEntry := paneMapEntry{Session: "dev", WindowIndex: 0, Pane: "%1", Change: nil}
	paneMap := map[string]paneMapEntry{"%0": firstEntry, "%1": secondEntry}

	orderings := []struct {
		name      string
		paneOrder []tmux.PaneInfo
		wantPane  string
	}{
		{name: "pane %0 first", paneOrder: []tmux.PaneInfo{{PaneID: "%0"}, {PaneID: "%1"}}, wantPane: "%0"},
		{name: "pane %1 first", paneOrder: []tmux.PaneInfo{{PaneID: "%1"}, {PaneID: "%0"}}, wantPane: "%1"},
	}

	for _, o := range orderings {
		t.Run(o.name, func(t *testing.T) {
			data := []sessionData{{
				info:    tmux.SessionInfo{Name: "dev"},
				windows: []tmux.WindowInfo{{Index: 0, WindowID: "@0", Panes: o.paneOrder}},
			}}
			enrich := joinPaneMapByWindow(paneMap, data)
			got, ok := enrich["@0"]
			if !ok {
				t.Fatalf("no enrichment for window @0")
			}
			if got.Pane != o.wantPane {
				t.Errorf("got pane %q, want %q (first-seen in pane order should win)", got.Pane, o.wantPane)
			}
		})
	}
}

// TestPaneMapJoinChangeWins verifies the join-time selection semantics: within a
// single window, a change-bound candidate pane (non-nil Change) beats a bare
// (nil Change) candidate regardless of pane order.
func TestPaneMapJoinChangeWins(t *testing.T) {
	change := "260313-abc-feature"
	changeEntry := paneMapEntry{Session: "dev", WindowIndex: 0, Pane: "%0", Change: &change}
	bareEntry := paneMapEntry{Session: "dev", WindowIndex: 0, Pane: "%1", Change: nil}
	paneMap := map[string]paneMapEntry{"%0": changeEntry, "%1": bareEntry}

	orderings := []struct {
		name      string
		paneOrder []tmux.PaneInfo
	}{
		{name: "change pane first", paneOrder: []tmux.PaneInfo{{PaneID: "%0"}, {PaneID: "%1"}}},
		{name: "bare pane first", paneOrder: []tmux.PaneInfo{{PaneID: "%1"}, {PaneID: "%0"}}},
	}

	for _, o := range orderings {
		t.Run(o.name, func(t *testing.T) {
			data := []sessionData{{
				info:    tmux.SessionInfo{Name: "dev"},
				windows: []tmux.WindowInfo{{Index: 0, WindowID: "@0", Panes: o.paneOrder}},
			}}
			enrich := joinPaneMapByWindow(paneMap, data)
			got, ok := enrich["@0"]
			if !ok {
				t.Fatalf("no enrichment for window @0")
			}
			if got.Pane != changeEntry.Pane {
				t.Errorf("got pane %q, want %q (change entry should win)", got.Pane, changeEntry.Pane)
			}
			if got.Change == nil || *got.Change != change {
				t.Errorf("got Change %v, want %q", got.Change, change)
			}
		})
	}
}

func TestResolveCwdMissing(t *testing.T) {
	existing := t.TempDir()
	gone := filepath.Join(existing, "deleted-worktree")
	// `gone` is never created, so it is guaranteed not to exist.

	got := resolveCwdMissing([]string{existing, gone, ""})

	if _, ok := got[existing]; ok {
		t.Errorf("existing dir %q should not be flagged missing", existing)
	}
	if !got[gone] {
		t.Errorf("nonexistent dir %q should be flagged missing", gone)
	}
	if _, ok := got[""]; ok {
		t.Errorf("empty cwd should be skipped, not flagged")
	}
}

func TestFormatAgentDuration(t *testing.T) {
	cases := []struct {
		elapsed int64
		want    string
	}{
		{-5, ""},
		{0, ""},
		{45, "45s"},
		{59, "59s"},
		{60, "1m"},
		{130, "2m"},
		{3599, "59m"},
		{3600, "1h"},
		{7300, "2h"},
	}
	for _, c := range cases {
		if got := formatAgentDuration(c.elapsed); got != c.want {
			t.Errorf("formatAgentDuration(%d) = %q, want %q", c.elapsed, got, c.want)
		}
	}
}

func TestRollupAgentState(t *testing.T) {
	const now int64 = 1_000_000

	t.Run("waiting wins over active", func(t *testing.T) {
		panes := []tmux.PaneInfo{
			{AgentState: tmux.AgentStateActive, AgentStateEpoch: now - 10},
			{AgentState: tmux.AgentStateWaiting, AgentStateEpoch: now - 130},
		}
		state, dur := rollupAgentState(panes, now)
		if state != tmux.AgentStateWaiting {
			t.Errorf("state = %q, want waiting", state)
		}
		if dur != "2m" {
			t.Errorf("waiting duration = %q, want 2m", dur)
		}
	})

	t.Run("active wins over idle", func(t *testing.T) {
		panes := []tmux.PaneInfo{
			{AgentState: tmux.AgentStateIdle, AgentStateEpoch: now - 300},
			{AgentState: tmux.AgentStateActive, AgentStateEpoch: now - 5},
		}
		state, dur := rollupAgentState(panes, now)
		if state != tmux.AgentStateActive {
			t.Errorf("state = %q, want active", state)
		}
		if dur != "" {
			t.Errorf("active duration = %q, want empty", dur)
		}
	})

	t.Run("idle duration formatted from epoch", func(t *testing.T) {
		panes := []tmux.PaneInfo{
			{AgentState: tmux.AgentStateIdle, AgentStateEpoch: now - 130},
		}
		state, dur := rollupAgentState(panes, now)
		if state != tmux.AgentStateIdle || dur != "2m" {
			t.Errorf("got (%q, %q), want (idle, 2m)", state, dur)
		}
	})

	t.Run("no agent panes yields empty", func(t *testing.T) {
		panes := []tmux.PaneInfo{
			{AgentState: "", AgentStateEpoch: 0},
			{Command: "zsh"},
		}
		state, dur := rollupAgentState(panes, now)
		if state != "" || dur != "" {
			t.Errorf("got (%q, %q), want empty", state, dur)
		}
	})

	t.Run("idle with zero epoch has no duration", func(t *testing.T) {
		panes := []tmux.PaneInfo{
			{AgentState: tmux.AgentStateIdle, AgentStateEpoch: 0},
		}
		state, dur := rollupAgentState(panes, now)
		if state != tmux.AgentStateIdle || dur != "" {
			t.Errorf("got (%q, %q), want (idle, empty)", state, dur)
		}
	})

	t.Run("tie-break prefers newest epoch at same precedence", func(t *testing.T) {
		// Two waiting panes: the older one is listed first. The rollup must
		// pick the newest epoch so the duration reflects the most-recently-
		// updated pane, not the arbitrary first one (which would inflate it).
		panes := []tmux.PaneInfo{
			{AgentState: tmux.AgentStateWaiting, AgentStateEpoch: now - 600},
			{AgentState: tmux.AgentStateWaiting, AgentStateEpoch: now - 60},
		}
		state, dur := rollupAgentState(panes, now)
		if state != tmux.AgentStateWaiting {
			t.Errorf("state = %q, want waiting", state)
		}
		if dur != "1m" {
			t.Errorf("tie-break duration = %q, want 1m (newest epoch), not 10m", dur)
		}
	})

	t.Run("tie-break is order-independent", func(t *testing.T) {
		// Same two panes with the newest listed first — result must be identical.
		panes := []tmux.PaneInfo{
			{AgentState: tmux.AgentStateWaiting, AgentStateEpoch: now - 60},
			{AgentState: tmux.AgentStateWaiting, AgentStateEpoch: now - 600},
		}
		state, dur := rollupAgentState(panes, now)
		if state != tmux.AgentStateWaiting || dur != "1m" {
			t.Errorf("got (%q, %q), want (waiting, 1m)", state, dur)
		}
	})
}

// strPtr is a test helper returning a pointer to s.
func strPtr(s string) *string { return &s }
