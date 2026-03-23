package api

import (
	"encoding/json"
	"net/http"

	"rk/internal/settings"
)

// handleGetTheme returns the current theme preference.
// GET /api/settings/theme → {"theme": "..."}
func (s *Server) handleGetTheme(w http.ResponseWriter, r *http.Request) {
	current := settings.Load()
	writeJSON(w, http.StatusOK, map[string]string{"theme": current.Theme})
}

// handlePutTheme saves the theme preference.
// PUT /api/settings/theme ← {"theme": "..."} → {"status": "ok"}
func (s *Server) handlePutTheme(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Theme string `json:"theme"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid JSON body")
		return
	}
	if body.Theme == "" {
		writeError(w, http.StatusBadRequest, "theme is required")
		return
	}
	if err := settings.Save(settings.Settings{Theme: body.Theme}); err != nil {
		s.logger.Error("failed to save theme setting", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to save setting")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
