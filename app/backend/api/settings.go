package api

import (
	"encoding/json"
	"net/http"
	"strings"

	"rk/internal/settings"
	"rk/internal/validate"
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

// handleSetTheme saves theme preferences (partial update).
// POST /api/settings/theme ← {"theme": "...", "theme_dark": "...", "theme_light": "..."} → {"status": "ok"}
func (s *Server) handleSetTheme(w http.ResponseWriter, r *http.Request) {
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

// handleGetServerColor returns server color(s).
// GET /api/settings/server-color?server=xxx → {"color": 4} or {"color": null}
// GET /api/settings/server-color             → {"colors": {"default": 4, "dev": 10}}
func (s *Server) handleGetServerColor(w http.ResponseWriter, r *http.Request) {
	server := r.URL.Query().Get("server")
	if server == "" {
		current := settings.Load()
		colors := current.ServerColors
		if colors == nil {
			colors = map[string]string{}
		}
		writeJSON(w, http.StatusOK, map[string]any{"colors": colors})
		return
	}
	color := settings.GetServerColor(server)
	writeJSON(w, http.StatusOK, map[string]any{"color": color})
}

// handleGetInstanceColor returns the instance accent color.
// GET /api/settings/instance-color → {"color": "4"} or {"color": null}
// Returns the explicit setting only — the hostname-hash fallback is client-side.
func (s *Server) handleGetInstanceColor(w http.ResponseWriter, r *http.Request) {
	color := settings.GetInstanceColor()
	writeJSON(w, http.StatusOK, map[string]any{"color": color})
}

// handleSetInstanceColor sets or clears the instance accent color.
// POST /api/settings/instance-color ← {"color": "4"} or {"color": "1+3"} or {"color": null}
func (s *Server) handleSetInstanceColor(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Color *string `json:"color"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid JSON body")
		return
	}
	if body.Color != nil {
		if errMsg := validate.ValidateColorValue(*body.Color); errMsg != "" {
			writeError(w, http.StatusBadRequest, errMsg)
			return
		}
	}

	if err := settings.SetInstanceColor(body.Color); err != nil {
		s.logger.Error("failed to save instance color", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to save setting")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// handleGetSSHHost returns the stored SSH destination setting.
// GET /api/settings/ssh-host → {"sshHost": "devbox"} or {"sshHost": null}
// Returns the stored SETTING only — the effective value (settings-first with
// the RK_SSH_HOST env fallback) rides GET /api/health.
func (s *Server) handleGetSSHHost(w http.ResponseWriter, r *http.Request) {
	host := settings.GetSSHHost()
	writeJSON(w, http.StatusOK, map[string]any{"sshHost": host})
}

// handleSetSSHHost sets or clears the stored SSH destination.
// POST /api/settings/ssh-host ← {"sshHost": "devbox"} or {"sshHost": null}
// The value is trimmed; a trimmed-to-empty value clears (same as null). It is
// spliced verbatim into vscode-remote deeplink URLs client-side, so whitespace
// and control characters are rejected (400) before anything persists.
func (s *Server) handleSetSSHHost(w http.ResponseWriter, r *http.Request) {
	var body struct {
		SSHHost *string `json:"sshHost"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid JSON body")
		return
	}
	// Trim; treat a trimmed-to-empty value as a clear (same as null).
	if body.SSHHost != nil {
		v := strings.TrimSpace(*body.SSHHost)
		if v == "" {
			body.SSHHost = nil
		} else {
			if errMsg := validate.ValidateSSHHost(v); errMsg != "" {
				writeError(w, http.StatusBadRequest, errMsg)
				return
			}
			body.SSHHost = &v
		}
	}

	if err := settings.SetSSHHost(body.SSHHost); err != nil {
		s.logger.Error("failed to save ssh host", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to save setting")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// handleGetInstanceName returns the stored instance display-name override.
// GET /api/settings/instance-name → {"name": "my-box"} or {"name": null}
func (s *Server) handleGetInstanceName(w http.ResponseWriter, r *http.Request) {
	name := settings.GetInstanceName()
	writeJSON(w, http.StatusOK, map[string]any{"name": name})
}

// handleSetInstanceName sets or clears the instance display-name override.
// POST /api/settings/instance-name ← {"name": "my-box"} or {"name": null}
// The value is trimmed; a trimmed-to-empty value clears (same as null). It is
// a display label, so inner spaces are legal but control characters are
// rejected (400) and the length is capped.
func (s *Server) handleSetInstanceName(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name *string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid JSON body")
		return
	}
	if body.Name != nil {
		v := strings.TrimSpace(*body.Name)
		if v == "" {
			body.Name = nil
		} else {
			if errMsg := validate.ValidateInstanceName(v); errMsg != "" {
				writeError(w, http.StatusBadRequest, errMsg)
				return
			}
			body.Name = &v
		}
	}

	if err := settings.SetInstanceName(body.Name); err != nil {
		s.logger.Error("failed to save instance name", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to save setting")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// handleSetServerColor sets or clears the color for a server.
// POST /api/settings/server-color ← {"server": "...", "color": 4} or {"server": "...", "color": null}
func (s *Server) handleSetServerColor(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Server string  `json:"server"`
		Color  *string `json:"color"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid JSON body")
		return
	}
	if body.Server == "" {
		writeError(w, http.StatusBadRequest, "server is required")
		return
	}
	if body.Color != nil {
		if errMsg := validate.ValidateColorValue(*body.Color); errMsg != "" {
			writeError(w, http.StatusBadRequest, errMsg)
			return
		}
	}

	if err := settings.SetServerColor(body.Server, body.Color); err != nil {
		s.logger.Error("failed to save server color", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to save setting")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
