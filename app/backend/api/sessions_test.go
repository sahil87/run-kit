package api

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"rk/internal/sessions"
	"rk/internal/tmux"
)

// mockSessionFetcher returns canned session data.
type mockSessionFetcher struct {
	result []sessions.ProjectSession
	err    error
}

func (m *mockSessionFetcher) FetchSessions(ctx context.Context, server string) ([]sessions.ProjectSession, error) {
	return m.result, m.err
}

// mockTmuxOps records calls for verification.
type mockTmuxOps struct {
	createSessionCalled bool
	createSessionName   string
	createSessionCwd    string
	killSessionCalled      bool
	killSessionName        string
	renameSessionCalled    bool
	renameSessionSession   string
	renameSessionName      string

	newGroupedSessionCalled    bool
	newGroupedSessionServer    string
	newGroupedSessionReal      string
	newGroupedSessionEphemeral string
	newGroupedSessionErr       error

	createWindowCalled  bool
	createWindowSession string
	createWindowName    string
	createWindowCwd     string
	killWindowCalled    bool
	killWindowID        string
	swapWindowCalled    bool
	swapWindowID        string
	swapWindowDstIndex  int
	swapWindowErr       error
	moveWindowToSessionCalled     bool
	moveWindowToSessionWindowID   string
	moveWindowToSessionDstSession string
	moveWindowToSessionErr        error
	renameWindowCalled   bool
	renameWindowWindowID string
	renameWindowName     string
	sendKeysCalled       bool
	sendKeysWindowID     string
	sendKeysKeys         string
	selectWindowCalled   bool
	selectWindowWindowID string

	selectWindowInSessionCalled   bool
	selectWindowInSessionSession  string
	selectWindowInSessionWindowID string

	listWindowsResult  []tmux.WindowInfo
	listWindowsErr     error
	listSessionsResult []tmux.SessionInfo
	listServersResult  []string

	resolveWindowSessionResult string
	resolveWindowSessionErr    error
	resolveWindowSessionID     string

	splitWindowCalled     bool
	splitWindowID         string
	splitWindowHorizontal bool
	splitWindowResult     string
	splitWindowErr        error

	killActivePaneCalled   bool
	killActivePaneWindowID string

	setSessionColorCalled  bool
	setSessionColorSession string
	setSessionColorColor   int
	setSessionColorErr     error
	unsetSessionColorCalled  bool
	unsetSessionColorSession string
	unsetSessionColorErr     error

	setWindowColorCalled   bool
	setWindowColorWindowID string
	setWindowColorColor    int
	setWindowColorErr      error
	unsetWindowColorCalled   bool
	unsetWindowColorWindowID string
	unsetWindowColorErr      error

	setWindowOptionCalled   bool
	setWindowOptionWindowID string
	setWindowOptionOption   string
	setWindowOptionValue    string

	unsetWindowOptionCalled   bool
	unsetWindowOptionWindowID string
	unsetWindowOptionOption   string

	setWindowOptionsCalled   bool
	setWindowOptionsWindowID string
	setWindowOptionsOps      []tmux.WindowOptionOp

	createWindowWithOptionsCalled  bool
	createWindowWithOptionsSession string
	createWindowWithOptionsName    string
	createWindowWithOptionsCwd     string
	createWindowWithOptionsOps     []tmux.WindowOptionOp

	getSessionOrderCalled bool
	getSessionOrderResult []string
	getSessionOrderErr    error

	setSessionOrderCalled bool
	setSessionOrderOrder  []string
	setSessionOrderErr    error

	setSessionOwnerPIDCalled  bool
	setSessionOwnerPIDSession string
	setSessionOwnerPIDPID     int
	setSessionOwnerPIDErr     error

	// Boards
	listBoardsCalled         bool
	listBoardsResult         []tmux.BoardSummary
	listBoardsErr            error
	getBoardCalled           bool
	getBoardName             string
	getBoardResult           []tmux.BoardEntry
	getBoardErr              error
	listBoardEntriesResult   []tmux.BoardEntry
	listBoardEntriesByServer map[string][]tmux.BoardEntry
	listBoardEntriesErr      error
	pinBoardCalled           bool
	pinBoardServer           string
	pinBoardWindowID         string
	pinBoardBoard            string
	pinBoardErr              error
	unpinBoardCalled         bool
	unpinBoardServer         string
	unpinBoardWindowID       string
	unpinBoardBoard          string
	unpinBoardErr            error
	reorderBoardCalled       bool
	reorderBoardServer       string
	reorderBoardWindowID     string
	reorderBoardBoard        string
	reorderBoardBefore       string
	reorderBoardAfter        string
	reorderBoardNewKey       string
	reorderBoardErr          error

	err error
}

