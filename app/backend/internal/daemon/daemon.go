package daemon

import (
	"bytes"
	"context"
	"fmt"
	"log/slog"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"time"

	"rk/internal/config"
)

const (
	// ServerSocket is the tmux server socket for the daemon (separate from agent sessions).
	ServerSocket = "rk-daemon"
	// SessionName is the tmux session name for the daemon. Matches the socket
	// name so the combined exact-match target (=rk-daemon) is unambiguous and
	// cannot collide with user-facing sessions via tmux prefix matching.
	SessionName = "rk-daemon"
	// LegacySessionName is the pre-rename session name. Stop/Restart consult
	// this so a daemon started by an older binary can be shut down cleanly
	// during the first upgrade.
	LegacySessionName = "rk"
	// WindowName is the tmux window name where `rk serve` runs.
	WindowName = "serve"

	// cmdTimeout is the default timeout for tmux commands.
	cmdTimeout = 5 * time.Second
	// stopPollInterval is how often we check if the process stopped.
	stopPollInterval = 200 * time.Millisecond

	// LogEnvVar is the env var the daemonized inner serve reads to learn that
	// it should tee slog output to a file in addition to stderr. Set by
	// startSession on the inner `rk serve` invocation, read by cmd/rk/serve.go.
	// Exported as the single source of truth so cmd/rk does not duplicate the
	// literal.
	LogEnvVar = "RK_DAEMON_LOG"
	// daemonLogDirName is the subdirectory under os.UserCacheDir() that holds
	// the daemon log file.
	daemonLogDirName = "rk"
	// daemonLogFilename is the basename of the daemon log file.
	daemonLogFilename = "daemon.log"
	// portProbeTimeout bounds the net.DialTimeout liveness probe added before
	// daemon startup. Long enough to absorb scheduler jitter on a loaded host,
	// short enough to keep `rk serve -d` snappy.
	portProbeTimeout = 400 * time.Millisecond
	// localhostAddr is the loopback substitution target for wildcard/empty hosts.
	localhostAddr = "127.0.0.1"
)

// target returns the tmux target string for the daemon's window, with both
// session and window segments anchored (`=`) so tmux performs exact-match
// instead of prefix-match lookup.
func target() string {
	return targetFor(SessionName)
}

// targetFor returns an exact-match window target for the given session name.
func targetFor(session string) string {
	return "=" + session + ":=" + WindowName
}

// serverSocket is the variable form of ServerSocket — overridable in tests so
// integration tests can exercise IsRunning/Stop against an isolated socket
// without touching a production daemon.
var serverSocket = ServerSocket

// runTmux executes a tmux command on the daemon server, capturing stderr for diagnostics.
func runTmux(ctx context.Context, args ...string) error {
	fullArgs := append([]string{"-L", serverSocket}, args...)
	cmd := exec.CommandContext(ctx, "tmux", fullArgs...)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		if stderr.Len() > 0 {
			return fmt.Errorf("%w: %s", err, bytes.TrimSpace(stderr.Bytes()))
		}
		return err
	}
	return nil
}

// sessionExistsCtx returns true if a session with the exact given name exists
// on the daemon socket. The `=` prefix forces exact-match lookup so a prefix
// like "rk" cannot accidentally match "rk-relay-*" or "rk-daemon".
func sessionExistsCtx(ctx context.Context, name string) bool {
	return runTmux(ctx, "has-session", "-t", "="+name) == nil
}

// runningSessionCtx returns the name of the live daemon session — preferring
// the current SessionName, falling back to LegacySessionName for daemons
// started by older binaries. Returns "" if neither exists.
func runningSessionCtx(ctx context.Context) string {
	if sessionExistsCtx(ctx, SessionName) {
		return SessionName
	}
	if sessionExistsCtx(ctx, LegacySessionName) {
		return LegacySessionName
	}
	return ""
}

// isRunningCtx reports whether any (current-or-legacy) daemon session exists.
func isRunningCtx(ctx context.Context) bool {
	return runningSessionCtx(ctx) != ""
}

// IsRunning returns true if the daemon tmux session exists (under the current
// or legacy name).
func IsRunning() bool {
	ctx, cancel := context.WithTimeout(context.Background(), cmdTimeout)
	defer cancel()

	return isRunningCtx(ctx)
}

