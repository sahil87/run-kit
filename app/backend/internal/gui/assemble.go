package gui

import (
	"context"
	"time"
)

// StatusDeps is the injectable surface behind Assemble: every live fact
// (settings, tmux, the RFB probe, /proc, the clock) arrives as a func so the
// assembler stays pure and free of tmux/daemon imports. Callers (rk gui,
// GET /api/gui/{id}) wire their own seams. A nil func yields the zero value,
// so partial deps are safe.
type StatusDeps struct {
	// ID is the GUI id ("host") — the Status id and the socket/BackendAddr key.
	ID string
	// Enabled is settings.Load().GUIEnabled, resolved by the caller so the
	// CLI's settings seam stays injectable.
	Enabled bool
	// Geometry is settings.Load().GUIGeometry, resolved by the caller like
	// Enabled; copied into the document only when enabled.
	Geometry string
	// DaemonRunning gates every tmux-touching dep below: a tmux command on a
	// dead rk-daemon socket births a server.
	DaemonRunning  func() bool
	SessionExists  func(ctx context.Context) bool
	SessionOptions func(ctx context.Context) (display, backend, wm string, ok bool)
	SessionCreated func(ctx context.Context) (time.Time, bool)
	// PanePids is the rk-gui pane's process-tree pid set (backend, WM,
	// supervise) — RunningApps' exclude set. Nil/unavailable excludes nothing.
	PanePids    func(ctx context.Context) map[int]bool
	Probe       func(ctx context.Context, network, addr string) (Info, error)
	RunningApps func(display string, exclude map[int]bool) ([]App, error)
	LookPath    func(string) (string, error)
	Viewers     func() int
	// Locked reads the host resolution pin (@rk_gui_lock); consulted once the
	// session exists. Nil reads as unlocked.
	Locked func(ctx context.Context) bool
	// HumanInputAt is the daemon's in-memory last-relayed-human-input
	// timestamp (ok=false when none was seen or the daemon restarted — the
	// fact dies with the process). Nil omits human_input_ago_ms (the CLI
	// cannot observe the hub — the guiViewersFn caveat).
	HumanInputAt func() (time.Time, bool)
	Now          func() time.Time
}

// Assemble builds the shared Status document from StatusDeps. The order is
// fixed: disabled short-circuits before any tmux or probe work; the
// daemon-liveness gate precedes all tmux reads; reasons come from
// NotRunningReason (session-absent → macOS → no-backend → backend-exited).
// The apps list (and with it the pane-tree exclusion) is gathered only when
// the backend is reachable.
func Assemble(ctx context.Context, d StatusDeps) Status {
	st := Status{ID: d.ID, Apps: []App{}}
	// Socket names the unix endpoint only; the tcp backend (macOS Screen
	// Sharing) has no host.sock, so the field stays empty there.
	if network, addr, err := BackendAddr(d.ID); err == nil && network == "unix" {
		st.Socket = addr
	}
	st.Enabled = d.Enabled
	// Candidates derive from PATH alone — no tmux, no daemon gate — so they
	// precede the disabled short-circuit: the picker must work with the GUI
	// off (the bare-set-while-off rule).
	st.WMCandidates = WMCandidates(d.LookPath)
	if !st.Enabled {
		return st
	}
	st.Geometry = d.Geometry
	if d.Viewers != nil {
		st.Viewers = d.Viewers()
	}
	if d.HumanInputAt != nil && d.Now != nil {
		if at, ok := d.HumanInputAt(); ok {
			st.HumanInputAgoMS = HumanInputAgoMS(at, d.Now())
		}
	}
	if d.DaemonRunning == nil || !d.DaemonRunning() {
		st.Reason = SessionAbsentReason
		return st
	}
	if d.SessionExists != nil {
		st.Session = d.SessionExists(ctx)
	}
	if !st.Session {
		st.Reason = NotRunningReason(false, "", d.LookPath)
		return st
	}
	if d.Locked != nil {
		st.Locked = d.Locked(ctx)
	}
	if d.SessionOptions != nil {
		if display, backend, wm, ok := d.SessionOptions(ctx); ok {
			st.Display, st.Backend, st.WM = display, backend, wm
		}
	}
	if d.SessionCreated != nil && d.Now != nil {
		if created, ok := d.SessionCreated(ctx); ok {
			st.UptimeSeconds = int64(d.Now().Sub(created).Seconds())
		}
	}
	if d.Probe != nil {
		if network, addr, err := BackendAddr(d.ID); err == nil {
			if info, perr := d.Probe(ctx, network, addr); perr == nil {
				st.Reachable = info.Reachable
				st.Width, st.Height = info.Width, info.Height
			}
		}
	}
	if !st.Reachable {
		st.Reason = NotRunningReason(true, st.Backend, d.LookPath)
		return st
	}
	// A reachable display with no window manager runs bare — the status
	// document carries the install hint so every reader renders the same line.
	if st.WM == "" {
		st.WMHint = WMInstallHint(d.LookPath)
	}
	if d.RunningApps != nil {
		var exclude map[int]bool
		if d.PanePids != nil {
			exclude = d.PanePids(ctx)
		}
		if apps, err := d.RunningApps(st.Display, exclude); err == nil && apps != nil {
			st.Apps = apps
		}
	}
	return st
}
