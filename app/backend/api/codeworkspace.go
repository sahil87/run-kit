package api

// GET /api/windows/{windowId}/code-workspace — the ONLY daemon-side writer of
// the derived per-tab .code-workspace file (rk tab code set must NOT write
// one). The handler reads the live @rk_win_code_root at request time (never
// cached — Constitution II derive-at-request-time; a read-shaped ensure ⇒ GET,
// Constitution IX), ensures the file via internal/codeworkspace, and returns
// the absolute path the frontend embeds as /code/?workspace=<path>.

import (
	"net/http"
	"strings"

	"rk/internal/codeworkspace"
	"rk/internal/tmux"
	"rk/internal/validate"
)

// handleCodeWorkspace serves GET /api/windows/{windowId}/code-workspace:
// 200 {"path","root"} / 409 on an empty code root / 400 on an invalid window
// id or server / 404 on an unknown window / 500 on an Ensure failure.
func (s *Server) handleCodeWorkspace(w http.ResponseWriter, r *http.Request) {
	windowID, ok := parseWindowID(r)
	if !ok {
		writeError(w, http.StatusBadRequest, "Invalid window ID")
		return
	}

	// The server names a path segment on disk, so unlike serverFromRequest
	// (which silently defaults) an explicitly invalid value is a 400.
	server := r.URL.Query().Get("server")
	if server == "" {
		server = "default"
	} else if msg := validate.ValidateServerName(server); msg != "" {
		writeError(w, http.StatusBadRequest, msg)
		return
	}

	root, err := getWindowOptionFn(r.Context(), windowID, server, tmux.CodeRootOption)
	if err != nil {
		// tmux's missing-window phrasings map to 404 (the boards.go error-text
		// precedent); anything else is an operational failure.
		if msg := err.Error(); strings.Contains(msg, "can't find window") || strings.Contains(msg, "window not found") {
			writeError(w, http.StatusNotFound, "window not found")
			return
		}
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if root == "" {
		writeError(w, http.StatusConflict, "window has no code root")
		return
	}

	stateDir, err := codeworkspace.StateDir()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	path, err := codeworkspace.Ensure(stateDir, server, windowID, root)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"path": path, "root": root})
}
