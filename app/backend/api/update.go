package api

import (
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"

	"rk/internal/selfpath"
)

// updateLogRelPath is the ~/.rk-relative path the detached `rk update` child's
// stdout/stderr are redirected to, so a silent failure is diagnosable.
const updateLogRelPath = "update.log"

// resolveSelfPathFn resolves this daemon's own on-disk executable path. Package
// var seam (mirrors cmd/rk/upgrade.go's resolveExeFn) so tests can return a
// synthetic Cellar (or non-Cellar) path without depending on the test binary's
// real location. Default: the shared selfpath.Resolve (os.Executable +
// EvalSymlinks) — the same resolver upgrade.go uses, so brew-install detection
// cannot drift between the two entry points.
var resolveSelfPathFn = selfpath.Resolve

// spawnUpdateFn spawns the detached `rk update` upgrade process. Package var seam
// (mirrors cmd/rk/upgrade.go's runBrewFn/restartDaemonFn) so handler tests can
// record the spawn without launching a real upgrade. The default spawns a
// DETACHED child: it must outlive this server process because `rk update`
// restarts the daemon, which kills the serving process mid-request. It is
// deliberately NOT context-bound — a detached child that must survive the server
// cannot inherit the request/server context; the Constitution I timeout rule
// exists to stop a hung subprocess BLOCKING the server, and a detached spawn
// cannot block it. Argument-slice construction is used (no shell string) and
// there is no user-provided input in the argv.
var spawnUpdateFn = func(selfPath string) error {
	cmd := exec.Command(selfPath, "update")
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	if logFile, err := openUpdateLog(); err == nil {
		cmd.Stdout = logFile
		cmd.Stderr = logFile
		// cmd.Start (below) dups the fd into the child; this deferred close then
		// releases the PARENT's handle when spawnUpdateFn returns — the child
		// keeps its own copy, so the log stays open for the detached upgrade.
		defer logFile.Close()
	}
	return cmd.Start()
}

// openUpdateLog opens ~/.rk/update.log for append (creating ~/.rk if needed),
// mirroring the ~/.rk daemon-adjacent state dir used by the push subsystem. A
// failure to open the log is non-fatal — the spawn proceeds without redirection.
func openUpdateLog() (*os.File, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, err
	}
	dir := filepath.Join(home, ".rk")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	return os.OpenFile(filepath.Join(dir, updateLogRelPath), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
}

// handleUpdate triggers a one-click self-upgrade. POST per Constitution IX.
//
// Flow: (1) require a Homebrew install (Cellar marker) — else 409; (2) require a
// qualifying pending update from the in-memory checker — else 409; (3) respond
// 202 Accepted, then spawn a detached `rk update`. There is deliberately no
// in-flight lock: a second click spawns another `rk update`, which exits
// harmlessly with "already up to date" once brew resolves (intake §3.4 / R8).
//
// POST /api/update → 202 {"status":"updating"} | 409 {"error":...}
func (s *Server) handleUpdate(w http.ResponseWriter, r *http.Request) {
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

	if s.updateChecker == nil || !s.updateChecker.Snapshot().Qualifies {
		writeError(w, http.StatusConflict, "no update available")
		return
	}

	// Accept before spawning: the detached `rk update` restarts the daemon, which
	// kills THIS process, so the client must get its response first.
	writeJSON(w, http.StatusAccepted, map[string]string{"status": "updating"})

	if err := spawnUpdateFn(selfPath); err != nil {
		// The response is already committed (202); log for diagnosis only.
		s.logger.Error("failed to spawn rk update", "error", err)
	}
}
