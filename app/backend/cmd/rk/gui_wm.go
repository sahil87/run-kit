package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"text/tabwriter"
	"time"
	"unicode"

	"rk/internal/gui"

	"github.com/spf13/cobra"
)

// guiWMAliases maps the friendly verb argument to the gui.wm pin value; any
// other argument is taken as a literal binary name.
var guiWMAliases = map[string]string{
	"auto":     "",
	"icewm":    "icewm-session",
	"lxqt":     "startlxqt",
	"xfce":     "startxfce4",
	"plasma":   "startplasma-x11",
	"lxde":     "startlxde",
	"mate":     "mate-session",
	"cinnamon": "cinnamon-session",
}

// guiWMTakesEffect is the suffix a bare set carries: the pin is read once at
// supervise start, so it applies on the next restart — which kills every app
// on the display.
const guiWMTakesEffect = " — takes effect on rk gui restart (kills apps on the display)"

var guiWmCmd = &cobra.Command{
	Use:   "wm [auto|icewm|lxqt|xfce|plasma|lxde|mate|cinnamon|<binary>]",
	Short: "Show or pin the window manager (gui.wm)",
	Long: `Show or pin the window manager the rk-gui supervisor starts (the gui.wm
setting).

With no argument, prints the current pin and the live rung — 'wm: auto →
icewm-session (running)', 'wm: startlxqt (pinned; running)' — and exits 0 in
every state (this is state, not a verdict).

With an argument, pins the window manager: 'auto' clears the pin (the
icewm-session-first ladder resolves), the aliases below name the known
desktops, anything else is a literal binary name. The known desktops
(alias · starter · Debian/Ubuntu install line):

  icewm     icewm-session     sudo apt install --no-install-recommends icewm        (default, seeded)
  lxqt      startlxqt         sudo apt install --no-install-recommends lxqt-core    (seeded)
  xfce      startxfce4        sudo apt install --no-install-recommends xfce4
  plasma    startplasma-x11   sudo apt install --no-install-recommends plasma-desktop
  lxde      startlxde         sudo apt install --no-install-recommends lxde-core
  mate      mate-session      sudo apt install --no-install-recommends mate-desktop-environment-core
  cinnamon  cinnamon-session  sudo apt install --no-install-recommends cinnamon-core

--list and the refusal line word the install hint for the detected package
manager (apt, dnf, pacman); Fedora 40+ ships no Plasma X11 session. Session
starters run under dbus-run-session; bare window managers run unwrapped.

To run a desktop rk does not know: install it ('sudo apt install <pkg>'),
then 'rk gui wm <starter> --restart'. A binary not in the known list runs
bare — the panels and trays of an unlisted full desktop may fail on the
headless display; ask for it to be added, or run --list to see the known
set.

A name not on PATH is refused with the install hint unless --force pins it
anyway (the supervisor logs the miss and falls back to the ladder). The pin
is read once at supervise start: without --restart it takes effect on the
next 'rk gui restart'; --restart chains into that verb (which refuses when
the GUI is off or the daemon is down).

--list prints the candidate table the pickers read — installed desktops
first, then the known-but-missing ones with their install lines — and exits
0 (read-only: LookPath only, no settings write, no tmux). --list --json
emits the wm_candidates array verbatim (the same JSON GET /api/gui/host
carries).`,
	Args:         cobra.MaximumNArgs(1),
	SilenceUsage: true,
	RunE:         runGuiWM,
}

func runGuiWM(cmd *cobra.Command, args []string) error {
	sink := newSink(cmd)
	list, _ := cmd.Flags().GetBool("list")
	jsonOut, _ := cmd.Flags().GetBool("json")
	if list || jsonOut {
		return runGuiWMList(cmd, sink, args, list, jsonOut)
	}
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

// runGuiWMList prints the candidate table the pickers read. Read-only:
// LookPath only — no settings write, no tmux, no daemon gate.
func runGuiWMList(cmd *cobra.Command, sink outputSink, args []string, list, jsonOut bool) error {
	if !list {
		return usageError(errors.New("--json requires --list"))
	}
	if len(args) > 0 {
		return usageError(errors.New("--list takes no argument"))
	}
	if restart, _ := cmd.Flags().GetBool("restart"); restart {
		return usageError(errors.New("--list cannot be combined with --restart"))
	}
	if force, _ := cmd.Flags().GetBool("force"); force {
		return usageError(errors.New("--list cannot be combined with --force"))
	}
	candidates := gui.WMCandidates(guiLookPathFn)
	if jsonOut {
		data, err := json.MarshalIndent(candidates, "", "  ")
		if err != nil {
			return fmt.Errorf("encoding wm candidates: %w", err)
		}
		sink.Dataf("%s\n", data)
		return nil
	}
	var buf strings.Builder
	tw := tabwriter.NewWriter(&buf, 2, 8, 2, ' ', 0)
	fmt.Fprintln(tw, "NAME\tLABEL\tKIND\tINSTALLED\tHINT")
	for _, c := range candidates {
		installed := "no"
		if c.Installed {
			installed = "yes"
		}
		fmt.Fprintf(tw, "%s\t%s\t%s\t%s\t%s\n", c.Name, c.Label, c.Kind, installed, c.Hint)
	}
	if err := tw.Flush(); err != nil {
		return fmt.Errorf("rendering wm candidates: %w", err)
	}
	// Installed rows carry no hint; the empty last cell would leave the
	// INSTALLED padding as trailing whitespace.
	lines := strings.Split(buf.String(), "\n")
	for i, l := range lines {
		lines[i] = strings.TrimRight(l, " ")
	}
	sink.Dataf("%s", strings.Join(lines, "\n"))
	return nil
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
