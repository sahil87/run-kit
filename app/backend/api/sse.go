package api

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"rk/internal/metrics"
	"rk/internal/prstatus"
	"rk/internal/sessions"
	"rk/internal/tmux"
)

// SessionOrderFetcher reads the persisted session order for a tmux server.
// Injected into the SSE hub so tests can stub the tmux dependency.
type SessionOrderFetcher interface {
	GetSessionOrder(ctx context.Context, server string) ([]string, error)
}

type prodSessionOrderFetcher struct{}

func (prodSessionOrderFetcher) GetSessionOrder(ctx context.Context, server string) ([]string, error) {
	return tmux.GetSessionOrder(ctx, server)
}

// BoardEntriesFetcher reads board pin entries for a tmux server. In the
// move-based model membership is derived live from `_rk-pin-*` sessions, so the
// SSE hub no longer needs an eager-cleanup hook — a killed pinned window simply
// drops out of the next ListBoardEntries read. Kept as a one-method interface
// so tests can stub the tmux dependency.
type BoardEntriesFetcher interface {
	ListBoardEntries(ctx context.Context, server string) ([]tmux.BoardEntry, error)
}

type prodBoardEntriesFetcher struct{}

func (prodBoardEntriesFetcher) ListBoardEntries(ctx context.Context, server string) ([]tmux.BoardEntry, error) {
	return tmux.ListBoardEntries(ctx, server)
}

// PRStatusSnapshotter supplies the current in-memory PR-status map, keyed by
// canonical PR URL (PR numbers are only unique per repo — see prstatus.Collector).
// Injected into the SSE hub so the poll path can attach live PR status
// to change-bound windows via a PURE in-memory read — the hot path makes no
// network call. Implemented by *prstatus.Collector; a one-method interface lets
// tests stub it and lets the hub degrade gracefully (nil → no PR fields).
type PRStatusSnapshotter interface {
	Snapshot() map[string]prstatus.PRStatus
}

// boardEventName is the SSE event type for board-membership changes. Matches
// the kebab-case convention established by `event: session-order`.
const boardEventName = "board-changed"

// metricsOnlyServer is the reserved client key for a server-neutral,
// metrics-only SSE stream (opened with `?metrics=1`, no `server`). Such a
// client wants ONLY the server-independent `event: metrics` broadcast — it has
// no associated tmux server, so the poll loop skips session-fetching and
// reaping for it (there is no socket to poll or reap) while the metrics
// broadcast, which fans out to every registered client, still reaches it. This
// backs the Cockpit host-console home (`/`), which shows host health with zero
// attached servers. The leading NUL makes it impossible to collide with a real
// tmux server name (validated to a safe charset by ValidateServerName).
const metricsOnlyServer = "\x00metrics-only"

// boardChangedPayload is the body of `event: board-changed` for explicit
// pin/unpin/reorder mutations. Board membership changes only through these
// mutations (each handler emits its own event), so there is no synthetic
// cleanup or bootstrap variant.
type boardChangedPayload struct {
	Board    string `json:"board"`
	Change   string `json:"change"` // "pin" | "unpin" | "reorder"
	Server   string `json:"server"`
	WindowID string `json:"windowId,omitempty"`
	OrderKey string `json:"orderKey,omitempty"`
}

