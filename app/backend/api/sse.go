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

// BoardEntriesFetcher reads the @rk_board entries for a tmux server.
// Injected so tests can stub the tmux dependency for bootstrap and cleanup.
type BoardEntriesFetcher interface {
	ListBoardEntries(ctx context.Context, server string) ([]tmux.BoardEntry, error)
	RemoveAllByWindowID(ctx context.Context, server, windowID string) ([]string, error)
}

type prodBoardEntriesFetcher struct{}

func (prodBoardEntriesFetcher) ListBoardEntries(ctx context.Context, server string) ([]tmux.BoardEntry, error) {
	return tmux.ListBoardEntries(ctx, server)
}

func (prodBoardEntriesFetcher) RemoveAllByWindowID(ctx context.Context, server, windowID string) ([]string, error) {
	return tmux.RemoveAllByWindowID(ctx, server, windowID)
}

// boardEventName is the SSE event type for board-membership changes. Matches
// the kebab-case convention established by `event: session-order`.
const boardEventName = "board-changed"

// boardChangedPayload is the body of `event: board-changed` for pin/unpin/
// reorder/cleanup mutations.
type boardChangedPayload struct {
	Board    string `json:"board"`
	Change   string `json:"change"` // "pin" | "unpin" | "reorder" | "cleanup" | "bootstrap"
	Server   string `json:"server"`
	WindowID string `json:"windowId,omitempty"`
	OrderKey string `json:"orderKey,omitempty"`
}

