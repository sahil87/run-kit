// Package ports provides an in-memory collector that enumerates the host's
// listening TCP ports. It is modeled directly on internal/metrics.Collector:
// NewCollector → Start(ctx) (background ticker goroutine) → Snapshot() guarded
// by sync.RWMutex, with a //go:build linux / //go:build !linux platform split
// and graceful zero-value returns on any error or on non-Linux hosts.
//
// State is derived from procfs (/proc/net/tcp{,6}) at each tick — no database,
// no persistent store (Constitution II), and no subprocess (Constitution I
// surface avoided; procfs needs none).
package ports

import (
	"context"
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

// Collector enumerates listening TCP ports in a background goroutine.
type Collector struct {
	mu           sync.RWMutex
	snapshot     ServicesSnapshot
	pollInterval time.Duration
}

// NewCollector creates a ports collector. Call Start to begin polling. The
// initial snapshot is populated synchronously so the first Snapshot() call is
// valid before the first tick.
func NewCollector(pollInterval time.Duration) *Collector {
	c := &Collector{
		pollInterval: pollInterval,
		snapshot:     ServicesSnapshot{Services: []Service{}},
	}
	c.snapshot = ServicesSnapshot{Services: readListeningPorts()}
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
			c.collect()
		}
	}
}

func (c *Collector) collect() {
	services := readListeningPorts()

	c.mu.Lock()
	defer c.mu.Unlock()
	c.snapshot = ServicesSnapshot{Services: services}
}