const (
	// safetyPollInterval is the safety-net cadence for snapshot rebuilds
	// when no control-mode subscriber is available (PTY-unavailable
	// container, tmux predating control-mode notifications, brief
	// reconnect gap). The primary driver is the per-server tmuxctl Client;
	// see WindowChangeSubscriber.
	safetyPollInterval = 12 * time.Second
	// legacyPollInterval is the pre-tmuxctl poll cadence. It remains in
	// effect when no WindowChangeSubscriber is wired (PTY-unavailable
	// host, or unit tests that exercise the hub without a control-mode
	// driver) — under those conditions the snapshot-rebuild cadence is
	// the only freshness guarantee.
	legacyPollInterval = 2500 * time.Millisecond
	// metricsPollInterval is the cadence at which metrics.Collector polls
	// host CPU/memory. Kept separate from the SSE intervals so the
	// metrics sampling frequency is not coupled to the SSE event/safety
	// cadences — both have independent freshness requirements.
	metricsPollInterval = 2500 * time.Millisecond
	// prStatusPollInterval is the cadence at which prstatus.Collector makes
	// its single batched `gh` call. Deliberately slow (~40 calls/hr vs. the
	// 5000/hr authenticated limit) — the SSE hot path reads the cached
	// snapshot, never gh, so PR-status freshness is decoupled from the SSE
	// cadence. On-demand refresh (POST /api/pr-status/refresh) covers the
	// "I want it now" case.
	prStatusPollInterval = 90 * time.Second
	// sseHeartbeatPeriod is the time after which a connection without
	// data writes a `: heartbeat` comment to keep the connection alive
	// through intermediate proxies and detect dead connections. With the
	// new event-driven loop, heartbeat is time-based (not tick-based) so
	// the slower safety cadence doesn't starve heartbeats.
	sseHeartbeatPeriod = 15 * time.Second
	sseCacheTTL        = 500 * time.Millisecond
	maxLifetime        = 30 * time.Minute
)

// WindowChangeSubscriber is the interface the SSE hub uses to receive
// notifications that a server's tmux state has changed. Production
// implementations bridge into internal/tmuxctl.Client via the Supervisor;
// tests can implement it directly with a channel.
//
// Generation semantics mirror tmuxctl.Client: every observed notification
// increments the counter. Wait(after) returns a channel that closes once
// generation > after.
type WindowChangeSubscriber interface {
	Generation(server string) int64
	Wait(server string, after int64) <-chan struct{}
	// Covers reports whether this subscriber has a live control-mode driver
	// for the named server. A covered server is woken event-driven (its Wait
	// channel fires on tmux notifications), so the SSE loop can afford the long
	// safety-net interval. An UNcovered server (no Client — e.g. rk-test-*
	// servers the supervisor skips, or PTY-unavailable hosts) has no event
	// driver, so the safety-net timer is its ONLY freshness source and must run
	// at the fast cadence. See safetyIntervalEffective.
	Covers(server string) bool
}

// cachedResult holds a cached FetchSessions result with a timestamp.
type cachedResult struct {
	data      []sessions.ProjectSession
	fetchedAt time.Time
}

type sseClient struct {
	ch      chan []byte
	server  string
	dropped bool
}

// orderBootstrapMaxAttempts caps how many times poll() will try to read
// @rk_session_order from tmux when previous reads errored. Limits the blast
// radius of a hung or misbehaving tmux while still recovering from transient
// failures. After the cap is hit the bootstrap stops attempting; a successful
// POST (which populates previousOrderJSON via broadcast) re-establishes the
// cache without needing the bootstrap.
const orderBootstrapMaxAttempts = 3

type sseHub struct {
	mu                     sync.RWMutex
	clients                map[string][]*sseClient
	previousJSON           map[string]string          // per-server sessions JSON dedup cache
	previousOrderJSON      map[string]string          // per-server session-order event payload cache (only present when populated by a successful read or a POST broadcast)
	orderBootstrapAttempts map[string]int             // per-server count of failed bootstrap attempts; capped at orderBootstrapMaxAttempts
	previousRealSessions   map[string]map[string]bool // per-server prior-tick real (non-anchor) session names for disappearance logging
	cache                  map[string]*cachedResult   // per-server session fetch cache (500ms TTL)
	polling                bool
	fetcher                SessionFetcher
	orderFetcher           SessionOrderFetcher
	metrics                *metrics.Collector
	cachedMetricsJSON      string // latest metrics JSON for new clients
	// prStatus, when non-nil, supplies the in-memory PR-status snapshot the
	// poll path joins onto change-bound windows. nil degrades gracefully (no
	// PR fields attached) — used by tests and when no collector is wired.
	prStatus PRStatusSnapshotter

	// subscriber, when non-nil, provides per-server Wait(after) channels
	// driven by tmux control-mode notifications. When nil, the loop runs
	// on the safety-net ticker only — preserves correctness for tests and
	// for the PTY-unavailable startup case.
	subscriber WindowChangeSubscriber

	// safetyInterval overrides safetyPollInterval per-hub. Zero falls back
	// to the package constant. Tests set this to a short duration so
	// existing time-based assertions remain valid; production callers
	// leave it zero.
	safetyInterval time.Duration
}

