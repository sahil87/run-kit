package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"rk/internal/settings"
)

// isolateSettings points settings persistence at a throwaway HOME so the tests
// neither read nor clobber the developer's real ~/.rk/settings.yaml.
func isolateSettings(t *testing.T) {
	t.Helper()
	t.Setenv("HOME", t.TempDir())
}

// --- POST /api/settings/theme ---

func TestSetTheme_roundTrip(t *testing.T) {
	isolateSettings(t)
	router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})

	body := `{"theme":"midnight"}`
	req := httptest.NewRequest(http.MethodPost, "/api/settings/theme", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
	var result map[string]string
	if err := json.NewDecoder(rec.Body).Decode(&result); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if result["status"] != "ok" {
		t.Errorf("status field = %q, want %q", result["status"], "ok")
	}
	if got := settings.Load().Theme; got != "midnight" {
		t.Errorf("persisted theme = %q, want %q", got, "midnight")
	}
}

func TestSetTheme_emptyRejected(t *testing.T) {
	isolateSettings(t)
	router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})

	for _, body := range []string{`{}`, `{"theme":""}`, `{"theme":"   "}`} {
		req := httptest.NewRequest(http.MethodPost, "/api/settings/theme", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusBadRequest {
			t.Errorf("body %s: status = %d, want %d", body, rec.Code, http.StatusBadRequest)
		}
	}
}

// --- POST /api/settings/server-color ---

func TestSetServerColor_persists(t *testing.T) {
	isolateSettings(t)
	router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})

	body := `{"server":"dev","color":"7"}`
	req := httptest.NewRequest(http.MethodPost, "/api/settings/server-color", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
	got := settings.GetServerColor("dev")
	if got == nil || *got != "7" {
		t.Errorf("persisted color = %v, want \"7\"", got)
	}
}

func TestSetServerColor_persistsBlend(t *testing.T) {
	isolateSettings(t)
	router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})

	body := `{"server":"dev","color":"1+3"}`
	req := httptest.NewRequest(http.MethodPost, "/api/settings/server-color", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
	got := settings.GetServerColor("dev")
	if got == nil || *got != "1+3" {
		t.Errorf("persisted blend color = %v, want \"1+3\"", got)
	}
}

func TestSetServerColor_rejectsMalformed(t *testing.T) {
	for _, bad := range []string{`{"server":"dev","color":"99"}`, `{"server":"dev","color":"1+"}`, `{"server":"dev","color":"x"}`, `{"server":"dev","color":"1+2+3"}`} {
		isolateSettings(t)
		router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})
		req := httptest.NewRequest(http.MethodPost, "/api/settings/server-color", strings.NewReader(bad))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("body %s: status = %d, want %d", bad, rec.Code, http.StatusBadRequest)
		}
	}
}

// --- GET/POST /api/settings/instance-color ---

