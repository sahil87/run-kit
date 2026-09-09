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

func (s *Server) guiProbe(ctx context.Context, network, addr string) (gui.Info, error) {
	if s.guiProbeFn != nil {
		return s.guiProbeFn(ctx, network, addr)
	}
	return gui.Probe(ctx, network, addr)
}

func (s *Server) guiApps(display string) ([]gui.App, error) {
	if s.guiAppsFn != nil {
		return s.guiAppsFn(display)
	}
	return gui.RunningApps("/proc", display, nil)
}

func (s *Server) guiLookPath(name string) (string, error) {
	if s.guiLookPathFn != nil {
		return s.guiLookPathFn(name)
	}
	return exec.LookPath(name)
}

// buildGuiStatus assembles the shared gui.Status document: settings for the
// switch, tmux (gated on the daemon's liveness) for the session/stamps/
// uptime, the RFB probe for reachability and geometry, the hub for the live
// viewer count, and the /proc scan for the apps list. Disabled short-circuits
// before any tmux or probe work.
func (s *Server) buildGuiStatus(ctx context.Context, id string) gui.Status {
	st := gui.Status{ID: id, Apps: []gui.App{}}
	if sock, err := gui.SocketPath(id); err == nil {
		st.Socket = sock
	}
	st.Enabled = settings.Load().GUIEnabled
	if !st.Enabled {
		return st
	}
	s.initSSEHub()
	st.Viewers = s.sseHub.guiViewerCount(id)
	if !s.guiDaemonUp() {
		st.Reason = gui.SessionAbsentReason
		return st
	}
	st.Session = s.guiSessionExists(ctx)
	if !st.Session {
		st.Reason = gui.NotRunningReason(false, "", s.guiLookPath)
		return st
	}
	if display, backend, ok := s.guiSessionOptions(ctx); ok {
		st.Display, st.Backend = display, backend
	}
	if created, ok := s.guiSessionCreatedAt(ctx); ok {
		st.UptimeSeconds = int64(time.Since(created).Seconds())
	}
	if network, addr, err := gui.BackendAddr(id); err == nil {
		if info, perr := s.guiProbe(ctx, network, addr); perr == nil {
			st.Reachable = info.Reachable
			st.Width, st.Height = info.Width, info.Height
		}
	}
	if !st.Reachable {
		st.Reason = gui.NotRunningReason(true, st.Backend, s.guiLookPath)
		return st
	}
	if apps, err := s.guiApps(st.Display); err == nil && apps != nil {
		st.Apps = apps
	}
	return st
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
