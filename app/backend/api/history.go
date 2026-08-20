package api

import (
	"net/http"
)

// handleWindowHistory serves GET /api/windows/{windowId}/history — the window's
// full scrollback as plain text, captured from tmux at request time
// (Constitution II derive-at-request-time; a read ⇒ GET, Constitution IX). The
// capture targets the WINDOW id, which tmux resolves to its active pane — the
// same pane the relay attaches to (the KillActivePane precedent). The client
// buffer only holds what streamed since attach, so this server-capture arm is
// the honest full-history artifact behind the export menu's "Download pane
// history" row.
func (s *Server) handleWindowHistory(w http.ResponseWriter, r *http.Request) {
	windowID, ok := parseWindowID(r)
	if !ok {
		writeError(w, http.StatusBadRequest, "Invalid window ID")
		return
	}

	body, err := s.tmux.CaptureWindowHistory(r.Context(), windowID, serverFromRequest(r))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(body))
}
