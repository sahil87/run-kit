package api

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
)

func newRestartServer(version string) *Server {
	return &Server{logger: slog.Default(), version: version}
}

func postRestart(t *testing.T, s *Server) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/restart", nil)
	s.handleRestart(rec, req)
	return rec
}

// TestHandleRestartAcceptedSpawns verifies R3: a non-dev restart returns
// 202 {"status":"restarting"} and spawns `rk daemon restart` via the shared
// seam, recorded as ("restart.log", "daemon", "restart"). No brew requirement —
// a plain (non-Cellar) self path still restarts.
func TestHandleRestartAcceptedSpawns(t *testing.T) {
	var rec spawnRecord
	withSeams(t, "/usr/local/bin/run-kit", nil, recordingSpawn(&rec))
	s := newRestartServer("0.5.3")

	res := postRestart(t, s)

	if res.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want 202 (body=%s)", res.Code, res.Body.String())
	}
	var body map[string]string
	if err := json.Unmarshal(res.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if body["status"] != "restarting" {
		t.Errorf("body status = %q, want restarting", body["status"])
	}
	if !rec.called {
		t.Fatalf("expected a spawn")
	}
	if rec.logName != "restart.log" {
		t.Errorf("spawn logName = %q, want restart.log", rec.logName)
	}
	if len(rec.args) != 2 || rec.args[0] != "daemon" || rec.args[1] != "restart" {
		t.Errorf("spawn args = %v, want [daemon restart]", rec.args)
	}
	if rec.selfArg != "/usr/local/bin/run-kit" {
		t.Errorf("spawn self path = %q, want the resolved self path", rec.selfArg)
	}
}

// TestHandleRestartDevReturns409 verifies R4: the "dev" version is refused with
// 409 and does NOT spawn (a dev serve process must not bounce the real daemon).
func TestHandleRestartDevReturns409(t *testing.T) {
	var rec spawnRecord
	withSeams(t, "/usr/local/bin/run-kit", nil, recordingSpawn(&rec))
	s := newRestartServer("dev")

	res := postRestart(t, s)

	if res.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409 for the dev version (body=%s)", res.Code, res.Body.String())
	}
	if rec.called {
		t.Errorf("must not spawn rk daemon restart on the dev version")
	}
}

// TestHandleRestartSpawnFailureKeeps202 verifies R3 (edge): a spawn error AFTER
// the 202 is committed does not alter the already-written response.
func TestHandleRestartSpawnFailureKeeps202(t *testing.T) {
	withSeams(t, "/usr/local/bin/run-kit", nil, func(selfPath, logName string, args ...string) error {
		return errors.New("boom")
	})
	s := newRestartServer("0.5.3")

	res := postRestart(t, s)

	if res.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want 202 even when the spawn fails after commit (body=%s)", res.Code, res.Body.String())
	}
	var body map[string]string
	if err := json.Unmarshal(res.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if body["status"] != "restarting" {
		t.Errorf("body status = %q, want restarting", body["status"])
	}
}
