package api

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"

	"rk/internal/gui"
	"rk/internal/settings"
)

// newGuiAPIServer builds a routed test server with gui.enabled persisted as
// given and every gui seam stubbed to the "session present, backend reachable"
// shape — tests override the seam their branch hinges on.
func newGuiAPIServer(t *testing.T, enabled bool) (*Server, http.Handler) {
	t.Helper()
	isolateSettings(t)
	st := settings.Load()
	st.GUIEnabled = enabled
	if err := settings.Save(st); err != nil {
		t.Fatalf("save settings: %v", err)
	}
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))
	server := &Server{
		logger:              logger,
		sessions:            &mockSessionFetcher{},
		tmux:                &mockTmuxOps{},
		hostname:            "test-host",
		guiDaemonUpFn:       func() bool { return true },
		guiSessionExistsFn:  func(context.Context) bool { return true },
		guiSessionOptionsFn: func(context.Context) (string, string, string, bool) { return ":10", "Xtigervnc", "", true },
		guiSessionCreatedFn: func(context.Context) (time.Time, bool) { return time.Now().Add(-time.Hour), true },
		guiPanePidsFn:       func(context.Context) map[int]bool { return map[int]bool{4242: true} },
		guiProbeFn: func(context.Context, string, string) (gui.Info, error) {
			return gui.Info{Reachable: true, Width: 1920, Height: 1080}, nil
		},
		guiAppsFn:     func(string, map[int]bool) ([]gui.App, error) { return []gui.App{{Name: "chromium", Count: 3}}, nil },
		guiLookPathFn: func(name string) (string, error) { return "/usr/bin/" + name, nil },
		guiStatFn:     func(string) (os.FileInfo, error) { return nil, nil },
	}
	return server, server.buildRouter()
}

