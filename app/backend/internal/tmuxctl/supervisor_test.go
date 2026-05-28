package tmuxctl

import (
	"context"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// testOpenFn returns a fakeable openFn that records every socket name it
// receives and returns a Client backed by a stub dial that immediately serves
// EOF.
type testOpenRegistry struct {
	mu      sync.Mutex
	opens   []string
	closes  []string
	clients map[string]*Client
}

func newTestOpenRegistry() *testOpenRegistry {
	return &testOpenRegistry{clients: map[string]*Client{}}
}

func (r *testOpenRegistry) openFn() openFn {
	return func(ctx context.Context, socket string, sink EventSink) (*Client, error) {
		// Use a stub dial that delivers an empty stream and immediately
		// EOFs — Client construction succeeds, then the read loop
		// enters reconnect (which sleeps forever via realSleep but never
		// fires because we Close before then).
		dial := func(dctx context.Context, sock string) (*exec.Cmd, io.ReadWriteCloser, error) {
			return &exec.Cmd{}, newPipeReaderEOF(nil), nil
		}
		// Block the sleep forever so the reconnect doesn't hammer in
		// tests.
		blockingSleep := func(sctx context.Context, d time.Duration) <-chan struct{} {
			ch := make(chan struct{})
			go func() {
				<-sctx.Done()
				close(ch)
			}()
			return ch
		}
		c, err := openWith(ctx, socket, sink, dial, blockingSleep)
		if err != nil {
			return nil, err
		}
		r.mu.Lock()
		r.opens = append(r.opens, socket)
		r.clients[socket] = c
		r.mu.Unlock()
		return c, nil
	}
}

func (r *testOpenRegistry) opened() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]string, len(r.opens))
	copy(out, r.opens)
	return out
}

// TestSupervisor_StartEnumerates verifies that pre-existing files in the
// watch directory are opened synchronously during Start.
func TestSupervisor_StartEnumerates(t *testing.T) {
	resetLoggedUnknowns()
	dir := t.TempDir()

	// Pre-create three "sockets" (regular files — fsnotify and our enum
	// don't care about file type).
	for _, name := range []string{"kits", "t2", "t3"} {
		if err := os.WriteFile(filepath.Join(dir, name), nil, 0o600); err != nil {
			t.Fatal(err)
		}
	}

	reg := newTestOpenRegistry()
	s := NewSupervisor(NoOpSink{})
	s.watchDirOverride = dir
	s.open = reg.openFn()

	if err := s.Start(context.Background()); err != nil {
		t.Fatalf("Start: %v", err)
	}
	t.Cleanup(func() {
		stopCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = s.Stop(stopCtx)
	})

	got := reg.opened()
	if len(got) != 3 {
		t.Fatalf("expected 3 opens, got %d: %v", len(got), got)
	}
}

// TestSupervisor_CreateEvent verifies fsnotify-driven Open at runtime.
func TestSupervisor_CreateEvent(t *testing.T) {
	resetLoggedUnknowns()
	dir := t.TempDir()

	reg := newTestOpenRegistry()
	s := NewSupervisor(NoOpSink{})
	s.watchDirOverride = dir
	s.open = reg.openFn()

	if err := s.Start(context.Background()); err != nil {
		t.Fatalf("Start: %v", err)
	}
	t.Cleanup(func() {
		stopCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = s.Stop(stopCtx)
	})

	if got := reg.opened(); len(got) != 0 {
		t.Fatalf("pre-create: expected 0 opens, got %v", got)
	}

	// Create a "socket" file — fsnotify Create event fires Supervisor open.
	if err := os.WriteFile(filepath.Join(dir, "my-new"), nil, 0o600); err != nil {
		t.Fatal(err)
	}

	deadline := time.Now().Add(2 * time.Second)
	for {
		got := reg.opened()
		if len(got) == 1 && got[0] == "my-new" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("did not observe Create-driven Open within 2s, got %v", got)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

// TestSupervisor_RemoveEvent verifies that fsnotify Remove triggers Close + map
// eviction.
func TestSupervisor_RemoveEvent(t *testing.T) {
	resetLoggedUnknowns()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "kits"), nil, 0o600); err != nil {
		t.Fatal(err)
	}

	reg := newTestOpenRegistry()
	s := NewSupervisor(NoOpSink{})
	s.watchDirOverride = dir
	s.open = reg.openFn()

	if err := s.Start(context.Background()); err != nil {
		t.Fatalf("Start: %v", err)
	}
	t.Cleanup(func() {
		stopCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = s.Stop(stopCtx)
	})

	// Confirm initial open.
	deadline := time.Now().Add(2 * time.Second)
	for s.Get("kits") == nil {
		if time.Now().After(deadline) {
			t.Fatal("initial open not registered")
		}
		time.Sleep(5 * time.Millisecond)
	}

	if err := os.Remove(filepath.Join(dir, "kits")); err != nil {
		t.Fatal(err)
	}
	deadline = time.Now().Add(2 * time.Second)
	for s.Get("kits") != nil {
		if time.Now().After(deadline) {
			t.Fatal("did not observe Remove-driven Close within 2s")
		}
		time.Sleep(10 * time.Millisecond)
	}
}

