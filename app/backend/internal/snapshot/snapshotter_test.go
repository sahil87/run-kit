package snapshot

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"
)

// fakeSource is a mutable ServerSource for snapshotter tests.
type fakeSource struct {
	mu   sync.Mutex
	gens map[string]int64
}

func newFakeSource() *fakeSource { return &fakeSource{gens: map[string]int64{}} }

func (f *fakeSource) Sockets() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]string, 0, len(f.gens))
	for s := range f.gens {
		out = append(out, s)
	}
	return out
}

func (f *fakeSource) Generation(name string) int64 {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.gens[name]
}

func (f *fakeSource) set(name string, gen int64) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.gens[name] = gen
}

// countingCapture returns a captureFunc yielding a snapshot whose content is
// derived from the server's current generation (so generation bumps change
// content) and counts invocations.
type countingCapture struct {
	mu    sync.Mutex
	calls int
	src   *fakeSource
}

func (c *countingCapture) fn(ctx context.Context, server string) (*Snapshot, error) {
	c.mu.Lock()
	c.calls++
	c.mu.Unlock()
	gen := c.src.Generation(server)
	return &Snapshot{
		Server:  server,
		TakenAt: time.Now().UTC(),
		Sessions: []Session{{
			Name:      "s",
			CreatedAt: gen, // content varies with generation
			Windows:   []Window{{Index: 1, ID: "@1", Name: "w"}},
		}},
	}, nil
}

func (c *countingCapture) count() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.calls
}

// newTestSnapshotter builds a snapshotter with tiny intervals over a temp
// store. The tick loop is driven manually via tick() for determinism.
func newTestSnapshotter(t *testing.T, src *fakeSource) (*Snapshotter, *countingCapture, *Store) {
	t.Helper()
	store := NewStore(t.TempDir())
	cap := &countingCapture{src: src}
	s := NewSnapshotter(src, store)
	s.capture = cap.fn
	s.checkInterval = time.Millisecond
	s.safetyInterval = time.Hour // safety disabled unless a test moves the clock
	return s, cap, store
}

func TestSnapshotterFirstObservationSnapshotsImmediately(t *testing.T) {
	src := newFakeSource()
	src.set("kit", 1)
	s, cap, store := newTestSnapshotter(t, src)

	s.tick(context.Background())
	if cap.count() != 1 {
		t.Fatalf("capture calls = %d, want 1", cap.count())
	}
	snap, err := store.LoadLatest("kit")
	if err != nil || snap == nil {
		t.Fatalf("latest missing after first tick: %v %v", snap, err)
	}
}

func TestSnapshotterDebounceCoalescesBursts(t *testing.T) {
	src := newFakeSource()
	src.set("kit", 1)
	s, cap, _ := newTestSnapshotter(t, src)
	s.tick(context.Background()) // first observation write
	if cap.count() != 1 {
		t.Fatalf("setup capture calls = %d", cap.count())
	}

	// Burst: generation moves on every tick — no write while churning.
	for gen := int64(2); gen <= 5; gen++ {
		src.set("kit", gen)
		s.tick(context.Background())
	}
	if cap.count() != 1 {
		t.Fatalf("captures during churn = %d, want still 1", cap.count())
	}

	// Quiescence: one stable tick → exactly one write.
	s.tick(context.Background())
	if cap.count() != 2 {
		t.Fatalf("captures after quiescence = %d, want 2", cap.count())
	}
	// Further quiet ticks (safety not due) → no more writes.
	s.tick(context.Background())
	s.tick(context.Background())
	if cap.count() != 2 {
		t.Fatalf("captures after quiet ticks = %d, want 2", cap.count())
	}
}

func TestSnapshotterMaxHoldBoundsContinuousChurn(t *testing.T) {
	src := newFakeSource()
	src.set("kit", 1)
	s, cap, _ := newTestSnapshotter(t, src)

	now := time.Date(2026, 8, 5, 12, 0, 0, 0, time.UTC)
	s.now = func() time.Time { return now }
	s.maxHold = 10 * time.Second

	s.tick(context.Background()) // first observation
	if cap.count() != 1 {
		t.Fatal("setup")
	}

	// Generation moves on EVERY tick (continuous churn) — quiescence never
	// arrives, but maxHold forces a write once the dirty window exceeds it.
	gen := int64(1)
	for i := 0; i < 4; i++ {
		gen++
		src.set("kit", gen)
		now = now.Add(2 * time.Second)
		s.tick(context.Background())
	}
	if cap.count() != 1 {
		t.Fatalf("captures before maxHold = %d, want 1", cap.count())
	}
	gen++
	src.set("kit", gen)
	now = now.Add(5 * time.Second) // dirty since t0+2s → 11s > maxHold
	s.tick(context.Background())
	if cap.count() != 2 {
		t.Fatalf("captures after maxHold = %d, want 2", cap.count())
	}
}