func getJSON(t *testing.T, router http.Handler, path string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, path, nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

// --- GET /api/gui/{id} ---

func TestGuiStatusInvalidID(t *testing.T) {
	_, router := newGuiAPIServer(t, true)
	rec := getJSON(t, router, "/api/gui/nope")
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
	var errBody map[string]string
	if err := json.NewDecoder(rec.Body).Decode(&errBody); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if errBody["error"] != `gui id must be "host"` {
		t.Errorf("error = %q, want the validation message", errBody["error"])
	}
}

func TestGuiStatusDisabledDocument(t *testing.T) {
	_, router := newGuiAPIServer(t, false)
	rec := getJSON(t, router, "/api/gui/host")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	body := rec.Body.Bytes()
	var st gui.Status
	if err := json.Unmarshal(body, &st); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if st.ID != "host" || st.Enabled || st.Reachable || st.Session || len(st.Apps) != 0 || st.Geometry != "" {
		t.Errorf("document = %+v, want id=host with everything off/empty", st)
	}
	if !strings.Contains(string(body), `"apps":[]`) {
		t.Errorf("body = %s, want apps serialized as [] (never null)", body)
	}
	if !strings.Contains(string(body), `"enabled":false`) {
		t.Errorf("body = %s, want enabled:false", body)
	}
	if !strings.Contains(string(body), `"wm_candidates":[`) {
		t.Errorf("body = %s, want wm_candidates serialized as an array on the disabled document", body)
	}
}

func TestGuiStatusReachableDocument(t *testing.T) {
	server, router := newGuiAPIServer(t, true)
	server.initSSEHub()
	server.sseHub.guiViewerAdd("host")
	var gotExclude map[int]bool
	server.guiAppsFn = func(_ string, exclude map[int]bool) ([]gui.App, error) {
		gotExclude = exclude
		return []gui.App{{Name: "chromium", Count: 3}}, nil
	}

	rec := getJSON(t, router, "/api/gui/host")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var st gui.Status
	if err := json.NewDecoder(rec.Body).Decode(&st); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !st.Enabled || !st.Reachable || !st.Session {
		t.Errorf("document = %+v, want enabled/reachable/session true", st)
	}
	if st.Backend != "Xtigervnc" || st.Display != ":10" || st.Width != 1920 || st.Height != 1080 {
		t.Errorf("document = %+v, want Xtigervnc/:10/1920x1080", st)
	}
	if st.Viewers != 1 {
		t.Errorf("viewers = %d, want 1 (the hub's live relay count)", st.Viewers)
	}
	if st.Reason != "" {
		t.Errorf("reason = %q, want empty when reachable", st.Reason)
	}
	if len(st.Apps) != 1 || st.Apps[0].Name != "chromium" || st.Apps[0].Count != 3 {
		t.Errorf("apps = %+v, want [{chromium 3}]", st.Apps)
	}
	if !gotExclude[4242] {
		t.Errorf("exclude = %v, want the guiPanePidsFn set {4242} (the WM must not count as an app)", gotExclude)
	}
	if st.UptimeSeconds <= 0 {
		t.Errorf("uptime_seconds = %d, want > 0", st.UptimeSeconds)
	}
	if !strings.HasSuffix(st.Socket, "host.sock") {
		t.Errorf("socket = %q, want the host.sock path", st.Socket)
	}
}

// The geometry rides settings like enabled: the document carries the
// gui.geometry value while enabled, "" while disabled.
func TestGuiStatusCarriesGeometry(t *testing.T) {
	_, router := newGuiAPIServer(t, true)
	st := settings.Load()
	st.GUIGeometry = "1600x900"
	if err := settings.Save(st); err != nil {
		t.Fatalf("save settings: %v", err)
	}

	rec := getJSON(t, router, "/api/gui/host")
	var doc gui.Status
	if err := json.Unmarshal(rec.Body.Bytes(), &doc); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if doc.Geometry != "1600x900" {
		t.Errorf("geometry = %q, want 1600x900 from the setting", doc.Geometry)
	}
}

// The reason strings and assembly precedence are covered by the
// internal/gui assembler tests; here the API asserts seam wiring only.

func TestGuiStatusWMCandidates(t *testing.T) {
	server, router := newGuiAPIServer(t, true)
	server.guiLookPathFn = func(name string) (string, error) {
		switch name {
		case "icewm-session", "startlxqt":
			return "/usr/bin/" + name, nil
		}
		return "", errors.New("not found: " + name)
	}

	rec := getJSON(t, router, "/api/gui/host")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var st gui.Status
	if err := json.NewDecoder(rec.Body).Decode(&st); err != nil {
		t.Fatalf("decode: %v", err)
	}
	want := []gui.WMCandidate{
		{Name: "icewm-session", Label: "IceWM", Kind: "wm", Installed: true},
		{Name: "startlxqt", Label: "LXQt", Kind: "session", Installed: true},
	}
	if !reflect.DeepEqual(st.WMCandidates, want) {
		t.Errorf("wm_candidates = %+v, want %+v", st.WMCandidates, want)
	}
	if strings.Contains(rec.Body.String(), "wm_candidates_hint") {
		t.Errorf("body = %s, want wm_candidates_hint omitted (startlxqt is installed)", rec.Body.String())
	}
}

func TestGuiStatusWMCandidatesEmptyCarriesHint(t *testing.T) {
	server, router := newGuiAPIServer(t, true)
	server.guiLookPathFn = func(name string) (string, error) {
		if name == "apt-get" {
			return "/usr/bin/apt-get", nil
		}
		return "", errors.New("not found: " + name)
	}

	rec := getJSON(t, router, "/api/gui/host")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"wm_candidates":[]`) {
		t.Errorf("body = %s, want wm_candidates serialized as [] (never null)", rec.Body.String())
	}
	var st gui.Status
	if err := json.NewDecoder(rec.Body).Decode(&st); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if want := "sudo apt install --no-install-recommends lxqt-core"; st.WMCandidatesHint != want {
		t.Errorf("wm_candidates_hint = %q, want %q", st.WMCandidatesHint, want)
	}
}

func TestGuiStatusSessionAbsent(t *testing.T) {
	server, router := newGuiAPIServer(t, true)
	server.guiSessionExistsFn = func(context.Context) bool { return false }

	rec := getJSON(t, router, "/api/gui/host")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d; body=%s", rec.Code, rec.Body.String())
	}
	var st gui.Status
	if err := json.NewDecoder(rec.Body).Decode(&st); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if st.Reachable || st.Session || st.Reason == "" {
		t.Errorf("document = %+v, want unreachable, session=false, a reason set", st)
	}
}

func TestGuiStatusUnreachableOmitsApps(t *testing.T) {
	server, router := newGuiAPIServer(t, true)
	server.guiProbeFn = func(context.Context, string, string) (gui.Info, error) {
		return gui.Info{Reason: "not running"}, nil
	}
	server.guiAppsFn = func(string, map[int]bool) ([]gui.App, error) {
		t.Error("apps seam called while unreachable — the scan is gated on reachability")
		return nil, nil
	}

	rec := getJSON(t, router, "/api/gui/host")
	var st gui.Status
	if err := json.NewDecoder(rec.Body).Decode(&st); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if st.Reachable || st.Reason == "" || len(st.Apps) != 0 {
		t.Errorf("document = %+v, want unreachable with a reason and no apps", st)
	}
}

// --- POST /api/gui/{id}/restart ---

func TestGuiRestartInvalidID(t *testing.T) {
	_, router := newGuiAPIServer(t, true)
	rec := postJSON(t, router, "/api/gui/nope/restart", `{}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
}

func TestGuiRestartDisabled409(t *testing.T) {
	server, router := newGuiAPIServer(t, false)
	called := false
	server.guiRestartFn = func() error { called = true; return nil }

	rec := postJSON(t, router, "/api/gui/host/restart", `{}`)
	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409; body=%s", rec.Code, rec.Body.String())
	}
	if strings.TrimSpace(rec.Body.String()) != `{"error":"gui disabled"}` {
		t.Errorf("body = %s, want exactly the gui-disabled error", rec.Body.String())
	}
	if called {
		t.Error("restart seam called with the GUI disabled")
	}
}