// safetyIntervalEffective returns the safety-net interval for a poll cycle
// covering the given servers. The long 12s interval is correct ONLY when every
// watched server is control-covered (its Wait channel fires event-driven, so
// the timer is just a backstop). If ANY watched server is uncovered — no
// control-mode Client, e.g. an rk-test-* server the supervisor skips, or a
// PTY-unavailable host — that server has NO event driver, so the safety timer
// is its only freshness source and must run at the fast legacy cadence;
// otherwise an external change on it takes up to 12s to surface (the SSE-sync
// e2e failures: tests assert at 5s but the test server was uncovered yet still
// got the 12s interval). A per-hub override (h.safetyInterval) wins when set.
//
// The metricsOnlyServer sentinel is EXCLUDED from the coverage gate: it has no
// tmux server to poll and is never session-fetched (see the poll loop skip), so
// it needs no freshness cadence of its own. It can never be Covers()-ed (no
// control-mode Client for a non-server key), so counting it would always force
// the fast legacy cadence whenever a metrics-only client is present (~always,
// since the Cockpit home holds one open) — needlessly ~5x-ing FetchSessions
// calls for co-attached real servers. Skipping it lets the covered real servers
// keep the long safety interval.
//
// One exception: when the sentinel is the ONLY thing present (the bare `/`
// Cockpit home with zero attached servers), skipping it would fall through to
// the 12s safety backstop — but the sentinel's Wait channel never fires (it is
// never Covers()-ed), so the loop would block the full 12s between metrics
// broadcasts, making host health on `/` update ~12s apart instead of the
// intended ~2.5s tick. A sentinel-only slice does zero session-fetching, so the
// fast legacy cadence costs nothing but the metrics marshal/broadcast — exactly
// the freshness we want. So a slice containing NO real (non-sentinel) server
// runs at legacyPollInterval.
func (h *sseHub) safetyIntervalEffective(servers []string) time.Duration {
	if h.safetyInterval > 0 {
		return h.safetyInterval
	}
	if h.subscriber == nil {
		return legacyPollInterval
	}
	sawRealServer := false
	for _, server := range servers {
		if server == metricsOnlyServer {
			continue
		}
		sawRealServer = true
		if !h.subscriber.Covers(server) {
			return legacyPollInterval
		}
	}
	// No real server in the slice (only the metrics-only sentinel, or empty):
	// use the fast cadence so the metrics broadcast ticks at ~2.5s for the
	// Cockpit home. With a real, fully-covered server present, keep the long
	// safety interval.
	if !sawRealServer {
		return legacyPollInterval
	}
	return safetyPollInterval
}

func newSSEHub(fetcher SessionFetcher, mc *metrics.Collector, pc PRStatusSnapshotter) *sseHub {
	return &sseHub{
		clients:                make(map[string][]*sseClient),
		previousJSON:           make(map[string]string),
		previousOrderJSON:      make(map[string]string),
		orderBootstrapAttempts: make(map[string]int),
		previousRealSessions:   make(map[string]map[string]bool),
		cache:                  make(map[string]*cachedResult),
		fetcher:                fetcher,
		orderFetcher:           prodSessionOrderFetcher{},
		metrics:                mc,
		prStatus:               pc,
	}
}

func (h *sseHub) addClient(c *sseClient) {
	h.mu.Lock()
	defer h.mu.Unlock()

	h.clients[c.server] = append(h.clients[c.server], c)

	// Send cached session snapshot immediately
	if prev, ok := h.previousJSON[c.server]; ok && prev != "" {
		select {
		case c.ch <- []byte(fmt.Sprintf("event: sessions\ndata: %s\n\n", prev)):
		default:
		}
	}

	// Send cached session-order snapshot immediately (after sessions, before metrics)
	if prev, ok := h.previousOrderJSON[c.server]; ok && prev != "" {
		select {
		case c.ch <- []byte(fmt.Sprintf("event: session-order\ndata: %s\n\n", prev)):
		default:
		}
	}

	// Send cached metrics snapshot immediately (server-independent)
	if h.cachedMetricsJSON != "" {
		select {
		case c.ch <- []byte(fmt.Sprintf("event: metrics\ndata: %s\n\n", h.cachedMetricsJSON)):
		default:
		}
	}

	if !h.polling {
		h.polling = true
		go h.poll()
	}
}

