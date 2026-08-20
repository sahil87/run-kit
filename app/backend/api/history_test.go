package api

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func getHistory(t *testing.T, ops *mockTmuxOps, windowID string) *httptest.ResponseRecorder {
	t.Helper()
	router := newTestRouter(&mockSessionFetcher{}, ops)
	req := httptest.NewRequest(http.MethodGet, "/api/windows/"+windowID+"/history?server=rk", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

// Success: the capture body passes through verbatim as text/plain, and the
// window id reaches the capture as the target (window target → active pane).
func TestWindowHistorySuccess(t *testing.T) {
	ops := &mockTmuxOps{captureWindowHistoryResult: "line one\nline two\n"}
	rec := getHistory(t, ops, "@5")

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct != "text/plain; charset=utf-8" {
		t.Errorf("Content-Type = %q, want %q", ct, "text/plain; charset=utf-8")
	}
	if body := rec.Body.String(); body != "line one\nline two\n" {
		t.Errorf("body = %q, want capture passthrough", body)
	}
	if ops.captureWindowHistoryTarget != "@5" {
		t.Errorf("capture target = %q, want %q", ops.captureWindowHistoryTarget, "@5")
	}
}

// Malformed window id → 400, capture never runs.
func TestWindowHistoryInvalidID(t *testing.T) {
	ops := &mockTmuxOps{}
	rec := getHistory(t, ops, "bogus!!")

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
	if ops.captureWindowHistoryTarget != "" {
		t.Errorf("capture ran for an invalid id (target %q)", ops.captureWindowHistoryTarget)
	}
}

// A tmux failure (dead/unreachable server) surfaces as 500 with the error.
func TestWindowHistoryCaptureError(t *testing.T) {
	ops := &mockTmuxOps{captureWindowHistoryErr: errors.New("no server running on /tmp/tmux-1000/dead")}
	rec := getHistory(t, ops, "@5")

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusInternalServerError)
	}
	if body := rec.Body.String(); body == "" {
		t.Error("expected the tmux error in the response body")
	}
}
