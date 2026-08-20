package sessions

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

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

func TestProjectSessionIDPathJSON(t *testing.T) {
	// sessionId/sessionPath ride the same ProjectSession marshal that serves
	// GET /api/sessions and the SSE sessions event.
	ps := ProjectSession{Name: "test", SessionID: "$4", SessionPath: "/home/user/code/x"}
	data, err := json.Marshal(ps)
	if err != nil {
		t.Fatalf("json.Marshal failed: %v", err)
	}
	var raw map[string]any
	if err := json.Unmarshal(data, &raw); err != nil {
		t.Fatalf("json.Unmarshal failed: %v", err)
	}
	if raw["sessionId"] != "$4" {
		t.Errorf("sessionId = %v, want %q", raw["sessionId"], "$4")
	}
	if raw["sessionPath"] != "/home/user/code/x" {
		t.Errorf("sessionPath = %v, want %q", raw["sessionPath"], "/home/user/code/x")
	}

	// Empty values omit the keys (additive optional-field idiom).
	bare, err := json.Marshal(ProjectSession{Name: "test"})
	if err != nil {
		t.Fatalf("json.Marshal failed: %v", err)
	}
	var rawBare map[string]any
	if err := json.Unmarshal(bare, &rawBare); err != nil {
		t.Fatalf("json.Unmarshal failed: %v", err)
	}
	if _, ok := rawBare["sessionId"]; ok {
		t.Error("sessionId present on empty SessionID, want omitted")
	}
	if _, ok := rawBare["sessionPath"]; ok {
		t.Error("sessionPath present on empty SessionPath, want omitted")
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
		if got := FormatAgentDuration(c.elapsed); got != c.want {
			t.Errorf("FormatAgentDuration(%d) = %q, want %q", c.elapsed, got, c.want)
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

// TestDeriveGitRoot covers the code-lens availability derivation (260811-k3vp):
// the window's git toplevel from its active pane's cwd, with the
// first-pane-cwd → worktree-path fallbacks and the non-repo empty case.
func TestDeriveGitRoot(t *testing.T) {
	// A temp "repo" (a dir containing .git is enough for FindGitRoot) with a
	// nested subdir, plus a plain non-repo dir.
	repo := t.TempDir()
	if err := os.Mkdir(filepath.Join(repo, ".git"), 0o755); err != nil {
		t.Fatal(err)
	}
	sub := filepath.Join(repo, "app", "backend")
	if err := os.MkdirAll(sub, 0o755); err != nil {
		t.Fatal(err)
	}
	plain := t.TempDir()

	t.Run("active pane cwd inside a repo resolves to the toplevel", func(t *testing.T) {
		w := &tmux.WindowInfo{
			Panes: []tmux.PaneInfo{
				{Cwd: plain},
				{IsActive: true, Cwd: sub},
			},
		}
		if got := deriveGitRoot(w); got != repo {
			t.Errorf("got %q, want %q", got, repo)
		}
	})

	t.Run("falls back to the first pane's cwd when the active pane's is empty", func(t *testing.T) {
		w := &tmux.WindowInfo{
			Panes: []tmux.PaneInfo{
				{Cwd: sub},
				{IsActive: true, Cwd: ""}, // active, but blank — must not clobber the seed
			},
		}
		if got := deriveGitRoot(w); got != repo {
			t.Errorf("got %q, want %q", got, repo)
		}
	})

	t.Run("falls back to the worktree path when there are no panes", func(t *testing.T) {
		w := &tmux.WindowInfo{WorktreePath: sub}
		if got := deriveGitRoot(w); got != repo {
			t.Errorf("got %q, want %q", got, repo)
		}
	})

	t.Run("non-repo cwd yields empty", func(t *testing.T) {
		w := &tmux.WindowInfo{
			Panes: []tmux.PaneInfo{{IsActive: true, Cwd: plain}},
		}
		if got := deriveGitRoot(w); got != "" {
			t.Errorf("got %q, want empty (not a repo)", got)
		}
	})

	t.Run("no cwd derivable yields empty", func(t *testing.T) {
		w := &tmux.WindowInfo{}
		if got := deriveGitRoot(w); got != "" {
			t.Errorf("got %q, want empty", got)
		}
	})
}

func TestRollupChat(t *testing.T) {
	t.Run("active pane wins", func(t *testing.T) {
		panes := []tmux.PaneInfo{
			{ChatProvider: "claude", ChatSessionRef: "inactive-ref"},
			{IsActive: true, ChatProvider: "claude", ChatSessionRef: "active-ref"},
		}
		provider, ref := rollupChat(panes)
		if provider != "claude" || ref != "active-ref" {
			t.Errorf("got (%q, %q), want (claude, active-ref)", provider, ref)
		}
	})

	t.Run("falls back to first pane carrying a chat when active pane has none", func(t *testing.T) {
		panes := []tmux.PaneInfo{
			{IsActive: true}, // active pane has no chat
			{ChatProvider: "claude", ChatSessionRef: "first-set"},
			{ChatProvider: "codex", ChatSessionRef: "later"},
		}
		provider, ref := rollupChat(panes)
		if provider != "claude" || ref != "first-set" {
			t.Errorf("got (%q, %q), want (claude, first-set)", provider, ref)
		}
	})

	t.Run("no chat on any pane yields empty", func(t *testing.T) {
		panes := []tmux.PaneInfo{{IsActive: true}, {Command: "zsh"}}
		provider, ref := rollupChat(panes)
		if provider != "" || ref != "" {
			t.Errorf("got (%q, %q), want empty", provider, ref)
		}
	})

	t.Run("single agent pane (the common case)", func(t *testing.T) {
		panes := []tmux.PaneInfo{{IsActive: true, ChatProvider: "claude", ChatSessionRef: "solo"}}
		provider, ref := rollupChat(panes)
		if provider != "claude" || ref != "solo" {
			t.Errorf("got (%q, %q), want (claude, solo)", provider, ref)
		}
	})
}

func TestRollupAltScreen(t *testing.T) {
	t.Run("active pane alt-screen yields true", func(t *testing.T) {
		panes := []tmux.PaneInfo{
			{AltScreen: false},
			{IsActive: true, AltScreen: true},
		}
		if !rollupAltScreen(panes) {
			t.Error("got false, want true")
		}
	})

	t.Run("non-active alt-screen pane alone yields false", func(t *testing.T) {
		panes := []tmux.PaneInfo{
			{IsActive: true, AltScreen: false},
			{AltScreen: true},
		}
		if rollupAltScreen(panes) {
			t.Error("got true, want false")
		}
	})

	t.Run("zero panes yields false", func(t *testing.T) {
		if rollupAltScreen(nil) {
			t.Error("got true, want false")
		}
	})
}

// TestResolveChatPane covers the paneID surfaced alongside provider/ref — the
// chat-send injection target (a window target may route to the wrong pane in a
// split). The active-pane-first / else-first-chat-pane rule is shared with
// rollupChat via delegation.
func TestResolveChatPane(t *testing.T) {
	t.Run("active chat pane wins and its paneID is returned", func(t *testing.T) {
		panes := []tmux.PaneInfo{
			{PaneID: "%1", ChatProvider: "claude", ChatSessionRef: "inactive-ref"},
			{PaneID: "%2", IsActive: true, ChatProvider: "claude", ChatSessionRef: "active-ref"},
		}
		provider, ref, paneID := ResolveChatPane(panes)
		if provider != "claude" || ref != "active-ref" || paneID != "%2" {
			t.Errorf("got (%q, %q, %q), want (claude, active-ref, %%2)", provider, ref, paneID)
		}
	})

	t.Run("active pane has no chat — first chat pane's id is returned", func(t *testing.T) {
		panes := []tmux.PaneInfo{
			{PaneID: "%0", IsActive: true}, // active pane has no chat
			{PaneID: "%1", ChatProvider: "claude", ChatSessionRef: "first-set"},
			{PaneID: "%2", ChatProvider: "codex", ChatSessionRef: "later"},
		}
		provider, ref, paneID := ResolveChatPane(panes)
		if provider != "claude" || ref != "first-set" || paneID != "%1" {
			t.Errorf("got (%q, %q, %q), want (claude, first-set, %%1)", provider, ref, paneID)
		}
	})

	t.Run("no chat on any pane yields empty paneID", func(t *testing.T) {
		panes := []tmux.PaneInfo{{PaneID: "%0", IsActive: true}, {PaneID: "%1", Command: "zsh"}}
		provider, ref, paneID := ResolveChatPane(panes)
		if provider != "" || ref != "" || paneID != "" {
			t.Errorf("got (%q, %q, %q), want all empty", provider, ref, paneID)
		}
	})
}
