package api

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
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

// spawnRecord captures a recorded spawn (logName + args) from the generalized
// spawnSelfFn seam, so tests can assert BOTH the log name and the argv without
// launching a real child.
type spawnRecord struct {
	called  bool
	selfArg string
	logName string
	args    []string
}

// withSeams swaps the update/restart handlers' package-var seams for the
// duration of a test and restores them afterward. The spawn seam is generalized
// (spawnSelfFn): the caller-provided fn receives (selfPath, logName, args...).
func withSeams(t *testing.T, selfPath string, resolveErr error, spawn func(selfPath, logName string, args ...string) error) {
	t.Helper()
	origResolve, origSpawn := resolveSelfPathFn, spawnSelfFn
	resolveSelfPathFn = func() (string, error) { return selfPath, resolveErr }
	spawnSelfFn = spawn
	t.Cleanup(func() {
		resolveSelfPathFn = origResolve
		spawnSelfFn = origSpawn
	})
}

// recordingSpawn returns a spawn fn that records its call into rec and succeeds.
func recordingSpawn(rec *spawnRecord) func(selfPath, logName string, args ...string) error {
	return func(selfPath, logName string, args ...string) error {
		rec.called = true
		rec.selfArg = selfPath
		rec.logName = logName
		rec.args = args
		return nil
	}
}

func newUpdateServer(checker *updatecheck.Checker) *Server {
	return &Server{logger: slog.Default(), updateChecker: checker}
}

// postUpdate issues a POST /api/update with the given raw body (nil = no body).
func postUpdate(t *testing.T, s *Server, body string) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	var req *http.Request
	if body == "" {
		req = httptest.NewRequest(http.MethodPost, "/api/update", nil)
	} else {
		req = httptest.NewRequest(http.MethodPost, "/api/update", strings.NewReader(body))
	}
	s.handleUpdate(rec, req)
	return rec
}

func TestHandleUpdateAcceptedSpawns(t *testing.T) {
	var rec spawnRecord
	withSeams(t, "/opt/homebrew/Cellar/run-kit/0.5.3/bin/run-kit", nil, recordingSpawn(&rec))
	s := newUpdateServer(qualifyingChecker(t))

	res := postUpdate(t, s, "")

	if res.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want 202 (body=%s)", res.Code, res.Body.String())
	}
	var body map[string]string
	if err := json.Unmarshal(res.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if body["status"] != "updating" {
		t.Errorf("body status = %q, want updating", body["status"])
	}
	if rec.selfArg != "/opt/homebrew/Cellar/run-kit/0.5.3/bin/run-kit" {
		t.Errorf("spawn self path = %q, want the resolved Cellar path", rec.selfArg)
	}
	if rec.logName != "update.log" {
		t.Errorf("spawn logName = %q, want update.log", rec.logName)
	}
	if len(rec.args) != 1 || rec.args[0] != "update" {
		t.Errorf("spawn args = %v, want [update]", rec.args)
	}
}

func TestHandleUpdateNotBrewInstalled(t *testing.T) {
	var rec spawnRecord
	withSeams(t, "/usr/local/bin/run-kit", nil, recordingSpawn(&rec))
	s := newUpdateServer(qualifyingChecker(t))

	res := postUpdate(t, s, "")

	if res.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409 for non-brew install (body=%s)", res.Code, res.Body.String())
	}
	if rec.called {
		t.Errorf("must not spawn rk update when not brew-installed")
	}
}

func TestHandleUpdateNoUpdateAvailable(t *testing.T) {
	var rec spawnRecord
	withSeams(t, "/opt/homebrew/Cellar/run-kit/0.5.3/bin/run-kit", nil, recordingSpawn(&rec))
	// A checker with no qualifying update (never checked / same version).
	c := updatecheck.New("0.5.3")
	s := newUpdateServer(c)

	res := postUpdate(t, s, "")

	if res.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409 when no update pending (body=%s)", res.Code, res.Body.String())
	}
	if rec.called {
		t.Errorf("must not spawn rk update when no update is pending")
	}
}

func TestHandleUpdateNilCheckerNoUpdate(t *testing.T) {
	withSeams(t, "/opt/homebrew/Cellar/run-kit/0.5.3/bin/run-kit", nil, func(selfPath, logName string, args ...string) error {
		t.Fatalf("must not spawn with a nil checker")
		return nil
	})
	s := newUpdateServer(nil)

	res := postUpdate(t, s, "")

	if res.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409 with a nil checker", res.Code)
	}
}