// TestSupervisor_WatchDirMissing verifies that Start creates the watch dir
// when it doesn't exist.
func TestSupervisor_WatchDirMissing(t *testing.T) {
	resetLoggedUnknowns()
	base := t.TempDir()
	// Target a subdir that doesn't exist yet.
	target := filepath.Join(base, "tmux-1001")

	reg := newTestOpenRegistry()
	s := NewSupervisor(NoOpSink{})
	s.watchDirOverride = target
	s.open = reg.openFn()

	if err := s.Start(context.Background()); err != nil {
		t.Fatalf("Start: %v", err)
	}
	t.Cleanup(func() {
		stopCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = s.Stop(stopCtx)
	})

	info, err := os.Stat(target)
	if err != nil {
		t.Fatalf("watch dir not created: %v", err)
	}
	if !info.IsDir() {
		t.Fatalf("watch dir is not a directory")
	}
	// Verify 0o700 perms.
	if mode := info.Mode().Perm(); mode != 0o700 {
		t.Fatalf("expected mode 0o700, got %o", mode)
	}
}

// TestSupervisor_StopClosesAllClients verifies Stop cancels and closes every
// open Client.
func TestSupervisor_StopClosesAllClients(t *testing.T) {
	resetLoggedUnknowns()
	dir := t.TempDir()
	for _, name := range []string{"a", "b", "c"} {
		if err := os.WriteFile(filepath.Join(dir, name), nil, 0o600); err != nil {
			t.Fatal(err)
		}
	}

	reg := newTestOpenRegistry()
	s := NewSupervisor(NoOpSink{})
	s.watchDirOverride = dir
	s.open = reg.openFn()

	if err := s.Start(context.Background()); err != nil {
		t.Fatalf("Start: %v", err)
	}

	// Confirm all opened.
	deadline := time.Now().Add(2 * time.Second)
	for s.Get("a") == nil || s.Get("b") == nil || s.Get("c") == nil {
		if time.Now().After(deadline) {
			t.Fatal("not all opens registered")
		}
		time.Sleep(5 * time.Millisecond)
	}

	stopCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := s.Stop(stopCtx); err != nil {
		t.Fatalf("Stop: %v", err)
	}

	if s.Get("a") != nil || s.Get("b") != nil || s.Get("c") != nil {
		t.Fatal("map not cleared after Stop")
	}
}

// Counter used by sink tests below — kept package-scoped to avoid clashing
// with recordingSink defined in client_test.go.
type counterSink struct {
	established atomic.Int32
}

func (c *counterSink) OnSessionWindowChanged(string, string) {}
func (c *counterSink) OnWindowAdd(string)                    {}
func (c *counterSink) OnWindowClose(string)                  {}
func (c *counterSink) OnWindowRenamed(string, string)        {}
func (c *counterSink) OnSessionsChanged()                    {}
func (c *counterSink) OnLayoutChange(string)                 {}
func (c *counterSink) OnConnectionLost()                     {}
func (c *counterSink) OnConnectionEstablished()              { c.established.Add(1) }