func (m *mockTmuxOps) CreateSession(name, cwd, server string) error {
	m.createSessionCalled = true
	m.createSessionName = name
	m.createSessionCwd = cwd
	return m.err
}
func (m *mockTmuxOps) KillSession(session, server string) error {
	m.killSessionCalled = true
	m.killSessionName = session
	return m.err
}
func (m *mockTmuxOps) KillSessionCtx(ctx context.Context, server, session string) error {
	m.killSessionCalled = true
	m.killSessionName = session
	return m.err
}
func (m *mockTmuxOps) NewGroupedSession(ctx context.Context, server, realSession, ephemeral string) error {
	m.newGroupedSessionCalled = true
	m.newGroupedSessionServer = server
	m.newGroupedSessionReal = realSession
	m.newGroupedSessionEphemeral = ephemeral
	if m.newGroupedSessionErr != nil {
		return m.newGroupedSessionErr
	}
	return m.err
}
func (m *mockTmuxOps) RenameSession(session, name, server string) error {
	m.renameSessionCalled = true
	m.renameSessionSession = session
	m.renameSessionName = name
	return m.err
}
func (m *mockTmuxOps) CreateWindow(session, name, cwd, server string) error {
	m.createWindowCalled = true
	m.createWindowSession = session
	m.createWindowName = name
	m.createWindowCwd = cwd
	return m.err
}
func (m *mockTmuxOps) KillWindow(windowID, server string) error {
	m.killWindowCalled = true
	m.killWindowID = windowID
	return m.err
}
func (m *mockTmuxOps) MoveWindow(windowID string, targetIndex int, server string) error {
	m.swapWindowCalled = true
	m.swapWindowID = windowID
	m.swapWindowDstIndex = targetIndex
	if m.swapWindowErr != nil {
		return m.swapWindowErr
	}
	return m.err
}
func (m *mockTmuxOps) MoveWindowToSession(windowID, dstSession, server string) error {
	m.moveWindowToSessionCalled = true
	m.moveWindowToSessionWindowID = windowID
	m.moveWindowToSessionDstSession = dstSession
	if m.moveWindowToSessionErr != nil {
		return m.moveWindowToSessionErr
	}
	return m.err
}
func (m *mockTmuxOps) RenameWindow(windowID, name, server string) error {
	m.renameWindowCalled = true
	m.renameWindowWindowID = windowID
	m.renameWindowName = name
	return m.err
}
func (m *mockTmuxOps) SendKeys(windowID, keys, server string) error {
	m.sendKeysCalled = true
	m.sendKeysWindowID = windowID
	m.sendKeysKeys = keys
	return m.err
}
func (m *mockTmuxOps) ListWindows(ctx context.Context, session, server string) ([]tmux.WindowInfo, error) {
	return m.listWindowsResult, m.listWindowsErr
}
func (m *mockTmuxOps) ResolveWindowSession(ctx context.Context, server, windowID string) (string, error) {
	m.resolveWindowSessionID = windowID
	if m.resolveWindowSessionErr != nil {
		return "", m.resolveWindowSessionErr
	}
	return m.resolveWindowSessionResult, nil
}
func (m *mockTmuxOps) SplitWindow(windowID string, horizontal bool, cwd string, server string) (string, error) {
	m.splitWindowCalled = true
	m.splitWindowID = windowID
	m.splitWindowHorizontal = horizontal
	return m.splitWindowResult, m.splitWindowErr
}
func (m *mockTmuxOps) SelectWindow(windowID, server string) error {
	m.selectWindowCalled = true
	m.selectWindowWindowID = windowID
	return m.err
}
func (m *mockTmuxOps) SelectWindowInSession(session, windowID, server string) error {
	m.selectWindowInSessionCalled = true
	m.selectWindowInSessionSession = session
	m.selectWindowInSessionWindowID = windowID
	return m.err
}
func (m *mockTmuxOps) KillActivePane(windowID, server string) error {
	m.killActivePaneCalled = true
	m.killActivePaneWindowID = windowID
	return m.err
}
func (m *mockTmuxOps) SetSessionColor(session string, color int, server string) error {
	m.setSessionColorCalled = true
	m.setSessionColorSession = session
	m.setSessionColorColor = color
	if m.setSessionColorErr != nil {
		return m.setSessionColorErr
	}
	return m.err
}
func (m *mockTmuxOps) UnsetSessionColor(session string, server string) error {
	m.unsetSessionColorCalled = true
	m.unsetSessionColorSession = session
	if m.unsetSessionColorErr != nil {
		return m.unsetSessionColorErr
	}
	return m.err
}
func (m *mockTmuxOps) SetWindowColor(windowID string, color int, server string) error {
	m.setWindowColorCalled = true
	m.setWindowColorWindowID = windowID
	m.setWindowColorColor = color
	if m.setWindowColorErr != nil {
		return m.setWindowColorErr
	}
	return m.err
}
func (m *mockTmuxOps) UnsetWindowColor(windowID, server string) error {
	m.unsetWindowColorCalled = true
	m.unsetWindowColorWindowID = windowID
	if m.unsetWindowColorErr != nil {
		return m.unsetWindowColorErr
	}
	return m.err
}
func (m *mockTmuxOps) ListServers(ctx context.Context) ([]string, error) {
	if m.listServersResult != nil {
		return m.listServersResult, nil
	}
	return []string{"default"}, nil
}
func (m *mockTmuxOps) ListSessions(ctx context.Context, server string) ([]tmux.SessionInfo, error) {
	return m.listSessionsResult, nil
}
func (m *mockTmuxOps) KillServer(server string) error {
	return nil
}
func (m *mockTmuxOps) ListKeys(server string) ([]string, error) {
	return nil, nil
}
func (m *mockTmuxOps) SetWindowOption(ctx context.Context, windowID, server, option, value string) error {
	m.setWindowOptionCalled = true
	m.setWindowOptionWindowID = windowID
	m.setWindowOptionOption = option
	m.setWindowOptionValue = value
	return m.err
}
func (m *mockTmuxOps) UnsetWindowOption(ctx context.Context, windowID, server, option string) error {
	m.unsetWindowOptionCalled = true
	m.unsetWindowOptionWindowID = windowID
	m.unsetWindowOptionOption = option
	return m.err
}
func (m *mockTmuxOps) SetWindowOptions(ctx context.Context, windowID, server string, ops []tmux.WindowOptionOp) error {
	m.setWindowOptionsCalled = true
	m.setWindowOptionsWindowID = windowID
	m.setWindowOptionsOps = ops
	return m.err
}
func (m *mockTmuxOps) CreateWindowWithOptions(session, name, cwd, server string, ops []tmux.WindowOptionOp) error {
	m.createWindowWithOptionsCalled = true
	m.createWindowWithOptionsSession = session
	m.createWindowWithOptionsName = name
	m.createWindowWithOptionsCwd = cwd
	m.createWindowWithOptionsOps = ops
	return m.err
}
func (m *mockTmuxOps) GetSessionOrder(ctx context.Context, server string) ([]string, error) {
	m.getSessionOrderCalled = true
	if m.getSessionOrderErr != nil {
		return nil, m.getSessionOrderErr
	}
	if m.getSessionOrderResult == nil {
		return []string{}, nil
	}
	return m.getSessionOrderResult, nil
}
func (m *mockTmuxOps) SetSessionOrder(ctx context.Context, server string, order []string) error {
	m.setSessionOrderCalled = true
	m.setSessionOrderOrder = order
	if m.setSessionOrderErr != nil {
		return m.setSessionOrderErr
	}
	return m.err
}
func (m *mockTmuxOps) SetSessionOwnerPID(ctx context.Context, server, session string, pid int) error {
	m.setSessionOwnerPIDCalled = true
	m.setSessionOwnerPIDSession = session
	m.setSessionOwnerPIDPID = pid
	if m.setSessionOwnerPIDErr != nil {
		return m.setSessionOwnerPIDErr
	}
	return m.err
}

