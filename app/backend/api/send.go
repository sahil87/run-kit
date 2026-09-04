package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"rk/internal/inject"
	"rk/internal/sessions"
	"rk/internal/tmux"
)

type windowSendRequest struct {
	Text string `json:"text"`
	Mode string `json:"mode"`
	// Target selects the pane: empty (default) is the window's ACTIVE pane;
	// "agent" is the window's agent pane (the @rk_pane_agent_session rollup —
	// the selection broadcast's target, where pasting into a non-agent shell
	// must fail closed instead of executing there).
	Target string `json:"target"`
}

// handleWindowSend serves POST /api/windows/{windowId}/send — the compose
// strip's only delivery door. The client names an INTENT (mode) and never a
// mechanism: this handler picks the tmux strategy, so a caller cannot make
// verification depend on the shape of the text it happens to be sending.
//
// The default path needs NO agent session on the window and targets the
// window's ACTIVE pane — one derivation of "the target pane" for every mode.
// With `target:"agent"` the pane resolves via the shared agent-pane rollup
// (`sessions.ResolveAgentPane`: active-pane-first among @rk_pane_agent_session
// carriers, else the first carrier) and a window with no carrier fails closed
// with a 404 — the text is never pasted into a non-agent pane.
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
	if body.Target != "" && body.Target != "agent" {
		writeError(w, http.StatusBadRequest, "Invalid send target")
		return
	}

	body.Text = inject.Sanitize(body.Text)
	if body.Mode != "enter" && strings.TrimSpace(body.Text) == "" {
		writeError(w, http.StatusBadRequest, "Text cannot be empty")
		return
	}

	server := serverFromRequest(r)
	ctx, cancel := context.WithTimeout(r.Context(), agentSendTotalBudget)
	defer cancel()

	var paneID string
	var found bool
	var err error
	if body.Target == "agent" {
		paneID, found, err = s.resolveWindowAgentPane(ctx, server, windowID)
	} else {
		paneID, found, err = s.resolveWindowActivePane(ctx, server, windowID)
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !found {
		if body.Target == "agent" {
			writeError(w, http.StatusNotFound, "no agent session for this window")
		} else {
			writeError(w, http.StatusNotFound, "window not found")
		}
		return
	}

	tmuxAdapter := agentSendTmux{s.tmux}
	switch body.Mode {
	case "submit":
		err = agentSendEngine.Send(ctx, tmuxAdapter, server, paneID, body.Text, true)
	case "insert-line":
		err = agentSendEngine.Send(ctx, tmuxAdapter, server, paneID, body.Text, false)
	case "raw":
		err = agentSendEngine.SendRaw(ctx, tmuxAdapter, server, paneID, body.Text)
	case "enter":
		err = agentSendEngine.PressEnter(ctx, tmuxAdapter, server, paneID)
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

// agentSendTotalBudget is the shared injection deadline: a route threads ONE
// context deadline through the entire injection sequence (baseline capture →
// set-buffer → paste → probe captures → Enter, all subprocesses plus probe and
// submit backoffs), so the route stays bounded under the 5s route-blocking
// rule even when verified recovery takes its full bounded path. Both consumers
// (this route and the operator-request delivery) derive it from the request
// context so a client disconnect also cancels the tmux subprocesses.
const agentSendTotalBudget = 4 * time.Second

// agentSendTmux adapts the Server's TmuxOps seam onto inject.Tmux. The buffer
// name parameter is ignored: the daemon only ever drives the single shared
// rk-agent-send buffer (the engine it is paired with is bound to that name).
type agentSendTmux struct{ ops TmuxOps }

func (a agentSendTmux) CapturePane(ctx context.Context, paneID string, lines int, server string) (string, error) {
	return a.ops.CapturePane(ctx, paneID, lines, server)
}
func (a agentSendTmux) SetBuffer(ctx context.Context, _, text, server string) error {
	return a.ops.SetAgentSendBuffer(ctx, text, server)
}
func (a agentSendTmux) PasteBuffer(ctx context.Context, _, paneID, server string) error {
	return a.ops.PasteAgentSendBuffer(ctx, paneID, server)
}
func (a agentSendTmux) PasteBufferRaw(ctx context.Context, _, paneID, server string) error {
	return a.ops.PasteAgentSendBufferRaw(ctx, paneID, server)
}
func (a agentSendTmux) SendEnter(ctx context.Context, paneID, server string) error {
	return a.ops.SendEnterToPane(ctx, paneID, server)
}
func (a agentSendTmux) SendKeys(ctx context.Context, paneID, server string, keys ...string) error {
	return a.ops.SendKeysToPane(ctx, paneID, server, keys...)
}

// agentSendEngine is the daemon's engine instance: bound to the shared
// rk-agent-send buffer, it carries the per-(server,pane) lock map and the
// set→paste cross-pane mutex (see inject.Engine). Package-level because the
// serialization domain is the tmux server, not the Server value — two sends
// racing the same pane must serialize even across handler instances.
var agentSendEngine = inject.NewEngine(tmux.AgentSendBuffer)

// injectIntoPane is the daemon's ONE adapter onto the shared injection
// engine (internal/inject), serving the operator request path — the engine
// runs baseline capture → set-buffer → paste-buffer (-d -p, bracketed) →
// NOVELTY echo probe → send-keys Enter → whole-frame submit verification and
// evidence-gated recovery, serialized per (server, paneID) with the set→paste
// critical section additionally serialized across panes. See inject.Engine.Send
// for the full sequence contract.
//
// Failure types preserve whether the text is untouched, staged before Enter,
// or unverified after Enter so each caller can give safe recovery guidance.
func (s *Server) injectIntoPane(ctx context.Context, server, paneID, text string, submit bool) error {
	return agentSendEngine.Send(ctx, agentSendTmux{s.tmux}, server, paneID, text, submit)
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

// resolveWindowAgentPane returns the window's agent pane from one
// request-scoped session snapshot, via the shared `sessions.ResolveAgentPane`
// rollup (active-pane-first among @rk_pane_agent_session carriers, else the
// first carrier). found=false means the window is absent OR no pane carries an
// agent session — both fail closed as a 404 for an agent-targeted send.
func (s *Server) resolveWindowAgentPane(ctx context.Context, server, windowID string) (paneID string, found bool, err error) {
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
			_, _, id := sessions.ResolveAgentPane(window.Panes)
			return id, id != "", nil
		}
	}
	return "", false, nil
}
