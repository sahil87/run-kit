package api

import (
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// TestMCPRouteUnset: without a wired handler /mcp answers 503 with the API
// error shape — never the SPA catch-all's 404.
func TestMCPRouteUnset(t *testing.T) {
	router, _ := NewTestRouterAndServer(slog.Default(), nil, nil, "test-host")
	req := httptest.NewRequest(http.MethodPost, "/mcp", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", rec.Code)
	}
	if got := strings.TrimSpace(rec.Body.String()); got != `{"error":"mcp transport not configured"}` {
		t.Errorf("body = %q", got)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
		t.Errorf("Content-Type = %q", ct)
	}
}

// TestMCPRouteDelegates: every method on /mcp — including the transport's
// POST/GET/DELETE and a non-transport PUT (chi Handle is method-agnostic; the
// SDK's own 405 for those is covered in internal/mcp) — reaches the wired
// handler with method and path intact.
func TestMCPRouteDelegates(t *testing.T) {
	router, server := NewTestRouterAndServer(slog.Default(), nil, nil, "test-host")
	type seen struct{ method, path string }
	var calls []seen
	server.SetMCPHandler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls = append(calls, seen{r.Method, r.URL.Path})
		w.WriteHeader(http.StatusNoContent)
	}))

	for _, method := range []string{http.MethodPost, http.MethodGet, http.MethodDelete, http.MethodPut} {
		req := httptest.NewRequest(method, "/mcp", nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		if rec.Code != http.StatusNoContent {
			t.Errorf("%s: status = %d, want the stub's 204", method, rec.Code)
		}
	}
	if len(calls) != 4 {
		t.Fatalf("stub saw %d calls, want 4", len(calls))
	}
	for i, method := range []string{http.MethodPost, http.MethodGet, http.MethodDelete, http.MethodPut} {
		if calls[i].method != method || calls[i].path != "/mcp" {
			t.Errorf("call %d = %+v, want %s /mcp", i, calls[i], method)
		}
	}
}

// TestMCPRouteCORSPreflight: the root CORS allowlist is unchanged — a
// preflight requesting DELETE gets no Access-Control-Allow-Methods: DELETE.
// MCP clients are not browsers; the preflight governs only browsers.
func TestMCPRouteCORSPreflight(t *testing.T) {
	router, _ := NewTestRouterAndServer(slog.Default(), nil, nil, "test-host")
	req := httptest.NewRequest(http.MethodOptions, "/mcp", nil)
	req.Header.Set("Origin", "http://127.0.0.1:5173")
	req.Header.Set("Access-Control-Request-Method", "DELETE")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if got := rec.Header().Get("Access-Control-Allow-Methods"); strings.Contains(got, "DELETE") {
		t.Errorf("Access-Control-Allow-Methods = %q, must not include DELETE", got)
	}
}