func (m *mockTmuxOps) ListBoards(ctx context.Context) ([]tmux.BoardSummary, error) {
	m.listBoardsCalled = true
	if m.listBoardsErr != nil {
		return nil, m.listBoardsErr
	}
	return m.listBoardsResult, nil
}
func (m *mockTmuxOps) GetBoard(ctx context.Context, name string) ([]tmux.BoardEntry, error) {
	m.getBoardCalled = true
	m.getBoardName = name
	if m.getBoardErr != nil {
		return nil, m.getBoardErr
	}
	return m.getBoardResult, nil
}
func (m *mockTmuxOps) ListBoardEntries(ctx context.Context, server string) ([]tmux.BoardEntry, error) {
	if m.listBoardEntriesErr != nil {
		return nil, m.listBoardEntriesErr
	}
	if m.listBoardEntriesByServer != nil {
		return m.listBoardEntriesByServer[server], nil
	}
	return m.listBoardEntriesResult, nil
}
func (m *mockTmuxOps) PinBoard(ctx context.Context, server, windowID, board string) error {
	m.pinBoardCalled = true
	m.pinBoardServer = server
	m.pinBoardWindowID = windowID
	m.pinBoardBoard = board
	return m.pinBoardErr
}
func (m *mockTmuxOps) UnpinBoard(ctx context.Context, server, windowID, board string) error {
	m.unpinBoardCalled = true
	m.unpinBoardServer = server
	m.unpinBoardWindowID = windowID
	m.unpinBoardBoard = board
	return m.unpinBoardErr
}
func (m *mockTmuxOps) ReorderBoard(ctx context.Context, server, windowID, board, before, after string) (string, error) {
	m.reorderBoardCalled = true
	m.reorderBoardServer = server
	m.reorderBoardWindowID = windowID
	m.reorderBoardBoard = board
	m.reorderBoardBefore = before
	m.reorderBoardAfter = after
	if m.reorderBoardErr != nil {
		return "", m.reorderBoardErr
	}
	if m.reorderBoardNewKey == "" {
		return "m", nil
	}
	return m.reorderBoardNewKey, nil
}

