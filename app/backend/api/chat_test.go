package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"rk/internal/sessions"
	"rk/internal/tmux"
)

// syncFlushRecorder is a thread-safe http.ResponseWriter + http.Flusher for
// streaming-handler tests: the handler goroutine writes while the test goroutine
// polls body(), so both accesses go through mu. httptest.ResponseRecorder is not
// safe for concurrent access, which is what the race detector flags.
type syncFlushRecorder struct {
	mu   sync.Mutex
	buf  bytes.Buffer
	hdr  http.Header
	code int
}

func newSyncFlushRecorder() *syncFlushRecorder {
	return &syncFlushRecorder{hdr: http.Header{}, code: http.StatusOK}
}

func (s *syncFlushRecorder) Header() http.Header { return s.hdr }

func (s *syncFlushRecorder) Write(p []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.buf.Write(p)
}

func (s *syncFlushRecorder) WriteHeader(code int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.code = code
}

func (s *syncFlushRecorder) Flush() {}

func (s *syncFlushRecorder) body() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.buf.String()
}

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

// chatSessions builds a session slice with one window carrying a reconciled chat.
func chatSessions(windowID, provider, ref string) []sessions.ProjectSession {
	return []sessions.ProjectSession{
		{Name: "s", Windows: []tmux.WindowInfo{
			{WindowID: windowID, ChatProvider: provider, ChatSessionRef: ref,
				Panes: []tmux.PaneInfo{{PaneID: "%1", IsActive: true}}},
		}},
	}
}

// mutableSessionFetcher is a thread-safe SessionFetcher whose result can be
// swapped mid-stream, used to simulate a session rotation (the window's @rk_chat
// re-stamps to a new ref) while a chat SSE stream is open. The static
// mockSessionFetcher cannot be mutated safely under the race detector because the
// handler goroutine reads it concurrently.
type mutableSessionFetcher struct {
	mu     sync.Mutex
	result []sessions.ProjectSession
	err    error
}

func (m *mutableSessionFetcher) FetchSessions(context.Context, string) ([]sessions.ProjectSession, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.result, m.err
}

func (m *mutableSessionFetcher) set(result []sessions.ProjectSession) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.result = result
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

// TestChatStreamBackfillEventAndDisconnect drives the SSE stream handler,
// asserts a chat-backfill event lands on connect, then cancels the request
// context (client disconnect) and confirms the handler returns without throwing.
func TestChatStreamBackfillEventAndDisconnect(t *testing.T) {
	stageFixtureTranscript(t, testChatRef)
	sf := &mockSessionFetcher{result: chatSessions("@1", "claude", testChatRef)}
	router := NewTestRouter(slog.Default(), sf, &mockTmuxOps{}, "host")

	ctx, cancel := context.WithCancel(context.Background())
	req := httptest.NewRequest(http.MethodGet, "/api/windows/@1/chat/stream", nil).WithContext(ctx)
	rec := newSyncFlushRecorder()

	done := make(chan struct{})
	go func() {
		router.ServeHTTP(rec, req)
		close(done)
	}()

	// Poll the recorder for the chat-backfill event (thread-safe body()).
	deadline := time.After(3 * time.Second)
	sawBackfill := false
	for !sawBackfill {
		select {
		case <-deadline:
			t.Fatal("did not observe chat-backfill event")
		default:
			if strings.Contains(rec.body(), "event: chat-backfill") {
				sawBackfill = true
			} else {
				time.Sleep(20 * time.Millisecond)
			}
		}
	}

	// Client disconnects.
	cancel()
	select {
	case <-done:
		// handler returned cleanly
	case <-time.After(3 * time.Second):
		t.Fatal("stream handler did not return after client disconnect")
	}

	body := rec.body()
	if !strings.Contains(body, "\"provider\":\"claude\"") {
		t.Errorf("backfill payload missing provider; body=%s", body)
	}
}

