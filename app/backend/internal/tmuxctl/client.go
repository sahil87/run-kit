package tmuxctl

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os/exec"
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

// resolveBootstrap returns the name of the session to attach control mode to.
// If at least one session exists, returns the first one. Otherwise creates
// `_rk-ctl` (treating "duplicate session" as benign for the multi-rk case)
// and returns its name.
func resolveBootstrap(ctx context.Context, socket string) (string, error) {
	first, err := firstSessionName(ctx, socket)
	if err == nil && first != "" {
		return first, nil
	}

	// Create the anchor. Errors are tolerated only if they look like
	// "session already exists" (concurrent rk created it first).
	if err := createAnchor(ctx, socket); err != nil && !isDuplicateSessionError(err) {
		return "", fmt.Errorf("create anchor: %w", err)
	}

	// Set the keepalive marker (idempotent — safe to re-set).
	if err := setAnchorKeepalive(ctx, socket); err != nil {
		slog.Debug("tmuxctl: set anchor keepalive failed (non-fatal)", "socket", socket, "err", err)
	}

	return tmux.ControlAnchorSessionName, nil
}

func firstSessionName(ctx context.Context, socket string) (string, error) {
	args := []string{}
	if socket != "default" && socket != "" {
		args = append(args, "-L", socket)
	}
	args = append(args, "list-sessions", "-F", "#{session_name}")
	cctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	out, err := exec.CommandContext(cctx, "tmux", args...).Output()
	if err != nil {
		return "", err
	}
	// First non-empty line.
	for i := 0; i < len(out); i++ {
		if out[i] == '\n' {
			if i == 0 {
				continue
			}
			return string(out[:i]), nil
		}
	}
	if len(out) > 0 {
		return string(out), nil
	}
	return "", nil
}

func createAnchor(ctx context.Context, socket string) error {
	args := []string{}
	if socket != "default" && socket != "" {
		args = append(args, "-L", socket)
	}
	args = append(args, "new-session", "-d", "-s", tmux.ControlAnchorSessionName)
	cctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	cmd := exec.CommandContext(cctx, "tmux", args...)
	return cmd.Run()
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
func isDuplicateSessionError(err error) bool {
	if err == nil {
		return false
	}
	var ee *exec.ExitError
	if !errors.As(err, &ee) {
		// Best-effort string match on the wrapped error (covers test
		// stubs that return non-ExitError).
		return matchesDuplicateText(err.Error())
	}
	return matchesDuplicateText(string(ee.Stderr))
}

func matchesDuplicateText(s string) bool {
	// tmux 3.x emits "duplicate session: <name>" — match the prefix
	// without locking into exact phrasing.
	if s == "" {
		return false
	}
	return contains(s, "duplicate session") || contains(s, "already exists")
}

func contains(haystack, needle string) bool {
	for i := 0; i+len(needle) <= len(haystack); i++ {
		if haystack[i:i+len(needle)] == needle {
			return true
		}
	}
	return false
}
