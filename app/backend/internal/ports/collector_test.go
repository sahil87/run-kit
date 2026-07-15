package ports

import (
	"context"
	"encoding/json"
	"runtime"
	"sync"
	"testing"
	"time"
)

// withStubEnum swaps the platform enumeration seam (readListeningPortsFn) for
// the duration of a test, returning the given ports as bare Services.
func withStubEnum(t *testing.T, ports []int) {
	t.Helper()
	orig := readListeningPortsFn
	readListeningPortsFn = func(context.Context) []Service {
		out := make([]Service, len(ports))
		for i, p := range ports {
			out[i] = Service{Port: p}
		}
		return out
	}
	t.Cleanup(func() { readListeningPortsFn = orig })
}

func portsOf(svcs []Service) []int {
	out := make([]int, len(svcs))
	for i, s := range svcs {
		out[i] = s.Port
	}
	return out
}

func equalInts(a, b []int) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// TestCollect_EnumeratesSortsPublishes pins the passive contract: collect()
// enumerates every listening port (HTTP or not), sorts ascending, and publishes
// — no filtering, no probing. A regression that reintroduced an HTTP filter
// would drop the non-HTTP ports (5432/6379) from the snapshot.
func TestCollect_EnumeratesSortsPublishes(t *testing.T) {
	withStubEnum(t, []int{8080, 5432, 3000, 6379})

	c := NewCollector(time.Hour)
	c.collect(context.Background())

	got := portsOf(c.Snapshot().Services)
	want := []int{3000, 5432, 6379, 8080} // all ports, sorted, none filtered
	if !equalInts(got, want) {
		t.Errorf("collect() snapshot = %v; want %v (all ports, sorted, unfiltered)", got, want)
	}
}

// TestStart_InitialSynchronousCollect pins the initial-collect contract: Start()
// runs one synchronous collect() BEFORE launching the poll goroutine, so the
// first Snapshot() (which the SSE hub reads, broadcasts, and caches on its first
// pass — potentially before the ticker fires) carries real data, not an empty
// "No services" gap.
func TestStart_InitialSynchronousCollect(t *testing.T) {
	withStubEnum(t, []int{8080})

	c := NewCollector(time.Hour) // long interval → ticker won't fire during the test
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	c.Start(ctx)

	// Snapshot is populated synchronously by Start's initial collect, without
	// waiting for the first tick.
	if got := portsOf(c.Snapshot().Services); !equalInts(got, []int{8080}) {
		t.Errorf("snapshot after Start = %v; want [8080] (Start must run an initial synchronous collect)", got)
	}
}

// TestNewCollector_SnapshotNeverNil pins the never-nil wire contract: the
// pre-Start snapshot is a non-nil, zero-length slice that marshals to
// `{"services":[]}` rather than `null`.
func TestNewCollector_SnapshotNeverNil(t *testing.T) {
	c := NewCollector(time.Second)
	snap := c.Snapshot()

	if snap.Services == nil {
		t.Fatal("expected non-nil Services slice before Start")
	}
	if len(snap.Services) != 0 {
		t.Fatalf("expected empty snapshot before Start, got %v", portsOf(snap.Services))
	}

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
