package api

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"rk/internal/sessions"
	"rk/internal/tmux"
)

const testChatRef = "5d80479e-8f25-46cd-a0d4-e51435508a37"

// stageFixtureTranscript writes the sanitized chat fixture to a temp
// CLAUDE_CONFIG_DIR under the given ref and points $CLAUDE_CONFIG_DIR at it.
func stageFixtureTranscript(t *testing.T, ref string) {
	t.Helper()
	dir := t.TempDir()
	t.Setenv("CLAUDE_CONFIG_DIR", dir)
	projDir := filepath.Join(dir, "projects", "someproj")
	if err := os.MkdirAll(projDir, 0o755); err != nil {
		t.Fatal(err)
	}
	fixture, err := os.ReadFile(filepath.Join("..", "internal", "chat", "testdata", "claude_session.jsonl"))
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	if err := os.WriteFile(filepath.Join(projDir, ref+".jsonl"), fixture, 0o644); err != nil {
		t.Fatal(err)
	}
}

// chatSessions builds a session slice with one window carrying a reconciled
// chat. The chat identity lives on the ACTIVE pane (the source of truth
// resolveWindowChat rolls up via sessions.ResolveChatPane); the window-level
// fields mirror it for read-path compatibility. Pane id "%1" is the chat-send
// injection target.
func chatSessions(windowID, provider, ref string) []sessions.ProjectSession {
	return []sessions.ProjectSession{
		{Name: "s", Windows: []tmux.WindowInfo{
			{WindowID: windowID, ChatProvider: provider, ChatSessionRef: ref,
				Panes: []tmux.PaneInfo{{PaneID: "%1", IsActive: true, ChatProvider: provider, ChatSessionRef: ref}}},
		}},
	}
}

// stageEmptyConfigDir points $CLAUDE_CONFIG_DIR at a fresh temp dir with a
// projects/<proj> subdir but NO transcript, and returns the projects/<proj>
// path. Writing "<ref>.jsonl" there later makes a transcript appear — the lazy
// -creation-post-/clear scenario. Callers shrink chatRefResolveInterval so the
// stream's retry tick fires fast.
func stageEmptyConfigDir(t *testing.T) (projDir string) {
	t.Helper()
	dir := t.TempDir()
	t.Setenv("CLAUDE_CONFIG_DIR", dir)
	projDir = filepath.Join(dir, "projects", "someproj")
	if err := os.MkdirAll(projDir, 0o755); err != nil {
		t.Fatal(err)
	}
	return projDir
}

// writeFixtureAt writes the sanitized fixture transcript as "<ref>.jsonl" under
// projDir (used to make a transcript "appear" after a stream has connected).
func writeFixtureAt(t *testing.T, projDir, ref string) {
	t.Helper()
	fixture, err := os.ReadFile(filepath.Join("..", "internal", "chat", "testdata", "claude_session.jsonl"))
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	if err := os.WriteFile(filepath.Join(projDir, ref+".jsonl"), fixture, 0o644); err != nil {
		t.Fatal(err)
	}
}

// fastRefResolve shrinks the stream's ref-resolve/retry cadence for the duration
// of a test so the not-yet-transcript retry converges quickly, restoring it after.
func fastRefResolve(t *testing.T, d time.Duration) {
	t.Helper()
	prev := chatRefResolveInterval
	chatRefResolveInterval = d
	t.Cleanup(func() { chatRefResolveInterval = prev })
}

