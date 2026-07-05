package api

import (
	"encoding/json"
	"net/http"
	"os"
	"sort"
	"sync"

	"rk/internal/validate"
)

// serverInfo is the per-server response entry from GET /api/servers.
type serverInfo struct {
	Name         string `json:"name"`
	SessionCount int    `json:"sessionCount"`
	// Rank is this server's user-defined display rank (@rk_server_rank).
	// nil (JSON null) when unset or unreadable — the frontend sorts unranked
	// servers after ranked ones. The array's alphabetical order is unchanged
	// (an asserted API contract); rank drives display order client-side only.
	Rank *int `json:"rank"`
}

func (s *Server) handleServersList(w http.ResponseWriter, r *http.Request) {
	// Surface EVERY tmux server discovered, including leaked rk-test-*
	// orphans. The test-socket hide filter was deleted: `rk reaper` is now the
	// sole mechanism that keeps this list clean, so the dev UI shows the
	// operator exactly what the reaper will reap. Accepted cost: a per-orphan
	// SSE stream until the operator runs `rk reaper`.
	names, err := s.tmux.ListServers(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	if len(names) == 0 {
		writeJSON(w, http.StatusOK, []serverInfo{})
		return
	}

	// Fan out ListSessions + GetServerRank calls concurrently. A failure for
	// one server yields sessionCount: 0 / rank: null for that entry; no 5xx to
	// the client. The rank read joins this existing fan-out (one extra tmux
	// call per server, same concurrency pattern).
	counts := make(map[string]int, len(names))
	ranks := make(map[string]*int, len(names))
	var mu sync.Mutex
	var wg sync.WaitGroup
	for _, name := range names {
		wg.Add(1)
		go func(name string) {
			defer wg.Done()
			sessions, err := s.tmux.ListSessions(r.Context(), name)
			n := 0
			if err == nil {
				n = len(sessions)
			} else {
				s.logger.Warn("servers: ListSessions failed", "server", name, "err", err)
			}
			rank, rerr := s.tmux.GetServerRank(r.Context(), name)
			if rerr != nil {
				s.logger.Warn("servers: GetServerRank failed", "server", name, "err", rerr)
				rank = nil
			}
			mu.Lock()
			counts[name] = n
			ranks[name] = rank
			mu.Unlock()
		}(name)
	}
	wg.Wait()

	out := make([]serverInfo, 0, len(names))
	for _, name := range names {
		out = append(out, serverInfo{Name: name, SessionCount: counts[name], Rank: ranks[name]})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })

	writeJSON(w, http.StatusOK, out)
}

func (s *Server) handleServerCreate(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid JSON body")
		return
	}

	if errMsg := validate.ValidateServerName(body.Name); errMsg != "" {
		writeError(w, http.StatusBadRequest, errMsg)
		return
	}

	homeDir, err := os.UserHomeDir()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Could not determine home directory")
		return
	}

	if err := s.tmux.CreateSession("0", homeDir, body.Name); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusCreated, map[string]bool{"ok": true})
}

// handleServerOrderPost persists the user-defined server display order by
// writing rank i to the i-th listed server, then broadcasts the new order to
// every connected SSE client (server-global — see broadcastServerOrder).
// POST /api/servers/order ← {"order": ["srv-a", "srv-b", ...]} → 200 {"ok": true}
//
// Best-effort per server: one unreachable server logs a warning and is skipped
// — the next full write self-heals. The array itself is validated up front, so
// a malformed body or an invalid server name is a 400 before any tmux write.
func (s *Server) handleServerOrderPost(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Order []string `json:"order"`
	}
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid JSON body — expected {\"order\": [\"name\", ...]}")
		return
	}
	if body.Order == nil {
		body.Order = []string{}
	}
	for _, name := range body.Order {
		if errMsg := validate.ValidateServerName(name); errMsg != "" {
			writeError(w, http.StatusBadRequest, errMsg)
			return
		}
	}

	// Write rank i to the i-th listed server, best-effort. A per-server failure
	// (server killed mid-reorder, momentary timeout) warns and skips — the next
	// full write self-heals — and never fails the whole request (mirrors the
	// no-5xx fan-out stance of handleServersList).
	for i, name := range body.Order {
		if err := s.tmux.SetServerRank(r.Context(), name, i); err != nil {
			s.logger.Warn("servers: SetServerRank failed", "server", name, "rank", i, "err", err)
		}
	}

	// Broadcast the new order to every connected SSE client (server-global, so
	// even the zero-attached-server Cockpit `?metrics=1` stream hears it).
	s.initSSEHub()
	s.sseHub.broadcastServerOrder(body.Order)

	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleServerKill(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid JSON body")
		return
	}

	if errMsg := validate.ValidateServerName(body.Name); errMsg != "" {
		writeError(w, http.StatusBadRequest, errMsg)
		return
	}

	if err := s.tmux.KillServer(body.Name); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
