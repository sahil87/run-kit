package sessions

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
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

// TestOperatorSessionHidden pins the content-conditional hidden rule: the
// operator session is hidden only while it holds ≥1 window AND every window
// carries role == "operator"; a mixed/stray population (any non-operator
// window, or any other session name) yields false so no window can ever become
// invisible.
func TestOperatorSessionHidden(t *testing.T) {
	op := tmux.WindowInfo{WindowID: "@1", Role: "operator"}
	plain := tmux.WindowInfo{WindowID: "@2"}
	tests := []struct {
		name    string
		session string
		windows []tmux.WindowInfo
		want    bool
	}{
		{"all-operator single window is hidden", tmux.OperatorSessionName, []tmux.WindowInfo{op}, true},
		{"all-operator multi window is hidden", tmux.OperatorSessionName, []tmux.WindowInfo{op, {WindowID: "@3", Role: "operator"}}, true},
		{"mixed population is visible", tmux.OperatorSessionName, []tmux.WindowInfo{op, plain}, false},
		{"lone non-operator window is visible", tmux.OperatorSessionName, []tmux.WindowInfo{plain}, false},
		{"empty operator session is not hidden", tmux.OperatorSessionName, nil, false},
		{"a non-operator session is never hidden", "work", []tmux.WindowInfo{op}, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := operatorSessionHidden(tt.session, tt.windows); got != tt.want {
				t.Errorf("operatorSessionHidden(%q, %d windows) = %v, want %v", tt.session, len(tt.windows), got, tt.want)
			}
		})
	}
}

// TestProjectSessionHiddenJSON pins the wire shape: hidden is omitempty —
// present as true only on a hidden operator session, absent otherwise.
func TestProjectSessionHiddenJSON(t *testing.T) {
	hidden := ProjectSession{Name: tmux.OperatorSessionName, Hidden: true, Windows: []tmux.WindowInfo{}}
	b, err := json.Marshal(hidden)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(b), `"hidden":true`) {
		t.Errorf("hidden session JSON = %s, want hidden:true present", b)
	}
	visible := ProjectSession{Name: "work", Windows: []tmux.WindowInfo{}}
	b2, err := json.Marshal(visible)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(b2), "hidden") {
		t.Errorf("visible session JSON = %s, want hidden omitted", b2)
	}
}

// --- branch→PR presence: gitRoot keying + detached-HEAD grace ---

