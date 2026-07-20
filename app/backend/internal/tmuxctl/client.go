package tmuxctl

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os/exec"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/creack/pty"

	"rk/internal/tmux"
)

// AnchorKeepaliveOption is the server-scoped tmux user-option set on the
// anchor session as a defensive marker. v1 has no runtime consumer; the
// marker exists so future code can identify the anchor without depending on
// the literal session name.
const AnchorKeepaliveOption = "@rk_ctl_keepalive"

// Backoff bounds for the reconnect FSM. The sequence is 250ms → 500ms → 1s →
// 2s → 5s → 5s … with reset on the first non-%begin event observed after a
// successful reconnect.
const (
	initialBackoff = 250 * time.Millisecond
	maxBackoff     = 5 * time.Second
)

// serverProbeTimeout bounds the side-effect-free `list-sessions` liveness probe
// in probeAndFirstSession. Mirrors the 2s used by internal/tmux.probeServerAlive
// (tmux.go:1359) — long enough for a momentarily busy server, short enough that
// a hung tmux cannot block a dial/reconnect (Constitution: Process Execution).
const serverProbeTimeout = 2 * time.Second

// dialFn opens a fresh control-mode subprocess + PTY for the given socket.
// Returns (cmd, pty, error). Both cmd and pty must be released by the caller
// (cmd.Wait + pty.Close) when the connection ends.
//
// Tests inject a stub dialFn to drive the reconnect FSM without touching tmux.
type dialFn func(ctx context.Context, socket string) (*exec.Cmd, io.ReadWriteCloser, error)

// sleepFn returns a channel that delivers when the duration elapses (or never
// in tests). Replaced in tests with a fake clock.
type sleepFn func(ctx context.Context, d time.Duration) <-chan struct{}

// realSleep is the production sleepFn. The returned channel fires once after
// d, OR closes early if ctx is cancelled.
func realSleep(ctx context.Context, d time.Duration) <-chan struct{} {
	ch := make(chan struct{})
	go func() {
		t := time.NewTimer(d)
		defer t.Stop()
		select {
		case <-t.C:
		case <-ctx.Done():
		}
		close(ch)
	}()
	return ch
}

// Client manages a single long-lived `tmux -CC` control-mode subscription for
// one tmux server (identified by socket name). Notifications are pushed into
// the configured EventSink from a single goroutine.
type Client struct {
	socket string
	sink   EventSink

	ctx    context.Context
	cancel context.CancelFunc

	// Generation is incremented on every notification dispatched from the
	// read loop. Readers (the SSE hub) Compare a prior value against the
	// current to detect change; Wait(after) returns a channel that closes
	// when generation > after.
	generation atomic.Int64

	mu      sync.Mutex
	waiters []waiter

	dial  dialFn
	sleep sleepFn

	closeOnce sync.Once
	done      chan struct{}
}

type waiter struct {
	after int64
	ch    chan struct{}
}

// Open begins a tmux control-mode subscription on the given socket name. The
// returned Client owns its read goroutine and reconnect FSM. The call is
// non-blocking — disconnects after the initial open are handled by reconnect
// and are not surfaced as errors from Open.
//
// The initial dial is synchronous so the caller (the Supervisor) sees the
// PTY-unavailable case via a returned error.
func Open(ctx context.Context, socket string, sink EventSink) (*Client, error) {
	return openWith(ctx, socket, sink, productionDial, realSleep)
}

// openWith is the test-injectable variant of Open. Production callers use
// Open.
func openWith(ctx context.Context, socket string, sink EventSink, dial dialFn, sleep sleepFn) (*Client, error) {
	if sink == nil {
		sink = NoOpSink{}
	}
	cctx, cancel := context.WithCancel(ctx)
	c := &Client{
		socket: socket,
		sink:   sink,
		ctx:    cctx,
		cancel: cancel,
		dial:   dial,
		sleep:  sleep,
		done:   make(chan struct{}),
	}

	// Initial dial — synchronous so PTY-unavailable errors propagate to
	// the caller. Subsequent reconnects after disconnect happen in the
	// read loop.
	cmd, ptmx, err := dial(cctx, socket)
	if err != nil {
		cancel()
		return nil, fmt.Errorf("tmuxctl: initial dial: %w", err)
	}
	go c.readLoop(cmd, ptmx)
	return c, nil
}

