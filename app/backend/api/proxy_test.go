package api

import (
	"bytes"
	"compress/gzip"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
)

func TestProxyInvalidPort(t *testing.T) {
	router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})

	tests := []struct {
		name string
		path string
	}{
		{"non-numeric", "/proxy/abc/path"},
		{"zero", "/proxy/0/path"},
		{"too large", "/proxy/99999/path"},
		{"negative", "/proxy/-1/path"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, tt.path, nil)
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, req)

			if rec.Code != http.StatusBadRequest {
				t.Errorf("status = %d, want %d", rec.Code, http.StatusBadRequest)
			}
		})
	}
}

func TestRewriteHTML(t *testing.T) {
	tests := []struct {
		name  string
		input string
		port  int
		want  string
	}{
		{
			name:  "rewrite http://localhost",
			input: `<a href="http://localhost:8080/api">link</a>`,
			port:  8080,
			want:  `<a href="/proxy/8080/api">link</a>`,
		},
		{
			name:  "rewrite //localhost",
			input: `<script src="//localhost:3000/bundle.js"></script>`,
			port:  3000,
			want:  `<script src="/proxy/3000/bundle.js"></script>`,
		},
		{
			name:  "rewrite 127.0.0.1",
			input: `<img src="http://127.0.0.1:5000/logo.png">`,
			port:  5000,
			want:  `<img src="/proxy/5000/logo.png">`,
		},
		{
			name:  "multiple rewrites",
			input: `<a href="http://localhost:8080/a">a</a><a href="http://localhost:8080/b">b</a>`,
			port:  8080,
			want:  `<a href="/proxy/8080/a">a</a><a href="/proxy/8080/b">b</a>`,
		},
		{
			name:  "no match passthrough",
			input: `<a href="https://example.com/path">external</a>`,
			port:  8080,
			want:  `<a href="https://example.com/path">external</a>`,
		},
		{
			name:  "different port also rewritten",
			input: `<link href="http://localhost:3001/style.css">`,
			port:  8080, // proxy port doesn't restrict which ports get rewritten
			want:  `<link href="/proxy/3001/style.css">`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := string(rewriteHTML([]byte(tt.input), tt.port))
			if got != tt.want {
				t.Errorf("rewriteHTML() =\n%s\nwant:\n%s", got, tt.want)
			}
		})
	}
}

func TestModifyResponseHTMLRewrite(t *testing.T) {
	fn := makeModifyResponse(8080)

	body := `<a href="http://localhost:8080/docs">docs</a>`
	resp := &http.Response{
		Header: http.Header{"Content-Type": []string{"text/html; charset=utf-8"}},
		Body:   io.NopCloser(bytes.NewReader([]byte(body))),
	}

	if err := fn(resp); err != nil {
		t.Fatalf("ModifyResponse error: %v", err)
	}

	result, _ := io.ReadAll(resp.Body)
	want := `<a href="/proxy/8080/docs">docs</a>`
	if string(result) != want {
		t.Errorf("body = %q, want %q", string(result), want)
	}
	assertContentLength(t, resp, len(result))
}

// TestModifyResponseStaleContentLengthHeader is the regression test for the
// blank-iframe bug: the rewrite shrinks the body, and the original upstream
// Content-Length header must be overwritten to match the rewritten body —
// httputil.ReverseProxy copies the header map (not resp.ContentLength) to the
// client, so a stale header causes ERR_CONTENT_LENGTH_MISMATCH in browsers.
func TestModifyResponseStaleContentLengthHeader(t *testing.T) {
	fn := makeModifyResponse(8080)

	body := `<img src="http://127.0.0.1:5000/logo.png">`
	resp := &http.Response{
		Header: http.Header{
			"Content-Type":   []string{"text/html; charset=utf-8"},
			"Content-Length": []string{strconv.Itoa(len(body))},
		},
		Body:          io.NopCloser(bytes.NewReader([]byte(body))),
		ContentLength: int64(len(body)),
	}

	if err := fn(resp); err != nil {
		t.Fatalf("ModifyResponse error: %v", err)
	}

	result, _ := io.ReadAll(resp.Body)
	want := `<img src="/proxy/5000/logo.png">`
	if string(result) != want {
		t.Errorf("body = %q, want %q", string(result), want)
	}
	if len(result) >= len(body) {
		t.Fatalf("rewrite did not shrink body: got %d, original %d", len(result), len(body))
	}
	assertContentLength(t, resp, len(result))
}

