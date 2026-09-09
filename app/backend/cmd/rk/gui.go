package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os/exec"
	"strings"
	"time"

	"rk/internal/daemon"
	"rk/internal/gui"
	"rk/internal/settings"

	"github.com/spf13/cobra"
)

// Package seams over the daemon/gui/settings layers (the code_server.go
// idiom) so tests drive every verb's branches without a live tmux server or
// real config: the daemon-liveness gate fires BEFORE any tmux command — even
// a has-session probe on a dead rk-daemon socket would birth a server.
var (
	guiDaemonRunningFn  = daemon.IsRunning
	guiEnsureFn         = daemon.EnsureGUI
	guiKillFn           = daemon.KillGUISession
	guiRestartFn        = daemon.RestartGUI
	guiSessionExistsFn  = daemon.GUISessionExists
	guiSessionOptionsFn = daemon.GUISessionOptions
	guiSessionCreatedFn = daemon.GUISessionCreated
	guiProbeFn          = gui.Probe
	guiRunningAppsFn    = gui.RunningApps
	guiLookPathFn       = exec.LookPath
	// guiStdinTTYFn decides between the interactive [y/N] prompt and the
	// non-tty refusal on `rk gui off`. Tests substitute it to drive both.
	guiStdinTTYFn = isTerminal
	// guiViewersFn reports live /ws/gui relay viewers. The count is hub-local
	// to the daemon process; a CLI invocation cannot observe it, so the
	// production CLI reports 0 — GET /api/gui/{id} carries the live count.
	guiViewersFn = func() int { return 0 }
	guiNowFn     = time.Now
)

// guiStampWaitTimeout bounds the post-ensure poll for the supervisor's
// @rk_gui_display/@rk_gui_backend stamps (the supervisor stamps them once the
// backend is up, up to its own 5 s socket wait). A var so tests shrink it.
var guiStampWaitTimeout = 10 * time.Second

// guiProbePollTick is the stamp-poll cadence. A var so tests shrink it.
var guiStampPollTick = 250 * time.Millisecond

var guiCmd = &cobra.Command{
	Use:   "gui",
	Short: "Manage the host GUI surface (the rk-gui desktop session)",
	Long: `Manage the host GUI surface — the host's desktop, run by the rk-gui
session (a sibling of rk-daemon on the same tmux socket) and relayed to the
dashboard over /ws/gui/host.

The gui.enabled setting is the one switch: 'on' flips it and (when the daemon
is running) starts the session immediately; the daemon's boot hook re-ensures
it on every 'rk serve -d'. The backend is Xtigervnc (Xvnc fallback) on a unix
socket only — nothing ever listens on TCP; on macOS the surface mirrors Screen
Sharing view-only.

Subcommands:
  on       Turn the GUI on (idempotent; starts rk-gui when the daemon is up)
  off      Turn the GUI off (confirms when apps are running on the display)
  status   Show the GUI state (human-readable or --json)
  env      Print DISPLAY/RK_GUI_SOCKET exports for eval
  restart  Kill and respawn the rk-gui session (recovery for a dead backend)

See 'run-kit gui <subcommand> --help' for details.`,
}

var guiOnCmd = &cobra.Command{
	Use:   "on",
	Short: "Turn the GUI on and start the rk-gui session",
	Long: `Turn the GUI on: persists gui.enabled=true, then — when the daemon is
running — starts the rk-gui session immediately (idempotent: an existing
session is a skip, not an error).

With the daemon down the setting is still persisted and the daemon starts the
GUI on 'rk serve -d' — no tmux command is ever issued on a dead socket.

Linux needs a VNC backend and a window manager installed; their absence is
reported with the install hint but the setting stays on (enabling is the
user's intent — the stream and 'rk gui status' carry the not-running state).`,
	Args:         cobra.NoArgs,
	SilenceUsage: true,
	RunE:         runGuiOn,
}

var guiOffCmd = &cobra.Command{
	Use:   "off",
	Short: "Turn the GUI off and kill the rk-gui session",
	Long: `Turn the GUI off: kills the rk-gui session (and with it every app
running on its display), persists gui.enabled=false, and waits for the RFB
socket to be released so an immediate 'rk gui on' never sees the dying socket.

When apps are running on the display the command lists them and asks for
confirmation first; --yes skips the prompt (required on a non-tty stdin). On
macOS nothing runs under rk's control, so no confirmation is needed.`,
	Args:         cobra.NoArgs,
	SilenceUsage: true,
	RunE:         runGuiOff,
}