// Close terminates the subscription. Idempotent — safe to call multiple times.
// Blocks until the read goroutine returns (or returns immediately on second
// call).
func (c *Client) Close() error {
	c.closeOnce.Do(func() {
		c.cancel()
		<-c.done
	})
	return nil
}

// Generation returns the current generation counter. Each handled notification
// increments it; the safety-net SSE poll uses it to detect "did anything
// change since the last snapshot."
func (c *Client) Generation() int64 {
	return c.generation.Load()
}

// Wait returns a channel that closes when the generation counter advances past
// `after`. If generation > after at call time, the returned channel is
// already-closed. Single-use; callers SHALL re-call Wait after each event
// consumed.
func (c *Client) Wait(after int64) <-chan struct{} {
	if c.generation.Load() > after {
		ch := make(chan struct{})
		close(ch)
		return ch
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	// Re-check after taking the lock — a notification may have raced with
	// the caller and incremented generation since the load above.
	if c.generation.Load() > after {
		ch := make(chan struct{})
		close(ch)
		return ch
	}
	w := waiter{after: after, ch: make(chan struct{})}
	c.waiters = append(c.waiters, w)
	return w.ch
}

// bumpGeneration increments the counter and closes any waiters whose `after`
// is now exceeded. Called from the read loop after each handled notification.
func (c *Client) bumpGeneration() {
	gen := c.generation.Add(1)
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.waiters) == 0 {
		return
	}
	remaining := c.waiters[:0]
	for _, w := range c.waiters {
		if gen > w.after {
			close(w.ch)
			continue
		}
		remaining = append(remaining, w)
	}
	c.waiters = remaining
}

// readLoop owns the lifecycle of one open `tmux -CC` subprocess + PTY, plus
// the reconnect FSM. It exits when c.ctx is cancelled.
func (c *Client) readLoop(initialCmd *exec.Cmd, initialPty io.ReadWriteCloser) {
	defer close(c.done)

	cmd := initialCmd
	ptmx := initialPty
	backoff := initialBackoff

	for {
		if cmd == nil {
			// Reconnect path. Wait `backoff`, then dial.
			select {
			case <-c.ctx.Done():
				return
			case <-c.sleep(c.ctx, backoff):
			}
			if c.ctx.Err() != nil {
				return
			}
			var err error
			cmd, ptmx, err = c.dial(c.ctx, c.socket)
			if err != nil {
				slog.Debug("tmuxctl: reconnect dial failed", "socket", c.socket, "err", err, "backoff", backoff)
				backoff = doubleBackoff(backoff)
				continue
			}
		}

		// Drive the read loop until disconnect.
		// A watcher goroutine closes the PTY when the parent context is
		// cancelled, so a blocked bufio.Scanner.Read returns EOF instead
		// of hanging forever during Close().
		stopWatcher := make(chan struct{})
		go func(p io.Closer) {
			select {
			case <-c.ctx.Done():
				_ = p.Close()
			case <-stopWatcher:
			}
		}(ptmx)

		established := false
		seenNonBegin := false
		scanner := bufio.NewScanner(ptmx)
		// Tmux's `pane_output` lines and notifications can be long; bump
		// the scanner buffer so we don't truncate large status replies.
		scanner.Buffer(make([]byte, 0, 64*1024), 1<<20)

		for scanner.Scan() {
			if c.ctx.Err() != nil {
				break
			}
			line := scanner.Text()
			ev := ParseLine(line)

			switch ev.(type) {
			case BeginEvent:
				if !established {
					established = true
					c.sink.OnConnectionEstablished()
				}
				continue
			case EndEvent, ErrorEvent, IgnoredEvent:
				continue
			}

			// First non-%begin event after a successful (re)connect
			// resets backoff. Treat any typed notification as the
			// "successful read" signal — we've passed beyond the
			// handshake.
			if !seenNonBegin {
				seenNonBegin = true
				backoff = initialBackoff
			}

			c.dispatch(ev)
		}

		// Read loop ended — either ctx cancelled (Close called) or EOF /
		// scanner error. Tear down the subprocess and (if not closing)
		// reconnect.
		close(stopWatcher)
		_ = ptmx.Close()
		if cmd.Process != nil {
			_ = cmd.Process.Kill()
			_ = cmd.Wait()
		}

		if c.ctx.Err() != nil {
			return
		}

		// Disconnect path — emit OnConnectionLost once. The next
		// reconnect waits the current backoff value (initial 250ms on
		// first disconnect, or whatever the last successful reset left
		// it). Only dial *failures* double the backoff (handled at the
		// top of the loop).
		c.sink.OnConnectionLost()
		cmd = nil
		ptmx = nil
	}
}