func TestChatBackfillHappyPath(t *testing.T) {
	stageFixtureTranscript(t, testChatRef)
	sf := &mockSessionFetcher{result: chatSessions("@1", "claude", testChatRef)}
	router := NewTestRouter(slog.Default(), sf, &mockTmuxOps{}, "host")

	req := httptest.NewRequest(http.MethodGet, "/api/windows/@1/chat", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var body struct {
		Provider   string `json:"provider"`
		SessionRef string `json:"sessionRef"`
		Events     []struct {
			Type string `json:"type"`
		} `json:"events"`
		Pending *struct {
			ToolName string `json:"toolName"`
		} `json:"pending"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("unmarshal: %v; body=%s", err, rec.Body.String())
	}
	if body.Provider != "claude" || body.SessionRef != testChatRef {
		t.Errorf("provider/ref = %q/%q", body.Provider, body.SessionRef)
	}
	if len(body.Events) != 8 {
		t.Errorf("events = %d, want 8", len(body.Events))
	}
	if body.Pending == nil || body.Pending.ToolName != "AskUserQuestion" {
		t.Errorf("pending = %+v", body.Pending)
	}
}

func TestChatBackfillNoChat(t *testing.T) {
	// Window exists but carries no reconciled chat → 404.
	sf := &mockSessionFetcher{result: []sessions.ProjectSession{
		{Name: "s", Windows: []tmux.WindowInfo{{WindowID: "@1"}}},
	}}
	router := NewTestRouter(slog.Default(), sf, &mockTmuxOps{}, "host")

	req := httptest.NewRequest(http.MethodGet, "/api/windows/@1/chat", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404; body=%s", rec.Code, rec.Body.String())
	}
}

func TestChatBackfillWindowAbsent(t *testing.T) {
	sf := &mockSessionFetcher{result: chatSessions("@2", "claude", testChatRef)}
	router := NewTestRouter(slog.Default(), sf, &mockTmuxOps{}, "host")

	req := httptest.NewRequest(http.MethodGet, "/api/windows/@1/chat", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 for absent window; body=%s", rec.Code, rec.Body.String())
	}
}

func TestChatBackfillNoAdapter(t *testing.T) {
	// A well-formed but unregistered provider (codex in v1) → 404-class.
	sf := &mockSessionFetcher{result: chatSessions("@1", "codex", "some-thread-id")}
	router := NewTestRouter(slog.Default(), sf, &mockTmuxOps{}, "host")

	req := httptest.NewRequest(http.MethodGet, "/api/windows/@1/chat", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404; body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "no adapter") {
		t.Errorf("body = %s, want a no-adapter error", rec.Body.String())
	}
}

func TestChatBackfillInvalidWindowID(t *testing.T) {
	sf := &mockSessionFetcher{result: chatSessions("@1", "claude", testChatRef)}
	router := NewTestRouter(slog.Default(), sf, &mockTmuxOps{}, "host")

	// A window id that fails validation → 400.
	req := httptest.NewRequest(http.MethodGet, "/api/windows/not-a-window/chat", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
}

func TestChatBackfillTranscriptMissing(t *testing.T) {
	// Valid-UUID ref, but no transcript on disk → 404 (surfaced as a read error).
	dir := t.TempDir()
	t.Setenv("CLAUDE_CONFIG_DIR", dir)
	if err := os.MkdirAll(filepath.Join(dir, "projects", "p"), 0o755); err != nil {
		t.Fatal(err)
	}
	sf := &mockSessionFetcher{result: chatSessions("@1", "claude", testChatRef)}
	router := NewTestRouter(slog.Default(), sf, &mockTmuxOps{}, "host")

	req := httptest.NewRequest(http.MethodGet, "/api/windows/@1/chat", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404; body=%s", rec.Code, rec.Body.String())
	}
}

// TestChatBackfillFetchError: a FetchSessions failure is an infrastructure fault
// (500), NOT "no chat session" (404) — resolveWindowChat must distinguish the two
// so a transient tmux failure is not misreported as a missing chat.
func TestChatBackfillFetchError(t *testing.T) {
	sf := &mockSessionFetcher{err: errors.New("tmux exploded")}
	router := NewTestRouter(slog.Default(), sf, &mockTmuxOps{}, "host")

	req := httptest.NewRequest(http.MethodGet, "/api/windows/@1/chat", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500; body=%s", rec.Code, rec.Body.String())
	}
}

// TestChatBackfillMalformedRef: a valid window whose reconciled @rk_chat ref is
// malformed (not a UUID) is a property of the ref, not a server fault — the
// client only supplied a windowID — so it surfaces as a 404-class response, not
// a 500 leaking the internal error string.
func TestChatBackfillMalformedRef(t *testing.T) {
	sf := &mockSessionFetcher{result: chatSessions("@1", "claude", "not-a-uuid")}
	router := NewTestRouter(slog.Default(), sf, &mockTmuxOps{}, "host")

	req := httptest.NewRequest(http.MethodGet, "/api/windows/@1/chat", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 for malformed ref; body=%s", rec.Code, rec.Body.String())
	}
}
