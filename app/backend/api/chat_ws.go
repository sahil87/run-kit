package api

import (
	"context"
	"encoding/json"
	"time"

	"rk/internal/chat"
	"rk/internal/validate"
)

// Chat on the state socket — the `kind:"chat"` subscription (change 260717-vhvz).
//
// The retired per-view chat SSE (GET /api/windows/{id}/chat/stream) moved onto
// /ws/state: chat is one more subscription kind, subscribed on chat-lens enter
// and unsubscribed on leave. Backfill demoted to GET /api/windows/{id}/chat
// (whose response gained a byte-offset field); the subscribe carries
// `from:<offset>` and the ack returns the tail-start offset (NO snapshot — D5),
// so the client's fetch→subscribe composes gap-free and duplicate-free.
//
// Unlike a `server` kind, a chat subscription does NOT join the tmux poll set —
// transcript appends generate no tmux events (the recorded reason chat got a
// dedicated stream in the first place). Instead each chat subscription owns a
// per-subscription producer goroutine (chatProducer) running a two-phase machine:
//
//   - TAIL: an incremental TailFrom(ref, from) ships ONLY the bytes the client's
//     GET backfill did not carry (Events → `chat`+`chat-state`).
//   - DORMANT: on a ROTATION (the ~2s re-resolve sees a fresh ref) or a SHRINK
//     (the tailed transcript dropped below `from`), the producer cancels the tail
//     and — crucially — does NOT re-tail the new ref from 0 (that would re-stream
//     a whole, possibly huge, conversation over the shared socket, violating D5).
//     It emits a single lightweight `chat-reset` ONLY once the new ref's
//     transcript exists, so the client re-runs its GET-backfill→subscribe
//     composition; that re-subscribe REPLACES this producer with a fresh tail.
//
// The producer emits hubEvent{kind:kindChat,key:windowID,…} onto the connection's
// existing send channel (single writer pump, ordered with acks). Its context is
// cancelled on unsubscribe, on connection drop (dropStateConn), and on a repeat
// subscribe for the same key — no goroutine outlives its subscription
// (Constitution II; code-review WebSocket-cleanup rule).

// chat event type names — the surviving SSE events move VERBATIM (byte-identical
// payloads) plus the new lightweight rotation signal.
const (
	chatEventChat  = "chat"       // ChatEvent[] — appended events (verbatim SSE payload)
	chatEventState = "chat-state" // {pending} — always emitted incl. null (verbatim SSE payload)
	chatEventReset = "chat-reset" // {} — rotation/shrink signal (no transcript; client re-composes)
	// chatEventError ({error}) is part of the client-facing protocol surface (the
	// hook renders it as an inline error) and is RESERVED for a future adapter
	// error path. The current producer never emits it: subscribe-time resolve
	// failures use the state-socket `error` frame (carrying req), and a
	// not-yet/transient tail failure goes DORMANT (converges via `chat-reset`)
	// rather than surfacing a terminal error.
	chatEventError = "chat-error"
)

// chatSubKey is the per-connection chat producer registry key. Window IDs are
// only unique per server, so the key joins both (NUL-separated — the same idiom
// as chatSendLocks' per-(server,paneID) key). It is NOT a poll-set key.
func chatSubKey(server, windowID string) string {
	return server + "\x00" + windowID
}

