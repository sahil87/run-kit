package api

import "net/http"

// handleMCP delegates /mcp to the MCP streamable-HTTP handler wired by
// `rk serve` (SetMCPHandler). The route is registered unconditionally so a
// mis-wired daemon answers a clear 503 instead of the SPA catch-all's 404 —
// a 404 would be indistinguishable from a daemon predating the route, and the
// doctor `mcp route` row keys on that distinction.
func (s *Server) handleMCP(w http.ResponseWriter, r *http.Request) {
	if s.mcpHandler == nil {
		writeError(w, http.StatusServiceUnavailable, "mcp transport not configured")
		return
	}
	s.mcpHandler.ServeHTTP(w, r)
}
