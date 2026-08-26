package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// TestHandleTmuxReloadConfig pins the managed-only gate: an external target is
// a 200 skipped report (never an error), a managed-check read failure also
// reports skipped (this path must not 5xx on a tmux read wobble), and a
// managed target behaves exactly as before (reload → ok; reload failure → 500).
func TestHandleTmuxReloadConfig(t *testing.T) {
	stub := func(t *testing.T, managed bool, managedErr, reloadErr error) *[]string {
		t.Helper()
		reloaded := &[]string{}
		origManaged, origReload := reloadIsManaged, reloadConfigFn
		reloadIsManaged = func(context.Context, string) (bool, error) { return managed, managedErr }
		reloadConfigFn = func(server string) error {
			*reloaded = append(*reloaded, server)
			return reloadErr
		}
		t.Cleanup(func() { reloadIsManaged, reloadConfigFn = origManaged, origReload })
		return reloaded
	}

	call := func(t *testing.T) (*httptest.ResponseRecorder, map[string]string) {
		t.Helper()
		s := &Server{}
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/tmux/reload-config?server=srv", nil)
		s.handleTmuxReloadConfig(rec, req)
		var body map[string]string
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatalf("response not JSON: %v — body %q", err, rec.Body.String())
		}
		return rec, body
	}

	t.Run("external target reports skipped, never reloads", func(t *testing.T) {
		reloaded := stub(t, false, nil, nil)
		rec, body := call(t)
		if rec.Code != http.StatusOK {
			t.Errorf("status = %d, want 200 — an external skip is a report, not an error", rec.Code)
		}
		if body["status"] != "skipped" || body["reason"] != "external" {
			t.Errorf("body = %v, want {status:skipped reason:external}", body)
		}
		if len(*reloaded) != 0 {
			t.Errorf("reloaded = %v, want none — an external server must never receive rk's conf", *reloaded)
		}
	})

	t.Run("managed-check read failure reports skipped, never 5xx", func(t *testing.T) {
		reloaded := stub(t, false, fmt.Errorf("tmux read wobble"), nil)
		rec, body := call(t)
		if rec.Code != http.StatusOK {
			t.Errorf("status = %d, want 200 — a read wobble must not 5xx", rec.Code)
		}
		if body["status"] != "skipped" || body["reason"] != "external" {
			t.Errorf("body = %v, want {status:skipped reason:external}", body)
		}
		if len(*reloaded) != 0 {
			t.Errorf("reloaded = %v, want none", *reloaded)
		}
	})

	t.Run("managed target reloads as before", func(t *testing.T) {
		reloaded := stub(t, true, nil, nil)
		rec, body := call(t)
		if rec.Code != http.StatusOK || body["status"] != "ok" {
			t.Errorf("status = %d body = %v, want 200 {status:ok}", rec.Code, body)
		}
		if strings.Join(*reloaded, ",") != "srv" {
			t.Errorf("reloaded = %v, want [srv]", *reloaded)
		}
	})

	t.Run("managed target reload failure is still 500", func(t *testing.T) {
		reloaded := stub(t, true, nil, fmt.Errorf("boom"))
		rec, body := call(t)
		if rec.Code != http.StatusInternalServerError {
			t.Errorf("status = %d, want 500 — a managed reload failure is an error", rec.Code)
		}
		if body["error"] == "" {
			t.Errorf("body = %v, want an error field", body)
		}
		if strings.Join(*reloaded, ",") != "srv" {
			t.Errorf("reloaded = %v, want [srv] — the reload was attempted", *reloaded)
		}
	})
}