// TestModifyResponseHEADPassthrough guards HTTP HEAD semantics: a HEAD
// response has an empty body while its Content-Length header advertises the
// GET entity length. The rewrite must pass HEAD through untouched — an
// unconditional header sync would overwrite the entity length with 0.
func TestModifyResponseHEADPassthrough(t *testing.T) {
	fn := makeModifyResponse(8080)

	const entityLength = "1234"
	resp := &http.Response{
		Request: &http.Request{Method: http.MethodHead},
		Header: http.Header{
			"Content-Type":   []string{"text/html; charset=utf-8"},
			"Content-Length": []string{entityLength},
		},
		Body:          io.NopCloser(bytes.NewReader(nil)),
		ContentLength: 1234,
	}

	if err := fn(resp); err != nil {
		t.Fatalf("ModifyResponse error: %v", err)
	}

	if got := resp.Header.Get("Content-Length"); got != entityLength {
		t.Errorf("Content-Length header = %q, want %q (upstream entity length preserved)", got, entityLength)
	}
	if resp.ContentLength != 1234 {
		t.Errorf("ContentLength field = %d, want 1234 (untouched)", resp.ContentLength)
	}
	result, _ := io.ReadAll(resp.Body)
	if len(result) != 0 {
		t.Errorf("body length = %d, want 0 (HEAD body stays empty)", len(result))
	}
}

func TestModifyResponseNonHTMLPassthrough(t *testing.T) {
	fn := makeModifyResponse(8080)

	body := `{"url": "http://localhost:8080/api"}`
	resp := &http.Response{
		Header: http.Header{"Content-Type": []string{"application/json"}},
		Body:   io.NopCloser(bytes.NewReader([]byte(body))),
	}

	if err := fn(resp); err != nil {
		t.Fatalf("ModifyResponse error: %v", err)
	}

	result, _ := io.ReadAll(resp.Body)
	if string(result) != body {
		t.Errorf("body = %q, want %q (unchanged)", string(result), body)
	}
}

func TestModifyResponseGzipHTML(t *testing.T) {
	fn := makeModifyResponse(8080)

	html := `<a href="http://localhost:8080/docs">docs</a>`
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	gz.Write([]byte(html))
	gz.Close()

	resp := &http.Response{
		Header: http.Header{
			"Content-Type":     []string{"text/html"},
			"Content-Encoding": []string{"gzip"},
			"Content-Length":   []string{strconv.Itoa(buf.Len())},
		},
		Body:          io.NopCloser(bytes.NewReader(buf.Bytes())),
		ContentLength: int64(buf.Len()),
	}

	if err := fn(resp); err != nil {
		t.Fatalf("ModifyResponse error: %v", err)
	}

	// Content-Length must match the re-compressed wire bytes, not the
	// decompressed HTML — read the raw body before decoding.
	wire, _ := io.ReadAll(resp.Body)
	assertContentLength(t, resp, len(wire))

	// Result should be gzip-compressed
	gr, err := gzip.NewReader(bytes.NewReader(wire))
	if err != nil {
		t.Fatalf("gzip.NewReader error: %v", err)
	}
	result, _ := io.ReadAll(gr)
	gr.Close()

	want := `<a href="/proxy/8080/docs">docs</a>`
	if string(result) != want {
		t.Errorf("body = %q, want %q", string(result), want)
	}
}

