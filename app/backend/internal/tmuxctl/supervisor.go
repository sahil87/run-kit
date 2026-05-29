package tmuxctl

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/fsnotify/fsnotify"

	"rk/internal/tmux"
)

// isTmuxSocketCandidate returns false for entries that are known to live in
// $TMUX_TMPDIR but are not server sockets. tmux writes a `<socket>.lock`
// advisory-lock file next to each server socket during startup; opening a
// control-mode client against the `.lock` name would cause tmux to create a
// fresh server with that name (which in turn births `<socket>.lock.lock`),
// triggering unbounded recursion under fsnotify.
//
// Go-test scaffolding sockets (rk-test-*, rk-relay-test-*, …) are also
// skipped: tmuxctl's resolveBootstrap calls `tmux new-session -d -s _rk-ctl`
// when no session exists, which would RESURRECT every orphan test socket on
// each rk startup and keep the tmux server alive via the control-mode attach.
// Playwright e2e servers (rk-e2e-*) are NOT skipped — those need live
// control-mode for the tests to observe window-change events.
func isTmuxSocketCandidate(name string) bool {
	if name == "" || name == "." || name == ".." {
		return false
	}
	if strings.HasSuffix(name, ".lock") {
		return false
	}
	if tmux.IsGoTestServerName(name) {
		return false
	}
	return true
}

// openFn is the function used by Supervisor to instantiate a Client for a
// newly-observed socket. Production: Open. Tests inject a stub.
type openFn func(ctx context.Context, socket string, sink EventSink) (*Client, error)

// Supervisor owns a per-tmux-socket map of Clients, automatically opening a
// Client when a new socket appears in the watch directory and closing one
// when its socket is removed.
//
// The watch directory resolves to $TMUX_TMPDIR when set, else
// `/tmp/tmux-<euid>/`. If the directory does not exist, it is created with
// mode 0o700 (matching tmux's own convention) and fsnotify watches the now-
// existing directory for subsequent socket creates.
type Supervisor struct {
	sink     EventSink
	watchDir string

	mu      sync.Mutex
	clients map[string]*Client

	watcher *fsnotify.Watcher
	ctx     context.Context
	cancel  context.CancelFunc
	done    chan struct{}

	// open is the constructor used for each Client. Tests override this
	// via newTestSupervisor.
	open openFn

	// watchDirOverride, when non-empty, replaces the resolved watch dir.
	// Tests use this to point Start at a temp directory.
	watchDirOverride string
}

// NewSupervisor constructs a Supervisor that will route Client events into the
// supplied sink. The watch directory is resolved at Start time, not here.
func NewSupervisor(sink EventSink) *Supervisor {
	if sink == nil {
		sink = NoOpSink{}
	}
	return &Supervisor{
		sink:    sink,
		clients: map[string]*Client{},
		done:    make(chan struct{}),
		open:    Open,
	}
}

// Start enumerates the watch directory, opens a Client for each existing
// socket, and begins the fsnotify-driven runtime loop. The initial enumeration
// is synchronous so callers (e.g., `rk serve`) observe a fully-populated map
// before HTTP serving begins; the runtime loop runs in a goroutine.
//
// Per-socket Open failures (e.g., PTY unavailable) are logged via slog.Warn
// but do not abort Start.
func (s *Supervisor) Start(ctx context.Context) error {
	if s.watchDirOverride != "" {
		s.watchDir = s.watchDirOverride
	} else {
		s.watchDir = resolveWatchDir()
	}

	if err := ensureWatchDir(s.watchDir); err != nil {
		return fmt.Errorf("ensure watch dir: %w", err)
	}

	w, err := fsnotify.NewWatcher()
	if err != nil {
		return fmt.Errorf("fsnotify.NewWatcher: %w", err)
	}
	s.watcher = w

	if err := w.Add(s.watchDir); err != nil {
		_ = w.Close()
		return fmt.Errorf("watcher.Add(%s): %w", s.watchDir, err)
	}

	// Snapshot existing sockets synchronously.
	entries, err := os.ReadDir(s.watchDir)
	if err != nil {
		slog.Warn("tmuxctl: read watch dir at start", "path", s.watchDir, "err", err)
	} else {
		for _, e := range entries {
			if e.IsDir() {
				continue
			}
			if !isTmuxSocketCandidate(e.Name()) {
				continue
			}
			s.openSocket(ctx, e.Name())
		}
	}

	s.ctx, s.cancel = context.WithCancel(ctx)
	go s.run()
	return nil
}

