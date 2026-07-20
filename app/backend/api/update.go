package api

import (
	"encoding/json"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"syscall"
	"time"

	"rk/internal/selfpath"
	"rk/internal/updatecheck"
	"rk/internal/validate"
)

// updateLogRelPath is the ~/.rk-relative log name the detached `rk update`
// child's stdout/stderr are redirected to, so a silent failure is diagnosable.
const updateLogRelPath = "update.log"

// postRemediationRecheckDelay is how long after a scoped `shll update` spawn the
// handler asks the checker to re-run its fetch+match pass (R17). A brew upgrade
// of a few tools comfortably finishes inside this window, so the consumed match
// propagates as a cleared/changed verdict within minutes instead of waiting for
// the 6h ticker. Single-shot, daemon-context-bound (see Checker.RecheckAfter).
const postRemediationRecheckDelay = 2 * time.Minute

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

// lookShllFn resolves the `shll` binary on PATH, returning its absolute path.
// Package var seam so handler tests can force shll present/absent without a real
// binary. Default wraps exec.LookPath. When it errors, remediation degrades to
// the run-kit-self `rk update` path (§5) — fail-silent per the toolkit rule.
var lookShllFn = func() (string, error) { return exec.LookPath("shll") }

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

// updatesCheckRequest is the tolerant body of POST /api/updates/check
// (mirroring updateRequest's posture): an absent body, empty body, `{}`, or an
// absent/empty `source` key all mean the released default — existing clients
// POSTing `{}` are unchanged. `"source":"github"` requests the GitHub backend;
// any other non-empty value is a 400 (see handleUpdatesCheck).
type updatesCheckRequest struct {
	Source string `json:"source"`
}

// handleUpdate triggers a one-click toolkit upgrade. POST per Constitution IX.
//
// Remediation branches on whether `shll` is on PATH:
//
//   - shll PRESENT → a SCOPED toolkit update. Non-force: require a non-empty
//     match set from the in-memory checker — else 409 — then respond 202 and
//     spawn a detached `shll update <matched tools…>` (argv from the checker
//     snapshot). Force: skip the match 409 and spawn a full-roster `shll update`
//     (no tool args). `shll update` normalizes subset order to roster order and
//     preserves run-kit's daemon-restart side effect by delegating to
//     `rk update --skip-brew-update`, so the detached spawn side effects carry
//     over. There is NO brew-409 on this path — a run-kit-not-brew daemon simply
//     never matches its own row (§2), while sibling tools remain updatable.
//
//   - shll ABSENT → today's run-kit-self behavior verbatim: (1) require a
//     Homebrew install (Cellar marker) — else 409; (2) unless force, require a
//     qualifying pending update — else 409; (3) 202 then spawn a detached
//     `rk update` (self). The brew-409 (which also covers dev builds — a dev
//     binary never lives under /Cellar/run-kit/) applies ONLY here.
//
// There is deliberately no in-flight lock: a second click spawns again, which
// exits harmlessly with "already up to date" once brew resolves.
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

	// shll present → scoped toolkit update. The lookup is fail-silent (an error
	// simply routes to the run-kit-self fallback below).
	if shllPath, err := lookShllFn(); err == nil {
		s.handleShllUpdate(w, shllPath, force)
		return
	}

	s.handleSelfUpdate(w, force)
}

