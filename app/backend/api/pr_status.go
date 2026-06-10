package api

import "net/http"

// handlePRStatusRefresh triggers an on-demand refresh of the in-memory PR-status
// collector and returns 200 {"ok":true}. The refresh is best-effort and
// synchronous-but-bounded (the collector's gh call carries its own 10s timeout);
// a gh failure is swallowed by the collector (stale-while-revalidate), so this
// handler always returns ok. No-op when no collector is wired (e.g. test router).
//
// POST per Constitution §IX (all mutating endpoints use POST).
func (s *Server) handlePRStatusRefresh(w http.ResponseWriter, r *http.Request) {
	if s.prStatus != nil {
		s.prStatus.RefreshNow(r.Context())
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