var guiStatusCmd = &cobra.Command{
	Use:   "status",
	Short: "Show the GUI state",
	Long: `Show the GUI state: 'gui: off', 'gui: on (<backend>, :N, WxH, k
viewers)' when the desktop is reachable, or 'gui: on — not running (<reason>)'
with the reason (session absent, no VNC backend, backend exited, Screen
Sharing off) when it is not. When running, the apps on the display are listed
indented below.

--json emits the machine-readable status document (the same document GET
/api/gui/host serves). Always exits 0 — this is state, not a verdict.`,
	Args:         cobra.NoArgs,
	SilenceUsage: true,
	RunE:         runGuiStatus,
}

var guiEnvCmd = &cobra.Command{
	Use:   "env",
	Short: "Print DISPLAY/RK_GUI_SOCKET exports for eval",
	Long: `Print 'export DISPLAY=:N' and 'export RK_GUI_SOCKET=<path>' for
'eval "$(rk gui env)"' — the shell-side door to the GUI display.

Exits 1 when the GUI is off or enabled but not running; 'rk gui status' has
the reason.`,
	Args:         cobra.NoArgs,
	SilenceUsage: true,
	RunE:         runGuiEnv,
}

var guiRestartCmd = &cobra.Command{
	Use:   "restart",
	Short: "Kill and respawn the rk-gui session",
	Long: `Kill and respawn the rk-gui session — the recovery verb when the
backend exited (the supervisor stays idle with the exit line in its pane; the
session still exists, so 'rk gui on' would skip it).

Refuses when the GUI is off (a restart must never flip the switch on) or the
daemon is down (a tmux command on a dead socket would birth a server).`,
	Args:         cobra.NoArgs,
	SilenceUsage: true,
	RunE:         runGuiRestart,
}

func init() {
	guiOffCmd.Flags().Bool("yes", false, "Skip the running-apps confirmation")
	guiStatusCmd.Flags().Bool("json", false, "Emit the status document as JSON")

	guiCmd.AddCommand(guiOnCmd)
	guiCmd.AddCommand(guiOffCmd)
	guiCmd.AddCommand(guiStatusCmd)
	guiCmd.AddCommand(guiEnvCmd)
	guiCmd.AddCommand(guiRestartCmd)

	// Arg-count violations on the children are usage-class (exit 2) — root.go's
	// central wrap loop covers only rootCmd's direct children (the code-server
	// family idiom). supervise self-wraps and is attached after the loop.
	for _, c := range guiCmd.Commands() {
		if c.Args != nil {
			c.Args = usageArgs(c.Args)
		}
	}
	guiCmd.AddCommand(newGuiSuperviseCmd())
}

// guiCmdCtx returns the command's context, falling back to Background for
// direct RunE invocations (the package's test idiom leaves it nil — the
// codeServerInstallToLatest precedent).
func guiCmdCtx(cmd *cobra.Command) context.Context {
	if ctx := cmd.Context(); ctx != nil {
		return ctx
	}
	return context.Background()
}

func runGuiOn(cmd *cobra.Command, _ []string) error {
	sink := newSink(cmd)
	st := guiSettingsLoad()
	st.GUIEnabled = true
	if err := guiSettingsSave(st); err != nil {
		return fmt.Errorf("saving settings: %w", err)
	}
	if !guiDaemonRunningFn() {
		sink.Dataf("enabled — the daemon starts the GUI on 'rk serve -d'\n")
		return nil
	}
	outcome, err := guiEnsureFn()
	if err != nil {
		return err
	}
	switch outcome {
	case daemon.GUIEnsureStarted:
		if bin, display := guiAwaitStamps(cmd); bin != "" {
			sink.Dataf("started (%s %s)\n", bin, display)
		} else {
			// The stamps land once the backend is up; a slow first paint must
			// not fail the verb — the setting is on and the session spawned.
			sink.Dataf("started\n")
		}
	case daemon.GUIEnsureAlreadyRunning:
		sink.Dataf("already running\n")
	case daemon.GUIEnsureNoBackend:
		sink.Dataf("enabled — no VNC backend installed: %s\n", gui.InstallHint())
	default:
		sink.Dataf("enabled\n")
	}
	return nil
}

