package api

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"rk/internal/updatecheck"
)

// qualifyingChecker returns a checker whose cached snapshot reports a pending
// qualifying update for run-kit (3.8.0 → 3.9.0) without a real `shll
// check-updates` exec: the check seam is stubbed with a run-kit-only report
// (deterministic argv for the remediation tests).
func qualifyingChecker(t *testing.T) *updatecheck.Checker {
	t.Helper()
	c := updatecheck.New("3.8.0", true)
	c.SetCheckForTest(func() (updatecheck.CheckReport, error) {
		return updatecheck.CheckReport{Schema: 1, Tools: []updatecheck.CheckTool{
			{Name: "run-kit", Formula: "run-kit", Latest: "3.9.0", Notify: "minor"},
		}}, nil
	})
	c.CheckOnceForTest()
	if len(c.Snapshot().Matched) == 0 {
		t.Fatalf("test setup: checker snapshot should match, got %+v", c.Snapshot())
	}
	return c
}

// multiToolChecker returns a checker matching BOTH run-kit and fab-kit, so the
// shll-present scoped-argv test can assert the full matched set is passed.
func multiToolChecker(t *testing.T) *updatecheck.Checker {
	t.Helper()
	c := updatecheck.New("3.8.0", true)
	c.SetCheckForTest(func() (updatecheck.CheckReport, error) {
		return updatecheck.CheckReport{Schema: 1, Tools: []updatecheck.CheckTool{
			{Name: "run-kit", Formula: "run-kit", Latest: "3.9.0", Notify: "minor"},
			{Name: "fab-kit", Formula: "fab-kit", Installed: "2.16.0", Latest: "2.17.0", Notify: "minor", UpdateAvailable: true, Notable: true},
		}}, nil
	})
	c.CheckOnceForTest()
	if len(c.Snapshot().Matched) != 2 {
		t.Fatalf("test setup: expected 2 matched tools, got %+v", c.Snapshot().Matched)
	}
	return c
}

// spawnRecord captures a recorded spawn (path + logName + args) from the
// generalized spawnSelfFn seam, so tests can assert the spawned binary and argv
// without launching a real child.
type spawnRecord struct {
	called  bool
	selfArg string
	logName string
	args    []string
}

// withSeams swaps the update handler's package-var seams for the duration of a
// test and restores them afterward. shllPath="" (with shllErr non-nil) forces
// the shll-absent fallback path; a non-empty shllPath forces the shll-present
// scoped path.
func withSeams(t *testing.T, selfPath string, resolveErr error, shllPath string, shllErr error, spawn func(selfPath, logName string, args ...string) error) {
	t.Helper()
	origResolve, origSpawn, origShll := resolveSelfPathFn, spawnSelfFn, lookShllFn
	resolveSelfPathFn = func() (string, error) { return selfPath, resolveErr }
	spawnSelfFn = spawn
	lookShllFn = func() (string, error) { return shllPath, shllErr }
	t.Cleanup(func() {
		resolveSelfPathFn = origResolve
		spawnSelfFn = origSpawn
		lookShllFn = origShll
	})
}

// errNoShll is the shll-lookup error stub for the fallback-path tests (forces
// the shll-absent branch of handleUpdate).
var errNoShll = errors.New("exec: \"shll\": executable file not found in $PATH")

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

// ----- shll-present (scoped toolkit update) path -----

// TestHandleUpdateShllScopedSpawnsMatched verifies R9: with shll present and a
// non-force click, the handler spawns `shll update <matched tools…>` with the
// checker's match set as argv.
func TestHandleUpdateShllScopedSpawnsMatched(t *testing.T) {
	var rec spawnRecord
	withSeams(t, "/opt/homebrew/Cellar/run-kit/3.8.0/bin/run-kit", nil, "/opt/homebrew/bin/shll", nil, recordingSpawn(&rec))
	s := newUpdateServer(multiToolChecker(t))

	res := postUpdate(t, s, "")

	if res.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want 202 (body=%s)", res.Code, res.Body.String())
	}
	if rec.selfArg != "/opt/homebrew/bin/shll" {
		t.Errorf("spawn path = %q, want the resolved shll path", rec.selfArg)
	}
	if rec.logName != "update.log" {
		t.Errorf("spawn logName = %q, want update.log", rec.logName)
	}
	// argv = ["update", <matched roster order>]. Matched is roster order
	// (fab-kit before run-kit, sorted names).
	want := []string{"update", "fab-kit", "run-kit"}
	if strings.Join(rec.args, " ") != strings.Join(want, " ") {
		t.Errorf("spawn args = %v, want %v", rec.args, want)
	}
}