// writeGitHead writes a repo's .git/HEAD content, creating the .git dir.
func writeGitHead(t *testing.T, repo, content string) {
	t.Helper()
	gitDir := filepath.Join(repo, ".git")
	if err := os.MkdirAll(gitDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(gitDir, "HEAD"), []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

// resetGitBranchCache empties the package-global branch cache for a test and
// restores the previous map on cleanup, so tests never leak entries.
func resetGitBranchCache(t *testing.T) {
	t.Helper()
	gitBranchCacheMu.Lock()
	prev := gitBranchCache
	gitBranchCache = make(map[string]gitBranchCacheEntry)
	gitBranchCacheMu.Unlock()
	t.Cleanup(func() {
		gitBranchCacheMu.Lock()
		gitBranchCache = prev
		gitBranchCacheMu.Unlock()
	})
}

// ageGitBranchEntry expires a cache entry (forcing re-resolution on the next
// pass) and optionally backdates its last-good stamp by lastGoodAge.
func ageGitBranchEntry(t *testing.T, cwd string, lastGoodAge time.Duration) {
	t.Helper()
	gitBranchCacheMu.Lock()
	defer gitBranchCacheMu.Unlock()
	e, ok := gitBranchCache[cwd]
	if !ok {
		t.Fatalf("no cache entry for %q", cwd)
	}
	e.expiresAt = time.Now().Add(-time.Second)
	if lastGoodAge > 0 {
		e.lastGoodAt = time.Now().Add(-lastGoodAge)
	}
	gitBranchCache[cwd] = e
}

func TestResolveGitBranchesDetachedGrace(t *testing.T) {
	ctx := context.Background()

	t.Run("detached HEAD within grace serves the last-known branch", func(t *testing.T) {
		resetGitBranchCache(t)
		repo := t.TempDir()
		writeGitHead(t, repo, "ref: refs/heads/feat-x\n")
		if got := resolveGitBranches(ctx, []string{repo}); got[repo] != "feat-x" {
			t.Fatalf("positive resolve: got %q, want feat-x", got[repo])
		}

		// Rebase starts: HEAD detaches to a raw SHA. Expire the cached positive
		// so the next call re-resolves.
		writeGitHead(t, repo, "0123456789abcdef0123456789abcdef01234567\n")
		ageGitBranchEntry(t, repo, 0)
		if got := resolveGitBranches(ctx, []string{repo}); got[repo] != "feat-x" {
			t.Errorf("grace serve: got %q, want feat-x", got[repo])
		}

		// The grace serve is cached on the short cadence and keeps serving from
		// cache within it.
		if got := resolveGitBranches(ctx, []string{repo}); got[repo] != "feat-x" {
			t.Errorf("cached grace serve: got %q, want feat-x", got[repo])
		}
	})

	t.Run("grace expiry blanks the branch", func(t *testing.T) {
		resetGitBranchCache(t)
		repo := t.TempDir()
		writeGitHead(t, repo, "ref: refs/heads/feat-x\n")
		resolveGitBranches(ctx, []string{repo})

		writeGitHead(t, repo, "0123456789abcdef0123456789abcdef01234567\n")
		ageGitBranchEntry(t, repo, gitBranchDetachedGraceTTL+time.Minute)
		if got := resolveGitBranches(ctx, []string{repo}); got[repo] != "" {
			t.Errorf("expired grace: got %q, want empty", got[repo])
		}
	})

	t.Run("re-attached HEAD resolves live and re-stamps the grace window", func(t *testing.T) {
		resetGitBranchCache(t)
		repo := t.TempDir()
		writeGitHead(t, repo, "ref: refs/heads/feat-x\n")
		resolveGitBranches(ctx, []string{repo})

		writeGitHead(t, repo, "0123456789abcdef0123456789abcdef01234567\n")
		ageGitBranchEntry(t, repo, 0)
		resolveGitBranches(ctx, []string{repo}) // grace serve

		// Rebase ends on a (possibly different) branch; the next expiry re-read
		// picks up the live ref.
		writeGitHead(t, repo, "ref: refs/heads/feat-y\n")
		ageGitBranchEntry(t, repo, 0)
		if got := resolveGitBranches(ctx, []string{repo}); got[repo] != "feat-y" {
			t.Errorf("re-attached: got %q, want feat-y", got[repo])
		}
		gitBranchCacheMu.RLock()
		lastGood := gitBranchCache[repo].lastGood
		gitBranchCacheMu.RUnlock()
		if lastGood != "feat-y" {
			t.Errorf("lastGood = %q, want feat-y (re-stamped on genuine positive)", lastGood)
		}
	})

	t.Run("first-sight detached HEAD has no grace and resolves empty", func(t *testing.T) {
		resetGitBranchCache(t)
		repo := t.TempDir()
		writeGitHead(t, repo, "0123456789abcdef0123456789abcdef01234567\n")
		if got := resolveGitBranches(ctx, []string{repo}); got[repo] != "" {
			t.Errorf("first-sight detached: got %q, want empty", got[repo])
		}
	})

	t.Run("non-repo cwd keeps plain negative behavior", func(t *testing.T) {
		resetGitBranchCache(t)
		plain := t.TempDir()
		if got := resolveGitBranches(ctx, []string{plain}); got[plain] != "" {
			t.Errorf("non-repo: got %q, want empty", got[plain])
		}
		gitBranchCacheMu.RLock()
		e := gitBranchCache[plain]
		gitBranchCacheMu.RUnlock()
		if e.branch != "" || e.lastGood != "" {
			t.Errorf("non-repo entry = %+v, want plain negative", e)
		}
	})
}

func TestResolveGitBranchFromHeadDetachedSignal(t *testing.T) {
	repo := t.TempDir()
	writeGitHead(t, repo, "0123456789abcdef0123456789abcdef01234567\n")
	branch, detached, ok := resolveGitBranchFromHead(repo)
	if branch != "" || !detached || ok {
		t.Errorf("detached HEAD: got (%q, %v, %v), want (\"\", true, false)", branch, detached, ok)
	}

	writeGitHead(t, repo, "ref: refs/heads/main\n")
	branch, detached, ok = resolveGitBranchFromHead(repo)
	if branch != "main" || detached || !ok {
		t.Errorf("ref HEAD: got (%q, %v, %v), want (main, false, true)", branch, detached, ok)
	}

	plain := t.TempDir()
	branch, detached, ok = resolveGitBranchFromHead(plain)
	if branch != "" || detached || ok {
		t.Errorf("non-repo: got (%q, %v, %v), want (\"\", false, false)", branch, detached, ok)
	}
}

func TestWindowPRKey(t *testing.T) {
	repo := t.TempDir()
	if err := os.Mkdir(filepath.Join(repo, ".git"), 0o755); err != nil {
		t.Fatal(err)
	}
	sub := filepath.Join(repo, "app", "backend")
	if err := os.MkdirAll(sub, 0o755); err != nil {
		t.Fatal(err)
	}
	plain := t.TempDir()

	t.Run("subdirectory cwd keys on the git root", func(t *testing.T) {
		w := tmux.WindowInfo{Panes: []tmux.PaneInfo{
			{Cwd: sub, GitBranch: "feat-x", IsActive: true},
		}}
		repoDir, branch := windowPRKey(&w)
		if repoDir != repo || branch != "feat-x" {
			t.Errorf("got (%q, %q), want (%q, feat-x)", repoDir, branch, repo)
		}
	})

	t.Run("root follows the branch-supplying pane, not the active pane", func(t *testing.T) {
		w := tmux.WindowInfo{Panes: []tmux.PaneInfo{
			{Cwd: plain, GitBranch: "", IsActive: true},
			{Cwd: sub, GitBranch: "feat-x"},
		}}
		repoDir, branch := windowPRKey(&w)
		if repoDir != repo || branch != "feat-x" {
			t.Errorf("got (%q, %q), want (%q, feat-x)", repoDir, branch, repo)
		}
	})

	t.Run("non-repo cwd falls back to the raw cwd", func(t *testing.T) {
		w := tmux.WindowInfo{Panes: []tmux.PaneInfo{
			{Cwd: plain, GitBranch: "feat-x", IsActive: true},
		}}
		repoDir, branch := windowPRKey(&w)
		if repoDir != plain || branch != "feat-x" {
			t.Errorf("got (%q, %q), want (%q, feat-x)", repoDir, branch, plain)
		}
	})

	t.Run("no branch yields empty pair", func(t *testing.T) {
		w := tmux.WindowInfo{Panes: []tmux.PaneInfo{{Cwd: sub, IsActive: true}}}
		repoDir, branch := windowPRKey(&w)
		if repoDir != "" || branch != "" {
			t.Errorf("got (%q, %q), want empty", repoDir, branch)
		}
	})
}

// TestDeriveWebCompat pins the retired rkUrl/rkType JSON derivation: rkUrl is
// the active tab's URL (absent when the family is empty), rkType is "iframe"
// exactly when the layout parses and contains a web surface.
func TestDeriveWebCompat(t *testing.T) {
	tests := []struct {
		name                  string
		layout                string
		tabs                  []string
		active                int
		wantRkURL, wantRkType string
	}{
		{
			name:   "web layout with one tab",
			layout: "single:web", tabs: []string{"/proxy/3000/"}, active: 1,
			wantRkURL: "/proxy/3000/", wantRkType: "iframe",
		},
		{
			name:   "active pointer selects the tab",
			layout: "split-h:tty,web", tabs: []string{"/proxy/1/", "/proxy/2/"}, active: 2,
			wantRkURL: "/proxy/2/", wantRkType: "iframe",
		},
		{
			name:   "web layout without tabs keeps rkType but omits rkUrl",
			layout: "single:web", active: 0,
			wantRkURL: "", wantRkType: "iframe",
		},
		{
			name: "tabs without a web layout keep rkUrl but omit rkType",
			tabs: []string{"/proxy/3000/"}, active: 1,
			wantRkURL: "/proxy/3000/", wantRkType: "",
		},
		{
			name:   "layout without a web surface omits rkType",
			layout: "split-h:tty,code", tabs: []string{"/proxy/1/"}, active: 1,
			wantRkURL: "/proxy/1/", wantRkType: "",
		},
		{
			name:   "unparseable layout omits rkType",
			layout: "grid:tty", tabs: []string{"/proxy/1/"}, active: 1,
			wantRkURL: "/proxy/1/", wantRkType: "",
		},
		{
			name:      "empty family and layout derive nothing",
			wantRkURL: "", wantRkType: "",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			w := tmux.WindowInfo{Layout: tt.layout, WebTabs: tt.tabs, WebActive: tt.active}
			deriveWebCompat(&w)
			if w.RkUrl != tt.wantRkURL {
				t.Errorf("RkUrl = %q, want %q", w.RkUrl, tt.wantRkURL)
			}
			if w.RkType != tt.wantRkType {
				t.Errorf("RkType = %q, want %q", w.RkType, tt.wantRkType)
			}
		})
	}
}
