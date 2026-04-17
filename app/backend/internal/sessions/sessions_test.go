package sessions

import (
	"context"
	"encoding/json"
	"fmt"
	"sync/atomic"
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

// --- enrichLastLines tests ---

// withCaptureFn swaps capturePaneFn for the duration of a test and restores it.
func withCaptureFn(t *testing.T, fn func(ctx context.Context, session string, index int, lines int, server string) (string, error)) {
	t.Helper()
	prev := capturePaneFn
	capturePaneFn = fn
	t.Cleanup(func() { capturePaneFn = prev })
}

func TestEnrichLastLinesHappyPath(t *testing.T) {
	withCaptureFn(t, func(ctx context.Context, session string, index int, lines int, server string) (string, error) {
		// Return a simple fake capture that includes ANSI escapes to verify
		// the stripper is wired in.
		return fmt.Sprintf("\x1b[32mrunning %s:%d\x1b[0m\n", session, index), nil
	})

	sessions := []ProjectSession{
		{
			Name: "dev",
			Windows: []tmux.WindowInfo{
				{Index: 0, Name: "main"},
				{Index: 1, Name: "build"},
			},
		},
		{
			Name: "ops",
			Windows: []tmux.WindowInfo{
				{Index: 0, Name: "logs"},
			},
		},
	}

	enrichLastLines(context.Background(), "default", sessions)

	if got := sessions[0].Windows[0].LastLine; got != "running dev:0" {
		t.Errorf("dev:0 LastLine = %q, want %q", got, "running dev:0")
	}
	if got := sessions[0].Windows[1].LastLine; got != "running dev:1" {
		t.Errorf("dev:1 LastLine = %q, want %q", got, "running dev:1")
	}
	if got := sessions[1].Windows[0].LastLine; got != "running ops:0" {
		t.Errorf("ops:0 LastLine = %q, want %q", got, "running ops:0")
	}
}

func TestEnrichLastLinesPerWindowErrorIsolation(t *testing.T) {
	withCaptureFn(t, func(ctx context.Context, session string, index int, lines int, server string) (string, error) {
		if session == "dev" && index == 1 {
			return "", fmt.Errorf("simulated tmux error")
		}
		return fmt.Sprintf("ok-%s-%d\n", session, index), nil
	})

	sessions := []ProjectSession{
		{
			Name: "dev",
			Windows: []tmux.WindowInfo{
				{Index: 0, Name: "main"},
				{Index: 1, Name: "build"},
				{Index: 2, Name: "test"},
			},
		},
	}
	enrichLastLines(context.Background(), "default", sessions)

	if got := sessions[0].Windows[0].LastLine; got != "ok-dev-0" {
		t.Errorf("dev:0 LastLine = %q, want %q", got, "ok-dev-0")
	}
	if got := sessions[0].Windows[1].LastLine; got != "" {
		t.Errorf("dev:1 LastLine = %q, want empty on error", got)
	}
	if got := sessions[0].Windows[2].LastLine; got != "ok-dev-2" {
		t.Errorf("dev:2 LastLine = %q, want %q", got, "ok-dev-2")
	}
}

func TestEnrichLastLinesEmptyOnWhitespaceCapture(t *testing.T) {
	withCaptureFn(t, func(ctx context.Context, session string, index int, lines int, server string) (string, error) {
		return "\n\n   \n", nil
	})

	sessions := []ProjectSession{
		{
			Name: "dev",
			Windows: []tmux.WindowInfo{
				{Index: 0, Name: "main"},
			},
		},
	}
	enrichLastLines(context.Background(), "default", sessions)

	if got := sessions[0].Windows[0].LastLine; got != "" {
		t.Errorf("LastLine from whitespace capture = %q, want empty", got)
	}
}

func TestEnrichLastLinesConcurrencyCap(t *testing.T) {
	// Verify that no more than captureConcurrency captures run at once even
	// when we feed it many windows.
	var inflight int32
	var maxInflight int32
	withCaptureFn(t, func(ctx context.Context, session string, index int, lines int, server string) (string, error) {
		cur := atomic.AddInt32(&inflight, 1)
		for {
			max := atomic.LoadInt32(&maxInflight)
			if cur <= max || atomic.CompareAndSwapInt32(&maxInflight, max, cur) {
				break
			}
		}
		// Small delay to ensure overlap.
		time.Sleep(10 * time.Millisecond)
		atomic.AddInt32(&inflight, -1)
		return "hello\n", nil
	})

	const total = 40
	windows := make([]tmux.WindowInfo, total)
	for i := 0; i < total; i++ {
		windows[i] = tmux.WindowInfo{Index: i, Name: fmt.Sprintf("w%d", i)}
	}
	sessions := []ProjectSession{{Name: "s", Windows: windows}}

	enrichLastLines(context.Background(), "default", sessions)

	if maxInflight > int32(captureConcurrency) {
		t.Errorf("max concurrent captures = %d, want <= %d", maxInflight, captureConcurrency)
	}
}
