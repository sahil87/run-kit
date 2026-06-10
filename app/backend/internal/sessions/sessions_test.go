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
	agentState := "active"

	jsonData := `[
		{"session":"dev","window_index":0,"pane":"%0","tab":"main","worktree":"/home/user/project","change":"260313-abc-feature","stage":"apply","agent_state":"active","agent_idle_duration":null},
		{"session":"dev","window_index":1,"pane":"%1","tab":"build","worktree":"/tmp/build","change":null,"stage":null,"agent_state":null,"agent_idle_duration":null}
	]`

	var entries []paneMapEntry
	if err := json.Unmarshal([]byte(jsonData), &entries); err != nil {
		t.Fatalf("failed to parse pane-map JSON: %v", err)
	}

	if len(entries) != 2 {
		t.Fatalf("got %d entries, want 2", len(entries))
	}

	// First entry: fab pane with populated fields
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
	if e0.AgentState == nil || *e0.AgentState != agentState {
		t.Errorf("entries[0].AgentState = %v, want %q", e0.AgentState, agentState)
	}
	if e0.AgentIdleDuration != nil {
		t.Errorf("entries[0].AgentIdleDuration = %v, want nil", e0.AgentIdleDuration)
	}

	// Second entry: non-fab pane with null fields
	e1 := entries[1]
	if e1.Change != nil {
		t.Errorf("entries[1].Change = %v, want nil", e1.Change)
	}
	if e1.Stage != nil {
		t.Errorf("entries[1].Stage = %v, want nil", e1.Stage)
	}
	if e1.AgentState != nil {
		t.Errorf("entries[1].AgentState = %v, want nil", e1.AgentState)
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
	change := "260313-abc-feature"
	stage := "apply"
	agentState := "active"
	idleDuration := "5m"

	paneMap := map[string]paneMapEntry{
		"dev:0": {
			Session:           "dev",
			WindowIndex:       0,
			Change:            &change,
			Stage:             &stage,
			AgentState:        &agentState,
			AgentIdleDuration: nil,
		},
		"dev:1": {
			Session:           "dev",
			WindowIndex:       1,
			Change:            &change,
			Stage:             &stage,
			AgentState:        strPtr("idle"),
			AgentIdleDuration: &idleDuration,
		},
	}

	windows := []tmux.WindowInfo{
		{Index: 0, Name: "main"},
		{Index: 1, Name: "build"},
		{Index: 2, Name: "test"},
	}

	sessionName := "dev"
	for j := range windows {
		key := fmt.Sprintf("%s:%d", sessionName, windows[j].Index)
		if entry, ok := paneMap[key]; ok {
			windows[j].FabChange = derefStr(entry.Change)
			windows[j].FabStage = derefStr(entry.Stage)
			windows[j].AgentState = derefStr(entry.AgentState)
			windows[j].AgentIdleDuration = derefStr(entry.AgentIdleDuration)
		}
	}

	// Window 0: fab pane, active agent
	if windows[0].FabChange != change {
		t.Errorf("windows[0].FabChange = %q, want %q", windows[0].FabChange, change)
	}
	if windows[0].FabStage != stage {
		t.Errorf("windows[0].FabStage = %q, want %q", windows[0].FabStage, stage)
	}
	if windows[0].AgentState != agentState {
		t.Errorf("windows[0].AgentState = %q, want %q", windows[0].AgentState, agentState)
	}
	if windows[0].AgentIdleDuration != "" {
		t.Errorf("windows[0].AgentIdleDuration = %q, want empty", windows[0].AgentIdleDuration)
	}

	// Window 1: fab pane, idle agent
	if windows[1].FabChange != change {
		t.Errorf("windows[1].FabChange = %q, want %q", windows[1].FabChange, change)
	}
	if windows[1].AgentState != "idle" {
		t.Errorf("windows[1].AgentState = %q, want %q", windows[1].AgentState, "idle")
	}
	if windows[1].AgentIdleDuration != idleDuration {
		t.Errorf("windows[1].AgentIdleDuration = %q, want %q", windows[1].AgentIdleDuration, idleDuration)
	}

	// Window 2: no pane-map entry — fab fields remain empty
	if windows[2].FabChange != "" {
		t.Errorf("windows[2].FabChange = %q, want empty", windows[2].FabChange)
	}
	if windows[2].FabStage != "" {
		t.Errorf("windows[2].FabStage = %q, want empty", windows[2].FabStage)
	}
	if windows[2].AgentState != "" {
		t.Errorf("windows[2].AgentState = %q, want empty", windows[2].AgentState)
	}
}

