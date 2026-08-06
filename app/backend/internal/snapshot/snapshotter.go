package snapshot

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"rk/internal/tmux"
)

const (
	// defaultCheckInterval is the debounce tick: each tick compares every
	// covered server's control-mode generation counter (an in-memory int read,
	// zero subprocess cost) against the last written one; a write lands only
	// after the counter has been stable for one full tick, so event bursts
	// coalesce into one capture.
	defaultCheckInterval = 2 * time.Second
	// defaultSafetyInterval is the per-server safety cadence: even with no
	// generation movement, capture and write-if-changed at least this often
	// (covers missed notifications and layout-invisible drift). Mirrors the
	// SSE hub's safety-poll backstop pattern at a far coarser cadence —
	// snapshots need freshness, not UI latency.
	defaultSafetyInterval = 60 * time.Second
	// defaultAuditWindow bounds how long a NoteAuditedKill annotation stays
	// pending: a socket removal within this window of an audited kill is
	// tombstoned as auditedKill. Generous relative to kill→socket-removal
	// latency (normally <1s).
	defaultAuditWindow = 30 * time.Second
	// defaultMaxHold bounds how long the debounce may defer a dirty server's
	// write while its generation keeps churning (e.g. continuous window
	// cycling). Without it, an event landing every tick would starve writes
	// until the churn stops; with it, a sustained burst still snapshots at
	// least every maxHold.
	defaultMaxHold = 15 * time.Second
)

// ServerSource enumerates the covered tmux servers and their control-mode
// generation counters. Implemented by *tmuxctl.Supervisor: its client set is
// exactly the covered set (rk-test-*/.lock sockets already excluded), so the
// snapshotter inherits the daemon's scope filter with no new enumeration
// logic.
type ServerSource interface {
	Sockets() []string
	Generation(name string) int64
}

// captureFunc captures one server's layout. Production: CaptureServer. Tests
// inject a stub.
type captureFunc func(ctx context.Context, server string) (*Snapshot, error)

// serverState is the per-server debounce/safety bookkeeping. All three fields
// advance only after a SUCCESSFUL pass (capture ok, write landed or deduped)
// — a failed capture leaves them untouched so the server is due again on the
// very next tick instead of waiting out the safety interval.
type serverState struct {
	lastSeenGen int64
	writtenGen  int64
	lastPass    time.Time // last successful pass (event or safety)
	// dirtySince marks when the generation was first observed ahead of
	// writtenGen; zero while clean. Drives the maxHold churn bound.
	dirtySince time.Time
}

// Snapshotter periodically persists layout snapshots for every covered server
// and tombstones a server's latest snapshot when its socket is removed. It is
// wired in `rk serve` next to the tmuxctl Supervisor and stops with the serve
// context. All failures degrade to log lines — snapshotting must never take
// down or block serving.
type Snapshotter struct {
	src     ServerSource
	store   *Store
	capture captureFunc

	checkInterval  time.Duration
	safetyInterval time.Duration
	auditWindow    time.Duration
	maxHold        time.Duration

	// now is a clock seam for tests.
	now func() time.Time

	mu      sync.Mutex
	servers map[string]*serverState
	// auditedAt records the last NoteAuditedKill per server, consumed by
	// OnServerRemoved within auditWindow.
	auditedAt map[string]time.Time
	// removedEpoch counts socket removals per server. snapshot() reads it
	// before capturing and re-checks it under writeMu before writing, so an
	// in-flight capture that raced OnServerRemoved can never land after the
	// tombstone and resurrect a "live" latest for a dead server. Never
	// cleaned — bounded by the distinct server names seen in one daemon
	// lifetime.
	removedEpoch map[string]uint64

	// writeMu serializes store writes against tombstoning: OnServerRemoved
	// bumps removedEpoch FIRST, then takes writeMu to tombstone — a write
	// already inside writeMu completes before the tombstone (and is
	// legitimately part of it); any write acquiring writeMu afterwards
	// observes the bumped epoch and drops.
	writeMu sync.Mutex
}

// NewSnapshotter constructs a Snapshotter over the given source and store
// with production intervals.
func NewSnapshotter(src ServerSource, store *Store) *Snapshotter {
	return &Snapshotter{
		src:            src,
		store:          store,
		capture:        CaptureServer,
		checkInterval:  defaultCheckInterval,
		safetyInterval: defaultSafetyInterval,
		auditWindow:    defaultAuditWindow,
		maxHold:        defaultMaxHold,
		now:            time.Now,
		servers:        map[string]*serverState{},
		auditedAt:      map[string]time.Time{},
		removedEpoch:   map[string]uint64{},
	}
}

// Start launches the tick loop in a goroutine. It exits when ctx is done.
func (s *Snapshotter) Start(ctx context.Context) {
	go s.run(ctx)
}

func (s *Snapshotter) run(ctx context.Context) {
	ticker := time.NewTicker(s.checkInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.tick(ctx)
		}
	}
}