// dispatch routes a typed event to the sink and bumps generation.
func (c *Client) dispatch(ev Event) {
	switch v := ev.(type) {
	case SessionWindowChangedEvent:
		c.sink.OnSessionWindowChanged(v.SessionID, v.WindowID)
	case WindowAddEvent:
		c.sink.OnWindowAdd(v.WindowID)
	case WindowCloseEvent:
		c.sink.OnWindowClose(v.WindowID)
	case WindowRenamedEvent:
		c.sink.OnWindowRenamed(v.WindowID, v.Name)
	case SessionsChangedEvent:
		c.sink.OnSessionsChanged()
	case UnlinkedWindowEvent:
		// A window changed in a session this client is not attached to. No
		// sink callback — active-window state is session-scoped and tracked
		// from the linked %session-window-changed for the attached session.
		// We only need to bump the generation so the SSE hub rebuilds its
		// snapshot, surfacing the external change without waiting for the 12s
		// safety poll. The bumpGeneration below (shared with all handled
		// events) does exactly that.
	case LayoutChangeEvent:
		c.sink.OnLayoutChange(v.WindowID)
	case UnknownEvent, MalformedEvent:
		// No sink callback for unknowns — already logged by parser.
		return
	default:
		return
	}
	c.bumpGeneration()
}

// doubleBackoff advances the reconnect backoff per the spec sequence:
// 250ms → 500ms → 1s → 2s → 5s → 5s … (note the 2s → 5s step is not pure
// doubling; the cap absorbs anything that would land above 5s).
func doubleBackoff(d time.Duration) time.Duration {
	next := d * 2
	if next >= maxBackoff || next >= 4*time.Second {
		return maxBackoff
	}
	if next < initialBackoff {
		return initialBackoff
	}
	return next
}

// productionDial is the dialFn used by Open in production. It resolves a
// bootstrap session (existing first session OR creates `_rk-ctl` anchor) and
// then runs `tmux -CC -L <socket> attach-session -t =<bootstrap> -r` via
// creack/pty.
func productionDial(ctx context.Context, socket string) (*exec.Cmd, io.ReadWriteCloser, error) {
	// Backstop FIRST, on every dial AND every reconnect (this dialFn is the
	// reconnect FSM's dial too). Setting `exit-empty off` BEFORE the anchor is
	// created closes the reapable zero-session sliver during the
	// close-then-reopen restart window: the old -CC client is gone, and if the
	// server's real sessions also closed in that gap, tmux would reap the whole
	// server before resolveBootstrap installs the `_rk-ctl` floor. Non-fatal —
	// the anchor floor (below) is the primary guarantee; a momentarily
	// unreachable foreign server must not abort the dial.
	// Change: 260602-a1wo-prevent-exit-empty-server-death.
	if err := tmux.SetExitEmptyOff(ctx, socket); err != nil {
		slog.Debug("tmuxctl: set exit-empty off failed (non-fatal)", "socket", socket, "err", err)
	}

	bootstrap, err := resolveBootstrap(ctx, socket)
	if err != nil {
		return nil, nil, fmt.Errorf("resolve bootstrap: %w", err)
	}

	args := []string{}
	if socket != "default" && socket != "" {
		args = append(args, "-L", socket)
	}
	args = append(args, "-CC", "attach-session", "-t", "=" + bootstrap, "-r")

	cmd := exec.CommandContext(ctx, "tmux", args...)
	ptmx, err := pty.Start(cmd)
	if err != nil {
		return nil, nil, fmt.Errorf("pty.Start: %w", err)
	}
	return cmd, ptmx, nil
}

