package api

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"rk/internal/daemon"
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

// TestHandleRestartAcceptedSpawns verifies a non-dev restart returns
// 202 {"status":"restarting","watch":{…}} and runs `rk daemon restart` in the
// `restart` job window via the shared runJobFn seam (260812-z1ya). No brew
// requirement — a plain (non-Cellar) self path still restarts.
func TestHandleRestartAcceptedSpawns(t *testing.T) {
	var rec jobRecord
	withSeams(t, "/usr/local/bin/run-kit", nil, "", errNoShll, recordingJob(&rec))
	s := newRestartServer("0.5.3")

	res := postRestart(t, s)

	if res.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want 202 (body=%s)", res.Code, res.Body.String())
	}
	assertJobBody(t, res, "restarting", "restart")
	if !rec.called {
		t.Fatalf("expected a job spawn")
	}
	if rec.window != "restart" {
		t.Errorf("job window = %q, want restart", rec.window)
	}
	want := []string{"/usr/local/bin/run-kit", "daemon", "restart"}
	if strings.Join(rec.argv, " ") != strings.Join(want, " ") {
		t.Errorf("job argv = %v, want %v", rec.argv, want)
	}
}

// TestHandleRestartDevReturns409 verifies the "dev" version is refused with
// 409 and does NOT spawn (a dev serve process must not bounce the real daemon).
func TestHandleRestartDevReturns409(t *testing.T) {
	var rec jobRecord
	withSeams(t, "/usr/local/bin/run-kit", nil, "", errNoShll, recordingJob(&rec))
	s := newRestartServer("dev")

	res := postRestart(t, s)

	if res.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409 for the dev version (body=%s)", res.Code, res.Body.String())
	}
	if rec.called {
		t.Errorf("must not spawn rk daemon restart on the dev version")
	}
}

// TestHandleRestartDaemonDown409 verifies the daemon gate: with the rk-daemon
// tmux server down, restart refuses 409 (the managed job window is the only
// spawn mechanism — intake decision 1, no detached-spawn fallback).
func TestHandleRestartDaemonDown409(t *testing.T) {
	var rec jobRecord
	withSeams(t, "/usr/local/bin/run-kit", nil, "", errNoShll, recordingJob(&rec))
	daemonRunningFn = func() bool { return false }
	s := newRestartServer("0.5.3")

	res := postRestart(t, s)

	if res.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409 when the daemon is not running (body=%s)", res.Code, res.Body.String())
	}
	if !strings.Contains(res.Body.String(), "rk serve -d") {
		t.Errorf("error body = %q, want it to name the fix (rk serve -d)", res.Body.String())
	}
	if rec.called {
		t.Error("must not spawn the restart job when the daemon is not running")
	}
}

// TestHandleRestartAlreadyRunning200 verifies the in-flight contract: with a
// live restart window (RunJob reports started=false) the handler answers 200
// already-running with the existing window's target instead of respawning.
func TestHandleRestartAlreadyRunning200(t *testing.T) {
	withSeams(t, "/usr/local/bin/run-kit", nil, "", errNoShll,
		func(_ context.Context, window string, _ []string) (daemon.JobTarget, bool, error) {
			return daemon.JobTarget{Server: "rk-daemon", Session: "rk-jobs", Window: window, WindowID: "@5"}, false, nil
		})
	s := newRestartServer("0.5.3")

	res := postRestart(t, s)

	if res.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 already-running (body=%s)", res.Code, res.Body.String())
	}
	assertJobBody(t, res, "already-running", "restart")
}

// TestHandleRestartSpawnError502 verifies spawn-before-respond: a RunJob
// failure is a reportable 502 (the window survives the daemon restart, so the
// response is no longer committed before the spawn).
func TestHandleRestartSpawnError502(t *testing.T) {
	withSeams(t, "/usr/local/bin/run-kit", nil, "", errNoShll,
		func(context.Context, string, []string) (daemon.JobTarget, bool, error) {
			return daemon.JobTarget{}, false, errors.New("boom")
		})
	s := newRestartServer("0.5.3")

	res := postRestart(t, s)

	if res.Code != http.StatusBadGateway {
		t.Fatalf("status = %d, want 502 on a spawn error (body=%s)", res.Code, res.Body.String())
	}
	if !strings.Contains(res.Body.String(), "boom") {
		t.Errorf("error body = %q, want the spawn failure reason", res.Body.String())
	}
}
