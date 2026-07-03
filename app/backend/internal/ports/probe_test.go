package ports

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// portOf extracts the numeric port from a "host:port" address (test helper).
func portOf(t *testing.T, addr string) int {
	t.Helper()
	_, portStr, err := net.SplitHostPort(addr)
	if err != nil {
		t.Fatalf("split host/port %q: %v", addr, err)
	}
	p, err := strconv.Atoi(portStr)
	if err != nil {
		t.Fatalf("parse port %q: %v", portStr, err)
	}
	return p
}

// --- default probePort against real listeners -------------------------------

func TestProbePort_HTTPResponderIsRetained(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	port := portOf(t, srv.Listener.Addr().String())
	if !probePort(context.Background(), port) {
		t.Errorf("probePort(%d) = false; want true for a 200 responder", port)
	}
}

func TestProbePort_Non2xxResponderCountsAsHTTP(t *testing.T) {
	for _, status := range []int{http.StatusNotFound, http.StatusUnauthorized, http.StatusBadRequest} {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(status)
		}))
		port := portOf(t, srv.Listener.Addr().String())
		if !probePort(context.Background(), port) {
			t.Errorf("probePort(%d) = false; want true for a %d responder", port, status)
		}
		srv.Close()
	}
}

func TestProbePort_RedirectIsRetainedNotFollowed(t *testing.T) {
	var hits int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		// Redirect to a path that would 500 if followed — proves we don't follow.
		http.Redirect(w, r, "/elsewhere", http.StatusFound)
	}))
	defer srv.Close()

	port := portOf(t, srv.Listener.Addr().String())
	if !probePort(context.Background(), port) {
		t.Errorf("probePort(%d) = false; want true for a 302 responder", port)
	}
	if got := atomic.LoadInt32(&hits); got != 1 {
		t.Errorf("server hit %d times; redirect must NOT be followed (want 1)", got)
	}
}

func TestProbePort_NeverRespondingListenerTimesOut(t *testing.T) {
	// A raw listener that accepts but never writes a response — a non-HTTP
	// daemon (e.g. a database). The probe must time out and report non-HTTP.
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer ln.Close()
	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			// Hold the connection open without responding.
			go func(c net.Conn) {
				time.Sleep(2 * time.Second)
				c.Close()
			}(conn)
		}
	}()

	port := portOf(t, ln.Addr().String())
	start := time.Now()
	if probePort(context.Background(), port) {
		t.Errorf("probePort(%d) = true; want false for a never-responding listener", port)
	}
	// Must be bounded by ~probeTimeout, not the 2s hold.
	if elapsed := time.Since(start); elapsed > probeTimeout+500*time.Millisecond {
		t.Errorf("probe took %v; expected ~%v (bounded by timeout)", elapsed, probeTimeout)
	}
}

func TestProbePort_ClosedPortIsNonHTTP(t *testing.T) {
	// Bind then immediately close to obtain a port with nothing listening.
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	port := portOf(t, ln.Addr().String())
	ln.Close()

	if probePort(context.Background(), port) {
		t.Errorf("probePort(%d) = true; want false for a closed port", port)
	}
}

// --- collect() filtering with a stubbed probe -------------------------------

// withStubProbe swaps probePort for the duration of a test.
func withStubProbe(t *testing.T, fn func(ctx context.Context, port int) bool) {
	t.Helper()
	orig := probePort
	probePort = fn
	t.Cleanup(func() { probePort = orig })
}

// withStubEnum swaps the platform enumeration seam (readListeningPorts is a
// package func, so we stub via a var indirection introduced for tests).
func withStubEnum(t *testing.T, ports []int) {
	t.Helper()
	orig := readListeningPortsFn
	readListeningPortsFn = func() []Service {
		out := make([]Service, len(ports))
		for i, p := range ports {
			out[i] = Service{Port: p}
		}
		return out
	}
	t.Cleanup(func() { readListeningPortsFn = orig })
}

func TestCollect_FiltersToHTTPPorts(t *testing.T) {
	withStubEnum(t, []int{5432, 8080, 3000})
	withStubProbe(t, func(_ context.Context, port int) bool {
		return port != 5432 // 5432 (Postgres) is non-HTTP; the rest answer HTTP
	})

	c := NewCollector(time.Hour)
	c.collect(context.Background())

	snap := c.Snapshot()
	got := portsOf(snap.Services)
	want := []int{3000, 8080} // sorted, 5432 filtered out
	if !equalInts(got, want) {
		t.Errorf("collect() snapshot = %v; want %v", got, want)
	}
}

