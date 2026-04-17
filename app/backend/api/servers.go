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
}

func (s *Server) handleServersList(w http.ResponseWriter, r *http.Request) {
	names, err := s.tmux.ListServers(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if len(names) == 0 {
		writeJSON(w, http.StatusOK, []serverInfo{})
		return
	}

	// Fan out ListSessions calls concurrently. A failure for one server
	// yields sessionCount: 0 for that entry; no 5xx to the client.
	counts := make(map[string]int, len(names))
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
			mu.Lock()
			counts[name] = n
			mu.Unlock()
		}(name)
	}
	wg.Wait()

	out := make([]serverInfo, 0, len(names))
	for _, name := range names {
		out = append(out, serverInfo{Name: name, SessionCount: counts[name]})
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
