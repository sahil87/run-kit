package daemon

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"time"

	"rk/internal/gui"
	"rk/internal/selfpath"
	"rk/internal/settings"
	"rk/internal/tmux"
)

const (
	// GUISessionName is the tmux session running the host desktop supervisor.
	// It is a SIBLING session on the rk-daemon socket (the rk-code-server
	// precedent), never a window inside rk-daemon: the desktop must survive
	// `rk serve` exits and `daemon stop`.
	GUISessionName = "rk-gui"
	// GUIWindowName is the single window inside the rk-gui session — the
	// supervisor pane whose stdout/stderr IS the GUI log.
	GUIWindowName = "host"
	// GUIOptionDisplay / GUIOptionBackend are the tmux session options the
	// supervisor stamps once the backend is up; readers (rk gui status/env,
	// the state-stream probe) treat unset options as "not running".
	GUIOptionDisplay = "@rk_gui_display"
	GUIOptionBackend = "@rk_gui_backend"
	// GUIOptionWM is the supervisor-stamped window-manager name ("" when the
	// display runs bare). Best-effort for readers: an unset option reads as
	// "" and never affects the ok of GUISessionOptions.
	GUIOptionWM = "@rk_gui_wm"
	// GUIOptionLock is the host-side resolution pin (`rk gui lock`): set to "1"
	// while locked, unset when unlocked. Session-scoped, so it dies with the
	// rk-gui session — a stale pin cannot survive a restart.
	GUIOptionLock = "@rk_gui_lock"
	// guiDisplayStart is the lowest display the ensure ladder hands out —
	// below :10 belongs to the host's desktop session.
	guiDisplayStart = 10
)

// guiSessionExists reports whether the rk-gui session exists on the daemon
// socket. A package seam (mirroring codeServerSessionExists) so tests drive
// the idempotent-skip branch without a live tmux server.
var guiSessionExists = func(ctx context.Context) bool {
	return sessionExistsCtx(ctx, GUISessionName)
}

// guiSpawn creates the detached rk-gui session via runTmux
// (exec.CommandContext + argv + cmdTimeout, Constitution I). A package seam
// so tests capture the argv without a live tmux server.
var guiSpawn = func(ctx context.Context, args ...string) error {
	return runTmux(ctx, args...)
}

// guiKillRun is the package seam over the kill's tmux command (mirroring
// codeServerKillRun).
var guiKillRun = func(ctx context.Context, args ...string) error {
	return runTmux(ctx, args...)
}

// guiSelfPath resolves this daemon's own on-disk binary path for the spawn
// argv's supervise command. A package seam so tests return a fixed path.
var guiSelfPath = selfpath.Resolve

// guiLookPath resolves backend binaries on PATH. A package seam so tests
// script the no-backend branch without depending on the host's PATH.
var guiLookPath = exec.LookPath

// guiFreeDisplay picks the lowest free X display. A package seam over
// gui.FreeDisplay so tests never touch /tmp/.X*-lock.
var guiFreeDisplay = gui.FreeDisplay

// guiSocketExists reports whether the host.sock RFB socket is on disk. A
// package seam so the socket-release wait is scriptable in tests.
var guiSocketExists = func() bool {
	sock, err := gui.SocketPath(GUIWindowName)
	if err != nil {
		return false
	}
	_, err = os.Stat(sock)
	return err == nil
}

// guiGOOS is the platform fork seam: the no-backend ladder rung is Linux-only
// (darwin spawns nothing and never reports NoBackend).
var guiGOOS = runtime.GOOS

// GUIEnsureOutcome classifies how an ensure call ended so the CLI can print
// the right outcome line (the daemon ignores the value — its posture is
// warn-and-continue).
type GUIEnsureOutcome int

const (
	// GUIEnsureDisabled: gui.enabled is off — the silent boot-hook skip.
	// The zero value so a forgotten assignment can never read as a start.
	GUIEnsureDisabled GUIEnsureOutcome = iota
	// GUIEnsureAlreadyRunning: the rk-gui session exists — silent skip (a
	// dead-backend session still "exists"; restart is the recovery verb).
	GUIEnsureAlreadyRunning
	// GUIEnsureNoBackend: Linux with neither Xtigervnc nor Xvnc on PATH.
	// Nil error in both postures — the outcome carries the install hint.
	GUIEnsureNoBackend
	// GUIEnsureStateDirFailed: the state dir is not creatable or the socket
	// path exceeds the unix sun_path cap.
	GUIEnsureStateDirFailed
	// GUIEnsureStarted: the session was spawned.
	GUIEnsureStarted
)

