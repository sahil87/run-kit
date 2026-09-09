package main

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"os/signal"
	"runtime"
	"syscall"
	"time"

	"rk/internal/daemon"
	"rk/internal/gui"
	"rk/internal/tmux"
	"rk/internal/validate"

	"github.com/spf13/cobra"
)

// Supervisor timing budgets. Vars, not consts, so tests shrink them (the
// codeServerPortFreeTimeout idiom).
var (
	// guiSocketWaitTimeout bounds the wait for the backend to bind host.sock.
	guiSocketWaitTimeout = 5 * time.Second
	guiSocketWaitPoll    = 200 * time.Millisecond
	// guiSuperviseTmuxTimeout bounds each session-option stamp.
	guiSuperviseTmuxTimeout = 5 * time.Second
	// guiScreenSharingInterval is the darwin probe cadence.
	guiScreenSharingInterval = time.Minute
)

// guiSuperviseGOOS is the platform fork seam (darwin is a probe-logging
// sleeper that spawns nothing). A package var so tests exercise the non-host
// branch.
var guiSuperviseGOOS = runtime.GOOS

// guiSuperviseLookPath resolves backend/WM binaries on PATH. A package seam
// so tests script the resolution ladder without depending on the host's PATH.
var guiSuperviseLookPath = exec.LookPath

// guiSuperviseLog writes one line to the pane — the supervisor's stdout IS
// the GUI log (the rk-gui pane is the display for these lines). A package
// seam so tests capture lines.
var guiSuperviseLog = func(line string) { fmt.Fprintln(os.Stdout, line) }

// guiSuperviseStartBackend starts the VNC backend with the pane's stdio
// inherited (its output is part of the supervisor log). ctx cancel kills the
// process. A package seam so tests never launch a real Xvnc.
var guiSuperviseStartBackend = func(ctx context.Context, argv []string) (*exec.Cmd, error) {
	cmd := exec.CommandContext(ctx, argv[0], argv[1:]...)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	return cmd, cmd.Start()
}

// guiSuperviseStartWM starts the window manager with DISPLAY set in its env —
// the tmux window's env does not carry the rk-managed display.
var guiSuperviseStartWM = func(ctx context.Context, argv []string, display string) (*exec.Cmd, error) {
	cmd := exec.CommandContext(ctx, argv[0], argv[1:]...)
	cmd.Env = append(os.Environ(), "DISPLAY="+display)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	return cmd, cmd.Start()
}

// guiSuperviseTmuxRun stamps session options on the rk-daemon socket. A
// package seam so tests capture the stamp argv without a live tmux server.
var guiSuperviseTmuxRun = func(ctx context.Context, args ...string) error {
	full := append([]string{"-L", daemon.ServerSocket}, args...)
	return exec.CommandContext(ctx, "tmux", full...).Run()
}

// guiSuperviseProbe is the RFB probe the darwin sleeper runs. A package seam
// so tests script reachability without dialing.
var guiSuperviseProbe = gui.Probe

// --- log line formats (the pane-facing strings) ---

func guiBackendUpLine(bin, display, sock string) string {
	return fmt.Sprintf("gui: %s up on %s (socket %s)", bin, display, sock)
}

func guiNoWMLine() string {
	return "gui: no window manager found (tried openbox, xfwm4, i3, kwin_x11, x-session-manager); running bare — apt install openbox"
}

func guiBackendExitLine(bin string, status int, display string) string {
	return fmt.Sprintf("gui: %s exited (status %d) — display %s is down; run 'rk gui restart' or turn the GUI off", bin, status, display)
}

func guiScreenSharingLine(reachable bool) string {
	if reachable {
		return "Screen Sharing: reachable on " + gui.MacScreenSharingAddr
	}
	return "Screen Sharing: not reachable — enable System Settings › General › Sharing › Screen Sharing"
}

// guiBackendExitStatus extracts the exit code from a backend Wait error; -1
// when the process was killed by a signal or never ran.
func guiBackendExitStatus(err error) int {
	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) {
		return exitErr.ExitCode()
	}
	return -1
}