func TestGuiRestartOK(t *testing.T) {
	server, router := newGuiAPIServer(t, true)
	calls := 0
	server.guiRestartFn = func() error { calls++; return nil }

	rec := postJSON(t, router, "/api/gui/host/restart", `{}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if strings.TrimSpace(rec.Body.String()) != `{"status":"ok"}` {
		t.Errorf("body = %s, want the ok status", rec.Body.String())
	}
	if calls != 1 {
		t.Errorf("restart calls = %d, want 1", calls)
	}
}

func TestGuiRestartFailure500(t *testing.T) {
	server, router := newGuiAPIServer(t, true)
	server.guiRestartFn = func() error { return errors.New("tmux exploded") }

	rec := postJSON(t, router, "/api/gui/host/restart", `{}`)
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500; body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "tmux exploded") {
		t.Errorf("body = %s, want the restart error text", rec.Body.String())
	}
}

// --- POST /api/gui/{id}/launch ---

func TestGuiLaunchInvalidID(t *testing.T) {
	_, router := newGuiAPIServer(t, true)
	rec := postJSON(t, router, "/api/gui/nope/launch", `{"app":"terminal"}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
	if strings.TrimSpace(rec.Body.String()) != `{"error":"gui id must be \"host\""}` {
		t.Errorf("body = %s, want the validation message", rec.Body.String())
	}
}

// The body carries a role, never argv: an unparsable body, a non-string app,
// an unknown role, and extra keys are all the same 400.
func TestGuiLaunchBadBody(t *testing.T) {
	for _, body := range []string{
		`{`,
		`{"app":1}`,
		`{"app":"xterm"}`,
		`{"app":"terminal","argv":["rm","-rf","/"]}`,
	} {
		_, router := newGuiAPIServer(t, true)
		rec := postJSON(t, router, "/api/gui/host/launch", body)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("body %s: status = %d, want 400; resp=%s", body, rec.Code, rec.Body.String())
			continue
		}
		if strings.TrimSpace(rec.Body.String()) != `{"error":"app must be terminal or browser"}` {
			t.Errorf("body %s: resp = %s, want the role error", body, rec.Body.String())
		}
	}
}

