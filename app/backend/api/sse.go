package api

import (
	"context"
	"encoding/json"
	"log/slog"
	"strings"
	"sync"
	"time"

	"rk/internal/metrics"
	"rk/internal/ports"
	"rk/internal/prstatus"
	"rk/internal/sessions"
	"rk/internal/tmux"
	"rk/internal/updatecheck"
	"rk/internal/validate"
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

// PRStatusSnapshotter supplies the current in-memory PR-status map, keyed by
// canonical PR URL (PR numbers are only unique per repo — see prstatus.Collector).
// Injected into the SSE hub so the poll path can attach live PR status to any
// window with a derived PR via a PURE in-memory read — the hot path makes no
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
// backs the Host host-console home (`/`), which shows host health with zero
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
	// servicesPollInterval is the cadence at which ports.Collector re-reads
	// the host's listening TCP ports (procfs + lsof on Linux, lsof on darwin).
	// Same cadence as metrics — both are host-global broadcasts riding the
	// server-neutral stream — but kept as its own constant so the two can
	// diverge later.
	servicesPollInterval = 2500 * time.Millisecond
	// prStatusPollInterval is the cadence at which prstatus.Collector makes
	// its single batched `gh` call. Deliberately slow (~40 calls/hr vs. the
	// 5000/hr authenticated limit) — the SSE hot path reads the cached
	// snapshot, never gh, so PR-status freshness is decoupled from the SSE
	// cadence. On-demand refresh (POST /api/status/refresh) covers the
	// "I want it now" case.
	prStatusPollInterval = 90 * time.Second
	sseCacheTTL          = 500 * time.Millisecond
	// The SSE-only sseHeartbeatPeriod / maxLifetime constants were retired in
	// 260717-vhvz-chat-on-state-socket along with their sole remaining consumer,
	// the chat SSE stream (GET /api/windows/{id}/chat/stream), which moved onto
	// the state socket as a `kind:"chat"` subscription. Both /ws/state and
	// /ws/terminals handle keepalive + liveness at the WebSocket layer.
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

// sseClient is a single per-(connection, server-key) subscription record in the
// hub's routing index (`h.clients[serverKey]`). Since the state-socket migration
// (260716-qf3j) it is no longer a whole client connection — one state-socket
// connection (stateConn) holds one sseClient per subscribed server key (plus one
// for the metrics-only sentinel key), ALL sharing the connection's single send
// channel (`ch`). Per-server events fan out over `h.clients[server]` (these
// records); host-global events fan out over `h.stateConns` (once per connection)
// so a multi-subscription connection never receives a global event twice.
type sseClient struct {
	ch      chan hubEvent
	server  string
	dropped bool
	// conn is a back-pointer to the owning connection, so removeClient can drop
	// the record from its parent's subscription set. nil for the bare test
	// clients that construct an sseClient directly without a stateConn.
	conn *stateConn
	// connID is the client-supplied connection identifier (the `conn` id from the
	// `hello` frame), consistent with the per-connection relay identity model. It
	// is how POST /api/preview-scope (and the in-band preview-scope op) addresses
	// this exact connection. Empty when the client sent no conn id (then its
	// expanded set can never be set — it captures nothing).
	connID string
	// expanded is the set of session names this connection currently has
	// expanded in the tile grid FOR THIS SERVER. Preview capture is bounded to
	// windows in these sessions. In-memory only (Constitution II); dropped on
	// disconnect. Guarded by sseHub.mu.
	expanded map[string]bool
}

// stateConn is one state-socket (`/ws/state`) connection. It owns a single send
// channel shared by all its per-server subscription records, tracks its
// subscriptions for teardown, and is the unit of host-global event fan-out. The
// writer pump in handleStateWS drains `ch`.
type stateConn struct {
	ch     chan hubEvent
	connID string
	// subs maps a subscribed server key (a real server name or the
	// metricsOnlyServer sentinel) to its routing record in h.clients. Guarded by
	// sseHub.mu.
	subs map[string]*sseClient
	// chatProducers maps a chat subscription id (chatSubKey — server\x00windowID)
	// to its live producer. A chat subscription is NOT an h.clients routing record
	// (chat has no tmux-event source, so it must never enter the poll set — R3);
	// it is a dedicated producer goroutine + cancel. Guarded by sseHub.mu.
	// Lazily created on the first chat subscribe.
	chatProducers map[string]*chatProducer
	dropped       bool
}

// maxConnIDLen bounds the client-supplied `conn` query param. A legitimate id
// is a UUID (36 chars); anything longer is rejected so an oversized value can't
// waste memory as a map key. Over-cap ids fall back to empty (capture-nothing).
const maxConnIDLen = 128

// normalizeConnID trims surrounding whitespace from a client-supplied conn id
// and rejects over-long values. Since connID is the lookup key for POST
// /api/preview-scope, an untrimmed or absurdly long value would make the
// connection effectively unaddressable (a scope POST could never match it) and
// waste memory. Invalid input falls back to "" (empty = capture-nothing), the
// same as opening the stream without a conn id.
func normalizeConnID(raw string) string {
	id := strings.TrimSpace(raw)
	if len(id) > maxConnIDLen {
		return ""
	}
	return id
}

// orderBootstrapMaxAttempts caps how many times poll() will try to read
// @rk_session_order from tmux when previous reads errored. Limits the blast
// radius of a hung or misbehaving tmux while still recovering from transient
// failures. After the cap is hit the bootstrap stops attempting; a successful
// POST (which populates previousOrderJSON via broadcast) re-establishes the
// cache without needing the bootstrap.
const orderBootstrapMaxAttempts = 3

type sseHub struct {
	mu sync.RWMutex
	// clients is the per-server routing index: each entry is a subscription
	// record (sseClient) whose channel is its owning connection's shared channel.
	// Per-server events fan out over this map.
	clients map[string][]*sseClient
	// stateConns is the set of live state-socket connections, the unit of
	// host-global event fan-out (once per connection, never once per
	// subscription). A connection is added on hello and dropped on disconnect.
	stateConns             map[*stateConn]bool
	previousJSON           map[string]string            // per-server sessions JSON dedup cache
	previousOrderJSON      map[string]string            // per-server session-order event payload cache (only present when populated by a successful read or a POST broadcast)
	orderBootstrapAttempts map[string]int               // per-server count of failed bootstrap attempts; capped at orderBootstrapMaxAttempts
	previousRealSessions   map[string]map[string]bool   // per-server prior-tick real (non-anchor) session names for disappearance logging
	previousPreviewJSON    map[string]map[string]string // per-server latest {windowId → preview text} snapshot (union of all clients' expanded windows); seeds cached-on-connect delivery
	cache                  map[string]*cachedResult     // per-server session fetch cache (500ms TTL)
	polling                bool
	fetcher                SessionFetcher
	orderFetcher           SessionOrderFetcher
	metrics                *metrics.Collector
	cachedMetricsJSON      string // latest metrics JSON for new clients
	services               *ports.Collector
	cachedServicesJSON     string // latest listening-services JSON for new clients
	// cachedServerOrderJSON is the latest server-global `event: server-order`
	// payload. Unlike previousOrderJSON (per-server @rk_session_order), server
	// rank order is a HOST-global concern, so it is a single slot fanned to
	// EVERY client (incl. the `?metrics=1` metrics-only stream) and replayed on
	// connect — mirroring cachedMetricsJSON / cachedServicesJSON.
	cachedServerOrderJSON string
	// cachedBoardOrderJSON is the latest server-global `event: board-order`
	// payload. Like cachedServerOrderJSON, board display order is a HOST-global
	// concern (a board is an emergent cross-server aggregate), so it is a single
	// slot fanned to EVERY client (incl. the `?metrics=1` metrics-only stream)
	// and replayed on connect — NOT the per-server `board-changed` event.
	cachedBoardOrderJSON string
	// cachedVersionJSON is the server-global `event: version` payload — the
	// running daemon version. It is set ONCE from SetVersion (the version cannot
	// change for the process lifetime), so unlike the order slots there is no
	// broadcast/poll path: it is replayed on connect only, fanned to EVERY client
	// (incl. the `?metrics=1` metrics-only stream) — exactly the moment the client
	// needs it (the reload guard keys off SSE reconnect). Empty until SetVersion.
	cachedVersionJSON string
	// cachedUpdateAvailableJSON is the server-global `event: update-available`
	// payload published whenever the periodic checker's composite key changes.
	// Like the order slots it is a single cached slot fanned to EVERY client
	// (incl. `?metrics=1`) and replayed on connect for late-joining clients,
	// updated via broadcastUpdateAvailable. It holds the LATEST verdict — a
	// populated match OR a CLEARED verdict (empty tools/key) once a match is
	// consumed — so a reconnecting tab never replays a stale consumed match
	// (R8). Empty until the first check changes the key.
	cachedUpdateAvailableJSON string
	// prStatus, when non-nil, supplies the in-memory PR-status snapshot the
	// poll path joins onto change-bound windows. nil degrades gracefully (no
	// PR fields attached) — used by tests and when no collector is wired.
	prStatus PRStatusSnapshotter

	// waitingPush tracks per-window `waiting` episodes and fires one Web Push per
	// sustained-waiting episode from the poll seam (260706-y1ar). In-memory only.
	waitingPush *waitingPushTracker

	// subscriber, when non-nil, provides per-server Wait(after) channels
	// driven by tmux control-mode notifications. When nil, the loop runs
	// on the safety-net ticker only — preserves correctness for tests and
	// for the PTY-unavailable startup case.
	subscriber WindowChangeSubscriber

	// wakeMu guards wakes. It is a dedicated mutex (not h.mu) so wake() can
	// signal from an HTTP handler goroutine without contending on the poll
	// loop's hot RWMutex.
	wakeMu sync.Mutex
	// wakes is the per-server wake-signal index: a CLOSED channel means a
	// wake is pending for that server (an immediate snapshot pass is owed).
	// wake() closes it; waitForNext observes the closed channel and replaces
	// it with a fresh open one on consumption. Close-based (not buffered-token)
	// so it composes with selectFirst's fan-in + the peek loop, which both
	// re-read the same channel and rely on fired-channels-staying-readable
	// (subscriber Wait channels fire by close too). Independent of subscriber,
	// so wakes work when subscriber == nil (unit-test hubs, PTY-unavailable
	// hosts). See wake / wakeChannel / consumeWake.
	wakes map[string]chan struct{}

	// safetyInterval overrides safetyPollInterval per-hub. Zero falls back
	// to the package constant. Tests set this to a short duration so
	// existing time-based assertions remain valid; production callers
	// leave it zero.
	safetyInterval time.Duration

	// captureFn captures a window's pane-text preview. Defaults to the real
	// capturePreviewForWindow (tmux exec); tests override it to exercise the
	// preview-broadcast path without a live tmux server.
	captureFn captureFunc

	// chatResolver resolves a window's reconciled @rk_chat rollup for a chat
	// subscription's producer (260717-vhvz). Injected here (not a *Server
	// back-pointer) so the hub stays decoupled from the HTTP layer — mirroring the
	// captureFn / fetcher injection idiom — and so the producer is unit-testable
	// with a stub. Defaults in newSSEHub to a resolver built from h.fetcher +
	// sessions.ResolveChatPane (the same active-pane-first / else-first-pane rule
	// resolveWindowChat uses). ok=false with a nil error means the window is absent
	// or carries no reconciled chat (a subscribe-time error frame); a non-nil error
	// is a FetchSessions fault (likewise surfaced as an error frame — the GET
	// backfill remains where those show as HTTP statuses).
	chatResolver chatResolveFunc
}

// chatResolveFunc resolves a window's reconciled chat rollup (provider, ref) for
// a tmux server. See sseHub.chatResolver.
type chatResolveFunc func(ctx context.Context, server, windowID string) (provider, ref string, ok bool, err error)

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
// since the Host home holds one open) — needlessly ~5x-ing FetchSessions
// calls for co-attached real servers. Skipping it lets the covered real servers
// keep the long safety interval.
//
// One exception: when the sentinel is the ONLY thing present (the bare `/`
// Host home with zero attached servers), skipping it would fall through to
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
	// Host home. With a real, fully-covered server present, keep the long
	// safety interval.
	if !sawRealServer {
		return legacyPollInterval
	}
	return safetyPollInterval
}

