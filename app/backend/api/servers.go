package api

import (
	"encoding/json"
	"net/http"
	"os"

	"run-kit/internal/validate"
)

func (s *Server) handleServersList(w http.ResponseWriter, r *http.Request) {
	servers, err := s.tmux.ListServers()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if servers == nil {
		servers = []string{}
	}
	writeJSON(w, http.StatusOK, servers)
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
