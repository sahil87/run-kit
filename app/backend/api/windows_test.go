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

// --- Window Options endpoint tests (POST /api/windows/{id}/options) ---
//
// findOp returns the recorded WindowOptionOp for key, or (zero, false). The
// /options handler iterates a map, so op order is non-deterministic — tests
// assert by key, not by slice position.
func findOp(ops []tmux.WindowOptionOp, key string) (tmux.WindowOptionOp, bool) {
	for _, op := range ops {
		if op.Key == key {
			return op, true
		}
	}
	return tmux.WindowOptionOp{}, false
}

func postOptions(t *testing.T, ops *mockTmuxOps, windowID, body string) *httptest.ResponseRecorder {
	t.Helper()
	router := newTestRouter(&mockSessionFetcher{}, ops)
	req := httptest.NewRequest(http.MethodPost, "/api/windows/"+windowID+"/options", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

// Set color only — the merge issues one SetWindowOptions call with just @color;
// @rk_url/@rk_type are left untouched (absent from the op list).
func TestWindowOptionsSetColorOnly(t *testing.T) {
	ops := &mockTmuxOps{}
	rec := postOptions(t, ops, "@2", `{"options":{"@color":"5"}}`)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if !ops.setWindowOptionsCalled {
		t.Fatal("SetWindowOptions was not called")
	}
	if ops.setWindowOptionsWindowID != "@2" {
		t.Errorf("windowID = %q, want %q", ops.setWindowOptionsWindowID, "@2")
	}
	if len(ops.setWindowOptionsOps) != 1 {
		t.Fatalf("ops = %v, want exactly 1 (@color)", ops.setWindowOptionsOps)
	}
	op, ok := findOp(ops.setWindowOptionsOps, "@color")
	if !ok || op.Value == nil || *op.Value != "5" {
		t.Errorf("@color op = %+v, want value \"5\"", op)
	}
}

// Explicit null unsets — a nil Value op is recorded for @color.
func TestWindowOptionsNullUnsets(t *testing.T) {
	ops := &mockTmuxOps{}
	rec := postOptions(t, ops, "@2", `{"options":{"@color":null}}`)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	op, ok := findOp(ops.setWindowOptionsOps, "@color")
	if !ok {
		t.Fatal("expected @color op")
	}
	if op.Value != nil {
		t.Errorf("@color value = %q, want nil (unset)", *op.Value)
	}
}

// Multi-key merge is a single SetWindowOptions invocation carrying both keys.
func TestWindowOptionsMultiKeyOneCall(t *testing.T) {
	ops := &mockTmuxOps{}
	rec := postOptions(t, ops, "@2", `{"options":{"@rk_url":"https://x","@rk_type":"iframe"}}`)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	if len(ops.setWindowOptionsOps) != 2 {
		t.Fatalf("ops = %v, want 2 (one invocation, both keys)", ops.setWindowOptionsOps)
	}
	urlOp, ok := findOp(ops.setWindowOptionsOps, "@rk_url")
	if !ok || urlOp.Value == nil || *urlOp.Value != "https://x" {
		t.Errorf("@rk_url op = %+v, want value \"https://x\"", urlOp)
	}
	typeOp, ok := findOp(ops.setWindowOptionsOps, "@rk_type")
	if !ok || typeOp.Value == nil || *typeOp.Value != "iframe" {
		t.Errorf("@rk_type op = %+v, want value \"iframe\"", typeOp)
	}
}

// Out-of-range @color → 400 and zero tmux calls (validate-all-then-execute).
func TestWindowOptionsColorOutOfRange(t *testing.T) {
	ops := &mockTmuxOps{}
	rec := postOptions(t, ops, "@0", `{"options":{"@color":"99"}}`)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
	if ops.setWindowOptionsCalled {
		t.Error("SetWindowOptions must NOT be called for invalid color")
	}
}

// Non-numeric @color → 400 and zero tmux calls.
func TestWindowOptionsColorNonNumeric(t *testing.T) {
	ops := &mockTmuxOps{}
	rec := postOptions(t, ops, "@0", `{"options":{"@color":"red"}}`)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
	if ops.setWindowOptionsCalled {
		t.Error("SetWindowOptions must NOT be called for non-numeric color")
	}
}

// Empty @rk_url → 400 and zero tmux calls.
func TestWindowOptionsEmptyUrl(t *testing.T) {
	ops := &mockTmuxOps{}
	rec := postOptions(t, ops, "@0", `{"options":{"@rk_url":""}}`)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
	if ops.setWindowOptionsCalled {
		t.Error("SetWindowOptions must NOT be called for empty url")
	}
}

// Unknown key → 400; the key is never forwarded to tmux. A mixed body (one
// valid + one invalid key) must also abort with zero tmux calls (atomic).
func TestWindowOptionsUnknownKeyRejected(t *testing.T) {
	ops := &mockTmuxOps{}
	rec := postOptions(t, ops, "@0", `{"options":{"@color":"5","@evil":"x"}}`)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
	if ops.setWindowOptionsCalled {
		t.Error("SetWindowOptions must NOT be called when an unknown key is present")
	}
}

// Set @rk_marker only — one SetWindowOptions call with just @rk_marker.
func TestWindowOptionsSetMarkerOnly(t *testing.T) {
	ops := &mockTmuxOps{}
	rec := postOptions(t, ops, "@2", `{"options":{"@rk_marker":"solid"}}`)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if len(ops.setWindowOptionsOps) != 1 {
		t.Fatalf("ops = %v, want exactly 1 (@rk_marker)", ops.setWindowOptionsOps)
	}
	op, ok := findOp(ops.setWindowOptionsOps, "@rk_marker")
	if !ok || op.Value == nil || *op.Value != "solid" {
		t.Errorf("@rk_marker op = %+v, want value \"solid\"", op)
	}
}

// @rk_marker empty string unsets (nil Value op), mirroring @rk_type — "" clears.
func TestWindowOptionsMarkerEmptyUnsets(t *testing.T) {
	ops := &mockTmuxOps{}
	rec := postOptions(t, ops, "@2", `{"options":{"@rk_marker":""}}`)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	op, ok := findOp(ops.setWindowOptionsOps, "@rk_marker")
	if !ok {
		t.Fatal("expected @rk_marker op")
	}
	if op.Value != nil {
		t.Errorf("@rk_marker value = %q, want nil (empty string unsets)", *op.Value)
	}
}

// Invalid @rk_marker → 400 and zero tmux calls (validate-all-then-execute).
func TestWindowOptionsMarkerInvalid(t *testing.T) {
	ops := &mockTmuxOps{}
	rec := postOptions(t, ops, "@0", `{"options":{"@rk_marker":"dashed"}}`)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
	if ops.setWindowOptionsCalled {
		t.Error("SetWindowOptions must NOT be called for invalid marker")
	}
}

// @rk_type empty string unsets (nil Value op); non-empty sets verbatim.
func TestWindowOptionsRkTypeEmptyUnsets(t *testing.T) {
	ops := &mockTmuxOps{}
	rec := postOptions(t, ops, "@2", `{"options":{"@rk_type":""}}`)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	op, ok := findOp(ops.setWindowOptionsOps, "@rk_type")
	if !ok {
		t.Fatal("expected @rk_type op")
	}
	if op.Value != nil {
		t.Errorf("@rk_type value = %q, want nil (empty string unsets)", *op.Value)
	}
}

func TestWindowOptionsRkTypeNullUnsets(t *testing.T) {
	ops := &mockTmuxOps{}
	rec := postOptions(t, ops, "@2", `{"options":{"@rk_type":null}}`)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	op, ok := findOp(ops.setWindowOptionsOps, "@rk_type")
	if !ok || op.Value != nil {
		t.Errorf("@rk_type op = %+v, want nil value (null unsets)", op)
	}
}

func TestWindowOptionsRkTypeSetVerbatim(t *testing.T) {
	ops := &mockTmuxOps{}
	rec := postOptions(t, ops, "@2", `{"options":{"@rk_type":"iframe"}}`)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	op, ok := findOp(ops.setWindowOptionsOps, "@rk_type")
	if !ok || op.Value == nil || *op.Value != "iframe" {
		t.Errorf("@rk_type op = %+v, want value \"iframe\"", op)
	}
}

func TestWindowOptionsInvalidWindowID(t *testing.T) {
	ops := &mockTmuxOps{}
	rec := postOptions(t, ops, "abc", `{"options":{"@color":"5"}}`)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
	if ops.setWindowOptionsCalled {
		t.Error("SetWindowOptions must NOT be called for invalid window ID")
	}
}

// --- /select re-route tests (POST /api/windows/{id}/select) ---
//
// The handler must resolve the owning session and issue SelectWindowInSession
// (scoped), never a bare SelectWindow.
func TestWindowSelectResolvesSession(t *testing.T) {
	ops := &mockTmuxOps{resolveWindowSessionResult: "real-session"}
	router := newTestRouter(&mockSessionFetcher{}, ops)

	req := httptest.NewRequest(http.MethodPost, "/api/windows/@2/select", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if ops.resolveWindowSessionID != "@2" {
		t.Errorf("ResolveWindowSession id = %q, want %q", ops.resolveWindowSessionID, "@2")
	}
	if !ops.selectWindowInSessionCalled {
		t.Fatal("SelectWindowInSession was not called")
	}
	if ops.selectWindowInSessionSession != "real-session" {
		t.Errorf("scoped session = %q, want %q", ops.selectWindowInSessionSession, "real-session")
	}
	if ops.selectWindowInSessionWindowID != "@2" {
		t.Errorf("scoped windowID = %q, want %q", ops.selectWindowInSessionWindowID, "@2")
	}
	if ops.selectWindowCalled {
		t.Error("bare SelectWindow must NOT be called")
	}
}

// A resolve failure (stale @N) surfaces a non-2xx error and issues no select.
func TestWindowSelectResolveFailure(t *testing.T) {
	ops := &mockTmuxOps{resolveWindowSessionErr: fmt.Errorf("window @99 not found")}
	router := newTestRouter(&mockSessionFetcher{}, ops)

	req := httptest.NewRequest(http.MethodPost, "/api/windows/@99/select", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code < 400 {
		t.Errorf("status = %d, want non-2xx", rec.Code)
	}
	if ops.selectWindowInSessionCalled {
		t.Error("SelectWindowInSession must NOT be called on resolve failure")
	}
	if ops.selectWindowCalled {
		t.Error("bare SelectWindow must NOT be called on resolve failure")
	}
}

func TestWindowSelectInvalidWindowID(t *testing.T) {
	ops := &mockTmuxOps{}
	router := newTestRouter(&mockSessionFetcher{}, ops)

	req := httptest.NewRequest(http.MethodPost, "/api/windows/abc/select", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
	if ops.selectWindowInSessionCalled || ops.selectWindowCalled {
		t.Error("no select must be issued for an invalid window ID")
	}
}

// --- decodeWindowID coverage ---
//
// decodeWindowID is exercised through the window handlers (it backs
// parseWindowID). %402 → @2 succeeds; a bare number and a non-@ id are rejected
// with 400 before any tmux call.
func TestDecodeWindowID(t *testing.T) {
	cases := []struct {
		name     string
		raw      string // raw path segment (already percent-encoded as a client would send)
		wantCode int
		wantID   string // expected windowID passed to tmux on success
	}{
		{"percent-encoded at", "%402", http.StatusOK, "@2"},
		{"bare number rejected", "2", http.StatusBadRequest, ""},
		{"non-window id rejected", "abc", http.StatusBadRequest, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ops := &mockTmuxOps{}
			router := newTestRouter(&mockSessionFetcher{}, ops)
			req := httptest.NewRequest(http.MethodPost, "/api/windows/"+tc.raw+"/kill", nil)
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, req)

			if rec.Code != tc.wantCode {
				t.Fatalf("status = %d, want %d", rec.Code, tc.wantCode)
			}
			if tc.wantCode == http.StatusOK {
				if ops.killWindowID != tc.wantID {
					t.Errorf("decoded windowID = %q, want %q", ops.killWindowID, tc.wantID)
				}
			} else if ops.killWindowCalled {
				t.Error("tmux KillWindow must NOT be called when decode/validate fails")
			}
		})
	}
}

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

// An omitted/empty window name is now valid on CREATE — it means "let tmux
// auto-name the window to its folder basename". The handler accepts it (201)
// and calls CreateWindow with an empty name (tmux.CreateWindow then omits the
// -n token). This is the spec change for 260707-j66b.
func TestWindowCreateEmptyNameAccepted(t *testing.T) {
	ops := &mockTmuxOps{}
	router := newTestRouter(&mockSessionFetcher{}, ops)

	body := `{"name":"","cwd":"~/code/run-kit"}`
	req := httptest.NewRequest(http.MethodPost, "/api/sessions/run-kit/windows", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Errorf("status = %d, want %d; body=%s", rec.Code, http.StatusCreated, rec.Body.String())
	}
	if !ops.createWindowCalled {
		t.Error("CreateWindow was not called")
	}
	if ops.createWindowName != "" {
		t.Errorf("name = %q, want empty string (tmux auto-names)", ops.createWindowName)
	}
}

// An omitted "name" key (body without name at all) is equally valid.
func TestWindowCreateOmittedNameAccepted(t *testing.T) {
	ops := &mockTmuxOps{}
	router := newTestRouter(&mockSessionFetcher{}, ops)

	body := `{"cwd":"~/code/run-kit"}`
	req := httptest.NewRequest(http.MethodPost, "/api/sessions/run-kit/windows", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Errorf("status = %d, want %d; body=%s", rec.Code, http.StatusCreated, rec.Body.String())
	}
	if !ops.createWindowCalled {
		t.Error("CreateWindow was not called")
	}
	if ops.createWindowName != "" {
		t.Errorf("name = %q, want empty string (tmux auto-names)", ops.createWindowName)
	}
}

// A NON-EMPTY name is still validated on CREATE — forbidden characters return
// 400 and issue no tmux call (only the empty case is relaxed).
func TestWindowCreateNonEmptyInvalidNameRejected(t *testing.T) {
	ops := &mockTmuxOps{}
	router := newTestRouter(&mockSessionFetcher{}, ops)

	body := `{"name":"bad;name"}`
	req := httptest.NewRequest(http.MethodPost, "/api/sessions/run-kit/windows", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
	if ops.createWindowCalled {
		t.Error("CreateWindow must NOT be called for an invalid non-empty name")
	}
}

func TestWindowCreateSpaceyNameRejected(t *testing.T) {
	// The tightened new-name rule (validate.ValidateNewName) applies to a
	// non-empty to-be-created window name.
	ops := &mockTmuxOps{}
	router := newTestRouter(&mockSessionFetcher{}, ops)

	body := `{"name":"my window"}`
	req := httptest.NewRequest(http.MethodPost, "/api/sessions/run-kit/windows", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
	if ops.createWindowCalled {
		t.Error("CreateWindow must NOT be called for a spacey name")
	}
}

func TestWindowKill(t *testing.T) {
	ops := &mockTmuxOps{}
	router := newTestRouter(&mockSessionFetcher{}, ops)

	req := httptest.NewRequest(http.MethodPost, "/api/windows/@1/kill", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusOK)
	}

	if !ops.killWindowCalled {
		t.Error("KillWindow was not called")
	}
	if ops.killWindowID != "@1" {
		t.Errorf("windowID = %q, want %q", ops.killWindowID, "@1")
	}
}

// Regression: clients URL-encode '@' as '%40' in path segments via
// encodeURIComponent. chi v5 preserves the encoded form in URLParam, so the
// handler must percent-decode before validating the window ID.
func TestWindowKillPercentEncodedAt(t *testing.T) {
	ops := &mockTmuxOps{}
	router := newTestRouter(&mockSessionFetcher{}, ops)

	req := httptest.NewRequest(http.MethodPost, "/api/windows/%4018/kill", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want %d (body: %s)", rec.Code, http.StatusOK, rec.Body.String())
	}
	if ops.killWindowID != "@18" {
		t.Errorf("windowID = %q, want %q", ops.killWindowID, "@18")
	}
}

func TestWindowKillInvalidWindowID(t *testing.T) {
	router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})

	req := httptest.NewRequest(http.MethodPost, "/api/windows/abc/kill", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}

	var result map[string]string
	if err := json.NewDecoder(rec.Body).Decode(&result); err != nil {
		t.Fatalf("decode error: %v", err)
	}
	if result["error"] != "Invalid window ID" {
		t.Errorf("error = %q, want %q", result["error"], "Invalid window ID")
	}
}

func TestWindowKillBareNumberRejected(t *testing.T) {
	router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})

	// A bare numeric segment (the old index form) is no longer a valid window ID.
	req := httptest.NewRequest(http.MethodPost, "/api/windows/1/kill", nil)
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
	req := httptest.NewRequest(http.MethodPost, "/api/windows/@1/rename", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusOK)
	}

	if !ops.renameWindowCalled {
		t.Error("RenameWindow was not called")
	}
	if ops.renameWindowWindowID != "@1" {
		t.Errorf("windowID = %q, want %q", ops.renameWindowWindowID, "@1")
	}
	if ops.renameWindowName != "new-name" {
		t.Errorf("name = %q, want %q", ops.renameWindowName, "new-name")
	}
}

