package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"sort"
	"strings"

	"github.com/go-chi/chi/v5"

	"rk/internal/tmux"
	"rk/internal/validate"
)

// BoardEntryResponse joins a BoardEntry with live window data for the
// GET /api/boards/{name} endpoint.
type BoardEntryResponse struct {
	Server      string          `json:"server"`
	WindowID    string          `json:"windowId"`
	Session     string          `json:"session"`
	WindowIndex int             `json:"windowIndex"`
	WindowName  string          `json:"windowName"`
	OrderKey    string          `json:"orderKey"`
	Panes       []tmux.PaneInfo `json:"panes,omitempty"`
}

func (s *Server) handleBoardsList(w http.ResponseWriter, r *http.Request) {
	boards, err := s.tmux.ListBoards(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if boards == nil {
		boards = []tmux.BoardSummary{}
	}
	writeJSON(w, http.StatusOK, boards)
}

func (s *Server) handleBoardGet(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	if !tmux.ValidBoardName(name) {
		writeError(w, http.StatusBadRequest, "invalid board name")
		return
	}
	entries, err := s.tmux.GetBoard(r.Context(), name)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	out := make([]BoardEntryResponse, 0, len(entries))
	// Build a session->windowID->WindowInfo lookup per server lazily.
	type sessionKey struct{ server, session string }
	cache := make(map[sessionKey][]tmux.WindowInfo)

	// First pass: fetch all sessions per server to resolve window->session.
	serversNeeded := make(map[string]struct{})
	for _, e := range entries {
		serversNeeded[e.Server] = struct{}{}
	}
	for srv := range serversNeeded {
		sessions, sErr := s.tmux.ListSessions(r.Context(), srv)
		if sErr != nil {
			continue
		}
		for _, sess := range sessions {
			windows, wErr := s.tmux.ListWindows(r.Context(), sess.Name, srv)
			if wErr != nil {
				continue
			}
			cache[sessionKey{srv, sess.Name}] = windows
		}
	}

	for _, e := range entries {
		var match *tmux.WindowInfo
		var matchSession string
		for k, windows := range cache {
			if k.server != e.Server {
				continue
			}
			for i := range windows {
				if windows[i].WindowID == e.WindowID {
					match = &windows[i]
					matchSession = k.session
					break
				}
			}
			if match != nil {
				break
			}
		}
		if match == nil {
			// Window vanished between GetBoard and the join — skip.
			continue
		}
		out = append(out, BoardEntryResponse{
			Server:      e.Server,
			WindowID:    e.WindowID,
			Session:     matchSession,
			WindowIndex: match.Index,
			WindowName:  match.Name,
			OrderKey:    e.OrderKey,
			Panes:       match.Panes,
		})
	}
	// Stable sort by orderKey to preserve the GetBoard ordering after the join.
	sort.SliceStable(out, func(i, j int) bool { return out[i].OrderKey < out[j].OrderKey })
	writeJSON(w, http.StatusOK, out)
}

type pinRequestBody struct {
	Server   string `json:"server"`
	WindowID string `json:"windowId"`
}

// reorderRequestBody mirrors the documented API contract — `before` and
// `after` are nullable: `null` (or omitted) means prepend/append, a non-null
// string is the neighbour windowId. Modeled as `*string` so JSON `null`
// decodes cleanly (rather than failing the decoder, which a plain `string`
// would).
type reorderRequestBody struct {
	Server   string  `json:"server"`
	WindowID string  `json:"windowId"`
	Before   *string `json:"before"`
	After    *string `json:"after"`
}

// validatePinRequest decodes & validates the body shared by pin/unpin/reorder
// (the reorder body has additional fields handled separately).
func validatePinRequest(r *http.Request, body interface{}) (string, int) {
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(body); err != nil {
		return "Invalid JSON body", http.StatusBadRequest
	}
	return "", 0
}

func (s *Server) handleBoardPin(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	if !tmux.ValidBoardName(name) {
		writeError(w, http.StatusBadRequest, "invalid board name")
		return
	}
	var body pinRequestBody
	if msg, code := validatePinRequest(r, &body); msg != "" {
		writeError(w, code, msg)
		return
	}
	if errMsg := validate.ValidateServerName(body.Server); errMsg != "" {
		writeError(w, http.StatusBadRequest, errMsg)
		return
	}
	if !tmux.ValidWindowID(body.WindowID) {
		writeError(w, http.StatusBadRequest, "invalid window id")
		return
	}

	// Verify the window exists on the named server before mutating.
	if !s.windowExistsOnServer(r, body.Server, body.WindowID) {
		writeError(w, http.StatusNotFound, "window not found on server")
		return
	}

	if err := s.tmux.PinBoard(r.Context(), body.Server, body.WindowID, name); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	// Best-effort: read the current order key back so the broadcast carries it.
	orderKey := s.lookupOrderKey(r, body.Server, body.WindowID, name)

	s.initSSEHub()
	s.sseHub.broadcastBoardChanged(body.Server, boardChangedPayload{
		Board:    name,
		Change:   "pin",
		Server:   body.Server,
		WindowID: body.WindowID,
		OrderKey: orderKey,
	})

	writeJSON(w, http.StatusCreated, map[string]bool{"ok": true})
}

func (s *Server) handleBoardUnpin(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	if !tmux.ValidBoardName(name) {
		writeError(w, http.StatusBadRequest, "invalid board name")
		return
	}
	var body pinRequestBody
	if msg, code := validatePinRequest(r, &body); msg != "" {
		writeError(w, code, msg)
		return
	}
	if errMsg := validate.ValidateServerName(body.Server); errMsg != "" {
		writeError(w, http.StatusBadRequest, errMsg)
		return
	}
	if !tmux.ValidWindowID(body.WindowID) {
		writeError(w, http.StatusBadRequest, "invalid window id")
		return
	}
	if err := s.tmux.UnpinBoard(r.Context(), body.Server, body.WindowID, name); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.initSSEHub()
	s.sseHub.broadcastBoardChanged(body.Server, boardChangedPayload{
		Board:    name,
		Change:   "unpin",
		Server:   body.Server,
		WindowID: body.WindowID,
	})
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleBoardReorder(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	if !tmux.ValidBoardName(name) {
		writeError(w, http.StatusBadRequest, "invalid board name")
		return
	}
	var body reorderRequestBody
	if msg, code := validatePinRequest(r, &body); msg != "" {
		writeError(w, code, msg)
		return
	}
	if errMsg := validate.ValidateServerName(body.Server); errMsg != "" {
		writeError(w, http.StatusBadRequest, errMsg)
		return
	}
	if !tmux.ValidWindowID(body.WindowID) {
		writeError(w, http.StatusBadRequest, "invalid window id")
		return
	}
	// `before`/`after` are nullable per the API contract. Treat both `null`
	// (pointer is nil) and `""` as prepend/append sentinels for backward
	// compatibility with clients that emit empty strings. Non-empty must be a
	// valid window id.
	before := ""
	if body.Before != nil {
		before = *body.Before
	}
	after := ""
	if body.After != nil {
		after = *body.After
	}
	if before != "" && !tmux.ValidWindowID(before) {
		writeError(w, http.StatusBadRequest, "invalid before window id")
		return
	}
	if after != "" && !tmux.ValidWindowID(after) {
		writeError(w, http.StatusBadRequest, "invalid after window id")
		return
	}
	newKey, err := s.tmux.ReorderBoard(r.Context(), body.Server, body.WindowID, name, before, after)
	if err != nil {
		// Distinguish "neighbour not found" from internal errors.
		if errors.Is(err, errNeighbourNotFound) || strings.Contains(err.Error(), "neighbour window not found") || strings.Contains(err.Error(), "entry not found") {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.initSSEHub()
	s.sseHub.broadcastBoardChanged(body.Server, boardChangedPayload{
		Board:    name,
		Change:   "reorder",
		Server:   body.Server,
		WindowID: body.WindowID,
		OrderKey: newKey,
	})
	writeJSON(w, http.StatusOK, map[string]interface{}{"ok": true, "newOrderKey": newKey})
}

// windowExistsOnServer scans every session on the server and returns true if
// the supplied windowID matches a live window.
func (s *Server) windowExistsOnServer(r *http.Request, server, windowID string) bool {
	sessions, err := s.tmux.ListSessions(r.Context(), server)
	if err != nil {
		return false
	}
	for _, sess := range sessions {
		windows, err := s.tmux.ListWindows(r.Context(), sess.Name, server)
		if err != nil {
			continue
		}
		for _, w := range windows {
			if w.WindowID == windowID {
				return true
			}
		}
	}
	return false
}

// lookupOrderKey returns the order key for a (server, windowID, board) tuple.
// Returns empty string if not found (best-effort — the broadcast tolerates a
// missing key).
func (s *Server) lookupOrderKey(r *http.Request, server, windowID, board string) string {
	entries, err := s.tmux.ListBoardEntries(r.Context(), server)
	if err != nil {
		return ""
	}
	for _, e := range entries {
		if e.WindowID == windowID && e.Board == board {
			return e.OrderKey
		}
	}
	return ""
}
