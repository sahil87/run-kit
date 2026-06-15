package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"rk/internal/tmux"
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

	// When rkType is present, create the window and set its @rk_type/@rk_url
	// options atomically in one chained tmux command — prevents the SSE poll
	// from seeing the window before its metadata is set. The option set reuses
	// the same allowlisted keys and the same WindowOptionOp chaining primitive
	// as the /options endpoint (no separate inline option-map construction path);
	// window creation and option-set stay in a single invocation so they are
	// atomic at creation.
	if body.RkType != "" {
		rkType := body.RkType
		ops := []tmux.WindowOptionOp{{Key: optKeyRkType, Value: &rkType}}
		if body.RkUrl != "" {
			rkURL := body.RkUrl
			ops = append(ops, tmux.WindowOptionOp{Key: optKeyRkURL, Value: &rkURL})
		}
		if err := s.tmux.CreateWindowWithOptions(session, body.Name, resolvedCwd, server, ops); err != nil {
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

// decodeWindowID percent-decodes (url.PathUnescape) the {windowId} path param
// and validates it via validate.ValidateWindowID, returning (id, true) on
// success and ("", false) on either failure. It is the single source of the
// decode+validate logic shared by the REST handlers (via parseWindowID) and the
// WebSocket relay (handleRelay) — keeping the two entry points from drifting
// (the drift that caused bug #205).
//
// chi v5's URLParam returns the path param as it appears in the matched route:
// for '@' encoded as '%40', URLParam returns the encoded form, so an explicit
// PathUnescape is required. (RawPath is set by net/http only when the decoded
// path differs from the raw path; this decode does not depend on whether the
// server set RawPath.)
func decodeWindowID(r *http.Request) (string, bool) {
	id, err := url.PathUnescape(chi.URLParam(r, "windowId"))
	if err != nil {
		return "", false
	}
	if validate.ValidateWindowID(id, "Window ID") != "" {
		return "", false
	}
	return id, true
}

// parseWindowID extracts and validates the tmux window ID from the URL.
// Returns (id, true) on success, ("", false) when the {windowId} path parameter
// is missing or malformed (handlers respond 400 in that case). It delegates the
// decode+validate to the shared decodeWindowID helper.
func parseWindowID(r *http.Request) (string, bool) {
	return decodeWindowID(r)
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

// handleWindowSelect focuses a window by its stable ID. It resolves the owning
// (non-ephemeral) session server-side and issues a session-scoped select
// (select-window -t <session>:@N) rather than a bare select. A bare target is
// ambiguous inside a tmux session group — group members share window membership
// but keep independent active-window state — so the scoped form is required for
// correctness. The session is disambiguation context derived server-side; the
// client never supplies it.
func (s *Server) handleWindowSelect(w http.ResponseWriter, r *http.Request) {
	windowID, ok := parseWindowID(r)
	if !ok {
		writeError(w, http.StatusBadRequest, "Invalid window ID")
		return
	}

	server := serverFromRequest(r)
	// Dedicated timeout context (not r.Context()) — the resolved session feeds
	// the subsequent select mutation.
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	session, err := s.tmux.ResolveWindowSession(ctx, server, windowID)
	if err != nil {
		// Stale @N — surface the resolve failure; never fall back to a bare
		// select against the stale id.
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	if err := s.tmux.SelectWindowInSession(session, windowID, server); err != nil {
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

// Allowlisted window-option keys for the /options endpoint. Only these keys may
// reach `tmux set-option` — any other client-supplied key is rejected with 400
// (constitution §I — closed key set bounds the injection/abuse surface, and a
// closed set is what makes per-key validation possible).
const (
	optKeyColor  = "@color"
	optKeyRkURL  = "@rk_url"
	optKeyRkType = "@rk_type"
)

// validateWindowOption enforces the per-key rules preserved from the old
// dedicated handlers, returning a non-empty error message when value is invalid
// for key (the caller maps that to 400 before any tmux call). A nil value (JSON
// null → unset) is always valid. Only allowlisted keys reach this function.
func validateWindowOption(key string, value *string) string {
	if value == nil {
		return "" // null = unset, always valid
	}
	switch key {
	case optKeyColor:
		// Color value descriptor: a single index ("4", 0–15) or a two-hue
		// blend ("1+3", each component 0–15). Validated via the shared rule.
		if errMsg := validate.ValidateColorValue(*value); errMsg != "" {
			return errMsg
		}
	case optKeyRkURL:
		if strings.TrimSpace(*value) == "" {
			return "URL cannot be empty"
		}
	case optKeyRkType:
		// No set-value validation: handleWindowTypeUpdate set any non-empty
		// string verbatim. An empty string is treated as unset below.
	}
	return ""
}

// handleWindowOptions applies a partial-merge of window options to {windowId}.
// POST /api/windows/{windowId}/options ← {"options": {"@color": "5", "@rk_url":
// "...", "@rk_type": null}} → 200 {"ok": true}.
//
// Semantics: only keys present in `options` are touched; a present key with a
// non-null value sets it, an explicit null unsets it. ALL keys are validated
// (allowlist + per-key rules) before any tmux call — if any key fails, the
// endpoint returns 400 and issues zero tmux calls (no partial application). The
// whole merge then executes as one \;-chained tmux invocation via the shared
// SetWindowOptions primitive.
func (s *Server) handleWindowOptions(w http.ResponseWriter, r *http.Request) {
	windowID, ok := parseWindowID(r)
	if !ok {
		writeError(w, http.StatusBadRequest, "Invalid window ID")
		return
	}

	var body struct {
		Options map[string]*string `json:"options"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid JSON body")
		return
	}

	// Validate-all-then-execute: build the op list while validating, so a single
	// invalid key aborts with zero tmux calls.
	ops := make([]tmux.WindowOptionOp, 0, len(body.Options))
	for key, value := range body.Options {
		switch key {
		case optKeyColor, optKeyRkURL, optKeyRkType:
		default:
			writeError(w, http.StatusBadRequest, "Unknown option key: "+key)
			return
		}
		if errMsg := validateWindowOption(key, value); errMsg != "" {
			writeError(w, http.StatusBadRequest, errMsg)
			return
		}
		op := tmux.WindowOptionOp{Key: key, Value: value}
		// @rk_type empty string means unset (revert to terminal mode), matching
		// the old handleWindowTypeUpdate behavior.
		if key == optKeyRkType && value != nil && *value == "" {
			op.Value = nil
		}
		ops = append(ops, op)
	}

	if len(ops) == 0 {
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
		return
	}

	server := serverFromRequest(r)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := s.tmux.SetWindowOptions(ctx, windowID, server, ops); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
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
