package api

import (
	"log/slog"
	"net/http"

	"run-kit/internal/tmux"
)

func (s *Server) handleTmuxReloadConfig(w http.ResponseWriter, r *http.Request) {
	server := serverFromRequest(r)

	if err := tmux.ReloadConfig(server); err != nil {
		slog.Error("tmux config reload failed", "err", err, "server", server)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
