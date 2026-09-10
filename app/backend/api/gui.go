package api

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"os/exec"
	"runtime"
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
// POST /api/gui/{id}/restart, POST /api/gui/{id}/launch,
// POST /api/gui/{id}/resize, and the gui.enabled/gui.geometry settings side
// effects (mirroring the hub's guiSessionOptionsFn/guiProbeFn idiom). Nil
// falls back to the production daemon/gui calls, so NewTestRouter handlers
// keep working; tests that assert call counts inject counters directly.
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

func (s *Server) guiSessionOptions(ctx context.Context) (display, backend, wm string, ok bool) {
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

// guiStat follows a launcher-resolved path (the dangling Debian-alternative
// guard in gui.ResolveApp); guiLaunch starts the resolved argv detached. Both
// are launcher seams behind POST /api/gui/{id}/launch.
func (s *Server) guiStat(path string) (os.FileInfo, error) {
	if s.guiStatFn != nil {
		return s.guiStatFn(path)
	}
	return os.Stat(path)
}

func (s *Server) guiLaunch(argv, env []string) (int, error) {
	if s.guiLaunchFn != nil {
		return s.guiLaunchFn(argv, env)
	}
	return gui.StartDetached(argv, env)
}

// guiXrandrRun is the xrandr runner behind POST /api/gui/{id}/resize and the
// gui.geometry settings side effect (nil ⇒ gui.RunOnDisplay).
func (s *Server) guiXrandrRun() gui.DisplayRunner {
	if s.guiXrandrRunFn != nil {
		return s.guiXrandrRunFn
	}
	return gui.RunOnDisplay
}

// buildGuiStatus assembles the shared gui.Status document by wiring the
// Server's gui seams into gui.Assemble (the assembly — daemon gate, stamps,
// uptime, probe, reason, apps — is owned once in internal/gui). The viewer
// count is hub-local to this daemon process, hence the sseHub func here
// (the CLI reports 0).
func (s *Server) buildGuiStatus(ctx context.Context, id string) gui.Status {
	st := settings.Load()
	return gui.Assemble(ctx, gui.StatusDeps{
		ID:             id,
		Enabled:        st.GUIEnabled,
		Geometry:       st.GUIGeometry,
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
		// Locked and HumanInputAt come from the hub: the pin is read on the
		// gui tick beside the stamps, and the input timestamp is hub-local
		// relay bookkeeping (the CLI wires nil for the latter — it cannot
		// observe the hub).
		Locked: func(context.Context) bool {
			s.initSSEHub()
			return s.sseHub.guiLockedState()
		},
		HumanInputAt: func() (time.Time, bool) {
			s.initSSEHub()
			return s.sseHub.guiHumanInputAt(id)
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

// guiLaunchRequest is the POST /api/gui/{id}/launch body: a role, never argv
// (no arbitrary command over HTTP — the server resolves the argv from the
// role's fixed ladder). Extra keys and a non-string app are rejected at
// decode so nothing but the two roles ever reaches the launcher.
type guiLaunchRequest struct {
	App string `json:"app"`
}

// guiLaunchGOOS is the OS seam behind the launch handler's macOS refusal (the
// CLI verb's guiDarwinRefusal twin): the darwin backend mirrors Screen Sharing
// view-only, so there is no rk-managed display to launch onto. A package var
// so tests drive the darwin branch without a darwin build.
var guiLaunchGOOS = runtime.GOOS

// guiLaunchDarwinError is the refusal text — byte-identical to the CLI's
// guiDarwinRefusal("launch") so both doors say the same thing.
const guiLaunchDarwinError = "gui launch is not supported on macOS in v1 — the GUI mirrors your live session view-only"

// handleGuiLaunch serves POST /api/gui/{id}/launch — the HTTP twin of
// 'rk gui launch', behind G2's palette rows. The ladder miss is a 200 with
// ok:false on purpose: the palette toasts the hint through the normal success
// path (the client throws on non-2xx).
func (s *Server) handleGuiLaunch(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if msg := validate.ValidateGUIID(id); msg != "" {
		writeError(w, http.StatusBadRequest, msg)
		return
	}
	var body guiLaunchRequest
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "app must be terminal or browser")
		return
	}
	role, err := gui.ParseAppRole(body.App)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if guiLaunchGOOS == "darwin" {
		writeError(w, http.StatusConflict, guiLaunchDarwinError)
		return
	}
	if !settings.Load().GUIEnabled {
		writeError(w, http.StatusConflict, "gui disabled")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), guiStatusBuildTimeout)
	defer cancel()
	st := s.buildGuiStatus(ctx, id)
	if !st.Reachable {
		writeError(w, http.StatusConflict, "gui is on but not running — see 'rk gui status'")
		return
	}
	name, path, ok := gui.ResolveApp(role, s.guiLookPath, s.guiStat)
	if !ok {
		writeJSON(w, http.StatusOK, map[string]any{"ok": false, "app": string(role), "hint": gui.LaunchHint(role, s.guiLookPath)})
		return
	}
	pid, err := s.guiLaunch([]string{path}, gui.LaunchEnv(os.Environ(), st.Display, st.Socket))
	if err != nil {
		writeError(w, http.StatusInternalServerError, name+": "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "app": string(role), "argv0": name, "pid": pid})
}

// guiResizeRequest is the POST /api/gui/{id}/resize body: the target desktop
// geometry — a fixed WxH, or "auto" to follow the focused viewer's tile.
type guiResizeRequest struct {
	Geometry string `json:"geometry"`
}

// guiResizeBadBody is the 400 for an undecodable resize body: the parse shape
// error without the got clause (there is no geometry string to name).
const guiResizeBadBody = "geometry must be WxH (320–7680 per side) or auto"

// guiResizeDarwinError is the resize twin of guiLaunchDarwinError.
const guiResizeDarwinError = "gui resize is not supported on macOS in v1 — the GUI mirrors your live session view-only"

// handleGuiResize serves POST /api/gui/{id}/resize — the HTTP twin of
// 'rk gui resize'. A fixed WxH is applied via xrandr BEFORE the gui.geometry
// setting is written, so the setting stays truthful to the display (a failed
// xrandr leaves it unwritten); "auto" persists without touching xrandr. `was`
// in the success body is the previous setting value.
func (s *Server) handleGuiResize(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if msg := validate.ValidateGUIID(id); msg != "" {
		writeError(w, http.StatusBadRequest, msg)
		return
	}
	var body guiResizeRequest
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, guiResizeBadBody)
		return
	}
	width, height, auto, err := gui.ParseGeometry(body.Geometry)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if guiLaunchGOOS == "darwin" {
		writeError(w, http.StatusConflict, guiResizeDarwinError)
		return
	}
	if !settings.Load().GUIEnabled {
		writeError(w, http.StatusConflict, "gui disabled")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), guiStatusBuildTimeout)
	defer cancel()
	st := s.buildGuiStatus(ctx, id)
	if !st.Reachable {
		writeError(w, http.StatusConflict, "gui is on but not running — see 'rk gui status'")
		return
	}
	target := gui.GeometryAuto
	if !auto {
		if _, err := s.guiLookPath("xrandr"); err != nil {
			writeError(w, http.StatusInternalServerError, gui.XrandrMissingHint)
			return
		}
		resizeCtx, resizeCancel := context.WithTimeout(r.Context(), gui.XrandrTimeout)
		defer resizeCancel()
		if err := gui.Resize(resizeCtx, s.guiXrandrRun(), st.Display, width, height); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		target = gui.FormatGeometry(width, height)
	}
	cur := settings.Load()
	was := cur.GUIGeometry
	cur.GUIGeometry = target
	if err := settings.Save(cur); err != nil {
		s.logger.Error("failed to save settings", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to save settings")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "geometry": target, "was": was})
}

// applyGuiGeometryLive is the POST /api/settings gui.geometry side effect
// (current is the just-saved document): a fixed WxH on an enabled, reachable
// GUI is applied via xrandr BEST-EFFORT — a failure warns and the response
// stays 200 (the setting is already saved; `rk gui restart` applies it).
// "auto" needs no action: the stream's geometry flips the tiles'
// resizeSession. The runner and PATH check ride the resize endpoint's seams.
func (s *Server) applyGuiGeometryLive(rctx context.Context, current settings.Settings) {
	width, height, auto, err := gui.ParseGeometry(current.GUIGeometry)
	if err != nil || auto || !current.GUIEnabled {
		return
	}
	ctx, cancel := context.WithTimeout(rctx, guiStatusBuildTimeout)
	defer cancel()
	st := s.buildGuiStatus(ctx, "host")
	if !st.Reachable {
		return
	}
	fail := func(err error) {
		s.logger.Warn("gui.geometry: live resize failed (the setting is saved; rk gui restart applies it)", "error", err)
	}
	if _, err := s.guiLookPath("xrandr"); err != nil {
		fail(err)
		return
	}
	resizeCtx, resizeCancel := context.WithTimeout(rctx, gui.XrandrTimeout)
	defer resizeCancel()
	if err := gui.Resize(resizeCtx, s.guiXrandrRun(), st.Display, width, height); err != nil {
		fail(err)
	}
}
