package api

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"rk/internal/riff"
	"rk/internal/tmux"
)

// mockRiffEngine records the Options it was called with and returns a canned
// Result/err. This is the DEDICATED riff mock — the shared mockTmuxOps is not
// touched (the RiffEngine seam is a separate Server dependency).
type mockRiffEngine struct {
	called  bool
	gotOpts riff.Options
	result  riff.Result
	err     error
}

func (m *mockRiffEngine) Spawn(ctx context.Context, opts riff.Options) (riff.Result, error) {
	m.called = true
	m.gotOpts = opts
	if m.err != nil {
		return riff.Result{}, m.err
	}
	return m.result, nil
}

func newTestRouterWithRiff(sf SessionFetcher, ops TmuxOps, engine RiffEngine) http.Handler {
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))
	return NewTestRouterWithRiff(logger, sf, ops, engine, "test-host")
}

// gitRepoDir creates a temp dir containing a .git marker so config.FindGitRoot
// resolves it as a repo root. Returns the dir.
func gitRepoDir(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, ".git"), 0o755); err != nil {
		t.Fatalf("mkdir .git: %v", err)
	}
	return dir
}

// windowsWithActivePaneCwd builds a one-window, one-active-pane ListWindows
// result whose active pane cwd is `cwd` — the repo-root derivation input.
func windowsWithActivePaneCwd(cwd string) []tmux.WindowInfo {
	return []tmux.WindowInfo{
		{
			Index:          0,
			WindowID:       "@0",
			Name:           "main",
			WorktreePath:   cwd,
			IsActiveWindow: true,
			Panes: []tmux.PaneInfo{
				{PaneID: "%0", PaneIndex: 0, Cwd: cwd, IsActive: true},
			},
		},
	}
}