func TestWindowRenameEmptyName(t *testing.T) {
	router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})

	body := `{"name":""}`
	req := httptest.NewRequest(http.MethodPost, "/api/windows/@0/rename", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
}

func TestWindowRenameSpaceyNameRejected(t *testing.T) {
	// The renamed-TO window name is held to the tightened rule.
	ops := &mockTmuxOps{}
	router := newTestRouter(&mockSessionFetcher{}, ops)

	body := `{"name":"my window"}`
	req := httptest.NewRequest(http.MethodPost, "/api/windows/@1/rename", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
	if ops.renameWindowCalled {
		t.Error("RenameWindow must NOT be called for a spacey name")
	}
}

func TestWindowKeys(t *testing.T) {
	ops := &mockTmuxOps{}
	router := newTestRouter(&mockSessionFetcher{}, ops)

	body := `{"keys":"echo hello"}`
	req := httptest.NewRequest(http.MethodPost, "/api/windows/@0/keys", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusOK)
	}

	if !ops.sendKeysCalled {
		t.Error("SendKeys was not called")
	}
	if ops.sendKeysWindowID != "@0" {
		t.Errorf("windowID = %q, want %q", ops.sendKeysWindowID, "@0")
	}
	if ops.sendKeysKeys != "echo hello" {
		t.Errorf("keys = %q, want %q", ops.sendKeysKeys, "echo hello")
	}
}

