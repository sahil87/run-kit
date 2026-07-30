package api

import (
	"bytes"
	"compress/gzip"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
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
