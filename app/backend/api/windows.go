package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"rk/internal/validate"
)

func (s *Server) handleWindowCreate(w http.ResponseWriter, r *http.Request) {
	session := chi.URLParam(r, "session")
	if errMsg := validate.ValidateName(session, "Session name"); errMsg != "" {
		writeError(w, http.StatusBadRequest, errMsg)
		return
	}

	var body struct {
		Name   string `json:"name"`
		CWD    string `json:"cwd"`
		RkType string `json:"rkType"`
		RkUrl  string `json:"rkUrl"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid JSON body")
		return
	}

	if errMsg := validate.ValidateName(body.Name, "Window name"); errMsg != "" {
		writeError(w, http.StatusBadRequest, errMsg)
		return
	}

	server := serverFromRequest(r)

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
	} else {
		// Default to the cwd of the first window in the session.
		// Use a dedicated timeout context (not the request context) because the
		// result feeds into the subsequent CreateWindow mutation. If we used
		// r.Context() and the client disconnected, ListWindows would return
		// (nil, nil) and the mutation would create the window with an empty cwd.
		cwdCtx, cwdCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cwdCancel()
		if windows, err := s.tmux.ListWindows(cwdCtx, session, server); err == nil && len(windows) > 0 {
			resolvedCwd = windows[0].WorktreePath
		}
	}

	// When rkType is present, use a single chained tmux command to set window
	// options atomically — prevents the SSE poll from seeing the window before
	// its metadata is set.
	if body.RkType != "" {
		opts := map[string]string{
			"@rk_type": body.RkType,
		}
		if body.RkUrl != "" {
			opts["@rk_url"] = body.RkUrl
		}
		if err := s.tmux.CreateWindowWithOptions(session, body.Name, resolvedCwd, server, opts); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusCreated, map[string]bool{"ok": true})
		return
	}

	if err := s.tmux.CreateWindow(session, body.Name, resolvedCwd, server); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusCreated, map[string]bool{"ok": true})
}

// parseWindowID extracts and validates the tmux window ID from the URL.
// Returns (id, true) on success, ("", false) when the {windowId} path parameter
// is missing or malformed (handlers respond 400 in that case).
//
// The raw chi path param is percent-decoded before validation: window IDs
// contain '@', which clients URL-encode to '%40', and chi v5 preserves the
// encoded form in URLParam when RawPath is set.
func parseWindowID(r *http.Request) (string, bool) {
	raw := chi.URLParam(r, "windowId")
	id, err := url.PathUnescape(raw)
	if err != nil {
		return "", false
	}
	if validate.ValidateWindowID(id, "Window ID") != "" {
		return "", false
	}
	return id, true
}

func (s *Server) handleWindowKill(w http.ResponseWriter, r *http.Request) {
	windowID, ok := parseWindowID(r)
	if !ok {
		writeError(w, http.StatusBadRequest, "Invalid window ID")
		return
	}

	if err := s.tmux.KillWindow(windowID, serverFromRequest(r)); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleWindowRename(w http.ResponseWriter, r *http.Request) {
	windowID, ok := parseWindowID(r)
	if !ok {
		writeError(w, http.StatusBadRequest, "Invalid window ID")
		return
	}

	var body struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid JSON body")
		return
	}

	if errMsg := validate.ValidateName(body.Name, "Window name"); errMsg != "" {
		writeError(w, http.StatusBadRequest, errMsg)
		return
	}

	if err := s.tmux.RenameWindow(windowID, body.Name, serverFromRequest(r)); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleWindowSelect(w http.ResponseWriter, r *http.Request) {
	windowID, ok := parseWindowID(r)
	if !ok {
		writeError(w, http.StatusBadRequest, "Invalid window ID")
		return
	}

	if err := s.tmux.SelectWindow(windowID, serverFromRequest(r)); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleWindowSplit(w http.ResponseWriter, r *http.Request) {
	windowID, ok := parseWindowID(r)
	if !ok {
		writeError(w, http.StatusBadRequest, "Invalid window ID")
		return
	}

	var body struct {
		Horizontal bool   `json:"horizontal"`
		CWD        string `json:"cwd"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid JSON body")
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

	paneID, err := s.tmux.SplitWindow(windowID, body.Horizontal, resolvedCwd, serverFromRequest(r))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "pane_id": paneID})
}