func TestWindowKeysEmpty(t *testing.T) {
	router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})

	body := `{"keys":"  "}`
	req := httptest.NewRequest(http.MethodPost, "/api/windows/@0/keys", strings.NewReader(body))
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
	req := httptest.NewRequest(http.MethodPost, "/api/windows/@0/split", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusOK)
	}

	if !ops.splitWindowCalled {
		t.Error("SplitWindow was not called")
	}
	if ops.splitWindowID != "@0" {
		t.Errorf("windowID = %q, want %q", ops.splitWindowID, "@0")
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

func TestWindowSplitInvalidWindowID(t *testing.T) {
	router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})

	body := `{"horizontal":false}`
	req := httptest.NewRequest(http.MethodPost, "/api/windows/bad;name/split", strings.NewReader(body))
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
	req := httptest.NewRequest(http.MethodPost, "/api/windows/@5/move", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusOK)
	}

	if !ops.swapWindowCalled {
		t.Error("MoveWindow was not called")
	}
	if ops.swapWindowID != "@5" {
		t.Errorf("windowID = %q, want %q", ops.swapWindowID, "@5")
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

	req := httptest.NewRequest(http.MethodPost, "/api/windows/@0/move", strings.NewReader("not json"))
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
	req := httptest.NewRequest(http.MethodPost, "/api/windows/@0/move", strings.NewReader(body))
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

func TestWindowMoveInvalidWindowID(t *testing.T) {
	router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})

	body := `{"targetIndex":2}`
	req := httptest.NewRequest(http.MethodPost, "/api/windows/abc/move", strings.NewReader(body))
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
	if result["error"] != "Invalid window ID" {
		t.Errorf("error = %q, want %q", result["error"], "Invalid window ID")
	}
}

