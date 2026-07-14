package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"rk/internal/chat"
)

// chatRefResolveInterval is the cadence at which an open chat stream re-resolves
// the window's @rk_chat ref, so a session rotation (/clear, /compact — which
// re-stamps @rk_chat within one hook fire) surfaces a fresh backfill on the same
// connection without a client reconnect. This same tick also retries a not-yet
// -created transcript (lazy creation post-/clear), so the stream converges on
// the new session once Claude Code writes its first line. Named (not a magic
// number); slower than the transcript tail cadence because rotation is rare
// relative to appends. A package var (not a const) only so tests can shrink it —
// production always uses this value.
var chatRefResolveInterval = 2 * time.Second

// resolveWindowChat resolves a window's reconciled @rk_chat rollup server-side.
// It fetches the server's sessions, finds the window by its stable WindowID, and
// returns the window's rolled-up (ChatProvider, ChatSessionRef) — the same
// active-pane-first / else-first-pane rule Change 1 applied in FetchSessions. It
// NEVER trusts a client-supplied ref.
//
// A non-nil error means FetchSessions itself failed (an infrastructure fault the
// caller maps to 500, mirroring handleSessionsList). ok=false with a nil error
// means the fetch succeeded but the window is absent or carries no reconciled
// chat (a genuine 404). The two are distinct so a transient tmux failure is not
// misreported as "no chat session".
func (s *Server) resolveWindowChat(ctx context.Context, server, windowID string) (provider, ref string, ok bool, err error) {
	sess, err := s.sessions.FetchSessions(ctx, server)
	if err != nil {
		return "", "", false, err
	}
	for si := range sess {
		for wi := range sess[si].Windows {
			w := &sess[si].Windows[wi]
			if w.WindowID == windowID {
				if w.ChatProvider == "" {
					return "", "", false, nil
				}
				return w.ChatProvider, w.ChatSessionRef, true, nil
			}
		}
	}
	return "", "", false, nil
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

	provider, ref, ok, err := s.resolveWindowChat(r.Context(), server, windowID)
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

// handleChatStream serves GET /api/windows/{windowId}/chat/stream — a dedicated
// per-view SSE stream (NOT the shared sessions hub). On connect it emits one
// `chat-backfill` event, then incremental `chat` (appended events) and
// `chat-state` (pending transitions) events as the transcript grows. It also
// re-resolves the window's @rk_chat ref on chatRefResolveInterval so a session
// rotation emits a fresh `chat-backfill` (reset) on the same connection.
//
// Lazy-transcript tolerance: Claude Code writes a session's `.jsonl` LAZILY —
// only on the first prompt — while @rk_chat re-stamps at SessionStart, BEFORE
// any prompt. So immediately after a real /clear (and on a brand-new/just-cleared
// session at initial connect) the transcript does not exist yet. A "not found"
// from Tail is therefore treated as "not yet", not terminal: the connection is
// kept open and the tail is retried each re-resolve tick until the file appears,
// at which point the tail's first Update (a Reset) delivers the backfill. This
// mirrors tailLoop's own stat-vanish tolerance (internal/chat/claude.go).
//
// Client disconnect is handled via the request context — the handler returns
// without throwing (code-review.md) and every goroutine it starts is bound to
// that context (Constitution II — nothing outlives the stream).
func (s *Server) handleChatStream(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "Streaming not supported", http.StatusInternalServerError)
		return
	}
	windowID, ok := parseWindowID(r)
	if !ok {
		writeError(w, http.StatusBadRequest, "Invalid window ID")
		return
	}
	server := serverFromRequest(r)

	// Resolve BEFORE committing SSE headers so a genuine no-chat / no-adapter /
	// fetch-failure can still be reported as an HTTP status.
	provider, ref, ok, err := s.resolveWindowChat(r.Context(), server, windowID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !ok {
		writeError(w, http.StatusNotFound, "no chat session for this window")
		return
	}
	adapter, err := chat.Lookup(provider)
	if err != nil {
		writeError(w, http.StatusNotFound, fmt.Sprintf("no adapter for provider %q", provider))
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	cs := &chatStream{
		s:        s,
		server:   server,
		windowID: windowID,
		provider: provider,
		ref:      ref,
		adapter:  adapter,
	}
	cs.run(r.Context(), w, flusher)
}

// chatStream holds the mutable per-connection state for a chat SSE stream: the
// currently-subscribed provider/ref/adapter and the live tail subscription. It
// owns exactly one tail context at a time; the previous is cancelled before the
// next is started, so no goroutine outlives the connection.
type chatStream struct {
	s        *Server
	server   string
	windowID string

	provider string
	ref      string
	adapter  chat.Adapter

	updates    <-chan chat.Update // nil while awaiting a not-yet-existing transcript
	tailCancel context.CancelFunc // nil until a tail is live
}

// run is the stream's select loop: heartbeats, the ~2s ref re-resolve, and the
// live tail. It returns (cleanly, without throwing) on client disconnect,
// lifetime cap, or an unrecoverable tail error.
func (cs *chatStream) run(ctx context.Context, w http.ResponseWriter, flusher http.Flusher) {
	// The deferred closure re-reads cs.tailCancel so it always cancels the LATEST
	// tail context (a re-subscribe reassigns it), preventing a goroutine leak on
	// any return path.
	defer func() {
		if cs.tailCancel != nil {
			cs.tailCancel()
		}
	}()

	// Initial subscribe. A not-yet-existing transcript (lazy creation) is NOT
	// terminal — leave cs.updates nil and let the re-resolve ticker retry.
	if fatal := cs.subscribe(ctx, cs.provider, cs.ref, cs.adapter); fatal != nil {
		cs.s.writeSSEError(w, flusher, fatal)
		return
	}

	// Lifetime cap mirrors the sessions SSE handler.
	lifetime := time.NewTimer(maxLifetime)
	defer lifetime.Stop()

	heartbeat := time.NewTicker(sseHeartbeatPeriod)
	defer heartbeat.Stop()

	refResolve := time.NewTicker(chatRefResolveInterval)
	defer refResolve.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-lifetime.C:
			return
		case <-heartbeat.C:
			if !writeSSE(w, flusher, ": heartbeat\n\n") {
				return
			}
		case <-refResolve.C:
			if fatal := cs.reresolve(ctx); fatal != nil {
				cs.s.writeSSEError(w, flusher, fatal)
				return
			}
		case u, ok := <-cs.updates:
			if !ok {
				// Tail channel closed (its ctx was cancelled on a re-subscribe) —
				// reresolve has already opened a replacement (or is awaiting the
				// transcript). Drop the stale channel so we stop selecting on it.
				cs.updates = nil
				continue
			}
			if !cs.s.emitChatUpdate(w, flusher, u) {
				return
			}
		}
	}
}

