package api

import (
	"net/http"
)

// devVersion is the sentinel running version for local (non-ldflags) builds.
// Under `just dev` the serve process runs under air (not the daemon), so a
// `rk daemon restart` spawned from it would stop/start the REAL daemon — never
// what a dev tab intends. handleRestart refuses to spawn for this version.
const devVersion = "dev"

// handleRestart bounces the run-kit daemon. POST per Constitution IX.
//
// Flow: (1) refuse (409) when the running version is "dev" — a defense-in-depth
// mirror of the palette-side dev gate (see intake §2); (2) respond 202 Accepted,
// then spawn a detached `rk daemon restart`. The restart kills THIS serving
// process, so — exactly like handleUpdate — the client must get its response
// FIRST. There is NO brew requirement (restart works for any install method) and
// no in-flight lock (a plain stop/start is idempotent; the daemon just released
// its own port).
//
// Accepted caveat (user-decided): if daemon.Start() fails after the stop, the
// web UI is down and SSH is needed — a narrow, accepted failure window; the
// ~/.rk/restart.log makes it diagnosable.
//
// POST /api/restart → 202 {"status":"restarting"} | 409 {"error":...}
func (s *Server) handleRestart(w http.ResponseWriter, r *http.Request) {
	if s.version == devVersion {
		writeError(w, http.StatusConflict,
			"restart is disabled for dev builds — under `just dev` the serve process is air-managed, not the daemon")
		return
	}

	selfPath, err := resolveSelfPathFn()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not determine executable path")
		return
	}

	// Accept before spawning: the detached `rk daemon restart` kills THIS
	// process, so the client must get its response first.
	writeJSON(w, http.StatusAccepted, map[string]string{"status": "restarting"})

	if err := spawnSelfFn(selfPath, restartLogRelPath, "daemon", "restart"); err != nil {
		// The response is already committed (202); log for diagnosis only.
		s.logger.Error("failed to spawn rk daemon restart", "error", err)
	}
}