func TestWindowMoveTmuxError(t *testing.T) {
	ops := &mockTmuxOps{swapWindowErr: fmt.Errorf("can't find window 5")}
	router := newTestRouter(&mockSessionFetcher{}, ops)

	body := `{"targetIndex":5}`
	req := httptest.NewRequest(http.MethodPost, "/api/windows/@0/move", strings.NewReader(body))
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
	req := httptest.NewRequest(http.MethodPost, "/api/windows/@0/move", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
}

func TestWindowSplitInvalidJSON(t *testing.T) {
	router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})

	req := httptest.NewRequest(http.MethodPost, "/api/windows/@0/split", strings.NewReader("not json"))
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
	req := httptest.NewRequest(http.MethodPost, "/api/windows/@1/move-to-session", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusOK)
	}

	if !ops.moveWindowToSessionCalled {
		t.Error("MoveWindowToSession was not called")
	}
	if ops.moveWindowToSessionWindowID != "@1" {
		t.Errorf("windowID = %q, want %q", ops.moveWindowToSessionWindowID, "@1")
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

func TestWindowMoveToSessionMissingTarget(t *testing.T) {
	router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})

	body := `{}`
	req := httptest.NewRequest(http.MethodPost, "/api/windows/@0/move-to-session", strings.NewReader(body))
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
	req := httptest.NewRequest(http.MethodPost, "/api/windows/@0/move-to-session", strings.NewReader(body))
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

