package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"run-kit/internal/tmux"
)

func TestWindowCreate(t *testing.T) {
	ops := &mockTmuxOps{}
	router := newTestRouter(&mockSessionFetcher{}, ops)

	body := `{"name":"feature","cwd":"~/code/run-kit"}`
	req := httptest.NewRequest(http.MethodPost, "/api/sessions/run-kit/windows", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusCreated)
	}

	if !ops.createWindowCalled {
		t.Error("CreateWindow was not called")
	}
	if ops.createWindowSession != "run-kit" {
		t.Errorf("session = %q, want %q", ops.createWindowSession, "run-kit")
	}
	if ops.createWindowName != "feature" {
		t.Errorf("name = %q, want %q", ops.createWindowName, "feature")
	}
}

func TestWindowCreateDefaultCwdFromFirstWindow(t *testing.T) {
	ops := &mockTmuxOps{
		listWindowsResult: []tmux.WindowInfo{
			{Index: 0, Name: "main", WorktreePath: "/home/user/project"},
			{Index: 1, Name: "tests", WorktreePath: "/home/user/other"},
		},
	}
	router := newTestRouter(&mockSessionFetcher{}, ops)

	body := `{"name":"new-win"}`
	req := httptest.NewRequest(http.MethodPost, "/api/sessions/run-kit/windows", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusCreated)
	}
	if ops.createWindowCwd != "/home/user/project" {
		t.Errorf("cwd = %q, want %q", ops.createWindowCwd, "/home/user/project")
	}
}

func TestWindowCreateInvalidSession(t *testing.T) {
	router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})

	body := `{"name":"win"}`
	req := httptest.NewRequest(http.MethodPost, "/api/sessions/bad;session/windows", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
}

func TestWindowCreateInvalidWindowName(t *testing.T) {
	router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})

	body := `{"name":""}`
	req := httptest.NewRequest(http.MethodPost, "/api/sessions/run-kit/windows", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
}

func TestWindowKill(t *testing.T) {
	ops := &mockTmuxOps{}
	router := newTestRouter(&mockSessionFetcher{}, ops)

	req := httptest.NewRequest(http.MethodPost, "/api/sessions/run-kit/windows/1/kill", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusOK)
	}

	if !ops.killWindowCalled {
		t.Error("KillWindow was not called")
	}
	if ops.killWindowSession != "run-kit" {
		t.Errorf("session = %q, want %q", ops.killWindowSession, "run-kit")
	}
	if ops.killWindowIndex != 1 {
		t.Errorf("index = %d, want %d", ops.killWindowIndex, 1)
	}
}

func TestWindowKillInvalidIndex(t *testing.T) {
	router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})

	req := httptest.NewRequest(http.MethodPost, "/api/sessions/run-kit/windows/abc/kill", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}

	var result map[string]string
	if err := json.NewDecoder(rec.Body).Decode(&result); err != nil {
		t.Fatalf("decode error: %v", err)
	}
	if result["error"] != "Invalid window index" {
		t.Errorf("error = %q, want %q", result["error"], "Invalid window index")
	}
}

func TestWindowKillNegativeIndex(t *testing.T) {
	router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})

	req := httptest.NewRequest(http.MethodPost, "/api/sessions/run-kit/windows/-1/kill", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
}

func TestWindowRename(t *testing.T) {
	ops := &mockTmuxOps{}
	router := newTestRouter(&mockSessionFetcher{}, ops)

	body := `{"name":"new-name"}`
	req := httptest.NewRequest(http.MethodPost, "/api/sessions/run-kit/windows/1/rename", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusOK)
	}

	if !ops.renameWindowCalled {
		t.Error("RenameWindow was not called")
	}
	if ops.renameWindowSession != "run-kit" {
		t.Errorf("session = %q, want %q", ops.renameWindowSession, "run-kit")
	}
	if ops.renameWindowIndex != 1 {
		t.Errorf("index = %d, want %d", ops.renameWindowIndex, 1)
	}
	if ops.renameWindowName != "new-name" {
		t.Errorf("name = %q, want %q", ops.renameWindowName, "new-name")
	}
}

func TestWindowRenameEmptyName(t *testing.T) {
	router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})

	body := `{"name":""}`
	req := httptest.NewRequest(http.MethodPost, "/api/sessions/run-kit/windows/0/rename", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
}

func TestWindowKeys(t *testing.T) {
	ops := &mockTmuxOps{}
	router := newTestRouter(&mockSessionFetcher{}, ops)

	body := `{"keys":"echo hello"}`
	req := httptest.NewRequest(http.MethodPost, "/api/sessions/run-kit/windows/0/keys", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusOK)
	}

	if !ops.sendKeysCalled {
		t.Error("SendKeys was not called")
	}
	if ops.sendKeysSession != "run-kit" {
		t.Errorf("session = %q, want %q", ops.sendKeysSession, "run-kit")
	}
	if ops.sendKeysWindow != 0 {
		t.Errorf("window = %d, want %d", ops.sendKeysWindow, 0)
	}
	if ops.sendKeysKeys != "echo hello" {
		t.Errorf("keys = %q, want %q", ops.sendKeysKeys, "echo hello")
	}
}

func TestWindowKeysEmpty(t *testing.T) {
	router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})

	body := `{"keys":"  "}`
	req := httptest.NewRequest(http.MethodPost, "/api/sessions/run-kit/windows/0/keys", strings.NewReader(body))
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
	if result["error"] != "Keys cannot be empty" {
		t.Errorf("error = %q, want %q", result["error"], "Keys cannot be empty")
	}
}

func TestWindowSplit(t *testing.T) {
	ops := &mockTmuxOps{splitWindowResult: "%5"}
	router := newTestRouter(&mockSessionFetcher{}, ops)

	body := `{"horizontal":true}`
	req := httptest.NewRequest(http.MethodPost, "/api/sessions/run-kit/windows/0/split", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusOK)
	}

	if !ops.splitWindowCalled {
		t.Error("SplitWindow was not called")
	}
	if ops.splitWindowSession != "run-kit" {
		t.Errorf("session = %q, want %q", ops.splitWindowSession, "run-kit")
	}
	if ops.splitWindowIndex != 0 {
		t.Errorf("window = %d, want %d", ops.splitWindowIndex, 0)
	}
	if !ops.splitWindowHorizontal {
		t.Error("horizontal = false, want true")
	}

	var result map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&result); err != nil {
		t.Fatalf("decode error: %v", err)
	}
	if result["pane_id"] != "%5" {
		t.Errorf("pane_id = %q, want %%5", result["pane_id"])
	}
}

func TestWindowSplitInvalidSession(t *testing.T) {
	router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})

	body := `{"horizontal":false}`
	req := httptest.NewRequest(http.MethodPost, "/api/sessions/bad;name/windows/0/split", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
}

func TestWindowSplitInvalidJSON(t *testing.T) {
	router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})

	req := httptest.NewRequest(http.MethodPost, "/api/sessions/run-kit/windows/0/split", strings.NewReader("not json"))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
}
