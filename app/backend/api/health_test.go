package api

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
)

func TestHealthEndpoint(t *testing.T) {
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

// The optional sshHost field (RK_SSH_HOST) rides the health response: present
// when configured, absent (not empty-valued) when unset.
func TestHealthEndpointSSHHost(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))

	t.Run("present when configured", func(t *testing.T) {
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
}

// The derived sshUser field (os/user.Current at startup) rides the health
// response beside sshHost: present when the lookup succeeded, absent (not
// empty-valued) when it failed — remote clients derive
// `${sshUser}@${location.hostname}` when RK_SSH_HOST is unset.
func TestHealthEndpointSSHUser(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))

	t.Run("present when derived", func(t *testing.T) {
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
