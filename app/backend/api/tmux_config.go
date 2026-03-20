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

func (s *Server) handleTmuxInitConf(w http.ResponseWriter, r *http.Request) {
	if err := tmux.ForceWriteConfig(); err != nil {
		slog.Error("tmux init-conf failed", "err", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "path": tmux.DefaultConfigPath})
}
