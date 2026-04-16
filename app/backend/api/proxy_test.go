package api

import (
	"bytes"
	"compress/gzip"
	"io"
	"net/http"
	"net/http/httptest"
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
		},
		Body: io.NopCloser(bytes.NewReader(buf.Bytes())),
	}

	if err := fn(resp); err != nil {
		t.Fatalf("ModifyResponse error: %v", err)
	}

	// Result should be gzip-compressed
	gr, err := gzip.NewReader(resp.Body)
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