// reresolve runs one ~2s re-resolve tick. It re-resolves the window's @rk_chat
// and, when the target changed OR no tail is currently live (awaiting a
// lazily-created transcript), (re)subscribes on the SAME connection. A fresh ref
// yields a fresh `chat-backfill` (reset) via the new tail's first Update.
//
// It returns a non-nil error ONLY for an unrecoverable tail failure (which run
// surfaces as an SSE error). A FetchSessions failure mid-stream is transient and
// tolerated (headers are already committed, so no HTTP status can be set); a
// not-yet-existing transcript is likewise tolerated and retried next tick.
func (cs *chatStream) reresolve(ctx context.Context) error {
	newProvider, newRef, ok, err := cs.s.resolveWindowChat(ctx, cs.server, cs.windowID)
	if err != nil {
		// Transient fetch failure — keep the current subscription and retry.
		return nil
	}
	if !ok {
		// The window lost its reconciled chat (or vanished). Keep the connection
		// open; a subsequent tick may see it return. Do not tear the live tail.
		return nil
	}

	haveLiveTail := cs.updates != nil
	if newRef == cs.ref && newProvider == cs.provider && haveLiveTail {
		return nil // nothing changed and the tail is healthy
	}

	// Resolve the adapter for the (possibly new) provider BEFORE committing any
	// state. On a Lookup miss for a changed provider, keep the current
	// subscription untouched and retry next tick — never commit a ref we cannot
	// serve, and never call the OLD adapter with the NEW ref.
	adapter := cs.adapter
	if newProvider != cs.provider {
		a2, lerr := chat.Lookup(newProvider)
		if lerr != nil {
			return nil // keep old subscription; retry next tick
		}
		adapter = a2
	}

	return cs.subscribe(ctx, newProvider, newRef, adapter)
}