func getInstanceColorViaAPI(t *testing.T, router http.Handler) *string {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/api/settings/instance-color", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET status = %d, want %d; body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
	var result struct {
		Color *string `json:"color"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&result); err != nil {
		t.Fatalf("decode: %v", err)
	}
	return result.Color
}

func TestInstanceColor_getUnsetReturnsNull(t *testing.T) {
	isolateSettings(t)
	router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})

	if got := getInstanceColorViaAPI(t, router); got != nil {
		t.Errorf("color = %q, want null", *got)
	}
}

func TestSetInstanceColor_persistsAndRoundTrips(t *testing.T) {
	isolateSettings(t)
	router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})

	for _, color := range []string{"5", "1+3"} {
		body := `{"color":"` + color + `"}`
		req := httptest.NewRequest(http.MethodPost, "/api/settings/instance-color", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("color %s: status = %d, want %d; body=%s", color, rec.Code, http.StatusOK, rec.Body.String())
		}
		if got := settings.GetInstanceColor(); got == nil || *got != color {
			t.Errorf("persisted color = %v, want %q", got, color)
		}
		if got := getInstanceColorViaAPI(t, router); got == nil || *got != color {
			t.Errorf("GET round-trip = %v, want %q", got, color)
		}
	}
}

func TestSetInstanceColor_nullClears(t *testing.T) {
	isolateSettings(t)
	router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})

	color := "4"
	if err := settings.SetInstanceColor(&color); err != nil {
		t.Fatalf("seed: %v", err)
	}

	body := `{"color":null}`
	req := httptest.NewRequest(http.MethodPost, "/api/settings/instance-color", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if got := settings.GetInstanceColor(); got != nil {
		t.Errorf("color after clear = %q, want nil", *got)
	}
	if got := getInstanceColorViaAPI(t, router); got != nil {
		t.Errorf("GET after clear = %q, want null", *got)
	}
}

func TestSetInstanceColor_rejectsMalformed(t *testing.T) {
	for _, bad := range []string{`{"color":"99"}`, `{"color":"1+"}`, `{"color":"x"}`, `{"color":"1+2+3"}`} {
		isolateSettings(t)
		router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})
		req := httptest.NewRequest(http.MethodPost, "/api/settings/instance-color", strings.NewReader(bad))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("body %s: status = %d, want %d", bad, rec.Code, http.StatusBadRequest)
		}
		if got := settings.GetInstanceColor(); got != nil {
			t.Errorf("body %s: malformed value persisted as %q, want nil", bad, *got)
		}
	}
}

func TestSetServerColor_missingServer(t *testing.T) {
	isolateSettings(t)
	router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})

	body := `{"color":"4"}`
	req := httptest.NewRequest(http.MethodPost, "/api/settings/server-color", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
}

// --- GET/POST /api/settings/ssh-host + /api/settings/instance-name (260723-o7q8) ---

// getScalarSettingViaAPI reads a per-key scalar settings endpoint and returns
// the named JSON field (nil = null). Shared by the ssh-host and instance-name
// round-trip tests.
func getScalarSettingViaAPI(t *testing.T, router http.Handler, path, field string) *string {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, path, nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET %s status = %d, want %d; body=%s", path, rec.Code, http.StatusOK, rec.Body.String())
	}
	var result map[string]*string
	if err := json.NewDecoder(rec.Body).Decode(&result); err != nil {
		t.Fatalf("decode: %v", err)
	}
	return result[field]
}

func postJSON(t *testing.T, router http.Handler, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

func TestSSHHost_getUnsetReturnsNull(t *testing.T) {
	isolateSettings(t)
	router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})

	if got := getScalarSettingViaAPI(t, router, "/api/settings/ssh-host", "sshHost"); got != nil {
		t.Errorf("sshHost = %q, want null", *got)
	}
}

func TestSetSSHHost_persistsAndRoundTrips(t *testing.T) {
	isolateSettings(t)
	router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})

	for _, host := range []string{"devbox", "user@host.example.com"} {
		rec := postJSON(t, router, "/api/settings/ssh-host", `{"sshHost":"`+host+`"}`)
		if rec.Code != http.StatusOK {
			t.Fatalf("host %s: status = %d, want %d; body=%s", host, rec.Code, http.StatusOK, rec.Body.String())
		}
		if got := settings.GetSSHHost(); got == nil || *got != host {
			t.Errorf("persisted sshHost = %v, want %q", got, host)
		}
		if got := getScalarSettingViaAPI(t, router, "/api/settings/ssh-host", "sshHost"); got == nil || *got != host {
			t.Errorf("GET round-trip = %v, want %q", got, host)
		}
	}
}

func TestSetSSHHost_trimsSurroundingWhitespace(t *testing.T) {
	isolateSettings(t)
	router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})

	rec := postJSON(t, router, "/api/settings/ssh-host", `{"sshHost":"  devbox  "}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if got := settings.GetSSHHost(); got == nil || *got != "devbox" {
		t.Errorf("persisted sshHost = %v, want trimmed \"devbox\"", got)
	}
}

func TestSetSSHHost_clears(t *testing.T) {
	isolateSettings(t)
	router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})

	// Both a JSON null and a trimmed-to-empty string clear the setting.
	for _, clearBody := range []string{`{"sshHost":null}`, `{"sshHost":"   "}`} {
		host := "devbox"
		if err := settings.SetSSHHost(&host); err != nil {
			t.Fatalf("seed: %v", err)
		}
		rec := postJSON(t, router, "/api/settings/ssh-host", clearBody)
		if rec.Code != http.StatusOK {
			t.Fatalf("body %s: status = %d, want %d; body=%s", clearBody, rec.Code, http.StatusOK, rec.Body.String())
		}
		if got := settings.GetSSHHost(); got != nil {
			t.Errorf("body %s: sshHost after clear = %q, want nil", clearBody, *got)
		}
	}
}

