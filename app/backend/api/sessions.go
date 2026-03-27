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
