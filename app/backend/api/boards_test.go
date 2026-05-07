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
	ops := &mockTmuxOps{
		getBoardResult: []tmux.BoardEntry{
			{Server: "default", WindowID: "@1234", Board: "main", OrderKey: "a"},
		},
		listSessionsResult: []tmux.SessionInfo{{Name: "dev"}},
		listWindowsResult: []tmux.WindowInfo{
			{Index: 2, WindowID: "@1234", Name: "agent"},
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
	if g.WindowID != "@1234" || g.Session != "dev" || g.WindowIndex != 2 || g.WindowName != "agent" || g.OrderKey != "a" {
		t.Errorf("got %+v", g)
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
