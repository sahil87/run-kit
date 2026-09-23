package api

import (
	"bytes"
	"compress/gzip"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"testing"
)

// upstreamPort extracts the loopback port an httptest.Server bound to.
func upstreamPort(t *testing.T, srv *httptest.Server) int {
	t.Helper()
	u, err := url.Parse(srv.URL)
	if err != nil {
		t.Fatalf("parse upstream URL: %v", err)
	}
	port, err := strconv.Atoi(u.Port())
	if err != nil {
		t.Fatalf("upstream port: %v", err)
	}
	return port
}

// TestSubdomainRouting_matchProxiesAtRoot proves a "{port}.localhost" Host is
// reverse-proxied to 127.0.0.1:{port} AT ROOT with the Host rewritten, frame
// headers stripped, and the host-swap shim injected into HTML.
func TestSubdomainRouting_matchProxiesAtRoot(t *testing.T) {
	var gotPath, gotHost string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotHost = r.Host
		w.Header().Set("Content-Type", "text/html")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; frame-ancestors 'none'")
		_, _ = io.WriteString(w, "<html><head></head><body>app</body></html>")
	}))
	defer upstream.Close()
	port := upstreamPort(t, upstream)

	orig := hostRoutingBaseDomainFn
	hostRoutingBaseDomainFn = func() string { return "" }
	defer func() { hostRoutingBaseDomainFn = orig }()

	fellThrough := false
	h := subdomainRoutingMiddleware(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		fellThrough = true
	}))

	req := httptest.NewRequest(http.MethodGet, "http://x/file2/editor", nil)
	req.Host = strconv.Itoa(port) + ".localhost:3000"
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if fellThrough {
		t.Fatal("subdomain Host fell through to the next handler")
	}
	if gotPath != "/file2/editor" {
		t.Errorf("upstream path = %q, want /file2/editor (root, no prefix)", gotPath)
	}
	if gotHost != "127.0.0.1:"+strconv.Itoa(port) {
		t.Errorf("upstream Host = %q, want 127.0.0.1:%d (rewritten)", gotHost, port)
	}
	res := rec.Result()
	if res.Header.Get("X-Frame-Options") != "" {
		t.Error("X-Frame-Options not stripped")
	}
	csp := res.Header.Get("Content-Security-Policy")
	if strings.Contains(csp, "frame-ancestors") {
		t.Errorf("frame-ancestors not stripped from CSP: %q", csp)
	}
	if !strings.Contains(csp, "default-src") {
		t.Errorf("non-frame CSP directives lost: %q", csp)
	}
	body, _ := io.ReadAll(res.Body)
	if !strings.Contains(string(body), "__rkHostSwap") {
		t.Errorf("host-swap shim not injected into HTML: %q", body)
	}
	if idx := strings.Index(string(body), "<head>"); idx == -1 || !strings.Contains(string(body)[idx:idx+40], "<script") {
		t.Error("shim not injected as the first child of <head>")
	}
	if got := res.Header.Get("Content-Length"); got != strconv.Itoa(len(body)) {
		t.Errorf("Content-Length = %q, want %d (re-synced)", got, len(body))
	}
}

// TestSubdomainRouting_gzipReSync proves a gzip'd HTML response still injects the
// shim and re-syncs Content-Length after re-compression.
func TestSubdomainRouting_gzipReSync(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var buf bytes.Buffer
		zw := gzip.NewWriter(&buf)
		_, _ = zw.Write([]byte("<html><head></head><body>gz</body></html>"))
		zw.Close()
		w.Header().Set("Content-Type", "text/html")
		w.Header().Set("Content-Encoding", "gzip")
		w.Header().Set("Content-Length", strconv.Itoa(buf.Len()))
		_, _ = w.Write(buf.Bytes())
	}))
	defer upstream.Close()
	port := upstreamPort(t, upstream)

	orig := hostRoutingBaseDomainFn
	hostRoutingBaseDomainFn = func() string { return "" }
	defer func() { hostRoutingBaseDomainFn = orig }()

	h := subdomainRoutingMiddleware(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	req := httptest.NewRequest(http.MethodGet, "http://x/", nil)
	req.Host = strconv.Itoa(port) + ".localhost"
	// Explicit Accept-Encoding stops Go's transport from transparently
	// decompressing the upstream gzip, so ModifyResponse sees it encoded.
	req.Header.Set("Accept-Encoding", "gzip")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	res := rec.Result()
	if res.Header.Get("Content-Encoding") != "gzip" {
		t.Fatalf("Content-Encoding = %q, want gzip", res.Header.Get("Content-Encoding"))
	}
	raw, _ := io.ReadAll(res.Body)
	if got := res.Header.Get("Content-Length"); got != strconv.Itoa(len(raw)) {
		t.Errorf("Content-Length = %q, want %d (re-synced to compressed length)", got, len(raw))
	}
	zr, err := gzip.NewReader(bytes.NewReader(raw))
	if err != nil {
		t.Fatalf("re-inflate: %v", err)
	}
	body, _ := io.ReadAll(zr)
	if !strings.Contains(string(body), "__rkHostSwap") {
		t.Errorf("shim missing after gzip re-sync: %q", body)
	}
}