// chatProducer holds the per-subscription state for one chat producer. It runs a
// two-phase machine (both phases entirely inside run's goroutine, so no field
// needs its own lock):
//
//   - TAIL phase: an incremental TailFrom(ref, from) streams ONLY the bytes the
//     client's GET backfill did not already carry (Events → `chat`+`chat-state`).
//     This is the sole phase that ships transcript content, and it never re-ships
//     bytes < from — the GET(offset)→subscribe(from) composition stays gap-free
//     and duplicate-free.
//   - DORMANT phase: entered when the subscribed transcript shrinks below `from`
//     (a tail Reset) OR the ~2s re-resolve tick sees a ROTATED ref (a fresh
//     session via /clear or `claude --resume`). The producer CANCELS the tail and
//     does NOT re-tail from 0 — that would re-stream a whole (possibly huge)
//     conversation over the shared socket (D5). Instead, once the new ref's
//     transcript is resolvable AND EXISTS, it emits a single lightweight
//     `chat-reset` (re-emitted each tick until the client re-subscribes) so the
//     client re-runs its GET-backfill→subscribe composition. That re-subscribe
//     REPLACES this producer with a fresh one carrying the new `from` — so the
//     fresh tail belongs to the re-subscribe, never to this dormant producer.
type chatProducer struct {
	hub      *sseHub
	sc       *stateConn
	server   string
	windowID string
	from     int64
	req      int64 // the subscribe's req, echoed in the ack (composed in run)

	// The ref/adapter currently being tailed. Set by the initial resolve in run;
	// on rotation the producer goes dormant rather than re-tailing here.
	ref     string
	adapter chat.Adapter

	updates    <-chan chat.Update // the live TAIL channel; nil while dormant
	tailCancel context.CancelFunc // cancels the live tail; nil while dormant
	dormant    bool               // true once a reset was needed (rotation/shrink)
	// pendingReset is set when an incremental `chat`/`chat-state` frame was DROPPED
	// (the connection channel was full) — the client's view is now incomplete. The
	// producer re-attempts a recovery `chat-reset` (on the next emit opportunity and
	// on every re-resolve tick) until it succeeds, so a dropped frame can never
	// leave the client permanently diverged (should-fix; the reset itself may also
	// drop while the channel stays full, hence the retry until it lands).
	pendingReset bool

	ctx    context.Context
	cancel context.CancelFunc
}

// startChatSubscribe handles a kind:"chat" subscribe. It validates the client
// key/server (Constitution §I) SYNCHRONOUSLY on the read loop (cheap), registers
// a placeholder producer under h.mu (so a repeat/duplicate subscribe and teardown
// are deterministic), then dispatches the BLOCKING work — resolve (FetchSessions,
// up to resolveTimeout on a stalled tmux) + adapter Lookup + ack + tail start —
// to the producer goroutine so it never freezes the connection's other ops
// (mirrors the terminals-mux S2 pattern). Ack-before-first-emit ordering is
// preserved because the goroutine enqueues the ack (under h.mu) before its first
// emit. A resolve-time failure becomes an `error` frame carrying req (the GET
// backfill remains where those show as HTTP statuses) and removes the placeholder.
func (h *sseHub) startChatSubscribe(sc *stateConn, msg clientMsg) {
	if err := validate.ValidateWindowID(msg.Key, "Window ID"); err != "" {
		h.emitError(sc, msg.Req, err)
		return
	}
	if err := validate.ValidateServerName(msg.Server); msg.Server != "" && err != "" {
		h.emitError(sc, msg.Req, err)
		return
	}
	server := serverFromRequestValue(msg.Server)
	key := chatSubKey(server, msg.Key)

	h.mu.Lock()
	// Defensive: a subscribe must never leave a connection out of the global
	// fan-out set (the handler adds it at hello, but keep the barrier uniform).
	h.stateConns[sc] = true
	if sc.chatProducers == nil {
		sc.chatProducers = map[string]*chatProducer{}
	}
	// Repeat subscribe for the same key (new `from` → restart tail): cancel and
	// drop the prior producer before registering the replacement placeholder.
	if prev, exists := sc.chatProducers[key]; exists {
		prev.cancel()
		delete(sc.chatProducers, key)
	}
	pctx, pcancel := context.WithCancel(context.Background())
	p := &chatProducer{
		hub:      h,
		sc:       sc,
		server:   server,
		windowID: msg.Key,
		from:     msg.From,
		req:      msg.Req,
		ctx:      pctx,
		cancel:   pcancel,
	}
	sc.chatProducers[key] = p
	h.mu.Unlock()

	// The blocking resolve + ack + tail all run in the producer goroutine.
	go p.run()
}

// stopChatSubscribe handles a kind:"chat" unsubscribe: validate, then cancel and
// drop the producer for (server, windowID). A miss is a silent no-op.
func (h *sseHub) stopChatSubscribe(sc *stateConn, msg clientMsg) {
	if err := validate.ValidateWindowID(msg.Key, "Window ID"); err != "" {
		h.emitError(sc, msg.Req, err)
		return
	}
	if err := validate.ValidateServerName(msg.Server); msg.Server != "" && err != "" {
		h.emitError(sc, msg.Req, err)
		return
	}
	server := serverFromRequestValue(msg.Server)
	key := chatSubKey(server, msg.Key)
	h.mu.Lock()
	p, ok := sc.chatProducers[key]
	if ok {
		delete(sc.chatProducers, key)
	}
	h.mu.Unlock()
	if ok {
		p.cancel()
	}
}