func TestSnapshotterSafetyPassAndDedup(t *testing.T) {
	src := newFakeSource()
	src.set("kit", 1)
	s, cap, store := newTestSnapshotter(t, src)

	now := time.Date(2026, 8, 5, 12, 0, 0, 0, time.UTC)
	s.now = func() time.Time { return now }
	s.safetyInterval = time.Minute

	s.tick(context.Background()) // first observation
	if cap.count() != 1 {
		t.Fatal("setup")
	}

	// Quiet server before the safety interval: no capture.
	now = now.Add(30 * time.Second)
	s.tick(context.Background())
	if cap.count() != 1 {
		t.Fatalf("capture before safety due = %d", cap.count())
	}

	// Safety due: capture runs, but identical content dedups (no history churn).
	now = now.Add(31 * time.Second)
	s.tick(context.Background())
	if cap.count() != 2 {
		t.Fatalf("capture at safety = %d, want 2", cap.count())
	}
	if ts, _ := store.historyTimestamps("kit"); len(ts) != 1 {
		t.Fatalf("history after dedup safety pass = %d, want 1", len(ts))
	}
}

func TestSnapshotterTombstoneOnRemovalWithAuditWindow(t *testing.T) {
	src := newFakeSource()
	src.set("kit", 1)
	s, _, store := newTestSnapshotter(t, src)
	s.tick(context.Background())

	// Audited kill noted, then removal within the window.
	s.NoteAuditedKill("kit")
	s.OnServerRemoved("kit")

	if snap, _ := store.LoadLatest("kit"); snap != nil {
		t.Fatal("latest should be tombstoned away")
	}
	resolved, err := store.Resolve("kit", 0)
	if err != nil {
		t.Fatal(err)
	}
	if resolved.DiedAt == nil || !resolved.AuditedKill {
		t.Errorf("tombstone = diedAt %v audited %v, want stamped+audited", resolved.DiedAt, resolved.AuditedKill)
	}
}

func TestSnapshotterTombstoneUnauditedAndExpiredWindow(t *testing.T) {
	src := newFakeSource()
	src.set("kit", 1)
	s, _, store := newTestSnapshotter(t, src)

	now := time.Date(2026, 8, 5, 12, 0, 0, 0, time.UTC)
	s.now = func() time.Time { return now }
	s.tick(context.Background())

	// Audit note EXPIRES (older than the window) → unaudited tombstone.
	s.NoteAuditedKill("kit")
	now = now.Add(defaultAuditWindow + time.Second)
	s.OnServerRemoved("kit")

	resolved, err := store.Resolve("kit", 0)
	if err != nil {
		t.Fatal(err)
	}
	if resolved.AuditedKill {
		t.Error("expired audit note must not mark the tombstone audited")
	}
	if resolved.DiedAt == nil || !resolved.DiedAt.Equal(now) {
		t.Errorf("diedAt = %v, want %v", resolved.DiedAt, now)
	}
}

func TestSnapshotterDropsStateForUncoveredServers(t *testing.T) {
	src := newFakeSource()
	src.set("kit", 1)
	s, _, _ := newTestSnapshotter(t, src)
	s.tick(context.Background())

	s.mu.Lock()
	_, tracked := s.servers["kit"]
	s.mu.Unlock()
	if !tracked {
		t.Fatal("kit should be tracked after tick")
	}

	// Server disappears from the covered set (socket removed) — bookkeeping
	// dropped on the next tick.
	src.mu.Lock()
	delete(src.gens, "kit")
	src.mu.Unlock()
	s.tick(context.Background())

	s.mu.Lock()
	_, tracked = s.servers["kit"]
	s.mu.Unlock()
	if tracked {
		t.Error("kit bookkeeping should be dropped once uncovered")
	}
}

func TestSnapshotterCaptureFailureDegrades(t *testing.T) {
	src := newFakeSource()
	src.set("kit", 1)
	store := NewStore(t.TempDir())
	s := NewSnapshotter(src, store)
	s.checkInterval = time.Millisecond
	s.capture = func(ctx context.Context, server string) (*Snapshot, error) {
		return nil, context.DeadlineExceeded
	}

	// Must not panic; nothing written.
	s.tick(context.Background())
	if snap, _ := store.LoadLatest("kit"); snap != nil {
		t.Error("failed capture must not write")
	}
}