func TestPaneMapNilLeavesAllFieldsEmpty(t *testing.T) {
	// When fetchPaneMap fails, paneMap is nil — all fab fields stay empty.
	var paneMap map[string]paneMapEntry

	windows := []tmux.WindowInfo{
		{Index: 0, Name: "main"},
		{Index: 1, Name: "build"},
	}

	sessionName := "dev"
	for j := range windows {
		key := fmt.Sprintf("%s:%d", sessionName, windows[j].Index)
		if entry, ok := paneMap[key]; ok {
			windows[j].FabChange = derefStr(entry.Change)
			windows[j].FabStage = derefStr(entry.Stage)
			windows[j].AgentState = derefStr(entry.AgentState)
			windows[j].AgentIdleDuration = derefStr(entry.AgentIdleDuration)
		}
	}

	for i, w := range windows {
		if w.FabChange != "" {
			t.Errorf("windows[%d].FabChange = %q, want empty", i, w.FabChange)
		}
		if w.FabStage != "" {
			t.Errorf("windows[%d].FabStage = %q, want empty", i, w.FabStage)
		}
		if w.AgentState != "" {
			t.Errorf("windows[%d].AgentState = %q, want empty", i, w.AgentState)
		}
		if w.AgentIdleDuration != "" {
			t.Errorf("windows[%d].AgentIdleDuration = %q, want empty", i, w.AgentIdleDuration)
		}
	}
}

func TestPaneMapEntryParsesPrFields(t *testing.T) {
	jsonData := `[
		{"session":"dev","window_index":0,"pane":"%0","tab":"main","worktree":"/p","change":"260610-596o-x","stage":"apply","agent_state":null,"agent_idle_duration":null,"pr_url":"https://github.com/o/r/pull/386","pr_number":386},
		{"session":"dev","window_index":1,"pane":"%1","tab":"build","worktree":"/b","change":null,"stage":null,"agent_state":null,"agent_idle_duration":null,"pr_url":null,"pr_number":null}
	]`

	var entries []paneMapEntry
	if err := json.Unmarshal([]byte(jsonData), &entries); err != nil {
		t.Fatalf("failed to parse pane-map JSON: %v", err)
	}
	if len(entries) != 2 {
		t.Fatalf("got %d entries, want 2", len(entries))
	}

	// First entry: PR fields populated.
	if entries[0].PrURL == nil || *entries[0].PrURL != "https://github.com/o/r/pull/386" {
		t.Errorf("entries[0].PrURL = %v, want the PR url", entries[0].PrURL)
	}
	if entries[0].PrNumber == nil || *entries[0].PrNumber != 386 {
		t.Errorf("entries[0].PrNumber = %v, want 386", entries[0].PrNumber)
	}
	// Second entry: null PR fields parse to nil pointers.
	if entries[1].PrURL != nil {
		t.Errorf("entries[1].PrURL = %v, want nil", entries[1].PrURL)
	}
	if entries[1].PrNumber != nil {
		t.Errorf("entries[1].PrNumber = %v, want nil", entries[1].PrNumber)
	}
}