func newSSEHub(fetcher SessionFetcher, mc *metrics.Collector, svc *ports.Collector, pc PRStatusSnapshotter) *sseHub {
	h := &sseHub{
		clients:                make(map[string][]*sseClient),
		stateConns:             make(map[*stateConn]bool),
		previousJSON:           make(map[string]string),
		previousOrderJSON:      make(map[string]string),
		orderBootstrapAttempts: make(map[string]int),
		previousRealSessions:   make(map[string]map[string]bool),
		previousPreviewJSON:    make(map[string]map[string]string),
		cache:                  make(map[string]*cachedResult),
		wakes:                  make(map[string]chan struct{}),
		fetcher:                fetcher,
		orderFetcher:           prodSessionOrderFetcher{},
		metrics:                mc,
		services:               svc,
		prStatus:               pc,
		waitingPush:            newWaitingPushTracker(),
		captureFn:              capturePreviewForWindow,
	}
	// Default chat resolver: fetch the server's sessions and roll up the window's
	// reconciled @rk_chat via the shared active-pane-first rule (identical to
	// resolveWindowChat, minus the paneID the chat read path does not need).
	h.chatResolver = func(ctx context.Context, server, windowID string) (string, string, bool, error) {
		sess, err := h.fetcher.FetchSessions(ctx, server)
		if err != nil {
			return "", "", false, err
		}
		for si := range sess {
			for wi := range sess[si].Windows {
				w := &sess[si].Windows[wi]
				if w.WindowID == windowID {
					provider, ref, _ := sessions.ResolveChatPane(w.Panes)
					if provider == "" {
						return "", "", false, nil
					}
					return provider, ref, true, nil
				}
			}
		}
		return "", "", false, nil
	}
	return h
}

