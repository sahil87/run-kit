package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os/exec"
	"runtime"
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
	guiPanePidsFn       = daemon.GUIPanePids
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
	// guiGOOS is the runtime.GOOS seam — the macOS refusals gate on it so
	// tests drive the darwin branch without a darwin build.
	guiGOOS = runtime.GOOS
)

// The gated verbs (env, exec, shot) share one refusal vocabulary — the hint
// strings are user-facing copy, so every verb prints the identical sentence
// for the same state.
const (
	guiErrOff        = "gui is off — turn it on with 'rk gui on'"
	guiErrNotRunning = "gui is on but not running — see 'rk gui status'"
)

// guiRequireReachable is the shared gate for verbs that act on the live
// display: enabled and reachable, or the refusal error (exit 1). The status
// is returned either way so a passing caller needs no second assembly.
func guiRequireReachable(ctx context.Context) (gui.Status, error) {
	st := gatherGUIStatus(ctx)
	if !st.Enabled {
		return st, errors.New(guiErrOff)
	}
	if !st.Reachable {
		return st, errors.New(guiErrNotRunning)
	}
	return st, nil
}

// guiDarwinRefusal renders the macOS refusal for a gated verb. The macOS
// backend mirrors the live session view-only — no X display exists to run on
// or screenshot.
func guiDarwinRefusal(verb string) error {
	return fmt.Errorf("gui %s is not supported on macOS in v1 — the GUI mirrors your live session view-only", verb)
}

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
  exec     Run a command on the GUI display (DISPLAY set); --detach to launch and return
  shot     Screenshot the display to a PNG and print its path
  launch   Open a terminal or browser on the GUI display (the allowlisted launcher)

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
viewers, <wm>)' when the desktop is reachable, or 'gui: on — not running
(<reason>)' with the reason (session absent, no VNC backend, backend exited,
Screen Sharing off) when it is not. When running, the apps on the display are
listed indented below.

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

'rk agent setup' installs this eval into your shell startup files (inside tmux
panes, when DISPLAY is unset), so new shells land on the display with no
per-shell eval.

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
	guiExecCmd.Flags().BoolP("detach", "d", false, "Start the command as its own session and return immediately")
	guiShotCmd.Flags().StringP("out", "o", "", "Write the PNG to this path (parent created, existing file overwritten)")

	guiCmd.AddCommand(guiOnCmd)
	guiCmd.AddCommand(guiOffCmd)
	guiCmd.AddCommand(guiStatusCmd)
	guiCmd.AddCommand(guiEnvCmd)
	guiCmd.AddCommand(guiRestartCmd)
	guiCmd.AddCommand(guiExecCmd)
	guiCmd.AddCommand(guiShotCmd)
	guiCmd.AddCommand(guiLaunchCmd)

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
		if bin, display, wm, ok := guiAwaitStamps(cmd); ok {
			sink.Dataf("started (%s %s)\n", bin, display)
			guiWMLines(sink, wm)
		} else {
			// The stamps land once the backend is up; a slow first paint must
			// not fail the verb — the setting is on and the session spawned.
			sink.Dataf("started\n")
		}
	case daemon.GUIEnsureAlreadyRunning:
		sink.Dataf("already running\n")
	case daemon.GUIEnsureNoBackend:
		sink.Dataf("enabled — no VNC backend installed: %s\n", gui.InstallHint(guiLookPathFn))
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
		if d, _, _, ok := guiSessionOptionsFn(ctx); ok {
			display = d
			// The pane's process tree (supervise, backend, WM) is excluded:
			// the WM carries DISPLAY in its environ and must not count as a
			// user app.
			if found, err := guiRunningAppsFn("/proc", display, guiPanePidsFn(ctx)); err == nil {
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
	st, err := guiRequireReachable(ctx)
	if err != nil {
		return err
	}
	// The output is eval'd by shells (the rk gui display startup block). The
	// display is a validated :N and stays bare; the socket path inherits
	// $XDG_STATE_HOME verbatim, so it is single-quoted — a space or shell
	// metacharacter in that path must neither split the export nor execute.
	sink.Dataf("export DISPLAY=%s\n", st.Display)
	sink.Dataf("export RK_GUI_SOCKET=%s\n", shellSingleQuote(st.Socket))
	return nil
}

// shellSingleQuote wraps s in single quotes for POSIX shells. An embedded
// single quote — the one character a single-quoted string cannot carry — is
// emitted by closing the quotes, backslash-escaping it, and reopening them.
func shellSingleQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}