// TestSubdomainRouting_baseDomain proves a configured base_domain is matched in
// addition to *.localhost.
func TestSubdomainRouting_baseDomain(t *testing.T) {
	var served bool
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		served = true
		w.Header().Set("Content-Type", "text/plain")
		_, _ = io.WriteString(w, "ok")
	}))
	defer upstream.Close()
	port := upstreamPort(t, upstream)

	orig := hostRoutingBaseDomainFn
	hostRoutingBaseDomainFn = func() string { return "apps.example.com" }
	defer func() { hostRoutingBaseDomainFn = orig }()

	h := subdomainRoutingMiddleware(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	req := httptest.NewRequest(http.MethodGet, "http://x/", nil)
	req.Host = strconv.Itoa(port) + ".apps.example.com"
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if !served {
		t.Error("base_domain subdomain was not routed to the upstream")
	}
}

// TestPortAuthorityRouting proves the tailscale/own-host shape "{base}:{port}"
// routes to 127.0.0.1:{port} at root, while the bare host (UI), a non-matching
// host, and the default web ports fall through — so the run-kit UI served over
// the same host URL can never be hijacked.
func TestPortAuthorityRouting(t *testing.T) {
	var served bool
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		served = true
		w.Header().Set("Content-Type", "text/plain")
		_, _ = io.WriteString(w, "ok")
	}))
	defer upstream.Close()
	port := upstreamPort(t, upstream)

	const base = "dev-ws-x.tail1.ts.net"
	orig := hostRoutingBaseDomainFn
	hostRoutingBaseDomainFn = func() string { return base }
	defer func() { hostRoutingBaseDomainFn = orig }()

	// Match: {base}:{app-port} → routed to the upstream at root.
	h := subdomainRoutingMiddleware(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	req := httptest.NewRequest(http.MethodGet, "http://x/deep/route", nil)
	req.Host = base + ":" + strconv.Itoa(port)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if !served {
		t.Fatalf("port-authority %s:%d was not routed to the upstream", base, port)
	}

	// Fall-through: bare host (UI over the host URL), :443, and a non-matching
	// host must NOT be host-routed — they reach the next handler.
	for _, host := range []string{
		base,            // bare host — the dashboard UI over the host URL
		base + ":443",   // default https port — UI, excluded defensively
		base + ":80",    // default http port — excluded defensively
		"other.ts.net:" + strconv.Itoa(port), // non-matching host
	} {
		t.Run(host, func(t *testing.T) {
			fell := false
			hh := subdomainRoutingMiddleware(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				fell = true
				w.WriteHeader(http.StatusTeapot)
			}))
			req := httptest.NewRequest(http.MethodGet, "http://x/", nil)
			req.Host = host
			rec := httptest.NewRecorder()
			hh.ServeHTTP(rec, req)
			if !fell {
				t.Errorf("Host %q was host-routed but must fall through (UI safety)", host)
			}
		})
	}
}