func TestSnapshotterFailedCaptureRetriesNextTick(t *testing.T) {
	src := newFakeSource()
	src.set("kit", 1)
	store := NewStore(t.TempDir())
	s := NewSnapshotter(src, store)
	s.safetyInterval = time.Hour // retry must come from the event path, not safety

	var calls, failures int
	s.capture = func(ctx context.Context, server string) (*Snapshot, error) {
		calls++
		if failures > 0 {
			failures--
			return nil, errors.New("transient capture failure")
		}
		return &Snapshot{
			Server:  server,
			TakenAt: time.Now().UTC(),
			Sessions: []Session{{
				Name:      "s",
				CreatedAt: src.Generation(server), // content varies with generation
				Windows:   []Window{{Index: 1, ID: "@1", Name: "w"}},
			}},
		}, nil
	}

	ctx := context.Background()
	s.tick(ctx) // first observation succeeds
	if calls != 1 {
		t.Fatalf("setup captures = %d, want 1", calls)
	}

	// Event: generation bumps, then the due (post-debounce) capture FAILS.
	failures = 1
	src.set("kit", 2)
	s.tick(ctx) // dirty, not yet stable → no capture
	s.tick(ctx) // stable → due → capture fails
	if calls != 2 {
		t.Fatalf("captures after failed pass = %d, want 2", calls)
	}

	// The failure must NOT be bookkept as written: the very next tick retries
	// (were writtenGen advanced on failure, this would park until safety).
	s.tick(ctx)
	if calls != 3 {
		t.Fatalf("captures after retry tick = %d, want 3 (failed capture not retried)", calls)
	}
	latest, err := store.LoadLatest("kit")
	if err != nil || latest == nil {
		t.Fatalf("latest after retry: %v %v", latest, err)
	}
	if latest.Sessions[0].CreatedAt != 2 {
		t.Errorf("latest content generation = %d, want 2", latest.Sessions[0].CreatedAt)
	}
}

func TestSnapshotterRemovalMidCaptureDropsWrite(t *testing.T) {
	src := newFakeSource()
	src.set("kit", 1)
	store := NewStore(t.TempDir())

	// Seed a good latest so the tombstone has real content to preserve.
	seed := &Snapshot{
		Server:  "kit",
		TakenAt: time.Now().UTC(),
		Sessions: []Session{{
			Name:      "s",
			CreatedAt: 100,
			Windows:   []Window{{Index: 1, ID: "@1", Name: "good"}},
		}},
	}
	if _, err := store.Write(seed); err != nil {
		t.Fatal(err)
	}

	s := NewSnapshotter(src, store)
	s.safetyInterval = time.Hour

	started := make(chan struct{})
	release := make(chan struct{})
	s.capture = func(ctx context.Context, server string) (*Snapshot, error) {
		close(started)
		<-release
		return &Snapshot{
			Server:  server,
			TakenAt: time.Now().UTC(),
			Sessions: []Session{{
				Name:      "s",
				CreatedAt: 200,
				Windows:   []Window{{Index: 1, ID: "@1", Name: "stale"}},
			}},
		}, nil
	}

	done := make(chan struct{})
	go func() {
		s.tick(context.Background()) // first observation → capture in flight
		close(done)
	}()
	<-started
	s.OnServerRemoved("kit") // tombstones the seeded latest, bumps the epoch
	close(release)
	<-done

	// The in-flight capture must be dropped — never resurrect a "live" latest
	// for a dead server.
	if snap, _ := store.LoadLatest("kit"); snap != nil {
		t.Fatalf("post-removal write resurrected a latest: %+v", snap)
	}
	resolved, err := store.Resolve("kit", 0)
	if err != nil {
		t.Fatal(err)
	}
	if resolved.DiedAt == nil {
		t.Error("tombstone missing diedAt")
	}
	if resolved.Sessions[0].Windows[0].Name != "good" {
		t.Errorf("tombstone content = %+v, want the pre-death snapshot", resolved.Sessions[0].Windows[0])
	}
}

func TestSnapshotterStartStopsWithContext(t *testing.T) {
	src := newFakeSource()
	src.set("kit", 1)
	s, cap, _ := newTestSnapshotter(t, src)

	ctx, cancel := context.WithCancel(context.Background())
	s.Start(ctx)

	deadline := time.Now().Add(2 * time.Second)
	for cap.count() == 0 && time.Now().Before(deadline) {
		time.Sleep(2 * time.Millisecond)
	}
	cancel()
	if cap.count() == 0 {
		t.Fatal("ticker loop never captured before deadline")
	}
}