// addClient registers a per-server subscription record and delivers the cached
// PER-SERVER slots (sessions, session-order, preview) immediately. Host-global
// slots are NOT sent here — a state-socket connection replays them once at hello
// via replayGlobalSlots, so sending them per-subscription would duplicate them
// on a multi-server connection. The metricsOnlyServer sentinel key carries no
// per-server cache, so for it this is a no-op beyond starting the poll loop.
func (h *sseHub) addClient(c *sseClient) {
	h.mu.Lock()
	defer h.mu.Unlock()

	h.clients[c.server] = append(h.clients[c.server], c)

	// Send cached session snapshot immediately
	if prev, ok := h.previousJSON[c.server]; ok && prev != "" {
		h.sendLocked(c, hubEvent{kind: kindServer, typ: "sessions", key: c.server, data: prev})
	}

	// Send cached session-order snapshot immediately (after sessions)
	if prev, ok := h.previousOrderJSON[c.server]; ok && prev != "" {
		h.sendLocked(c, hubEvent{kind: kindServer, typ: "session-order", key: c.server, data: prev})
	}

	// Send cached preview snapshot immediately, filtered to this connection's
	// expanded windows for this server. A brand-new subscription has nothing
	// expanded yet, so this is a no-op until its scope declaration lands.
	h.sendCachedPreviewLocked(c)

	if !h.polling {
		h.polling = true
		go h.poll()
	}
}

// removeClient unregisters a per-server subscription record from the routing
// index (and from its owning connection's subscription set, if any).
func (h *sseHub) removeClient(c *sseClient) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.removeClientLocked(c)
}

// removeClientLocked is removeClient's body; caller MUST hold h.mu (write).
func (h *sseHub) removeClientLocked(c *sseClient) {
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
	if c.conn != nil {
		delete(c.conn.subs, c.server)
	}
}

// sendLocked delivers a hubEvent to one subscription record, best-effort with
// the same drop-logging semantics as the broadcast helpers. Caller MUST hold
// h.mu (write).
func (h *sseHub) sendLocked(c *sseClient, ev hubEvent) {
	select {
	case c.ch <- ev:
		c.dropped = false
	default:
		if !c.dropped {
			slog.Warn("state event dropped", "server", c.server, "event", ev.typ)
			c.dropped = true
		}
	}
}

// replayGlobalSlots sends the cached host-global slots to a state-socket
// connection ONCE, right after hello. This is the state-socket counterpart of
// the per-connect global delivery the old SSE addClient performed. Ordering
// mirrors the historical order (metrics → services → server-order → board-order
// → version → update-available); each is skipped when its slot is empty.
func (h *sseHub) replayGlobalSlots(sc *stateConn) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.cachedMetricsJSON != "" {
		h.sendConnLocked(sc, hubEvent{kind: kindGlobal, typ: "metrics", data: h.cachedMetricsJSON})
	}
	if h.cachedServicesJSON != "" {
		h.sendConnLocked(sc, hubEvent{kind: kindGlobal, typ: "services", data: h.cachedServicesJSON})
	}
	if h.cachedServerOrderJSON != "" {
		h.sendConnLocked(sc, hubEvent{kind: kindGlobal, typ: "server-order", data: h.cachedServerOrderJSON})
	}
	if h.cachedBoardOrderJSON != "" {
		h.sendConnLocked(sc, hubEvent{kind: kindGlobal, typ: "board-order", data: h.cachedBoardOrderJSON})
	}
	if h.cachedVersionJSON != "" {
		h.sendConnLocked(sc, hubEvent{kind: kindGlobal, typ: "version", data: h.cachedVersionJSON})
	}
	if h.cachedUpdateAvailableJSON != "" {
		h.sendConnLocked(sc, hubEvent{kind: kindGlobal, typ: "update-available", data: h.cachedUpdateAvailableJSON})
	}
	h.stateConns[sc] = true
}

