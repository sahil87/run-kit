package api

// The web-tab verb routes (POST only, Constitution §IX): add/remove/select on
// the window's indexed @rk_win_web_<n> family, backed one-for-one by the
// internal/tmux Web* verbs. All three gate {windowId} (parseWindowID) and the
// slot {n} (^[1-8]$) before any tmux call, scope by ?server=
// (serverFromRequest), and wake the SSE hub on success — set-option is
// invisible to the tmuxctl control-mode parser (the /options precedent).

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"rk/internal/present"
	"rk/internal/tmux"
)

// Package-level seams so the verb handlers (and the /options family-relative
// paths) are testable without a live tmux server — the api/present.go
// getWindowOptionFn pattern; production defaults delegate to internal/tmux.
var (
	webTabFamilyFn = tmux.ReadWebTabFamily
	webAddFn       = tmux.WebAdd
	webRemoveFn    = tmux.WebRemove
	webSelectFn    = tmux.WebSelect
	webNowFn       = func() int64 { return time.Now().Unix() }
)

// windowCwd resolves the window's first-pane path (the WorktreePath reported
// by ListWindows) — the anchor for relative file/dir targets in the add verb.
// A window missing from the listing degrades to "" (ParseTarget rejects
// relative paths it cannot resolve, which is the honest failure for a stale
// window id).
func (s *Server) windowCwd(ctx context.Context, windowID, server string) (string, error) {
	session, err := s.tmux.ResolveWindowSession(ctx, server, windowID)
	if err != nil {
		return "", err
	}
	windows, err := s.tmux.ListWindows(ctx, session, server)
	if err != nil {
		return "", err
	}
	for _, win := range windows {
		if win.WindowID == windowID {
			return win.WorktreePath, nil
		}
	}
	return "", nil
}

// handleWindowWebAdd serves POST /api/windows/{windowId}/web — body
// {"target": "<string>"} resolved exactly like `rk present` (file, dir,
// :port/port, local URL, external URL — present.ParseTarget), appended to the
// window's web-tab family. 201 {"index","existed","url"}; 409 on a full
// family; 400 on parse/validation failure.
func (s *Server) handleWindowWebAdd(w http.ResponseWriter, r *http.Request) {
	windowID, ok := parseWindowID(r)
	if !ok {
		writeError(w, http.StatusBadRequest, "Invalid window ID")
		return
	}
	var body struct {
		Target string `json:"target"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid JSON body")
		return
	}
	if strings.TrimSpace(body.Target) == "" {
		writeError(w, http.StatusBadRequest, "target is required")
		return
	}

	server := serverFromRequest(r)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	cwd, err := s.windowCwd(ctx, windowID, server)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	target, err := present.ParseTarget(body.Target, cwd)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	// Reachability probe for port/local-URL kinds: best-effort (log, not fatal
	// — matches `rk present`).
	if target.NeedsProbe() {
		if err := present.ProbePort(ctx, target.Port); err != nil {
			s.logger.Warn("web add: port probe failed (attaching anyway)", "window", windowID, "port", target.Port, "err", err)
		}
	}

	fam, err := webTabFamilyFn(ctx, windowID, server)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	// The URL embeds the slot a fresh add lands in (len+1); an idempotent hit
	// finds its existing slot by target identity inside WebAdd, which also
	// owns the ?v= bump for /present/ kinds.
	url := target.URL(windowID, len(fam.Tabs)+1, server, webNowFn)
	root := ""
	if target.NeedsRoot() {
		root = target.Root
	}
	index, existed, err := webAddFn(ctx, windowID, server, url, root)
	if errors.Is(err, tmux.ErrWebTabsFull) {
		writeError(w, http.StatusConflict, fmt.Sprintf("web tabs full (%d)", tmux.MaxWebTabs))
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	s.initSSEHub()
	s.sseHub.wake(server)

	writeJSON(w, http.StatusCreated, map[string]any{
		"index":   index,
		"existed": existed,
		"url":     target.URL(windowID, index, server, webNowFn),
	})
}

// webSlotParam reads and gates the {n} route param (^[1-8]$) BEFORE any tmux
// call (Constitution §I — pattern-gated before any subprocess).
func webSlotParam(r *http.Request) (int, bool) {
	raw := chi.URLParam(r, "n")
	if !presentSlotPattern.MatchString(raw) {
		return 0, false
	}
	n, _ := strconv.Atoi(raw)
	return n, true
}

// handleWindowWebRemove serves POST /api/windows/{windowId}/web/{n}/remove —
// 200 {"ok":true}; 400 when n is out of the family's range.
func (s *Server) handleWindowWebRemove(w http.ResponseWriter, r *http.Request) {
	windowID, ok := parseWindowID(r)
	if !ok {
		writeError(w, http.StatusBadRequest, "Invalid window ID")
		return
	}
	n, ok := webSlotParam(r)
	if !ok {
		writeError(w, http.StatusBadRequest, "web tab index must be 1..8")
		return
	}

	server := serverFromRequest(r)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := webRemoveFn(ctx, windowID, server, n); err != nil {
		if errors.Is(err, tmux.ErrWebTabRange) {
			writeError(w, http.StatusBadRequest, "web tab index out of range")
			return
		}
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	s.initSSEHub()
	s.sseHub.wake(server)
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// handleWindowWebSelect serves POST /api/windows/{windowId}/web/{n}/select —
// 200 {"ok":true}; 400 when n is out of the family's range.
func (s *Server) handleWindowWebSelect(w http.ResponseWriter, r *http.Request) {
	windowID, ok := parseWindowID(r)
	if !ok {
		writeError(w, http.StatusBadRequest, "Invalid window ID")
		return
	}
	n, ok := webSlotParam(r)
	if !ok {
		writeError(w, http.StatusBadRequest, "web tab index must be 1..8")
		return
	}

	server := serverFromRequest(r)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := webSelectFn(ctx, windowID, server, n); err != nil {
		if errors.Is(err, tmux.ErrWebTabRange) {
			writeError(w, http.StatusBadRequest, "web tab index out of range")
			return
		}
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	s.initSSEHub()
	s.sseHub.wake(server)
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