// handleShllUpdate spawns a scoped (or full-roster, on force) `shll update`.
// The match set is read from the checker snapshot; on the non-force path an
// empty match set 409s before spawning (mirroring today's qualify-409 gate).
// After spawning it schedules a ~2min post-remediation re-check (R17) so a
// consumed match clears promptly on the siblings-only path (no daemon restart).
func (s *Server) handleShllUpdate(w http.ResponseWriter, shllPath string, force bool) {
	args := []string{"update"}
	if !force {
		var matched []string
		if s.updateChecker != nil {
			for _, m := range s.updateChecker.Snapshot().Matched {
				// Tool names come from the REMOTE shll.ai manifest, so validate each
				// before it reaches `shll update` argv — a name starting with `-` (or
				// carrying whitespace/control chars) could be misread as a flag by
				// shll's arg parser (constitution §I). A rejected name is dropped and
				// logged, not passed through.
				if msg := validate.ValidateToolName(m.Tool); msg != "" {
					s.logger.Warn("dropping invalid manifest tool name from shll update argv", "tool", m.Tool, "reason", msg)
					continue
				}
				matched = append(matched, m.Tool)
			}
		}
		if len(matched) == 0 {
			writeError(w, http.StatusConflict, "no update available")
			return
		}
		args = append(args, matched...)
	}
	// force keeps args == ["update"] — a full-roster sweep with no tool args.

	// Accept before spawning: `shll update` restarts the daemon (via its
	// delegation to `rk update`), which kills THIS process, so the client must
	// get its response first.
	writeJSON(w, http.StatusAccepted, map[string]string{"status": "updating"})

	if err := spawnSelfFn(shllPath, updateLogRelPath, args...); err != nil {
		// The response is already committed (202); log for diagnosis only.
		s.logger.Error("failed to spawn shll update", "error", err)
	}

	// Schedule a delayed re-check so a consumed match clears within minutes
	// instead of waiting for the 6h ticker (R17). Applies to BOTH scoped paths
	// (non-force scoped + force sweep). When run-kit was in the spawned scope the
	// daemon restarts and this process-local timer dies with it — harmless. The
	// shll-absent `rk update` fallback (handleSelfUpdate) needs no re-check: it
	// always restarts the daemon, which resets state.
	if s.updateChecker != nil {
		s.updateChecker.RecheckAfter(postRemediationRecheckDelay)
	}
}

// handleUpdatesCheck runs one immediate update-check pass inline and returns
// the fresh verdict synchronously so the palette check commands can report
// without waiting on SSE. POST per Constitution IX. The ~1-2s exec latency is
// acceptable for a synchronous response; the checker's exec timeout is the
// bound (API routes must not block unbounded).
//
// The tolerant body selects the check backend (see updatesCheckRequest):
//
//   - released default (absent/empty/`{}` body, absent/empty `source`) — the
//     same code path the 6h ambient loop uses (`shll check-updates` exec +
//     cached verdict update + SSE broadcast via the checker's OnQualify seam).
//   - `"source":"github"` — a SIDE-CHANNEL query against shll's GitHub backend:
//     exec + verdict computation + synchronous response only; the shared cached
//     verdict and the OnQualify/SSE broadcast are deliberately untouched (the
//     github contract has no notify policy, so caching it would wipe a legit
//     released chip and starve the scoped `shll update` argv).
//
// The handler maps the request onto the closed updatecheck.Source* enum —
// nothing user-controlled reaches argv (Constitution I). An unrecognized
// non-empty `source` → 400 (fail-loud; a silent released fallback would mask a
// client bug). The response echoes the report's self-identified `source`.
//
// Failure mapping (the manual check is deliberately fail-LOUD, unlike the
// fail-silent ambient loop): a nil or suppressed checker (dev build) → 409; a
// failed check (shll missing / non-zero exit / unparseable JSON) → 502 with the
// reason, so the client can raise an honest error toast. No in-flight lock —
// mirrors /api/update's no-lock posture (a concurrent pass is idempotent).
//
// POST /api/updates/check → 200 {tools,key,current,latest,source} | 400/409/502 {"error":...}
func (s *Server) handleUpdatesCheck(w http.ResponseWriter, r *http.Request) {
	if s.updateChecker == nil || s.updateChecker.Suppressed() {
		writeError(w, http.StatusConflict, "update checks are disabled for this daemon (dev build)")
		return
	}

	// Tolerant body parse mirroring handleUpdate's: absent/empty/malformed body
	// ⇒ the released default. A successfully-parsed unknown source is a client
	// bug and 400s; only the validated enum value selects the github backend.
	source := updatecheck.SourceReleased
	if r.Body != nil {
		var req updatesCheckRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err == nil {
			switch req.Source {
			case "":
				// released default
			case updatecheck.SourceGithub:
				source = updatecheck.SourceGithub
			default:
				writeError(w, http.StatusBadRequest, "unknown update-check source "+strconv.Quote(req.Source)+" (supported: \"github\")")
				return
			}
		}
	}

	verdict, err := s.updateChecker.CheckNow(r.Context(), source)
	if err != nil {
		writeError(w, http.StatusBadGateway, "update check unavailable — "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, buildUpdateAvailablePayload(verdict))
}

// handleSelfUpdate is the shll-absent fallback — the pre-manifest run-kit-self
// behavior verbatim: brew-409 gate, qualify/force gate, then a detached
// `rk update` (self).
func (s *Server) handleSelfUpdate(w http.ResponseWriter, force bool) {
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

	if !force && (s.updateChecker == nil || len(s.updateChecker.Snapshot().Matched) == 0) {
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