func (s *Server) handleClosePaneKill(w http.ResponseWriter, r *http.Request) {
	windowID, ok := parseWindowID(r)
	if !ok {
		writeError(w, http.StatusBadRequest, "Invalid window ID")
		return
	}

	if err := s.tmux.KillActivePane(windowID, serverFromRequest(r)); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleWindowMove(w http.ResponseWriter, r *http.Request) {
	windowID, ok := parseWindowID(r)
	if !ok {
		writeError(w, http.StatusBadRequest, "Invalid window ID")
		return
	}

	var body struct {
		TargetIndex *int `json:"targetIndex"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid JSON body")
		return
	}

	if body.TargetIndex == nil {
		writeError(w, http.StatusBadRequest, "targetIndex is required")
		return
	}
	if *body.TargetIndex < 0 {
		writeError(w, http.StatusBadRequest, "targetIndex must be a non-negative integer")
		return
	}

	if err := s.tmux.MoveWindow(windowID, *body.TargetIndex, serverFromRequest(r)); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleWindowMoveToSession(w http.ResponseWriter, r *http.Request) {
	windowID, ok := parseWindowID(r)
	if !ok {
		writeError(w, http.StatusBadRequest, "Invalid window ID")
		return
	}

	var body struct {
		TargetSession string `json:"targetSession"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid JSON body")
		return
	}

	if body.TargetSession == "" {
		writeError(w, http.StatusBadRequest, "targetSession is required")
		return
	}

	if errMsg := validate.ValidateName(body.TargetSession, "Target session name"); errMsg != "" {
		writeError(w, http.StatusBadRequest, errMsg)
		return
	}

	if err := s.tmux.MoveWindowToSession(windowID, body.TargetSession, serverFromRequest(r)); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleWindowColor(w http.ResponseWriter, r *http.Request) {
	windowID, ok := parseWindowID(r)
	if !ok {
		writeError(w, http.StatusBadRequest, "Invalid window ID")
		return
	}

	var body struct {
		Color *int `json:"color"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid JSON body")
		return
	}

	server := serverFromRequest(r)

	if body.Color == nil {
		// Clear color
		if err := s.tmux.UnsetWindowColor(windowID, server); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
	} else {
		// Validate range
		if *body.Color < 0 || *body.Color > 15 {
			writeError(w, http.StatusBadRequest, "Color must be between 0 and 15")
			return
		}
		if err := s.tmux.SetWindowColor(windowID, *body.Color, server); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
	}

	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleWindowUrlUpdate(w http.ResponseWriter, r *http.Request) {
	windowID, ok := parseWindowID(r)
	if !ok {
		writeError(w, http.StatusBadRequest, "Invalid window ID")
		return
	}

	var body struct {
		URL string `json:"url"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid JSON body")
		return
	}

	if strings.TrimSpace(body.URL) == "" {
		writeError(w, http.StatusBadRequest, "URL cannot be empty")
		return
	}

	server := serverFromRequest(r)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := s.tmux.SetWindowOption(ctx, windowID, server, "@rk_url", body.URL); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleWindowTypeUpdate(w http.ResponseWriter, r *http.Request) {
	windowID, ok := parseWindowID(r)
	if !ok {
		writeError(w, http.StatusBadRequest, "Invalid window ID")
		return
	}

	var body struct {
		RkType string `json:"rkType"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid JSON body")
		return
	}

	server := serverFromRequest(r)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if body.RkType == "" {
		// Unset @rk_type to revert to terminal mode
		if err := s.tmux.UnsetWindowOption(ctx, windowID, server, "@rk_type"); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
	} else {
		if err := s.tmux.SetWindowOption(ctx, windowID, server, "@rk_type", body.RkType); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
	}

	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleWindowKeys(w http.ResponseWriter, r *http.Request) {
	windowID, ok := parseWindowID(r)
	if !ok {
		writeError(w, http.StatusBadRequest, "Invalid window ID")
		return
	}

	var body struct {
		Keys string `json:"keys"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid JSON body")
		return
	}

	if strings.TrimSpace(body.Keys) == "" {
		writeError(w, http.StatusBadRequest, "Keys cannot be empty")
		return
	}

	if err := s.tmux.SendKeys(windowID, body.Keys, serverFromRequest(r)); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
