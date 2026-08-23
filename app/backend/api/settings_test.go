package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sort"
	"strings"
	"testing"

	"rk/internal/settings"
	"rk/internal/validate"
)

// isolateSettings points settings persistence at a throwaway HOME so the tests
// neither read nor clobber the developer's real ~/.config/run-kit/config.yaml.
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

// --- GET/POST /api/settings/server-flair ---

func postServerFlair(t *testing.T, router http.Handler, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/settings/server-flair", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

func TestSetServerFlair_persists(t *testing.T) {
	isolateSettings(t)
	router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})

	rec := postServerFlair(t, router, `{"server":"default","flair":"rain"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
	got := settings.GetServerFlair("default")
	if got == nil || *got != "rain" {
		t.Errorf("persisted flair = %v, want \"rain\"", got)
	}

	// The ?server= GET form returns the persisted token.
	req := httptest.NewRequest(http.MethodGet, "/api/settings/server-flair?server=default", nil)
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET status = %d, want %d", rec.Code, http.StatusOK)
	}
	var result struct {
		Flair *string `json:"flair"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&result); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if result.Flair == nil || *result.Flair != "rain" {
		t.Errorf("GET ?server=default flair = %v, want \"rain\"", result.Flair)
	}
}

func TestSetServerFlair_acceptsEveryUniversalToken(t *testing.T) {
	// The tokens come from validate.FlairValues itself, so this keeps covering
	// every universal token when the vocabulary grows.
	isolateSettings(t)
	router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})

	var tokens []string
	for token := range validate.FlairValues {
		if token != "" {
			tokens = append(tokens, token)
		}
	}
	sort.Strings(tokens)
	if len(tokens) == 0 {
		t.Fatal("validate.FlairValues has no named tokens")
	}
	for _, token := range tokens {
		rec := postServerFlair(t, router, `{"server":"default","flair":"`+token+`"}`)
		if rec.Code != http.StatusOK {
			t.Errorf("token %q: status = %d, want %d", token, rec.Code, http.StatusOK)
		}
	}
	last := tokens[len(tokens)-1]
	if got := settings.GetServerFlair("default"); got == nil || *got != last {
		t.Errorf("final persisted flair = %v, want %q", got, last)
	}
}

func TestSetServerFlair_rejectsUnknownToken(t *testing.T) {
	isolateSettings(t)
	router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})

	rec := postServerFlair(t, router, `{"server":"default","flair":"sparkle"}`)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
	if got := settings.GetServerFlair("default"); got != nil {
		t.Errorf("rejected flair persisted as %q, want nil", *got)
	}
}

func TestSetServerFlair_missingServer(t *testing.T) {
	isolateSettings(t)
	router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})

	rec := postServerFlair(t, router, `{"flair":"nyan"}`)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
}

func TestSetServerFlair_invalidJSON(t *testing.T) {
	isolateSettings(t)
	router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})

	rec := postServerFlair(t, router, `{"server":`)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
}

func TestSetServerFlair_clearsViaNullAndEmpty(t *testing.T) {
	for _, body := range []string{`{"server":"default","flair":null}`, `{"server":"default","flair":""}`} {
		isolateSettings(t)
		router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})

		rec := postServerFlair(t, router, `{"server":"default","flair":"nyan"}`)
		if rec.Code != http.StatusOK {
			t.Fatalf("seed: status = %d, want %d", rec.Code, http.StatusOK)
		}
		rec = postServerFlair(t, router, body)
		if rec.Code != http.StatusOK {
			t.Errorf("body %s: status = %d, want %d", body, rec.Code, http.StatusOK)
		}
		if got := settings.GetServerFlair("default"); got != nil {
			t.Errorf("body %s: flair persisted as %q, want nil", body, *got)
		}
	}
}

func TestGetServerFlair_mapForm(t *testing.T) {
	isolateSettings(t)
	router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})

	// Empty settings → empty map, never null.
	req := httptest.NewRequest(http.MethodGet, "/api/settings/server-flair", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET status = %d, want %d", rec.Code, http.StatusOK)
	}
	var emptyResult struct {
		Flairs map[string]string `json:"flairs"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&emptyResult); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if emptyResult.Flairs == nil || len(emptyResult.Flairs) != 0 {
		t.Errorf("GET flairs = %v, want empty non-nil map", emptyResult.Flairs)
	}

	// After a set, the map form carries the entry.
	if rec := postServerFlair(t, router, `{"server":"dev","flair":"cube"}`); rec.Code != http.StatusOK {
		t.Fatalf("seed: status = %d, want %d", rec.Code, http.StatusOK)
	}
	req = httptest.NewRequest(http.MethodGet, "/api/settings/server-flair", nil)
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	var result struct {
		Flairs map[string]string `json:"flairs"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&result); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if result.Flairs["dev"] != "cube" {
		t.Errorf("GET flairs[dev] = %q, want \"cube\"", result.Flairs["dev"])
	}
}

func TestGetServerFlair_unsetReturnsNull(t *testing.T) {
	isolateSettings(t)
	router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})

	req := httptest.NewRequest(http.MethodGet, "/api/settings/server-flair?server=default", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET status = %d, want %d", rec.Code, http.StatusOK)
	}
	var result struct {
		Flair *string `json:"flair"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&result); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if result.Flair != nil {
		t.Errorf("GET ?server=default flair = %v, want null", *result.Flair)
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
