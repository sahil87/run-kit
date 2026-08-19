package api

import (
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// --- Frame-check endpoint tests (GET /api/frame-check) ---

// stubFrameCheckDoer returns a canned response (or error) for any request,
// recording the last URL it was asked to fetch. httptest targets are
// loopback — which the handler rejects by contract — so the fetch itself is
// stubbed rather than performed.
type stubFrameCheckDoer struct {
	lastURL string
	resp    *http.Response
	err     error
}

func (s *stubFrameCheckDoer) Do(req *http.Request) (*http.Response, error) {
	s.lastURL = req.URL.String()
	if s.err != nil {
		return nil, s.err
	}
	if s.resp.Body == nil {
		s.resp.Body = io.NopCloser(strings.NewReader(""))
	}
	return s.resp, nil
}

// withStubFrameCheck swaps the package client for a stub and restores it.
func withStubFrameCheck(t *testing.T, doer frameCheckDoer) {
	t.Helper()
	saved := frameCheckClient
	frameCheckClient = doer
	t.Cleanup(func() { frameCheckClient = saved })
}

func getFrameCheck(t *testing.T, rawURL string) *httptest.ResponseRecorder {
	t.Helper()
	router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})
	req := httptest.NewRequest(http.MethodGet, "/api/frame-check?url="+rawURL, nil)
	req.Host = "viewer.example:3000"
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

// X-Frame-Options: DENY → embeddable:false with the directive echoed as the
// reason.
func TestFrameCheckXFODeny(t *testing.T) {
	stub := &stubFrameCheckDoer{resp: &http.Response{
		StatusCode: http.StatusOK,
		Header:     http.Header{"X-Frame-Options": []string{"DENY"}},
	}}
	withStubFrameCheck(t, stub)

	rec := getFrameCheck(t, "https%3A%2F%2Fgithub.com%2Fsahil87%2Frun-kit")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
	body := rec.Body.String()
	if !strings.Contains(body, `"reachable":true`) || !strings.Contains(body, `"embeddable":false`) {
		t.Errorf("body = %s, want reachable:true embeddable:false", body)
	}
	if !strings.Contains(body, `"status":200`) {
		t.Errorf("body = %s, want status:200", body)
	}
	if !strings.Contains(body, "X-Frame-Options: DENY") {
		t.Errorf("body = %s, want the XFO reason", body)
	}
	if stub.lastURL != "https://github.com/sahil87/run-kit" {
		t.Errorf("fetched %q, want the query url", stub.lastURL)
	}
}

// No blocking headers → embeddable:true, empty reason.
func TestFrameCheckNoHeadersEmbeddable(t *testing.T) {
	stub := &stubFrameCheckDoer{resp: &http.Response{
		StatusCode: http.StatusOK,
		Header:     http.Header{},
	}}
	withStubFrameCheck(t, stub)

	rec := getFrameCheck(t, "https%3A%2F%2Fshll.ai%2F")
	body := rec.Body.String()
	if !strings.Contains(body, `"reachable":true`) || !strings.Contains(body, `"embeddable":true`) {
		t.Errorf("body = %s, want reachable:true embeddable:true", body)
	}
}

// CSP frame-ancestors: `*` and an exact viewer-origin match allow; anything
// else (self-only, 'none', a foreign origin) blocks.
func TestFrameCheckCSPFrameAncestors(t *testing.T) {
	cases := []struct {
		name       string
		csp        string
		embeddable bool
	}{
		{"wildcard allows", "frame-ancestors *", true},
		{"viewer origin allows", "frame-ancestors http://viewer.example:3000", true},
		{"self blocks", "frame-ancestors 'self'", false},
		{"none blocks", "frame-ancestors 'none'", false},
		{"foreign origin blocks", "frame-ancestors https://other.example", false},
		{"matching scheme-source allows", "frame-ancestors http:", true},
		{"mismatched scheme-source blocks", "frame-ancestors https:", false},
		{"other directives ignored", "default-src 'self'; img-src *", true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			stub := &stubFrameCheckDoer{resp: &http.Response{
				StatusCode: http.StatusOK,
				Header:     http.Header{"Content-Security-Policy": []string{tc.csp}},
			}}
			withStubFrameCheck(t, stub)

			rec := getFrameCheck(t, "https%3A%2F%2Ftarget.example%2F")
			want := `"embeddable":false`
			if tc.embeddable {
				want = `"embeddable":true`
			}
			if !strings.Contains(rec.Body.String(), want) {
				t.Errorf("csp %q: body = %s, want %s", tc.csp, rec.Body.String(), want)
			}
		})
	}
}