// dropChatProducers cancels every chat producer on a connection and clears the
// registry. Called from dropStateConn on connection teardown so no producer
// goroutine outlives its socket (Constitution II). Caller MUST hold h.mu (write).
func dropChatProducersLocked(sc *stateConn) []*chatProducer {
	if len(sc.chatProducers) == 0 {
		return nil
	}
	out := make([]*chatProducer, 0, len(sc.chatProducers))
	for _, p := range sc.chatProducers {
		out = append(out, p)
	}
	sc.chatProducers = map[string]*chatProducer{}
	return out
}

// run owns the whole producer lifecycle in its own goroutine: the blocking
// resolve + ack, then the two-phase (TAIL / DORMANT) select loop. It returns on
// ctx cancel (unsubscribe / disconnect / repeat-subscribe), always tearing down
// the latest tail context.
func (p *chatProducer) run() {
	defer func() {
		if p.tailCancel != nil {
			p.tailCancel()
		}
	}()

	// Resolve the window's chat + adapter (BLOCKING — moved off the read loop, T006
	// S2 pattern). A genuine no-chat / no-adapter / fetch-failure becomes an `error`
	// frame carrying req and removes the placeholder producer (no zombie).
	resolveCtx, resolveCancel := context.WithTimeout(p.ctx, resolveTimeout)
	provider, ref, ok, err := p.hub.chatResolver(resolveCtx, p.server, p.windowID)
	resolveCancel()
	if err != nil {
		p.failSubscribe("chat resolve failed: " + err.Error())
		return
	}
	if !ok {
		p.failSubscribe("no chat session for this window")
		return
	}
	adapter, lerr := chat.Lookup(provider)
	if lerr != nil {
		p.failSubscribe("no adapter for provider " + provider)
		return
	}
	p.ref = ref
	p.adapter = adapter

	// Ack with the tail-start offset and NO snapshot (D5), enqueued BEFORE any
	// event so the client sees ack→events in order (the read-loop enqueued nothing
	// for this subscription; this is the first frame on the channel for it).
	p.ackSubscribe()

	// Enter the TAIL phase for the subscribed (ref, from). A transcript that does
	// not exist yet (a rotation raced the subscribe) drops straight to DORMANT.
	p.startTail(p.ref, p.adapter, p.from)

	refResolve := time.NewTicker(chatRefResolveInterval)
	defer refResolve.Stop()

	for {
		select {
		case <-p.ctx.Done():
			return
		case <-refResolve.C:
			p.tick()
		case u, ok := <-p.updates:
			if !ok {
				// Tail channel closed (its ctx was cancelled) — drop the stale
				// channel so we stop selecting on it.
				p.updates = nil
				continue
			}
			p.emitUpdate(u)
		}
	}
}

// failSubscribe emits an `error` frame carrying the subscribe req and removes the
// placeholder producer from the connection registry (a resolve-time failure must
// leave no zombie). Runs in the producer goroutine.
func (p *chatProducer) failSubscribe(message string) {
	p.hub.emitError(p.sc, p.req, message)
	p.hub.mu.Lock()
	key := chatSubKey(p.server, p.windowID)
	if p.sc.chatProducers[key] == p {
		delete(p.sc.chatProducers, key)
	}
	p.hub.mu.Unlock()
	p.cancel()
}

// ackSubscribe enqueues the subscribe ack (offset = the client's tail-start
// `from`, NO snapshot — D5) onto the connection's send channel, under h.mu so it
// is ordered ahead of the producer's first emit.
func (p *chatProducer) ackSubscribe() {
	ackBytes, err := json.Marshal(ackFrame{Op: "ack", Req: p.req, Offset: p.from})
	if err != nil {
		return
	}
	p.hub.mu.Lock()
	p.hub.sendConnLocked(p.sc, hubEvent{raw: ackBytes})
	p.hub.mu.Unlock()
}

