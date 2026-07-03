// Package ports provides an in-memory collector that enumerates the host's
// listening TCP ports AND filters them to only those that answer HTTP. It is
// modeled directly on internal/metrics.Collector: NewCollector → Start(ctx)
// (background ticker goroutine) → Snapshot() guarded by sync.RWMutex, with a
// //go:build platform split behind the readListeningPorts() seam and graceful
// zero-value returns on any error or on unsupported hosts.
//
// Enumeration is derived per-platform (procfs on Linux, lsof on darwin, empty
// elsewhere) at each tick; a platform-agnostic HTTP probe filter (probe.go) then
// retains only the ports that speak HTTP, mirroring the /proxy/{port}/ upstream
// so the snapshot lists exactly the services the Cockpit can actually open. No
// database, no persistent store (Constitution II); the only subprocess is
// darwin's bounded lsof (Constitution I).
package ports

import (
	"context"
	"sort"
	"sync"
	"time"
)

// Service describes a single listening TCP port on the host. v1 ships
// port-only tiles: Process and PID are best-effort, left zero-valued until
// process attribution is added, and omitted from JSON when unset.
type Service struct {
	Port    int    `json:"port"`
	Process string `json:"process,omitempty"` // best-effort command name; "" if unknown
	PID     int    `json:"pid,omitempty"`     // best-effort; 0 if unknown
}

// ServicesSnapshot is a point-in-time list of listening services, sorted by
// port ascending. Services is never nil (empty slice, not null) so JSON
// marshals to `[]` rather than `null`.
type ServicesSnapshot struct {
	Services []Service `json:"services"`
}

// readListeningPortsFn is the platform enumeration seam. It defaults to the
// per-platform readListeningPorts (procfs on Linux, lsof on darwin, empty
// elsewhere) and is a package var so platform-agnostic tests can stub the
// enumeration without a real listener (mirrors the lsofRun seam).
var readListeningPortsFn = readListeningPorts

// probeTTL bounds how long a port's HTTP-probe verdict is reused before it is
// re-probed. Enumeration runs every pollInterval (2.5s), but probing every tick
// would spam each local service's access log — so a fresh verdict within the TTL
// is reused, decoupling probe cadence (~1 req / TTL / port) from the tick.
const probeTTL = 10 * time.Second

// probeEntry is a cached HTTP-probe verdict for one port.
type probeEntry struct {
	httpOK bool
	at     time.Time
}

// Collector enumerates listening TCP ports in a background goroutine and filters
// them to the ports that answer HTTP.
type Collector struct {
	mu           sync.RWMutex
	snapshot     ServicesSnapshot
	pollInterval time.Duration

	// probeCache is a per-port TTL cache of HTTP-probe verdicts, keyed by port.
	// Only touched from the poll goroutine's collect() (single writer), so it
	// needs no separate lock; it is not exposed via Snapshot().
	probeCache map[int]probeEntry

	// now is the clock, injectable for TTL tests (default time.Now).
	now func() time.Time
}

// NewCollector creates a ports collector. Call Start to begin polling. The
// initial snapshot is EMPTY (a non-nil, zero-length slice — the metrics.Collector
// zero-value-seed precedent), NOT the unfiltered enumeration. This matters
// because the SSE hub reads Snapshot() on its very FIRST poll pass and both
// broadcasts it and caches it in cachedServicesJSON (replayed to every new
// client) — that pass runs before the collector's ticker first fires (the poll
// loop's wait sits at its END). Seeding the unfiltered enumeration would leak
// non-HTTP ports (Postgres/Redis/SSH/…) to any client connecting in the first
// ~pollInterval, violating the HTTP-only contract (R1). An empty seed means the
// pre-tick SSE broadcast shows "No services"; the first FILTERED snapshot lands
// within one pollInterval and no unfiltered data can ever reach a client.
func NewCollector(pollInterval time.Duration) *Collector {
	c := &Collector{
		pollInterval: pollInterval,
		snapshot:     ServicesSnapshot{Services: []Service{}},
		probeCache:   make(map[int]probeEntry),
		now:          time.Now,
	}
	return c
}