func runGuiRestart(cmd *cobra.Command, _ []string) error {
	sink := newSink(cmd)
	if !guiSettingsLoad().GUIEnabled {
		return errors.New(guiErrOff)
	}
	if !guiDaemonRunningFn() {
		return errors.New("rk daemon is not running — start it with 'rk serve -d'")
	}
	if err := guiRestartFn(); err != nil {
		return err
	}
	if bin, display, wm, ok := guiAwaitStamps(cmd); ok {
		sink.Dataf("restarted (%s %s)\n", bin, display)
		guiWMLines(sink, wm)
	} else {
		sink.Dataf("restarted\n")
	}
	return nil
}

// guiWMLines prints the window-manager chatter after a started/restarted
// datum: the resolved WM name, or the bare-display install hint pair when the
// supervisor stamped an empty @rk_gui_wm. Chatter-class (Notef) so --quiet and
// scripts keep the one-line datum.
func guiWMLines(sink outputSink, wm string) {
	if wm != "" {
		sink.Notef("  window manager: %s\n", wm)
		return
	}
	hint := gui.WMInstallHint(guiLookPathFn)
	if hint == "" {
		// No hint means no WM concept on this OS (the darwin mirror) — an
		// empty stamp is not a bare desktop there, so nothing to say.
		return
	}
	sink.Notef("  no window manager — running bare. Install one: %s\n", hint)
	sink.Notef("  then: rk gui restart\n")
}

// gatherGUIStatus assembles the shared gui.Status document for the CLI verbs
// by wiring the package seams into gui.Assemble (the assembly — daemon gate,
// stamps, uptime, probe, reason, apps — is owned once in internal/gui).
func gatherGUIStatus(ctx context.Context) gui.Status {
	return gui.Assemble(ctx, gui.StatusDeps{
		ID:             daemon.GUIWindowName,
		Enabled:        guiSettingsLoad().GUIEnabled,
		DaemonRunning:  guiDaemonRunningFn,
		SessionExists:  guiSessionExistsFn,
		SessionOptions: guiSessionOptionsFn,
		SessionCreated: guiSessionCreatedFn,
		PanePids:       guiPanePidsFn,
		Probe:          guiProbeFn,
		RunningApps: func(display string, exclude map[int]bool) ([]gui.App, error) {
			return guiRunningAppsFn("/proc", display, exclude)
		},
		LookPath: guiLookPathFn,
		Viewers:  guiViewersFn,
		Now:      guiNowFn,
	})
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
		return "gui: " + guiOnSummary(bin, st.Display, st.Width, st.Height, st.Viewers, st.WM)
	}
	return "gui: on — not running (" + st.Reason + ")"
}

// guiOnSummary is the shared "on (<bin>, :N, WxH, k viewer(s), <wm>)" rendering
// — the status line's tail and the doctor row's reachable note. An empty wm
// renders the bare "no window manager" (the doctor appends the install hint
// itself; the status line does not).
func guiOnSummary(bin, display string, width, height, viewers int, wm string) string {
	noun := "viewers"
	if viewers == 1 {
		noun = "viewer"
	}
	if wm == "" {
		wm = "no window manager"
	}
	return fmt.Sprintf("on (%s, %s, %dx%d, %d %s, %s)", bin, display, width, height, viewers, noun, wm)
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

// guiAwaitStamps polls for the supervisor's @rk_gui_display/@rk_gui_backend/
// @rk_gui_wm stamps so `on`/`restart` can name the backend, display, and
// window manager in their outcome line. ok=false on timeout — the caller
// falls back to the bare line.
func guiAwaitStamps(cmd *cobra.Command) (bin, display, wm string, ok bool) {
	deadline := guiNowFn().Add(guiStampWaitTimeout)
	for {
		ctx, cancel := context.WithTimeout(guiCmdCtx(cmd), 5*time.Second)
		d, b, w, stamped := guiSessionOptionsFn(ctx)
		cancel()
		if stamped {
			return b, d, w, true
		}
		if !guiNowFn().Before(deadline) {
			return "", "", "", false
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