// ensureGUICore is the shared ensure path behind the daemon's ensureGUI
// (cli=false) and the CLI/API EnsureGUI (cli=true). The postures differ only
// on failure: the daemon warns and continues (a missing desktop must never
// block the dashboard); the CLI returns operational errors. The skip order
// is fixed: disabled, session-exists, no-backend (Linux only), state-dir,
// THEN spawn.
func ensureGUICore(cli bool) (GUIEnsureOutcome, error) {
	ctx, cancel := context.WithTimeout(context.Background(), cmdTimeout)
	defer cancel()

	if !settings.Load().GUIEnabled {
		return GUIEnsureDisabled, nil
	}
	if guiSessionExists(ctx) {
		return GUIEnsureAlreadyRunning, nil
	}
	if guiGOOS == "linux" {
		_, tigerErr := guiLookPath("Xtigervnc")
		_, xvncErr := guiLookPath("Xvnc")
		if tigerErr != nil && xvncErr != nil {
			if !cli {
				slog.Warn("gui not started: no VNC backend on PATH", "hint", gui.InstallHint(guiLookPath))
			}
			// Nil error in both postures: the outcome carries the install
			// hint and enabling stays the user's intent.
			return GUIEnsureNoBackend, nil
		}
	}

	dir, dirErr := gui.StateDir()
	if dirErr == nil {
		dirErr = os.MkdirAll(dir, 0o700)
	}
	sock := ""
	if dirErr == nil {
		sock, dirErr = gui.SocketPath(GUIWindowName)
	}
	if dirErr == nil {
		dirErr = gui.ValidateSocketPath(sock)
	}
	if dirErr != nil {
		if cli {
			return GUIEnsureStateDirFailed, fmt.Errorf("gui state dir %q unusable: %w", dir, dirErr)
		}
		slog.Warn("gui not started: state dir unusable", "dir", dir, "err", dirErr)
		return GUIEnsureStateDirFailed, nil
	}

	n, dispErr := guiFreeDisplay(guiDisplayStart)
	if dispErr != nil {
		if cli {
			return GUIEnsureStateDirFailed, dispErr
		}
		slog.Warn("gui not started: no free display", "err", dispErr)
		return GUIEnsureStateDirFailed, nil
	}
	display := fmt.Sprintf(":%d", n)

	exe, exeErr := guiSelfPath()
	if exeErr != nil {
		if cli {
			return GUIEnsureStarted, fmt.Errorf("resolving the rk binary path: %w", exeErr)
		}
		slog.Warn("gui session spawn skipped: could not resolve the rk binary path", "err", exeErr)
		return GUIEnsureStarted, nil
	}

	args := []string{
		"new-session", "-d",
		// Pin the daemon's own XDG_STATE_HOME into the pane: tmux builds pane
		// environments from the SERVER's environment (plus the client's
		// update-environment allowlist, which XDG_STATE_HOME is not on), so
		// without the pin a daemon launched under a different state home than
		// the tmux server's birth env forks the socket path — supervise writes
		// host.sock under one root while the probe/relay reads the other. The
		// daemon session's RK_DAEMON_LOG pin (startSession) is the precedent.
		// An empty value sets the var empty, which StateDir treats as unset —
		// aligned with the daemon either way.
		"-e", "XDG_STATE_HOME=" + os.Getenv("XDG_STATE_HOME"),
		"-s", GUISessionName,
		"-n", GUIWindowName,
		exe, "gui", "supervise", GUIWindowName, "--display", display,
	}
	if err := guiSpawn(ctx, args...); err != nil {
		if cli {
			return GUIEnsureStarted, fmt.Errorf("spawning the %s session: %w", GUISessionName, err)
		}
		slog.Warn("gui session spawn failed; the daemon continues without it", "err", err)
		return GUIEnsureStarted, nil
	}
	return GUIEnsureStarted, nil
}

// ensureGUI starts the rk-gui sibling session beside the daemon on the
// rk-daemon socket. Best-effort and re-entrant on every daemon start (the
// ensureCodeServer posture): disabled, an existing session, or a missing
// backend warns/skips and NEVER fails daemon start.
func ensureGUI() {
	_, _ = ensureGUICore(false) // warn-and-continue: errors are logged inside
}