// assertContentLength asserts that both the Content-Length header (what
// httputil.ReverseProxy copies to the client) and the ContentLength field
// equal the exact byte length of the final wire body.
func assertContentLength(t *testing.T, resp *http.Response, wireLen int) {
	t.Helper()
	if got, want := resp.Header.Get("Content-Length"), strconv.Itoa(wireLen); got != want {
		t.Errorf("Content-Length header = %q, want %q", got, want)
	}
	if resp.ContentLength != int64(wireLen) {
		t.Errorf("ContentLength field = %d, want %d", resp.ContentLength, wireLen)
	}
}

func TestGetOrCreateProxyCaching(t *testing.T) {
	p1 := getOrCreateProxy(9999)
	p2 := getOrCreateProxy(9999)
	if p1 != p2 {
		t.Error("expected same proxy instance for same port")
	}

	p3 := getOrCreateProxy(9998)
	if p1 == p3 {
		t.Error("expected different proxy instance for different port")
	}
}

// TestProxySetsXForwardedHost proves the Rewrite hook sets X-Forwarded-Host
// (and X-Forwarded-Proto) from the INBOUND request — code-server's
// authenticateOrigin compares the browser's Origin host against
// Forwarded → X-Forwarded-Host → Host and 403s every WS handshake / POST
// without it (spiked 2026-08-11; the upgrade path shares this Rewrite hook).
func TestProxySetsXForwardedHost(t *testing.T) {
	var gotHost, gotProto string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotHost = r.Header.Get("X-Forwarded-Host")
		gotProto = r.Header.Get("X-Forwarded-Proto")
		w.WriteHeader(http.StatusOK)
	}))
	defer upstream.Close()

	// Point the (cached) proxy at the upstream's real port.
	portStr := strings.TrimPrefix(upstream.URL, "http://127.0.0.1:")

	router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})
	req := httptest.NewRequest(http.MethodGet, "/proxy/"+portStr+"/stable", nil)
	req.Host = "rk.example:3000"
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	if gotHost != "rk.example:3000" {
		t.Errorf("X-Forwarded-Host = %q, want %q (the inbound Host)", gotHost, "rk.example:3000")
	}
	if gotProto != "http" {
		t.Errorf("X-Forwarded-Proto = %q, want %q", gotProto, "http")
	}
}

// TestProxyTrailingSlashRedirect proves /proxy/{port} (no trailing slash)
// redirects to /proxy/{port}/ with the query string preserved, so
// relative-base apps (code-server) resolve "./x" against the right base for
// any client — and that the slashed path proxies without a redirect.
func TestProxyTrailingSlashRedirect(t *testing.T) {
	router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})

	// No trailing slash → 308 with Location preserving the query.
	req := httptest.NewRequest(http.MethodGet, "/proxy/8080?folder=/repo", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusPermanentRedirect {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusPermanentRedirect)
	}
	if loc := rec.Header().Get("Location"); loc != "/proxy/8080/?folder=/repo" {
		t.Errorf("Location = %q, want %q", loc, "/proxy/8080/?folder=/repo")
	}

	// No query → bare trailing-slash Location.
	req = httptest.NewRequest(http.MethodGet, "/proxy/8080", nil)
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusPermanentRedirect {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusPermanentRedirect)
	}
	if loc := rec.Header().Get("Location"); loc != "/proxy/8080/" {
		t.Errorf("Location = %q, want %q", loc, "/proxy/8080/")
	}

	// The slashed path is proxied, never redirected (no loop). Nothing listens
	// on 8080, so a proxy attempt surfaces as 502 Bad Gateway — anything but a
	// redirect proves the branch was skipped.
	req = httptest.NewRequest(http.MethodGet, "/proxy/8080/", nil)
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code == http.StatusPermanentRedirect || rec.Code == http.StatusMovedPermanently {
		t.Errorf("slashed path redirected (loop risk): status = %d", rec.Code)
	}
}
