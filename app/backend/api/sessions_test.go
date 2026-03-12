package api

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"run-kit/internal/sessions"
	"run-kit/internal/tmux"
)

// mockSessionFetcher returns canned session data.
type mockSessionFetcher struct {
	result []sessions.ProjectSession
	err    error
}

func (m *mockSessionFetcher) FetchSessions() ([]sessions.ProjectSession, error) {
	return m.result, m.err
}

// mockTmuxOps records calls for verification.
type mockTmuxOps struct {
	createSessionCalled bool
	createSessionName   string
	createSessionCwd    string
	killSessionCalled   bool
	killSessionName     string

	createWindowCalled  bool
	createWindowSession string
	createWindowName    string
	createWindowCwd     string
	killWindowCalled    bool
	killWindowSession   string
	killWindowIndex     int
	renameWindowCalled  bool
	renameWindowSession string
	renameWindowIndex   int
	renameWindowName    string
	sendKeysCalled      bool
	sendKeysSession     string
	sendKeysWindow      int
	sendKeysKeys        string

	listWindowsResult []tmux.WindowInfo
	listWindowsErr    error

	splitWindowResult string
	splitWindowErr    error

	err error
}

func (m *mockTmuxOps) CreateSession(name, cwd string) error {
	m.createSessionCalled = true
	m.createSessionName = name
	m.createSessionCwd = cwd
	return m.err
}
func (m *mockTmuxOps) KillSession(session string) error {
	m.killSessionCalled = true
	m.killSessionName = session
	return m.err
}
func (m *mockTmuxOps) CreateWindow(session, name, cwd string) error {
	m.createWindowCalled = true
	m.createWindowSession = session
	m.createWindowName = name
	m.createWindowCwd = cwd
	return m.err
}
func (m *mockTmuxOps) KillWindow(session string, index int) error {
	m.killWindowCalled = true
	m.killWindowSession = session
	m.killWindowIndex = index
	return m.err
}
func (m *mockTmuxOps) RenameWindow(session string, index int, name string) error {
	m.renameWindowCalled = true
	m.renameWindowSession = session
	m.renameWindowIndex = index
	m.renameWindowName = name
	return m.err
}
func (m *mockTmuxOps) SendKeys(session string, window int, keys string) error {
	m.sendKeysCalled = true
	m.sendKeysSession = session
	m.sendKeysWindow = window
	m.sendKeysKeys = keys
	return m.err
}
func (m *mockTmuxOps) ListWindows(session string) ([]tmux.WindowInfo, error) {
	return m.listWindowsResult, m.listWindowsErr
}
func (m *mockTmuxOps) SplitWindow(session string, window int) (string, error) {
	return m.splitWindowResult, m.splitWindowErr
}
func (m *mockTmuxOps) SelectWindow(session string, index int) error {
	return nil
}
func (m *mockTmuxOps) KillPane(paneID string) error {
	return nil
}

func newTestRouter(sf SessionFetcher, ops TmuxOps) http.Handler {
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))
	return NewTestRouter(logger, sf, ops)
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