// startTail begins the incremental TAIL phase for (ref, from). It ships ONLY the
// bytes the GET backfill did not carry (Events ≥ from). A transcript that is not
// yet present (ErrTranscriptNotFound / ErrInvalidRef) is NOT terminal — the
// producer goes DORMANT and the re-resolve tick converges once the file appears.
// Any other adapter error goes dormant too (the client's GET is the surface that
// reports read failures as an HTTP status).
func (p *chatProducer) startTail(ref string, adapter chat.Adapter, from int64) {
	//nolint:fatcontext // deliberate: one live tail context at a time; the prior
	// is cancelled here before the next starts, and run's defer cancels the last.
	tailCtx, cancel := context.WithCancel(p.ctx)
	updates, err := adapter.TailFrom(tailCtx, ref, from)
	if err != nil {
		cancel()
		// No transcript yet (or a transient read failure): go dormant and let the
		// re-resolve tick emit `chat-reset` once the ref resolves to an existing
		// file. Never a `chat-error` for a lazily-created transcript.
		p.enterDormant()
		return
	}
	if p.tailCancel != nil {
		p.tailCancel()
	}
	p.ref = ref
	p.adapter = adapter
	p.from = from
	p.updates = updates
	p.tailCancel = cancel
	p.dormant = false
}

// enterDormant cancels the live tail (if any) and marks the producer dormant. It
// ships NO transcript content — the DORMANT phase only emits a bounded
// `chat-reset` (in tick, once the new ref exists), and the client's re-subscribe
// replaces this producer with a fresh tail (D5 — a rotated conversation, possibly
// huge, never rides the shared socket).
func (p *chatProducer) enterDormant() {
	if p.tailCancel != nil {
		p.tailCancel()
		p.tailCancel = nil
	}
	p.updates = nil
	p.dormant = true
}

// tick runs one ~2s re-resolve pass.
//
//   - TAIL phase: if the resolved ref ROTATED away from what we are tailing, go
//     dormant (do NOT re-tail from 0). A transient FetchSessions failure or a
//     window that momentarily lost its chat is tolerated (keep tailing, retry).
//   - DORMANT phase: once the resolved ref's transcript is resolvable AND EXISTS,
//     emit a single `chat-reset` (re-emitted each tick until the client
//     re-subscribes, which replaces this producer). While the file is still
//     absent (a just-fired /clear), stay dormant and wait — no `chat-reset`,
//     no `chat-error`.
func (p *chatProducer) tick() {
	// Retry a recovery reset outstanding from a dropped incremental frame (the
	// channel may have drained since).
	p.flushPendingReset()

	resolveCtx, cancel := context.WithTimeout(p.ctx, resolveTimeout)
	_, newRef, ok, err := p.hub.chatResolver(resolveCtx, p.server, p.windowID)
	cancel()
	if err != nil || !ok {
		// Transient fetch failure or the window momentarily lost its chat: hold the
		// current phase and retry next tick (never tear a healthy tail for a blip).
		return
	}

	if !p.dormant {
		if newRef != p.ref {
			// Rotation: the tailed session was replaced. Go dormant — the client
			// re-composes for the new ref on the `chat-reset` a later tick emits
			// once its transcript exists. Never re-tail from 0.
			p.enterDormant()
			// Track the new ref so the existence probe below targets it.
			p.ref = newRef
		}
		return
	}

	// DORMANT: the ref the client must re-compose against is `newRef`. Emit the
	// reset only once its transcript EXISTS (so the client's GET does not 404).
	p.ref = newRef
	if !p.transcriptExists(newRef) {
		return // /clear just fired; the file has not been written yet — wait
	}
	// Existing transcript for the rotated-to ref: signal the client to re-compose.
	// Re-emitted each tick until the client's re-subscribe replaces this producer
	// (a GET that races the file's first write and 404s simply retries on the next
	// `chat-reset`), so the client always converges without wedging on an error.
	p.signalReset()
}