// boardBootstrapPayload is the body of the synthetic bootstrap event sent on
// first poll per server. Carries the full entries snapshot so the frontend
// can rehydrate.
type boardBootstrapPayload struct {
	Server  string             `json:"server"`
	Change  string             `json:"change"` // always "bootstrap"
	Entries []tmux.BoardEntry  `json:"entries"`
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
	mu                       sync.RWMutex
	clients                  map[string][]*sseClient
	previousJSON             map[string]string        // per-server sessions JSON dedup cache
	previousOrderJSON        map[string]string        // per-server session-order event payload cache (only present when populated by a successful read or a POST broadcast)
	orderBootstrapAttempts   map[string]int           // per-server count of failed bootstrap attempts; capped at orderBootstrapMaxAttempts
	previousBoardJSON        map[string]string        // per-server board bootstrap snapshot payload cache
	previousWindowIDs        map[string]map[string]bool // per-server prior-tick live window ids for kill-detection
	previousRealSessions     map[string]map[string]bool // per-server prior-tick real (non-relay/anchor) session names for disappearance logging
	cache                    map[string]*cachedResult // per-server session fetch cache (500ms TTL)
	polling                  bool
	fetcher                  SessionFetcher
	orderFetcher             SessionOrderFetcher
	boardFetcher             BoardEntriesFetcher
	metrics                  *metrics.Collector
	cachedMetricsJSON        string // latest metrics JSON for new clients

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
func (h *sseHub) safetyIntervalEffective(servers []string) time.Duration {
	if h.safetyInterval > 0 {
		return h.safetyInterval
	}
	if h.subscriber == nil {
		return legacyPollInterval
	}
	for _, server := range servers {
		if !h.subscriber.Covers(server) {
			return legacyPollInterval
		}
	}
	return safetyPollInterval
}

// detectKilledWindowIDs is a pure function: it returns the set of window ids
// present in prev but absent in current. Used by the snapshot builder to fan
// out one `board-changed { cleanup }` event per killed window.
func detectKilledWindowIDs(prev, current map[string]bool) []string {
	var killed []string
	for id := range prev {
		if !current[id] {
			killed = append(killed, id)
		}
	}
	return killed
}

func newSSEHub(fetcher SessionFetcher, mc *metrics.Collector) *sseHub {
	return &sseHub{
		clients:                make(map[string][]*sseClient),
		previousJSON:           make(map[string]string),
		previousOrderJSON:      make(map[string]string),
		orderBootstrapAttempts: make(map[string]int),
		previousBoardJSON:      make(map[string]string),
		previousWindowIDs:      make(map[string]map[string]bool),
		previousRealSessions:   make(map[string]map[string]bool),
		cache:                  make(map[string]*cachedResult),
		fetcher:                fetcher,
		orderFetcher:           prodSessionOrderFetcher{},
		boardFetcher:           prodBoardEntriesFetcher{},
		metrics:                mc,
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

	// Send cached board-changed bootstrap snapshot (after session-order, before metrics).
	if prev, ok := h.previousBoardJSON[c.server]; ok && prev != "" {
		select {
		case c.ch <- []byte(fmt.Sprintf("event: %s\ndata: %s\n\n", boardEventName, prev)):
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
// emitted using the shared SSE envelope. No payload caching is performed
// for incremental events — the bootstrap cache covers the snapshot use
// case via previousBoardJSON.
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

// broadcastBoardBootstrap delivers the per-server snapshot of @rk_board
// entries on first poll. Caches the payload under previousBoardJSON so
// future addClient calls receive the same snapshot.
func (h *sseHub) broadcastBoardBootstrap(server string, entries []tmux.BoardEntry) {
	if entries == nil {
		entries = []tmux.BoardEntry{}
	}
	payload := boardBootstrapPayload{
		Server:  server,
		Change:  "bootstrap",
		Entries: entries,
	}
	jsonBytes, err := json.Marshal(payload)
	if err != nil {
		slog.Warn("board-bootstrap broadcast marshal failed", "err", err, "server", server)
		return
	}
	jsonStr := string(jsonBytes)
	event := []byte(fmt.Sprintf("event: %s\ndata: %s\n\n", boardEventName, jsonStr))

	h.mu.Lock()
	defer h.mu.Unlock()
	h.previousBoardJSON[server] = jsonStr
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

// windowIDSetFromSessions extracts the union of window ids across every
// session's windows. Used for window-kill detection between poll ticks.
func windowIDSetFromSessions(sess []sessions.ProjectSession) map[string]bool {
	out := make(map[string]bool)
	for _, s := range sess {
		for _, w := range s.Windows {
			if w.WindowID != "" {
				out[w.WindowID] = true
			}
		}
	}
	return out
}

// realSessionNameSet returns the set of *user-facing* session names in the
// snapshot — excluding the per-connection relay ephemerals (rk-relay-*) and the
// control-mode anchor (_rk-ctl), which churn constantly by design and are not
// sessions a user would notice losing. Used to detect when a real session
// disappears between poll ticks (observability for Constitution VI — tmux
// sessions must survive).
func realSessionNameSet(sess []sessions.ProjectSession) map[string]bool {
	out := make(map[string]bool)
	for _, s := range sess {
		if s.Name == "" {
			continue
		}
		if strings.HasPrefix(s.Name, tmux.RelaySessionPrefix) || s.Name == tmux.ControlAnchorSessionName {
			continue
		}
		out[s.Name] = true
	}
	return out
}

// detectDisappearedSessions returns names present in prev but absent in
// current. Pure; mirrors detectKilledWindowIDs.
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

		// Poll each server and broadcast to its clients
		dataChanged := false
		for _, server := range servers {
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
					slog.Warn("SSE poll error", "err", err, "server", server)
					continue
				}
				h.cache[server] = &cachedResult{data: result, fetchedAt: time.Now()}
			}

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

			// Board bootstrap on first successful poll for this server.
			h.mu.RLock()
			_, boardSeeded := h.previousBoardJSON[server]
			h.mu.RUnlock()
			if !boardSeeded && h.boardFetcher != nil {
				bootCtx, cancelBoot := context.WithTimeout(context.Background(), 2*time.Second)
				entries, berr := h.boardFetcher.ListBoardEntries(bootCtx, server)
				cancelBoot()
				if berr != nil {
					slog.Debug("board bootstrap (best-effort)", "server", server, "err", berr)
				} else {
					h.broadcastBoardBootstrap(server, entries)
				}
			}

			// Window-kill detection for eager board cleanup. Compute the
			// current window-id set from the freshly fetched session list,
			// diff against the prior snapshot via the pure
			// detectKilledWindowIDs helper, and fan out one
			// board-changed { cleanup } event per affected board.
			currentIDs := windowIDSetFromSessions(result)
			h.mu.RLock()
			prevIDs, hasPrev := h.previousWindowIDs[server]
			h.mu.RUnlock()
			if hasPrev && h.boardFetcher != nil {
				killed := detectKilledWindowIDs(prevIDs, currentIDs)
				for _, prevID := range killed {
					cleanCtx, cancelClean := context.WithTimeout(context.Background(), 2*time.Second)
					boards, cerr := h.boardFetcher.RemoveAllByWindowID(cleanCtx, server, prevID)
					cancelClean()
					if cerr != nil {
						slog.Debug("board cleanup (best-effort)", "server", server, "windowId", prevID, "err", cerr)
						continue
					}
					for _, b := range boards {
						h.broadcastBoardChanged(server, boardChangedPayload{
							Board:    b,
							Change:   "cleanup",
							Server:   server,
							WindowID: prevID,
						})
					}
				}
			}
			h.mu.Lock()
			h.previousWindowIDs[server] = currentIDs
			h.mu.Unlock()

			// Real-session disappearance logging (observability only — no
			// behavior change). run-kit audit-logs every session IT kills
			// (relay ephemerals, explicit kill-session), but a real user
			// session can vanish OUTSIDE that path — a shell exiting, an
			// external `tmux kill-session`, an OOM kill, or a server collapsing
			// to zero under `exit-empty`. When that happens today the logs go
			// silent, making post-hoc diagnosis impossible (see the `utils`
			// incident). Emit one WARN per disappeared real session so the next
			// occurrence is diagnosable. We exclude relay/anchor churn via
			// realSessionNameSet. This does NOT prevent the loss — it records
			// it; Constitution VI prevention (exit-empty off / anchor) is a
			// separate change.
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

	client := &sseClient{
		ch:     make(chan []byte, 32),
		server: serverFromRequest(r),
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