func TestPaneMapJoinPopulatesPerWindowPrFields(t *testing.T) {
	change := "260610-596o-x"
	prURL := "https://github.com/o/r/pull/386"
	prNumber := 386

	paneMap := map[string]paneMapEntry{
		// Window with a PR (change-bound).
		"dev:0": {
			Session:     "dev",
			WindowIndex: 0,
			Change:      &change,
			PrURL:       &prURL,
			PrNumber:    &prNumber,
		},
		// Window with a pane-map entry but null PR fields.
		"dev:1": {
			Session:     "dev",
			WindowIndex: 1,
			Change:      &change,
			PrURL:       nil,
			PrNumber:    nil,
		},
	}

	windows := []tmux.WindowInfo{
		{Index: 0, WindowID: "@10", Name: "main"},
		{Index: 1, WindowID: "@11", Name: "build"},
		{Index: 2, WindowID: "@12", Name: "test"}, // no pane-map entry
	}

	// Mirror the FetchSessions enrichment join FAITHFULLY: production does not
	// join by (session, index) directly — it first re-keys the (session, index)
	// pane-map onto each window's stable WindowID (so an index shift from a
	// reorder can never misattribute one window's PR fields to another), then
	// joins by WindowID. Reproduce both steps here.
	sessionName := "dev"
	enrichByWindowID := make(map[string]paneMapEntry, len(paneMap))
	for j := range windows {
		indexKey := fmt.Sprintf("%s:%d", sessionName, windows[j].Index)
		if entry, ok := paneMap[indexKey]; ok {
			enrichByWindowID[windows[j].WindowID] = entry
		}
	}
	for j := range windows {
		if entry, ok := enrichByWindowID[windows[j].WindowID]; ok {
			windows[j].PrURL = entry.PrURL
			windows[j].PrNumber = entry.PrNumber
		}
	}

	// Window 0: PR fields flow through as the entry's pointer values.
	if windows[0].PrURL == nil || *windows[0].PrURL != prURL {
		t.Errorf("windows[0].PrURL = %v, want %q", windows[0].PrURL, prURL)
	}
	if windows[0].PrNumber == nil || *windows[0].PrNumber != prNumber {
		t.Errorf("windows[0].PrNumber = %v, want %d", windows[0].PrNumber, prNumber)
	}

	// Window 1: pane-map entry present but null PR fields → nil.
	if windows[1].PrURL != nil {
		t.Errorf("windows[1].PrURL = %v, want nil", windows[1].PrURL)
	}
	if windows[1].PrNumber != nil {
		t.Errorf("windows[1].PrNumber = %v, want nil", windows[1].PrNumber)
	}

	// Window 2: no pane-map entry → nil PR fields.
	if windows[2].PrURL != nil {
		t.Errorf("windows[2].PrURL = %v, want nil", windows[2].PrURL)
	}
	if windows[2].PrNumber != nil {
		t.Errorf("windows[2].PrNumber = %v, want nil", windows[2].PrNumber)
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
// `go test`. Booting our own server makes the real parse+dedup path
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
	// the booted session SHALL appear — proving the real parse+dedup path ran,
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

// TestPaneMapDedupPrefersAgentState verifies rule-2: when both colliding
// entries have nil Change, the entry with non-nil AgentState wins over the
// all-nil entry. Runs both input orderings to prove the result is determined
// by entry content, not slice position.
func TestPaneMapDedupPrefersAgentState(t *testing.T) {
	agentState := "active"
	bare := paneMapEntry{
		Session:     "dev",
		WindowIndex: 0,
		Pane:        "%0",
		Change:      nil,
		AgentState:  nil,
	}
	agent := paneMapEntry{
		Session:     "dev",
		WindowIndex: 0,
		Pane:        "%1",
		Change:      nil,
		AgentState:  &agentState,
	}

	orderings := []struct {
		name    string
		entries []paneMapEntry
	}{
		{name: "agent-first", entries: []paneMapEntry{agent, bare}},
		{name: "bare-first", entries: []paneMapEntry{bare, agent}},
	}

	for _, o := range orderings {
		t.Run(o.name, func(t *testing.T) {
			m := dedupEntries(o.entries)
			got, ok := m["dev:0"]
			if !ok {
				t.Fatalf("map missing key dev:0")
			}
			if got.Pane != agent.Pane {
				t.Errorf("got pane %q, want %q (agent entry should win)", got.Pane, agent.Pane)
			}
			if got.AgentState == nil || *got.AgentState != agentState {
				t.Errorf("got AgentState %v, want %q", got.AgentState, agentState)
			}
		})
	}
}

// TestPaneMapDedupChangeStillWinsOverAgent verifies rule-1 priority is
// unaffected by the new rule-2: an entry with non-nil Change (and nil
// AgentState) beats an entry with nil Change (and non-nil AgentState),
// regardless of input order.
func TestPaneMapDedupChangeStillWinsOverAgent(t *testing.T) {
	change := "260313-abc-feature"
	agentState := "active"
	changeEntry := paneMapEntry{
		Session:     "dev",
		WindowIndex: 0,
		Pane:        "%0",
		Change:      &change,
		AgentState:  nil,
	}
	agentEntry := paneMapEntry{
		Session:     "dev",
		WindowIndex: 0,
		Pane:        "%1",
		Change:      nil,
		AgentState:  &agentState,
	}

	orderings := []struct {
		name    string
		entries []paneMapEntry
	}{
		{name: "change-first", entries: []paneMapEntry{changeEntry, agentEntry}},
		{name: "agent-first", entries: []paneMapEntry{agentEntry, changeEntry}},
	}

	for _, o := range orderings {
		t.Run(o.name, func(t *testing.T) {
			m := dedupEntries(o.entries)
			got, ok := m["dev:0"]
			if !ok {
				t.Fatalf("map missing key dev:0")
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

// strPtr is a test helper returning a pointer to s.
func strPtr(s string) *string { return &s }