// newGuiSuperviseCmd builds the hidden pane command. The parent `gui` family
// attaches it; it is never user-facing (Hidden).
func newGuiSuperviseCmd() *cobra.Command {
	var display string
	cmd := &cobra.Command{
		Use:   "supervise <id>",
		Short: "Run the GUI supervisor (the rk-gui pane command; internal)",
		Long: `Run the GUI supervisor for one GUI id — the command the rk-gui session's
pane executes. Its stdout/stderr IS the supervisor log.

Linux: starts the VNC backend (Xtigervnc, Xvnc fallback) on a unix socket,
stamps @rk_gui_display/@rk_gui_backend on the rk-gui session, and launches the
first window manager found. macOS: spawns nothing and logs the Screen Sharing
probe once a minute.

When the backend exits on its own the supervisor logs the exit, cleans up, and
stays alive idle — the pane keeps the log readable; 'rk gui restart' is the
recovery verb.`,
		Hidden:       true,
		Args:         usageArgs(cobra.ExactArgs(1)),
		SilenceUsage: true,
		RunE: func(_ *cobra.Command, args []string) error {
			return runGuiSupervise(args[0], display)
		},
	}
	cmd.Flags().StringVar(&display, "display", "", "X display to run (:N)")
	return cmd
}

func runGuiSupervise(id, display string) error {
	if msg := validate.ValidateGUIID(id); msg != "" {
		return errors.New(msg)
	}
	if _, err := gui.ParseDisplay(display); err != nil {
		return err
	}
	// The pane is the supervisor: SIGTERM/SIGINT/SIGHUP (tmux kill-session's
	// SIGHUP included) trigger the teardown path, then exit 0.
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT, syscall.SIGHUP)
	defer stop()
	return runGuiSuperviseCtx(ctx, id, display)
}

// runGuiSuperviseCtx is the testable core: the OS fork lives behind the
// guiSuperviseGOOS seam and the ctx carries the signal trap.
func runGuiSuperviseCtx(ctx context.Context, id, display string) error {
	if guiSuperviseGOOS == "darwin" {
		return runGuiSuperviseDarwin(ctx)
	}
	return runGuiSuperviseLinux(ctx, id, display)
}

// runGuiSuperviseLinux is the R5 ladder: state dir, stale-socket removal,
// backend exec, socket wait + chmod, session stamps, WM launch, then wait for
// either a signal (teardown, exit 0) or the backend's own exit (log, clean
// up, block until signalled — R6: no auto-respawn, no process exit, so the
// pane stays readable and the session still "exists").
func runGuiSuperviseLinux(ctx context.Context, id, display string) error {
	dir, err := gui.StateDir()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fmt.Errorf("creating the gui state dir: %w", err)
	}
	sock, err := gui.SocketPath(id)
	if err != nil {
		return err
	}
	if err := gui.ValidateSocketPath(sock); err != nil {
		return err
	}
	// Xvnc refuses to bind over an existing path, so a crashed supervisor's
	// stale socket is removed before the backend starts.
	if err := os.Remove(sock); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return fmt.Errorf("removing the stale gui socket: %w", err)
	}

	bin, _ := gui.ResolveBackend(guiSuperviseLookPath)
	if bin == "" {
		return fmt.Errorf("no VNC backend installed — %s", gui.InstallHint())
	}

	backend, err := guiSuperviseStartBackend(ctx, gui.BackendArgv(bin, display, sock))
	if err != nil {
		return fmt.Errorf("starting %s: %w", bin, err)
	}

	if !waitForGuiSocket(sock) {
		guiKillAndWait(backend)
		return fmt.Errorf("%s did not create %s within %s", bin, sock, guiSocketWaitTimeout)
	}
	// The socket is the only door to the desktop (-rfbport -1 keeps TCP
	// closed); rk on the same user is the only client, hence 0600 in a 0700 dir.
	if err := os.Chmod(sock, 0o600); err != nil {
		guiSuperviseLog(fmt.Sprintf("gui: chmod 0600 %s failed: %v", sock, err))
	}
	guiSuperviseLog(guiBackendUpLine(bin, display, sock))
	guiStampSessionOption(daemon.GUIOptionDisplay, display)
	guiStampSessionOption(daemon.GUIOptionBackend, bin)

	var wm *exec.Cmd
	if wmArgv, ok := gui.ResolveWM(guiSuperviseLookPath); ok {
		if w, werr := guiSuperviseStartWM(ctx, wmArgv, display); werr != nil {
			guiSuperviseLog(fmt.Sprintf("gui: window manager %s failed to start: %v; running bare", wmArgv[0], werr))
		} else {
			wm = w
		}
	} else {
		guiSuperviseLog(guiNoWMLine())
	}

	backendWait := make(chan error, 1)
	go func() { backendWait <- backend.Wait() }()

	select {
	case <-ctx.Done():
		// Signal trap: WM first, then the backend (CommandContext's kill is
		// already in flight), then the socket; exit 0.
		guiKillAndWait(wm)
		guiRemoveSocket(sock)
		<-backendWait
		return nil
	case werr := <-backendWait:
		if ctx.Err() != nil {
			// The signal landed while the backend was exiting — same teardown.
			guiKillAndWait(wm)
			guiRemoveSocket(sock)
			return nil
		}
		guiSuperviseLog(guiBackendExitLine(bin, guiBackendExitStatus(werr), display))
		guiKillAndWait(wm)
		guiRemoveSocket(sock)
		<-ctx.Done() // stay alive idle so the pane keeps the exit line readable
		return nil
	}
}