func TestGuiLaunchDisabled409(t *testing.T) {
	server, router := newGuiAPIServer(t, false)
	server.guiLaunchFn = func([]string, []string) (int, error) {
		t.Error("launch seam called with the GUI disabled")
		return 0, nil
	}

	rec := postJSON(t, router, "/api/gui/host/launch", `{"app":"terminal"}`)
	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409; body=%s", rec.Code, rec.Body.String())
	}
	if strings.TrimSpace(rec.Body.String()) != `{"error":"gui disabled"}` {
		t.Errorf("body = %s, want exactly the gui-disabled error", rec.Body.String())
	}
}

func TestGuiLaunchNotRunning409(t *testing.T) {
	server, router := newGuiAPIServer(t, true)
	server.guiProbeFn = func(context.Context, string, string) (gui.Info, error) {
		return gui.Info{Reason: "not running"}, nil
	}
	server.guiLaunchFn = func([]string, []string) (int, error) {
		t.Error("launch seam called while unreachable")
		return 0, nil
	}

	rec := postJSON(t, router, "/api/gui/host/launch", `{"app":"terminal"}`)
	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409; body=%s", rec.Code, rec.Body.String())
	}
	if strings.TrimSpace(rec.Body.String()) != `{"error":"gui is on but not running — see 'rk gui status'"}` {
		t.Errorf("body = %s, want exactly the not-running error", rec.Body.String())
	}
}

