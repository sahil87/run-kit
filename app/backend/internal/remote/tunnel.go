package remote

import (
	"context"
	"fmt"
	"net"
	"strconv"
	"strings"
	"time"

	"rk/internal/daemon"
	"rk/internal/tmux"
)

// tmuxCmdTimeout bounds one-shot tmux commands on the daemon socket —
// mirrors internal/daemon's cmdTimeout discipline.
const tmuxCmdTimeout = 5 * time.Second

// Tunnel-readiness polling: after the window is up, connect waits for the
// local forward to accept TCP (ssh listens once authenticated). Vars, not
// consts, so tests shrink them to drive the timeout branch without burning
// wall-clock (the internal/daemon stopGracePeriod idiom).
var (
	tunnelReadyTimeout = 15 * time.Second
	tunnelPollInterval = 300 * time.Millisecond
)

// tunnelDialTimeout bounds one readiness/squatter TCP dial.
const tunnelDialTimeout = 500 * time.Millisecond

// dialFn is the TCP-readiness seam (net.DialTimeout in production) —
// substitutable in tests so squatter/readiness branches run without sockets.
var dialFn = dialImpl

func dialImpl(addr string, timeout time.Duration) bool {
	conn, err := net.DialTimeout("tcp", addr, timeout)
	if err != nil {
		return false
	}
	_ = conn.Close()
	return true
}

// tmuxRunFn / tmuxOutputFn are the tmux seams — thin `-L rk-daemon`
// argv-prefix wrappers over the shared runner core (the internal/daemon
// runTmux idiom), substitutable in tests.
var (
	tmuxRunFn    = tmuxRunImpl
	tmuxOutputFn = tmuxOutputImpl
)

func tmuxRunImpl(ctx context.Context, dir string, args ...string) error {
	fullArgs := append([]string{"-L", daemon.ServerSocket}, args...)
	return tmux.Run(ctx, fullArgs, tmux.RunOpts{Dir: dir})
}

func tmuxOutputImpl(ctx context.Context, args ...string) ([]byte, error) {
	fullArgs := append([]string{"-L", daemon.ServerSocket}, args...)
	return tmux.RunOutput(ctx, fullArgs, tmux.RunOpts{})
}

// tunnelArgs is the byte-exact tunnel command from the design: the system ssh
// binary (never a bundled library), non-interactive, keepalived, forwarding
// the loopback-bound local port to the remote's loopback-bound daemon port.
// StrictHostKeyChecking is deliberately untouched. Returned as argv elements —
// tmux (≥3.4) executes a multi-argument shell-command directly, without a
// shell, so nothing here is ever string-interpolated.
func tunnelArgs(target string, localPort, remotePort int) []string {
	return []string{
		"ssh",
		"-N",
		"-o", "BatchMode=yes",
		"-o", "ServerAliveInterval=15",
		"-L", fmt.Sprintf("127.0.0.1:%d:127.0.0.1:%d", localPort, remotePort),
		target,
	}
}

// windowTarget returns the exact-match tmux target for a remote's tunnel
// window (`=` anchors both segments — the internal/daemon convention).
func windowTarget(name string) string {
	return "=" + SessionName + ":=" + name
}

// remotesSessionExists reports whether the rk-remotes session exists on the
// daemon socket.
func remotesSessionExists(ctx context.Context) bool {
	return tmuxRunFn(ctx, "", "has-session", "-t", "="+SessionName) == nil
}

// ListTunnels derives the tunnel state for every remote at request time:
// window name → pane command, from a single list-windows call. A missing
// session — or no tmux server at all on the rk-daemon socket — is the empty
// map (all tunnels down), never an error: absence of infrastructure is a
// derivable state, not a failure (Constitution II).
func ListTunnels(ctx context.Context) map[string]bool {
	probeCtx, cancel := context.WithTimeout(ctx, tmuxCmdTimeout)
	defer cancel()

	out, err := tmuxOutputFn(probeCtx, "list-windows", "-t", "="+SessionName,
		"-F", "#{window_name}\t#{pane_current_command}")
	if err != nil {
		return map[string]bool{}
	}
	tunnels := make(map[string]bool)
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		if line == "" {
			continue
		}
		name, cmd, _ := strings.Cut(line, "\t")
		// The window runs ssh directly (the window dies with the process), so
		// window presence with an ssh pane command is "tunnel up".
		tunnels[name] = strings.HasPrefix(cmd, "ssh")
	}
	return tunnels
}

// TunnelUp reports whether the named remote's tunnel window is up.
func TunnelUp(ctx context.Context, name string) bool {
	return ListTunnels(ctx)[name]
}

// openTunnel ensures the remote's tunnel window exists, creating the
// rk-remotes session when absent. Session creation may birth the rk-daemon
// tmux server (a browser-only user with no local daemon still tunnels), so
// the new-session runs with its CWD pinned to tmux.ServerBirthDir() — a born
// server keeps its first client's CWD for life, and rk's own CWD may be a
// later-deleted worktree (the server-birth seam rule).
func openTunnel(ctx context.Context, name, target string, localPort, remotePort int) error {
	cmdCtx, cancel := context.WithTimeout(ctx, tmuxCmdTimeout)
	defer cancel()

	sshArgv := tunnelArgs(target, localPort, remotePort)
	if !remotesSessionExists(cmdCtx) {
		args := append([]string{"new-session", "-d", "-s", SessionName, "-n", name}, sshArgv...)
		if err := tmuxRunFn(cmdCtx, tmux.ServerBirthDir(), args...); err != nil {
			return fmt.Errorf("creating %s tunnel session: %w", SessionName, err)
		}
		return nil
	}
	args := append([]string{"new-window", "-d", "-t", "=" + SessionName, "-n", name}, sshArgv...)
	if err := tmuxRunFn(cmdCtx, "", args...); err != nil {
		return fmt.Errorf("creating tunnel window %s: %w", name, err)
	}
	return nil
}

// closeTunnel kills the remote's tunnel window only — the remote daemon and
// every other tunnel are untouched (Constitution VI). An already-absent
// window (or session, or server) is success: disconnect is idempotent.
func closeTunnel(ctx context.Context, name string) error {
	if !TunnelUp(ctx, name) {
		return nil
	}
	cmdCtx, cancel := context.WithTimeout(ctx, tmuxCmdTimeout)
	defer cancel()
	if err := tmuxRunFn(cmdCtx, "", "kill-window", "-t", windowTarget(name)); err != nil {
		// Re-derive: a window that vanished on its own (ssh exited between the
		// probe and the kill) is the desired end state.
		if !TunnelUp(ctx, name) {
			return nil
		}
		return fmt.Errorf("killing tunnel window %s: %w", name, err)
	}
	return nil
}

// waitTunnelReady polls the local forward until it accepts TCP, the window
// dies, or the readiness budget elapses. dial is a seam (net.DialTimeout in
// production) so tests drive the branches without sockets.
func waitTunnelReady(ctx context.Context, name string, localPort int) error {
	deadline := time.Now().Add(tunnelReadyTimeout)
	addr := "127.0.0.1:" + strconv.Itoa(localPort)
	for {
		if dialFn(addr, tunnelDialTimeout) {
			return nil
		}
		if !TunnelUp(ctx, name) {
			return fmt.Errorf("tunnel window %s exited before the forward came up — likely an ssh auth or host-key issue; run `rk remote connect %s` again after checking `ssh` access", name, name)
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("tunnel on 127.0.0.1:%d did not accept connections within %s", localPort, tunnelReadyTimeout)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(tunnelPollInterval):
		}
	}
}