// EnsureGUI is the exported ensure entry for the CLI and the settings-POST
// side effect. It is gated on the daemon running — any tmux command on a dead
// socket would silently BIRTH a server (the StartCodeServer gate's mirror),
// so a down daemon is an operational error naming `rk serve -d`.
func EnsureGUI() (GUIEnsureOutcome, error) {
	ctx, cancel := context.WithTimeout(context.Background(), cmdTimeout)
	defer cancel()
	if !jobDaemonRunning(ctx) {
		return GUIEnsureDisabled, fmt.Errorf("rk daemon is not running — start it with `rk serve -d`")
	}
	return ensureGUICore(true)
}

// Socket-release wait: tmux kill-session only SIGHUPs the pane, and the
// supervisor takes a moment to trap the signal, kill the backend, and remove
// host.sock. Without the wait, an ensure composed right after a kill probes
// the still-present socket. Vars, not consts, so tests shrink them (the
// codeServerPortFreeTimeout idiom).
var (
	guiSocketFreeTimeout = 5 * time.Second
	guiSocketFreePoll    = 200 * time.Millisecond
)

// waitForGUISocketFree polls until host.sock disappears or the budget
// expires. Expiry is non-fatal by design: the wait only closes the race
// window, it adds no failure mode.
func waitForGUISocketFree() {
	deadline := time.Now().Add(guiSocketFreeTimeout)
	for guiSocketExists() {
		if time.Now().After(deadline) {
			return
		}
		time.Sleep(guiSocketFreePoll)
	}
}

// KillGUISession kills the rk-gui session (exact-match target — prefix-match
// hijack is the class of footgun the `=` anchors exist to prevent). An absent
// session is success (nothing to kill). On a real kill this blocks — bounded
// by guiSocketFreeTimeout — until the dying supervisor removes host.sock,
// making kill+respawn compositions safe by construction.
func KillGUISession() (killed bool, err error) {
	ctx, cancel := context.WithTimeout(context.Background(), cmdTimeout)
	defer cancel()
	if !guiSessionExists(ctx) {
		return false, nil
	}
	slog.Warn("tmux teardown", "audit", "kill", "op", "kill-session", "server", serverSocket, "target", GUISessionName, "callers", "daemon.KillGUISession")
	if err := guiKillRun(ctx, "kill-session", "-t", "="+GUISessionName); err != nil {
		return false, fmt.Errorf("killing the %s session: %w", GUISessionName, err)
	}
	waitForGUISocketFree()
	return true, nil
}

// RestartGUI is the recovery verb for a dead-backend session: kill (which
// also owns the socket-release wait) then ensure in the CLI posture. Refuses
// when the GUI is off — a restart must never flip the switch on.
func RestartGUI() error {
	if !settings.Load().GUIEnabled {
		return fmt.Errorf("gui is off — turn it on with 'rk gui on'")
	}
	if _, err := KillGUISession(); err != nil {
		return err
	}
	_, err := ensureGUICore(true)
	return err
}

// GUISessionExists reports whether the rk-gui session exists on the daemon
// socket. Callers probing from OUTSIDE the daemon process must gate on the
// daemon running first — a tmux command on a dead socket births a server.
func GUISessionExists(ctx context.Context) bool {
	return guiSessionExists(ctx)
}

// guiSessionOption reads one session option from the rk-gui session. A
// package seam over runTmuxOutput so tests script the stamped values without
// a live tmux server. show-options -v (no -q) hard-fails on an unset user
// option, which callers treat as absent.
var guiSessionOption = func(ctx context.Context, option string) (string, error) {
	// The option commands' target parser rejects the bare `=name` exact-match
	// form (tmux 3.7c: `no such session`) while accepting it for
	// display-message/kill-session — session options must use the
	// session-scoped `=name:` form (the internal/tmux board.go precedent).
	out, err := runTmuxOutput(ctx, "show-options", "-v", "-t", tmux.ExactSessionTarget(GUISessionName), option)
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(out)), nil
}