func TestGuiLaunchLadderMissOKFalse(t *testing.T) {
	server, router := newGuiAPIServer(t, true)
	server.guiLookPathFn = func(name string) (string, error) {
		if name == "apt-get" {
			return "/usr/bin/apt-get", nil
		}
		return "", errors.New("not found: " + name)
	}
	server.guiLaunchFn = func([]string, []string) (int, error) {
		t.Error("launch seam called on a ladder miss")
		return 0, nil
	}

	rec := postJSON(t, router, "/api/gui/host/launch", `{"app":"browser"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (ok:false rides the success path); body=%s", rec.Code, rec.Body.String())
	}
	var body map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body["ok"] != false || body["app"] != "browser" {
		t.Errorf("body = %v, want ok:false app:browser", body)
	}
	if body["hint"] != "no browser on the GUI host — sudo apt install chromium-browser" {
		t.Errorf("hint = %v, want the apt browser install line", body["hint"])
	}
}

func TestGuiLaunchStartFailure500(t *testing.T) {
	server, router := newGuiAPIServer(t, true)
	server.guiLaunchFn = func([]string, []string) (int, error) { return 0, errors.New("fork/exec: permission denied") }

	rec := postJSON(t, router, "/api/gui/host/launch", `{"app":"terminal"}`)
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500; body=%s", rec.Code, rec.Body.String())
	}
	if strings.TrimSpace(rec.Body.String()) != `{"error":"x-terminal-emulator: fork/exec: permission denied"}` {
		t.Errorf("body = %s, want <name>: <reason>", rec.Body.String())
	}
}

func TestGuiLaunchOK(t *testing.T) {
	server, router := newGuiAPIServer(t, true)
	var calls [][]string
	server.guiLaunchFn = func(argv, env []string) (int, error) {
		calls = append(calls, append(argv, env...))
		return 4321, nil
	}

	rec := postJSON(t, router, "/api/gui/host/launch", `{"app":"terminal"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var body map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body["ok"] != true || body["app"] != "terminal" || body["argv0"] != "x-terminal-emulator" || body["pid"] != float64(4321) {
		t.Errorf("body = %v, want ok:true app:terminal argv0:x-terminal-emulator pid:4321", body)
	}
	if len(calls) != 1 {
		t.Fatalf("launch calls = %d, want 1", len(calls))
	}
	call := calls[0]
	if call[0] != "/usr/bin/x-terminal-emulator" {
		t.Errorf("launch argv = %v, want [/usr/bin/x-terminal-emulator] (the resolved path only)", call[:1])
	}
	foundDisplay := false
	for _, kv := range call[1:] {
		if kv == "DISPLAY=:10" {
			foundDisplay = true
		}
	}
	if !foundDisplay {
		t.Errorf("launch env lacks DISPLAY=:10: %v", call[1:])
	}
}

// The family is exactly GET /api/gui/{id} + POST /api/gui/{id}/restart +
// POST /api/gui/{id}/launch + POST /api/gui/{id}/resize — nothing else under
// /api/gui exists (mutations ride POST, on/off ride /api/settings).
func TestGuiNoOtherRoutes(t *testing.T) {
	_, router := newGuiAPIServer(t, true)
	for _, tc := range []struct {
		method, path string
	}{
		{http.MethodPost, "/api/gui/host"},
		{http.MethodGet, "/api/gui/host/restart"},
		{http.MethodGet, "/api/gui/host/env"},
		{http.MethodPost, "/api/gui/host/off"},
	} {
		req := httptest.NewRequest(tc.method, tc.path, nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		if rec.Code != http.StatusMethodNotAllowed && rec.Code != http.StatusNotFound {
			t.Errorf("%s %s: status = %d, want 404/405", tc.method, tc.path, rec.Code)
		}
	}
}

func TestGuiLaunchDarwin409(t *testing.T) {
	saved := guiLaunchGOOS
	t.Cleanup(func() { guiLaunchGOOS = saved })
	guiLaunchGOOS = "darwin"
	server, router := newGuiAPIServer(t, true)
	server.guiLaunchFn = func([]string, []string) (int, error) {
		t.Error("launch seam called on darwin")
		return 0, nil
	}

	rec := postJSON(t, router, "/api/gui/host/launch", `{"app":"terminal"}`)
	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409; body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), guiLaunchDarwinError) {
		t.Errorf("body = %s, want the CLI's darwin refusal text", rec.Body.String())
	}
}

// The status document's locked / human_input_ago_ms fields ride the hub: the
// pin as of the last gui tick, and the relay's in-memory input timestamp.
func TestGuiStatusCarriesLockAndHumanInput(t *testing.T) {
	server, router := newGuiAPIServer(t, true)
	server.initSSEHub()
	server.sseHub.guiHumanInputSeen("host")
	server.sseHub.mu.Lock()
	server.sseHub.guiLocked = true
	server.sseHub.mu.Unlock()

	rec := getJSON(t, router, "/api/gui/host")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var st gui.Status
	if err := json.Unmarshal(rec.Body.Bytes(), &st); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !st.Locked {
		t.Errorf("locked = false, want true (the hub's tick-cached pin)")
	}
	if st.HumanInputAgoMS < 1 {
		t.Errorf("human_input_ago_ms = %d, want ≥ 1 after a relayed input", st.HumanInputAgoMS)
	}
}

func TestGuiStatusOmitsHumanInputBeforeAny(t *testing.T) {
	_, router := newGuiAPIServer(t, true)
	rec := getJSON(t, router, "/api/gui/host")
	if strings.Contains(rec.Body.String(), "human_input_ago_ms") {
		t.Errorf("body = %s, want human_input_ago_ms omitted before any relayed input", rec.Body.String())
	}
}

// --- POST /api/gui/{id}/resize ---

// fakeXrandrQuery is the probe output the stubbed reachable rig answers with:
// VNC-0 connected, 1920x1080 and 1280x720 listed, 1600x900 not.
const fakeXrandrQuery = "Screen 0: minimum 32 x 32, current 1920 x 1080, maximum 16384 x 16384\n" +
	"VNC-0 connected 1920x1080+0+0 0mm x 0mm\n" +
	"   1920x1080     60.00*+\n" +
	"   1280x720      60.00\n"

// xrandrCall is one recorded DisplayRunner invocation.
type xrandrCall struct {
	display string
	argv    []string
}

// recordingXrandrRunner builds a DisplayRunner that records each call and
// answers --query with fakeXrandrQuery. failOnFlag, when non-empty, makes any
// argv containing that flag fail with failErr.
func recordingXrandrRunner(calls *[]xrandrCall, failOnFlag string, failErr error) gui.DisplayRunner {
	return func(_ context.Context, display string, argv []string) (string, error) {
		*calls = append(*calls, xrandrCall{display: display, argv: append([]string(nil), argv...)})
		if failOnFlag != "" {
			for _, a := range argv {
				if a == failOnFlag {
					return "", failErr
				}
			}
		}
		if len(argv) == 2 && argv[1] == "--query" {
			return fakeXrandrQuery, nil
		}
		return "", nil
	}
}

// failIfXrandrRuns is the runner for refusal rows: xrandr must never start.
func failIfXrandrRuns(t *testing.T) gui.DisplayRunner {
	t.Helper()
	return func(context.Context, string, []string) (string, error) {
		t.Error("xrandr runner called on a refusal path")
		return "", nil
	}
}

func TestGuiResizeInvalidID(t *testing.T) {
	_, router := newGuiAPIServer(t, true)
	rec := postJSON(t, router, "/api/gui/nope/resize", `{"geometry":"1600x900"}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
	if strings.TrimSpace(rec.Body.String()) != `{"error":"gui id must be \"host\""}` {
		t.Errorf("body = %s, want the validation message", rec.Body.String())
	}
}

// An undecodable body — truncation, a non-string geometry, extra keys — is the
// same 400 shape message.
func TestGuiResizeBadBody(t *testing.T) {
	for _, body := range []string{
		`{`,
		`{"geometry":1}`,
		`{"geometry":"1600x900","argv":["rm","-rf","/"]}`,
	} {
		server, router := newGuiAPIServer(t, true)
		server.guiXrandrRunFn = failIfXrandrRuns(t)
		rec := postJSON(t, router, "/api/gui/host/resize", body)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("body %s: status = %d, want 400; resp=%s", body, rec.Code, rec.Body.String())
			continue
		}
		if strings.TrimSpace(rec.Body.String()) != `{"error":"geometry must be WxH (320–7680 per side) or auto"}` {
			t.Errorf("body %s: resp = %s, want the shape error", body, rec.Body.String())
		}
	}
}

func TestGuiResizeOutOfRange400(t *testing.T) {
	server, router := newGuiAPIServer(t, true)
	server.guiXrandrRunFn = failIfXrandrRuns(t)

	rec := postJSON(t, router, "/api/gui/host/resize", `{"geometry":"100x100"}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "geometry 100x100 out of range (320–7680 per side)") {
		t.Errorf("body = %s, want the range message", rec.Body.String())
	}
}

func TestGuiResizeDarwin409(t *testing.T) {
	saved := guiLaunchGOOS
	t.Cleanup(func() { guiLaunchGOOS = saved })
	guiLaunchGOOS = "darwin"
	server, router := newGuiAPIServer(t, true)
	server.guiXrandrRunFn = failIfXrandrRuns(t)

	rec := postJSON(t, router, "/api/gui/host/resize", `{"geometry":"1600x900"}`)
	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409; body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), guiResizeDarwinError) {
		t.Errorf("body = %s, want the darwin refusal text", rec.Body.String())
	}
}