func (h *sseHub) removeClient(c *sseClient) {
	h.mu.Lock()
	defer h.mu.Unlock()

	cs := h.clients[c.server]
	for i, cl := range cs {
		if cl == c {
			cs[i] = cs[len(cs)-1]
			cs[len(cs)-1] = nil // avoid leak
			cs = cs[:len(cs)-1]
			break
		}
	}
	if len(cs) == 0 {
		delete(h.clients, c.server)
	} else {
		h.clients[c.server] = cs
	}
}

// broadcastSessionOrder pushes a session-order event to every client connected
// for the given server, and caches the payload so future clients receive it
// during addClient. Order changes are eager — they do not wait for the next
// poll tick.
//
// nil order is normalized to an empty slice so the cached JSON is always "[]"
// rather than "null", matching the GET endpoint shape.
func (h *sseHub) broadcastSessionOrder(server string, order []string) {
	if order == nil {
		order = []string{}
	}
	payload := struct {
		Server string   `json:"server"`
		Order  []string `json:"order"`
	}{Server: server, Order: order}
	jsonBytes, err := json.Marshal(payload)
	if err != nil {
		slog.Warn("session-order broadcast marshal failed", "err", err, "server", server)
		return
	}
	jsonStr := string(jsonBytes)
	event := []byte(fmt.Sprintf("event: session-order\ndata: %s\n\n", jsonStr))

	h.mu.Lock()
	defer h.mu.Unlock()
	h.previousOrderJSON[server] = jsonStr
	for _, c := range h.clients[server] {
		select {
		case c.ch <- event:
		default:
			if !c.dropped {
				slog.Warn("SSE event dropped", "server", server, "event", "session-order")
				c.dropped = true
			}
		}
	}
}

// broadcastBoardChanged pushes a board-changed event to every client
// connected for the supplied server. The payload is rendered as JSON and
// emitted using the shared SSE envelope. No payload caching is performed:
// board membership changes only through the explicit pin/unpin/reorder
// handlers (each emits its own event), and a killed pinned window drops out
// of the next live ListBoardEntries read — there is no snapshot to cache.
func (h *sseHub) broadcastBoardChanged(server string, payload boardChangedPayload) {
	jsonBytes, err := json.Marshal(payload)
	if err != nil {
		slog.Warn("board-changed broadcast marshal failed", "err", err, "server", server)
		return
	}
	event := []byte(fmt.Sprintf("event: %s\ndata: %s\n\n", boardEventName, string(jsonBytes)))

	h.mu.Lock()
	defer h.mu.Unlock()
	for _, c := range h.clients[server] {
		select {
		case c.ch <- event:
		default:
			if !c.dropped {
				slog.Warn("SSE event dropped", "server", server, "event", boardEventName)
				c.dropped = true
			}
		}
	}
}

// attachPRStatus joins live PR status onto change-bound windows from the
// in-memory collector snapshot. It is a PURE read of prStatus.Snapshot() — NO
// network/gh call — preserving the SSE hot path's zero-network-call guarantee.
//
// Gate: status is attached only to a window that has BOTH a non-empty PrURL
// (from the pane-map enrichment; nil and "" both fail the gate) AND a
// non-empty FabChange (the change-bound gate). The join is by canonical PR URL, never by bare PR number — numbers
// are only unique per repo, so a number join can pick up an unrelated repo's
// PR state. The four display fields are always reset first so a window that
// lost its PR (merged/closed → dropped from the snapshot) clears cleanly even
// on a cached result slice (the cache stores the same slice by reference).
//
// No-op when no collector is wired (nil prStatus) — degrades gracefully.
func (h *sseHub) attachPRStatus(sess []sessions.ProjectSession) {
	if h.prStatus == nil {
		return
	}
	snap := h.prStatus.Snapshot()
	for si := range sess {
		windows := sess[si].Windows
		for wi := range windows {
			w := &windows[wi]
			// Reset display fields so stale values never linger.
			w.PrState, w.PrChecks, w.PrReview, w.PrIsDraft = "", "", "", false
			if w.FabChange == "" || w.PrURL == nil || *w.PrURL == "" {
				continue
			}
			if st, ok := snap[*w.PrURL]; ok {
				w.PrState = st.State
				w.PrChecks = st.Checks
				w.PrReview = st.ReviewDecision
				w.PrIsDraft = st.IsDraft
			}
		}
	}
}

