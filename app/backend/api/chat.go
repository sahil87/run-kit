package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"rk/internal/chat"
	"rk/internal/inject"
	"rk/internal/sessions"
	"rk/internal/tmux"
)

// chatRefResolveInterval is the cadence at which an open chat SUBSCRIPTION's
// producer (chat_ws.go, on /ws/state) re-resolves the window's @rk_chat ref, so a
// session rotation (/clear, /compact — which re-stamps @rk_chat within one hook
// fire) surfaces a fresh `chat-reset` on the same subscription without a client
// reconnect. This same tick also retries a not-yet-created transcript (lazy
// creation post-/clear), so the producer converges on the new session once Claude
// Code writes its first line. Named (not a magic number); slower than the
// transcript tail cadence because rotation is rare relative to appends. A package
// var (not a const) only so tests can shrink it — production always uses this
// value.
var chatRefResolveInterval = 2 * time.Second

// resolveWindowChat resolves a window's reconciled @rk_chat rollup server-side.
// It fetches the server's sessions, finds the window by its stable WindowID, and
// returns the resolved (ChatProvider, ChatSessionRef, PaneID) via
// sessions.ResolveChatPane — the same active-pane-first / else-first-chat-pane
// rule Change 1 applied in FetchSessions. It NEVER trusts a client-supplied ref
// or pane. The paneID is the chat-send injection target: a WINDOW target routes
// to the active pane, which in a split may not be the chat pane, so send targets
// the resolved pane, not the window.
//
// A non-nil error means FetchSessions itself failed (an infrastructure fault the
// caller maps to 500, mirroring handleSessionsList). ok=false with a nil error
// means the fetch succeeded but the window is absent or carries no reconciled
// chat (a genuine 404). The two are distinct so a transient tmux failure is not
// misreported as "no chat session".
func (s *Server) resolveWindowChat(ctx context.Context, server, windowID string) (provider, ref, paneID string, ok bool, err error) {
	sess, err := s.sessions.FetchSessions(ctx, server)
	if err != nil {
		return "", "", "", false, err
	}
	for si := range sess {
		for wi := range sess[si].Windows {
			w := &sess[si].Windows[wi]
			if w.WindowID == windowID {
				p, r, pane := sessions.ResolveChatPane(w.Panes)
				if p == "" {
					return "", "", "", false, nil
				}
				return p, r, pane, true, nil
			}
		}
	}
	return "", "", "", false, nil
}