// probeHost applies loopback substitution to a configured bind host. A serve
// bound to a wildcard (`0.0.0.0`, empty string, or IPv6 `::`) is reachable on
// loopback, so we dial 127.0.0.1 — dialing `0.0.0.0` itself is platform-
// inconsistent and not a reliable liveness signal. Any literal host is
// returned unchanged.
func probeHost(host string) string {
	switch host {
	case "", "0.0.0.0", "::", "[::]", "[::1]":
		return localhostAddr
	}
	return host
}

// portInUse reports whether host:port is currently accepting TCP connections.
// Uses net.DialTimeout with portProbeTimeout — a successful dial means
// something is listening; any error (refused, timeout, DNS failure) is treated
// as "port free" so the daemon proceeds to startSession. The dial target is
// resolved through probeHost so wildcard binds are detected on loopback.
func portInUse(host string, port int) bool {
	addr := net.JoinHostPort(probeHost(host), strconv.Itoa(port))
	conn, err := net.DialTimeout("tcp", addr, portProbeTimeout)
	if err != nil {
		return false
	}
	_ = conn.Close()
	return true
}

// guardPortAvailable refuses daemon startup when the configured RK_HOST:RK_PORT
// already has a listener that is not the daemon itself. Runs AFTER IsRunning()
// in Start/StartWithBinary so the "daemon already running" path takes priority.
// The error message intentionally contains the substrings `already serving on`,
// `not under the rk-daemon`, and `RK_PORT` so scripts can pattern-match the
// refusal mode.
func guardPortAvailable() error {
	cfg := config.Load()
	if !portInUse(cfg.Host, cfg.Port) {
		return nil
	}
	return fmt.Errorf(
		"something is already serving on %s:%d, but not under the rk-daemon tmux session "+
			"(likely a foreground `rk serve`, or another process holding the port). "+
			"Stop it first, or set a different RK_PORT.",
		probeHost(cfg.Host), cfg.Port,
	)
}

// reapStaleDaemonSocket attempts a `tmux -L rk-daemon kill-server` to clean up
// an orphaned socket left behind by a previously-crashed inner serve. Goes
// through runTmux so it inherits the existing exec.CommandContext + timeout
// enforcement and stays scoped to serverSocket (never touches the agent-session
// `runkit` server). Idempotent — `kill-server` against a dead/nonexistent
// server errors with "no server running on …", which we suppress to slog.Debug
// because it is the common happy-path case on cold start. Real failures are
// also logged at Debug and never block startup; if anything is genuinely
// broken, the subsequent startSession call will surface it.
func reapStaleDaemonSocket(ctx context.Context) {
	if err := runTmux(ctx, "kill-server"); err != nil {
		slog.Debug("daemon socket reap finished with error", "err", err)
	}
}

// Start creates a new daemon tmux session running `rk serve`.
// The command is passed directly to new-session so the session exits when the server exits.
// Uses os.Executable to resolve the current binary, so a locally-built binary restarts itself
// rather than whichever `rk` happens to be in $PATH.
// Returns an error if a daemon is already running, or if the configured port is
// already held by another process (e.g. a foreground `rk serve`).
func Start() error {
	if IsRunning() {
		return fmt.Errorf("daemon already running")
	}
	if err := guardPortAvailable(); err != nil {
		return err
	}

	reapCtx, reapCancel := context.WithTimeout(context.Background(), cmdTimeout)
	reapStaleDaemonSocket(reapCtx)
	reapCancel()

	exe, err := os.Executable()
	if err != nil {
		return fmt.Errorf("resolving executable path: %w", err)
	}
	exe, err = filepath.EvalSymlinks(exe)
	if err != nil {
		return fmt.Errorf("resolving executable symlinks: %w", err)
	}

	return startSession(exe)
}