// realSessionNameSet returns the set of *user-facing* session names in the
// snapshot — excluding the board pin-sessions (_rk-pin-*) and the control-mode
// anchor (_rk-ctl), which are not sessions a user would notice losing. Used to
// detect when a real session disappears between poll ticks (observability for
// Constitution VI — tmux sessions must survive).
func realSessionNameSet(sess []sessions.ProjectSession) map[string]bool {
	out := make(map[string]bool)
	for _, s := range sess {
		if s.Name == "" {
			continue
		}
		if strings.HasPrefix(s.Name, tmux.PinSessionPrefix) || s.Name == tmux.ControlAnchorSessionName {
			continue
		}
		out[s.Name] = true
	}
	return out
}

// detectDisappearedSessions returns names present in prev but absent in
// current. Pure helper for the real-session disappearance WARN.
func detectDisappearedSessions(prev, current map[string]bool) []string {
	var gone []string
	for name := range prev {
		if !current[name] {
			gone = append(gone, name)
		}
	}
	return gone
}

func (h *sseHub) poll() {
	// Track per-server generation observed on the prior pass. The
	// event-driven wait fires when generation advances past this.
	perServerGen := map[string]int64{}
	// eventDrivenServers records which servers had their wait channel
	// fire on the most recent waitForNext call. The next iteration
	// invalidates each of those servers' fetch caches so the loop
	// observes the post-mutation tmux state immediately.
	eventDrivenServers := map[string]bool{}
	lastDataAt := time.Now()

	for {
		// Read-only check: count clients and collect server keys
		h.mu.RLock()
		total := 0
		for _, cs := range h.clients {
			total += len(cs)
		}
		if total == 0 {
			h.mu.RUnlock()
			// Upgrade to write lock to set polling = false
			h.mu.Lock()
			// Re-check under write lock — a client may have been added
			recheck := 0
			for _, cs := range h.clients {
				recheck += len(cs)
			}
			if recheck == 0 {
				h.polling = false
				h.mu.Unlock()
				return
			}
			h.mu.Unlock()
			continue
		}
		servers := make([]string, 0, len(h.clients))
		for server := range h.clients {
			servers = append(servers, server)
		}
		h.mu.RUnlock()

		// Poll each server and broadcast to its clients. deadServers collects
		// servers whose tmux socket is gone (tmux.IsServerGone) so they can be
		// reaped from the poll set AFTER the loop — never mid-range over the
		// snapshot, and never under the write lock while FetchSessions runs.
		dataChanged := false
		var deadServers []string
		for _, server := range servers {
			// Metrics-only clients (server-neutral, `?metrics=1`) have no tmux
			// server — skip all session-fetch / order / reap work for them. They
			// still receive the server-independent metrics broadcast at the
			// bottom of the loop, which fans out to every registered client.
			if server == metricsOnlyServer {
				continue
			}
			// Check session fetch cache (500ms TTL). If the prior
			// waitForNext call observed a control-mode notification
			// for this server, invalidate the cache so we observe the
			// post-mutation tmux state immediately.
			if eventDrivenServers[server] {
				delete(h.cache, server)
				delete(eventDrivenServers, server)
			}
			var result []sessions.ProjectSession
			if cached, ok := h.cache[server]; ok && time.Since(cached.fetchedAt) < sseCacheTTL {
				result = cached.data
			} else {
				var err error
				result, err = h.fetcher.FetchSessions(context.Background(), server)
				if err != nil {
					if tmux.IsServerGone(err) {
						// The tmux socket is gone — killed, never started, or
						// unreachable. Reap it from the poll set instead of
						// re-polling the corpse every tick (the WARN drumbeat).
						// Collected here; reaped after the loop (see below).
						slog.Info("SSE: tmux server gone, reaping from poll set", "server", server)
						deadServers = append(deadServers, server)
					} else {
						slog.Warn("SSE poll error", "err", err, "server", server)
					}
					continue
				}
				h.cache[server] = &cachedResult{data: result, fetchedAt: time.Now()}
			}

			// Attach live PR status to change-bound windows. PURE in-memory
			// read of the collector snapshot — the hot path makes NO network
			// call (the gh cost lives on the 90s background tick + on-demand
			// POST). NOTE: `result` and `h.cache[server].data` are the SAME
			// slice (stored by reference above), so this mutates the cached
			// snapshot in place — that is intentional and safe because
			// attachPRStatus is idempotent: it resets all four PR fields to
			// zero before re-attaching, so re-running it on a cache hit yields
			// the same result and a PR that left the collector snapshot clears
			// cleanly. Re-deriving every tick keeps the cached sessions in sync
			// with the latest PR snapshot without a deep copy.
			h.attachPRStatus(result)

			jsonBytes, err := json.Marshal(result)
			if err != nil {
				continue
			}
			jsonStr := string(jsonBytes)

			h.mu.Lock()
			if jsonStr != h.previousJSON[server] {
				h.previousJSON[server] = jsonStr
				event := []byte(fmt.Sprintf("event: sessions\ndata: %s\n\n", jsonStr))

				for _, c := range h.clients[server] {
					select {
					case c.ch <- event:
						c.dropped = false
					default:
						if !c.dropped {
							slog.Warn("SSE event dropped", "server", server)
							c.dropped = true
						}
					}
				}
				dataChanged = true
			}
			h.mu.Unlock()

			// Bootstrap: on first poll per server, seed the order cache from
			// tmux. Closes the gap when rk-go restarts but tmux survives —
			// connecting clients otherwise see no order until the next POST.
			// Runs after the sessions broadcast so first-poll event order is
			// sessions → session-order → metrics.
			//
			// Errors are retried up to orderBootstrapMaxAttempts before giving
			// up — transient tmux failures (e.g., a momentary timeout) can
			// recover, but a persistent failure won't poll-spam every tick.
			// Bootstrap state is tracked separately from previousOrderJSON so
			// a successful POST (which populates previousOrderJSON via
			// broadcastSessionOrder) cleanly satisfies the "seeded" gate.
			h.mu.RLock()
			_, orderSeeded := h.previousOrderJSON[server]
			attempts := h.orderBootstrapAttempts[server]
			h.mu.RUnlock()
			if !orderSeeded && attempts < orderBootstrapMaxAttempts {
				bootCtx, cancelBoot := context.WithTimeout(context.Background(), 2*time.Second)
				order, oerr := h.orderFetcher.GetSessionOrder(bootCtx, server)
				cancelBoot()
				if oerr != nil {
					slog.Debug("session-order bootstrap (best-effort)", "server", server, "err", oerr, "attempt", attempts+1)
					h.mu.Lock()
					h.orderBootstrapAttempts[server] = attempts + 1
					h.mu.Unlock()
				} else {
					h.broadcastSessionOrder(server, order)
				}
			}

			// Board membership changes are surfaced only via the explicit
			// pin/unpin/reorder handlers (each emits its own board-changed
			// event). In the move-based model a killed pinned window simply
			// drops out of the next ListBoardEntries read — the frontend's
			// refetch on the session-list change picks it up — so there is no
			// eager board-cleanup diff and no first-poll bootstrap broadcast.

			// Real-session disappearance logging (observability only — no
			// behavior change). run-kit audit-logs every session IT kills
			// (board pin-session teardown on unpin, explicit kill-session), but
			// a real user session can vanish OUTSIDE that path — a shell exiting,
			// an external `tmux kill-session`, an OOM kill, or a server collapsing
			// to zero under `exit-empty`. When that happens today the logs go
			// silent, making post-hoc diagnosis impossible (see the `utils`
			// incident). Emit one WARN per disappeared real session so the next
			// occurrence is diagnosable. We exclude pin-session/anchor churn via
			// realSessionNameSet. This does NOT prevent the loss — it records
			// it. Constitution VI PREVENTION (always-on `_rk-ctl` anchor floor +
			// imperative `exit-empty off` on every dialed server) is implemented
			// in change 260602-a1wo-prevent-exit-empty-server-death
			// (tmuxctl.resolveBootstrap / productionDial, tmux.SetExitEmptyOff).
			// This WARN is KEPT as defense-in-depth: it still surfaces losses
			// from paths prevention can't cover — an external `tmux kill-session`,
			// an OOM kill, or a shell exiting a real session.
			currentReal := realSessionNameSet(result)
			h.mu.RLock()
			prevReal, hadPrevReal := h.previousRealSessions[server]
			h.mu.RUnlock()
			if hadPrevReal {
				for _, name := range detectDisappearedSessions(prevReal, currentReal) {
					slog.Warn("real session disappeared between SSE polls (not killed by run-kit's audited path)",
						"server", server, "session", name,
						"remaining", len(currentReal))
				}
			}
			h.mu.Lock()
			h.previousRealSessions[server] = currentReal
			h.mu.Unlock()
		}

		// Reap dead servers collected during the loop. A dead socket has no
		// reason to stay in the poll set ("no socket = no polling") — a
		// reconnecting client re-registers it naturally via addClient (which
		// re-spawns this goroutine when !h.polling). Emit a one-time
		// server-gone event to each dead server's registered clients so the
		// frontend can react immediately, then delete the server from h.clients
		// and ALL per-server maps so no stale state leaks into a future
		// re-registration. All mutation happens here, under a single write
		// lock, AFTER the snapshot iteration above (never mid-range, never
		// across FetchSessions).
		if len(deadServers) > 0 {
			h.mu.Lock()
			goneEvent := []byte("event: server-gone\ndata: {}\n\n")
			for _, server := range deadServers {
				for _, c := range h.clients[server] {
					select {
					case c.ch <- goneEvent:
					default:
					}
				}
				delete(h.clients, server)
				delete(h.cache, server)
				delete(h.previousJSON, server)
				delete(h.previousRealSessions, server)
				delete(h.orderBootstrapAttempts, server)
				delete(h.previousOrderJSON, server)
				delete(perServerGen, server)
				delete(eventDrivenServers, server)
			}
			h.mu.Unlock()
		}

		// Broadcast metrics to all clients (server-independent, every tick)
		if h.metrics != nil {
			snap := h.metrics.Snapshot()
			metricsJSON, err := json.Marshal(snap)
			if err == nil {
				metricsStr := string(metricsJSON)
				metricsEvent := []byte(fmt.Sprintf("event: metrics\ndata: %s\n\n", metricsStr))

				h.mu.Lock()
				h.cachedMetricsJSON = metricsStr
				for _, cs := range h.clients {
					for _, c := range cs {
						select {
						case c.ch <- metricsEvent:
						default:
						}
					}
				}
				h.mu.Unlock()
				dataChanged = true
			}
		}

		// Send heartbeat to all clients periodically to keep connections
		// alive through proxies and detect dead connections early. With
		// the event-driven main loop, heartbeat is wall-clock-based —
		// if no data has been broadcast for sseHeartbeatPeriod, send a
		// heartbeat comment.
		if dataChanged {
			lastDataAt = time.Now()
		} else if time.Since(lastDataAt) >= sseHeartbeatPeriod {
			lastDataAt = time.Now()
			heartbeat := []byte(": heartbeat\n\n")
			h.mu.RLock()
			for _, cs := range h.clients {
				for _, c := range cs {
					select {
					case c.ch <- heartbeat:
					default:
					}
				}
			}
			h.mu.RUnlock()
		}

		// Wait for either:
		//   (a) a tmux control-mode notification for any subscribed server
		//       (subscriber.Wait channel closes — typically sub-ms after a
		//       tmux mutation), OR
		//   (b) the safety-net ticker — guarantees correctness even when
		//       no subscriber is registered (PTY-unavailable case) or when
		//       control-mode is reconnecting.
		h.waitForNext(servers, perServerGen, eventDrivenServers)
	}
}