func runGuiOff(cmd *cobra.Command, _ []string) error {
	sink := newSink(cmd)
	yes, _ := cmd.Flags().GetBool("yes")

	// The running-apps list (and the uptime) key off the supervisor's stamped
	// display, so they are gathered only with the daemon up — a session probe
	// on a dead socket would birth a tmux server. macOS yields an empty list
	// (nothing runs under rk's control), hence no prompt.
	var apps []gui.App
	var display, uptime string
	if guiDaemonRunningFn() {
		ctx, cancel := context.WithTimeout(guiCmdCtx(cmd), 5*time.Second)
		defer cancel()
		if d, _, ok := guiSessionOptionsFn(ctx); ok {
			display = d
			// The supervisor's own pids are not excluded here: the rk-gui
			// pane pid is not derivable without another tmux probe, and the
			// supervisor/backend/WM carry no DISPLAY in their own environ, so
			// the scan already omits them.
			if found, err := guiRunningAppsFn("/proc", display, nil); err == nil {
				apps = found
			}
		}
		if created, ok := guiSessionCreatedFn(ctx); ok {
			uptime = guiUptimeString(guiNowFn().Sub(created))
		}
	}

	if len(apps) > 0 && !yes {
		if !guiStdinTTYFn(cmd.InOrStdin()) {
			return errors.New("re-run with --yes")
		}
		sink.Notef("Turning the GUI off kills the rk-gui session and every app on display %s:\n", display)
		line := "  " + guiAppsSummary(apps)
		if uptime != "" {
			line += "  (up " + uptime + ")"
		}
		sink.Notef("%s\n", line)
		sink.Notef("Continue? [y/N]\n")
		if !confirm(bufio.NewReader(cmd.InOrStdin())) {
			return errors.New("aborted")
		}
	}

	killed, err := guiKillFn()
	if err != nil {
		return err
	}
	st := guiSettingsLoad()
	st.GUIEnabled = false
	if err := guiSettingsSave(st); err != nil {
		return fmt.Errorf("saving settings: %w", err)
	}
	if killed {
		sink.Dataf("gui off — rk-gui session killed\n")
	} else {
		sink.Dataf("gui off\n")
	}
	return nil
}

func runGuiStatus(cmd *cobra.Command, _ []string) error {
	sink := newSink(cmd)
	jsonOut, _ := cmd.Flags().GetBool("json")
	ctx, cancel := context.WithTimeout(guiCmdCtx(cmd), 10*time.Second)
	defer cancel()
	st := gatherGUIStatus(ctx)
	if jsonOut {
		data, err := json.MarshalIndent(st, "", "  ")
		if err != nil {
			return fmt.Errorf("encoding gui status: %w", err)
		}
		sink.Dataf("%s\n", data)
		return nil
	}
	sink.Dataf("%s\n", guiStatusSummary(st))
	if st.Reachable && len(st.Apps) > 0 {
		sink.Dataf("  apps: %s\n", guiAppsSummary(st.Apps))
	}
	return nil
}

func runGuiEnv(cmd *cobra.Command, _ []string) error {
	sink := newSink(cmd)
	ctx, cancel := context.WithTimeout(guiCmdCtx(cmd), 10*time.Second)
	defer cancel()
	st := gatherGUIStatus(ctx)
	if !st.Enabled {
		return errors.New("gui is off — turn it on with 'rk gui on'")
	}
	if !st.Reachable {
		return errors.New("gui is on but not running — see 'rk gui status'")
	}
	sink.Dataf("export DISPLAY=%s\n", st.Display)
	sink.Dataf("export RK_GUI_SOCKET=%s\n", st.Socket)
	return nil
}

func runGuiRestart(cmd *cobra.Command, _ []string) error {
	sink := newSink(cmd)
	if !guiSettingsLoad().GUIEnabled {
		return errors.New("gui is off — turn it on with 'rk gui on'")
	}
	if !guiDaemonRunningFn() {
		return errors.New("rk daemon is not running — start it with 'rk serve -d'")
	}
	if err := guiRestartFn(); err != nil {
		return err
	}
	if bin, display := guiAwaitStamps(cmd); bin != "" {
		sink.Dataf("restarted (%s %s)\n", bin, display)
	} else {
		sink.Dataf("restarted\n")
	}
	return nil
}

