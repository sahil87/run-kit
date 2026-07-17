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
	"sync"
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
//
// Most fields are written and read within a single goroutine (synchronous
// handler tests), so they need no locking. The kill-session fields are the
// exception: a deferred cleanup on the SERVER goroutine may observe them while
// the test goroutine reads them, so those two are guarded by killMu and
// accessed via KillSessionWasCalled.
type mockTmuxOps struct {
	createSessionCalled bool
	createSessionName   string
	createSessionCwd    string
	killMu                 sync.Mutex
	killSessionCalled      bool
	killSessionName        string
	renameSessionCalled    bool
	renameSessionSession   string
	renameSessionName      string

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
	// listWindowsBySession, when non-nil, makes ListWindows session-aware:
	// it returns the windows mapped to the queried session name (empty slice
	// for an unmapped session). This is required to faithfully model the
	// move-based board world, where a pinned window lives ONLY in its
	// `_rk-pin-<id>` session and NOT in any home session — the flat
	// listWindowsResult (returned for every session) cannot express that.
	listWindowsBySession map[string][]tmux.WindowInfo
	listSessionsResult   []tmux.SessionInfo
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
	setSessionColorColor   string
	setSessionColorErr     error
	unsetSessionColorCalled  bool
	unsetSessionColorSession string
	unsetSessionColorErr     error

	setWindowColorCalled   bool
	setWindowColorWindowID string
	setWindowColorColor    string
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

	// Server rank. rankMu guards the concurrent fan-out reads/writes (the
	// /api/servers handler calls GetServerRank once per server in parallel).
	rankMu             sync.Mutex
	getServerRankByServer map[string]*int
	getServerRankErrByServer map[string]error
	setServerRankCalls    []struct {
		Server string
		Rank   int
	}

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

	// Chat-send injection primitives (260714-jdyg-chat-send). chatCalls records
	// the ordered sequence of primitive invocations so a test can assert the
	// baseline capture → set-buffer → paste-buffer → capture-pane → send-keys
	// order (and that no send-keys follows a failed probe). chatMu guards ALL
	// chat-send mock fields: the concurrency test drives two sends on separate
	// goroutines under -race, so the recorder must not itself race.
	chatMu               sync.Mutex
	chatCalls            []string
	setChatBufferText    string
	setChatBufferTexts   []string // every text passed, in order (concurrency assertions)
	pasteChatPaneID      string
	pasteChatPaneIDs     []string // every paste target pane, in order (cross-pane concurrency assertions)
	sendEnterPaneID      string
	sendEnterCalled      bool
	setChatBufferErr     error
	pasteChatBufferErr   error
	sendEnterErr         error
	// capturePaneResults is consumed one entry per CapturePane call (baseline +
	// probe retries), falling back to capturePaneResult once exhausted.
	// capturePaneErr forces a capture failure.
	capturePaneResult  string
	capturePaneResults []string
	capturePaneErr     error
	capturePaneCalls   int
	// capturePaneCtxAware makes CapturePane block until the caller's ctx is done
	// and return ctx.Err() — modeling a real ctx-bound tmux exec hit by the shared
	// injection deadline (the shared-deadline abort test).
	capturePaneCtxAware bool
	// setChatBufferHook, when non-nil, runs INSIDE SetChatSendBuffer while the
	// per-request work is in flight — used by the concurrency test to force an
	// A-set/B-set/A-paste interleave and prove the critical section serializes.
	setChatBufferHook func(text string)

	err error
}

func (m *mockTmuxOps) CreateSession(name, cwd, server string) error {
	m.createSessionCalled = true
	m.createSessionName = name
	m.createSessionCwd = cwd
	return m.err
}
func (m *mockTmuxOps) KillSession(session, server string) error {
	m.killMu.Lock()
	m.killSessionCalled = true
	m.killSessionName = session
	m.killMu.Unlock()
	return m.err
}
func (m *mockTmuxOps) KillSessionCtx(ctx context.Context, server, session string) error {
	m.killMu.Lock()
	m.killSessionCalled = true
	m.killSessionName = session
	m.killMu.Unlock()
	return m.err
}

