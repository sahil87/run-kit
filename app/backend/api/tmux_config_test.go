package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"rk/internal/tmux"
)

// TestHandleTmuxReloadConfig pins the managed-only gate: an external target is
// a 200 skipped report (never an error), a managed-check read failure also
// reports skipped (this path must not 5xx on a tmux read wobble), and a
// managed target behaves exactly as before (reload → ok; reload failure → 500).
func TestHandleTmuxReloadConfig(t *testing.T) {
	stub := func(t *testing.T, managed bool, managedErr, reloadErr error) *[]string {
		t.Helper()
		reloaded := &[]string{}
		origManaged, origReload, origMigrate := reloadIsManaged, reloadConfigFn, reloadMigrateLegacy
		reloadIsManaged = func(context.Context, string) (bool, error) { return managed, managedErr }
		reloadConfigFn = func(server string) error {
			*reloaded = append(*reloaded, server)
			return reloadErr
		}
		reloadMigrateLegacy = func(context.Context, string) (bool, error) { return false, nil }
		tmux.ResetLegacyMigrationForTest()
		t.Cleanup(func() {
			reloadIsManaged, reloadConfigFn, reloadMigrateLegacy = origManaged, origReload, origMigrate
			tmux.ResetLegacyMigrationForTest()
		})
		return reloaded
	}

	call := func(t *testing.T, server string) (*httptest.ResponseRecorder, map[string]string) {
		t.Helper()
		s := &Server{}
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/tmux/reload-config?server="+server, nil)
		s.handleTmuxReloadConfig(rec, req)
		var body map[string]string
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatalf("response not JSON: %v — body %q", err, rec.Body.String())
		}
		return rec, body
	}

	t.Run("external target reports skipped, never reloads", func(t *testing.T) {
		reloaded := stub(t, false, nil, nil)
		rec, body := call(t, "srv")
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
		rec, body := call(t, "srv")
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

	// Every managed-path subtest uses its own server name: the once-guarded
	// sweep runs in a goroutine after the response, so a shared name would let
	// one subtest's in-flight sweep fire into the next subtest's fresh stub.
	t.Run("managed target reloads as before", func(t *testing.T) {
		reloaded := stub(t, true, nil, nil)
		rec, body := call(t, "reload-ok")
		if rec.Code != http.StatusOK || body["status"] != "ok" {
			t.Errorf("status = %d body = %v, want 200 {status:ok}", rec.Code, body)
		}
		if strings.Join(*reloaded, ",") != "reload-ok" {
			t.Errorf("reloaded = %v, want [reload-ok]", *reloaded)
		}
	})

	t.Run("managed target reload failure is still 500", func(t *testing.T) {
		reloaded := stub(t, true, nil, fmt.Errorf("boom"))
		rec, body := call(t, "reload-fail")
		if rec.Code != http.StatusInternalServerError {
			t.Errorf("status = %d, want 500 — a managed reload failure is an error", rec.Code)
		}
		if body["error"] == "" {
			t.Errorf("body = %v, want an error field", body)
		}
		if strings.Join(*reloaded, ",") != "reload-fail" {
			t.Errorf("reloaded = %v, want [reload-fail] — the reload was attempted", *reloaded)
		}
	})

	// The two sweep subtests use their own server names for the same reason.
	t.Run("legacy sweep rides the managed gate, off the request path", func(t *testing.T) {
		stub(t, true, nil, nil)
		swept := make(chan string, 1)
		origMigrate := reloadMigrateLegacy
		reloadMigrateLegacy = func(_ context.Context, server string) (bool, error) {
			// Ignore leaked sends from earlier subtests' in-flight sweep
			// goroutines — only this subtest's own name counts.
			if server == "sweep-managed" {
				swept <- server
			}
			return false, nil
		}
		t.Cleanup(func() { reloadMigrateLegacy = origMigrate })

		rec, body := call(t, "sweep-managed")
		if rec.Code != http.StatusOK || body["status"] != "ok" {
			t.Errorf("status = %d body = %v, want 200 {status:ok}", rec.Code, body)
		}
		select {
		case got := <-swept:
			if got != "sweep-managed" {
				t.Errorf("swept = %q, want sweep-managed", got)
			}
		case <-time.After(2 * time.Second):
			t.Error("sweep never ran — the async sweep must fire for a managed server")
		}
	})

	t.Run("external target is never swept", func(t *testing.T) {
		stub(t, false, nil, nil)
		swept := make(chan string, 1)
		origMigrate := reloadMigrateLegacy
		reloadMigrateLegacy = func(_ context.Context, server string) (bool, error) {
			if server == "sweep-external" {
				swept <- server
			}
			return false, nil
		}
		t.Cleanup(func() { reloadMigrateLegacy = origMigrate })

		call(t, "sweep-external")
		select {
		case got := <-swept:
			t.Errorf("swept %q — an external server must never be swept", got)
		case <-time.After(100 * time.Millisecond):
		}
	})
}