// gatherGUIStatus assembles the shared gui.Status document for the CLI verbs:
// settings for the switch, tmux (gated on the daemon running) for the
// session/stamps/uptime, the RFB probe for reachability and geometry, and the
// /proc scan for the apps list. All live facts flow through the package seams.
func gatherGUIStatus(ctx context.Context) gui.Status {
	st := gui.Status{ID: daemon.GUIWindowName, Apps: []gui.App{}}
	if sock, err := gui.SocketPath(daemon.GUIWindowName); err == nil {
		st.Socket = sock
	}
	st.Enabled = guiSettingsLoad().GUIEnabled
	if !st.Enabled {
		return st
	}
	st.Viewers = guiViewersFn()
	if !guiDaemonRunningFn() {
		st.Reason = gui.SessionAbsentReason
		return st
	}
	st.Session = guiSessionExistsFn(ctx)
	if !st.Session {
		st.Reason = gui.NotRunningReason(false, "", guiLookPathFn)
		return st
	}
	if display, backend, ok := guiSessionOptionsFn(ctx); ok {
		st.Display, st.Backend = display, backend
	}
	if created, ok := guiSessionCreatedFn(ctx); ok {
		st.UptimeSeconds = int64(guiNowFn().Sub(created).Seconds())
	}
	if network, addr, err := gui.BackendAddr(daemon.GUIWindowName); err == nil {
		if info, perr := guiProbeFn(ctx, network, addr); perr == nil {
			st.Reachable = info.Reachable
			st.Width, st.Height = info.Width, info.Height
		}
	}
	if !st.Reachable {
		st.Reason = gui.NotRunningReason(true, st.Backend, guiLookPathFn)
		return st
	}
	if apps, err := guiRunningAppsFn("/proc", st.Display, nil); err == nil && apps != nil {
		st.Apps = apps
	}
	return st
}

// guiStatusSummary renders the human one-liner for `rk gui status`.
func guiStatusSummary(st gui.Status) string {
	if !st.Enabled {
		return "gui: off"
	}
	if st.Reachable {
		bin := st.Backend
		if bin == "" {
			bin, _ = gui.ResolveBackend(guiLookPathFn)
		}
		return "gui: " + guiOnSummary(bin, st.Display, st.Width, st.Height, st.Viewers)
	}
	return "gui: on — not running (" + st.Reason + ")"
}

// guiOnSummary is the shared "on (<bin>, :N, WxH, k viewers)" rendering — the
// status line's tail and the doctor row's reachable note.
func guiOnSummary(bin, display string, width, height, viewers int) string {
	return fmt.Sprintf("on (%s, %s, %dx%d, %d viewers)", bin, display, width, height, viewers)
}

// guiAppsSummary renders the apps list as "<name> ×<count>, …" (the off
// confirm and the status apps line share it).
func guiAppsSummary(apps []gui.App) string {
	parts := make([]string, 0, len(apps))
	for _, a := range apps {
		parts = append(parts, fmt.Sprintf("%s ×%d", a.Name, a.Count))
	}
	return strings.Join(parts, ", ")
}

// guiUptimeString renders a session age in the confirm copy's "4h 12m" shape.
func guiUptimeString(d time.Duration) string {
	if d < 0 {
		d = 0
	}
	hours := int(d.Hours())
	mins := int(d.Minutes()) % 60
	if days := hours / 24; days > 0 {
		return fmt.Sprintf("%dd %dh", days, hours%24)
	}
	if hours > 0 {
		return fmt.Sprintf("%dh %dm", hours, mins)
	}
	return fmt.Sprintf("%dm", mins)
}

// guiAwaitStamps polls for the supervisor's @rk_gui_display/@rk_gui_backend
// stamps so `on`/`restart` can name the backend and display in their outcome
// line. ("", "") on timeout — the caller falls back to the bare line.
func guiAwaitStamps(cmd *cobra.Command) (bin, display string) {
	deadline := guiNowFn().Add(guiStampWaitTimeout)
	for {
		ctx, cancel := context.WithTimeout(guiCmdCtx(cmd), 5*time.Second)
		d, b, ok := guiSessionOptionsFn(ctx)
		cancel()
		if ok {
			return b, d
		}
		if !guiNowFn().Before(deadline) {
			return "", ""
		}
		time.Sleep(guiStampPollTick)
	}
}

// guiSettingsLoad / guiSettingsSave are the settings seams (package vars so
// tests redirect persistence at a temp RK_CONFIG_DIR — which settings.Load/
// Save honor natively — without touching the developer's real config).
var (
	guiSettingsLoad = settings.Load
	guiSettingsSave = settings.Save
)