// errServerDead is the sentinel resolveBootstrap returns when the liveness
// probe finds no tmux server listening on the socket. productionDial wraps and
// propagates it so the reconnect FSM backs off harmlessly instead of letting
// createAnchor's `new-session` resurrect a killed server.
// Change: 260602-poka-guard-anchor-no-resurrect.
var errServerDead = errors.New("tmuxctl: tmux server is not running on socket (declining to start it)")

// resolveBootstrap ensures the `_rk-ctl` anchor floor exists on an ALREADY-RUNNING
// server and returns the session to attach control mode to. It NEVER starts a
// server: a genuinely dead socket is declined (errServerDead) so a killed server
// stays dead.
//
// Probe-first ordering (change 260602-poka-guard-anchor-no-resurrect): a single
// side-effect-free `tmux -L <socket> list-sessions` runs FIRST and serves double
// duty — it both distinguishes a dead server (exit 1, "no server running" /
// "failed to connect" / "No such file or directory") from a live one (exit 0,
// including the alive-but-zero-real-session floor case), AND yields the first
// real session for the attach target.
// Folding the probe into the existing listing keeps net tmux round-trips flat at
// 4 (SetExitEmptyOff, this list-sessions probe+first-session, createAnchor,
// setAnchorKeepalive). createAnchor — whose `new-session` would otherwise
// implicitly start a dead server — is reached ONLY after the probe confirms the
// server is already up, so it can never resurrect.
//
// Two concerns remain deliberately decoupled (change
// 260602-a1wo-prevent-exit-empty-server-death):
//
//   - Session FLOOR (ALWAYS, when alive): the `_rk-ctl` anchor is created
//     unconditionally on a live server, regardless of how many real sessions
//     already exist. This is the run-kit-owned session that holds the server's
//     session count above zero so it never collapses to zero and gets reaped by
//     tmux. The prior implementation created the anchor ONLY when the server was
//     empty at first connect, so a server that had real sessions at attach time
//     got NO floor — when its last real session later closed, only relay
//     ephemerals remained, the next relay disconnect drained it to zero, and
//     tmux's default `exit-empty on` reaped the whole server (Constitution VI
//     violation, recurred ≥3x).
//   - Attach TARGET (conditional): we still prefer to attach the control client
//     to the first existing real session when one is present, else the anchor.
//     `%session-window-changed` is global on tmux 3.6a, so attaching to the
//     anchor would NOT regress active-window derivation — preferring the real
//     session is purely a minimal-diff choice with zero event-scope risk.
//
// Anchor creation is idempotent: a concurrent `rk serve` may have created it
// first, which surfaces as a "duplicate session" error that
// isDuplicateSessionError treats as benign (multi-process race; no cross-process
// state per Constitution II).
func resolveBootstrap(ctx context.Context, socket string) (string, error) {
	// Probe FIRST. A dead server is declined before createAnchor runs, so the
	// anchor's `new-session` can never resurrect a killed server. A live server
	// (including the alive-but-zero-real-session floor case) passes the probe and
	// yields the first real session in the same listing.
	alive, first, err := probeAndFirstSession(ctx, socket)
	if err != nil {
		return "", err
	}
	if !alive {
		return "", errServerDead
	}

	// Server is alive — ensure the anchor floor exists. Errors are tolerated only
	// if they look like "session already exists" (concurrent rk created it first).
	if err := createAnchor(ctx, socket); err != nil && !isDuplicateSessionError(err) {
		return "", fmt.Errorf("create anchor: %w", err)
	}

	// Set the keepalive marker (idempotent — safe to re-set).
	if err := setAnchorKeepalive(ctx, socket); err != nil {
		slog.Debug("tmuxctl: set anchor keepalive failed (non-fatal)", "socket", socket, "err", err)
	}

	// Attach target: prefer an existing real session; else the anchor.
	if first != "" {
		return first, nil
	}
	return tmux.ControlAnchorSessionName, nil
}

