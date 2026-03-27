package api

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"rk/internal/sessions"
)

const (
	ssePollInterval = 2500 * time.Millisecond
	sseCacheTTL     = 500 * time.Millisecond
	maxLifetime     = 30 * time.Minute
)

// cachedResult holds a cached FetchSessions result with a timestamp.
type cachedResult struct {
	data      []sessions.ProjectSession
	fetchedAt time.Time
}

type sseClient struct {
	ch     chan []byte
	server string
}

type sseHub struct {
	mu           sync.RWMutex
	clients      map[*sseClient]struct{}
	previousJSON map[string]string // per-server JSON dedup cache
	cache        map[string]*cachedResult // per-server session fetch cache (500ms TTL)
	polling      bool
	fetcher      SessionFetcher
}

func newSSEHub(fetcher SessionFetcher) *sseHub {
	return &sseHub{
		clients:      make(map[*sseClient]struct{}),
		previousJSON: make(map[string]string),
		cache:        make(map[string]*cachedResult),
		fetcher:      fetcher,
	}
}

func (h *sseHub) addClient(c *sseClient) {
	h.mu.Lock()
	defer h.mu.Unlock()

	h.clients[c] = struct{}{}

	// Send cached snapshot immediately
	if prev, ok := h.previousJSON[c.server]; ok && prev != "" {
		select {
		case c.ch <- []byte(fmt.Sprintf("event: sessions\ndata: %s\n\n", prev)):
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

	delete(h.clients, c)
}

func (h *sseHub) poll() {
	for {
		h.mu.Lock()
		if len(h.clients) == 0 {
			h.polling = false
			h.mu.Unlock()
			return
		}

		// Collect distinct servers that have active clients
		serverSet := make(map[string]struct{})
		for c := range h.clients {
			serverSet[c.server] = struct{}{}
		}
		h.mu.Unlock()

		// Poll each server and broadcast to matching clients
		for server := range serverSet {
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

				for c := range h.clients {
					if c.server == server {
						select {
						case c.ch <- event:
						default:
							// Client buffer full — skip
						}
					}
				}
			}
			h.mu.Unlock()
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
		ch:     make(chan []byte, 8),
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
