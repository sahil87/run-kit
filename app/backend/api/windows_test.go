package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"rk/internal/tmux"
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

func TestWindowMoveSuccess(t *testing.T) {
	ops := &mockTmuxOps{}
	router := newTestRouter(&mockSessionFetcher{}, ops)

	body := `{"targetIndex":2}`
	req := httptest.NewRequest(http.MethodPost, "/api/sessions/run-kit/windows/0/move", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusOK)
	}

	if !ops.swapWindowCalled {
		t.Error("MoveWindow was not called")
	}
	if ops.swapWindowSession != "run-kit" {
		t.Errorf("session = %q, want %q", ops.swapWindowSession, "run-kit")
	}
	if ops.swapWindowSrcIndex != 0 {
		t.Errorf("srcIndex = %d, want %d", ops.swapWindowSrcIndex, 0)
	}
	if ops.swapWindowDstIndex != 2 {
		t.Errorf("dstIndex = %d, want %d", ops.swapWindowDstIndex, 2)
	}

	var result map[string]bool
	if err := json.NewDecoder(rec.Body).Decode(&result); err != nil {
		t.Fatalf("decode error: %v", err)
	}
	if !result["ok"] {
		t.Error("expected ok: true")
	}
}

func TestWindowMoveInvalidBody(t *testing.T) {
	router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})

	req := httptest.NewRequest(http.MethodPost, "/api/sessions/run-kit/windows/0/move", strings.NewReader("not json"))
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
	if result["error"] != "Invalid JSON body" {
		t.Errorf("error = %q, want %q", result["error"], "Invalid JSON body")
	}
}

func TestWindowMoveNegativeTargetIndex(t *testing.T) {
	router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})

	body := `{"targetIndex":-1}`
	req := httptest.NewRequest(http.MethodPost, "/api/sessions/run-kit/windows/0/move", strings.NewReader(body))
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
	if result["error"] != "targetIndex must be a non-negative integer" {
		t.Errorf("error = %q, want %q", result["error"], "targetIndex must be a non-negative integer")
	}
}

func TestWindowMoveInvalidIndex(t *testing.T) {
	router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})

	body := `{"targetIndex":2}`
	req := httptest.NewRequest(http.MethodPost, "/api/sessions/run-kit/windows/abc/move", strings.NewReader(body))
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
	if result["error"] != "Invalid window index" {
		t.Errorf("error = %q, want %q", result["error"], "Invalid window index")
	}
}

func TestWindowMoveInvalidSession(t *testing.T) {
	router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})

	body := `{"targetIndex":2}`
	req := httptest.NewRequest(http.MethodPost, "/api/sessions/bad;session/windows/0/move", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
}

func TestWindowMoveTmuxError(t *testing.T) {
	ops := &mockTmuxOps{swapWindowErr: fmt.Errorf("can't find window 5")}
	router := newTestRouter(&mockSessionFetcher{}, ops)

	body := `{"targetIndex":5}`
	req := httptest.NewRequest(http.MethodPost, "/api/sessions/run-kit/windows/0/move", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusInternalServerError)
	}
}

func TestWindowMoveMissingTargetIndex(t *testing.T) {
	router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})

	body := `{}`
	req := httptest.NewRequest(http.MethodPost, "/api/sessions/run-kit/windows/0/move", strings.NewReader(body))
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

// --- MoveWindowToSession handler tests ---

func TestWindowMoveToSessionSuccess(t *testing.T) {
	ops := &mockTmuxOps{}
	router := newTestRouter(&mockSessionFetcher{}, ops)

	body := `{"targetSession":"bravo"}`
	req := httptest.NewRequest(http.MethodPost, "/api/sessions/alpha/windows/1/move-to-session", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusOK)
	}

	if !ops.moveWindowToSessionCalled {
		t.Error("MoveWindowToSession was not called")
	}
	if ops.moveWindowToSessionSrcSession != "alpha" {
		t.Errorf("srcSession = %q, want %q", ops.moveWindowToSessionSrcSession, "alpha")
	}
	if ops.moveWindowToSessionSrcIndex != 1 {
		t.Errorf("srcIndex = %d, want %d", ops.moveWindowToSessionSrcIndex, 1)
	}
	if ops.moveWindowToSessionDstSession != "bravo" {
		t.Errorf("dstSession = %q, want %q", ops.moveWindowToSessionDstSession, "bravo")
	}

	var result map[string]bool
	if err := json.NewDecoder(rec.Body).Decode(&result); err != nil {
		t.Fatalf("decode error: %v", err)
	}
	if !result["ok"] {
		t.Error("expected ok: true")
	}
}

func TestWindowMoveToSessionSameSession(t *testing.T) {
	router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})

	body := `{"targetSession":"alpha"}`
	req := httptest.NewRequest(http.MethodPost, "/api/sessions/alpha/windows/0/move-to-session", strings.NewReader(body))
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
	if result["error"] != "targetSession must differ from source session" {
		t.Errorf("error = %q, want %q", result["error"], "targetSession must differ from source session")
	}
}

func TestWindowMoveToSessionMissingTarget(t *testing.T) {
	router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})

	body := `{}`
	req := httptest.NewRequest(http.MethodPost, "/api/sessions/alpha/windows/0/move-to-session", strings.NewReader(body))
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
	if result["error"] != "targetSession is required" {
		t.Errorf("error = %q, want %q", result["error"], "targetSession is required")
	}
}

func TestWindowMoveToSessionInvalidTargetName(t *testing.T) {
	router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})

	body := `{"targetSession":"bad;name"}`
	req := httptest.NewRequest(http.MethodPost, "/api/sessions/alpha/windows/0/move-to-session", strings.NewReader(body))
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

func TestWindowMoveToSessionInvalidSession(t *testing.T) {
	router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})

	body := `{"targetSession":"bravo"}`
	req := httptest.NewRequest(http.MethodPost, "/api/sessions/bad;session/windows/0/move-to-session", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
}

func TestWindowMoveToSessionInvalidJSON(t *testing.T) {
	router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})

	req := httptest.NewRequest(http.MethodPost, "/api/sessions/alpha/windows/0/move-to-session", strings.NewReader("not json"))
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
	if result["error"] != "Invalid JSON body" {
		t.Errorf("error = %q, want %q", result["error"], "Invalid JSON body")
	}
}

func TestWindowMoveToSessionTmuxError(t *testing.T) {
	ops := &mockTmuxOps{moveWindowToSessionErr: fmt.Errorf("can't find window 99")}
	router := newTestRouter(&mockSessionFetcher{}, ops)

	body := `{"targetSession":"bravo"}`
	req := httptest.NewRequest(http.MethodPost, "/api/sessions/alpha/windows/99/move-to-session", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusInternalServerError)
	}
}
