package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

	"rk/internal/chat"
	"rk/internal/inject"
	"rk/internal/sessions"
	"rk/internal/tmux"
)

// operatorFacts are the server-derived inputs every operator-request template
// renders from. ALL of them are derivable (Constitution X — hooks carry only
// the underivable, and templates carry nothing at all from the client): the
// request body holds only a closed-set template id, so no client text can ever
// reach the rendered prompt.
type operatorFacts struct {
	WindowID       string // subject window, @N (survives moves, collision-proof)
	Name           string // current window name
	TranscriptPath string // absolute chat-JSONL path (via chat.TranscriptPath)
	WorktreePath   string
	FabChange      string // rendered only when non-empty
	FabStage       string
}

// operatorTemplate is one closed-registry entry: a declared fact requirement
// plus a PURE render func (plain string composition — no text/template).
type operatorTemplate struct {
	// requiresChatRef declares that the template needs the subject window's
	// reconciled chat session (its transcript path); a subject without one is a
	// 404 before any delivery.
	requiresChatRef bool
	render          func(f operatorFacts) string
}

// operatorTemplates is the closed in-code template registry. An id outside
// this map is a 400 — the /options key-allowlist posture (Constitution I).
var operatorTemplates = map[string]operatorTemplate{
	// fix-tab-name: the operator reads the subject tab's recent JSONL turns and
	// renames the window through its own shell; the result arrives via the
	// normal derive tick — there is no response channel.
	"fix-tab-name": {
		requiresChatRef: true,
		render:          renderFixTabName,
	},
}

// renderFixTabName composes the fix-tab-name prompt. It is self-contained (the
// operator needs no rk-specific knowledge), names the exact actuation command
// with the @N target, and explicitly bounds the operator's action.
func renderFixTabName(f operatorFacts) string {
	contextLine := fmt.Sprintf("Context: worktree %s", f.WorktreePath)
	if f.FabChange != "" {
		contextLine += fmt.Sprintf("; fab change %s at stage %s", f.FabChange, f.FabStage)
	}
	return fmt.Sprintf(`[run-kit request] Fix the tab name for tmux window %s (currently %q) on this server.

Read the recent conversation in the transcript to see what this tab is actually working on: %s
(read the tail of the file — the last ~30 JSONL lines are enough)

%s.

Then rename the window to a short, accurate name (2-4 words, kebab-case preferred):
  tmux rename-window -t %s "<new-name>"

Do not reply to this message or take any other action.`,
		f.WindowID, f.Name, f.TranscriptPath, contextLine, f.WindowID)
}

// operatorRequestBody is the POST body for handleOperatorRequest. It carries
// ONLY the closed-set template id — no client-supplied text ever reaches the
// rendered prompt (Constitution I).
type operatorRequestBody struct {
	Template string `json:"template"`
}

// handleOperatorRequest serves POST /api/windows/{windowId}/operator-request —
// hands the server's operator window a templated work item ABOUT the subject
// window ({windowId}), delivered via the existing chat-send injection
// machinery. Mutation ⇒ POST (Constitution IX). Everything is resolved
// server-side from ONE FetchSessions pass: subject + operator lookup, fact
// derivation, and the busy gate all read the same result. There is no queue,
// no response channel, and no state written anywhere (Constitution II) — the
// operator acts through its shell (e.g. `tmux rename-window`) and the outcome
// surfaces on the normal derive tick, so the handler never wakes the SSE hub.
//
// Busy policy is REJECT (unlike chat-send's allow+probe): an active or waiting
// operator is a 409 naming the state; idle or unknown proceeds (the novelty
// echo probe remains the final fail-closed guard).
func (s *Server) handleOperatorRequest(w http.ResponseWriter, r *http.Request) {
	windowID, ok := parseWindowID(r)
	if !ok {
		writeError(w, http.StatusBadRequest, "Invalid window ID")
		return
	}

	var body operatorRequestBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid JSON body")
		return
	}
	tmpl, ok := operatorTemplates[body.Template]
	if !ok {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("unknown operator template %q", body.Template))
		return
	}

	server := serverFromRequest(r)

	sess, err := s.sessions.FetchSessions(r.Context(), server)
	if err != nil {
		// FetchSessions itself failed — an infrastructure fault, not a missing
		// window (mirror the chat endpoints' 500).
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	var subject, operator *tmux.WindowInfo
	for si := range sess {
		for wi := range sess[si].Windows {
			win := &sess[si].Windows[wi]
			if win.WindowID == windowID {
				subject = win
			}
			if win.Role == "operator" {
				operator = win
			}
		}
	}
	if subject == nil {
		writeError(w, http.StatusNotFound, "window not found")
		return
	}
	if operator == nil {
		// The UI hides the action in this state (degrade to absent); this error
		// is the race backstop.
		writeError(w, http.StatusNotFound, "no operator on this server")
		return
	}

	facts := operatorFacts{
		WindowID:     windowID,
		Name:         subject.Name,
		WorktreePath: subject.WorktreePath,
		FabChange:    subject.FabChange,
		FabStage:     subject.FabStage,
	}
	if tmpl.requiresChatRef {
		if subject.ChatSessionRef == "" {
			writeError(w, http.StatusNotFound, "no chat session for this window")
			return
		}
		path, err := chat.TranscriptPath(subject.ChatProvider, subject.ChatSessionRef)
		if err != nil {
			if errors.Is(err, chat.ErrNoAdapter) {
				writeError(w, http.StatusNotFound, fmt.Sprintf("no adapter for provider %q", subject.ChatProvider))
				return
			}
			// ErrInvalidRef / ErrTranscriptNotFound map to the same 404-class
			// vocabulary as the chat read endpoints.
			s.writeChatReadError(w, err)
			return
		}
		facts.TranscriptPath = path
	}

	// Busy gate — reject, never queue: `waiting` means a human-blocking dialog
	// is up (pasting into it is the blind-typing hazard the probe exists for);
	// idle or empty state proceeds (unknown must pass or a hookless operator
	// could never receive requests; the probe still fail-closes delivery).
	switch operator.AgentState {
	case tmux.AgentStateActive, tmux.AgentStateWaiting:
		writeError(w, http.StatusConflict, fmt.Sprintf("operator is busy (%s) — request not delivered; try again when it is idle", operator.AgentState))
		return
	}

	// Delivery targets the OPERATOR window's resolved chat pane (active-pane-
	// first rollup, same rule chat-send uses) — never the subject's pane, never
	// a window id. An operator without a reconciled chat pane can't receive
	// requests.
	_, _, operatorPaneID := sessions.ResolveChatPane(operator.Panes)
	if operatorPaneID == "" {
		writeError(w, http.StatusNotFound, "operator window has no chat session")
		return
	}

	// One shared deadline for the whole injection sequence (see handleChatSend).
	ctx, cancel := context.WithTimeout(r.Context(), chatSendTotalBudget)
	defer cancel()

	if err := s.injectChatMessage(ctx, server, operatorPaneID, tmpl.render(facts), true); err != nil {
		var probeErr inject.ProbeFailure
		if errors.As(err, &probeErr) {
			// Text pasted, Enter withheld — recoverable state (same as chat-send).
			writeError(w, http.StatusConflict, probeErr.Error())
			return
		}
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
