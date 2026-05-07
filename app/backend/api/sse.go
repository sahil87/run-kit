package api

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
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
	ssePollInterval    = 2500 * time.Millisecond
	sseCacheTTL        = 500 * time.Millisecond
	sseHeartbeatTicks  = 6 // send heartbeat every 6 ticks (~15s)
	maxLifetime        = 30 * time.Minute
)

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
// PUT (which populates previousOrderJSON via broadcast) re-establishes the
// cache without needing the bootstrap.
const orderBootstrapMaxAttempts = 3

type sseHub struct {
	mu                       sync.RWMutex
	clients                  map[string][]*sseClient
	previousJSON             map[string]string        // per-server sessions JSON dedup cache
	previousOrderJSON        map[string]string        // per-server session-order event payload cache (only present when populated by a successful read or a PUT broadcast)
	orderBootstrapAttempts   map[string]int           // per-server count of failed bootstrap attempts; capped at orderBootstrapMaxAttempts
	previousBoardJSON        map[string]string        // per-server board bootstrap snapshot payload cache
	previousWindowIDs        map[string]map[string]bool // per-server prior-tick live window ids for kill-detection
	cache                    map[string]*cachedResult // per-server session fetch cache (500ms TTL)
	polling                  bool
	fetcher                  SessionFetcher
	orderFetcher             SessionOrderFetcher
	boardFetcher             BoardEntriesFetcher
	metrics                  *metrics.Collector
	cachedMetricsJSON        string // latest metrics JSON for new clients
}

func newSSEHub(fetcher SessionFetcher, mc *metrics.Collector) *sseHub {
	return &sseHub{
		clients:                make(map[string][]*sseClient),
		previousJSON:           make(map[string]string),
		previousOrderJSON:      make(map[string]string),
		orderBootstrapAttempts: make(map[string]int),
		previousBoardJSON:      make(map[string]string),
		previousWindowIDs:      make(map[string]map[string]bool),
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

func (h *sseHub) poll() {
	ticksSinceHeartbeat := 0

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
			// Check session fetch cache (500ms TTL)
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
			// connecting clients otherwise see no order until the next PUT.
			// Runs after the sessions broadcast so first-poll event order is
			// sessions → session-order → metrics.
			//
			// Errors are retried up to orderBootstrapMaxAttempts before giving
			// up — transient tmux failures (e.g., a momentary timeout) can
			// recover, but a persistent failure won't poll-spam every tick.
			// Bootstrap state is tracked separately from previousOrderJSON so
			// a successful PUT (which populates previousOrderJSON via
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
			// current window-id set from the freshly fetched session list.
			currentIDs := windowIDSetFromSessions(result)
			h.mu.RLock()
			prevIDs, hasPrev := h.previousWindowIDs[server]
			h.mu.RUnlock()
			if hasPrev && h.boardFetcher != nil {
				for prevID := range prevIDs {
					if currentIDs[prevID] {
						continue
					}
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
		// alive through proxies and detect dead connections early.
		ticksSinceHeartbeat++
		if dataChanged {
			ticksSinceHeartbeat = 0
		} else if ticksSinceHeartbeat >= sseHeartbeatTicks {
			ticksSinceHeartbeat = 0
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

		time.Sleep(ssePollInterval)
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
