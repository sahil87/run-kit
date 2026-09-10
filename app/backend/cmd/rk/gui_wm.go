package main

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode"

	"rk/internal/gui"

	"github.com/spf13/cobra"
)

// guiWMAliases maps the friendly verb argument to the gui.wm pin value; any
// other argument is taken as a literal binary name.
var guiWMAliases = map[string]string{
	"auto":  "",
	"icewm": "icewm-session",
	"lxqt":  "startlxqt",
	"xfce":  "startxfce4",
}

// guiWMTakesEffect is the suffix a bare set carries: the pin is read once at
// supervise start, so it applies on the next restart — which kills every app
// on the display.
const guiWMTakesEffect = " — takes effect on rk gui restart (kills apps on the display)"

var guiWmCmd = &cobra.Command{
	Use:   "wm [auto|icewm|lxqt|xfce|<binary>]",
	Short: "Show or pin the window manager (gui.wm)",
	Long: `Show or pin the window manager the rk-gui supervisor starts (the gui.wm
setting).

With no argument, prints the current pin and the live rung — 'wm: auto →
icewm-session (running)', 'wm: startlxqt (pinned; running)' — and exits 0 in
every state (this is state, not a verdict).

With an argument, pins the window manager: 'auto' clears the pin (the
icewm-session-first ladder resolves), 'icewm'/'lxqt'/'xfce' alias
icewm-session/startlxqt/startxfce4, anything else is a literal binary name.
Session starters (startlxqt, startxfce4, …) run under dbus-run-session; bare
window managers run unwrapped.

A name not on PATH is refused with the install hint unless --force pins it
anyway (the supervisor logs the miss and falls back to the ladder). The pin
is read once at supervise start: without --restart it takes effect on the
next 'rk gui restart'; --restart chains into that verb (which refuses when
the GUI is off or the daemon is down).`,
	Args:         cobra.MaximumNArgs(1),
	SilenceUsage: true,
	RunE:         runGuiWM,
}

func runGuiWM(cmd *cobra.Command, args []string) error {
	sink := newSink(cmd)
	if len(args) == 0 {
		return runGuiWMReport(cmd, sink)
	}

	name, err := guiWMResolveName(args[0])
	if err != nil {
		return err
	}
	force, _ := cmd.Flags().GetBool("force")
	if name != "" && !force {
		if _, err := guiLookPathFn(name); err != nil {
			return fmt.Errorf("%s not on PATH — %s (pass --force to pin anyway)", name, gui.PinInstallHint(name, guiLookPathFn))
		}
	}

	st := guiSettingsLoad()
	st.GUIWM = name
	if err := guiSettingsSave(st); err != nil {
		return fmt.Errorf("saving settings: %w", err)
	}

	line := "set gui.wm=" + name
	if name == "" {
		line = "set gui.wm= (ladder)"
	}
	restart, _ := cmd.Flags().GetBool("restart")
	if !restart {
		sink.Dataf("%s%s\n", line, guiWMTakesEffect)
		return nil
	}
	sink.Dataf("%s\n", line)
	return runGuiRestart(cmd, nil)
}

// guiWMResolveName maps an alias or validates a literal argument: the pin is
// LookPath'd and exec'd by the supervisor, so a literal must be a bare binary
// name — non-empty, no '/', no whitespace (Constitution I).
func guiWMResolveName(arg string) (string, error) {
	if name, ok := guiWMAliases[arg]; ok {
		return name, nil
	}
	if arg == "" || strings.Contains(arg, "/") || strings.IndexFunc(arg, unicode.IsSpace) >= 0 {
		return "", usageError(errors.New("window manager name must be a bare binary name"))
	}
	return arg, nil
}

// runGuiWMReport prints the pin and the live rung. Read-only, exit 0 in every
// state — state, not a verdict (the status verb's rule).
func runGuiWMReport(cmd *cobra.Command, sink outputSink) error {
	ctx, cancel := context.WithTimeout(guiCmdCtx(cmd), 10*time.Second)
	defer cancel()
	st := gatherGUIStatus(ctx)
	pin := guiSettingsLoad().GUIWM
	switch {
	case pin == "" && !st.Reachable:
		sink.Dataf("wm: auto (not running)\n")
	case pin == "" && st.WM == "":
		sink.Dataf("wm: auto (running bare)\n")
	case pin == "":
		sink.Dataf("wm: auto → %s (running)\n", st.WM)
	case !st.Reachable:
		sink.Dataf("wm: %s (pinned; not running)\n", pin)
	case st.WM == "":
		sink.Dataf("wm: %s (pinned; running bare)\n", pin)
	case st.WM == pin:
		sink.Dataf("wm: %s (pinned; running)\n", pin)
	default:
		sink.Dataf("wm: %s (pinned; running %s)\n", pin, st.WM)
	}
	return nil
}