func postRiff(t *testing.T, ops *mockTmuxOps, engine RiffEngine, body string) *httptest.ResponseRecorder {
	t.Helper()
	router := newTestRouterWithRiff(&mockSessionFetcher{}, ops, engine)
	req := httptest.NewRequest(http.MethodPost, "/api/riff?server=work", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

// TestRiffSpawnSuccess: a valid POST with a repo-backed session returns 200 with
// {server, session, window, windowId} and feeds the engine the derived repo root.
func TestRiffSpawnSuccess(t *testing.T) {
	repo := gitRepoDir(t)
	ops := &mockTmuxOps{listWindowsResult: windowsWithActivePaneCwd(repo)}
	engine := &mockRiffEngine{result: riff.Result{
		Server:     "work",
		Session:    "mysess",
		WindowName: "riff-swift-fox",
		WindowID:   "@7",
	}}

	rec := postRiff(t, ops, engine, `{"task":"fix the bug","session":"mysess"}`)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if !engine.called {
		t.Fatal("engine.Spawn was not called")
	}
	if engine.gotOpts.RepoRoot != repo {
		t.Errorf("engine RepoRoot = %q, want derived %q", engine.gotOpts.RepoRoot, repo)
	}
	if engine.gotOpts.Server != "work" {
		t.Errorf("engine Server = %q, want work", engine.gotOpts.Server)
	}
	if engine.gotOpts.Session != "mysess" {
		t.Errorf("engine Session = %q, want mysess", engine.gotOpts.Session)
	}
	// Task text reaches the engine verbatim (the shell-escape happens inside the
	// engine's buildSkillShellString, unit-tested in internal/riff).
	if engine.gotOpts.Task != "fix the bug" {
		t.Errorf("engine Task = %q, want 'fix the bug'", engine.gotOpts.Task)
	}

	var got map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("unmarshal body: %v", err)
	}
	if got["server"] != "work" || got["session"] != "mysess" || got["window"] != "riff-swift-fox" || got["windowId"] != "@7" {
		t.Errorf("response = %v, want {server:work, session:mysess, window:riff-swift-fox, windowId:@7}", got)
	}
}

// TestRiffSpawnDefaultsWhereWorktree: omitting `where` defaults it to "worktree"
// at the handler, so the engine always sees an explicit mode (mockup-v2 R5).
func TestRiffSpawnDefaultsWhereWorktree(t *testing.T) {
	repo := gitRepoDir(t)
	ops := &mockTmuxOps{listWindowsResult: windowsWithActivePaneCwd(repo)}
	engine := &mockRiffEngine{result: riff.Result{Server: "work", Session: "s", WindowName: "riff-x", WindowID: "@1"}}
	rec := postRiff(t, ops, engine, `{"session":"s"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if engine.gotOpts.Where != "worktree" {
		t.Errorf("engine Where = %q, want defaulted \"worktree\"", engine.gotOpts.Where)
	}
}

// TestRiffSpawnCheckoutTierForwarded: where=checkout + tier reach the engine
// verbatim (mockup-v2 R5); worktreeName is omitted for checkout.
func TestRiffSpawnCheckoutTierForwarded(t *testing.T) {
	repo := gitRepoDir(t)
	ops := &mockTmuxOps{listWindowsResult: windowsWithActivePaneCwd(repo)}
	engine := &mockRiffEngine{result: riff.Result{Server: "work", Session: "s", WindowName: "riff-repo", WindowID: "@3"}}
	rec := postRiff(t, ops, engine, `{"session":"s","where":"checkout","tier":"doing"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if engine.gotOpts.Where != "checkout" {
		t.Errorf("engine Where = %q, want checkout", engine.gotOpts.Where)
	}
	if engine.gotOpts.Tier != "doing" {
		t.Errorf("engine Tier = %q, want doing", engine.gotOpts.Tier)
	}
	if engine.gotOpts.WorktreeName != "" {
		t.Errorf("engine WorktreeName = %q, want empty for checkout", engine.gotOpts.WorktreeName)
	}
}

// TestRiffSpawnWorktreeNameForwarded: a worktree-mode name reaches the engine.
func TestRiffSpawnWorktreeNameForwarded(t *testing.T) {
	repo := gitRepoDir(t)
	ops := &mockTmuxOps{listWindowsResult: windowsWithActivePaneCwd(repo)}
	engine := &mockRiffEngine{result: riff.Result{Server: "work", Session: "s", WindowName: "riff-my-agent", WindowID: "@4"}}
	rec := postRiff(t, ops, engine, `{"session":"s","where":"worktree","worktreeName":"my-agent"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if engine.gotOpts.WorktreeName != "my-agent" {
		t.Errorf("engine WorktreeName = %q, want my-agent", engine.gotOpts.WorktreeName)
	}
}

// TestRiffSpawnNewFieldValidation: the three mockup-v2 fields are validated
// BEFORE any subprocess/repo derivation — each bad input is a 400 with no engine
// call (nothing created). A gitRepoDir cwd is supplied so a passing field-check
// would proceed; the 400 must come from the field validation, not the repo check.
func TestRiffSpawnNewFieldValidation(t *testing.T) {
	cases := []struct {
		name string
		body string
	}{
		{name: "unknown where", body: `{"session":"s","where":"sideways"}`},
		{name: "worktreeName with checkout", body: `{"session":"s","where":"checkout","worktreeName":"x"}`},
		{name: "forbidden worktreeName char", body: `{"session":"s","worktreeName":"bad;name"}`},
		{name: "worktreeName with colon", body: `{"session":"s","worktreeName":"a:b"}`},
		{name: "worktreeName leading hyphen", body: `{"session":"s","worktreeName":"-agent"}`},
		{name: "worktreeName with slash", body: `{"session":"s","worktreeName":"a/b"}`},
		{name: "worktreeName with space", body: `{"session":"s","worktreeName":"a b"}`},
		{name: "forbidden tier char", body: `{"session":"s","tier":"a b"}`},
		{name: "tier leading hyphen", body: `{"session":"s","tier":"-doing"}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			repo := gitRepoDir(t)
			ops := &mockTmuxOps{listWindowsResult: windowsWithActivePaneCwd(repo)}
			engine := &mockRiffEngine{}
			rec := postRiff(t, ops, engine, tc.body)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
			}
			if engine.called {
				t.Error("engine.Spawn should NOT be called on an invalid new-field value")
			}
		})
	}
}

