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
