package api

import (
	"net/http"

	"rk/internal/settings"
)

// handleHealth is the frontend's one-shot bootstrap surface as well as a
// liveness probe: alongside `status`/`hostname` it carries the optional
// `sshHost` (the SSH destination remote clients use to reach this host) and
// the derived `sshUser` (os/user.Current at startup), which together feed the
// Open button's editor ssh-remote deeplinks: the destination is used verbatim
// when set, else remote clients derive `${sshUser}@${location.hostname}`.
//
// sshHost resolves from the `ssh_host` setting per request (Constitution II —
// derive at request time, so a settings-dialog edit takes effect on the next
// health fetch without restart); that setting is the ONLY source — there is
// no env form. The optional `instanceName` (the display-name override,
// settings `instance_name`) rides alongside.
// Each field is omitted when empty — a new /api/config route for these fields
// would grow surface against Constitution IV.
func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	body := map[string]string{
		"status":   "ok",
		"hostname": s.hostname,
	}
	stored := settings.Load()
	if stored.SSHHost != "" {
		body["sshHost"] = stored.SSHHost
	}
	if s.sshUser != "" {
		body["sshUser"] = s.sshUser
	}
	if stored.InstanceName != "" {
		body["instanceName"] = stored.InstanceName
	}
	writeJSON(w, http.StatusOK, body)
}