func TestSetSSHHost_rejectsInvalid(t *testing.T) {
	longHost := strings.Repeat("a", 254)
	for _, bad := range []string{
		`{"sshHost":"dev box"}`,          // embedded whitespace
		`{"sshHost":"dev\tbox"}`,         // tab (JSON escape → real tab)
		`{"sshHost":"dev\u0007box"}`,     // control char (JSON escape)
		`{"sshHost":"` + longHost + `"}`, // >253 chars
	} {
		isolateSettings(t)
		router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})
		rec := postJSON(t, router, "/api/settings/ssh-host", bad)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("body %s: status = %d, want %d", bad, rec.Code, http.StatusBadRequest)
		}
		if got := settings.GetSSHHost(); got != nil {
			t.Errorf("body %s: invalid value persisted as %q, want nil", bad, *got)
		}
	}
}

func TestInstanceName_getUnsetReturnsNull(t *testing.T) {
	isolateSettings(t)
	router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})

	if got := getScalarSettingViaAPI(t, router, "/api/settings/instance-name", "name"); got != nil {
		t.Errorf("name = %q, want null", *got)
	}
}

func TestSetInstanceName_persistsAndRoundTrips(t *testing.T) {
	isolateSettings(t)
	router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})

	// Inner spaces are legal in a display name.
	for _, name := range []string{"my-box", "dev mini"} {
		rec := postJSON(t, router, "/api/settings/instance-name", `{"name":"`+name+`"}`)
		if rec.Code != http.StatusOK {
			t.Fatalf("name %s: status = %d, want %d; body=%s", name, rec.Code, http.StatusOK, rec.Body.String())
		}
		if got := settings.GetInstanceName(); got == nil || *got != name {
			t.Errorf("persisted name = %v, want %q", got, name)
		}
		if got := getScalarSettingViaAPI(t, router, "/api/settings/instance-name", "name"); got == nil || *got != name {
			t.Errorf("GET round-trip = %v, want %q", got, name)
		}
	}
}

func TestSetInstanceName_clears(t *testing.T) {
	isolateSettings(t)
	router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})

	for _, clearBody := range []string{`{"name":null}`, `{"name":"   "}`} {
		name := "my-box"
		if err := settings.SetInstanceName(&name); err != nil {
			t.Fatalf("seed: %v", err)
		}
		rec := postJSON(t, router, "/api/settings/instance-name", clearBody)
		if rec.Code != http.StatusOK {
			t.Fatalf("body %s: status = %d, want %d; body=%s", clearBody, rec.Code, http.StatusOK, rec.Body.String())
		}
		if got := settings.GetInstanceName(); got != nil {
			t.Errorf("body %s: name after clear = %q, want nil", clearBody, *got)
		}
	}
}

func TestSetInstanceName_rejectsInvalid(t *testing.T) {
	longName := strings.Repeat("a", 254)
	for _, bad := range []string{
		`{"name":"my\u0007box"}`,      // control char (JSON escape)
		`{"name":"my\nbox"}`,          // newline (JSON escape)
		`{"name":"` + longName + `"}`, // >253 chars
	} {
		isolateSettings(t)
		router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})
		rec := postJSON(t, router, "/api/settings/instance-name", bad)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("body %s: status = %d, want %d", bad, rec.Code, http.StatusBadRequest)
		}
		if got := settings.GetInstanceName(); got != nil {
			t.Errorf("body %s: invalid value persisted as %q, want nil", bad, *got)
		}
	}
}
