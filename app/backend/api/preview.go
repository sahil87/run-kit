package api

import (
	"encoding/json"
	"io"
	"net/http"

	"rk/internal/tmux"
)

// previewCaptureLines is the number of trailing lines captured per pane for the
// tile-grid text preview. ~15–20 lines is enough to read "what is this agent
// doing right now" without bloating the SSE `event: preview` payload. Named
// (not a magic number) so the capture depth is tunable in one place.
const previewCaptureLines = 18

// previewScopeMaxBody caps the preview-scope request body so a malicious or
// buggy client cannot force an unbounded read.
const previewScopeMaxBody = 64 * 1024

// activePaneID returns the PaneID of the window's active pane, falling back to
// the first pane when tmux flagged none active (a transient state), and
// ("", false) when the window has no panes at all. Extracted so the selection
// logic is unit-testable without a live tmux server.
func activePaneID(w tmux.WindowInfo) (string, bool) {
	if len(w.Panes) == 0 {
		return "", false
	}
	for _, p := range w.Panes {
		if p.IsActive {
			return p.PaneID, true
		}
	}
	return w.Panes[0].PaneID, true
}

// capturePreviewForWindow captures the trailing text of a window's active pane
// via the existing tmux.CapturePane primitive (Constitution I — exec.Command-
// Context + timeout, arg slices). Returns (text, true) on success; (\"\", false)
// when the window has no pane to capture or the capture errors (best-effort —
// a preview is a nicety, never a hard failure).
func capturePreviewForWindow(w tmux.WindowInfo, server string) (string, bool) {
	paneID, ok := activePaneID(w)
	if !ok {
		return "", false
	}
	text, err := tmux.CapturePane(paneID, previewCaptureLines, server)
	if err != nil {
		return "", false
	}
	return text, true
}

// previewScopeRequest is the body of POST /api/preview-scope. `Conn` addresses a
// specific live SSE connection (its client-supplied `conn` id); `Expanded` is
// the set of session names that connection currently has expanded in the tile
// grid — capture is bounded to windows in these sessions.
type previewScopeRequest struct {
	Conn     string   `json:"conn"`
	Expanded []string `json:"expanded"`
}

// handlePreviewScope records a connection's expanded-session set so the SSE poll
// captures pane previews only for the windows that connection is actually
// viewing. Per-connection, in-memory only (Constitution II) — the set is dropped
// when the connection disconnects. POST per Constitution IX.
func (s *Server) handlePreviewScope(w http.ResponseWriter, r *http.Request) {
	server := serverFromRequest(r)

	var req previewScopeRequest
	dec := json.NewDecoder(io.LimitReader(r.Body, previewScopeMaxBody))
	if err := dec.Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Conn == "" {
		writeError(w, http.StatusBadRequest, "conn is required")
		return
	}

	// Ensure the hub exists (it is lazily created on the first SSE connect; a
	// scope POST may race ahead of the first stream on a fresh server).
	s.initSSEHub()
	s.sseHub.setPreviewScope(server, req.Conn, req.Expanded)

	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