// runGuiSuperviseDarwin is the macOS posture: spawn nothing, stamp the
// backend name, and log the Screen Sharing probe once a minute until
// signalled.
func runGuiSuperviseDarwin(ctx context.Context) error {
	guiStampSessionOption(daemon.GUIOptionBackend, gui.MacBackend)
	for {
		info, err := guiSuperviseProbe(ctx, "tcp", gui.MacScreenSharingAddr)
		guiSuperviseLog(guiScreenSharingLine(err == nil && info.Reachable))
		select {
		case <-ctx.Done():
			return nil
		case <-time.After(guiScreenSharingInterval):
		}
	}
}

// guiStampSessionOption sets one option on the rk-gui session. Best-effort:
// the stamp informs status/env readers, but a stamp failure must never take
// down a running desktop.
func guiStampSessionOption(option, value string) {
	ctx, cancel := context.WithTimeout(context.Background(), guiSuperviseTmuxTimeout)
	defer cancel()
	// The option commands' target parser rejects the bare `=name` exact-match
	// form (tmux 3.7c: `no such session`) — session options must use the
	// session-scoped `=name:` form (the internal/tmux board.go precedent).
	if err := guiSuperviseTmuxRun(ctx, "set-option", "-t", tmux.ExactSessionTarget(daemon.GUISessionName), option, value); err != nil {
		guiSuperviseLog(fmt.Sprintf("gui: failed to stamp %s on the %s session: %v", option, daemon.GUISessionName, err))
	}
}

// waitForGuiSocket polls until the backend binds sock or the budget expires.
func waitForGuiSocket(sock string) bool {
	deadline := time.Now().Add(guiSocketWaitTimeout)
	for {
		if _, err := os.Stat(sock); err == nil {
			return true
		}
		if time.Now().After(deadline) {
			return false
		}
		time.Sleep(guiSocketWaitPoll)
	}
}

// guiRemoveSocket removes the socket on teardown; a vanished path is fine.
func guiRemoveSocket(sock string) {
	if err := os.Remove(sock); err != nil && !errors.Is(err, fs.ErrNotExist) {
		guiSuperviseLog(fmt.Sprintf("gui: removing %s failed: %v", sock, err))
	}
}

// guiKillAndWait kills a started child and reaps it; nil-safe (no WM found).
func guiKillAndWait(cmd *exec.Cmd) {
	if cmd == nil || cmd.Process == nil {
		return
	}
	_ = cmd.Process.Kill()
	_ = cmd.Wait()
}
