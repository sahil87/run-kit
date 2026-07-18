package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"sort"
	"strings"

	"github.com/go-chi/chi/v5"

	"rk/internal/settings"
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
	// Apply the user-defined display order at the API layer (internal/tmux stays
	// settings-unaware). ListBoards already returns alphabetical; the response
	// order IS the display order for every consumer — there is one list source,
	// so this is the single sort choke point.
	boards = sortBoardsByStoredOrder(boards, settings.GetBoardOrder())
	writeJSON(w, http.StatusOK, boards)
}

// sortBoardsByStoredOrder reorders the alphabetical board list by the stored
// order: boards present in `order` first (by their index in `order`), then any
// board absent from `order` after them, alphabetically. Stale names in `order`
// (boards that no longer exist) are ignored — they simply match nothing. Pure:
// takes the order slice explicitly so it is unit-testable without touching the
// filesystem. Mirrors the rank-aware server sort's unranked-last behavior.
func sortBoardsByStoredOrder(boards []tmux.BoardSummary, order []string) []tmux.BoardSummary {
	if len(order) == 0 || len(boards) == 0 {
		return boards
	}
	rank := make(map[string]int, len(order))
	for i, name := range order {
		// First occurrence wins (defensive against a duplicate in the stored list).
		if _, seen := rank[name]; !seen {
			rank[name] = i
		}
	}
	out := make([]tmux.BoardSummary, len(boards))
	copy(out, boards)
	sort.SliceStable(out, func(i, j int) bool {
		ri, iRanked := rank[out[i].Name]
		rj, jRanked := rank[out[j].Name]
		switch {
		case iRanked && jRanked:
			return ri < rj // both ranked: by stored index
		case iRanked != jRanked:
			return iRanked // ranked boards before unranked
		default:
			return out[i].Name < out[j].Name // both unranked: alphabetical
		}
	})
	return out
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

	// Join each board entry with live window data. A pinned window is LINKED into
	// its own single-window pin-session `_rk-pin-<id>` (it is ALSO a member of its
	// home session, but that session's identity is not what the board renders).
	// The pin-session itself is one the user-facing `ListSessions`/`parseSessions`
	// path deliberately HIDES (the `_rk-pin-` skip), so look the window up in its
	// OWN pin-session directly: the entry's WindowID maps deterministically to its
	// pin-session name, and `ListWindows -t <pinSession>` is a by-name target query
	// that is NOT subject to the session-list filter and still holds the window
	// under its pin link. O(entries) targeted lookups.
	for _, e := range entries {
		pinSession, ok := tmux.PinSessionName(e.WindowID)
		if !ok {
			// Malformed window id (should not occur — entries come from pin
			// sessions) — skip defensively.
			continue
		}
		windows, wErr := s.tmux.ListWindows(r.Context(), pinSession, e.Server)
		if wErr != nil || len(windows) == 0 {
			// Pin-session vanished between GetBoard and the join (window/pin
			// killed) — skip; the board simply shows one fewer pane.
			continue
		}
		// A pin-session holds exactly one window — its sole window IS the pinned
		// window. Match by WindowID defensively in case of an unexpected extra.
		win := windows[0]
		for _, w := range windows {
			if w.WindowID == e.WindowID {
				win = w
				break
			}
		}
		out = append(out, BoardEntryResponse{
			Server:      e.Server,
			WindowID:    e.WindowID,
			Session:     pinSession,
			WindowIndex: win.Index,
			WindowName:  win.Name,
			OrderKey:    e.OrderKey,
			Panes:       win.Panes,
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

// handleBoardOrderPost persists the user-defined board display order and
// broadcasts it to every connected SSE client (server-global — see
// broadcastBoardOrder). The client sends the FULL ordered list of board names.
// POST /api/boards/order ← {"order": ["deploys", "reviews", ...]} → 200 {"ok": true}
//
// Uniform POST per Constitution IX. Each name is validated with ValidBoardName;
// an invalid or duplicate name (or a malformed body) is a 400 before any write.
// Every reorder replaces the full stored list, so stale names self-heal.
func (s *Server) handleBoardOrderPost(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Order []string `json:"order"`
	}
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid JSON body — expected {\"order\": [\"name\", ...]}")
		return
	}
	if body.Order == nil {
		body.Order = []string{}
	}
	seen := make(map[string]struct{}, len(body.Order))
	for _, name := range body.Order {
		if !tmux.ValidBoardName(name) {
			writeError(w, http.StatusBadRequest, "invalid board name: "+name)
			return
		}
		if _, dup := seen[name]; dup {
			writeError(w, http.StatusBadRequest, "Duplicate board name in order: "+name)
			return
		}
		seen[name] = struct{}{}
	}

	if err := settings.SetBoardOrder(body.Order); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	// Broadcast the new order to every connected state-socket client
	// (host-global, so even a zero-attached-server Host tab with only a
	// metrics subscription hears it).
	s.initSSEHub()
	s.sseHub.broadcastBoardOrder(body.Order)

	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// windowExistsOnServer returns true if the supplied windowID matches a live
// window on the server — whether the window is in a normal (home) session OR
// linked into its own pin-session (a pinned window is a member of both).
//
// The pin-session fast path is kept as an optimization and for robustness: under
// the link model an already-pinned window ALSO appears in its home session, so
// the home-session scan below would find it too — but `ListSessions`/
// `parseSessions` HIDES `_rk-pin-*` sessions, and checking the pin-session
// directly resolves an already-pinned window in one by-name lookup without
// scanning every home session. Either path makes a re-pin (e.g. moving it to a
// different board) reach tmux.Pin's wrong-board re-stamp path rather than 404.
func (s *Server) windowExistsOnServer(r *http.Request, server, windowID string) bool {
	// Fast path: the window's own pin-session (by-name target, not subject to the
	// session-list filter). If present, the window is already pinned and live.
	if pinSession, ok := tmux.PinSessionName(windowID); ok {
		if windows, err := s.tmux.ListWindows(r.Context(), pinSession, server); err == nil {
			for _, w := range windows {
				if w.WindowID == windowID {
					return true
				}
			}
		}
	}
	// Otherwise scan the visible (home) sessions.
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