// handleChatBackfill serves GET /api/windows/{windowId}/chat — the full
// conversation as rk-schema JSON. Reads only (Constitution IX); curl-able.
func (s *Server) handleChatBackfill(w http.ResponseWriter, r *http.Request) {
	windowID, ok := parseWindowID(r)
	if !ok {
		writeError(w, http.StatusBadRequest, "Invalid window ID")
		return
	}
	server := serverFromRequest(r)

	provider, ref, _, ok, err := s.resolveWindowChat(r.Context(), server, windowID)
	if err != nil {
		// FetchSessions itself failed — an infrastructure fault, not a missing
		// chat. Mirror handleSessionsList's 500 rather than reporting "no chat".
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !ok {
		writeError(w, http.StatusNotFound, "no chat session for this window")
		return
	}
	adapter, err := chat.Lookup(provider)
	if err != nil {
		// Well-formed but unregistered provider (codex/gemini in v1) — 404-class.
		writeError(w, http.StatusNotFound, fmt.Sprintf("no adapter for provider %q", provider))
		return
	}
	conv, err := adapter.Backfill(r.Context(), ref)
	if err != nil {
		s.writeChatReadError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, conv)
}

// writeChatReadError maps an adapter read error to an HTTP response. A missing
// transcript for a live ref, or a malformed reconciled ref, is surfaced as a
// 404-class response: the client only ever supplies a windowID, so a bad ref is
// a property of the reconciled @rk_chat (per Change 1's no-disk-validation
// rationale, this endpoint is where those naturally show), not a server fault.
// Any other read error is a 500.
func (s *Server) writeChatReadError(w http.ResponseWriter, err error) {
	if errors.Is(err, chat.ErrTranscriptNotFound) {
		writeError(w, http.StatusNotFound, "transcript not found for session")
		return
	}
	if errors.Is(err, chat.ErrInvalidRef) {
		writeError(w, http.StatusNotFound, "malformed chat session ref for this window")
		return
	}
	writeError(w, http.StatusInternalServerError, err.Error())
}

// --- chat send (260714-jdyg-chat-send) --------------------------------------

// The injection sequence itself (baseline capture → set-buffer → bracketed
// paste → novelty echo probe → probe-gated Enter, with the per-(server,pane)
// lock map and the set→paste critical-section mutex) lives in
// internal/inject, shared with the `rk mux send` CLI verb. What stays here is
// the ROUTE layer: request parsing, pane re-resolution, the probe-failure →
// 409 mapping, and chatSendTotalBudget, which bounds the whole sequence per
// request.
//
// chatSendTotalBudget: the route threads ONE shared context deadline through
// the entire injection sequence (all 6 subprocesses plus the settle/retry
// sleeps share this one deadline), so the route stays bounded well under the 5s
// route-blocking rule (code-review.md) even on a slow tmux. Comfortably covers
// the 240ms of probe sleeps with headroom for the tmux exec latencies.
const chatSendTotalBudgetDefault = 4 * time.Second

// chatSendTotalBudget is the shared injection deadline (see
// chatSendTotalBudgetDefault). A package var (not a const) SOLELY so a test can
// shrink it to assert the deadline aborts the sequence; production always uses
// the default.
var chatSendTotalBudget = chatSendTotalBudgetDefault

// chatSendTmux adapts the Server's TmuxOps seam onto inject.Tmux. The buffer
// name parameter is ignored: the daemon only ever drives the single shared
// rk-chat-send buffer (the engine it is paired with is bound to that name).
type chatSendTmux struct{ ops TmuxOps }

func (a chatSendTmux) CapturePane(ctx context.Context, paneID string, lines int, server string) (string, error) {
	return a.ops.CapturePane(ctx, paneID, lines, server)
}
func (a chatSendTmux) SetBuffer(ctx context.Context, _, text, server string) error {
	return a.ops.SetChatSendBuffer(ctx, text, server)
}
func (a chatSendTmux) PasteBuffer(ctx context.Context, _, paneID, server string) error {
	return a.ops.PasteChatSendBuffer(ctx, paneID, server)
}
func (a chatSendTmux) SendEnter(ctx context.Context, paneID, server string) error {
	return a.ops.SendEnterToPane(ctx, paneID, server)
}

// chatSendEngine is the daemon's engine instance: bound to the shared
// rk-chat-send buffer, it carries the per-(server,pane) lock map and the
// set→paste cross-pane mutex (see inject.Engine). Package-level because the
// serialization domain is the tmux server, not the Server value — two sends
// racing the same pane must serialize even across handler instances.
var chatSendEngine = inject.NewEngine(tmux.ChatSendBuffer)

// chatSendRequest is the POST body for handleChatSend. Submit is additive and
// optional (260719-mxvw): absent or true keeps the full sequence (paste → probe
// → Enter); false is insert-without-submit — the final gated Enter is skipped
// and the text is left staged in the agent's input box. A *bool so an absent
// field is distinguishable from an explicit false (absent ⇒ true — older
// clients are unaffected).
type chatSendRequest struct {
	Text   string `json:"text"`
	Submit *bool  `json:"submit"`
}

// handleChatSend serves POST /api/windows/{windowId}/chat/send — injects a
// message into the window's resolved agent pane. Mutation ⇒ POST (Constitution
// IX). It re-resolves the pane server-side (the client supplies only a windowID
// and the text), pastes the text into the pane via a named tmux buffer, probes
// that it echoed into the live input buffer, and ONLY THEN sends Enter. A probe
// failure withholds Enter and returns 409 (structured), leaving the pasted text
// visibly in the TUI input box — recoverable state, never a blind Enter.
//
// Busy policy is Allow + probe (user-decided): there is NO agentState gate and
// NO server-side queue (Constitution II). A busy (active) agent receives the
// paste into its TUI input box, which Claude Code queues natively (steering);
// the probe is the sole guard.
func (s *Server) handleChatSend(w http.ResponseWriter, r *http.Request) {
	windowID, ok := parseWindowID(r)
	if !ok {
		writeError(w, http.StatusBadRequest, "Invalid window ID")
		return
	}

	var body chatSendRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid JSON body")
		return
	}
	// Strip terminal control bytes BEFORE the emptiness check so every downstream
	// consumer (needle, multiline detection, paste, probe) sees the sanitized text
	// and an all-control message collapses to empty and takes the existing 400 path.
	body.Text = inject.Sanitize(body.Text)
	if strings.TrimSpace(body.Text) == "" {
		writeError(w, http.StatusBadRequest, "Message text cannot be empty")
		return
	}

	server := serverFromRequest(r)

	_, _, paneID, ok, err := s.resolveWindowChat(r.Context(), server, windowID)
	if err != nil {
		// FetchSessions itself failed — infrastructure fault (mirror the read
		// endpoints' 500), not a missing chat.
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !ok {
		writeError(w, http.StatusNotFound, "no chat session for this window")
		return
	}

	// One shared deadline for the WHOLE injection sequence (Constitution /
	// Process Execution + code-review.md's 5s route-blocking rule): baseline
	// capture → set → paste → probe captures → Enter all run under this single
	// context, so the route can never block for the old worst case of 6 × 10s.
	// Derived from the request context so a client disconnect also cancels the
	// tmux subprocesses.
	ctx, cancel := context.WithTimeout(r.Context(), chatSendTotalBudget)
	defer cancel()

	// Insert-without-submit (260719-mxvw): submit defaults to true when the
	// field is absent — only an explicit `"submit": false` skips the final Enter.
	submit := body.Submit == nil || *body.Submit

	// Provider-agnostic tmux injection behind a small function seam so Change 5's
	// protocol-based codex send can later branch on provider without reshaping
	// this handler. v1 makes NO provider branch.
	if err := s.injectChatMessage(ctx, server, paneID, body.Text, submit); err != nil {
		var probeErr inject.ProbeFailure
		if errors.As(err, &probeErr) {
			// Probe failed — no Enter was sent; the pasted text is left visible in
			// the TUI input box (recoverable state), and the failure is surfaced.
			writeError(w, http.StatusConflict, probeErr.Error())
			return
		}
		// A tmux subprocess failure (set-buffer / paste-buffer / capture / Enter).
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// injectChatMessage is the handler's thin adapter onto the shared injection
// engine (internal/inject) — the engine runs baseline capture → set-buffer →
// paste-buffer (-d -p, bracketed) → NOVELTY echo probe → send-keys Enter (only
// on probe success AND submit), serialized per (server, paneID) with the
// set→paste critical section additionally serialized across panes. See
// inject.Engine.Send for the full sequence contract.
//
// A tmux failure is returned verbatim (→ 500); a probe failure is returned as
// inject.ProbeFailure (→ 409, Enter withheld).
func (s *Server) injectChatMessage(ctx context.Context, server, paneID, text string, submit bool) error {
	return chatSendEngine.Send(ctx, chatSendTmux{s.tmux}, server, paneID, text, submit)
}