// TestHandleUpdateShllDropsFlagLikeToolName verifies the manifest is remote
// input: a matched tool name that could be interpreted as a flag (leading `-`)
// is dropped from the `shll update` argv rather than passed through, so it can
// never inject into shll's flag parser. A legitimate sibling in the same match
// set is still passed.
func TestHandleUpdateShllDropsFlagLikeToolName(t *testing.T) {
	var rec spawnRecord
	withSeams(t, "/opt/homebrew/Cellar/run-kit/3.9.0/bin/run-kit", nil, "/opt/homebrew/bin/shll", nil, recordingSpawn(&rec))
	// A checker whose match set contains a hostile report tool name ("--force")
	// next to a legitimate sibling. run-kit itself is at latest so its row won't
	// match, keeping the assertion focused on the sibling verdicts.
	c := updatecheck.New("3.9.0", true)
	c.SetCheckForTest(func() (updatecheck.CheckReport, error) {
		return updatecheck.CheckReport{Schema: 1, Tools: []updatecheck.CheckTool{
			{Name: "fab-kit", Formula: "fab-kit", Installed: "2.16.0", Latest: "2.17.0", Notify: "minor", UpdateAvailable: true, Notable: true},
			{Name: "--force", Formula: "evil", Installed: "1.0.0", Latest: "9.9.9", Notify: "minor", UpdateAvailable: true, Notable: true},
		}}, nil
	})
	c.CheckOnceForTest()
	if len(c.Snapshot().Matched) != 2 {
		t.Fatalf("test setup: expected 2 matched tools (incl. the hostile key), got %+v", c.Snapshot().Matched)
	}
	s := newUpdateServer(c)

	res := postUpdate(t, s, "")

	if res.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want 202 (body=%s)", res.Code, res.Body.String())
	}
	// argv must carry the legit sibling only — the flag-like name is dropped.
	want := []string{"update", "fab-kit"}
	if strings.Join(rec.args, " ") != strings.Join(want, " ") {
		t.Errorf("spawn args = %v, want %v (flag-like tool name must be dropped)", rec.args, want)
	}
	for _, a := range rec.args {
		if a == "--force" {
			t.Errorf("hostile manifest tool name reached argv: %v", rec.args)
		}
	}
}

// TestHandleUpdateShllNoMatch409 verifies R9: shll present but nothing matches →
// 409 before any spawn (the non-force qualify gate).
func TestHandleUpdateShllNoMatch409(t *testing.T) {
	var rec spawnRecord
	withSeams(t, "/opt/homebrew/Cellar/run-kit/3.9.0/bin/run-kit", nil, "/opt/homebrew/bin/shll", nil, recordingSpawn(&rec))
	// A checker at latest — no match.
	c := updatecheck.New("3.9.0", true)
	s := newUpdateServer(c)

	res := postUpdate(t, s, "")

	if res.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409 when nothing matches (body=%s)", res.Code, res.Body.String())
	}
	if rec.called {
		t.Errorf("must not spawn shll update with an empty match set on the non-force path")
	}
}

// TestHandleUpdateShllForceFullRoster verifies R10: force with shll present
// spawns a full-roster `shll update` (no tool args) and skips the match 409.
func TestHandleUpdateShllForceFullRoster(t *testing.T) {
	var rec spawnRecord
	withSeams(t, "/opt/homebrew/Cellar/run-kit/3.9.0/bin/run-kit", nil, "/opt/homebrew/bin/shll", nil, recordingSpawn(&rec))
	// No matching update — force must bypass the match 409.
	s := newUpdateServer(updatecheck.New("3.9.0", true))

	res := postUpdate(t, s, `{"force":true}`)

	if res.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want 202 on force even without a match (body=%s)", res.Code, res.Body.String())
	}
	if !rec.called {
		t.Fatalf("force must spawn shll update")
	}
	if rec.selfArg != "/opt/homebrew/bin/shll" || rec.logName != "update.log" {
		t.Errorf("force spawn = (%q, %q), want (shll path, update.log)", rec.selfArg, rec.logName)
	}
	if len(rec.args) != 1 || rec.args[0] != "update" {
		t.Errorf("force spawn args = %v, want [update] (full-roster sweep)", rec.args)
	}
}