func TestWindowMoveToSessionInvalidWindowID(t *testing.T) {
	router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})

	body := `{"targetSession":"bravo"}`
	req := httptest.NewRequest(http.MethodPost, "/api/windows/bad;session/move-to-session", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
}

func TestWindowMoveToSessionInvalidJSON(t *testing.T) {
	router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})

	req := httptest.NewRequest(http.MethodPost, "/api/windows/@0/move-to-session", strings.NewReader("not json"))
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
	req := httptest.NewRequest(http.MethodPost, "/api/windows/@99/move-to-session", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusInternalServerError)
	}
}

// --- Extended Window Creation tests ---

func TestWindowCreateWithIframeType(t *testing.T) {
	ops := &mockTmuxOps{}
	router := newTestRouter(&mockSessionFetcher{}, ops)

	body := `{"name":"docs","rkType":"iframe","rkUrl":"http://localhost:8080/docs"}`
	req := httptest.NewRequest(http.MethodPost, "/api/sessions/dev/windows", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusCreated)
	}

	if !ops.createWindowWithOptionsCalled {
		t.Error("CreateWindowWithOptions was not called")
	}
	if ops.createWindowWithOptionsSession != "dev" {
		t.Errorf("session = %q, want %q", ops.createWindowWithOptionsSession, "dev")
	}
	if ops.createWindowWithOptionsName != "docs" {
		t.Errorf("name = %q, want %q", ops.createWindowWithOptionsName, "docs")
	}
	typeOp, ok := findOp(ops.createWindowWithOptionsOps, "@rk_type")
	if !ok || typeOp.Value == nil || *typeOp.Value != "iframe" {
		t.Errorf("@rk_type op = %+v, want value \"iframe\"", typeOp)
	}
	urlOp, ok := findOp(ops.createWindowWithOptionsOps, "@rk_url")
	if !ok || urlOp.Value == nil || *urlOp.Value != "http://localhost:8080/docs" {
		t.Errorf("@rk_url op = %+v, want value \"http://localhost:8080/docs\"", urlOp)
	}
}