func TestChatStreamNoChat(t *testing.T) {
	sf := &mockSessionFetcher{result: []sessions.ProjectSession{
		{Name: "s", Windows: []tmux.WindowInfo{{WindowID: "@1"}}},
	}}
	router := NewTestRouter(slog.Default(), sf, &mockTmuxOps{}, "host")

	req := httptest.NewRequest(http.MethodGet, "/api/windows/@1/chat/stream", nil)
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

// TestChatStreamFetchError: same distinction on the stream handler — the fetch
// failure surfaces at connect (before SSE headers are committed) as a 500.
func TestChatStreamFetchError(t *testing.T) {
	sf := &mockSessionFetcher{err: errors.New("tmux exploded")}
	router := NewTestRouter(slog.Default(), sf, &mockTmuxOps{}, "host")

	req := httptest.NewRequest(http.MethodGet, "/api/windows/@1/chat/stream", nil)
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

// TestChatStreamInitialConnectTranscriptNotYet exercises the MUST-FIX (R11/A-011)
// lazy-transcript case on INITIAL CONNECT: the window carries a valid-UUID
// @rk_chat but Claude Code has not written the transcript yet (re-stamped at
// SessionStart before the first prompt). The stream must NOT die with a
// chat-error — it must stay open and, once the transcript appears, deliver the
// chat-backfill on the same connection.
func TestChatStreamInitialConnectTranscriptNotYet(t *testing.T) {
	fastRefResolve(t, 40*time.Millisecond)
	projDir := stageEmptyConfigDir(t) // no transcript yet
	sf := &mockSessionFetcher{result: chatSessions("@1", "claude", testChatRef)}
	router := NewTestRouter(slog.Default(), sf, &mockTmuxOps{}, "host")

	ctx, cancel := context.WithCancel(context.Background())
	req := httptest.NewRequest(http.MethodGet, "/api/windows/@1/chat/stream", nil).WithContext(ctx)
	rec := newSyncFlushRecorder()

	done := make(chan struct{})
	go func() { router.ServeHTTP(rec, req); close(done) }()

	// Give the stream a few retry ticks with NO file: it must stay open and emit
	// no chat-error (the pre-fix behavior closed the connection here).
	time.Sleep(200 * time.Millisecond)
	if b := rec.body(); strings.Contains(b, "event: chat-error") {
		t.Fatalf("stream emitted chat-error before the transcript appeared; body=%s", b)
	}
	select {
	case <-done:
		t.Fatal("stream handler returned before the transcript appeared (should stay open)")
	default:
	}

	// The transcript now appears (first prompt lands).
	writeFixtureAt(t, projDir, testChatRef)

	// Within a few retry ticks the backfill must arrive on the SAME connection.
	deadline := time.After(3 * time.Second)
	for {
		if strings.Contains(rec.body(), "event: chat-backfill") {
			break
		}
		select {
		case <-deadline:
			t.Fatalf("no chat-backfill after transcript appeared; body=%s", rec.body())
		default:
			time.Sleep(20 * time.Millisecond)
		}
	}
	if b := rec.body(); strings.Contains(b, "event: chat-error") {
		t.Errorf("unexpected chat-error in stream; body=%s", b)
	}

	cancel()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("stream handler did not return after client disconnect")
	}
}

// TestChatStreamRotationTranscriptNotYet exercises the MUST-FIX (R11/A-011) lazy
// -transcript case on ROTATION: the stream is live on session A, then the
// window's @rk_chat re-stamps to session B (a real /clear) whose transcript does
// not exist yet. The stream must NOT die — it must hold the connection open and,
// once B's transcript appears, deliver a fresh chat-backfill for B on the same
// connection (survives /clear without reconnecting).
func TestChatStreamRotationTranscriptNotYet(t *testing.T) {
	const refB = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
	fastRefResolve(t, 40*time.Millisecond)
	projDir := stageEmptyConfigDir(t)
	writeFixtureAt(t, projDir, testChatRef) // session A exists

	sf := &mutableSessionFetcher{result: chatSessions("@1", "claude", testChatRef)}
	router := NewTestRouter(slog.Default(), sf, &mockTmuxOps{}, "host")

	ctx, cancel := context.WithCancel(context.Background())
	req := httptest.NewRequest(http.MethodGet, "/api/windows/@1/chat/stream", nil).WithContext(ctx)
	rec := newSyncFlushRecorder()

	done := make(chan struct{})
	go func() { router.ServeHTTP(rec, req); close(done) }()

	// First backfill (session A) lands.
	deadline := time.After(3 * time.Second)
	for !strings.Contains(rec.body(), "event: chat-backfill") {
		select {
		case <-deadline:
			t.Fatalf("no initial chat-backfill; body=%s", rec.body())
		default:
			time.Sleep(20 * time.Millisecond)
		}
	}
	backfillsAfterA := strings.Count(rec.body(), "event: chat-backfill")

	// Rotation: window re-stamps to session B, whose transcript does NOT exist yet.
	sf.set(chatSessions("@1", "claude", refB))

	// The stream must hold open through the no-file window (no chat-error, no
	// return) — a few retry ticks pass here.
	time.Sleep(200 * time.Millisecond)
	if b := rec.body(); strings.Contains(b, "event: chat-error") {
		t.Fatalf("stream emitted chat-error during rotation no-file window; body=%s", b)
	}
	select {
	case <-done:
		t.Fatal("stream handler returned during rotation no-file window (should stay open)")
	default:
	}

	// Session B's transcript now appears.
	writeFixtureAt(t, projDir, refB)

	// A fresh backfill (for B) must arrive on the SAME connection.
	deadline = time.After(3 * time.Second)
	for {
		if strings.Count(rec.body(), "event: chat-backfill") > backfillsAfterA {
			break
		}
		select {
		case <-deadline:
			t.Fatalf("no fresh chat-backfill for rotated session; body=%s", rec.body())
		default:
			time.Sleep(20 * time.Millisecond)
		}
	}
	if b := rec.body(); !strings.Contains(b, refB) {
		t.Errorf("rotated backfill missing new session ref %q; body=%s", refB, b)
	}

	cancel()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("stream handler did not return after client disconnect")
	}
}