// TestHandleUpdateShllPresentIgnoresBrew409 verifies R11: with shll present, a
// run-kit-not-brew daemon is NOT refused with the brew-409 — the scoped path has
// no brew gate. (The checker matches a sibling so there's something to update.)
func TestHandleUpdateShllPresentIgnoresBrew409(t *testing.T) {
	var rec spawnRecord
	// resolveSelfPathFn returns a NON-brew path, but the shll-present path never
	// consults it.
	withSeams(t, "/usr/local/bin/run-kit", nil, "/opt/homebrew/bin/shll", nil, recordingSpawn(&rec))
	// A checker matching fab-kit only (run-kit not brew, so its row is gated off).
	c := updatecheck.New("3.9.0", false)
	c.SetCheckForTest(func() (updatecheck.CheckReport, error) {
		return updatecheck.CheckReport{Schema: 1, Tools: []updatecheck.CheckTool{
			{Name: "fab-kit", Formula: "fab-kit", Installed: "2.16.0", Latest: "2.17.0", Notify: "minor", UpdateAvailable: true, Notable: true},
		}}, nil
	})
	c.CheckOnceForTest()
	s := newUpdateServer(c)

	res := postUpdate(t, s, "")

	if res.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want 202 (no brew-409 on the shll path) (body=%s)", res.Code, res.Body.String())
	}
	want := []string{"update", "fab-kit"}
	if strings.Join(rec.args, " ") != strings.Join(want, " ") {
		t.Errorf("spawn args = %v, want %v", rec.args, want)
	}
}

// TestHandleUpdateShllScopedSchedulesRecheck verifies R17: a scoped non-force
// `shll update` spawn triggers a post-remediation re-check on the checker with
// the ~2min delay, so a consumed match clears without waiting for the 6h tick.
func TestHandleUpdateShllScopedSchedulesRecheck(t *testing.T) {
	withSeams(t, "/opt/homebrew/Cellar/run-kit/3.8.0/bin/run-kit", nil, "/opt/homebrew/bin/shll", nil, recordingSpawn(&spawnRecord{}))
	c := multiToolChecker(t)
	var gotDelays []time.Duration
	c.SetRecheckHookForTest(func(d time.Duration) { gotDelays = append(gotDelays, d) })
	s := newUpdateServer(c)

	if res := postUpdate(t, s, ""); res.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want 202 (body=%s)", res.Code, res.Body.String())
	}
	if len(gotDelays) != 1 {
		t.Fatalf("post-remediation re-check scheduled %d times, want 1", len(gotDelays))
	}
	if gotDelays[0] != postRemediationRecheckDelay {
		t.Errorf("re-check delay = %v, want %v", gotDelays[0], postRemediationRecheckDelay)
	}
}

// TestHandleUpdateShllForceSchedulesRecheck verifies R17 for the force sweep:
// a full-roster `shll update` also schedules the post-remediation re-check.
func TestHandleUpdateShllForceSchedulesRecheck(t *testing.T) {
	withSeams(t, "/opt/homebrew/Cellar/run-kit/3.9.0/bin/run-kit", nil, "/opt/homebrew/bin/shll", nil, recordingSpawn(&spawnRecord{}))
	c := updatecheck.New("3.9.0", true) // no match — force bypasses the 409
	var scheduled int
	c.SetRecheckHookForTest(func(time.Duration) { scheduled++ })
	s := newUpdateServer(c)

	if res := postUpdate(t, s, `{"force":true}`); res.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want 202 (body=%s)", res.Code, res.Body.String())
	}
	if scheduled != 1 {
		t.Errorf("force sweep scheduled %d re-checks, want 1", scheduled)
	}
}

// TestHandleUpdateSelfPathNoRecheck verifies R17: the shll-absent `rk update`
// fallback schedules NO re-check (the restart resets state on its own).
func TestHandleUpdateSelfPathNoRecheck(t *testing.T) {
	withSeams(t, "/opt/homebrew/Cellar/run-kit/3.8.0/bin/run-kit", nil, "", errNoShll, recordingSpawn(&spawnRecord{}))
	c := qualifyingChecker(t)
	scheduled := 0
	c.SetRecheckHookForTest(func(time.Duration) { scheduled++ })
	s := newUpdateServer(c)

	if res := postUpdate(t, s, ""); res.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want 202 (body=%s)", res.Code, res.Body.String())
	}
	if scheduled != 0 {
		t.Errorf("shll-absent fallback scheduled %d re-checks, want 0", scheduled)
	}
}

// ----- shll-absent (run-kit-self) fallback path -----