// The rkType (typed-window) create path pins an explicit name — CreateWindowWithOptions
// runs `new-window -n <name>` with automatic-rename disabled, so an empty name would
// strand the window on an empty name. Unlike the plain terminal create (which omits -n
// and lets tmux auto-name), a name is REQUIRED here: an empty/omitted name returns 400
// and CreateWindowWithOptions is never called. This is the R10 hardening for 260707-j66b.
func TestWindowCreateIframeEmptyNameRejected(t *testing.T) {
	ops := &mockTmuxOps{}
	router := newTestRouter(&mockSessionFetcher{}, ops)

	body := `{"name":"","rkType":"iframe","rkUrl":"http://localhost:8080/docs"}`
	req := httptest.NewRequest(http.MethodPost, "/api/sessions/dev/windows", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d; body=%s", rec.Code, http.StatusBadRequest, rec.Body.String())
	}
	if ops.createWindowWithOptionsCalled {
		t.Error("CreateWindowWithOptions must NOT be called for a typed window with an empty name")
	}
}

// An omitted "name" key on the rkType path is equally rejected (400).
func TestWindowCreateIframeOmittedNameRejected(t *testing.T) {
	ops := &mockTmuxOps{}
	router := newTestRouter(&mockSessionFetcher{}, ops)

	body := `{"rkType":"iframe","rkUrl":"http://localhost:8080/docs"}`
	req := httptest.NewRequest(http.MethodPost, "/api/sessions/dev/windows", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d; body=%s", rec.Code, http.StatusBadRequest, rec.Body.String())
	}
	if ops.createWindowWithOptionsCalled {
		t.Error("CreateWindowWithOptions must NOT be called for a typed window with an omitted name")
	}
}