// GUISessionOptions returns the display, backend, and window manager the
// supervisor stamped on the rk-gui session. ok=false for an absent session or
// unset display/backend options — both mean "not running" to callers. wm is
// best-effort: an unset or empty stamp reads as "" without affecting ok.
func GUISessionOptions(ctx context.Context) (display, backend, wm string, ok bool) {
	if !guiSessionExists(ctx) {
		return "", "", "", false
	}
	display, err := guiSessionOption(ctx, GUIOptionDisplay)
	if err != nil || display == "" {
		return "", "", "", false
	}
	backend, err = guiSessionOption(ctx, GUIOptionBackend)
	if err != nil || backend == "" {
		return "", "", "", false
	}
	wm, _ = guiSessionOption(ctx, GUIOptionWM)
	return display, backend, wm, true
}

// guiSetLockRun is the package seam over the lock pin's tmux write (the
// guiSpawn/guiKillRun idiom) so tests capture the argv without a live tmux
// server.
var guiSetLockRun = func(ctx context.Context, args ...string) error {
	return runTmux(ctx, args...)
}

// SetGUILock sets or unsets the host resolution pin on the rk-gui session
// (GUIOptionLock = "1" while locked, removed when unlocked). The option
// commands need the session-scoped exact-match target (the guiSessionOption
// comment's tmux 3.7c note).
func SetGUILock(ctx context.Context, locked bool) error {
	target := tmux.ExactSessionTarget(GUISessionName)
	if locked {
		return guiSetLockRun(ctx, "set-option", "-t", target, GUIOptionLock, "1")
	}
	return guiSetLockRun(ctx, "set-option", "-u", "-t", target, GUIOptionLock)
}

// GUILocked reads the host resolution pin; an unset option or an absent
// session reads as false. Callers probing from OUTSIDE the daemon process
// must gate on the daemon running first (the GUISessionExists rule).
func GUILocked(ctx context.Context) bool {
	if !guiSessionExists(ctx) {
		return false
	}
	v, err := guiSessionOption(ctx, GUIOptionLock)
	return err == nil && v == "1"
}

// guiSessionCreated reads the rk-gui session's session_created format. A
// package seam (mirroring guiSessionOption) so tests drive the uptime
// derivation without a live tmux server.
var guiSessionCreated = func(ctx context.Context) (string, error) {
	out, err := runTmuxOutput(ctx, "display-message", "-p", "-t", "="+GUISessionName, "#{session_created}")
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(out)), nil
}

// GUISessionCreated returns the rk-gui session's creation time (for uptime
// derivation — tmux owns the fact, Constitution II). ok=false for an absent
// session or an unparsable stamp.
func GUISessionCreated(ctx context.Context) (time.Time, bool) {
	if !guiSessionExists(ctx) {
		return time.Time{}, false
	}
	raw, err := guiSessionCreated(ctx)
	if err != nil {
		return time.Time{}, false
	}
	sec, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		return time.Time{}, false
	}
	return time.Unix(sec, 0), true
}

// guiPanePID reads the rk-gui pane's pane_pid (the root of the supervisor's
// process tree). A package seam over runTmuxOutput (the guiSessionOption
// idiom) so tests script the pid without a live tmux server.
var guiPanePID = func(ctx context.Context) (string, error) {
	out, err := runTmuxOutput(ctx, "list-panes", "-t", "="+GUISessionName, "-F", "#{pane_pid}")
	if err != nil {
		return "", err
	}
	// One pane in practice; a multi-pane listing keeps the first.
	line, _, _ := strings.Cut(strings.TrimSpace(string(out)), "\n")
	return line, nil
}

// GUIPanePids returns the pid set of the rk-gui pane's process tree — the
// pane root (rk gui supervise) plus every descendant (the VNC backend, the
// WM) — for RunningApps' exclude set: the WM carries DISPLAY in its environ,
// so an unexcluded scan counts the supervisor's own tree as user apps. Nil
// for an absent session, an unreadable pane pid, or an unparsable one;
// callers exclude nothing then. Callers probing from OUTSIDE the daemon
// process must gate on the daemon running first (the GUISessionExists rule).
func GUIPanePids(ctx context.Context) map[int]bool {
	if !guiSessionExists(ctx) {
		return nil
	}
	raw, err := guiPanePID(ctx)
	if err != nil {
		return nil
	}
	root, err := strconv.Atoi(raw)
	if err != nil {
		return nil
	}
	return gui.ProcessTreePids("/proc", root)
}
