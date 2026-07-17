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

	"rk/internal/settings"
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
	client := &sseClient{ch: make(chan hubEvent, 16), server: "default"}
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
	client := &sseClient{ch: make(chan hubEvent, 16), server: "default"}
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
	client := &sseClient{ch: make(chan hubEvent, 16), server: "default"}
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

// --- Board list reorder (260708-a2qd) ---

func TestSortBoardsByStoredOrder(t *testing.T) {
	boards := []tmux.BoardSummary{
		{Name: "apple", PinCount: 1},
		{Name: "deploys", PinCount: 2},
		{Name: "reviews", PinCount: 3},
	}

	tests := []struct {
		name  string
		order []string
		want  []string
	}{
		{
			name:  "ranked first by index then unranked alphabetical",
			order: []string{"reviews", "deploys"},
			want:  []string{"reviews", "deploys", "apple"},
		},
		{
			name:  "no stored order stays alphabetical",
			order: nil,
			want:  []string{"apple", "deploys", "reviews"},
		},
		{
			name:  "stale name in stored order is ignored",
			order: []string{"ghost", "reviews"},
			want:  []string{"reviews", "apple", "deploys"},
		},
		{
			name:  "all ranked follow stored order exactly",
			order: []string{"reviews", "apple", "deploys"},
			want:  []string{"reviews", "apple", "deploys"},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Copy so cross-case mutation can't leak (helper copies internally too).
			in := make([]tmux.BoardSummary, len(boards))
			copy(in, boards)
			got := sortBoardsByStoredOrder(in, tt.order)
			gotNames := make([]string, len(got))
			for i, b := range got {
				gotNames[i] = b.Name
			}
			if len(gotNames) != len(tt.want) {
				t.Fatalf("got %v, want %v", gotNames, tt.want)
			}
			for i := range tt.want {
				if gotNames[i] != tt.want[i] {
					t.Fatalf("got %v, want %v", gotNames, tt.want)
				}
			}
		})
	}
}

// TestBoards_GET_appliesStoredOrder verifies handleBoardsList sorts the
// ListBoards result by the persisted board order (integration through
// settings.GetBoardOrder with a temp HOME).
func TestBoards_GET_appliesStoredOrder(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	if err := settings.SetBoardOrder([]string{"reviews", "deploys"}); err != nil {
		t.Fatalf("SetBoardOrder: %v", err)
	}
	ops := &mockTmuxOps{
		listBoardsResult: []tmux.BoardSummary{
			{Name: "apple", PinCount: 1},
			{Name: "deploys", PinCount: 2},
			{Name: "reviews", PinCount: 3},
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
	want := []string{"reviews", "deploys", "apple"}
	if len(got) != 3 {
		t.Fatalf("got %+v", got)
	}
	for i, name := range want {
		if got[i].Name != name {
			t.Fatalf("got order %+v, want %v", got, want)
		}
	}
}

func TestHandleBoardOrderPost_WritesAndBroadcasts(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	ops := &mockTmuxOps{}
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))
	server := &Server{logger: logger, sessions: &mockSessionFetcher{}, tmux: ops, hostname: "test"}
	server.initSSEHub()
	client := server.sseHub.addTestClient(make(chan hubEvent, 16), "default")
	defer server.sseHub.removeClient(client)
	drainSSE(client)

	router := server.buildRouter()
	req := httptest.NewRequest(http.MethodPost, "/api/boards/order", strings.NewReader(`{"order":["reviews","deploys"]}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body=%s", rec.Code, rec.Body.String())
	}
	// Persisted?
	if got := settings.GetBoardOrder(); len(got) != 2 || got[0] != "reviews" || got[1] != "deploys" {
		t.Errorf("persisted order = %v, want [reviews deploys]", got)
	}
	// Broadcast?
	deadline := time.After(500 * time.Millisecond)
	for {
		select {
		case ev := <-client.ch:
			s := ev.String()
			if strings.Contains(s, "event: board-order") {
				if !strings.Contains(s, `{"order":["reviews","deploys"]}`) {
					t.Errorf("board-order payload = %q", s)
				}
				return
			}
		case <-deadline:
			t.Fatal("did not receive board-order event")
		}
	}
}

func TestHandleBoardOrderPost_InvalidNameRejected(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	ops := &mockTmuxOps{}
	router := newTestRouter(&mockSessionFetcher{}, ops)
	req := httptest.NewRequest(http.MethodPost, "/api/boards/order", strings.NewReader(`{"order":["ok","bad name!"]}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
	if got := settings.GetBoardOrder(); got != nil {
		t.Errorf("no write should have occurred, got %v", got)
	}
}

func TestHandleBoardOrderPost_DuplicateNameRejected(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	ops := &mockTmuxOps{}
	router := newTestRouter(&mockSessionFetcher{}, ops)
	req := httptest.NewRequest(http.MethodPost, "/api/boards/order", strings.NewReader(`{"order":["a","b","a"]}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
	if got := settings.GetBoardOrder(); got != nil {
		t.Errorf("no write should have occurred, got %v", got)
	}
}

func TestHandleBoardOrderPost_MalformedBodyRejected(t *testing.T) {
	ops := &mockTmuxOps{}
	router := newTestRouter(&mockSessionFetcher{}, ops)
	req := httptest.NewRequest(http.MethodPost, "/api/boards/order", strings.NewReader(`{"order":"not-an-array"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
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
			s := ev.String()
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
