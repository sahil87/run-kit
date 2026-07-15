// Package ports provides an in-memory collector that passively enumerates the
// host's listening TCP ports. It follows internal/metrics.Collector's shape:
// NewCollector → Start(ctx) → Snapshot() guarded by sync.RWMutex, with a
// //go:build platform split behind the readListeningPorts() seam and graceful
// zero-value returns on any error or on unsupported hosts. Start differs from
// metrics: it runs one synchronous collect() to seed the first snapshot before
// launching the background ticker goroutine (see Start's doc for the boot-delay
// tradeoff).
//
// Enumeration is purely observational (Constitution II — state is derived, never
// interacted with): procfs (/proc/net/tcp{,6}) on Linux, an lsof subprocess on
// darwin, empty elsewhere. There is NO network probing — the collector never
// connects to a listening port, so one-shot local servers (OAuth callbacks) are
// never consumed. Every listening port is published (HTTP or not); the tile's
// "Open in window" iframe load is the only, user-initiated, on-demand probe.
//
// Process attribution (Service.Process/PID) is best-effort: darwin gets it from
// lsof, Linux joins lsof attribution onto the authoritative procfs port set (a
// non-root lsof only sees the invoking user's processes, so ports it cannot
// attribute render bare). No database, no persistent store (Constitution II);
// the only subprocess is the bounded lsof (Constitution I).
package ports

import (
	"context"
	"sort"
	"sync"
	"time"
)

// Service describes a single listening TCP port on the host. Process and PID are
// best-effort process attribution: darwin populates them from lsof, Linux joins
// lsof attribution onto the procfs port set (ports lsof cannot attribute — e.g.
// root-owned listeners seen by a non-root lsof — stay zero-valued). Both fields
// are omitted from JSON when unset.
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
// enumeration without a real listener (mirrors the lsofRun seam). The ctx is the
// collector's lifecycle context, threaded down to the bounded lsof subprocess so
// shutdown cancels an in-flight enumeration (Constitution I).
var readListeningPortsFn = readListeningPorts

// Collector passively enumerates listening TCP ports in a background goroutine.
type Collector struct {
	mu           sync.RWMutex
	snapshot     ServicesSnapshot
	pollInterval time.Duration
}

// NewCollector creates a ports collector. Call Start to begin polling and to
// perform the initial synchronous enumeration. The pre-Start snapshot is a
// non-nil, zero-length slice so Snapshot() marshals to `{"services":[]}` (never
// `null`) if read before Start.
func NewCollector(pollInterval time.Duration) *Collector {
	return &Collector{
		pollInterval: pollInterval,
		snapshot:     ServicesSnapshot{Services: []Service{}},
	}
}

// Start performs one synchronous collect() so the first snapshot carries real
// data — the SSE hub reads, broadcasts, and caches Snapshot() on its very first
// poll pass (cachedServicesJSON, replayed to every new client), which can run
// before the ticker first fires; a synchronous seed means that first broadcast
// shows the real enumeration instead of a ~pollInterval "No services" gap. Then
// it launches the background polling goroutine, which exits when ctx is
// cancelled.
//
// Boot-delay tradeoff: Start runs on the server boot path — api.NewRouterAndServer
// calls it before cmd/rk/serve.go binds the socket (http.Server.ListenAndServe),
// so the HTTP bind waits on this one synchronous enumeration. On darwin (and on
// Linux, which now also runs lsof for attribution) that enumeration shells out to
// lsof, so the worst case is a single bounded lsofTimeout (5s) if lsof hangs — a
// one-time cost, paid once at startup, bounded by exec.CommandContext (never
// unbounded). This is deliberate: R4 requires the first broadcast to be
// deterministic real data, and a bounded few-hundred-ms (worst-case 5s) boot
// delay is an acceptable price for that guarantee versus an empty first snapshot.
func (c *Collector) Start(ctx context.Context) {
	c.collect(ctx)
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

// collect enumerates listening ports, sorts them by port ascending, and
// publishes the snapshot. Purely observational — no probing, no filtering. Runs
// on the poll goroutine and once synchronously at Start. The ctx is threaded to
// the bounded lsof subprocess so shutdown cancels an in-flight enumeration.
func (c *Collector) collect(ctx context.Context) {
	services := readListeningPortsFn(ctx)
	sort.Slice(services, func(i, j int) bool {
		return services[i].Port < services[j].Port
	})

	c.mu.Lock()
	c.snapshot = ServicesSnapshot{Services: services}
	c.mu.Unlock()
}