// KillSessionWasCalled returns the recorded kill state under killMu. Use this
// (not the bare fields) when the kill may run on a different goroutine than the
// assertion — e.g. the relay abort-clean deferred reap.
func (m *mockTmuxOps) KillSessionWasCalled() (bool, string) {
	m.killMu.Lock()
	defer m.killMu.Unlock()
	return m.killSessionCalled, m.killSessionName
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
	if m.listWindowsBySession != nil {
		return m.listWindowsBySession[session], m.listWindowsErr
	}
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
func (m *mockTmuxOps) SetSessionColor(session string, color string, server string) error {
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
func (m *mockTmuxOps) SetWindowColor(windowID string, color string, server string) error {
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
func (m *mockTmuxOps) GetServerRank(ctx context.Context, server string) (*int, error) {
	m.rankMu.Lock()
	defer m.rankMu.Unlock()
	if m.getServerRankErrByServer != nil {
		if err, ok := m.getServerRankErrByServer[server]; ok && err != nil {
			return nil, err
		}
	}
	if m.getServerRankByServer != nil {
		return m.getServerRankByServer[server], nil
	}
	return nil, nil
}
func (m *mockTmuxOps) SetServerRank(ctx context.Context, server string, rank int) error {
	m.rankMu.Lock()
	m.setServerRankCalls = append(m.setServerRankCalls, struct {
		Server string
		Rank   int
	}{server, rank})
	m.rankMu.Unlock()
	m.rankMu.Lock()
	err := m.err
	if m.getServerRankErrByServer != nil {
		if e, ok := m.getServerRankErrByServer[server]; ok && e != nil {
			err = e
		}
	}
	m.rankMu.Unlock()
	return err
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

func (m *mockTmuxOps) SetChatSendBuffer(ctx context.Context, text, server string) error {
	m.chatMu.Lock()
	m.chatCalls = append(m.chatCalls, "set-buffer")
	m.setChatBufferText = text
	m.setChatBufferTexts = append(m.setChatBufferTexts, text)
	hook := m.setChatBufferHook
	err := m.setChatBufferErr
	m.chatMu.Unlock()
	// The hook runs OUTSIDE chatMu so it cannot itself provide the serialization
	// under test — the only serialization is the handler's package mutex around
	// the set → paste critical section.
	if hook != nil {
		hook(text)
	}
	return err
}
func (m *mockTmuxOps) PasteChatSendBuffer(ctx context.Context, paneID, server string) error {
	m.chatMu.Lock()
	defer m.chatMu.Unlock()
	m.chatCalls = append(m.chatCalls, "paste-buffer")
	m.pasteChatPaneID = paneID
	m.pasteChatPaneIDs = append(m.pasteChatPaneIDs, paneID)
	return m.pasteChatBufferErr
}
func (m *mockTmuxOps) SendEnterToPane(ctx context.Context, paneID, server string) error {
	m.chatMu.Lock()
	defer m.chatMu.Unlock()
	m.chatCalls = append(m.chatCalls, "send-keys")
	m.sendEnterCalled = true
	m.sendEnterPaneID = paneID
	return m.sendEnterErr
}
func (m *mockTmuxOps) CapturePane(ctx context.Context, paneID string, lines int, server string) (string, error) {
	m.chatMu.Lock()
	m.chatCalls = append(m.chatCalls, "capture-pane")
	idx := m.capturePaneCalls
	m.capturePaneCalls++
	ctxAware := m.capturePaneCtxAware
	capErr := m.capturePaneErr
	var result string
	if idx < len(m.capturePaneResults) {
		result = m.capturePaneResults[idx]
	} else {
		result = m.capturePaneResult
	}
	m.chatMu.Unlock()

	if ctxAware {
		<-ctx.Done()
		return "", ctx.Err()
	}
	if capErr != nil {
		return "", capErr
	}
	return result, nil
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

	killed, killedName := ops.KillSessionWasCalled()
	if !killed {
		t.Error("KillSession was not called")
	}
	if killedName != "test-session" {
		t.Errorf("killSessionName = %q, want %q", killedName, "test-session")
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

	body := `{"color":"6"}`
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
	if ops.setSessionColorColor != "6" {
		t.Errorf("color = %q, want %q", ops.setSessionColorColor, "6")
	}
}

func TestSessionColorSetBlend(t *testing.T) {
	ops := &mockTmuxOps{}
	router := newTestRouter(&mockSessionFetcher{}, ops)

	body := `{"color":"1+3"}`
	req := httptest.NewRequest(http.MethodPost, "/api/sessions/myproject/color", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want %d; body = %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if ops.setSessionColorColor != "1+3" {
		t.Errorf("color = %q, want %q", ops.setSessionColorColor, "1+3")
	}
}

func TestSessionColorRejectsMalformed(t *testing.T) {
	for _, bad := range []string{`{"color":"99"}`, `{"color":"1+"}`, `{"color":"x"}`, `{"color":"1+2+3"}`} {
		ops := &mockTmuxOps{}
		router := newTestRouter(&mockSessionFetcher{}, ops)
		req := httptest.NewRequest(http.MethodPost, "/api/sessions/myproject/color", strings.NewReader(bad))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("body %s: status = %d, want %d", bad, rec.Code, http.StatusBadRequest)
		}
		if ops.setSessionColorCalled {
			t.Errorf("body %s: SetSessionColor should not be called on invalid input", bad)
		}
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

	body := `{"color":"20"}`
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

	body := `{"color":"4"}`
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
	client := &sseClient{ch: make(chan hubEvent, 16), server: "default"}
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
		evStr := ev.String()
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