// emitError delivers a state-socket `error` frame to a connection, echoing the
// offending op's req. The frame rides the connection's send channel as a
// pre-rendered raw hubEvent so ONLY the writer pump ever writes to the socket
// (gorilla forbids concurrent writes). Takes h.mu itself. Best-effort.
func (h *sseHub) emitError(sc *stateConn, req int64, message string) {
	b, err := json.Marshal(errorFrame{Op: "error", Req: req, Message: message})
	if err != nil {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	h.sendConnLocked(sc, hubEvent{raw: b})
}

// sendConnLocked delivers a hubEvent to a whole connection (host-global fan-out
// unit). Best-effort. Caller MUST hold h.mu (write).
func (h *sseHub) sendConnLocked(sc *stateConn, ev hubEvent) {
	h.sendConnLockedOK(sc, ev)
}

// sendConnLockedOK is sendConnLocked returning whether the event was enqueued
// (false ⇒ the connection's channel was full and the event was DROPPED). Chat
// uses the return so a dropped incremental frame can be recovered with a one-shot
// `chat-reset` (a dropped `chat`/`chat-state` is a permanently missing message
// otherwise). Caller MUST hold h.mu (write).
func (h *sseHub) sendConnLockedOK(sc *stateConn, ev hubEvent) bool {
	select {
	case sc.ch <- ev:
		sc.dropped = false
		return true
	default:
		if !sc.dropped {
			slog.Warn("state event dropped (conn)", "event", ev.typ)
			sc.dropped = true
		}
		return false
	}
}

// stateSubscribe registers a subscription for a state-socket connection and
// acks it with the current snapshot. A `server` kind enters the poll set and
// carries the sessions snapshot; a `metrics` kind registers under the
// metrics-only sentinel and carries the cached metrics snapshot.
func (h *sseHub) stateSubscribe(sc *stateConn, msg clientMsg) {
	var key string
	switch msg.Kind {
	case kindServer:
		// The key flows into the poll set and reaches tmux subprocesses (tmux -L
		// <key> via serverArgs), so it MUST pass the same validation barrier the
		// retired SSE edge had via serverFromRequest (Constitution §I). An invalid
		// name is rejected with an error frame carrying the offending req rather
		// than silently dropped, so the client can surface the failure.
		if err := validate.ValidateServerName(msg.Key); err != "" {
			h.emitError(sc, msg.Req, err)
			return
		}
		key = msg.Key
	case kindMetrics:
		key = metricsOnlyServer
	case kindChat:
		// Chat is a per-window subscription with a dedicated producer goroutine —
		// it does NOT enter the poll set / h.clients (transcript appends generate
		// no tmux events). Delegate to its own subscribe path (validates key +
		// server, resolves the chat, acks with the tail offset — no snapshot).
		h.startChatSubscribe(sc, msg)
		return
	default:
		h.emitError(sc, msg.Req, "unknown subscribe kind: "+msg.Kind)
		return
	}

	h.mu.Lock()
	// Ensure the connection is in the host-global fan-out set (defensive — the
	// handler already adds it via replayGlobalSlots at hello, but a subscribe
	// must never leave a connection unable to receive global events).
	h.stateConns[sc] = true
	// Idempotent: a repeat subscribe re-acks with a fresh snapshot but does not
	// create a second routing record.
	rec, exists := sc.subs[key]
	if !exists {
		rec = &sseClient{ch: sc.ch, server: key, conn: sc, connID: sc.connID, expanded: map[string]bool{}}
		sc.subs[key] = rec
	}
	h.mu.Unlock()

	if !exists {
		// addClient takes the lock itself and starts the poll loop; it also
		// delivers the per-server cached slots (sessions/order/preview) for a
		// server subscription.
		h.addClient(rec)
	}

	// Read the ack snapshot and enqueue the ack in ONE critical section. Reading
	// under an EARLIER lock than the enqueue (as this once did) opened a race: a
	// poll tick interleaving after the read but before the ack could update
	// previousJSON and enqueue a NEWER `sessions` event ahead of the stale-
	// snapshot ack, and the client (which applies the ack's snapshot
	// unconditionally) would then overwrite the fresh sessions with the stale
	// one — and the hub's previousJSON dedup would suppress re-emission,
	// stranding stale UI on a quiet server. Reading the snapshot in the same
	// critical section that enqueues the ack guarantees the ack's snapshot is ≥
	// every `sessions`/`metrics` event already on this connection's channel
	// (registration via addClient above means any concurrent poll tick either
	// finished before this lock — so the read sees its value — or runs after the
	// ack, in which case the client's newest-wins apply is correct).
	h.mu.Lock()
	var snapshot string
	if msg.Kind == kindServer {
		snapshot = h.previousJSON[key]
	} else {
		snapshot = h.cachedMetricsJSON
	}
	// Ack with the snapshot (empty snapshot → null, which the client tolerates).
	ack := ackFrame{Op: "ack", Req: msg.Req}
	if snapshot != "" {
		ack.Snapshot = json.RawMessage(snapshot)
	} else {
		ack.Snapshot = json.RawMessage("null")
	}
	ackBytes, err := json.Marshal(ack)
	if err != nil {
		h.mu.Unlock()
		return
	}
	// Deliver the ack over the same channel as a pre-rendered raw frame so it is
	// ordered with the subscription's events.
	h.sendConnLocked(sc, hubEvent{raw: ackBytes})
	h.mu.Unlock()
}

// stateUnsubscribe drops a subscription. A server left with no subscribers
// leaves the poll set on the next idle tick (its record removal empties
// h.clients[server]).
func (h *sseHub) stateUnsubscribe(sc *stateConn, msg clientMsg) {
	var key string
	switch msg.Kind {
	case kindServer:
		// Validate for the same reason as stateSubscribe: an unsubscribe key is a
		// map lookup only (never reaches a subprocess), but rejecting an invalid
		// name keeps the barrier uniform and can never match a legitimately-keyed
		// subscription anyway.
		if err := validate.ValidateServerName(msg.Key); err != "" {
			h.emitError(sc, msg.Req, err)
			return
		}
		key = msg.Key
	case kindMetrics:
		key = metricsOnlyServer
	case kindChat:
		// Chat unsubscribe cancels its producer goroutine (validates key + server).
		h.stopChatSubscribe(sc, msg)
		return
	default:
		h.emitError(sc, msg.Req, "unknown unsubscribe kind: "+msg.Kind)
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	if rec, ok := sc.subs[key]; ok {
		h.removeClientLocked(rec)
	}
}

// dropStateConn tears down a whole state-socket connection: unregister every
// per-server subscription record, cancel every chat producer, and remove the
// connection from the global fan-out set. Chat producers are cancelled AFTER the
// lock is released — cancel() is cheap but must not run under h.mu (a producer's
// emit takes h.mu), and a producer that observes ctx.Done() exits on its own.
func (h *sseHub) dropStateConn(sc *stateConn) {
	h.mu.Lock()
	for _, rec := range sc.subs {
		h.removeClientLocked(rec)
	}
	sc.subs = map[string]*sseClient{}
	producers := dropChatProducersLocked(sc)
	delete(h.stateConns, sc)
	h.mu.Unlock()
	for _, p := range producers {
		p.cancel()
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

	h.mu.Lock()
	defer h.mu.Unlock()
	h.previousOrderJSON[server] = jsonStr
	for _, c := range h.clients[server] {
		h.sendLocked(c, hubEvent{kind: kindServer, typ: "session-order", key: server, data: jsonStr})
	}
}

// broadcastServerOrder pushes a server-global `event: server-order` to EVERY
// connected client across every server key (including the `?metrics=1`
// metrics-only stream) and caches the payload so future clients receive it on
// connect. Server rank order is a HOST-global concern — a client viewing one
// server (or none, on the Host) still needs to re-sort its server list — so
// this fans out to all clients like the metrics/services broadcasts, NOT to a
// single server's clients like broadcastSessionOrder.
//
// nil order is normalized to an empty slice so the cached JSON is always "[]"
// rather than "null".
func (h *sseHub) broadcastServerOrder(order []string) {
	if order == nil {
		order = []string{}
	}
	payload := struct {
		Order []string `json:"order"`
	}{Order: order}
	jsonBytes, err := json.Marshal(payload)
	if err != nil {
		slog.Warn("server-order broadcast marshal failed", "err", err)
		return
	}
	jsonStr := string(jsonBytes)

	h.mu.Lock()
	defer h.mu.Unlock()
	h.cachedServerOrderJSON = jsonStr
	h.broadcastGlobalLocked(hubEvent{kind: kindGlobal, typ: "server-order", data: jsonStr})
}

// broadcastBoardOrder pushes a server-global `event: board-order` to EVERY
// connected client across every server key (including the `?metrics=1`
// metrics-only stream) and caches the payload so future clients receive it on
// connect. Board display order is a HOST-global concern — a board is an
// emergent cross-server aggregate with no owning tmux server — so this fans out
// to all clients like broadcastServerOrder, NOT to one server's clients like
// broadcastBoardChanged.
//
// nil order is normalized to an empty slice so the cached JSON is always "[]"
// rather than "null".
func (h *sseHub) broadcastBoardOrder(order []string) {
	if order == nil {
		order = []string{}
	}
	payload := struct {
		Order []string `json:"order"`
	}{Order: order}
	jsonBytes, err := json.Marshal(payload)
	if err != nil {
		slog.Warn("board-order broadcast marshal failed", "err", err)
		return
	}
	jsonStr := string(jsonBytes)

	h.mu.Lock()
	defer h.mu.Unlock()
	h.cachedBoardOrderJSON = jsonStr
	h.broadcastGlobalLocked(hubEvent{kind: kindGlobal, typ: "board-order", data: jsonStr})
}

// setVersion seeds the server-global `event: version` cached slot with the
// running daemon version, a per-process boot identity, and the brew-install
// flag. Called once at startup via Server.SetVersion. The version cannot change
// for the process lifetime, so there is deliberately NO broadcast to
// already-connected clients here — the slot is delivered purely on connect
// (addClient), which is exactly when the client needs it. An empty version is
// ignored (leaves the slot empty → no `event: version` sent).
//
// `boot` and `brew` are ADDITIVE fields — older clients that parse only
// `version` are unaffected. `boot` is a per-process id (regenerated on every
// daemon start) that lets a tab detect a same-version restart and reload; `brew`
// gates the palette's force-update / restart maintenance entries client-side.
func (h *sseHub) setVersion(version, boot string, brew bool) {
	if version == "" {
		return
	}
	payload := struct {
		Version string `json:"version"`
		Boot    string `json:"boot"`
		Brew    bool   `json:"brew"`
	}{Version: version, Boot: boot, Brew: brew}
	jsonBytes, err := json.Marshal(payload)
	if err != nil {
		slog.Warn("version slot marshal failed", "err", err)
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	h.cachedVersionJSON = string(jsonBytes)
}

// updateAvailableTool is one tool in the `update-available` payload — the FULL
// per-tool verdict (every tool with a pending update, including sub-threshold
// rows), not just the notable/matched set, so the client can filter either
// check view (default = notable only; incl.-patches = all updateAvailable).
type updateAvailableTool struct {
	Tool    string `json:"tool"`
	Current string `json:"current"`
	Latest  string `json:"latest"`
	// UpdateAvailable reports installed < latest.
	UpdateAvailable bool `json:"updateAvailable"`
	// Notable reports the bump crosses the tool's notify threshold — the set
	// that lights the chip and composes the dismissal key.
	Notable bool `json:"notable"`
}

// updateAvailablePayload is the JSON body shared by the SSE `update-available`
// slot and the POST /api/updates/check response. ONE builder
// (buildUpdateAvailablePayload) serves both surfaces so their shapes can never
// drift.
type updateAvailablePayload struct {
	Tools []updateAvailableTool `json:"tools"`
	// Key is the composite dismissal key derived from the NOTABLE set only.
	Key string `json:"key"`
	// Current/Latest are the legacy run-kit-row fields, retained for
	// transitional compat (populated only when run-kit is in the notable set).
	Current string `json:"current"`
	Latest  string `json:"latest"`
}

// buildUpdateAvailablePayload maps a checker verdict onto the wire payload.
func buildUpdateAvailablePayload(verdict updatecheck.Result) updateAvailablePayload {
	tools := make([]updateAvailableTool, 0, len(verdict.Tools))
	for _, v := range verdict.Tools {
		tools = append(tools, updateAvailableTool{
			Tool:            v.Tool,
			Current:         v.Installed,
			Latest:          v.Latest,
			UpdateAvailable: v.UpdateAvailable,
			Notable:         v.Notable,
		})
	}
	return updateAvailablePayload{Tools: tools, Key: verdict.Key, Current: verdict.Current, Latest: verdict.Latest}
}

// broadcastUpdateAvailable pushes a server-global `event: update-available` to
// EVERY connected client across every server key (including the `?metrics=1`
// metrics-only stream) and caches the payload so future clients receive it on
// connect. A pending update is a HOST-global concern (the daemon is one process
// regardless of how many tmux servers a client views), so this fans out to all
// clients like broadcastServerOrder/broadcastBoardOrder, NOT to one server's
// clients. Invoked from the updatecheck OnQualify callback wired in serve.go.
//
// The payload carries the FULL per-tool verdict list (updateAvailable +
// notable per tool — see buildUpdateAvailablePayload) plus the composite
// dismissal key derived from the notable set. The legacy top-level
// `current`/`latest` are populated from the run-kit row when run-kit is in the
// notable set (else empty) so a not-yet-reloaded frontend keying off a
// non-empty `latest` degrades to run-kit-only display.
//
// A CLEARED verdict (empty Matched, empty Key — fired by the checker per R7 when
// a match is consumed) is NOT skipped: it is marshalled, broadcast, and REPLACES
// the cached slot exactly like a populated verdict, so a tab connecting after a
// consumed-match clear replays the cleared state (empty tools/key) rather than a
// stale match (R8). replayGlobalSlots still replays the slot on connect —
// nothing special-cases the empty payload there either.
func (h *sseHub) broadcastUpdateAvailable(verdict updatecheck.Result) {
	jsonBytes, err := json.Marshal(buildUpdateAvailablePayload(verdict))
	if err != nil {
		slog.Warn("update-available broadcast marshal failed", "err", err)
		return
	}
	jsonStr := string(jsonBytes)

	h.mu.Lock()
	defer h.mu.Unlock()
	h.cachedUpdateAvailableJSON = jsonStr
	h.broadcastGlobalLocked(hubEvent{kind: kindGlobal, typ: "update-available", data: jsonStr})
}

// broadcastStatusRefresh pushes a server-global `event: status-refresh` to EVERY
// connected client across every server key (including the `?metrics=1`
// metrics-only stream). It is emitted from finishStatusRefresh() at the end of
// the detached POST /api/status/refresh pass, signalling "the forced refresh
// completed — you're current" so the PANE-header refresh button can clear its
// spinner (which spins click→event, not click→POST). A manual refresh is a
// HOST-global concern (both PR pollers are process-wide, not per-`?server=`), so
// this fans out to all clients like broadcastServerOrder/broadcastUpdateAvailable,
// NOT to one server's clients like broadcastBoardChanged.
//
// Broadcast-only: unlike server-order/board-order/update-available there is NO
// cached slot and NO replay-on-connect. Freshness for a late-connecting client
// is surfaced independently by the StatusDotTip's "checked Xs ago" line
// (PrFetchedAt), so a missed completion pulse loses nothing.
func (h *sseHub) broadcastStatusRefresh(completedAt time.Time) {
	payload := struct {
		CompletedAt string `json:"completedAt"`
	}{CompletedAt: completedAt.UTC().Format(time.RFC3339)}
	jsonBytes, err := json.Marshal(payload)
	if err != nil {
		slog.Warn("status-refresh broadcast marshal failed", "err", err)
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	h.broadcastGlobalLocked(hubEvent{kind: kindGlobal, typ: "status-refresh", data: string(jsonBytes)})
}

// broadcastGlobalLocked fans a host-global event out to every live state-socket
// connection exactly once (never once per subscription, which would duplicate a
// global event on a multi-server connection). Caller MUST hold h.mu (write).
func (h *sseHub) broadcastGlobalLocked(ev hubEvent) {
	for sc := range h.stateConns {
		h.sendConnLocked(sc, ev)
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
	h.mu.Lock()
	defer h.mu.Unlock()
	for _, c := range h.clients[server] {
		h.sendLocked(c, hubEvent{kind: kindServer, typ: boardEventName, key: server, data: string(jsonBytes)})
	}
}

// setPreviewScope replaces the expanded-session set for the connection on the
// given server whose connID matches. A miss (no live connection with that id)
// is a silent no-op — the connection may have disconnected between the client's
// last SSE read and this POST. In-memory only (Constitution II); the set is
// dropped when the connection is removed (removeClient drops the whole client).
func (h *sseHub) setPreviewScope(server, connID string, expanded []string) {
	if connID == "" {
		return
	}
	set := make(map[string]bool, len(expanded))
	for _, s := range expanded {
		if s != "" {
			set[s] = true
		}
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	for _, c := range h.clients[server] {
		if c.connID == connID {
			c.expanded = set
			// Emit the cached preview subset immediately so a just-expanded
			// tile is not blank until the next poll tick (R7 intent). No-op
			// when the new set is empty or no preview is cached yet.
			h.sendCachedPreviewLocked(c)
			return
		}
	}
}

// sendCachedPreviewLocked delivers the cached preview subset for the client's
// current expanded set over `event: preview`. Caller MUST hold h.mu (write —
// it reads shared maps and writes to the client channel). Best-effort: a full
// client channel drops the event silently (the next poll tick retries).
func (h *sseHub) sendCachedPreviewLocked(c *sseClient) {
	full := h.previousPreviewJSON[c.server]
	if len(full) == 0 || len(c.expanded) == 0 {
		return
	}
	var byWindow map[string][]string
	if cached, ok := h.cache[c.server]; ok {
		byWindow = windowsBySession(cached.data)
	} else {
		return
	}
	subset := previewSubsetFor(c, full, byWindow)
	if subset == nil {
		return
	}
	payload, err := json.Marshal(subset)
	if err != nil {
		return
	}
	h.sendLocked(c, hubEvent{kind: kindServer, typ: "preview", key: c.server, data: string(payload)})
}

// expandedUnionLocked returns the union of expanded session names across every
// client on the given server. Caller MUST hold h.mu (read or write).
func expandedUnionLocked(clients []*sseClient) map[string]bool {
	union := map[string]bool{}
	for _, c := range clients {
		for name := range c.expanded {
			union[name] = true
		}
	}
	return union
}

// capturePreviews captures pane-text previews for every window belonging to a
// session in the expanded union, deduped by window ID (a window is captured
// once per tick regardless of how many clients expanded its session). Returns
// a {windowId → text} map. Runs the tmux captures WITHOUT the hub lock held —
// each CapturePane is an exec with its own timeout (Constitution I). Returns an
// empty map when the union is empty (capture-nothing default).
func capturePreviews(sess []sessions.ProjectSession, union map[string]bool, server string, capture captureFunc) map[string]string {
	previews := map[string]string{}
	if len(union) == 0 {
		return previews
	}
	for si := range sess {
		if !union[sess[si].Name] {
			continue
		}
		for wi := range sess[si].Windows {
			w := sess[si].Windows[wi]
			if _, done := previews[w.WindowID]; done {
				continue
			}
			if text, ok := capture(w, server); ok {
				previews[w.WindowID] = text
			}
		}
	}
	return previews
}

// captureFunc captures one window's pane-text preview on a server. Production
// uses capturePreviewForWindow (a real tmux exec); tests inject a stub so the
// preview-broadcast path is exercisable without a live tmux server.
type captureFunc func(w tmux.WindowInfo, server string) (string, bool)

// windowsBySession maps each session name to its window IDs, used to filter the
// server-wide preview union down to a single connection's expanded windows.
func windowsBySession(sess []sessions.ProjectSession) map[string][]string {
	m := make(map[string][]string, len(sess))
	for si := range sess {
		ids := make([]string, 0, len(sess[si].Windows))
		for wi := range sess[si].Windows {
			ids = append(ids, sess[si].Windows[wi].WindowID)
		}
		m[sess[si].Name] = ids
	}
	return m
}

// previewSubsetFor returns the {windowId → text} subset of the server-wide
// preview map that covers the windows in the client's expanded sessions.
// Returns nil when the client has nothing expanded (nothing to send).
func previewSubsetFor(c *sseClient, full map[string]string, byWindow map[string][]string) map[string]string {
	if len(c.expanded) == 0 || len(full) == 0 {
		return nil
	}
	subset := map[string]string{}
	for name := range c.expanded {
		for _, wid := range byWindow[name] {
			if text, ok := full[wid]; ok {
				subset[wid] = text
			}
		}
	}
	if len(subset) == 0 {
		return nil
	}
	return subset
}

// attachPRStatus joins live PR status onto any window with a derived PR from the
// in-memory collector snapshot. It is a PURE read of prStatus.Snapshot() — NO
// network/gh call — preserving the SSE hot path's zero-network-call guarantee.
//
// Gate: status is attached to any window that has a non-empty PrURL (nil and ""
// both fail the gate). PrURL is now derived from the pane's branch server-side —
// internal/sessions.enrichWindowPR REGISTERS the (repo, branch) pair and JOINS
// the last-good PR from internal/prstatus.BranchRefresher's in-memory snapshot,
// while the actual `gh pr list` runs off-tick on that refresher's background
// goroutine — so a PR appears for ANY pane on a branch with a PR (open, merged,
// or closed), not only fab-change-bound windows (the FabChange gate was removed
// in 260705-dmex), with zero gh subprocesses on this hot path. The join is by
// canonical PR URL, never by bare PR number — numbers are only unique per repo,
// so a number join can pick up an unrelated repo's PR state.
//
// PrChecks/PrReview/PrIsDraft are collector-only, so they are always reset first
// and re-attached solely on a snapshot hit. PrState is DUAL-SOURCED: the
// viewer-wide collector is authoritative on a URL-hit, but enrichWindowPR has
// already seeded a branch-derived fallback (MapBranchState) into PrState, so a
// collector MISS must PRESERVE that fallback rather than wipe it to "" — a
// branch-derived closed PR outside the viewer's top-$limit window would
// otherwise carry prNumber set + prState "" and prOwnsDot would paint a dead
// PR's dot solid. The fallback is refreshed by enrichWindowPR every FetchSessions
// (500ms cache TTL), so preserving it on a cache-hit re-run of this idempotent
// pass cannot strand a stale value for longer than one cache generation.
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
			// Reset collector-only fields so stale values never linger. PrState
			// is left intact: it holds enrichWindowPR's branch fallback and is
			// overridden below only on a collector hit. PrFetchedAt is
			// collector-join-owned like PrChecks/PrReview/PrIsDraft, so it resets
			// to nil here and is re-attached solely on a snapshot hit — a URL-miss
			// window carries no stale freshness timestamp.
			w.PrChecks, w.PrReview, w.PrIsDraft, w.PrFetchedAt = "", "", false, nil
			if w.PrURL == nil || *w.PrURL == "" {
				continue
			}
			if st, ok := snap[*w.PrURL]; ok {
				w.PrState = st.State
				w.PrChecks = st.Checks
				w.PrReview = st.ReviewDecision
				w.PrIsDraft = st.IsDraft
				// st is a value copy scoped to this block, so taking its address
				// yields a stable pointer independent of the loop/snapshot.
				fetchedAt := st.FetchedAt
				w.PrFetchedAt = &fetchedAt
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
		var deadServers []string
		// Accumulate the live (server, windowID) keys across all polled servers
		// so the waiting-push tracker can reap episodes for windows that vanished
		// (retain, after the loop). polledServers records which servers were
		// SUCCESSFULLY fetched this tick — the retain sweep is scoped to these so a
		// server whose fetch failed transiently (contributing zero live keys) does
		// not have its still-waiting episodes wrongly reaped/re-armed.
		liveWaitingKeys := map[string]bool{}
		polledServers := map[string]bool{}
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

			// Attach live PR status to any window with a derived PR. PURE
			// in-memory read of the collector snapshot — the hot path makes NO
			// network/gh call. All gh cost lives on background ticks: the
			// viewer-wide collector's 90s tick (state/checks/review) + on-demand
			// POST, and the branch→PR refresher's tick (PrURL/PrNumber, derived
			// upstream in FetchSessions via register + snapshot-join, also
			// network-free here). NOTE: `result` and `h.cache[server].data` are the SAME
			// slice (stored by reference above), so this mutates the cached
			// snapshot in place — that is intentional and safe because
			// attachPRStatus is idempotent: it resets all four PR fields to
			// zero before re-attaching, so re-running it on a cache hit yields
			// the same result and a PR that left the collector snapshot clears
			// cleanly. Re-deriving every tick keeps the cached sessions in sync
			// with the latest PR snapshot without a deep copy.
			h.attachPRStatus(result)

			// This server's fetch succeeded — record it so the post-loop reap only
			// sweeps episodes belonging to servers actually polled this tick.
			polledServers[server] = true

			// Web Push on sustained waiting (260706-y1ar). Ride this per-server
			// tick, where the rolled-up window AgentState already exists: advance
			// the episode tracker (pure, synchronous — no I/O in the hot path) and
			// fan the resulting pushes out in a detached goroutine inside
			// notifyWaiting. Best-effort, in-memory only; push errors never block
			// the tick. Accumulate the live keys for the post-loop reap.
			if h.waitingPush != nil {
				for k := range h.waitingPush.notifyWaiting(server, result) {
					liveWaitingKeys[k] = true
				}
			}

			jsonBytes, err := json.Marshal(result)
			if err != nil {
				continue
			}
			jsonStr := string(jsonBytes)

			h.mu.Lock()
			if jsonStr != h.previousJSON[server] {
				h.previousJSON[server] = jsonStr
				for _, c := range h.clients[server] {
					h.sendLocked(c, hubEvent{kind: kindServer, typ: "sessions", key: server, data: jsonStr})
				}
			}
			h.mu.Unlock()

			// Pane-text previews (tile grid). Bounded to the union of sessions
			// any client on this server has expanded — capture-nothing when the
			// union is empty (opt-in per expansion). Rides this existing poll
			// tick: no new goroutine, no new loop. The tmux captures run OUTSIDE
			// the hub lock (each is an exec with its own timeout), then a
			// re-lock delivers each client a per-connection-filtered subset over
			// a dedicated `event: preview`. The sessions payload above is
			// unchanged — preview text never bloats the sessions dedup cache.
			h.mu.RLock()
			union := expandedUnionLocked(h.clients[server])
			h.mu.RUnlock()
			if len(union) > 0 {
				previews := capturePreviews(result, union, server, h.captureFn)
				byWindow := windowsBySession(result)
				h.mu.Lock()
				h.previousPreviewJSON[server] = previews
				for _, c := range h.clients[server] {
					subset := previewSubsetFor(c, previews, byWindow)
					if subset == nil {
						continue
					}
					if payload, perr := json.Marshal(subset); perr == nil {
						h.sendLocked(c, hubEvent{kind: kindServer, typ: "preview", key: server, data: string(payload)})
					}
				}
				h.mu.Unlock()
			}

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
			// event). Under the link-based model a killed pinned window's pin-session simply
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

		// Reap waiting-push episodes for windows no longer present, so a re-created
		// window id can't inherit a stale "pushed" flag. The sweep is SCOPED to
		// servers whose state we actually observed this tick: the ones successfully
		// polled (polledServers) plus the ones confirmed GONE (deadServers — their
		// windows truly vanished). A server that failed to fetch TRANSIENTLY
		// (non-IsServerGone) is in neither set, so its still-waiting episodes are
		// left untouched — reaping them would reset the run and fire a duplicate
		// push the moment the server recovers.
		if h.waitingPush != nil {
			reapableServers := make(map[string]bool, len(polledServers)+len(deadServers))
			for s := range polledServers {
				reapableServers[s] = true
			}
			for _, s := range deadServers {
				reapableServers[s] = true
			}
			h.waitingPush.retain(liveWaitingKeys, reapableServers)
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
			for _, server := range deadServers {
				for _, c := range h.clients[server] {
					select {
					case c.ch <- hubEvent{gone: true, key: server}:
					default:
					}
					// Detach the subscription from its owning connection so a
					// later re-subscribe re-registers cleanly (no stale record).
					if c.conn != nil {
						delete(c.conn.subs, server)
					}
				}
				delete(h.clients, server)
				delete(h.cache, server)
				delete(h.previousJSON, server)
				delete(h.previousRealSessions, server)
				delete(h.orderBootstrapAttempts, server)
				delete(h.previousOrderJSON, server)
				delete(h.previousPreviewJSON, server)
				delete(perServerGen, server)
				delete(eventDrivenServers, server)
			}
			// h.wakes is guarded by its own wakeMu (not h.mu). Drop each dead
			// server's wake channel so a reaped server leaves no residual entry.
			// Lock order is h.mu → wakeMu; no path takes them the other way
			// (the wake helpers touch only wakeMu), so this cannot deadlock.
			h.wakeMu.Lock()
			for _, server := range deadServers {
				delete(h.wakes, server)
			}
			h.wakeMu.Unlock()
			h.mu.Unlock()
		}

		// Broadcast metrics to every state-socket connection (server-independent,
		// every tick — a host-global event, fanned once per connection).
		if h.metrics != nil {
			snap := h.metrics.Snapshot()
			metricsJSON, err := json.Marshal(snap)
			if err == nil {
				metricsStr := string(metricsJSON)
				h.mu.Lock()
				h.cachedMetricsJSON = metricsStr
				h.broadcastGlobalLocked(hubEvent{kind: kindGlobal, typ: "metrics", data: metricsStr})
				h.mu.Unlock()
			}
		}

		// Broadcast listening services to every state-socket connection
		// (server-independent, every tick) — mirrors the metrics broadcast.
		if h.services != nil {
			snap := h.services.Snapshot()
			servicesJSON, err := json.Marshal(snap)
			if err == nil {
				servicesStr := string(servicesJSON)
				h.mu.Lock()
				h.cachedServicesJSON = servicesStr
				h.broadcastGlobalLocked(hubEvent{kind: kindGlobal, typ: "services", data: servicesStr})
				h.mu.Unlock()
			}
		}

		// Connection liveness on the state socket is handled at the WebSocket
		// layer (failed write on the writer pump, read-loop error), not by an
		// SSE-style comment heartbeat — so there is no per-tick heartbeat frame.
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

// wake marks the server for an immediate snapshot pass. Non-blocking and safe
// from any goroutine; called by the option-mutation handlers after a successful
// tmux write (set-option @color/@session_color/@rk_url/@rk_type is invisible to
// the tmuxctl control-mode parser, so no subscriber notification fires — the
// wake is the freshness driver for these mutations). Per-server, keyed by the
// same server name the poll set uses; a wake for a server with no connected
// clients (not in the poll set) is a harmless no-op (the closed channel is
// simply retired the next time that server is polled, and the entry is deleted
// from h.wakes when the server is reaped from the poll set). Coalescing,
// at-least-once: N wakes before consumption trigger
// 1..N passes; redundant passes are suppressed by the previousJSON dedup.
func (h *sseHub) wake(server string) {
	h.wakeMu.Lock()
	defer h.wakeMu.Unlock()
	ch, ok := h.wakes[server]
	if !ok {
		ch = make(chan struct{})
		h.wakes[server] = ch
	}
	select {
	case <-ch:
		// Already closed — a wake is already pending; coalesce.
	default:
		close(ch)
	}
}

// wakeChannel returns the current wake-signal channel for a server, lazily
// creating an open one if none exists. waitForNext adds the returned channel as
// a wait case. A channel returned here that is ALREADY closed means a wake
// landed before the loop reached waitForNext — it fires immediately, exactly as
// intended (at-least-once). Guarded by wakeMu.
func (h *sseHub) wakeChannel(server string) <-chan struct{} {
	h.wakeMu.Lock()
	defer h.wakeMu.Unlock()
	ch, ok := h.wakes[server]
	if !ok {
		ch = make(chan struct{})
		h.wakes[server] = ch
	}
	return ch
}

// consumeWake retires a server's wake signal if it is currently closed: it
// replaces the closed channel with a fresh open one and reports true. Called
// when waitForNext observes a server's wake channel fired (winner or peek). The
// replacement happens BEFORE the next fetch pass, so a wake landing between
// observation and fetch closes the FRESH channel and triggers one more pass —
// never lost, and never a busy-loop (the closed channel is retired the moment
// it is observed). If the channel is not closed (a spurious call, or a wake that
// was already consumed), it is left in place and consumeWake reports false.
// Guarded by wakeMu.
func (h *sseHub) consumeWake(server string) bool {
	h.wakeMu.Lock()
	defer h.wakeMu.Unlock()
	ch, ok := h.wakes[server]
	if !ok {
		return false
	}
	select {
	case <-ch:
		// Closed — a wake was pending. Retire it with a fresh open channel.
		h.wakes[server] = make(chan struct{})
		return true
	default:
		return false
	}
}

// waitForNext blocks until either a control-mode notification fires for any of
// the supplied servers, a wake is signalled for any of them (via wake()), OR the
// safety-net timer elapses. Updates perServerGen with each server's current
// generation so the next pass can detect change, and marks woken/notified
// servers in eventDrivenServers so poll() invalidates their fetch cache.
//
// Wake cases are built independent of h.subscriber: a wake must wake the loop
// even when subscriber == nil (unit-test hubs, PTY-unavailable hosts), where the
// code previously short-circuited to a timer-only wait. Wake wins do NOT enter
// subscriber bookkeeping (no perServerGen / Generation() touch) — they are
// distinguished from subscriber cases by waitCase.isWake.
func (h *sseHub) waitForNext(servers []string, perServerGen map[string]int64, eventDrivenServers map[string]bool) {
	timer := time.NewTimer(h.safetyIntervalEffective(servers))
	defer timer.Stop()

	// Build wait cases: a subscriber case per server (only when a subscriber is
	// wired), anchored at the generation we last observed, AND a wake case per
	// server (always — independent of the subscriber). selectFirst falls through
	// to the timer when the combined case list is empty.
	cases := make([]waitCase, 0, len(servers)*2)
	for _, server := range servers {
		if h.subscriber != nil {
			after := perServerGen[server]
			cases = append(cases, waitCase{server: server, ch: h.subscriber.Wait(server, after)})
		}
		cases = append(cases, waitCase{server: server, ch: h.wakeChannel(server), isWake: true})
	}

	// selectFirst blocks until one case's channel fires (or the timer wins). It
	// returns only the winning server NAME, not which kind of case fired — and
	// a fired channel stays readable (subscriber Wait fires by close; wake fires
	// by close) — so we don't special-case the winner. Instead, once selectFirst
	// unblocks, a single non-blocking peek over ALL cases picks up every case
	// that has fired (the winner plus any that fired concurrently), routing each
	// by isWake. This is correct even when a server has BOTH a subscriber case
	// and a wake case that fired: each is handled independently in one pass.
	selectFirst(cases, timer)
	for _, c := range cases {
		select {
		case <-c.ch:
			if c.isWake {
				// Only mark event-driven when this call actually retires a
				// pending (closed) wake — consumeWake reports false once the
				// wake has already been retired (e.g. two servers sharing a
				// name cannot happen, but a repeated peek must be idempotent).
				if h.consumeWake(c.server) {
					eventDrivenServers[c.server] = true
				}
			} else {
				perServerGen[c.server] = h.subscriber.Generation(c.server)
				eventDrivenServers[c.server] = true
			}
		default:
		}
	}
}

// waitCase is a small (server, channel) pair used by selectFirst to
// determine which server's wait fired first. We avoid reflect.Select by
// fan-in: each channel sends its server name to a unifying channel. isWake
// distinguishes a wake-signal case (wakeChannel) from a subscriber Wait case:
// wake wins skip subscriber bookkeeping and consume the wake instead.
type waitCase struct {
	server string
	ch     <-chan struct{}
	isWake bool
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

// The former SSE edge (handleSSE + `GET /api/sessions/stream`) was retired in
// 260716-qf3j-state-socket — the frontend was the sole consumer and it now
// speaks the state-socket protocol over `/ws/state` (see state_ws.go). The hub
// machinery above (poll, collectors, broadcast helpers) is unchanged; only the
// client-facing transport moved from SSE to WebSocket.