// Start begins the background polling goroutine. It exits when ctx is cancelled.
func (c *Collector) Start(ctx context.Context) {
	go c.poll(ctx)
}

// Snapshot returns a consistent copy of the current services list.
func (c *Collector) Snapshot() ServicesSnapshot {
	c.mu.RLock()
	defer c.mu.RUnlock()

	// Copy the slice so callers can't mutate the collector's backing array.
	out := make([]Service, len(c.snapshot.Services))
	copy(out, c.snapshot.Services)
	return ServicesSnapshot{Services: out}
}

func (c *Collector) poll(ctx context.Context) {
	ticker := time.NewTicker(c.pollInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			c.collect(ctx)
		}
	}
}

// collect enumerates listening ports, filters them to the ports that answer HTTP
// (reusing fresh cached probe verdicts, probing newly-seen or stale ports in
// parallel, and evicting cache entries for ports that stopped listening), then
// publishes the filtered, port-sorted snapshot. Runs only on the poll goroutine.
func (c *Collector) collect(ctx context.Context) {
	listening := readListeningPortsFn()

	// Retain a Service only if its port answers HTTP. Determine the verdict from
	// a fresh cache entry when available; otherwise probe (bounded parallelism).
	verdicts := c.probeVerdicts(ctx, listening)

	services := make([]Service, 0, len(listening))
	for _, svc := range listening {
		if verdicts[svc.Port] {
			services = append(services, svc)
		}
	}
	sort.Slice(services, func(i, j int) bool {
		return services[i].Port < services[j].Port
	})

	c.mu.Lock()
	c.snapshot = ServicesSnapshot{Services: services}
	c.mu.Unlock()
}

// probeVerdicts returns the HTTP verdict for every listening port, reusing fresh
// cached results and probing the rest in parallel under a bounded semaphore pool.
// It rebuilds c.probeCache to contain exactly the currently-listening ports, so
// entries for ports that stopped listening are evicted.
func (c *Collector) probeVerdicts(ctx context.Context, listening []Service) map[int]bool {
	now := c.now()

	// Split into fresh cache hits (reused) and ports needing a probe.
	fresh := make(map[int]probeEntry, len(listening))
	var toProbe []int
	for _, svc := range listening {
		if e, ok := c.probeCache[svc.Port]; ok && now.Sub(e.at) < probeTTL {
			fresh[svc.Port] = e
			continue
		}
		toProbe = append(toProbe, svc.Port)
	}

	// Probe the stale/new ports concurrently, bounded by a semaphore pool.
	probed := make(map[int]bool, len(toProbe))
	if len(toProbe) > 0 {
		sem := make(chan struct{}, probeConcurrency)
		var mu sync.Mutex
		var wg sync.WaitGroup
		for _, port := range toProbe {
			wg.Add(1)
			sem <- struct{}{}
			go func(port int) {
				defer wg.Done()
				defer func() { <-sem }()
				ok := probePort(ctx, port)
				mu.Lock()
				probed[port] = ok
				mu.Unlock()
			}(port)
		}
		wg.Wait()
	}

	// Rebuild the cache to hold only currently-listening ports (evicting the
	// rest) and assemble the verdict map for this cycle.
	newCache := make(map[int]probeEntry, len(listening))
	verdicts := make(map[int]bool, len(listening))
	for _, svc := range listening {
		if e, ok := fresh[svc.Port]; ok {
			newCache[svc.Port] = e
			verdicts[svc.Port] = e.httpOK
			continue
		}
		ok := probed[svc.Port]
		newCache[svc.Port] = probeEntry{httpOK: ok, at: now}
		verdicts[svc.Port] = ok
	}
	c.probeCache = newCache
	return verdicts
}
