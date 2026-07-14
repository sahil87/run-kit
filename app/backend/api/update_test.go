package api

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"rk/internal/updatecheck"
)

// qualifyingChecker returns a checker whose cached snapshot reports a pending
// qualifying update (0.5.3 → 0.6.0) without running any real fetch.
func qualifyingChecker(t *testing.T) *updatecheck.Checker {
	t.Helper()
	c := updatecheck.New("0.5.3")
	// Stub the fetch to a qualifying release, then run one synchronous check so
	// Snapshot().Qualifies is true.
	c.SetFetchForTest(func() (string, error) { return "v0.6.0", nil })
	c.CheckOnceForTest()
	if !c.Snapshot().Qualifies {
		t.Fatalf("test setup: checker snapshot should qualify, got %+v", c.Snapshot())
	}
	return c
}

// withSeams swaps the update handler's package-var seams for the duration of a
// test and restores them afterward.
func withSeams(t *testing.T, selfPath string, resolveErr error, spawn func(string) error) {
	t.Helper()
	origResolve, origSpawn := resolveSelfPathFn, spawnUpdateFn
	resolveSelfPathFn = func() (string, error) { return selfPath, resolveErr }
	spawnUpdateFn = spawn
	t.Cleanup(func() {
		resolveSelfPathFn = origResolve
		spawnUpdateFn = origSpawn
	})
}

func newUpdateServer(checker *updatecheck.Checker) *Server {
	return &Server{logger: slog.Default(), updateChecker: checker}
}

func TestHandleUpdateAcceptedSpawns(t *testing.T) {
	spawned := ""
	withSeams(t, "/opt/homebrew/Cellar/run-kit/0.5.3/bin/run-kit", nil, func(self string) error {
		spawned = self
		return nil
	})
	s := newUpdateServer(qualifyingChecker(t))

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/update", nil)
	s.handleUpdate(rec, req)

	if rec.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want 202 (body=%s)", rec.Code, rec.Body.String())
	}
	var body map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if body["status"] != "updating" {
		t.Errorf("body status = %q, want updating", body["status"])
	}
	if spawned != "/opt/homebrew/Cellar/run-kit/0.5.3/bin/run-kit" {
		t.Errorf("spawn self path = %q, want the resolved Cellar path", spawned)
	}
}

func TestHandleUpdateNotBrewInstalled(t *testing.T) {
	spawnCalled := false
	withSeams(t, "/usr/local/bin/run-kit", nil, func(self string) error {
		spawnCalled = true
		return nil
	})
	s := newUpdateServer(qualifyingChecker(t))

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/update", nil)
	s.handleUpdate(rec, req)

	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409 for non-brew install (body=%s)", rec.Code, rec.Body.String())
	}
	if spawnCalled {
		t.Errorf("must not spawn rk update when not brew-installed")
	}
}

func TestHandleUpdateNoUpdateAvailable(t *testing.T) {
	spawnCalled := false
	withSeams(t, "/opt/homebrew/Cellar/run-kit/0.5.3/bin/run-kit", nil, func(self string) error {
		spawnCalled = true
		return nil
	})
	// A checker with no qualifying update (never checked / same version).
	c := updatecheck.New("0.5.3")
	s := newUpdateServer(c)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/update", nil)
	s.handleUpdate(rec, req)

	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409 when no update pending (body=%s)", rec.Code, rec.Body.String())
	}
	if spawnCalled {
		t.Errorf("must not spawn rk update when no update is pending")
	}
}

func TestHandleUpdateNilCheckerNoUpdate(t *testing.T) {
	withSeams(t, "/opt/homebrew/Cellar/run-kit/0.5.3/bin/run-kit", nil, func(self string) error {
		t.Fatalf("must not spawn with a nil checker")
		return nil
	})
	s := newUpdateServer(nil)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/update", nil)
	s.handleUpdate(rec, req)

	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409 with a nil checker", rec.Code)
	}
}

// TestHandleUpdateSecondClickAccepted verifies R8: a second POST while qualifying
// is accepted again (no in-flight lock).
func TestHandleUpdateSecondClickAccepted(t *testing.T) {
	spawns := 0
	withSeams(t, "/opt/homebrew/Cellar/run-kit/0.5.3/bin/run-kit", nil, func(self string) error {
		spawns++
		return nil
	})
	s := newUpdateServer(qualifyingChecker(t))

	for i := 0; i < 2; i++ {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/update", nil)
		s.handleUpdate(rec, req)
		if rec.Code != http.StatusAccepted {
			t.Fatalf("click %d: status = %d, want 202", i+1, rec.Code)
		}
	}
	if spawns != 2 {
		t.Errorf("expected 2 spawns across 2 clicks (no lock), got %d", spawns)
	}
}
