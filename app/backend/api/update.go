package api

import (
	"encoding/json"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"

	"rk/internal/selfpath"
)

// updateLogRelPath is the ~/.rk-relative log name the detached `rk update`
// child's stdout/stderr are redirected to, so a silent failure is diagnosable.
const updateLogRelPath = "update.log"

// restartLogRelPath is the ~/.rk-relative log name the detached `rk daemon
// restart` child (handleRestart) redirects to. Separate from update.log so the
// update and restart spawn logs stay independent.
const restartLogRelPath = "restart.log"

// resolveSelfPathFn resolves this daemon's own on-disk executable path. Package
// var seam (mirrors cmd/rk/upgrade.go's resolveExeFn) so tests can return a
// synthetic Cellar (or non-Cellar) path without depending on the test binary's
// real location. Default: the shared selfpath.Resolve (os.Executable +
// EvalSymlinks) — the same resolver upgrade.go uses, so brew-install detection
// cannot drift between the two entry points.
var resolveSelfPathFn = selfpath.Resolve

// spawnSelfFn spawns a detached `rk <args...>` child logging to ~/.rk/<logName>.
// Package var seam (mirrors cmd/rk/upgrade.go's runBrewFn/restartDaemonFn) so
// handler tests can record the spawn (logName + args) without launching a real
// child. Generalized from the former spawnUpdateFn so BOTH the update
// (`("update.log", "update")`) and restart (`("restart.log", "daemon",
// "restart")`) handlers share ONE spawn implementation.
//
// The default spawns a DETACHED child: it must outlive this server process
// because both `rk update` and `rk daemon restart` restart the daemon, which
// kills the serving process mid-request. It is deliberately NOT context-bound —
// a detached child that must survive the server cannot inherit the request/server
// context; the Constitution I timeout rule exists to stop a hung subprocess
// BLOCKING the server, and a detached spawn cannot block it. Argument-slice
// construction is used (no shell string) and there is no user-provided input in
// the argv.
var spawnSelfFn = func(selfPath string, logName string, args ...string) error {
	cmd := exec.Command(selfPath, args...)
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	if logFile, err := openRkLog(logName); err == nil {
		cmd.Stdout = logFile
		cmd.Stderr = logFile
		// cmd.Start (below) dups the fd into the child; this deferred close then
		// releases the PARENT's handle when spawnSelfFn returns — the child
		// keeps its own copy, so the log stays open for the detached child.
		defer logFile.Close()
	}
	return cmd.Start()
}

// openRkLog opens ~/.rk/<logName> for append (creating ~/.rk if needed),
// mirroring the ~/.rk daemon-adjacent state dir used by the push subsystem. A
// failure to open the log is non-fatal — the spawn proceeds without redirection.
func openRkLog(logName string) (*os.File, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, err
	}
	dir := filepath.Join(home, ".rk")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	return os.OpenFile(filepath.Join(dir, logName), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
}

// updateRequest is the tolerant body of POST /api/update. An absent body, empty
// body, or `{}` all decode to force=false (the existing client POSTs `{}`, which
// MUST keep working unchanged). `force=true` skips the qualify check.
type updateRequest struct {
	Force bool `json:"force"`
}

// handleUpdate triggers a one-click self-upgrade. POST per Constitution IX.
//
// Flow: (1) require a Homebrew install (Cellar marker) — else 409; (2) unless
// `force=true`, require a qualifying pending update from the in-memory checker —
// else 409; (3) respond 202 Accepted, then spawn a detached `rk update`. There
// is deliberately no in-flight lock: a second click spawns another `rk update`,
// which exits harmlessly with "already up to date" once brew resolves.
//
// `force=true` (from the body) skips ONLY the qualify 409 — the real "is there
// anything newer" decision is delegated to the idempotent `rk update` — but
// KEEPS the brew 409 (which also covers dev builds: a dev binary never lives
// under /Cellar/run-kit/). `force=false`/absent-body is byte-identical to today.
//
// POST /api/update → 202 {"status":"updating"} | 409 {"error":...}
func (s *Server) handleUpdate(w http.ResponseWriter, r *http.Request) {
	// Tolerant body parse: absent/empty/`{}` ⇒ force=false. A malformed body is
	// treated as force=false rather than erroring — the endpoint's default has
	// always been the non-force path and existing clients POST `{}`.
	force := false
	if r.Body != nil {
		var req updateRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err == nil {
			force = req.Force
		}
	}

	selfPath, err := resolveSelfPathFn()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not determine executable path")
		return
	}

	if !selfpath.IsBrewInstalled(selfPath) {
		writeError(w, http.StatusConflict,
			"run-kit was not installed via Homebrew — update manually with `rk update` in a shell, or `brew install sahil87/tap/run-kit`")
		return
	}

	if !force && (s.updateChecker == nil || !s.updateChecker.Snapshot().Qualifies) {
		writeError(w, http.StatusConflict, "no update available")
		return
	}

	// Accept before spawning: the detached `rk update` restarts the daemon, which
	// kills THIS process, so the client must get its response first.
	writeJSON(w, http.StatusAccepted, map[string]string{"status": "updating"})

	if err := spawnSelfFn(selfPath, updateLogRelPath, "update"); err != nil {
		// The response is already committed (202); log for diagnosis only.
		s.logger.Error("failed to spawn rk update", "error", err)
	}
}