// tick runs one debounce/safety pass over the covered servers.
func (s *Snapshotter) tick(ctx context.Context) {
	sockets := s.src.Sockets()
	covered := make(map[string]bool, len(sockets))
	now := s.now()

	for _, server := range sockets {
		covered[server] = true
		gen := s.src.Generation(server)

		s.mu.Lock()
		st, seen := s.servers[server]
		if !seen {
			st = &serverState{}
			s.servers[server] = st
		}
		prevSeen := st.lastSeenGen
		st.lastSeenGen = gen
		var due bool
		switch {
		case !seen:
			// First observation (daemon start or newly covered server):
			// snapshot immediately so coverage begins without waiting a full
			// safety interval.
			due = true
		case gen == st.writtenGen:
			// No event movement: safety pass when due.
			st.dirtySince = time.Time{}
			due = now.Sub(st.lastPass) >= s.safetyInterval
		default:
			// Dirty. Write once the burst has been stable for one full tick,
			// or when it has churned continuously past maxHold.
			if st.dirtySince.IsZero() {
				st.dirtySince = now
			}
			due = gen == prevSeen || now.Sub(st.dirtySince) >= s.maxHold
		}
		s.mu.Unlock()

		if due {
			// Bookkeeping advances only after a successful pass: a failed
			// capture leaves lastPass/writtenGen untouched, so the server is
			// due again on the very next tick (retry) instead of being
			// bookkept as written and parked until the safety interval. The
			// entry may have been deleted by a concurrent OnServerRemoved —
			// then there is nothing to advance.
			if s.snapshot(ctx, server) {
				s.mu.Lock()
				if st, ok := s.servers[server]; ok {
					st.lastPass = now
					st.writtenGen = gen
					st.dirtySince = time.Time{}
				}
				s.mu.Unlock()
			}
		}
	}

	// Drop bookkeeping for servers no longer covered (their tombstoning is
	// handled by OnServerRemoved, not the tick).
	s.mu.Lock()
	for server := range s.servers {
		if !covered[server] {
			delete(s.servers, server)
		}
	}
	s.mu.Unlock()
}

// snapshot captures and persists one server, degrading every failure to a log
// line. It reports whether the pass succeeded (capture ok, write landed or
// deduped) — the tick loop advances its per-server bookkeeping only on
// success. A dead-server capture error (the socket-removal race) is expected
// and logs at Debug; anything else warns. A capture that raced
// OnServerRemoved (removedEpoch advanced while it was in flight) is dropped
// under writeMu so it can never land after the tombstone.
func (s *Snapshotter) snapshot(ctx context.Context, server string) bool {
	s.mu.Lock()
	epoch := s.removedEpoch[server]
	s.mu.Unlock()

	snap, err := s.capture(ctx, server)
	if err != nil {
		if tmux.IsServerGone(err) {
			slog.Debug("snapshot: capture skipped, server gone", "server", server, "err", err)
		} else {
			slog.Warn("snapshot: capture failed", "server", server, "err", err)
		}
		return false
	}

	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	s.mu.Lock()
	removed := s.removedEpoch[server] != epoch
	s.mu.Unlock()
	if removed {
		slog.Debug("snapshot: write dropped, server removed mid-capture", "server", server)
		return false
	}
	wrote, err := s.store.Write(snap)
	if err != nil {
		slog.Warn("snapshot: write failed", "server", server, "err", err)
		return false
	}
	if wrote {
		slog.Debug("snapshot: written", "server", server,
			"sessions", snap.SessionCount(), "windows", snap.WindowCount())
	}
	return true
}

// NoteAuditedKill records that the named server is about to be (or was just)
// killed through run-kit's audited kill path (POST /api/servers/kill). A
// socket removal observed within auditWindow tombstones as auditedKill.
func (s *Snapshotter) NoteAuditedKill(server string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.auditedAt[server] = s.now()
}

// OnServerRemoved tombstones the server's latest snapshot — the moment a
// server dies is exactly when its snapshot becomes valuable. Wired to the
// Supervisor's socket-removed seam. Best-effort: errors are logged, never
// propagated (the caller is the supervisor's event loop).
func (s *Snapshotter) OnServerRemoved(server string) {
	now := s.now()

	s.mu.Lock()
	// Bump the removed epoch BEFORE taking writeMu: an in-flight capture
	// re-checks the epoch under writeMu before writing, so once the bump is
	// visible no late write can resurrect a "live" latest after the tombstone.
	s.removedEpoch[server]++
	audited := false
	if at, ok := s.auditedAt[server]; ok && now.Sub(at) <= s.auditWindow {
		audited = true
	}
	delete(s.auditedAt, server)
	delete(s.servers, server)
	s.mu.Unlock()

	// writeMu waits out any write already in flight (pre-bump — its latest is
	// then legitimately part of the tombstone) and excludes later ones.
	s.writeMu.Lock()
	created, err := s.store.Tombstone(server, now, audited)
	s.writeMu.Unlock()
	if err != nil {
		slog.Warn("snapshot: tombstone failed", "server", server, "err", err)
		return
	}
	if !created {
		// No latest snapshot existed — nothing was tombstoned.
		slog.Debug("snapshot: dead server had no snapshot to tombstone", "server", server)
		return
	}
	slog.Info("snapshot: tombstoned dead server", "server", server, "audited", audited)
}