// waitForNext blocks until either a control-mode notification fires for any
// of the supplied servers OR the safety-net timer elapses. Updates
// perServerGen with each server's current generation so the next pass can
// detect change.
func (h *sseHub) waitForNext(servers []string, perServerGen map[string]int64, eventDrivenServers map[string]bool) {
	timer := time.NewTimer(h.safetyIntervalEffective(servers))
	defer timer.Stop()

	if h.subscriber == nil {
		// No control-mode driver — ticker-only.
		<-timer.C
		return
	}

	// Build one wait channel per server, anchored at the generation we
	// last observed.
	cases := make([]waitCase, 0, len(servers))
	for _, server := range servers {
		after := perServerGen[server]
		ch := h.subscriber.Wait(server, after)
		cases = append(cases, waitCase{server: server, ch: ch})
	}

	winner := selectFirst(cases, timer)
	if winner != "" {
		// A subscriber fired — update its observed generation and mark
		// the server as event-driven so the next iteration invalidates
		// its fetch cache.
		perServerGen[winner] = h.subscriber.Generation(winner)
		eventDrivenServers[winner] = true
	}
	// Even when a subscriber fires, refresh observed generations for the
	// other servers so we don't replay their backlog on the next pass.
	for _, c := range cases {
		if c.server == winner {
			continue
		}
		// Non-blocking peek: only update perServerGen if the wait already
		// closed (i.e., generation advanced during our select).
		select {
		case <-c.ch:
			perServerGen[c.server] = h.subscriber.Generation(c.server)
			eventDrivenServers[c.server] = true
		default:
		}
	}
}

