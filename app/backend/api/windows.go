package api

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
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
		Name string `json:"name"`
		CWD  string `json:"cwd"`
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

	if err := s.tmux.CreateWindow(session, body.Name, resolvedCwd, server); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusCreated, map[string]bool{"ok": true})
}

// parseWindowIndex extracts and validates the window index from the URL.
func parseWindowIndex(r *http.Request) (int, bool) {
	indexStr := chi.URLParam(r, "index")
	index, err := strconv.Atoi(indexStr)
	if err != nil || index < 0 {
		return 0, false
	}
	return index, true
}

func (s *Server) handleWindowKill(w http.ResponseWriter, r *http.Request) {
	session := chi.URLParam(r, "session")
	if errMsg := validate.ValidateName(session, "Session name"); errMsg != "" {
		writeError(w, http.StatusBadRequest, errMsg)
		return
	}

	index, ok := parseWindowIndex(r)
	if !ok {
		writeError(w, http.StatusBadRequest, "Invalid window index")
		return
	}

	if err := s.tmux.KillWindow(session, index, serverFromRequest(r)); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleWindowRename(w http.ResponseWriter, r *http.Request) {
	session := chi.URLParam(r, "session")
	if errMsg := validate.ValidateName(session, "Session name"); errMsg != "" {
		writeError(w, http.StatusBadRequest, errMsg)
		return
	}

	index, ok := parseWindowIndex(r)
	if !ok {
		writeError(w, http.StatusBadRequest, "Invalid window index")
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

	if err := s.tmux.RenameWindow(session, index, body.Name, serverFromRequest(r)); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleWindowSelect(w http.ResponseWriter, r *http.Request) {
	session := chi.URLParam(r, "session")
	if errMsg := validate.ValidateName(session, "Session name"); errMsg != "" {
		writeError(w, http.StatusBadRequest, errMsg)
		return
	}

	index, ok := parseWindowIndex(r)
	if !ok {
		writeError(w, http.StatusBadRequest, "Invalid window index")
		return
	}

	if err := s.tmux.SelectWindow(session, index, serverFromRequest(r)); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleWindowSplit(w http.ResponseWriter, r *http.Request) {
	session := chi.URLParam(r, "session")
	if errMsg := validate.ValidateName(session, "Session name"); errMsg != "" {
		writeError(w, http.StatusBadRequest, errMsg)
		return
	}

	index, ok := parseWindowIndex(r)
	if !ok {
		writeError(w, http.StatusBadRequest, "Invalid window index")
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

	paneID, err := s.tmux.SplitWindow(session, index, body.Horizontal, resolvedCwd, serverFromRequest(r))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "pane_id": paneID})
}

func (s *Server) handleClosePaneKill(w http.ResponseWriter, r *http.Request) {
	session := chi.URLParam(r, "session")
	if errMsg := validate.ValidateName(session, "Session name"); errMsg != "" {
		writeError(w, http.StatusBadRequest, errMsg)
		return
	}

	index, ok := parseWindowIndex(r)
	if !ok {
		writeError(w, http.StatusBadRequest, "Invalid window index")
		return
	}

	if err := s.tmux.KillActivePane(session, index, serverFromRequest(r)); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleWindowMove(w http.ResponseWriter, r *http.Request) {
	session := chi.URLParam(r, "session")
	if errMsg := validate.ValidateName(session, "Session name"); errMsg != "" {
		writeError(w, http.StatusBadRequest, errMsg)
		return
	}

	index, ok := parseWindowIndex(r)
	if !ok {
		writeError(w, http.StatusBadRequest, "Invalid window index")
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

	if err := s.tmux.SwapWindow(session, index, *body.TargetIndex, serverFromRequest(r)); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleWindowMoveToSession(w http.ResponseWriter, r *http.Request) {
	session := chi.URLParam(r, "session")
	if errMsg := validate.ValidateName(session, "Session name"); errMsg != "" {
		writeError(w, http.StatusBadRequest, errMsg)
		return
	}

	index, ok := parseWindowIndex(r)
	if !ok {
		writeError(w, http.StatusBadRequest, "Invalid window index")
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

	if body.TargetSession == session {
		writeError(w, http.StatusBadRequest, "targetSession must differ from source session")
		return
	}

	if err := s.tmux.MoveWindowToSession(session, index, body.TargetSession, serverFromRequest(r)); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleWindowKeys(w http.ResponseWriter, r *http.Request) {
	session := chi.URLParam(r, "session")
	if errMsg := validate.ValidateName(session, "Session name"); errMsg != "" {
		writeError(w, http.StatusBadRequest, errMsg)
		return
	}

	index, ok := parseWindowIndex(r)
	if !ok {
		writeError(w, http.StatusBadRequest, "Invalid window index")
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

	if err := s.tmux.SendKeys(session, index, body.Keys, serverFromRequest(r)); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
