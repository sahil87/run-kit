package ports

import (
	"context"
	"runtime"
	"sync"
	"testing"
	"time"
)

func TestNewCollector_SnapshotNeverNil(t *testing.T) {
	c := NewCollector(time.Second)
	snap := c.Snapshot()
	if snap.Services == nil {
		t.Fatal("expected non-nil Services slice before first tick")
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