func TestCollect_FreshCacheReusedNoReprobe(t *testing.T) {
	withStubEnum(t, []int{8080})
	var probes int32
	withStubProbe(t, func(_ context.Context, _ int) bool {
		atomic.AddInt32(&probes, 1)
		return true
	})

	c := NewCollector(time.Hour)
	c.collect(context.Background()) // first tick probes
	c.collect(context.Background()) // second tick within TTL — must reuse

	if got := atomic.LoadInt32(&probes); got != 1 {
		t.Errorf("probe called %d times; a fresh cache entry must be reused (want 1)", got)
	}
	if !equalInts(portsOf(c.Snapshot().Services), []int{8080}) {
		t.Errorf("snapshot lost the port across cached ticks")
	}
}

func TestCollect_StaleCacheReprobed(t *testing.T) {
	withStubEnum(t, []int{8080})
	var probes int32
	withStubProbe(t, func(_ context.Context, _ int) bool {
		atomic.AddInt32(&probes, 1)
		return true
	})

	// Controllable clock: advance past the TTL between ticks.
	var mu sync.Mutex
	cur := time.Now()
	c := NewCollector(time.Hour)
	c.now = func() time.Time {
		mu.Lock()
		defer mu.Unlock()
		return cur
	}

	c.collect(context.Background()) // probe #1
	mu.Lock()
	cur = cur.Add(probeTTL + time.Second) // age the entry past the TTL
	mu.Unlock()
	c.collect(context.Background()) // stale → probe #2

	if got := atomic.LoadInt32(&probes); got != 2 {
		t.Errorf("probe called %d times; a stale entry must be re-probed (want 2)", got)
	}
}

func TestCollect_VanishedPortEvicted(t *testing.T) {
	// First tick: 8080 + 9090 listening. Second tick: only 8080. 9090's cache
	// entry must be evicted (not carried forward).
	withStubProbe(t, func(_ context.Context, _ int) bool { return true })

	c := NewCollector(time.Hour)

	withStubEnum(t, []int{8080, 9090})
	c.collect(context.Background())
	if _, ok := c.probeCache[9090]; !ok {
		t.Fatalf("expected 9090 cached after first tick")
	}

	withStubEnum(t, []int{8080})
	c.collect(context.Background())
	if _, ok := c.probeCache[9090]; ok {
		t.Errorf("9090 stopped listening but its cache entry was not evicted")
	}
	if !equalInts(portsOf(c.Snapshot().Services), []int{8080}) {
		t.Errorf("snapshot = %v; want [8080] after 9090 vanished", portsOf(c.Snapshot().Services))
	}
}

func TestCollect_BoundedParallelProbes(t *testing.T) {
	// Many ports that each block briefly: with a bounded pool the cycle must
	// finish in far less than the serial sum, and concurrency must not exceed
	// the cap.
	const n = 40
	ports := make([]int, n)
	for i := range ports {
		ports[i] = 10000 + i
	}
	withStubEnum(t, ports)

	var inFlight, maxInFlight int32
	withStubProbe(t, func(_ context.Context, _ int) bool {
		cur := atomic.AddInt32(&inFlight, 1)
		for {
			old := atomic.LoadInt32(&maxInFlight)
			if cur <= old || atomic.CompareAndSwapInt32(&maxInFlight, old, cur) {
				break
			}
		}
		time.Sleep(50 * time.Millisecond)
		atomic.AddInt32(&inFlight, -1)
		return true
	})

	c := NewCollector(time.Hour)
	start := time.Now()
	c.collect(context.Background())
	elapsed := time.Since(start)

	if got := atomic.LoadInt32(&maxInFlight); got > probeConcurrency {
		t.Errorf("max concurrent probes = %d; exceeds cap %d", got, probeConcurrency)
	}
	// Serial would be n*50ms = 2s; bounded pool should be far under that.
	if elapsed > time.Second {
		t.Errorf("bounded probe cycle took %v; expected well under serial 2s", elapsed)
	}
	if len(c.Snapshot().Services) != n {
		t.Errorf("expected all %d HTTP ports retained, got %d", n, len(c.Snapshot().Services))
	}
}

// --- small test helpers ------------------------------------------------------

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