// transcriptExists reports whether the adapter can locate the ref's transcript
// right now, WITHOUT streaming any content: it starts a probe TailFrom(ref, 0) and
// cancels it immediately. TailFrom returns ErrTranscriptNotFound / ErrInvalidRef
// synchronously (before spawning its poll goroutine) when the file is absent or
// the ref malformed; a nil error means the file exists — the probe goroutine then
// observes the just-cancelled context and exits WITHOUT emitting anything (its
// first poll is a full tailPollInterval away, far past this synchronous cancel).
func (p *chatProducer) transcriptExists(ref string) bool {
	if p.adapter == nil {
		return false
	}
	probeCtx, probeCancel := context.WithCancel(p.ctx)
	ch, err := p.adapter.TailFrom(probeCtx, ref, 0)
	probeCancel()
	if err != nil {
		return false
	}
	// Drain the probe channel to completion (it closes as soon as the cancelled
	// ctx is observed) so the probe goroutine never leaks.
	go func() {
		for range ch { //nolint:revive // intentional drain of a cancelled probe
		}
	}()
	return true
}

// emitUpdate renders one TAIL-phase adapter Update to the state socket as kindChat
// events. A Reset (the subscribed transcript shrank below `from`) drops to the
// DORMANT phase and signals a bounded `chat-reset` (never a transcript payload —
// D5); an incremental update becomes a `chat` event (appended events) followed by
// a `chat-state` event (the pending transition, always emitted incl. nil).
//
// If an incremental frame is DROPPED (the connection's channel was full), the
// client is now missing bytes with no way to know — recover by signalling a
// one-shot `chat-reset` so the client re-composes from a fresh GET (should-fix).
func (p *chatProducer) emitUpdate(u chat.Update) {
	if u.Reset {
		// Shrink/rewrite below the tail offset: stop tailing (no from-0 re-stream)
		// and tell the client to re-compose.
		p.enterDormant()
		p.signalReset()
		return
	}
	// A prior drop is still outstanding — try to flush its recovery reset before
	// (maybe) shipping more incremental frames the client couldn't reconcile anyway.
	p.flushPendingReset()

	dropped := false
	if len(u.Events) > 0 {
		if data, err := json.Marshal(u.Events); err == nil {
			if !p.emit(chatEventChat, data) {
				dropped = true
			}
		}
	}
	// Pending transition (may be nil = retracted). Always emit so the client can
	// clear a resolved pending marker.
	if stateData, err := json.Marshal(chatStatePayload{Pending: u.Pending}); err == nil {
		if !p.emit(chatEventState, stateData) {
			dropped = true
		}
	}
	if dropped {
		// A dropped `chat` / `chat-state` left the client's view incomplete — mark a
		// recovery `chat-reset` pending so the client re-composes from a fresh GET
		// rather than silently diverge. The reset is attempted immediately and, if
		// it too drops (channel still full), retried each re-resolve tick until it
		// lands — a dropped frame can never permanently strand the client.
		p.pendingReset = true
		p.flushPendingReset()
	}
}

// flushPendingReset attempts to deliver an outstanding recovery `chat-reset`
// (set by emitUpdate on a dropped incremental frame), clearing the flag only once
// the reset actually enqueues. A no-op when nothing is pending.
func (p *chatProducer) flushPendingReset() {
	if !p.pendingReset {
		return
	}
	if p.emit(chatEventReset, json.RawMessage("{}")) {
		p.pendingReset = false
	}
}

// chatStatePayload is the `chat-state` event payload — the current pending marker
// (nil when no pending / retracted). Byte-identical to the retired SSE
// chatState payload shape.
type chatStatePayload struct {
	Pending *chat.Pending `json:"pending"`
}

// signalReset emits the lightweight `chat-reset` event ({} — no transcript). The
// client re-runs the GET-backfill→subscribe composition (decision D5 — a large
// rotated conversation never rides the shared socket). Best-effort; a drop here
// is not recovered further (it would recurse) — the socket's own backpressure /
// reconnect is the backstop.
func (p *chatProducer) signalReset() {
	p.emit(chatEventReset, json.RawMessage("{}"))
}

// emit delivers a kindChat event onto the owning connection's send channel via
// sendConnLockedOK (single writer pump, ordered with acks/events). Returns
// whether the event was enqueued (false ⇒ dropped, channel full).
func (p *chatProducer) emit(typ string, data json.RawMessage) bool {
	p.hub.mu.Lock()
	ok := p.hub.sendConnLockedOK(p.sc, hubEvent{kind: kindChat, typ: typ, key: p.windowID, data: string(data)})
	p.hub.mu.Unlock()
	return ok
}
