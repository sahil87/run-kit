package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"rk/internal/inject"
	"rk/internal/tmux"
)

type windowSendRequest struct {
	Text string `json:"text"`
	Mode string `json:"mode"`
	// Pane, when present, retargets the injection from the window's active
	// pane to this pane (%N) — it must belong to the resolved window.
	Pane string `json:"pane"`
}

// handleWindowSend serves POST /api/windows/{windowId}/send — the compose
// strip's only delivery door. The client names an INTENT (mode) and never a
// mechanism: this handler picks the tmux strategy, so a caller cannot make
// verification depend on the shape of the text it happens to be sending.
//
// Unlike /chat/send this route needs NO chat session on the window and targets
// the window's ACTIVE pane (or the body's validated `pane` override), never the
// chat/agent pane rollup — one derivation of "the target pane" for every mode.
func (s *Server) handleWindowSend(w http.ResponseWriter, r *http.Request) {
	windowID, ok := parseWindowID(r)
	if !ok {
		writeError(w, http.StatusBadRequest, "Invalid window ID")
		return
	}

	var body windowSendRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid JSON body")
		return
	}
	if !validWindowSendMode(body.Mode) {
		writeError(w, http.StatusBadRequest, "Invalid send mode")
		return
	}

	body.Text = inject.Sanitize(body.Text)
	if body.Mode != "enter" && strings.TrimSpace(body.Text) == "" {
		writeError(w, http.StatusBadRequest, "Text cannot be empty")
		return
	}
	if body.Pane != "" && !tmux.ValidPaneID(body.Pane) {
		writeError(w, http.StatusBadRequest, "Invalid pane ID")
		return
	}

	server := serverFromRequest(r)
	ctx, cancel := context.WithTimeout(r.Context(), chatSendTotalBudget)
	defer cancel()

	window, err := s.resolveWindow(ctx, server, windowID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if window == nil {
		writeError(w, http.StatusNotFound, "window not found")
		return
	}

	paneID := body.Pane
	if paneID == "" {
		id, ok := activePaneID(*window)
		if !ok {
			writeError(w, http.StatusNotFound, "window not found")
			return
		}
		paneID = id
	} else {
		member := false
		for _, p := range window.Panes {
			if p.PaneID == paneID {
				member = true
				break
			}
		}
		if !member {
			writeError(w, http.StatusBadRequest, fmt.Sprintf("pane %s does not belong to window %s", paneID, windowID))
			return
		}
	}

	tmuxAdapter := chatSendTmux{s.tmux}
	switch body.Mode {
	case "submit":
		err = chatSendEngine.Send(ctx, tmuxAdapter, server, paneID, body.Text, true)
	case "insert-line":
		err = chatSendEngine.Send(ctx, tmuxAdapter, server, paneID, body.Text, false)
	case "raw":
		err = chatSendEngine.SendRaw(ctx, tmuxAdapter, server, paneID, body.Text)
	case "enter":
		err = chatSendEngine.PressEnter(ctx, tmuxAdapter, server, paneID)
	}
	if err != nil {
		var probeErr inject.ProbeFailure
		if errors.As(err, &probeErr) {
			writeErrorCode(w, http.StatusConflict, "probe_failure", probeErr.Error())
			return
		}
		var submitErr inject.SubmitUnverified
		if errors.As(err, &submitErr) {
			writeErrorCode(w, http.StatusConflict, "submit_unverified", submitErr.Error())
			return
		}
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func validWindowSendMode(mode string) bool {
	switch mode {
	case "submit", "insert-line", "raw", "enter":
		return true
	default:
		return false
	}
}

// resolveWindow returns the window record for windowID from one request-scoped
// session snapshot (nil when no window matches).
func (s *Server) resolveWindow(ctx context.Context, server, windowID string) (*tmux.WindowInfo, error) {
	sess, err := s.sessions.FetchSessions(ctx, server)
	if err != nil {
		return nil, err
	}
	for si := range sess {
		for wi := range sess[si].Windows {
			if sess[si].Windows[wi].WindowID == windowID {
				return &sess[si].Windows[wi], nil
			}
		}
	}
	return nil, nil
}
