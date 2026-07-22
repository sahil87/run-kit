package api

import (
	"net/http"
)

// handleHealth is the frontend's one-shot bootstrap surface as well as a
// liveness probe: alongside `status`/`hostname` it carries the optional
// `sshHost` (RK_SSH_HOST — the alias remote clients use to SSH to this host)
// and the derived `sshUser` (os/user.Current at startup), which together feed
// the Open button's editor ssh-remote deeplinks: the alias is used verbatim
// when set, else remote clients derive `${sshUser}@${location.hostname}`.
// Each field is omitted when empty — a new /api/config route for two fields
// would grow surface against Constitution IV.
func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	body := map[string]string{
		"status":   "ok",
		"hostname": s.hostname,
	}
	if s.sshHost != "" {
		body["sshHost"] = s.sshHost
	}
	if s.sshUser != "" {
		body["sshUser"] = s.sshUser
	}
	writeJSON(w, http.StatusOK, body)
}