func newTestRouter(sf SessionFetcher, ops TmuxOps) http.Handler {
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))
	return NewTestRouter(logger, sf, ops, "test-host")
}

func TestSessionsList(t *testing.T) {
	sf := &mockSessionFetcher{
		result: []sessions.ProjectSession{
			{
				Name: "run-kit",
				Windows: []tmux.WindowInfo{
					{Index: 0, Name: "main", WorktreePath: "/home/user/code", Activity: "active", IsActiveWindow: true, FabChange: "260312-abc", FabStage: "apply"},
					{Index: 1, Name: "build", WorktreePath: "/tmp/build", Activity: "idle", IsActiveWindow: false, FabChange: "260312-abc", FabStage: "apply"},
				},
			},
		},
	}

	router := newTestRouter(sf, &mockTmuxOps{})
	req := httptest.NewRequest(http.MethodGet, "/api/sessions", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusOK)
	}

	ct := rec.Header().Get("Content-Type")
	if ct != "application/json" {
		t.Errorf("Content-Type = %q, want %q", ct, "application/json")
	}

	var result []sessions.ProjectSession
	if err := json.NewDecoder(rec.Body).Decode(&result); err != nil {
		t.Fatalf("decode error: %v", err)
	}

	if len(result) != 1 {
		t.Fatalf("len(result) = %d, want 1", len(result))
	}
	if result[0].Name != "run-kit" {
		t.Errorf("result[0].Name = %q, want %q", result[0].Name, "run-kit")
	}
	if len(result[0].Windows) != 2 {
		t.Fatalf("len(windows) = %d, want 2", len(result[0].Windows))
	}
	if result[0].Windows[0].FabChange != "260312-abc" {
		t.Errorf("FabChange = %q, want %q", result[0].Windows[0].FabChange, "260312-abc")
	}
	if result[0].Windows[0].FabStage != "apply" {
		t.Errorf("FabStage = %q, want %q", result[0].Windows[0].FabStage, "apply")
	}
}

func TestSessionCreate(t *testing.T) {
	ops := &mockTmuxOps{}
	router := newTestRouter(&mockSessionFetcher{}, ops)

	body := `{"name":"my-project","cwd":"~/code/my-project"}`
	req := httptest.NewRequest(http.MethodPost, "/api/sessions", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusCreated)
	}

	if !ops.createSessionCalled {
		t.Error("CreateSession was not called")
	}
	if ops.createSessionName != "my-project" {
		t.Errorf("createSessionName = %q, want %q", ops.createSessionName, "my-project")
	}

	var result map[string]bool
	if err := json.NewDecoder(rec.Body).Decode(&result); err != nil {
		t.Fatalf("decode error: %v", err)
	}
	if !result["ok"] {
		t.Error("expected ok: true")
	}
}

