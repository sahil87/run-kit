package api

import (
	"context"
	"net/http"
	"os/exec"
	"time"

	"github.com/go-chi/chi/v5"

	"rk/internal/daemon"
	"rk/internal/gui"
	"rk/internal/settings"
	"rk/internal/validate"
)

// guiStatusBuildTimeout bounds the tmux reads + RFB probe behind
// GET /api/gui/{id} so a wedged tmux server cannot hang the handler.
const guiStatusBuildTimeout = 10 * time.Second

// Server gui seams — the injectable layer behind GET /api/gui/{id},
// POST /api/gui/{id}/restart, and the gui.enabled settings side effect
// (mirroring the hub's guiSessionOptionsFn/guiProbeFn idiom). Nil falls back
// to the production daemon/gui calls, so NewTestRouter handlers keep working;
// tests that assert call counts inject counters directly.
//
// guiSessionExistsFn/guiSessionOptionsFn/guiSessionCreatedFn probe tmux, so
// they are gated on guiDaemonUpFn — a tmux command on a dead rk-daemon socket
// would birth a server.
func (s *Server) guiEnsure() (daemon.GUIEnsureOutcome, error) {
	if s.guiEnsureFn != nil {
		return s.guiEnsureFn()
	}
	return daemon.EnsureGUI()
}

func (s *Server) guiKill() (bool, error) {
	if s.guiKillFn != nil {
		return s.guiKillFn()
	}
	return daemon.KillGUISession()
}

func (s *Server) guiRestart() error {
	if s.guiRestartFn != nil {
		return s.guiRestartFn()
	}
	return daemon.RestartGUI()
}

func (s *Server) guiDaemonUp() bool {
	if s.guiDaemonUpFn != nil {
		return s.guiDaemonUpFn()
	}
	return daemon.IsRunning()
}

func (s *Server) guiSessionExists(ctx context.Context) bool {
	if s.guiSessionExistsFn != nil {
		return s.guiSessionExistsFn(ctx)
	}
	return daemon.GUISessionExists(ctx)
}

func (s *Server) guiSessionOptions(ctx context.Context) (display, backend string, ok bool) {
	if s.guiSessionOptionsFn != nil {
		return s.guiSessionOptionsFn(ctx)
	}
	return daemon.GUISessionOptions(ctx)
}

func (s *Server) guiSessionCreatedAt(ctx context.Context) (time.Time, bool) {
	if s.guiSessionCreatedFn != nil {
		return s.guiSessionCreatedFn(ctx)
	}
	return daemon.GUISessionCreated(ctx)
}

// guiPanePids is the rk-gui pane's process-tree pid set — RunningApps'
// exclude set, so the supervisor's own backend/WM (which carry DISPLAY in
// their environ) never count as user apps. Nil excludes nothing.
func (s *Server) guiPanePids(ctx context.Context) map[int]bool {
	if s.guiPanePidsFn != nil {
		return s.guiPanePidsFn(ctx)
	}
	return daemon.GUIPanePids(ctx)
}

func (s *Server) guiProbe(ctx context.Context, network, addr string) (gui.Info, error) {
	if s.guiProbeFn != nil {
		return s.guiProbeFn(ctx, network, addr)
	}
	return gui.Probe(ctx, network, addr)
}

func (s *Server) guiApps(display string, exclude map[int]bool) ([]gui.App, error) {
	if s.guiAppsFn != nil {
		return s.guiAppsFn(display, exclude)
	}
	return gui.RunningApps("/proc", display, exclude)
}

func (s *Server) guiLookPath(name string) (string, error) {
	if s.guiLookPathFn != nil {
		return s.guiLookPathFn(name)
	}
	return exec.LookPath(name)
}

// buildGuiStatus assembles the shared gui.Status document by wiring the
// Server's gui seams into gui.Assemble (the assembly — daemon gate, stamps,
// uptime, probe, reason, apps — is owned once in internal/gui). The viewer
// count is hub-local to this daemon process, hence the sseHub func here
// (the CLI reports 0).
func (s *Server) buildGuiStatus(ctx context.Context, id string) gui.Status {
	return gui.Assemble(ctx, gui.StatusDeps{
		ID:             id,
		Enabled:        settings.Load().GUIEnabled,
		DaemonRunning:  s.guiDaemonUp,
		SessionExists:  s.guiSessionExists,
		SessionOptions: s.guiSessionOptions,
		SessionCreated: s.guiSessionCreatedAt,
		PanePids:       s.guiPanePids,
		Probe:          s.guiProbe,
		RunningApps:    s.guiApps,
		LookPath:       s.guiLookPath,
		Viewers: func() int {
			s.initSSEHub()
			return s.sseHub.guiViewerCount(id)
		},
		Now: time.Now,
	})
}

// handleGuiStatus serves GET /api/gui/{id} — the gui.Status document (the
// same one `rk gui status --json` prints).
func (s *Server) handleGuiStatus(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if msg := validate.ValidateGUIID(id); msg != "" {
		writeError(w, http.StatusBadRequest, msg)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), guiStatusBuildTimeout)
	defer cancel()
	writeJSON(w, http.StatusOK, s.buildGuiStatus(ctx, id))
}

// handleGuiRestart serves POST /api/gui/{id}/restart — the empty state's
// "Restart supervisor" action. 409 when the GUI is off (a restart must never
// flip the switch on, and the restart seam must not even be consulted); 500
// with the error text when the restart itself fails.
func (s *Server) handleGuiRestart(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if msg := validate.ValidateGUIID(id); msg != "" {
		writeError(w, http.StatusBadRequest, msg)
		return
	}
	if !settings.Load().GUIEnabled {
		writeError(w, http.StatusConflict, "gui disabled")
		return
	}
	if err := s.guiRestart(); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
