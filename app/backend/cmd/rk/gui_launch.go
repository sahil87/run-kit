package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"time"

	"rk/internal/gui"

	"github.com/spf13/cobra"
)

// Package seams (the gui.go idiom) so tests drive every branch without an X
// server or a real PATH: the resolved-path stat (the launcher ladders'
// dangling Debian-alternative guard) and the detached start.
var (
	guiStatFn        = os.Stat
	guiLaunchStartFn = gui.StartDetached
)

var guiLaunchCmd = &cobra.Command{
	Use:   "launch <terminal|browser>",
	Short: "Open a terminal or browser on the GUI display",
	Long: `Open a terminal or browser on the GUI display — the allowlisted
launcher: the argument is a role, never an arbitrary command (use 'rk gui
exec' for that). The role resolves server-side through a fixed ladder of
known binaries (the first one on PATH wins); the app starts detached on the
rk-gui display with DISPLAY and RK_GUI_SOCKET set and rk returns immediately.

When no binary on the role's ladder is installed, the verb prints the install
line and exits 1. Refuses (exit 1) when the GUI is off or enabled but not
running ('rk gui status' has the reason); on macOS the surface mirrors your
live session view-only, so there is no display to launch on.`,
	Args:         cobra.ExactArgs(1),
	SilenceUsage: true,
	RunE:         runGuiLaunch,
}

func runGuiLaunch(cmd *cobra.Command, args []string) error {
	if guiGOOS == "darwin" {
		return guiDarwinRefusal("launch")
	}
	ctx, cancel := context.WithTimeout(guiCmdCtx(cmd), 10*time.Second)
	defer cancel()
	st, err := guiRequireReachable(ctx)
	if err != nil {
		return err
	}
	role, err := gui.ParseAppRole(args[0])
	if err != nil {
		return usageError(err)
	}
	name, path, ok := gui.ResolveApp(role, guiLookPathFn, guiStatFn)
	if !ok {
		return errors.New(gui.LaunchHint(role, guiLookPathFn))
	}
	pid, err := guiLaunchStartFn([]string{path}, gui.LaunchEnv(os.Environ(), st.Display, st.Socket))
	if err != nil {
		return fmt.Errorf("error: %s: %w", name, err)
	}
	newSink(cmd).Dataf("started %s (pid %d) on %s\n", name, pid, st.Display)
	return nil
}