func TestGuiResizeDisabled409(t *testing.T) {
	server, router := newGuiAPIServer(t, false)
	server.guiXrandrRunFn = failIfXrandrRuns(t)

	rec := postJSON(t, router, "/api/gui/host/resize", `{"geometry":"1600x900"}`)
	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409; body=%s", rec.Code, rec.Body.String())
	}
	if strings.TrimSpace(rec.Body.String()) != `{"error":"gui disabled"}` {
		t.Errorf("body = %s, want exactly the gui-disabled error", rec.Body.String())
	}
}

func TestGuiResizeNotRunning409(t *testing.T) {
	server, router := newGuiAPIServer(t, true)
	server.guiProbeFn = func(context.Context, string, string) (gui.Info, error) {
		return gui.Info{Reason: "not running"}, nil
	}
	server.guiXrandrRunFn = failIfXrandrRuns(t)

	rec := postJSON(t, router, "/api/gui/host/resize", `{"geometry":"1600x900"}`)
	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409; body=%s", rec.Code, rec.Body.String())
	}
	if strings.TrimSpace(rec.Body.String()) != `{"error":"gui is on but not running — see 'rk gui status'"}` {
		t.Errorf("body = %s, want exactly the not-running error", rec.Body.String())
	}
}

// No xrandr on PATH: 500 with the install hint and the setting stays
// unwritten.
func TestGuiResizeXrandrMissing500(t *testing.T) {
	server, router := newGuiAPIServer(t, true)
	server.guiLookPathFn = func(name string) (string, error) {
		if name == "xrandr" {
			return "", errors.New("not found: " + name)
		}
		return "/usr/bin/" + name, nil
	}
	server.guiXrandrRunFn = failIfXrandrRuns(t)

	rec := postJSON(t, router, "/api/gui/host/resize", `{"geometry":"1600x900"}`)
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500; body=%s", rec.Code, rec.Body.String())
	}
	if strings.TrimSpace(rec.Body.String()) != `{"error":"`+gui.XrandrMissingHint+`"}` {
		t.Errorf("body = %s, want the xrandr install hint", rec.Body.String())
	}
	if got := settings.Load().GUIGeometry; got != gui.GeometryDefault {
		t.Errorf("GUIGeometry = %q, want unwritten default %q", got, gui.GeometryDefault)
	}
}

