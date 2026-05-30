package api

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"

	"rk/internal/validate"
)

func (s *Server) handleSessionsList(w http.ResponseWriter, r *http.Request) {
	result, err := s.sessions.FetchSessions(r.Context(), serverFromRequest(r))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleSessionCreate(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name string `json:"name"`
		CWD  string `json:"cwd"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid JSON body")
		return
	}

	if errMsg := validate.ValidateName(body.Name, "Session name"); errMsg != "" {
		writeError(w, http.StatusBadRequest, errMsg)
		return
	}

	var resolvedCwd string
	if body.CWD != "" {
		if errMsg := validate.ValidatePath(body.CWD, "Working directory"); errMsg != "" {
			writeError(w, http.StatusBadRequest, errMsg)
			return
		}
		expanded, expandErr := validate.ExpandTilde(body.CWD)
		if expandErr != "" {
			writeError(w, http.StatusBadRequest, expandErr)
			return
		}
		resolvedCwd = expanded
	}

	if err := s.tmux.CreateSession(body.Name, resolvedCwd, serverFromRequest(r)); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusCreated, map[string]bool{"ok": true})
}

func (s *Server) handleSessionRename(w http.ResponseWriter, r *http.Request) {
	session := chi.URLParam(r, "session")
	if errMsg := validate.ValidateName(session, "Session name"); errMsg != "" {
		writeError(w, http.StatusBadRequest, errMsg)
		return
	}

	var body struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid JSON body")
		return
	}

	if errMsg := validate.ValidateName(body.Name, "Session name"); errMsg != "" {
		writeError(w, http.StatusBadRequest, errMsg)
		return
	}

	if err := s.tmux.RenameSession(session, body.Name, serverFromRequest(r)); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleSessionColor(w http.ResponseWriter, r *http.Request) {
	session := chi.URLParam(r, "session")
	if errMsg := validate.ValidateName(session, "Session name"); errMsg != "" {
		writeError(w, http.StatusBadRequest, errMsg)
		return
	}

	var body struct {
		Color *int `json:"color"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid JSON body")
		return
	}

	if body.Color != nil && (*body.Color < 0 || *body.Color > 15) {
		writeError(w, http.StatusBadRequest, "Color must be between 0 and 15")
		return
	}

	server := serverFromRequest(r)

	var err error
	if body.Color != nil {
		err = s.tmux.SetSessionColor(session, *body.Color, server)
	} else {
		err = s.tmux.UnsetSessionColor(session, server)
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// handleSessionOrderGet returns the persisted session order for the active server.
// GET /api/sessions/order?server=<name> → 200 {"order": [...]}
// Unset option returns 200 {"order": []} — never a 404.
func (s *Server) handleSessionOrderGet(w http.ResponseWriter, r *http.Request) {
	server := serverFromRequest(r)
	order, err := s.tmux.GetSessionOrder(r.Context(), server)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if order == nil {
		order = []string{}
	}
	writeJSON(w, http.StatusOK, map[string][]string{"order": order})
}

// handleSessionOrderPost persists the session order and broadcasts it to SSE clients.
// POST /api/sessions/order?server=<name> ← {"order": [...]} → 200 {"ok": true}
func (s *Server) handleSessionOrderPost(w http.ResponseWriter, r *http.Request) {
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
		if errMsg := validate.ValidateName(name, "Session name"); errMsg != "" {
			writeError(w, http.StatusBadRequest, errMsg)
			return
		}
	}

	server := serverFromRequest(r)
	if err := s.tmux.SetSessionOrder(r.Context(), server, body.Order); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	// Broadcast to any connected SSE clients on this server. initSSEHub is
	// idempotent — a hub created here will pick up future SSE clients normally.
	s.initSSEHub()
	s.sseHub.broadcastSessionOrder(server, body.Order)

	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleSessionKill(w http.ResponseWriter, r *http.Request) {
	session := chi.URLParam(r, "session")
	if errMsg := validate.ValidateName(session, "Session name"); errMsg != "" {
		writeError(w, http.StatusBadRequest, errMsg)
		return
	}

	if err := s.tmux.KillSession(session, serverFromRequest(r)); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
