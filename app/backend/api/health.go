package api

import (
	"net/http"
)

// handleHealth is the frontend's one-shot bootstrap surface as well as a
// liveness probe: alongside `status`/`hostname` it carries the optional
// `sshHost` (RK_SSH_HOST — the alias remote clients use to SSH to this host),
// which feeds the Open button's editor ssh-remote deeplinks. Omitted when
// unset (the frontend hides the deeplink section then) — a new /api/config
// route for one field would grow surface against Constitution IV.
func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	body := map[string]string{
		"status":   "ok",
		"hostname": s.hostname,
	}
	if s.sshHost != "" {
		body["sshHost"] = s.sshHost
	}
	writeJSON(w, http.StatusOK, body)
}