// A failed xrandr step surfaces its stderr tail and leaves the setting
// unwritten (the setting must stay truthful to the display).
func TestGuiResizeFailure500LeavesSetting(t *testing.T) {
	server, router := newGuiAPIServer(t, true)
	var calls []xrandrCall
	server.guiXrandrRunFn = recordingXrandrRunner(&calls, "--output", errors.New("X Error of failed request"))

	rec := postJSON(t, router, "/api/gui/host/resize", `{"geometry":"1600x900"}`)
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500; body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "X Error of failed request") {
		t.Errorf("body = %s, want the xrandr stderr tail", rec.Body.String())
	}
	if got := settings.Load().GUIGeometry; got != gui.GeometryDefault {
		t.Errorf("GUIGeometry = %q, want unchanged default %q after the failure", got, gui.GeometryDefault)
	}
}

// "auto" persists the setting only — no xrandr exchange at all.
func TestGuiResizeAutoPersistsOnly(t *testing.T) {
	server, router := newGuiAPIServer(t, true)
	server.guiXrandrRunFn = failIfXrandrRuns(t)

	rec := postJSON(t, router, "/api/gui/host/resize", `{"geometry":"auto"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var body map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body["ok"] != true || body["geometry"] != gui.GeometryAuto || body["was"] != gui.GeometryDefault {
		t.Errorf("body = %v, want ok:true geometry:auto was:%s", body, gui.GeometryDefault)
	}
	if got := settings.Load().GUIGeometry; got != gui.GeometryAuto {
		t.Errorf("GUIGeometry = %q, want auto", got)
	}
}

func TestGuiResizeOK(t *testing.T) {
	server, router := newGuiAPIServer(t, true)
	var calls []xrandrCall
	server.guiXrandrRunFn = recordingXrandrRunner(&calls, "", nil)

	rec := postJSON(t, router, "/api/gui/host/resize", `{"geometry":"1600x900"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var body map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body["ok"] != true || body["geometry"] != "1600x900" || body["was"] != gui.GeometryDefault {
		t.Errorf("body = %v, want ok:true geometry:1600x900 was:%s", body, gui.GeometryDefault)
	}
	if got := settings.Load().GUIGeometry; got != "1600x900" {
		t.Errorf("GUIGeometry = %q, want 1600x900 persisted", got)
	}
	// 1600x900 is unlisted: query first, then the zero-timing modeline,
	// addmode, and the output step — all on the status's display.
	want := []xrandrCall{
		{":10", []string{"xrandr", "--query"}},
		{":10", []string{"xrandr", "--newmode", "1600x900", "0", "1600", "0", "0", "0", "900", "0", "0", "0"}},
		{":10", []string{"xrandr", "--addmode", "VNC-0", "1600x900"}},
		{":10", []string{"xrandr", "--output", "VNC-0", "--mode", "1600x900"}},
	}
	if !reflect.DeepEqual(calls, want) {
		t.Errorf("xrandr calls = %+v, want %+v", calls, want)
	}
}
