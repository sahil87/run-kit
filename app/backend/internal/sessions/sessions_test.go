package sessions

import (
	"encoding/json"
	"fmt"
	"testing"

	"run-kit/internal/tmux"
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
		Name:   "my-project",
		Server: "runkit",
		Windows: []tmux.WindowInfo{
			{Index: 0, Name: "main", WorktreePath: "/home/user/project", Activity: "active", IsActiveWindow: true},
			{Index: 1, Name: "build", WorktreePath: "/tmp/build", Activity: "idle", IsActiveWindow: false},
		},
	}

	if ps.Name != "my-project" {
		t.Errorf("Name = %q, want %q", ps.Name, "my-project")
	}
	if ps.Server != "runkit" {
		t.Errorf("Server = %q, want %q", ps.Server, "runkit")
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

func TestProjectSessionServerField(t *testing.T) {
	// Verify the Server field serializes correctly for both values.
	for _, server := range []string{"runkit", "default"} {
		ps := ProjectSession{Name: "test", Server: server}
		if ps.Server != server {
			t.Errorf("Server = %q, want %q", ps.Server, server)
		}
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

func TestFetchPaneMapNonexistentBinary(t *testing.T) {
	// fetchPaneMap with a bad repoRoot should return an error.
	m, err := fetchPaneMap("/nonexistent/path")
	if err == nil {
		t.Error("expected error for nonexistent binary, got nil")
	}
	if m != nil {
		t.Errorf("expected nil map, got %v", m)
	}
}

// strPtr is a test helper returning a pointer to s.
func strPtr(s string) *string { return &s }