func TestSessionCreateEmptyName(t *testing.T) {
	router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})

	body := `{"name":""}`
	req := httptest.NewRequest(http.MethodPost, "/api/sessions", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}

	var result map[string]string
	if err := json.NewDecoder(rec.Body).Decode(&result); err != nil {
		t.Fatalf("decode error: %v", err)
	}
	if !strings.Contains(result["error"], "cannot be empty") {
		t.Errorf("error = %q, want containing %q", result["error"], "cannot be empty")
	}
}

func TestSessionCreateForbiddenChars(t *testing.T) {
	router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})

	body := `{"name":"test;hack"}`
	req := httptest.NewRequest(http.MethodPost, "/api/sessions", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}

	var result map[string]string
	if err := json.NewDecoder(rec.Body).Decode(&result); err != nil {
		t.Fatalf("decode error: %v", err)
	}
	if !strings.Contains(result["error"], "forbidden characters") {
		t.Errorf("error = %q, want containing %q", result["error"], "forbidden characters")
	}
}

func TestSessionCreateInvalidJSON(t *testing.T) {
	router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})

	req := httptest.NewRequest(http.MethodPost, "/api/sessions", strings.NewReader("{invalid"))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
}

func TestSessionKill(t *testing.T) {
	ops := &mockTmuxOps{}
	router := newTestRouter(&mockSessionFetcher{}, ops)

	req := httptest.NewRequest(http.MethodPost, "/api/sessions/test-session/kill", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusOK)
	}

	if !ops.killSessionCalled {
		t.Error("KillSession was not called")
	}
	if ops.killSessionName != "test-session" {
		t.Errorf("killSessionName = %q, want %q", ops.killSessionName, "test-session")
	}
}

func TestClosePaneSuccess(t *testing.T) {
	ops := &mockTmuxOps{}
	router := newTestRouter(&mockSessionFetcher{}, ops)

	req := httptest.NewRequest(http.MethodPost, "/api/windows/@3/close-pane", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusOK)
	}

	if !ops.killActivePaneCalled {
		t.Error("KillActivePane was not called")
	}
	if ops.killActivePaneWindowID != "@3" {
		t.Errorf("killActivePaneWindowID = %q, want %q", ops.killActivePaneWindowID, "@3")
	}

	var result map[string]bool
	if err := json.NewDecoder(rec.Body).Decode(&result); err != nil {
		t.Fatalf("decode error: %v", err)
	}
	if !result["ok"] {
		t.Error("expected ok: true")
	}
}

func TestClosePaneInvalidWindowID(t *testing.T) {
	router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})

	req := httptest.NewRequest(http.MethodPost, "/api/windows/abc/close-pane", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}

	var result map[string]string
	if err := json.NewDecoder(rec.Body).Decode(&result); err != nil {
		t.Fatalf("decode error: %v", err)
	}
	if !strings.Contains(result["error"], "Invalid window ID") {
		t.Errorf("error = %q, want containing %q", result["error"], "Invalid window ID")
	}
}

// --- Session Color endpoint tests ---

func TestSessionColorSet(t *testing.T) {
	ops := &mockTmuxOps{}
	router := newTestRouter(&mockSessionFetcher{}, ops)

	body := `{"color":6}`
	req := httptest.NewRequest(http.MethodPost, "/api/sessions/myproject/color", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want %d; body = %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if !ops.setSessionColorCalled {
		t.Error("SetSessionColor was not called")
	}
	if ops.setSessionColorSession != "myproject" {
		t.Errorf("session = %q, want %q", ops.setSessionColorSession, "myproject")
	}
	if ops.setSessionColorColor != 6 {
		t.Errorf("color = %d, want %d", ops.setSessionColorColor, 6)
	}
}

func TestSessionColorClear(t *testing.T) {
	ops := &mockTmuxOps{}
	router := newTestRouter(&mockSessionFetcher{}, ops)

	body := `{"color":null}`
	req := httptest.NewRequest(http.MethodPost, "/api/sessions/myproject/color", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want %d; body = %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if !ops.unsetSessionColorCalled {
		t.Error("UnsetSessionColor was not called")
	}
	if ops.unsetSessionColorSession != "myproject" {
		t.Errorf("session = %q, want %q", ops.unsetSessionColorSession, "myproject")
	}
}

func TestSessionColorInvalidValue(t *testing.T) {
	router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})

	body := `{"color":20}`
	req := httptest.NewRequest(http.MethodPost, "/api/sessions/myproject/color", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
}

func TestSessionColorInvalidSession(t *testing.T) {
	router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})

	body := `{"color":4}`
	req := httptest.NewRequest(http.MethodPost, "/api/sessions/bad;session/color", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
}