// TestHandleUpdateSecondClickAccepted verifies R8: a second POST while qualifying
// is accepted again (no in-flight lock).
func TestHandleUpdateSecondClickAccepted(t *testing.T) {
	spawns := 0
	withSeams(t, "/opt/homebrew/Cellar/run-kit/0.5.3/bin/run-kit", nil, func(selfPath, logName string, args ...string) error {
		spawns++
		return nil
	})
	s := newUpdateServer(qualifyingChecker(t))

	for i := 0; i < 2; i++ {
		res := postUpdate(t, s, "")
		if res.Code != http.StatusAccepted {
			t.Fatalf("click %d: status = %d, want 202", i+1, res.Code)
		}
	}
	if spawns != 2 {
		t.Errorf("expected 2 spawns across 2 clicks (no lock), got %d", spawns)
	}
}

// TestHandleUpdateForceSkipsQualifyKeepsBrew verifies R1/R2: force=true skips the
// qualify 409 (no pending update) but still spawns for a brew install.
func TestHandleUpdateForceSkipsQualifyKeepsBrew(t *testing.T) {
	var rec spawnRecord
	withSeams(t, "/opt/homebrew/Cellar/run-kit/0.5.3/bin/run-kit", nil, recordingSpawn(&rec))
	// A checker with NO qualifying update — force must bypass the qualify 409.
	s := newUpdateServer(updatecheck.New("0.5.3"))

	res := postUpdate(t, s, `{"force":true}`)

	if res.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want 202 on force even without a qualifying update (body=%s)", res.Code, res.Body.String())
	}
	if !rec.called {
		t.Errorf("force=true must spawn rk update even without a qualifying update")
	}
	if rec.logName != "update.log" || len(rec.args) != 1 || rec.args[0] != "update" {
		t.Errorf("force spawn = (%q, %v), want (update.log, [update])", rec.logName, rec.args)
	}
}

// TestHandleUpdateForceNilChecker verifies force=true bypasses the nil-checker
// 409 too (the qualify branch is fully gated behind !force).
func TestHandleUpdateForceNilChecker(t *testing.T) {
	var rec spawnRecord
	withSeams(t, "/opt/homebrew/Cellar/run-kit/0.5.3/bin/run-kit", nil, recordingSpawn(&rec))
	s := newUpdateServer(nil)

	res := postUpdate(t, s, `{"force":true}`)

	if res.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want 202 on force with a nil checker (body=%s)", res.Code, res.Body.String())
	}
	if !rec.called {
		t.Errorf("force=true must spawn even with a nil checker")
	}
}

// TestHandleUpdateForceKeepsBrew409 verifies R2: force does NOT bypass the brew
// 409 — a non-brew install is still refused, force flag notwithstanding.
func TestHandleUpdateForceKeepsBrew409(t *testing.T) {
	var rec spawnRecord
	withSeams(t, "/usr/local/bin/run-kit", nil, recordingSpawn(&rec))
	s := newUpdateServer(nil)

	res := postUpdate(t, s, `{"force":true}`)

	if res.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409 — force must NOT bypass the brew requirement (body=%s)", res.Code, res.Body.String())
	}
	if rec.called {
		t.Errorf("must not spawn on a non-brew install even with force=true")
	}
}

// TestHandleUpdateBodyVariantsPreserveNonForce verifies R1: an explicit
// force=false, an empty {} body, and an absent body all take the non-force path
// (byte-preserving today's 409 when no update qualifies).
func TestHandleUpdateBodyVariantsPreserveNonForce(t *testing.T) {
	for name, body := range map[string]string{
		"force-false": `{"force":false}`,
		"empty-obj":   `{}`,
		"absent":      "",
	} {
		t.Run(name, func(t *testing.T) {
			var rec spawnRecord
			withSeams(t, "/opt/homebrew/Cellar/run-kit/0.5.3/bin/run-kit", nil, recordingSpawn(&rec))
			s := newUpdateServer(updatecheck.New("0.5.3")) // no qualifying update

			res := postUpdate(t, s, body)

			if res.Code != http.StatusConflict {
				t.Fatalf("status = %d, want 409 (non-force path, no update) for body %q", res.Code, body)
			}
			if rec.called {
				t.Errorf("must not spawn on the non-force path when no update is pending (body %q)", body)
			}
		})
	}
}