// waitCase is a small (server, channel) pair used by selectFirst to
// determine which server's wait fired first. We avoid reflect.Select by
// fan-in: each channel sends its server name to a unifying channel.
type waitCase struct {
	server string
	ch     <-chan struct{}
}

// selectFirst blocks until either one of the wait channels closes OR the
// safety-net timer fires. Returns the server name whose channel fired (or
// the empty string when the timer wins). Reading timer.C directly in the
// outer select avoids the goroutine leak that occurs when a subscriber
// wins the race and the timer goroutine would otherwise block forever on
// timer.C (Stop does not deliver on C).
func selectFirst(cases []waitCase, timer *time.Timer) string {
	if len(cases) == 0 {
		<-timer.C
		return ""
	}
	out := make(chan string, len(cases))
	stop := make(chan struct{})
	defer close(stop)
	for _, c := range cases {
		go func(c waitCase) {
			select {
			case <-c.ch:
				select {
				case out <- c.server:
				case <-stop:
				}
			case <-stop:
			}
		}(c)
	}
	select {
	case s := <-out:
		return s
	case <-timer.C:
		return ""
	}
}

func (s *Server) handleSSE(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "Streaming not supported", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	// A metrics-only stream (`?metrics=1`) is server-neutral: it wants only the
	// server-independent `event: metrics` broadcast and has no tmux server to
	// poll. Route it to the reserved sentinel key so the poll loop never fetches
	// sessions or reaps it. Any other request resolves its server as usual.
	server := serverFromRequest(r)
	if r.URL.Query().Get("metrics") == "1" {
		server = metricsOnlyServer
	}
	client := &sseClient{
		ch:     make(chan []byte, 32),
		server: server,
	}

	// Lazy-init the hub on first SSE connection
	s.initSSEHub()
	s.sseHub.addClient(client)
	defer s.sseHub.removeClient(client)

	// Lifetime cap
	lifetime := time.NewTimer(maxLifetime)
	defer lifetime.Stop()

	ctx := r.Context()

	for {
		select {
		case <-ctx.Done():
			return
		case <-lifetime.C:
			return
		case data := <-client.ch:
			_, err := w.Write(data)
			if err != nil {
				return
			}
			flusher.Flush()
		}
	}
}