func TestSessionColorTmuxError(t *testing.T) {
	ops := &mockTmuxOps{setSessionColorErr: fmt.Errorf("tmux error")}
	router := newTestRouter(&mockSessionFetcher{}, ops)

	body := `{"color":4}`
	req := httptest.NewRequest(http.MethodPost, "/api/sessions/myproject/color", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusInternalServerError)
	}
}

func TestSessionKillInvalidName(t *testing.T) {
	router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})

	req := httptest.NewRequest(http.MethodPost, "/api/sessions/test;rm/kill", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}

	var result map[string]string
	if err := json.NewDecoder(rec.Body).Decode(&result); err != nil {
		t.Fatalf("decode error: %v", err)
	}
	if !strings.Contains(result["error"], "forbidden characters") {
		t.Errorf("error = %q, want containing %q", result["error"], "forbidden characters")
	}
}

func TestSessionOrder_GET_unset(t *testing.T) {
	ops := &mockTmuxOps{} // getSessionOrderResult nil → returns []string{}, nil
	router := newTestRouter(&mockSessionFetcher{}, ops)

	req := httptest.NewRequest(http.MethodGet, "/api/sessions/order?server=default", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var result struct {
		Order []string `json:"order"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&result); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if result.Order == nil {
		t.Fatal("order field is null in JSON, expected empty array")
	}
	if len(result.Order) != 0 {
		t.Errorf("order = %v, want []", result.Order)
	}
	if !ops.getSessionOrderCalled {
		t.Error("GetSessionOrder was not called")
	}
}

func TestSessionOrder_GET_set(t *testing.T) {
	ops := &mockTmuxOps{getSessionOrderResult: []string{"main", "dev"}}
	router := newTestRouter(&mockSessionFetcher{}, ops)

	req := httptest.NewRequest(http.MethodGet, "/api/sessions/order?server=default", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var result struct {
		Order []string `json:"order"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&result); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(result.Order) != 2 || result.Order[0] != "main" || result.Order[1] != "dev" {
		t.Errorf("order = %v, want [main dev]", result.Order)
	}
}

func TestSessionOrder_GET_tmuxError(t *testing.T) {
	ops := &mockTmuxOps{getSessionOrderErr: fmt.Errorf("decode @rk_session_order: invalid character")}
	router := newTestRouter(&mockSessionFetcher{}, ops)

	req := httptest.NewRequest(http.MethodGet, "/api/sessions/order?server=default", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Errorf("status = %d, want 500", rec.Code)
	}
}

func TestSessionOrder_POST_roundTrip(t *testing.T) {
	ops := &mockTmuxOps{}
	router := newTestRouter(&mockSessionFetcher{}, ops)

	body := `{"order":["main","dev","scratch"]}`
	req := httptest.NewRequest(http.MethodPost, "/api/sessions/order?server=default", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if !ops.setSessionOrderCalled {
		t.Fatal("SetSessionOrder was not called")
	}
	got := ops.setSessionOrderOrder
	if len(got) != 3 || got[0] != "main" || got[1] != "dev" || got[2] != "scratch" {
		t.Errorf("setSessionOrderOrder = %v, want [main dev scratch]", got)
	}
	var result map[string]bool
	if err := json.NewDecoder(rec.Body).Decode(&result); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !result["ok"] {
		t.Error("expected ok: true")
	}
}

func TestSessionOrder_POST_invalidBody_notArray(t *testing.T) {
	ops := &mockTmuxOps{}
	router := newTestRouter(&mockSessionFetcher{}, ops)

	body := `{"order":"main"}`
	req := httptest.NewRequest(http.MethodPost, "/api/sessions/order?server=default", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
	if ops.setSessionOrderCalled {
		t.Error("SetSessionOrder should NOT be called for invalid body")
	}
}

func TestSessionOrder_POST_invalidBody_malformedJSON(t *testing.T) {
	ops := &mockTmuxOps{}
	router := newTestRouter(&mockSessionFetcher{}, ops)

	req := httptest.NewRequest(http.MethodPost, "/api/sessions/order?server=default", strings.NewReader("not json"))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", rec.Code)
	}
	if ops.setSessionOrderCalled {
		t.Error("SetSessionOrder should NOT be called for malformed JSON")
	}
}

func TestSessionOrder_POST_invalidName(t *testing.T) {
	ops := &mockTmuxOps{}
	router := newTestRouter(&mockSessionFetcher{}, ops)

	// "bad;name" contains a forbidden shell metacharacter — validate.ValidateName rejects.
	body := `{"order":["main","bad;name"]}`
	req := httptest.NewRequest(http.MethodPost, "/api/sessions/order?server=default", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
	if ops.setSessionOrderCalled {
		t.Error("SetSessionOrder should NOT be called for invalid name")
	}
	var result map[string]string
	_ = json.NewDecoder(rec.Body).Decode(&result)
	if !strings.Contains(result["error"], "forbidden characters") {
		t.Errorf("error = %q, want containing %q", result["error"], "forbidden characters")
	}
}

func TestSessionOrder_POST_emptyArray(t *testing.T) {
	ops := &mockTmuxOps{}
	router := newTestRouter(&mockSessionFetcher{}, ops)

	body := `{"order":[]}`
	req := httptest.NewRequest(http.MethodPost, "/api/sessions/order?server=default", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want 200", rec.Code)
	}
	if !ops.setSessionOrderCalled {
		t.Error("SetSessionOrder was not called")
	}
	if len(ops.setSessionOrderOrder) != 0 {
		t.Errorf("got order %v, want empty", ops.setSessionOrderOrder)
	}
}

func TestSessionOrder_POST_staleNameAccepted(t *testing.T) {
	// Names that pass validate.ValidateName but don't match a current session
	// MUST be accepted — the frontend's render layer handles stale names.
	ops := &mockTmuxOps{}
	router := newTestRouter(&mockSessionFetcher{}, ops)

	body := `{"order":["main","deleted-yesterday"]}`
	req := httptest.NewRequest(http.MethodPost, "/api/sessions/order?server=default", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want 200", rec.Code)
	}
}

func TestSessionOrder_POST_tmuxError(t *testing.T) {
	ops := &mockTmuxOps{setSessionOrderErr: fmt.Errorf("tmux failed")}
	router := newTestRouter(&mockSessionFetcher{}, ops)

	body := `{"order":["main"]}`
	req := httptest.NewRequest(http.MethodPost, "/api/sessions/order?server=default", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Errorf("status = %d, want 500; body=%s", rec.Code, rec.Body.String())
	}
}

// TestSessionOrder_POST_triggersBroadcast verifies the end-to-end wiring from
// the POST handler through the SSE hub: a successful POST must result in a
// connected client receiving a session-order event for that server.
func TestSessionOrder_POST_triggersBroadcast(t *testing.T) {
	ops := &mockTmuxOps{}
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))
	server := &Server{
		logger:   logger,
		sessions: &mockSessionFetcher{},
		tmux:     ops,
		hostname: "test-host",
	}

	// Connect a client to the SSE hub directly. Using the hub avoids needing
	// httptest.NewServer for a streaming response.
	server.initSSEHub()
	client := &sseClient{ch: make(chan []byte, 16), server: "default"}
	server.sseHub.addClient(client)
	defer server.sseHub.removeClient(client)

	// Drain any cached snapshot events so the channel is empty before the PUT.
	drainDeadline := time.After(100 * time.Millisecond)
draining:
	for {
		select {
		case <-client.ch:
		case <-drainDeadline:
			break draining
		}
	}

	router := server.buildRouter()
	body := `{"order":["main","dev"]}`
	req := httptest.NewRequest(http.MethodPost, "/api/sessions/order?server=default", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("POST status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}

	// The client must receive a session-order event within ~100ms (broadcast
	// is synchronous on the PUT path).
	select {
	case ev := <-client.ch:
		evStr := string(ev)
		if !strings.Contains(evStr, "event: session-order") {
			t.Errorf("expected session-order event, got: %s", evStr)
		}
		if !strings.Contains(evStr, `"server":"default"`) {
			t.Errorf("event missing server field: %s", evStr)
		}
		if !strings.Contains(evStr, `"order":["main","dev"]`) {
			t.Errorf("event missing or wrong order: %s", evStr)
		}
	case <-time.After(500 * time.Millisecond):
		t.Fatal("client did not receive session-order event after PUT")
	}
}
