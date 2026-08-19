package api

import (
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Frame-refusal probe (R2): GET /api/frame-check?url=… fetches an absolute
// EXTERNAL http(s) URL server-side and reports whether the response headers
// block framing — cross-origin iframes expose no load-failure signal to the
// parent page, so a header read is the only reliable detector. Read-only
// (GET per constitution §IX), stdlib HTTP with the project's timeout
// discipline (no exec), response body discarded (headers are the payload).
//
// Loopback targets are REJECTED (400): loopback content rides /proxy and is
// never probed, and refusing it bounds the server-side-fetch (SSRF-shaped)
// surface of an endpoint that takes arbitrary URLs. The response carries
// only derived fields (embeddable/status/reason), never raw headers beyond
// the blocking-directive echo the frontend shows in its error state.

const (
	// frameCheckTimeout bounds the whole probe (dial + headers). 5s keeps it
	// inside the API route-blocking budget.
	frameCheckTimeout = 5 * time.Second
	// frameCheckMaxRedirects caps redirect chasing; the cap-th hit answers
	// with the redirect response itself (ErrUseLastResponse) so a redirect
	// loop surfaces as a terminal status instead of an error.
	frameCheckMaxRedirects = 5
)

// frameCheckResult is the GET /api/frame-check response body.
type frameCheckResult struct {
	Reachable  bool   `json:"reachable"`
	Embeddable bool   `json:"embeddable"`
	Status     int    `json:"status"`
	Reason     string `json:"reason"`
}

// frameCheckDoer is the fetch seam — tests substitute a stub (httptest
// targets are loopback, which the handler rejects by contract, so the
// network call itself must be replaceable).
type frameCheckDoer interface {
	Do(req *http.Request) (*http.Response, error)
}

// frameCheckClient is the probe's HTTP client. A package var so tests can
// swap in a stub; production uses newFrameCheckClient().
var frameCheckClient frameCheckDoer = newFrameCheckClient()

func newFrameCheckClient() *http.Client {
	return &http.Client{
		Timeout: frameCheckTimeout,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= frameCheckMaxRedirects {
				return http.ErrUseLastResponse
			}
			// Re-apply the handler's own entry validation to every redirect
			// target: without this, a remote URL that 302s to a loopback or
			// non-http(s) address would bypass the documented probe bound.
			if req.URL.Scheme != "http" && req.URL.Scheme != "https" {
				return fmt.Errorf("redirect to non-http(s) target refused")
			}
			if isLoopbackHost(req.URL.Hostname()) {
				return fmt.Errorf("redirect to loopback target refused")
			}
			return nil
		},
	}
}

// handleFrameCheck serves GET /api/frame-check?url=….
func (s *Server) handleFrameCheck(w http.ResponseWriter, r *http.Request) {
	raw := r.URL.Query().Get("url")
	u, err := url.Parse(raw)
	if raw == "" || err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") {
		writeError(w, http.StatusBadRequest, "url must be an absolute http:// or https:// URL")
		return
	}
	if isLoopbackHost(u.Hostname()) {
		writeError(w, http.StatusBadRequest, "loopback targets are not probed — they ride /proxy")
		return
	}

	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, raw, nil)
	if err != nil {
		writeError(w, http.StatusBadRequest, "url must be an absolute http:// or https:// URL")
		return
	}
	// Headers are the payload; a HEAD is tempting but servers answer HEAD
	// inconsistently, so GET with an immediately discarded body.
	resp, err := frameCheckClient.Do(req)
	if err != nil {
		// A probe-target failure is the answer, not our error: reachable:false
		// with the derived reason, never a 5xx from this endpoint.
		writeJSON(w, http.StatusOK, frameCheckResult{
			Reachable:  false,
			Embeddable: false,
			Status:     0,
			Reason:     "connect failed: " + err.Error(),
		})
		return
	}
	defer resp.Body.Close()
	// Drain a sliver for connection reuse, then discard — the body is never read.
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 512))

	reason, blocked := frameBlockReason(resp.Header, requestOrigin(r))
	writeJSON(w, http.StatusOK, frameCheckResult{
		Reachable:  true,
		Embeddable: !blocked,
		Status:     resp.StatusCode,
		Reason:     reason,
	})
}

// isLoopbackHost reports whether a hostname is loopback: "localhost" (with
// or without a trailing dot, any *.localhost subname) or a loopback IP.
func isLoopbackHost(host string) bool {
	h := strings.TrimSuffix(strings.ToLower(host), ".")
	if h == "localhost" || strings.HasSuffix(h, ".localhost") {
		return true
	}
	if ip := net.ParseIP(h); ip != nil {
		return ip.IsLoopback()
	}
	return false
}

// requestOrigin derives the viewer's origin (scheme://host) from the inbound
// request — the origin the target's CSP frame-ancestors must admit.
func requestOrigin(r *http.Request) string {
	scheme := r.Header.Get("X-Forwarded-Proto")
	if scheme != "http" && scheme != "https" {
		if r.TLS != nil {
			scheme = "https"
		} else {
			scheme = "http"
		}
	}
	return scheme + "://" + r.Host
}

// frameBlockReason inspects response headers for frame-blocking directives.
// X-Frame-Options of ANY value blocks (DENY and SAMEORIGIN both block a
// cross-origin viewer — the probe serves external absolute URLs only, so the
// viewer is never same-origin with the target). A CSP frame-ancestors
// directive blocks unless it lists `*`, the viewer's origin, or a
// scheme-source (`https:`/`http:`) matching the viewer's scheme. Returns the
// human-readable reason (the directive echo the tile's error state shows)
// and whether framing is blocked.
func frameBlockReason(h http.Header, viewerOrigin string) (string, bool) {
	if xfo := h.Get("X-Frame-Options"); xfo != "" {
		return "X-Frame-Options: " + xfo, true
	}
	for _, csp := range h.Values("Content-Security-Policy") {
		for _, directive := range strings.Split(csp, ";") {
			fields := strings.Fields(directive)
			if len(fields) == 0 || !strings.EqualFold(fields[0], "frame-ancestors") {
				continue
			}
			allowed := false
			for _, source := range fields[1:] {
				if source == "*" || strings.EqualFold(source, viewerOrigin) {
					allowed = true
					break
				}
				// CSP scheme-source (`https:` / `http:`) allows any origin of
				// that scheme — match it against the viewer origin's scheme.
				if strings.HasSuffix(source, ":") && !strings.Contains(source, "/") &&
					strings.HasPrefix(strings.ToLower(viewerOrigin), strings.ToLower(source)+"//") {
					allowed = true
					break
				}
			}
			if !allowed {
				return "CSP frame-ancestors: " + strings.Join(fields[1:], " "), true
			}
		}
	}
	return "", false
}