// A connect failure answers reachable:false with a derived reason — never a
// 5xx from our own endpoint.
func TestFrameCheckUnreachableTarget(t *testing.T) {
	stub := &stubFrameCheckDoer{err: errors.New("dial tcp 203.0.113.1:443: connect: connection refused")}
	withStubFrameCheck(t, stub)

	rec := getFrameCheck(t, "https%3A%2F%2Fdead.example%2F")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d (probe-target failure is a 200 answer)", rec.Code, http.StatusOK)
	}
	body := rec.Body.String()
	if !strings.Contains(body, `"reachable":false`) || !strings.Contains(body, `"embeddable":false`) {
		t.Errorf("body = %s, want reachable:false embeddable:false", body)
	}
	if !strings.Contains(body, "connect failed") {
		t.Errorf("body = %s, want a connect-failure reason", body)
	}
}

// Loopback targets (localhost names and loopback IPs) and non-http(s) or
// non-absolute urls are rejected with 400 before any fetch.
func TestFrameCheckRejects(t *testing.T) {
	stub := &stubFrameCheckDoer{resp: &http.Response{StatusCode: http.StatusOK, Header: http.Header{}}}
	withStubFrameCheck(t, stub)

	rejected := []string{
		"",                                     // missing
		"javascript%3Aalert(1)",                // non-http scheme
		"%2Fproxy%2F3000%2F",                   // root-relative (not absolute)
		"http%3A%2F%2Flocalhost%3A3000%2F",     // loopback name
		"http%3A%2F%2F127.0.0.1%3A3000%2F",     // loopback IP
		"http%3A%2F%2F%5B%3A%3A1%5D%3A3000%2F", // IPv6 loopback
		"http%3A%2F%2Fapp.localhost%2F",        // *.localhost subname
		"ftp%3A%2F%2Fexample.com%2Fx",          // other scheme
	}
	for _, raw := range rejected {
		rec := getFrameCheck(t, raw)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("reject %q: status = %d, want %d", raw, rec.Code, http.StatusBadRequest)
		}
	}
	if stub.lastURL != "" {
		t.Errorf("rejected urls must never be fetched, got %q", stub.lastURL)
	}
}

// The viewer origin is derived from the inbound request's scheme + Host and
// is what a CSP frame-ancestors list is matched against.
func TestFrameCheckViewerOriginFromRequest(t *testing.T) {
	stub := &stubFrameCheckDoer{resp: &http.Response{
		StatusCode: http.StatusOK,
		Header:     http.Header{"Content-Security-Policy": []string{"frame-ancestors https://viewer.example:3000"}},
	}}
	withStubFrameCheck(t, stub)

	router := newTestRouter(&mockSessionFetcher{}, &mockTmuxOps{})
	req := httptest.NewRequest(http.MethodGet, "/api/frame-check?url=https%3A%2F%2Ftarget.example%2F", nil)
	req.Host = "viewer.example:3000"
	req.Header.Set("X-Forwarded-Proto", "https")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if !strings.Contains(rec.Body.String(), `"embeddable":true`) {
		t.Errorf("body = %s, want embeddable:true (forwarded-proto origin match)", rec.Body.String())
	}
}