// subscribe tears down any live tail and starts a fresh one for (provider, ref)
// on a new context bound to ctx, committing the provider/ref/adapter only on a
// successful (or not-yet) subscription. A not-yet-existing transcript
// (ErrTranscriptNotFound / ErrInvalidRef) is NOT fatal: cs.updates is left nil
// and the caller's re-resolve ticker retries until the transcript appears.
// Returns a non-nil error only for an unrecoverable tail failure.
func (cs *chatStream) subscribe(ctx context.Context, provider, ref string, adapter chat.Adapter) error {
	//nolint:fatcontext // deliberate: one live tail context at a time; the prior
	// is cancelled here before the next starts, and run's defer cancels the last.
	tailCtx, cancel := context.WithCancel(ctx)
	updates, err := adapter.Tail(tailCtx, ref)
	if err != nil {
		cancel()
		if errors.Is(err, chat.ErrTranscriptNotFound) || errors.Is(err, chat.ErrInvalidRef) {
			// Not-yet: the session re-stamped @rk_chat before Claude Code wrote the
			// transcript (lazy creation). Commit the target so the next tick retries
			// THIS ref, tear down any stale tail, and await the file.
			if cs.tailCancel != nil {
				cs.tailCancel()
				cs.tailCancel = nil
			}
			cs.provider, cs.ref, cs.adapter = provider, ref, adapter
			cs.updates = nil
			return nil
		}
		return err
	}

	// Success — swap in the new tail, tearing down the old one.
	if cs.tailCancel != nil {
		cs.tailCancel()
	}
	cs.provider, cs.ref, cs.adapter = provider, ref, adapter
	cs.updates = updates
	cs.tailCancel = cancel
	return nil
}

// emitChatUpdate renders one adapter Update to the SSE stream: a Reset becomes a
// `chat-backfill` event; an incremental update becomes a `chat` event (appended
// events) followed by a `chat-state` event (pending transition). Returns false
// when a write fails (client gone) so the caller stops.
func (s *Server) emitChatUpdate(w http.ResponseWriter, flusher http.Flusher, u chat.Update) bool {
	if u.Reset {
		if u.Conv == nil {
			return true
		}
		return writeSSEJSON(w, flusher, "chat-backfill", u.Conv)
	}
	if len(u.Events) > 0 {
		if !writeSSEJSON(w, flusher, "chat", u.Events) {
			return false
		}
	}
	// Pending transition (may be nil = retracted). Always emit so the client can
	// clear a resolved pending marker.
	return writeSSEJSON(w, flusher, "chat-state", chatState{Pending: u.Pending})
}

// chatState is the `chat-state` event payload — the current pending marker (nil
// when no pending / retracted).
type chatState struct {
	Pending *chat.Pending `json:"pending"`
}

// writeSSE writes a raw SSE frame and flushes. Returns false when the write
// fails (client disconnected) so the caller can return cleanly WITHOUT throwing
// (code-review.md SSE rule).
func writeSSE(w http.ResponseWriter, flusher http.Flusher, frame string) bool {
	if _, err := w.Write([]byte(frame)); err != nil {
		return false
	}
	flusher.Flush()
	return true
}

// writeSSEJSON marshals v and writes it as a named SSE event
// (`event: <name>\ndata: <json>\n\n`). A marshal failure is skipped (best-effort,
// never fatal to the stream); a write failure returns false.
func writeSSEJSON(w http.ResponseWriter, flusher http.Flusher, event string, v any) bool {
	data, err := json.Marshal(v)
	if err != nil {
		return true // skip this event, keep the stream alive
	}
	return writeSSE(w, flusher, fmt.Sprintf("event: %s\ndata: %s\n\n", event, string(data)))
}

// writeSSEError emits an `event: chat-error` frame after the SSE headers are
// already committed (when an HTTP status can no longer be set). Best-effort.
func (s *Server) writeSSEError(w http.ResponseWriter, flusher http.Flusher, err error) {
	writeSSEJSON(w, flusher, "chat-error", map[string]string{"error": err.Error()})
}