// TestSubdomainRouting_bareHostFallsThrough proves the dashboard host and any
// non-{port}.{base} host pass through to the next handler untouched.
func TestSubdomainRouting_bareHostFallsThrough(t *testing.T) {
	orig := hostRoutingBaseDomainFn
	hostRoutingBaseDomainFn = func() string { return "apps.example.com" }
	defer func() { hostRoutingBaseDomainFn = orig }()

	for _, host := range []string{
		"localhost:3000",       // bare dashboard host
		"apps.example.com",     // bare wildcard base
		"dash.5173.localhost",  // multi-label prefix, not a bare port
		"notaport.localhost",   // non-numeric label
		"example.org:3000",     // unrelated host
		"my-box.tail1.ts.net",  // magicdns — not host-routed
	} {
		t.Run(host, func(t *testing.T) {
			fell := false
			h := subdomainRoutingMiddleware(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				fell = true
				w.WriteHeader(http.StatusTeapot)
			}))
			req := httptest.NewRequest(http.MethodGet, "http://x/", nil)
			req.Host = host
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, req)
			if !fell {
				t.Errorf("Host %q did not fall through", host)
			}
		})
	}
}

// TestSplitSubdomainCandidate covers the shape parser: it extracts the port and
// tail for a {port}.{tail} host and rejects everything else WITHOUT any config
// read (the tail comparison is the middleware's job).
func TestSplitSubdomainCandidate(t *testing.T) {
	cases := []struct {
		host     string
		wantPort int
		wantTail string
		wantOK   bool
	}{
		{"5173.localhost", 5173, "localhost", true},
		{"5173.localhost:3000", 5173, "localhost", true},
		{"4295.APPS.EXAMPLE.COM", 4295, "apps.example.com", true},
		{"localhost:3000", 0, "", false},
		{"dash.5173.localhost", 0, "", false},
		{"99999.localhost", 0, "", false},
		{"[::1]:3000", 0, "", false},
		{"192.168.1.5:3000", 0, "", false}, // IPv4 literal — not a subdomain
		{"127.0.0.1", 0, "", false},
	}
	for _, c := range cases {
		port, tail, ok := splitSubdomainCandidate(c.host)
		if port != c.wantPort || tail != c.wantTail || ok != c.wantOK {
			t.Errorf("splitSubdomainCandidate(%q) = %d,%q,%v want %d,%q,%v",
				c.host, port, tail, ok, c.wantPort, c.wantTail, c.wantOK)
		}
	}
}

// TestSubdomainRouting_noConfigReadOnCommonPath proves the base_domain read is
// NOT reached for bare hosts, IP hosts, or a *.localhost subdomain — only a
// non-localhost {port}.{tail} shape consults it.
func TestSubdomainRouting_noConfigReadOnCommonPath(t *testing.T) {
	orig := hostRoutingBaseDomainFn
	reads := 0
	hostRoutingBaseDomainFn = func() string { reads++; return "apps.example.com" }
	defer func() { hostRoutingBaseDomainFn = orig }()

	h := subdomainRoutingMiddleware(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	// None of these reach the config read: bare host, API path host, IPv4 host,
	// and — critically — the zero-config localhost subdomain shape.
	for _, host := range []string{"localhost:3000", "192.168.1.5:3000", "example.com", "12.localhost:3000"} {
		req := httptest.NewRequest(http.MethodGet, "http://x/", nil)
		req.Host = host
		h.ServeHTTP(httptest.NewRecorder(), req)
	}
	if reads != 0 {
		t.Errorf("base_domain read %d times on the common path, want 0", reads)
	}
	// A non-localhost subdomain shape DOES consult it (rare path).
	req := httptest.NewRequest(http.MethodGet, "http://x/", nil)
	req.Host = "5173.apps.example.com"
	h.ServeHTTP(httptest.NewRecorder(), req)
	if reads != 1 {
		t.Errorf("base_domain read %d times for a non-localhost subdomain, want 1", reads)
	}
}

// TestHostSwapShimHostGeneric proves the embedded host-swap shim is host-generic
// (T019): it derives its base from location.hostname at runtime and carries no
// build-time placeholder, and exposes __rkHostSwap for the e2e.
func TestHostSwapShimHostGeneric(t *testing.T) {
	if strings.Contains(proxyHostSwapJS, "__RK_") {
		t.Error("host-swap shim still carries a build-time placeholder — not host-generic")
	}
	for _, want := range []string{"location.hostname", "__rkHostSwap", "Reflect.construct"} {
		if !strings.Contains(proxyHostSwapJS, want) {
			t.Errorf("host-swap shim missing %q", want)
		}
	}
}