// Stop closes every Client and tears down the watcher. Idempotent. The
// supplied ctx provides a teardown deadline; if it expires before all Clients
// finish closing, Stop returns its error but still completes the close-all
// best-effort.
func (s *Supervisor) Stop(ctx context.Context) error {
	if s.cancel != nil {
		s.cancel()
	}
	if s.watcher != nil {
		_ = s.watcher.Close()
	}

	// Close all Clients in parallel.
	s.mu.Lock()
	clients := make([]*Client, 0, len(s.clients))
	for _, c := range s.clients {
		clients = append(clients, c)
	}
	s.clients = map[string]*Client{}
	s.mu.Unlock()

	var wg sync.WaitGroup
	for _, c := range clients {
		wg.Add(1)
		go func(cl *Client) {
			defer wg.Done()
			_ = cl.Close()
		}(c)
	}

	doneCh := make(chan struct{})
	go func() {
		wg.Wait()
		close(doneCh)
	}()

	select {
	case <-doneCh:
		<-s.done
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

// run is the fsnotify event loop. Exits when the watcher is closed.
func (s *Supervisor) run() {
	defer close(s.done)
	for {
		select {
		case <-s.ctx.Done():
			return
		case ev, ok := <-s.watcher.Events:
			if !ok {
				return
			}
			name := filepath.Base(ev.Name)
			if !isTmuxSocketCandidate(name) {
				continue
			}
			if ev.Op&fsnotify.Create != 0 {
				s.openSocket(s.ctx, name)
			}
			if ev.Op&fsnotify.Remove != 0 {
				s.closeSocket(name)
			}
		case err, ok := <-s.watcher.Errors:
			if !ok {
				return
			}
			slog.Warn("tmuxctl: watcher error", "err", err)
		}
	}
}

// openSocket opens (or replaces) the Client for a socket. Safe to call from
// multiple goroutines; the mutex serialises map mutations.
func (s *Supervisor) openSocket(ctx context.Context, name string) {
	s.mu.Lock()
	// Defensive: close any prior Client of the same name (close-then-reopen
	// during the same Supervisor lifetime).
	prev := s.clients[name]
	s.mu.Unlock()
	if prev != nil {
		_ = prev.Close()
	}

	c, err := s.open(ctx, name, s.sink)
	if err != nil {
		slog.Warn("tmuxctl: PTY unavailable, control-mode disabled", "socket", name, "err", err)
		return
	}

	s.mu.Lock()
	s.clients[name] = c
	s.mu.Unlock()
	// Socket lifecycle is logged at INFO so the daemon log reconstructs the
	// timeline of when a tmux server's socket appeared/disappeared — essential
	// context when correlating an unexpected server teardown with the
	// `audit=kill` lines emitted by internal/tmux.
	slog.Info("tmuxctl: socket opened", "socket", name)
}

// closeSocket closes the Client for a socket (if any) and removes it from the
// map.
func (s *Supervisor) closeSocket(name string) {
	s.mu.Lock()
	c, ok := s.clients[name]
	if ok {
		delete(s.clients, name)
	}
	s.mu.Unlock()
	if ok {
		// A socket removal means the tmux server exited (socket files are
		// removed by tmux on server shutdown). Logged at WARN so a server
		// vanishing is visible at the default level and timestamps line up
		// with the `audit=kill` teardown lines that caused it.
		slog.Warn("tmuxctl: socket removed (tmux server exited)", "socket", name)
		_ = c.Close()
	}
}

// Get returns the Client for the named socket if one exists. Used by the SSE
// hub to obtain the per-server generation counter.
func (s *Supervisor) Get(socket string) *Client {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.clients[socket]
}

// resolveWatchDir returns $TMUX_TMPDIR if set, else `/tmp/tmux-<euid>/`.
func resolveWatchDir() string {
	if v := os.Getenv("TMUX_TMPDIR"); v != "" {
		return v
	}
	return fmt.Sprintf("/tmp/tmux-%d", os.Geteuid())
}

func ensureWatchDir(path string) error {
	info, err := os.Stat(path)
	if err == nil {
		if !info.IsDir() {
			return fmt.Errorf("%s exists but is not a directory", path)
		}
		return nil
	}
	if !os.IsNotExist(err) {
		return err
	}
	slog.Warn("tmuxctl: socket directory missing", "path", path)
	return os.MkdirAll(path, 0o700)
}