func TestWindowCreateWithoutRkTypeUsesStandardCreate(t *testing.T) {
	ops := &mockTmuxOps{}
	router := newTestRouter(&mockSessionFetcher{}, ops)

	body := `{"name":"terminal","cwd":"~/code"}`
	req := httptest.NewRequest(http.MethodPost, "/api/sessions/dev/windows", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusCreated)
	}

	if ops.createWindowWithOptionsCalled {
		t.Error("CreateWindowWithOptions should NOT be called for terminal windows")
	}
	if !ops.createWindowCalled {
		t.Error("CreateWindow was not called")
	}
}

// TestWindowOptions_POST_wakesHub verifies the handleWindowOptions wake seam: a
// successful /options POST wakes the request's server so the poll loop runs a
// fresh pass promptly (the fix for the 5–10s @color/@rk_url/@rk_type latency),
// while a rejected (unknown-key) POST does not wake. Shares newWakeSeamServer /
// expectWake / expectNoWake with the session-color seam test in sessions_test.go.
func TestWindowOptions_POST_wakesHub(t *testing.T) {
	t.Run("successful set wakes", func(t *testing.T) {
		server, tracker := newWakeSeamServer(t, &mockTmuxOps{})
		before := tracker.count.Load()
		router := server.buildRouter()
		req := httptest.NewRequest(http.MethodPost, "/api/windows/@2/options?server=default", strings.NewReader(`{"options":{"@color":"5"}}`))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("POST status = %d, want 200; body=%s", rec.Code, rec.Body.String())
		}
		expectWake(t, tracker, before, "window options set")
	})

	t.Run("successful marker set wakes", func(t *testing.T) {
		server, tracker := newWakeSeamServer(t, &mockTmuxOps{})
		before := tracker.count.Load()
		router := server.buildRouter()
		req := httptest.NewRequest(http.MethodPost, "/api/windows/@2/options?server=default", strings.NewReader(`{"options":{"@rk_marker":"double"}}`))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("POST status = %d, want 200; body=%s", rec.Code, rec.Body.String())
		}
		expectWake(t, tracker, before, "window marker set")
	})

	t.Run("rejected key does not wake", func(t *testing.T) {
		server, tracker := newWakeSeamServer(t, &mockTmuxOps{})
		before := tracker.count.Load()
		router := server.buildRouter()
		req := httptest.NewRequest(http.MethodPost, "/api/windows/@2/options?server=default", strings.NewReader(`{"options":{"@bogus":"x"}}`))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("POST status = %d, want 400; body=%s", rec.Code, rec.Body.String())
		}
		expectNoWake(t, tracker, before, "window options rejected")
	})
}
