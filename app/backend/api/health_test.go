package api

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"rk/internal/settings"
)

func TestHealthEndpoint(t *testing.T) {
	isolateSettings(t)
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))
	router := NewTestRouter(logger, nil, nil, "test-host")

	req := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusOK)
	}

	ct := rec.Header().Get("Content-Type")
	if ct != "application/json" {
		t.Errorf("Content-Type = %q, want %q", ct, "application/json")
	}

	var body map[string]string
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if body["status"] != "ok" {
		t.Errorf("body.status = %q, want %q", body["status"], "ok")
	}

	if body["hostname"] != "test-host" {
		t.Errorf("body.hostname = %q, want %q", body["hostname"], "test-host")
	}
}

func TestHealthEndpointEmptyHostname(t *testing.T) {
	isolateSettings(t)
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))
	router := NewTestRouter(logger, nil, nil, "")

	req := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusOK)
	}

	var body map[string]string
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if body["status"] != "ok" {
		t.Errorf("body.status = %q, want %q", body["status"], "ok")
	}

	if body["hostname"] != "" {
		t.Errorf("body.hostname = %q, want %q", body["hostname"], "")
	}
}

// The optional sshHost field rides the health response, resolved settings-
// first per request: settings.yaml `ssh_host` when non-empty, else the
// startup-seeded RK_SSH_HOST env value, else absent (not empty-valued).
func TestHealthEndpointSSHHost(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))

	t.Run("present when env-configured", func(t *testing.T) {
		isolateSettings(t)
		s := &Server{logger: logger, hostname: "test-host"}
		s.SetSSHHost("devbox")
		router := s.buildRouter()

		req := httptest.NewRequest(http.MethodGet, "/api/health", nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		var body map[string]string
		if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
			t.Fatalf("failed to decode response: %v", err)
		}
		if body["sshHost"] != "devbox" {
			t.Errorf("body.sshHost = %q, want %q", body["sshHost"], "devbox")
		}
	})

	t.Run("absent when unset", func(t *testing.T) {
		isolateSettings(t)
		router := NewTestRouter(logger, nil, nil, "test-host")

		req := httptest.NewRequest(http.MethodGet, "/api/health", nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		var body map[string]string
		if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
			t.Fatalf("failed to decode response: %v", err)
		}
		if _, present := body["sshHost"]; present {
			t.Errorf("body.sshHost present (%q), want absent", body["sshHost"])
		}
	})

	t.Run("settings value wins over env seed", func(t *testing.T) {
		isolateSettings(t)
		uiHost := "uibox"
		if err := settings.SetSSHHost(&uiHost); err != nil {
			t.Fatalf("SetSSHHost: %v", err)
		}
		s := &Server{logger: logger, hostname: "test-host"}
		s.SetSSHHost("envbox") // the RK_SSH_HOST startup seed
		router := s.buildRouter()

		req := httptest.NewRequest(http.MethodGet, "/api/health", nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		var body map[string]string
		if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
			t.Fatalf("failed to decode response: %v", err)
		}
		if body["sshHost"] != "uibox" {
			t.Errorf("body.sshHost = %q, want %q (settings-first)", body["sshHost"], "uibox")
		}
	})

	t.Run("env fallback after settings value cleared", func(t *testing.T) {
		isolateSettings(t)
		uiHost := "uibox"
		if err := settings.SetSSHHost(&uiHost); err != nil {
			t.Fatalf("SetSSHHost: %v", err)
		}
		if err := settings.SetSSHHost(nil); err != nil {
			t.Fatalf("SetSSHHost clear: %v", err)
		}
		s := &Server{logger: logger, hostname: "test-host"}
		s.SetSSHHost("envbox")
		router := s.buildRouter()

		req := httptest.NewRequest(http.MethodGet, "/api/health", nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		var body map[string]string
		if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
			t.Fatalf("failed to decode response: %v", err)
		}
		if body["sshHost"] != "envbox" {
			t.Errorf("body.sshHost = %q, want %q (env fallback)", body["sshHost"], "envbox")
		}
	})
}

// The optional instanceName field (settings.yaml `instance_name`, the display
// name override) rides the health response: present when set, absent (not
// empty-valued) when unset.
func TestHealthEndpointInstanceName(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))

	t.Run("present when set", func(t *testing.T) {
		isolateSettings(t)
		name := "my-box"
		if err := settings.SetInstanceName(&name); err != nil {
			t.Fatalf("SetInstanceName: %v", err)
		}
		router := NewTestRouter(logger, nil, nil, "test-host")

		req := httptest.NewRequest(http.MethodGet, "/api/health", nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		var body map[string]string
		if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
			t.Fatalf("failed to decode response: %v", err)
		}
		if body["instanceName"] != "my-box" {
			t.Errorf("body.instanceName = %q, want %q", body["instanceName"], "my-box")
		}
		if body["hostname"] != "test-host" {
			t.Errorf("body.hostname = %q, want %q (real hostname stays)", body["hostname"], "test-host")
		}
	})

	t.Run("absent when unset", func(t *testing.T) {
		isolateSettings(t)
		router := NewTestRouter(logger, nil, nil, "test-host")

		req := httptest.NewRequest(http.MethodGet, "/api/health", nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		var body map[string]string
		if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
			t.Fatalf("failed to decode response: %v", err)
		}
		if _, present := body["instanceName"]; present {
			t.Errorf("body.instanceName present (%q), want absent", body["instanceName"])
		}
	})
}

// The derived sshUser field (os/user.Current at startup) rides the health
// response beside sshHost: present when the lookup succeeded, absent (not
// empty-valued) when it failed — remote clients derive
// `${sshUser}@${location.hostname}` when RK_SSH_HOST is unset.
func TestHealthEndpointSSHUser(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))

	t.Run("present when derived", func(t *testing.T) {
		isolateSettings(t)
		s := &Server{logger: logger, hostname: "test-host"}
		s.SetSSHUser("sahil")
		router := s.buildRouter()

		req := httptest.NewRequest(http.MethodGet, "/api/health", nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		var body map[string]string
		if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
			t.Fatalf("failed to decode response: %v", err)
		}
		if body["sshUser"] != "sahil" {
			t.Errorf("body.sshUser = %q, want %q", body["sshUser"], "sahil")
		}
	})

	t.Run("absent when the lookup failed (empty)", func(t *testing.T) {
		isolateSettings(t)
		router := NewTestRouter(logger, nil, nil, "test-host")

		req := httptest.NewRequest(http.MethodGet, "/api/health", nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		var body map[string]string
		if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
			t.Fatalf("failed to decode response: %v", err)
		}
		if _, present := body["sshUser"]; present {
			t.Errorf("body.sshUser present (%q), want absent", body["sshUser"])
		}
	})
}
