package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"rk/internal/inject"
)

// pasteRequest is the POST body for handleWindowPaste. Submit mirrors
// chatSendRequest.Submit: absent or true runs the full paste → probe → Enter
// sequence; an explicit false pastes without the gated Enter (the text is
// left staged in the pane's input). A *bool so absent is distinguishable from
// an explicit false.
type pasteRequest struct {
	Text   string `json:"text"`
	Submit *bool  `json:"submit"`
}

// handleWindowPaste serves POST /api/windows/{windowId}/paste — the compose
// strip's delivery path for MULTI-LINE text. Single-line keystrokes ride the
// relay WebSocket as raw bytes; a multi-line block written to the PTY as one
// non-bracketed chunk is parsed by Claude Code as a single key event whose
// embedded newlines collapse, so multi-line text must arrive as a paste.
// `paste-buffer -p` brackets only when the pane's application requested
// bracketed paste, so a plain shell still receives the raw bytes.
//
// Unlike /chat/send this route requires NO chat session on the window and
// targets the window's ACTIVE pane — the same pane the strip's keystrokes
// reach through the attached relay client — never the chat/agent pane rollup.
// Everything else (sanitize, shared engine, shared deadline, 409 on probe
// failure) is the chat-send contract.
func (s *Server) handleWindowPaste(w http.ResponseWriter, r *http.Request) {
	windowID, ok := parseWindowID(r)
	if !ok {
		writeError(w, http.StatusBadRequest, "Invalid window ID")
		return
	}

	var body pasteRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid JSON body")
		return
	}
	// Sanitize BEFORE the emptiness check so an all-control payload collapses
	// to empty and takes the 400 path rather than pasting nothing.
	body.Text = inject.Sanitize(body.Text)
	if strings.TrimSpace(body.Text) == "" {
		writeError(w, http.StatusBadRequest, "Text cannot be empty")
		return
	}

	server := serverFromRequest(r)

	// One shared deadline bounds the WHOLE route — pane resolution included —
	// so a slow FetchSessions cannot push the request past the 5s rule.
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

	submit := body.Submit == nil || *body.Submit

	if err := s.injectIntoPane(ctx, server, paneID, body.Text, submit); err != nil {
		var probeErr inject.ProbeFailure
		if errors.As(err, &probeErr) {
			writeError(w, http.StatusConflict, probeErr.Error())
			return
		}
		var submitErr inject.SubmitUnverified
		if errors.As(err, &submitErr) {
			writeError(w, http.StatusConflict, submitErr.Error())
			return
		}
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// resolveWindowActivePane finds the window on the server and returns its
// active pane id. found is false when the window does not exist or has no
// panes; err is a FetchSessions infrastructure failure.
func (s *Server) resolveWindowActivePane(ctx context.Context, server, windowID string) (paneID string, found bool, err error) {
	sess, err := s.sessions.FetchSessions(ctx, server)
	if err != nil {
		return "", false, err
	}
	for si := range sess {
		for wi := range sess[si].Windows {
			w := &sess[si].Windows[wi]
			if w.WindowID != windowID {
				continue
			}
			// Same active-pane rule the preview-scope handler uses (preview.go).
			id, ok := activePaneID(*w)
			return id, ok, nil
		}
	}
	return "", false, nil
}