// probeAndFirstSession runs a single side-effect-free `tmux -L <socket>
// list-sessions` that serves as BOTH the server-liveness probe and the
// first-real-session selector. It mirrors the `internal/tmux.probeServerAlive`
// pattern (tmux.go:1359) locally rather than calling cross-package: tmuxctl is
// the sanctioned self-contained bypass of the internal/tmux/ boundary (see
// doc.go) and the listing already lived here, so folding the dead-vs-empty
// distinction in keeps the package self-contained and the round-trip count flat.
// Change: 260602-poka-guard-anchor-no-resurrect.
//
// Returns:
//   - alive=false when the server is genuinely dead (exit 1 with "no server
//     running" / "failed to connect"); in that case resolveBootstrap declines.
//   - alive=true on exit 0 — INCLUDING empty output (a live server with zero
//     real sessions, the Constitution VI exit-empty floor case): the anchor is
//     still created and `_rk-ctl` is returned as the attach target.
//   - first = the first real (user-facing) session name, or "" when none.
//
// The `_rk-ctl` anchor is skipped when picking `first`: it may already be present
// in the listing and — because `_rk-ctl` sorts ahead of a lowercase real session
// name like `runkit` — would otherwise be picked, regressing the "prefer a real
// session" contract (R2). (The relay ephemerals `rk-relay-*` are NOT skipped:
// they are valid attach targets — they share their real session's window
// membership.) Any non-dead error (timeout, unexpected failure) is returned so
// the caller surfaces it rather than silently treating the server as dead.
func probeAndFirstSession(ctx context.Context, socket string) (alive bool, first string, err error) {
	args := []string{}
	if socket != "default" && socket != "" {
		args = append(args, "-L", socket)
	}
	args = append(args, "list-sessions", "-F", "#{session_name}")
	cctx, cancel := context.WithTimeout(ctx, serverProbeTimeout)
	defer cancel()
	cmd := exec.CommandContext(cctx, "tmux", args...)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, runErr := cmd.Output()
	if runErr != nil {
		// A dead server is a clean, expected outcome — not an error to surface.
		if isServerDeadError(runErr, stderr.String()) {
			return false, "", nil
		}
		// Anything else (timeout, PTY/exec failure) propagates so the caller can
		// decide; we do NOT misclassify it as a dead server.
		if msg := strings.TrimSpace(stderr.String()); msg != "" {
			return false, "", fmt.Errorf("%w: %s", runErr, msg)
		}
		return false, "", runErr
	}
	for _, line := range strings.Split(string(out), "\n") {
		if line == "" || line == tmux.ControlAnchorSessionName {
			continue
		}
		return true, line, nil
	}
	// Exit 0 with no real sessions: alive (anchor-only / zero-session floor).
	return true, "", nil
}

// isServerDeadError reports whether a failed `tmux list-sessions` means the
// server is genuinely dead (vs. some other failure). It matches the same
// "no server running" / "failed to connect" stderr that internal/tmux and
// internal/tmux/board.go (isAbsentOption) already key off, checking both the
// captured stderr and the error string so it works regardless of which carries
// the text. Change: 260602-poka-guard-anchor-no-resurrect.
func isServerDeadError(err error, stderr string) bool {
	if err == nil {
		return false
	}
	if matchesServerDeadText(stderr) || matchesServerDeadText(err.Error()) {
		return true
	}
	var ee *exec.ExitError
	if errors.As(err, &ee) {
		return matchesServerDeadText(string(ee.Stderr))
	}
	return false
}

// matchesServerDeadText reports whether a tmux stderr/error fragment names one
// of the genuinely-dead-server states (server killed, never existed, or
// unreachable). It delegates to tmux.IsServerGone so the dead-server sentinel
// set is defined in exactly one place (Constitution III) — see
// internal/tmux/tmux.go. The caller holds a string here, so it is wrapped in an
// error for the shared helper.
func matchesServerDeadText(s string) bool {
	if s == "" {
		return false
	}
	return tmux.IsServerGone(errors.New(s))
}

