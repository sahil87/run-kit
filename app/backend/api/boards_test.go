package api

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"rk/internal/tmux"
)

func TestBoards_GET_empty(t *testing.T) {
	ops := &mockTmuxOps{} // listBoardsResult nil → returns nil, nil
	router := newTestRouter(&mockSessionFetcher{}, ops)

	req := httptest.NewRequest(http.MethodGet, "/api/boards", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	body := strings.TrimSpace(rec.Body.String())
	if body != "[]" {
		t.Errorf("body = %q, want []", body)
	}
}

func TestBoards_GET_aggregateAcrossServers(t *testing.T) {
	ops := &mockTmuxOps{
		listBoardsResult: []tmux.BoardSummary{
			{Name: "deploy", PinCount: 1},
			{Name: "main", PinCount: 3},
		},
	}
	router := newTestRouter(&mockSessionFetcher{}, ops)

	req := httptest.NewRequest(http.MethodGet, "/api/boards", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	var got []tmux.BoardSummary
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[0].Name != "deploy" || got[1].Name != "main" {
		t.Errorf("got %+v", got)
	}
}

func TestBoard_GET_byName(t *testing.T) {
	// In the move-based model a pinned window lives in its own `_rk-pin-<id>`
	// session (the handler joins live window data from there, not from a home
	// session). The pinned window @1234 → pin-session `_rk-pin-1234`.
	ops := &mockTmuxOps{
		getBoardResult: []tmux.BoardEntry{
			{Server: "default", WindowID: "@1234", Board: "main", OrderKey: "a"},
		},
		listSessionsResult: []tmux.SessionInfo{{Name: "dev"}},
		listWindowsBySession: map[string][]tmux.WindowInfo{
			"_rk-pin-1234": {{Index: 0, WindowID: "@1234", Name: "agent"}},
		},
	}
	router := newTestRouter(&mockSessionFetcher{}, ops)

	req := httptest.NewRequest(http.MethodGet, "/api/boards/main", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body=%s", rec.Code, rec.Body.String())
	}
	var got []BoardEntryResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 {
		t.Fatalf("got %d entries, want 1", len(got))
	}
	g := got[0]
	if g.WindowID != "@1234" || g.Session != "_rk-pin-1234" || g.WindowName != "agent" || g.OrderKey != "a" {
		t.Errorf("got %+v", g)
	}
}

// TestBoard_GET_byName_windowInPinSession is the regression test for the
// CI/e2e failure where a pinned board rendered EMPTY. In the move-based model a
// pinned window is moved into its own `_rk-pin-<id>` session, which the
// user-facing ListSessions/parseSessions path HIDES. handleBoardGet must look the
// window up in its pin-session directly — NOT by scanning ListSessions, which
// would never find it and drop every entry. Here the home session list contains
// only an unrelated empty session; the pinned window @1234 lives ONLY under
// `_rk-pin-1234`. The join must still return the entry with live window data.
func TestBoard_GET_byName_windowInPinSession(t *testing.T) {
	ops := &mockTmuxOps{
		getBoardResult: []tmux.BoardEntry{
			{Server: "default", WindowID: "@1234", Board: "main", OrderKey: "a"},
		},
		// Home sessions visible to ListSessions do NOT contain @1234 — it was
		// moved out into its pin-session (which ListSessions hides). A scan of
		// these would find nothing.
		listSessionsResult: []tmux.SessionInfo{{Name: "dev"}},
		listWindowsBySession: map[string][]tmux.WindowInfo{
			"dev":          {{Index: 0, WindowID: "@9", Name: "other"}},
			"_rk-pin-1234": {{Index: 0, WindowID: "@1234", Name: "agent"}},
		},
	}
	router := newTestRouter(&mockSessionFetcher{}, ops)

	req := httptest.NewRequest(http.MethodGet, "/api/boards/main", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body=%s", rec.Code, rec.Body.String())
	}
	var got []BoardEntryResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 {
		t.Fatalf("got %d entries, want 1 (board must NOT render empty when the window lives in its pin-session); body=%s", len(got), rec.Body.String())
	}
	g := got[0]
	if g.WindowID != "@1234" || g.Session != "_rk-pin-1234" || g.WindowName != "agent" || g.OrderKey != "a" {
		t.Errorf("got %+v, want WindowID=@1234 Session=_rk-pin-1234 WindowName=agent OrderKey=a", g)
	}
}

func TestBoard_GET_invalidName_400(t *testing.T) {
	ops := &mockTmuxOps{}
	router := newTestRouter(&mockSessionFetcher{}, ops)

	// Comma in board name should fail validation.
	req := httptest.NewRequest(http.MethodGet, "/api/boards/foo,bar", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", rec.Code)
	}
}

func TestBoard_Pin_success(t *testing.T) {
	ops := &mockTmuxOps{
		listSessionsResult: []tmux.SessionInfo{{Name: "dev"}},
		listWindowsResult: []tmux.WindowInfo{
			{WindowID: "@1234", Index: 0, Name: "main"},
		},
	}
	router := newTestRouter(&mockSessionFetcher{}, ops)

	body := `{"server":"default","windowId":"@1234"}`
	req := httptest.NewRequest(http.MethodPost, "/api/boards/main/pin", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, body=%s", rec.Code, rec.Body.String())
	}
	if !ops.pinBoardCalled {
		t.Error("PinBoard not called")
	}
	if ops.pinBoardBoard != "main" || ops.pinBoardWindowID != "@1234" || ops.pinBoardServer != "default" {
		t.Errorf("PinBoard args wrong: %+v", ops)
	}
}

func TestBoard_Pin_invalidWindowID_400(t *testing.T) {
	ops := &mockTmuxOps{}
	router := newTestRouter(&mockSessionFetcher{}, ops)

	body := `{"server":"default","windowId":"not-a-window"}`
	req := httptest.NewRequest(http.MethodPost, "/api/boards/main/pin", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", rec.Code)
	}
	if ops.pinBoardCalled {
		t.Error("PinBoard should not be called for invalid window id")
	}
}

func TestBoard_Pin_invalidServer_400(t *testing.T) {
	ops := &mockTmuxOps{}
	router := newTestRouter(&mockSessionFetcher{}, ops)

	body := `{"server":"bad;name","windowId":"@1234"}`
	req := httptest.NewRequest(http.MethodPost, "/api/boards/main/pin", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", rec.Code)
	}
}

func TestBoard_Pin_windowNotFound_404(t *testing.T) {
	ops := &mockTmuxOps{
		listSessionsResult: []tmux.SessionInfo{{Name: "dev"}},
		listWindowsResult: []tmux.WindowInfo{
			{WindowID: "@9999", Index: 0, Name: "other"},
		},
	}
	router := newTestRouter(&mockSessionFetcher{}, ops)

	body := `{"server":"default","windowId":"@1234"}`
	req := httptest.NewRequest(http.MethodPost, "/api/boards/main/pin", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404, body=%s", rec.Code, rec.Body.String())
	}
	if ops.pinBoardCalled {
		t.Error("PinBoard should not be called when window does not exist")
	}
}

func TestBoard_Pin_idempotent(t *testing.T) {
	ops := &mockTmuxOps{
		listSessionsResult: []tmux.SessionInfo{{Name: "dev"}},
		listWindowsResult: []tmux.WindowInfo{
			{WindowID: "@1234", Index: 0, Name: "main"},
		},
	}
	router := newTestRouter(&mockSessionFetcher{}, ops)

	body := `{"server":"default","windowId":"@1234"}`
	for i := 0; i < 2; i++ {
		req := httptest.NewRequest(http.MethodPost, "/api/boards/main/pin", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		if rec.Code != http.StatusCreated {
			t.Errorf("iter %d: status = %d, want 201, body=%s", i, rec.Code, rec.Body.String())
		}
	}
}

func TestBoard_Unpin_success(t *testing.T) {
	ops := &mockTmuxOps{}
	router := newTestRouter(&mockSessionFetcher{}, ops)

	body := `{"server":"default","windowId":"@1234"}`
	req := httptest.NewRequest(http.MethodPost, "/api/boards/main/unpin", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body=%s", rec.Code, rec.Body.String())
	}
	if !ops.unpinBoardCalled {
		t.Error("UnpinBoard not called")
	}
}

func TestBoard_Reorder_success(t *testing.T) {
	ops := &mockTmuxOps{
		reorderBoardNewKey: "bm",
	}
	router := newTestRouter(&mockSessionFetcher{}, ops)

	body := `{"server":"default","windowId":"@1234","before":"@5678","after":"@9999"}`
	req := httptest.NewRequest(http.MethodPost, "/api/boards/main/reorder", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body=%s", rec.Code, rec.Body.String())
	}
	var resp struct {
		Ok          bool   `json:"ok"`
		NewOrderKey string `json:"newOrderKey"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if !resp.Ok || resp.NewOrderKey != "bm" {
		t.Errorf("got %+v", resp)
	}
}

func TestBoard_Reorder_nullNeighbours_success(t *testing.T) {
	// `before`/`after` are nullable per the documented API contract — JSON
	// `null` (or omitted) means prepend/append. This test locks in that the
	// handler decodes `null` cleanly instead of failing JSON decoding.
	ops := &mockTmuxOps{
		reorderBoardNewKey: "ax",
	}
	router := newTestRouter(&mockSessionFetcher{}, ops)

	body := `{"server":"default","windowId":"@1234","before":null,"after":null}`
	req := httptest.NewRequest(http.MethodPost, "/api/boards/main/reorder", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body=%s", rec.Code, rec.Body.String())
	}
	var resp struct {
		Ok          bool   `json:"ok"`
		NewOrderKey string `json:"newOrderKey"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if !resp.Ok || resp.NewOrderKey != "ax" {
		t.Errorf("got %+v", resp)
	}
}

func TestBoard_Reorder_invalidNeighbours_400(t *testing.T) {
	ops := &mockTmuxOps{}
	router := newTestRouter(&mockSessionFetcher{}, ops)

	body := `{"server":"default","windowId":"@1234","before":"not-window","after":"@9999"}`
	req := httptest.NewRequest(http.MethodPost, "/api/boards/main/reorder", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", rec.Code)
	}
}

func TestBoard_Pin_triggersBroadcast(t *testing.T) {
	ops := &mockTmuxOps{
		listSessionsResult: []tmux.SessionInfo{{Name: "dev"}},
		listWindowsResult: []tmux.WindowInfo{
			{WindowID: "@1234", Index: 0, Name: "main"},
		},
		listBoardEntriesResult: []tmux.BoardEntry{
			{Server: "default", WindowID: "@1234", Board: "main", OrderKey: "m"},
		},
	}
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))
	server := &Server{
		logger:   logger,
		sessions: &mockSessionFetcher{},
		tmux:     ops,
		hostname: "test-host",
	}

	server.initSSEHub()
	client := &sseClient{ch: make(chan []byte, 16), server: "default"}
	server.sseHub.addClient(client)
	defer server.sseHub.removeClient(client)

	// Drain any cached snapshots.
	drainSSE(client)

	router := server.buildRouter()
	body := `{"server":"default","windowId":"@1234"}`
	req := httptest.NewRequest(http.MethodPost, "/api/boards/main/pin", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("PUT status = %d, want 201", rec.Code)
	}
	requireBoardEvent(t, client, "pin")
}

func TestBoard_Unpin_triggersBroadcast(t *testing.T) {
	ops := &mockTmuxOps{}
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))
	server := &Server{logger: logger, sessions: &mockSessionFetcher{}, tmux: ops, hostname: "test"}
	server.initSSEHub()
	client := &sseClient{ch: make(chan []byte, 16), server: "default"}
	server.sseHub.addClient(client)
	defer server.sseHub.removeClient(client)
	drainSSE(client)

	router := server.buildRouter()
	body := `{"server":"default","windowId":"@1234"}`
	req := httptest.NewRequest(http.MethodPost, "/api/boards/main/unpin", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	requireBoardEvent(t, client, "unpin")
}

func TestBoard_Reorder_triggersBroadcast(t *testing.T) {
	ops := &mockTmuxOps{reorderBoardNewKey: "bm"}
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))
	server := &Server{logger: logger, sessions: &mockSessionFetcher{}, tmux: ops, hostname: "test"}
	server.initSSEHub()
	client := &sseClient{ch: make(chan []byte, 16), server: "default"}
	server.sseHub.addClient(client)
	defer server.sseHub.removeClient(client)
	drainSSE(client)

	router := server.buildRouter()
	body := `{"server":"default","windowId":"@1234","before":"@5678","after":"@9999"}`
	req := httptest.NewRequest(http.MethodPost, "/api/boards/main/reorder", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body=%s", rec.Code, rec.Body.String())
	}
	requireBoardEvent(t, client, "reorder")
}

func drainSSE(c *sseClient) {
	deadline := time.After(150 * time.Millisecond)
	for {
		select {
		case <-c.ch:
		case <-deadline:
			return
		}
	}
}

func requireBoardEvent(t *testing.T, c *sseClient, change string) {
	t.Helper()
	deadline := time.After(500 * time.Millisecond)
	for {
		select {
		case ev := <-c.ch:
			s := string(ev)
			if !strings.Contains(s, "event: board-changed") {
				continue
			}
			expected := fmt.Sprintf(`"change":"%s"`, change)
			if !strings.Contains(s, expected) {
				t.Errorf("got board event %q, want change=%s", s, change)
			}
			return
		case <-deadline:
			t.Fatalf("did not receive board-changed event with change=%s", change)
		}
	}
}