func TestHandleUpdateAcceptedSpawns(t *testing.T) {
	var rec spawnRecord
	withSeams(t, "/opt/homebrew/Cellar/run-kit/3.8.0/bin/run-kit", nil, "", errNoShll, recordingSpawn(&rec))
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
	if rec.selfArg != "/opt/homebrew/Cellar/run-kit/3.8.0/bin/run-kit" {
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
	withSeams(t, "/usr/local/bin/run-kit", nil, "", errNoShll, recordingSpawn(&rec))
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
	withSeams(t, "/opt/homebrew/Cellar/run-kit/3.9.0/bin/run-kit", nil, "", errNoShll, recordingSpawn(&rec))
	// A checker with no matching update (never checked / same version).
	c := updatecheck.New("3.9.0", true)
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
	withSeams(t, "/opt/homebrew/Cellar/run-kit/3.9.0/bin/run-kit", nil, "", errNoShll, func(selfPath, logName string, args ...string) error {
		t.Fatalf("must not spawn with a nil checker")
		return nil
	})
	s := newUpdateServer(nil)

	res := postUpdate(t, s, "")

	if res.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409 with a nil checker", res.Code)
	}
}

// TestHandleUpdateSecondClickAccepted verifies R12: a second POST while matching
// is accepted again (no in-flight lock).
func TestHandleUpdateSecondClickAccepted(t *testing.T) {
	spawns := 0
	withSeams(t, "/opt/homebrew/Cellar/run-kit/3.8.0/bin/run-kit", nil, "", errNoShll, func(selfPath, logName string, args ...string) error {
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

// TestHandleUpdateForceSkipsQualifyKeepsBrew verifies R11: on the shll-absent
// path, force=true skips the qualify 409 (no pending update) but still spawns
// for a brew install.
func TestHandleUpdateForceSkipsQualifyKeepsBrew(t *testing.T) {
	var rec spawnRecord
	withSeams(t, "/opt/homebrew/Cellar/run-kit/3.9.0/bin/run-kit", nil, "", errNoShll, recordingSpawn(&rec))
	// A checker with NO matching update — force must bypass the qualify 409.
	s := newUpdateServer(updatecheck.New("3.9.0", true))

	res := postUpdate(t, s, `{"force":true}`)

	if res.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want 202 on force even without a matching update (body=%s)", res.Code, res.Body.String())
	}
	if !rec.called {
		t.Errorf("force=true must spawn rk update even without a matching update")
	}
	if rec.logName != "update.log" || len(rec.args) != 1 || rec.args[0] != "update" {
		t.Errorf("force spawn = (%q, %v), want (update.log, [update])", rec.logName, rec.args)
	}
}

// TestHandleUpdateForceNilChecker verifies force=true bypasses the nil-checker
// 409 too on the shll-absent path (the qualify branch is fully gated behind
// !force).
func TestHandleUpdateForceNilChecker(t *testing.T) {
	var rec spawnRecord
	withSeams(t, "/opt/homebrew/Cellar/run-kit/3.9.0/bin/run-kit", nil, "", errNoShll, recordingSpawn(&rec))
	s := newUpdateServer(nil)

	res := postUpdate(t, s, `{"force":true}`)

	if res.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want 202 on force with a nil checker (body=%s)", res.Code, res.Body.String())
	}
	if !rec.called {
		t.Errorf("force=true must spawn even with a nil checker")
	}
}

// TestHandleUpdateForceKeepsBrew409 verifies R11: on the shll-absent path, force
// does NOT bypass the brew 409 — a non-brew install is still refused.
func TestHandleUpdateForceKeepsBrew409(t *testing.T) {
	var rec spawnRecord
	withSeams(t, "/usr/local/bin/run-kit", nil, "", errNoShll, recordingSpawn(&rec))
	s := newUpdateServer(nil)

	res := postUpdate(t, s, `{"force":true}`)

	if res.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409 — force must NOT bypass the brew requirement (body=%s)", res.Code, res.Body.String())
	}
	if rec.called {
		t.Errorf("must not spawn on a non-brew install even with force=true")
	}
}

// ----- POST /api/updates/check (on-demand check) -----

// postUpdatesCheck issues a POST /api/updates/check.
func postUpdatesCheck(t *testing.T, s *Server) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/updates/check", nil)
	s.handleUpdatesCheck(rec, req)
	return rec
}