func createAnchor(ctx context.Context, socket string) error {
	cctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	cmd, stderr := anchorCommand(cctx, socket)
	if err := cmd.Run(); err != nil {
		if msg := strings.TrimSpace(stderr.String()); msg != "" {
			return fmt.Errorf("%w: %s", err, msg)
		}
		return err
	}
	return nil
}

// anchorCommand builds the `new-session` exec that creates the `_rk-ctl`
// anchor. Although resolveBootstrap's probe-first ordering means createAnchor
// only ever JOINS an already-running server in practice (change 260602-poka),
// `new-session` remains birth-CAPABLE — so the command carries the same
// server-birth hygiene as tmux.CreateSession, closing both asymmetries with
// that path (change 260720-ji0k):
//
//   - cmd.Dir is pinned to tmux.ServerBirthDir() (home, fallback "/") so a
//     server this call ever births never inherits rk's own — possibly
//     later-deleted — CWD (a tmux server keeps its first client's CWD for
//     life; a dead server CWD silently breaks `-c` on tmux 3.7).
//   - cmd.Env is routed through tmux.CleanEnvForServer() so a born server
//     carries the operator's from-home environment (direnv reversed, RK_*/
//     DIRENV_* stripped) instead of rk's polluted one.
//
// The returned stderr buffer is wired as cmd.Stderr and MUST be folded into
// the returned error by the caller: cmd.Run() (unlike cmd.Output()) does NOT
// populate ExitError.Stderr, so without this the "duplicate session: _rk-ctl"
// text tmux prints on the concurrent-rk race would be invisible to
// isDuplicateSessionError, and the always-create path (resolveBootstrap) would
// treat the benign race as a hard failure. Change:
// 260602-a1wo-prevent-exit-empty-server-death.
func anchorCommand(ctx context.Context, socket string) (*exec.Cmd, *bytes.Buffer) {
	args := []string{}
	if socket != "default" && socket != "" {
		args = append(args, "-L", socket)
	}
	args = append(args, "new-session", "-d", "-s", tmux.ControlAnchorSessionName)
	cmd := exec.CommandContext(ctx, "tmux", args...)
	cmd.Dir = tmux.ServerBirthDir()
	cmd.Env = tmux.CleanEnvForServer()
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	return cmd, &stderr
}

func setAnchorKeepalive(ctx context.Context, socket string) error {
	args := []string{}
	if socket != "default" && socket != "" {
		args = append(args, "-L", socket)
	}
	args = append(args, "set-option", "-t", "=" + tmux.ControlAnchorSessionName, AnchorKeepaliveOption, "1")
	cctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	cmd := exec.CommandContext(cctx, "tmux", args...)
	return cmd.Run()
}

// isDuplicateSessionError detects tmux's "duplicate session" error so the
// concurrent-rk-creates-anchor-first race is treated as benign.
//
// It matches the duplicate text from EITHER source, because the two callers
// surface the stderr differently: createAnchor uses cmd.Run() (which does NOT
// populate exec.ExitError.Stderr) but folds the captured stderr into the wrapped
// error's message string, while a raw *exec.ExitError from cmd.Output() carries
// the text in ee.Stderr instead. Checking the wrapped message first (and
// ee.Stderr as a fallback) covers both without depending on which path produced
// the error. Change: 260602-a1wo-prevent-exit-empty-server-death.
func isDuplicateSessionError(err error) bool {
	if err == nil {
		return false
	}
	if matchesDuplicateText(err.Error()) {
		return true
	}
	var ee *exec.ExitError
	if errors.As(err, &ee) {
		return matchesDuplicateText(string(ee.Stderr))
	}
	return false
}

func matchesDuplicateText(s string) bool {
	// tmux 3.x emits "duplicate session: <name>" — match the prefix
	// without locking into exact phrasing.
	if s == "" {
		return false
	}
	return strings.Contains(s, "duplicate session") || strings.Contains(s, "already exists")
}
