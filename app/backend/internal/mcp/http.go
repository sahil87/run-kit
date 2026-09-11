package mcp

import (
	"io"
	"log/slog"
	"net/http"
	"time"

	mcpsdk "github.com/modelcontextprotocol/go-sdk/mcp"
)

// HTTPRoutePath is the daemon path the streamable-HTTP transport is mounted at.
const HTTPRoutePath = "/mcp"

// HTTPSessionIdleTimeout closes an SDK session that has received no HTTP
// request for this long — a client that vanished without DELETE must not hold
// its session forever (Constitution II: the handler's memory is the only
// state).
const HTTPSessionIdleTimeout = 30 * time.Minute

// HTTPHandler returns the streamable-HTTP transport for this server, wrapped
// in the Origin allowlist guard. Every session shares the one SDK server (and
// so the one policy table and executor); per-session state lives inside the
// SDK handler for the session's life only. Stateful mode: the GET SSE stream
// and DELETE termination exist only there. CrossOriginProtection stays nil
// (deprecated, and its Origin == Host fail-open is the reference the spec
// forbids — originGuard replaces it) and DisableLocalhostProtection stays
// false (the SDK's loopback-arrival/non-loopback-Host 403 is an additive
// guard; a tailnet request arrives on the tailnet address, so it never trips
// for legitimate clients).
func (s *Server) HTTPHandler(policy OriginPolicy, logger *slog.Logger) http.Handler {
	h := mcpsdk.NewStreamableHTTPHandler(
		func(*http.Request) *mcpsdk.Server { return s.sdk },
		&mcpsdk.StreamableHTTPOptions{
			SessionTimeout: HTTPSessionIdleTimeout,
			Logger:         logger,
		},
	)
	return originGuard(policy, logger, h)
}

// originGuard enforces the /mcp Origin allowlist on EVERY method — the SSE
// stream is a GET, which Go's cross-origin protection would exempt (one of
// the two reasons it is not reused). A request with no Origin header is not a
// browser request and passes; the request Host header is never consulted.
func originGuard(policy OriginPolicy, logger *slog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if origin := r.Header.Get("Origin"); origin != "" && !policy.Allows(origin) {
			logger.Warn("mcp: origin rejected", "origin", origin)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusForbidden)
			io.WriteString(w, `{"error":"origin not allowed"}`)
			return
		}
		next.ServeHTTP(w, r)
	})
}
