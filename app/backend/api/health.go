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
// sshHost resolves settings-first per request (Constitution II — derive at
// request time, so a settings-dialog edit takes effect on the next health
// fetch without restart): ~/.rk/settings.yaml `ssh_host` when non-empty, else
// the startup-seeded RK_SSH_HOST env value. The optional `instanceName` (the
// display-name override, settings.yaml `instance_name`) rides alongside.
// Each field is omitted when empty — a new /api/config route for these fields
// would grow surface against Constitution IV.
func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	body := map[string]string{
		"status":   "ok",
		"hostname": s.hostname,
	}
	stored := settings.Load()
	sshHost := stored.SSHHost
	if sshHost == "" {
		sshHost = s.sshHost // RK_SSH_HOST env fallback (startup-seeded)
	}
	if sshHost != "" {
		body["sshHost"] = sshHost
	}
	if s.sshUser != "" {
		body["sshUser"] = s.sshUser
	}
	if stored.InstanceName != "" {
		body["instanceName"] = stored.InstanceName
	}
	writeJSON(w, http.StatusOK, body)
}
