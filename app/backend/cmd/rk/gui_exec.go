package main

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"syscall"
	"time"

	"rk/internal/gui"

	"github.com/spf13/cobra"
)

// rk gui exec — run a command on the GUI display. The foreground path is a
// process-replacing exec (the `rk mux guard` passthrough idiom): a GUI app
// runs until the user closes it, so a wait-timeout would be wrong and a
// supervising relay would break TTY/signal semantics — signals, the tty, and
// the child's exit status belong to the command with no relay code.
// Constitution §I's timeout rule governs subprocesses rk waits on; the exec
// passthrough waits on nothing. The §I substance is kept: an explicit argv
// slice, no shell string, LookPath resolution before exec.

// Package seams (the gui.go idiom) so tests drive every branch without an X
// server: LookPath, the process-replacing exec, the detached start, and the
// OS gate (guiGOOS lives in gui.go).
var (
	guiExecLookPathFn = exec.LookPath
	guiExecFn         = syscall.Exec
	guiExecStartFn    = gui.StartDetached
)

var guiExecCmd = &cobra.Command{
	Use:   "exec <cmd> [args…]",
	Short: "Run a command on the GUI display (DISPLAY set)",
	Long: `Run a command on the GUI display: resolves <cmd> on PATH and runs it
with DISPLAY (and RK_GUI_SOCKET) pointed at the rk-gui desktop — an existing
DISPLAY is overridden; the rk display is the point.

The default is a foreground passthrough: the rk process is replaced by the
command, so the tty, signals, and the exit status are the command's. With
--detach the command is started as its own session with stdio on /dev/null
and rk returns immediately (the launcher shape an agent's shell needs for a
long-lived app).

A literal -- ends flag parsing so dash-prefixed program args pass through.

Examples:
  rk gui exec xterm                          # runs in the foreground on the GUI display
  rk gui exec --detach chromium https://example.com
  rk gui exec xdotool key ctrl+l             # drive the display; pair with rk gui shot

Refuses (exit 1) when the GUI is off or enabled but not running ('rk gui
status' has the reason); on macOS the surface mirrors your live session
view-only, so there is no display to run on.`,
	Args:         cobra.MinimumNArgs(1),
	SilenceUsage: true,
	RunE:         runGuiExec,
}

// guiExecReceipt is the --json success document of the --detach path: the
// two facts the `started <pid> on <display>` line prints. The foreground path
// replaces the process and can print no receipt, so --json requires --detach.
type guiExecReceipt struct {
	PID     int    `json:"pid"`
	Display string `json:"display"`
}

// guiExecEnv composes the exec'd environment — gui.LaunchEnv's rule (DISPLAY
// and RK_GUI_SOCKET set on the caller's env, replaced never duplicated),
// shared with the HTTP launcher through internal/gui.
func guiExecEnv(base []string, display, socket string) []string {
	return gui.LaunchEnv(base, display, socket)
}

// guiExecStartDetached is gui.StartDetached: the command starts as its own
// session (Setsid — it outlives the caller's shell) with stdio on /dev/null
// and is never waited on. Returns the started pid.
func guiExecStartDetached(argv []string, env []string) (int, error) {
	return gui.StartDetached(argv, env)
}

// runGuiExec gates on the flag pair, the OS, and the switch, then either
// execs (foreground, default) or starts detached (--detach).
func runGuiExec(cmd *cobra.Command, args []string) error {
	// Flag validation precedes every gate: usage errors first.
	detach, _ := cmd.Flags().GetBool("detach")
	jsonOut, _ := cmd.Flags().GetBool("json")
	if jsonOut && !detach {
		return usageError(fmt.Errorf("--json requires --detach (the foreground path replaces the process and can print no receipt)"))
	}
	if guiGOOS == "darwin" {
		return guiDarwinRefusal("exec")
	}
	ctx, cancel := context.WithTimeout(guiCmdCtx(cmd), 10*time.Second)
	defer cancel()
	st, err := guiRequireReachable(ctx)
	if err != nil {
		return err
	}
	env := guiExecEnv(os.Environ(), st.Display, st.Socket)

	if detach {
		pid, err := guiExecStartFn(args, env)
		if err != nil {
			return fmt.Errorf("error: %s: %w", args[0], err)
		}
		sink := newSink(cmd)
		if jsonOut {
			sink.JSONResult(guiExecReceipt{PID: pid, Display: st.Display})
			return nil
		}
		sink.Dataf("started %d on %s\n", pid, st.Display)
		return nil
	}

	path, err := guiExecLookPathFn(args[0])
	if err != nil {
		return fmt.Errorf("error: %s: not found on PATH", args[0])
	}
	if err := guiExecFn(path, args, env); err != nil {
		return fmt.Errorf("error: exec %s: %w", path, err)
	}
	return nil
}
