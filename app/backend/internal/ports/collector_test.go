package ports

import (
	"context"
	"encoding/json"
	"runtime"
	"sync"
	"testing"
	"time"
)

// TestNewCollector_InitialSnapshotEmpty pins the empty-seed contract: the
// constructor MUST NOT seed the unfiltered enumeration. The SSE hub reads,
// broadcasts, and caches Snapshot() on its first poll pass — before the
// collector's first tick — so an unfiltered seed would leak non-HTTP ports to
// early clients (R1). The seed is a non-nil, zero-length slice that marshals to
// `[]`, and the first filtered snapshot only arrives from the first collect().
func TestNewCollector_InitialSnapshotEmpty(t *testing.T) {
	// Stub enumeration to a non-empty set so a regression to the unfiltered
	// seed (readListeningPortsFn()) would be observable as a non-empty snapshot.
	withStubEnum(t, []int{5432, 8080})

	c := NewCollector(time.Second)
	snap := c.Snapshot()

	if snap.Services == nil {
		t.Fatal("expected non-nil Services slice before first tick")
	}
	if len(snap.Services) != 0 {
		t.Fatalf("expected EMPTY snapshot before first tick, got %v (an unfiltered seed leaks non-HTTP ports to early SSE clients)", portsOf(snap.Services))
	}

	// The empty seed must marshal to `[]`, not `null` — the never-nil wire
	// contract the SSE hub broadcasts and caches on its first pass.
	b, err := json.Marshal(snap)
	if err != nil {
		t.Fatalf("marshal snapshot: %v", err)
	}
	if got, want := string(b), `{"services":[]}`; got != want {
		t.Errorf("initial snapshot JSON = %s; want %s", got, want)
	}
}

func TestSnapshot_ReturnsCopy(t *testing.T) {
	c := NewCollector(time.Second)
	// Seed a known snapshot directly.
	c.mu.Lock()
	c.snapshot = ServicesSnapshot{Services: []Service{{Port: 8080}}}
	c.mu.Unlock()

	snap := c.Snapshot()
	if len(snap.Services) != 1 {
		t.Fatalf("expected 1 service, got %d", len(snap.Services))
	}
	// Mutating the returned slice must not affect the collector's backing array.
	snap.Services[0].Port = -1
	again := c.Snapshot()
	if again.Services[0].Port != 8080 {
		t.Error("Snapshot() returned a reference to the collector's backing array")
	}
}

func TestCollector_StartAndStop(t *testing.T) {
	c := NewCollector(20 * time.Millisecond)
	ctx, cancel := context.WithCancel(context.Background())
	c.Start(ctx)

	time.Sleep(100 * time.Millisecond)
	cancel()
	time.Sleep(50 * time.Millisecond)

	// Snapshot still works after stop (returns last known state).
	if c.Snapshot().Services == nil {
		t.Error("expected non-nil Services after stop")
	}
}

func TestCollector_SnapshotThreadSafety(t *testing.T) {
	c := NewCollector(20 * time.Millisecond)
	ctx, cancel := context.WithCancel(context.Background())
	c.Start(ctx)
	defer cancel()

	var wg sync.WaitGroup
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 50; j++ {
				_ = c.Snapshot()
				runtime.Gosched()
			}
		}()
	}
	wg.Wait()
}