// TestRiffSpawnTaskWithSingleQuote: a task containing a single quote reaches the
// engine verbatim (the escaping is the engine's concern; the handler must not
// mangle it).
func TestRiffSpawnTaskWithSingleQuote(t *testing.T) {
	repo := gitRepoDir(t)
	ops := &mockTmuxOps{listWindowsResult: windowsWithActivePaneCwd(repo)}
	engine := &mockRiffEngine{result: riff.Result{Server: "work", Session: "s", WindowName: "riff-x", WindowID: "@1"}}

	rec := postRiff(t, ops, engine, `{"task":"it's a test","session":"s"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if engine.gotOpts.Task != "it's a test" {
		t.Errorf("engine Task = %q, want \"it's a test\"", engine.gotOpts.Task)
	}
}

// TestRiffSpawnEmptySession: an empty/invalid session is a 400 before any engine
// call.
func TestRiffSpawnEmptySession(t *testing.T) {
	ops := &mockTmuxOps{listWindowsResult: windowsWithActivePaneCwd(gitRepoDir(t))}
	engine := &mockRiffEngine{}
	rec := postRiff(t, ops, engine, `{"task":"x","session":""}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
	if engine.called {
		t.Error("engine.Spawn should NOT be called on invalid session")
	}
}

// TestRiffSpawnNonRepoCwd: a session whose active-pane cwd is not inside a git
// repo is a 400 whose message NAMES the offending cwd (R5), and the engine is
// never called (nothing created).
func TestRiffSpawnNonRepoCwd(t *testing.T) {
	nonRepo := t.TempDir() // no .git
	ops := &mockTmuxOps{listWindowsResult: windowsWithActivePaneCwd(nonRepo)}
	engine := &mockRiffEngine{}
	rec := postRiff(t, ops, engine, `{"session":"mysess"}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), nonRepo) {
		t.Errorf("400 body should name the non-repo cwd %q; got %s", nonRepo, rec.Body.String())
	}
	if engine.called {
		t.Error("engine.Spawn should NOT be called when cwd is not a git repo")
	}
}

// TestRiffSpawnEmptyPaneCwdFallsBackToWorktreePath: a window whose panes report
// an empty #{pane_current_path} must fall through to the window's WorktreePath
// rather than clobber it with "" (which would produce a spurious "no active
// pane" 400 even though a repo-backed WorktreePath was present). Regression
// guard for the deriveRepoRoot pane-cwd override bug.
func TestRiffSpawnEmptyPaneCwdFallsBackToWorktreePath(t *testing.T) {
	repo := gitRepoDir(t)
	windows := []tmux.WindowInfo{
		{
			Index:          0,
			WindowID:       "@0",
			Name:           "main",
			WorktreePath:   repo,
			IsActiveWindow: true,
			// Active pane exists but its cwd came back blank — the fallback to
			// WorktreePath must still resolve the repo root.
			Panes: []tmux.PaneInfo{
				{PaneID: "%0", PaneIndex: 0, Cwd: "", IsActive: true},
			},
		},
	}
	ops := &mockTmuxOps{listWindowsResult: windows}
	engine := &mockRiffEngine{result: riff.Result{
		Server: "work", Session: "mysess", WindowName: "riff-x", WindowID: "@1",
	}}
	rec := postRiff(t, ops, engine, `{"session":"mysess"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if !engine.called {
		t.Fatal("engine.Spawn was not called — WorktreePath fallback did not resolve the repo root")
	}
	if engine.gotOpts.RepoRoot != repo {
		t.Errorf("engine RepoRoot = %q, want WorktreePath fallback %q", engine.gotOpts.RepoRoot, repo)
	}
}

// TestRiffSpawnSessionReadError: a tmux read failure for the target session
// (nonexistent/gone session) is a 400 naming the session, not a raw 500, and the
// engine is never called.
func TestRiffSpawnSessionReadError(t *testing.T) {
	ops := &mockTmuxOps{listWindowsErr: errors.New("no such session: ghost")}
	engine := &mockRiffEngine{}
	rec := postRiff(t, ops, engine, `{"session":"ghost"}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "ghost") {
		t.Errorf("400 body should name the session %q; got %s", "ghost", rec.Body.String())
	}
	if engine.called {
		t.Error("engine.Spawn should NOT be called when the session read fails")
	}
}

// TestRiffSpawnUnknownPreset: the engine returns a validation-class ExitCodeError
// for an unknown preset; the handler maps it to 400.
func TestRiffSpawnUnknownPreset(t *testing.T) {
	repo := gitRepoDir(t)
	ops := &mockTmuxOps{listWindowsResult: windowsWithActivePaneCwd(repo)}
	engine := &mockRiffEngine{err: riff.ValidationErr("run-kit riff: unknown preset %q (defined: %s)", "nope", "(none)")}
	rec := postRiff(t, ops, engine, `{"preset":"nope","session":"mysess"}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
}

// TestRiffSpawnSubprocessError: a subprocess-class engine failure maps to 500.
func TestRiffSpawnSubprocessError(t *testing.T) {
	repo := gitRepoDir(t)
	ops := &mockTmuxOps{listWindowsResult: windowsWithActivePaneCwd(repo)}
	engine := &mockRiffEngine{err: riff.SubprocessErr("run-kit riff: wt create failed")}
	rec := postRiff(t, ops, engine, `{"session":"mysess"}`)
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500; body=%s", rec.Code, rec.Body.String())
	}
}

// --- GET /api/riff/presets ---

func getRiffPresets(t *testing.T, ops *mockTmuxOps, session string) *httptest.ResponseRecorder {
	t.Helper()
	router := newTestRouterWithRiff(&mockSessionFetcher{}, ops, &mockRiffEngine{})
	req := httptest.NewRequest(http.MethodGet, "/api/riff/presets?server=work&session="+session, nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

// TestRiffPresetsSuccess: a repo with two presets returns them in YAML source
// order, each {name, layout, paneCount}.
func TestRiffPresetsSuccess(t *testing.T) {
	repo := gitRepoDir(t)
	writeFabConfig(t, repo, `riff:
  presets:
    ship:
      layout: deck-h
      panes:
        - skill: "/fab-fff"
        - cmd: "just dev"
    investigate:
      layout: v
      panes:
        - skill: "/fab-discuss"
`)
	ops := &mockTmuxOps{listWindowsResult: windowsWithActivePaneCwd(repo)}

	rec := getRiffPresets(t, ops, "mysess")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var got struct {
		Presets []riffPresetSummary `json:"presets"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(got.Presets) != 2 {
		t.Fatalf("presets = %v, want 2", got.Presets)
	}
	// Source order: ship before investigate.
	if got.Presets[0].Name != "ship" || got.Presets[1].Name != "investigate" {
		t.Errorf("preset order = [%s, %s], want [ship, investigate]", got.Presets[0].Name, got.Presets[1].Name)
	}
	if got.Presets[0].Layout != "deck-h" || got.Presets[0].PaneCount != 2 {
		t.Errorf("ship summary = %+v, want layout deck-h, paneCount 2", got.Presets[0])
	}
	if got.Presets[1].Layout != "v" || got.Presets[1].PaneCount != 1 {
		t.Errorf("investigate summary = %+v, want layout v, paneCount 1", got.Presets[1])
	}
}

// TestRiffPresetsTiers: the presets response carries a non-empty tiers array
// (mockup-v2 R8) with the fab-kit built-ins first (`default` first), plus any
// config-defined names appended.
func TestRiffPresetsTiers(t *testing.T) {
	repo := gitRepoDir(t)
	writeFabConfig(t, repo, `agent:
    tiers:
        default: {model: a}
        custom: {model: b}
`)
	ops := &mockTmuxOps{listWindowsResult: windowsWithActivePaneCwd(repo)}
	rec := getRiffPresets(t, ops, "mysess")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var got struct {
		Presets []riffPresetSummary `json:"presets"`
		Tiers   []string            `json:"tiers"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(got.Tiers) == 0 || got.Tiers[0] != "default" {
		t.Fatalf("tiers = %v, want built-ins first (default first)", got.Tiers)
	}
	// Built-ins present and the config-only "custom" appended.
	joined := strings.Join(got.Tiers, ",")
	for _, want := range []string{"default", "doing", "fast", "operator", "review", "custom"} {
		if !strings.Contains(joined, want) {
			t.Errorf("tiers %v missing %q", got.Tiers, want)
		}
	}
}

// TestRiffPresetsEmpty: a repo with no presets returns 200 with an empty list.
func TestRiffPresetsEmpty(t *testing.T) {
	repo := gitRepoDir(t) // no fab config
	ops := &mockTmuxOps{listWindowsResult: windowsWithActivePaneCwd(repo)}
	rec := getRiffPresets(t, ops, "mysess")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var got struct {
		Presets []riffPresetSummary `json:"presets"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if got.Presets == nil {
		t.Error("presets should be [] (non-nil), not null")
	}
	if len(got.Presets) != 0 {
		t.Errorf("presets = %v, want empty", got.Presets)
	}
}

// TestRiffPresetsNonRepoCwd: a non-repo cwd is a 400 whose message names the cwd.
func TestRiffPresetsNonRepoCwd(t *testing.T) {
	nonRepo := t.TempDir()
	ops := &mockTmuxOps{listWindowsResult: windowsWithActivePaneCwd(nonRepo)}
	rec := getRiffPresets(t, ops, "mysess")
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), nonRepo) {
		t.Errorf("400 body should name the non-repo cwd %q; got %s", nonRepo, rec.Body.String())
	}
}

// writeFabConfig writes a fab/project/config.yaml at repo with the given body.
func writeFabConfig(t *testing.T, repo, body string) {
	t.Helper()
	dir := filepath.Join(repo, "fab", "project")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatalf("mkdir fab/project: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "config.yaml"), []byte(body), 0o644); err != nil {
		t.Fatalf("write config.yaml: %v", err)
	}
}