// TestHandleUpdatesCheckReturnsFreshVerdict verifies the endpoint runs one
// inline pass and returns the fresh verdict synchronously in the shared
// SSE-payload shape (full per-tool verdict list + notable-derived key).
func TestHandleUpdatesCheckReturnsFreshVerdict(t *testing.T) {
	c := updatecheck.New("3.8.0", true)
	c.SetCheckForTest(func() (updatecheck.CheckReport, error) {
		return updatecheck.CheckReport{Schema: 1, Tools: []updatecheck.CheckTool{
			{Name: "run-kit", Formula: "run-kit", Latest: "3.9.0", Notify: "minor"},
			{Name: "tu", Formula: "tu", Installed: "0.9.1", Latest: "0.9.2", Notify: "minor", UpdateAvailable: true, Notable: false},
		}}, nil
	})
	s := newUpdateServer(c)

	res := postUpdatesCheck(t, s)

	if res.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", res.Code, res.Body.String())
	}
	var body struct {
		Tools []struct {
			Tool            string `json:"tool"`
			Current         string `json:"current"`
			Latest          string `json:"latest"`
			UpdateAvailable bool   `json:"updateAvailable"`
			Notable         bool   `json:"notable"`
		} `json:"tools"`
		Key string `json:"key"`
	}
	if err := json.Unmarshal(res.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if len(body.Tools) != 2 {
		t.Fatalf("tools = %+v, want 2 verdicts (notable run-kit + sub-threshold tu)", body.Tools)
	}
	if body.Tools[0].Tool != "run-kit" || !body.Tools[0].Notable || !body.Tools[0].UpdateAvailable {
		t.Errorf("run-kit verdict = %+v, want notable+updateAvailable", body.Tools[0])
	}
	if body.Tools[1].Tool != "tu" || body.Tools[1].Notable || !body.Tools[1].UpdateAvailable {
		t.Errorf("tu verdict = %+v, want sub-threshold updateAvailable", body.Tools[1])
	}
	if body.Key != "run-kit@3.9.0" {
		t.Errorf("key = %q, want run-kit@3.9.0 (notable set only)", body.Key)
	}
	// The pass converged the shared cached verdict (chip source).
	if snap := c.Snapshot(); snap.Key != "run-kit@3.9.0" {
		t.Errorf("cached snapshot key = %q, want run-kit@3.9.0", snap.Key)
	}
}

// TestHandleUpdatesCheckFailure502 verifies the fail-loud manual posture: a
// failed check (shll missing / non-zero / unparseable) maps to 502 with the
// reason in the error body.
func TestHandleUpdatesCheckFailure502(t *testing.T) {
	c := updatecheck.New("3.8.0", true)
	c.SetCheckForTest(func() (updatecheck.CheckReport, error) {
		return updatecheck.CheckReport{}, errors.New("shll not found on PATH")
	})
	s := newUpdateServer(c)

	res := postUpdatesCheck(t, s)

	if res.Code != http.StatusBadGateway {
		t.Fatalf("status = %d, want 502 (body=%s)", res.Code, res.Body.String())
	}
	if !strings.Contains(res.Body.String(), "shll not found on PATH") {
		t.Errorf("error body = %q, want the check-failure reason", res.Body.String())
	}
}

// TestHandleUpdatesCheckSuppressedAndNil409 verifies the defensive contract: a
// suppressed (dev) or nil checker responds 409 without running any check.
func TestHandleUpdatesCheckSuppressedAndNil409(t *testing.T) {
	dev := updatecheck.New("dev", true)
	for name, s := range map[string]*Server{
		"suppressed": newUpdateServer(dev),
		"nil":        newUpdateServer(nil),
	} {
		t.Run(name, func(t *testing.T) {
			res := postUpdatesCheck(t, s)
			if res.Code != http.StatusConflict {
				t.Fatalf("status = %d, want 409 (body=%s)", res.Code, res.Body.String())
			}
		})
	}
}

// TestHandleUpdateBodyVariantsPreserveNonForce verifies the tolerant body parse:
// an explicit force=false, an empty {} body, and an absent body all take the
// non-force path (byte-preserving today's 409 when no update matches, on the
// shll-absent path).
func TestHandleUpdateBodyVariantsPreserveNonForce(t *testing.T) {
	for name, body := range map[string]string{
		"force-false": `{"force":false}`,
		"empty-obj":   `{}`,
		"absent":      "",
	} {
		t.Run(name, func(t *testing.T) {
			var rec spawnRecord
			withSeams(t, "/opt/homebrew/Cellar/run-kit/3.9.0/bin/run-kit", nil, "", errNoShll, recordingSpawn(&rec))
			s := newUpdateServer(updatecheck.New("3.9.0", true)) // no matching update

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
