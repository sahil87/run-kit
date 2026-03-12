package api

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"sync"
	"time"
)

const (
	ssePollInterval = 2500 * time.Millisecond
	maxLifetime     = 30 * time.Minute
)

type sseClient struct {
	ch chan []byte
}

type sseHub struct {
	mu           sync.RWMutex
	clients      map[*sseClient]struct{}
	previousJSON string
	polling      bool
	fetcher      SessionFetcher
}

func newSSEHub(fetcher SessionFetcher) *sseHub {
	return &sseHub{
		clients: make(map[*sseClient]struct{}),
		fetcher: fetcher,
	}
}

func (h *sseHub) addClient(c *sseClient) {
	h.mu.Lock()
	defer h.mu.Unlock()

	h.clients[c] = struct{}{}

	// Send cached snapshot immediately
	if h.previousJSON != "" {
		select {
		case c.ch <- []byte(fmt.Sprintf("event: sessions\ndata: %s\n\n", h.previousJSON)):
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
		h.mu.Unlock()

		result, err := h.fetcher.FetchSessions()
		if err != nil {
			slog.Warn("SSE poll error", "err", err)
			time.Sleep(ssePollInterval)
			continue
		}

		jsonBytes, err := json.Marshal(result)
		if err != nil {
			time.Sleep(ssePollInterval)
			continue
		}
		jsonStr := string(jsonBytes)

		h.mu.Lock()
		if jsonStr != h.previousJSON {
			h.previousJSON = jsonStr
			event := []byte(fmt.Sprintf("event: sessions\ndata: %s\n\n", jsonStr))

			for c := range h.clients {
				select {
				case c.ch <- event:
				default:
					// Client buffer full — skip
				}
			}
		}
		h.mu.Unlock()

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
		ch: make(chan []byte, 8),
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