// StartWithBinary creates a new daemon tmux session using the provided binary path.
// The binPath is resolved via filepath.EvalSymlinks before use, so callers can pass
// a symlink (e.g. the Homebrew bin symlink) that points to the current version.
// Use this instead of Start when the running process's os.Executable path may be stale
// (e.g. after brew upgrade deletes the old Cellar directory).
// Inherits the same port-availability + stale-socket-reap guards as Start.
func StartWithBinary(binPath string) error {
	if IsRunning() {
		return fmt.Errorf("daemon already running")
	}
	if err := guardPortAvailable(); err != nil {
		return err
	}

	reapCtx, reapCancel := context.WithTimeout(context.Background(), cmdTimeout)
	reapStaleDaemonSocket(reapCtx)
	reapCancel()

	exe, err := filepath.EvalSymlinks(binPath)
	if err != nil {
		return fmt.Errorf("resolving executable symlinks: %w", err)
	}

	return startSession(exe)
}

// startSession creates the daemon tmux session with the given resolved binary path.
// When os.UserCacheDir() resolves successfully, the inner serve is spawned with
// RK_DAEMON_LOG=<cache>/rk/daemon.log in its environment so it can tee slog
// output to a durable log file (read by cmd/rk/serve.go). On UserCacheDir
// failure we proceed without the env var — file logging is best-effort and
// MUST NOT block daemon creation.
func startSession(exe string) error {
	ctx, cancel := context.WithTimeout(context.Background(), cmdTimeout)
	defer cancel()

	args := []string{"new-session"}
	if logPath, ok := resolveDaemonLogPath(); ok {
		args = append(args, "-e", LogEnvVar+"="+logPath)
	}
	args = append(args, "-d", "-s", SessionName, "-n", WindowName, exe, "serve")

	// Create a detached tmux session that runs the resolved binary directly.
	// When the serve process exits, the session closes automatically.
	if err := runTmux(ctx, args...); err != nil {
		return fmt.Errorf("creating tmux session: %w", err)
	}

	return nil
}

// resolveDaemonLogPath returns the absolute path to the daemon log file and
// true on success. On any error (UserCacheDir unsupported on the host),
// emits a single slog.Warn and returns "", false so the caller can spawn the
// inner serve without RK_DAEMON_LOG — file logging is diagnostic, not
// load-bearing.
func resolveDaemonLogPath() (string, bool) {
	cache, err := os.UserCacheDir()
	if err != nil {
		slog.Warn("daemon log path unavailable", "err", err)
		return "", false
	}
	return filepath.Join(cache, daemonLogDirName, daemonLogFilename), true
}

// Stop sends C-c to the daemon pane and waits up to 5 seconds for it to exit.
// A single context bounds the entire operation (send-keys + polling + kill).
// Returns nil if the daemon is not running. Targets a legacy-named daemon
// (SessionName == LegacySessionName) transparently so users upgrading from
// older binaries can stop/restart without manual cleanup.
func Stop() error {
	ctx, cancel := context.WithTimeout(context.Background(), cmdTimeout)
	defer cancel()

	session := runningSessionCtx(ctx)
	if session == "" {
		return nil
	}

	// Send C-c to trigger graceful shutdown.
	if err := runTmux(ctx, "send-keys", "-t", targetFor(session), "C-c"); err != nil {
		return fmt.Errorf("sending C-c to daemon: %w", err)
	}

	// Poll until the session disappears or context expires.
	for {
		select {
		case <-ctx.Done():
			// Timeout — kill forcefully with a fresh short context.
			killCtx, killCancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer killCancel()
			if err := runTmux(killCtx, "kill-session", "-t", "="+session); err != nil {
				return fmt.Errorf("killing daemon session after timeout: %w", err)
			}
			return nil
		case <-time.After(stopPollInterval):
			if !sessionExistsCtx(ctx, session) {
				return nil
			}
		}
	}
}

// Restart stops the daemon if running, then starts it.
// If no daemon is running, it just starts one.
func Restart() error {
	if IsRunning() {
		if err := Stop(); err != nil {
			return fmt.Errorf("stopping daemon: %w", err)
		}
	}
	return Start()
}

// RestartWithBinary stops the daemon if running, then starts it using the provided binary path.
// Use this instead of Restart when the running process's os.Executable path may be stale.
func RestartWithBinary(binPath string) error {
	if IsRunning() {
		if err := Stop(); err != nil {
			return fmt.Errorf("stopping daemon: %w", err)
		}
	}
	return StartWithBinary(binPath)
}
