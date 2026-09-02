package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"rk/internal/inject"
)

type windowSendRequest struct {
	Text string `json:"text"`
	Mode string `json:"mode"`
}

// handleWindowSend serves POST /api/windows/{windowId}/send — the compose
// strip's only delivery door. The client names an INTENT (mode) and never a
// mechanism: this handler picks the tmux strategy, so a caller cannot make
// verification depend on the shape of the text it happens to be sending.
//
// Unlike /chat/send this route needs NO chat session on the window and targets
// the window's ACTIVE pane, never the chat/agent pane rollup — one derivation
// of "the target pane" for every mode.
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

	server := serverFromRequest(r)
	ctx, cancel := context.WithTimeout(r.Context(), chatSendTotalBudget)
	defer cancel()

	paneID, found, err := s.resolveWindowActivePane(ctx, server, windowID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !found {
		writeError(w, http.StatusNotFound, "window not found")
		return
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
		logArgs := []any{
			"server", server,
			"windowID", windowID,
			"paneID", paneID,
			"mode", body.Mode,
			"err", err,
		}
		if isRecoverableSendFailure(err) {
			s.logger.Warn("window send failed", logArgs...)
		} else {
			s.logger.Error("window send failed", logArgs...)
		}
		var probeErr inject.ProbeFailure
		if errors.As(err, &probeErr) {
			writeErrorCode(w, http.StatusConflict, "probe_failure", probeErr.Error())
			return
		}
		var stagedErr inject.StagedSendFailure
		if errors.As(err, &stagedErr) {
			writeErrorCode(w, http.StatusConflict, "staged_send_failure", stagedErr.Error())
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

func isRecoverableSendFailure(err error) bool {
	var probeErr inject.ProbeFailure
	if errors.As(err, &probeErr) {
		return true
	}
	var stagedErr inject.StagedSendFailure
	if errors.As(err, &stagedErr) {
		return true
	}
	var submitErr inject.SubmitUnverified
	return errors.As(err, &submitErr)
}

func validWindowSendMode(mode string) bool {
	switch mode {
	case "submit", "insert-line", "raw", "enter":
		return true
	default:
		return false
	}
}

// resolveWindowActivePane returns the active pane for a window from one
// request-scoped session snapshot.
func (s *Server) resolveWindowActivePane(ctx context.Context, server, windowID string) (paneID string, found bool, err error) {
	sess, err := s.sessions.FetchSessions(ctx, server)
	if err != nil {
		return "", false, err
	}
	for si := range sess {
		for wi := range sess[si].Windows {
			window := &sess[si].Windows[wi]
			if window.WindowID != windowID {
				continue
			}
			id, ok := activePaneID(*window)
			return id, ok, nil
		}
	}
	return "", false, nil
}
