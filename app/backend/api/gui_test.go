package api

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
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
		guiSessionOptionsFn: func(context.Context) (string, string, bool) { return ":10", "Xtigervnc", true },
		guiSessionCreatedFn: func(context.Context) (time.Time, bool) { return time.Now().Add(-time.Hour), true },
		guiProbeFn: func(context.Context, string, string) (gui.Info, error) {
			return gui.Info{Reachable: true, Width: 1920, Height: 1080}, nil
		},
		guiAppsFn:     func(string) ([]gui.App, error) { return []gui.App{{Name: "chromium", Count: 3}}, nil },
		guiLookPathFn: func(name string) (string, error) { return "/usr/bin/" + name, nil },
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
	if st.ID != "host" || st.Enabled || st.Reachable || st.Session || len(st.Apps) != 0 {
		t.Errorf("document = %+v, want id=host with everything off/empty", st)
	}
	if !strings.Contains(string(body), `"apps":[]`) {
		t.Errorf("body = %s, want apps serialized as [] (never null)", body)
	}
	if !strings.Contains(string(body), `"enabled":false`) {
		t.Errorf("body = %s, want enabled:false", body)
	}
}

func TestGuiStatusReachableDocument(t *testing.T) {
	server, router := newGuiAPIServer(t, true)
	server.initSSEHub()
	server.sseHub.guiViewerAdd("host")

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
	if st.UptimeSeconds <= 0 {
		t.Errorf("uptime_seconds = %d, want > 0", st.UptimeSeconds)
	}
	if !strings.HasSuffix(st.Socket, "host.sock") {
		t.Errorf("socket = %q, want the host.sock path", st.Socket)
	}
}

func TestGuiStatusSessionAbsentReason(t *testing.T) {
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
	if st.Reachable || st.Reason != gui.SessionAbsentReason {
		t.Errorf("document = %+v, want unreachable with reason %q", st, gui.SessionAbsentReason)
	}
}

func TestGuiStatusBackendExitedReason(t *testing.T) {
	server, router := newGuiAPIServer(t, true)
	server.guiProbeFn = func(context.Context, string, string) (gui.Info, error) {
		return gui.Info{Reason: "not running"}, nil
	}

	rec := getJSON(t, router, "/api/gui/host")
	var st gui.Status
	if err := json.NewDecoder(rec.Body).Decode(&st); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if st.Reason != gui.BackendExitedReason("Xtigervnc") {
		t.Errorf("reason = %q, want %q", st.Reason, gui.BackendExitedReason("Xtigervnc"))
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

// The family is exactly GET /api/gui/{id} + POST /api/gui/{id}/restart —
// nothing else under /api/gui exists (mutations ride POST, on/off ride
// /api/settings).
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
