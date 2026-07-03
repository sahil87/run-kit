package ports

import (
	"context"
	"io"
	"net/http"
	"strconv"
	"time"
)

// probeTimeout bounds each HTTP probe. A listener that accepts the connection
// but never sends a valid HTTP response must not stall the poll cycle, so the
// per-request deadline is short (~750 ms) — long enough for a real local HTTP
// server to answer, short enough that a hung listener costs one timeout.
const probeTimeout = 750 * time.Millisecond

// probeConcurrency caps how many ports are probed in parallel within one cycle
// (bounded semaphore pool — the tmux.ListServers precedent). N slow/hanging
// ports then cost ~one timeout instead of N sequential timeouts.
const probeConcurrency = 10

// probeTransport is the transport for the default probe. It clones the stdlib
// default transport (retaining its tuned dial/keepalive defaults) but disables
// proxy use: these probes target 127.0.0.1 only, and routing loopback requests
// through an HTTP_PROXY/HTTPS_PROXY (which http.DefaultTransport honors unless
// NO_PROXY covers loopback) would leak local port metadata and yield incorrect
// verdicts. A nil Proxy makes every probe a direct connection.
var probeTransport = func() *http.Transport {
	t := http.DefaultTransport.(*http.Transport).Clone()
	t.Proxy = nil
	return t
}()

// probeClient is the shared client used by the default probe. It does NOT follow
// redirects (a 3xx is itself a well-formed HTTP response that proves the listener
// speaks HTTP) and applies the per-request timeout. Idle connections are not
// pooled aggressively — each probe hits a distinct loopback port.
var probeClient = &http.Client{
	Timeout:   probeTimeout,
	Transport: probeTransport,
	CheckRedirect: func(*http.Request, []*http.Request) error {
		return http.ErrUseLastResponse
	},
}

// probePort reports whether the given port answers HTTP. It is a package var so
// tests can substitute a deterministic verdict (mirrors the lsofRun / ghExec
// seams elsewhere in the codebase).
//
// The default issues GET http://127.0.0.1:{port}/ — deliberately mirroring the
// /proxy/{port}/ upstream target (api/proxy.go: Host 127.0.0.1:{port}), so a
// port unreachable at loopback (never openable via "Open in window") is reported
// non-HTTP. ANY well-formed HTTP response, regardless of status code (200, 404,
// 401, 302, even 400 for "plain HTTP sent to an HTTPS port"), proves the listener
// speaks HTTP. Connection refused/reset, timeout, or a malformed response (any
// http.Client error) reports non-HTTP for this probe cycle.
var probePort = func(ctx context.Context, port int) bool {
	url := "http://127.0.0.1:" + strconv.Itoa(port) + "/"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return false
	}
	resp, err := probeClient.Do(req)
	if err != nil {
		return false
	}
	// Discard and close the body so the connection can be reused/released.
	_, _ = io.Copy(io.Discard, resp.Body)
	_ = resp.Body.Close()
	return true
}
