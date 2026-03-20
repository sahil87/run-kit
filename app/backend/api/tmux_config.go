package api

import (
	"encoding/json"
	"log/slog"
	"net/http"

	"run-kit/internal/tmux"
)

func (s *Server) handleTmuxReloadConfig(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Server string `json:"server"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || (body.Server != "default" && body.Server != "runkit") {
		body.Server = "runkit"
	}

	if err := tmux.ReloadConfig(body.Server); err != nil {
		slog.Error("tmux config reload failed", "err", err, "server", body.Server)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
