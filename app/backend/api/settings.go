package api

import (
	"encoding/json"
	"net/http"
	"strings"

	"rk/internal/settings"
)

// handleGetTheme returns the current theme preferences.
// GET /api/settings/theme → {"theme": "...", "theme_dark": "...", "theme_light": "..."}
func (s *Server) handleGetTheme(w http.ResponseWriter, r *http.Request) {
	current := settings.Load()
	writeJSON(w, http.StatusOK, map[string]string{
		"theme":       current.Theme,
		"theme_dark":  current.ThemeDark,
		"theme_light": current.ThemeLight,
	})
}

// handlePutTheme saves theme preferences (partial update).
// PUT /api/settings/theme ← {"theme": "...", "theme_dark": "...", "theme_light": "..."} → {"status": "ok"}
func (s *Server) handlePutTheme(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Theme      *string `json:"theme"`
		ThemeDark  *string `json:"theme_dark"`
		ThemeLight *string `json:"theme_light"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid JSON body")
		return
	}
	// Normalize: treat whitespace-only values as absent
	if body.Theme != nil {
		v := strings.TrimSpace(*body.Theme)
		if v == "" {
			body.Theme = nil
		} else {
			body.Theme = &v
		}
	}
	if body.ThemeDark != nil {
		v := strings.TrimSpace(*body.ThemeDark)
		if v == "" {
			body.ThemeDark = nil
		} else {
			body.ThemeDark = &v
		}
	}
	if body.ThemeLight != nil {
		v := strings.TrimSpace(*body.ThemeLight)
		if v == "" {
			body.ThemeLight = nil
		} else {
			body.ThemeLight = &v
		}
	}

	if body.Theme == nil && body.ThemeDark == nil && body.ThemeLight == nil {
		writeError(w, http.StatusBadRequest, "at least one of theme, theme_dark, or theme_light is required")
		return
	}

	current := settings.Load()
	if body.Theme != nil {
		current.Theme = *body.Theme
	}
	if body.ThemeDark != nil {
		current.ThemeDark = *body.ThemeDark
	}
	if body.ThemeLight != nil {
		current.ThemeLight = *body.ThemeLight
	}

	if err := settings.Save(current); err != nil {
		s.logger.Error("failed to save theme setting", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to save setting")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
