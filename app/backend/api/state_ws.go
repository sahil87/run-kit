package api

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"github.com/gorilla/websocket"

	"rk/internal/validate"
)

// State socket — `/ws/state` (change 260716-qf3j-state-socket).
//
// One WebSocket per browser tab carries ALL session-state and host-metrics
// streams that previously rode per-server + metrics-only Server-Sent-Event
// connections (the retired `GET /api/sessions/stream`). Consolidating onto a
// single established WebSocket clears the browser's 6-per-origin HTTP/1.1
// connection pool (an established WS holds no pool slot in any engine — see
// docs/findings/socket-pool-accounting.md), which is what starved the pool and
// blocked terminal-relay handshakes on Firefox/WebKit for plaintext origins.
//
// Contract-preservation rule (load-bearing): today's SSE event names and
// payloads move VERBATIM into the envelope's `type`/`data` — only the framing
// changes. The producer machinery in sse.go (pollers, collectors, broadcast
// helpers) is untouched; it fans out `hubEvent` values, and this file renders
// each one into the JSON envelope below.

// State-socket op names (client → server).
const (
	opHello        = "hello"
	opSubscribe    = "subscribe"
	opUnsubscribe  = "unsubscribe"
	opPreviewScope = "preview-scope"
)

// State-socket subscription kinds. `server` is a per-tmux-server subscription
// (keyed by name); `metrics` is the server-neutral host-metrics + services
// subscription (the replacement for the `?metrics=1` SSE stream). `global` is
// only ever a server→client event kind (host-global slots + broadcasts).
const (
	kindServer  = "server"
	kindMetrics = "metrics"
	kindGlobal  = "global"
	// kindChat is a per-chat-window subscription (keyed by window ID, scoped to a
	// tmux server via clientMsg.Server) that moved the retired per-view chat SSE
	// (GET /api/windows/{id}/chat/stream) onto the state socket (change
	// 260717-vhvz). Unlike kindServer it does NOT join the tmux poll set —
	// transcript appends generate no tmux events — so each chat subscription owns
	// a dedicated per-subscription producer goroutine (see chat_ws.go).
	kindChat = "chat"
)

// clientMsg is a client → server frame. All fields are optional; `op`
// discriminates. `req` correlates a subscribe with its ack; `expanded` rides
// the preview-scope op.
type clientMsg struct {
	Op       string   `json:"op"`
	Conn     string   `json:"conn"`
	Kind     string   `json:"kind"`
	Key      string   `json:"key"`
	Req      int64    `json:"req"`
	Server   string   `json:"server"`
	Expanded []string `json:"expanded"`
	// From is the transcript byte offset a chat subscribe tails from (kindChat
	// only; 260717-vhvz). The client GETs the backfill (whose response carries the
	// offset) then subscribes with from:<offset>, so fetch→subscribe composes
	// without a gap or duplicate.
	From int64 `json:"from"`
}

// eventFrame is the server → client `event` envelope. `data` is
// json.RawMessage so the producer-rendered payload is embedded verbatim
// (byte-identical to the retired SSE frame's `data:` body). Per-server events
// carry kind=="server"+key; host-global events carry kind=="global".
type eventFrame struct {
	Op   string          `json:"op"` // "event"
	Kind string          `json:"kind"`
	Key  string          `json:"key,omitempty"`
	Type string          `json:"type"`
	Data json.RawMessage `json:"data"`
}

// ackFrame answers a subscribe. For server/metrics kinds it carries the current
// snapshot (the same payload the SSE `event: sessions` / cached-metrics slot
// carried). For a chat kind it carries NO snapshot (D5 — the transcript came
// from the GET backfill) and instead the tail-start byte Offset the producer
// began emitting from (normally == the subscribe's `from`).
type ackFrame struct {
	Op       string          `json:"op"` // "ack"
	Req      int64           `json:"req"`
	Snapshot json.RawMessage `json:"snapshot,omitempty"`
	Offset   int64           `json:"offset,omitempty"`
}

// goneFrame replaces the SSE `event: server-gone`: the subscribed server's
// tmux socket is gone (reaped from the poll set).
type goneFrame struct {
	Op     string `json:"op"` // "gone"
	Kind   string `json:"kind"`
	Key    string `json:"key"`
	Reason string `json:"reason"`
}

// errorFrame reports a malformed or unhonorable client op. `req` echoes the
// offending op's req when present (0 otherwise).
type errorFrame struct {
	Op      string `json:"op"` // "error"
	Req     int64  `json:"req"`
	Message string `json:"message"`
}

// hubEvent is the structured unit the hub's producers fan out to each
// connection's send channel. The client-facing edge renders it into the
// state-socket envelope (renderEnvelope); tests render it into an SSE-style
// debug frame via the test-only String method (state_ws_test.go). `data` is the
// JSON payload, byte-identical to the retired SSE frame's `data:` body. `kind`
// is kindServer or kindGlobal; `key` is the server name for kindServer, empty
// for kindGlobal. A `gone` marker rides its own boolean so the reap path can fan
// it through the same channel.
type hubEvent struct {
	kind string
	typ  string
	key  string
	data string
	gone bool
	// raw, when non-nil, is a pre-rendered frame delivered verbatim (bypassing
	// envelope rendering). Used for the subscribe `ack` frame, which is composed
	// by the handler but must ride the same ordered channel as the subscription's
	// events.
	raw []byte
}

// renderEnvelope serializes a hubEvent into the state-socket JSON envelope
// frame delivered over the WebSocket. A pre-rendered raw frame passes through
// verbatim; a gone marker becomes a `gone` frame; everything else becomes an
// `event` frame carrying the verbatim `data`.
func (e hubEvent) renderEnvelope() []byte {
	if e.raw != nil {
		return e.raw
	}
	if e.gone {
		b, _ := json.Marshal(goneFrame{Op: "gone", Kind: kindServer, Key: e.key, Reason: "server-exited"})
		return b
	}
	b, _ := json.Marshal(eventFrame{
		Op:   "event",
		Kind: e.kind,
		Key:  e.key,
		Type: e.typ,
		Data: json.RawMessage(e.data),
	})
	return b
}

// stateWSWriteWait bounds a single WebSocket write. A stuck client must not
// block the writer pump forever.
const stateWSWriteWait = 10 * time.Second

// stateWSCleanupWait is the short read deadline the writer pump sets on the
// connection when a write fails, so the read loop's blocked conn.ReadMessage()
// returns promptly and runs its teardown instead of leaking until TCP timeout
// (terminals_ws.go uses the same cleanup-deadline pattern).
const stateWSCleanupWait = 100 * time.Millisecond

// Shared WebSocket upgrader for the muxed sockets (`/ws/state` here and
// `/ws/terminals` in terminals_ws.go). The per-pane `/relay/{windowId}`
// endpoint and its handleRelay were retired in 260717-803u-relay-mux.
var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

// handleStateWS upgrades a `/ws/state` request and runs the state-socket
// protocol: read the initial `hello`, replay the cached global slots, then a
// read loop dispatching subscribe/unsubscribe/preview-scope while a writer pump
// drains the connection's send channel to the socket as JSON text frames.
func (s *Server) handleStateWS(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		slog.Error("state ws upgrade failed", "err", err)
		return
	}
	defer conn.Close()

	// Lazy-init the hub on first state-socket connection (mirrors handleSSE).
	s.initSSEHub()
	hub := s.sseHub

	// The first frame MUST be `hello`. Read it with a short deadline so a
	// silent client can't hold the goroutine.
	conn.SetReadDeadline(time.Now().Add(10 * time.Second))
	_, raw, err := conn.ReadMessage()
	if err != nil {
		slog.Debug("state ws: no hello frame", "err", err)
		return
	}
	conn.SetReadDeadline(time.Time{})
	var hello clientMsg
	if json.Unmarshal(raw, &hello) != nil || hello.Op != opHello {
		writeStateWSError(conn, 0, "first frame must be hello")
		return
	}
	connID := normalizeConnID(hello.Conn)

	// The state-socket connection. Its send channel carries hubEvents; the
	// writer pump renders each into the envelope. Buffer generously — a burst
	// of per-server events across many subscriptions must not drop.
	sc := &stateConn{
		ch:     make(chan hubEvent, 128),
		connID: connID,
		subs:   map[string]*sseClient{},
	}

	// Replay the cached global slots once, right after hello (mirrors the SSE
	// addClient cached-on-connect delivery for the host-global slots).
	hub.replayGlobalSlots(sc)

	// Own lifecycle context rooted at Background — NOT r.Context(): after the WS
	// upgrade the connection is hijacked, and some servers cancel the request
	// context at that point, which would kill the writer pump immediately. The
	// read loop's error (client close / socket death) drives cancel() instead.
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Writer pump: drain sc.ch to the socket. Runs until the channel is closed
	// (on read-loop exit via cancel) or a write fails.
	writerDone := make(chan struct{})
	go func() {
		defer close(writerDone)
		for {
			select {
			case <-ctx.Done():
				return
			case ev, ok := <-sc.ch:
				if !ok {
					return
				}
				conn.SetWriteDeadline(time.Now().Add(stateWSWriteWait))
				if err := conn.WriteMessage(websocket.TextMessage, ev.renderEnvelope()); err != nil {
					// The socket is dead (or the client is stuck past the write
					// deadline). cancel() alone would leave the read loop parked
					// in conn.ReadMessage() with no deadline until TCP teardown,
					// leaking this goroutine and its hub subscriptions. Mirror
					// relay.go: set a short read deadline so ReadMessage() returns
					// promptly and the read loop runs its dropStateConn cleanup.
					cancel()
					conn.SetReadDeadline(time.Now().Add(stateWSCleanupWait))
					return
				}
			}
		}
	}()

	// Read loop: dispatch client ops until the socket closes. On exit, drop all
	// subscriptions and cancel the writer.
	defer hub.dropStateConn(sc)
	for {
		_, raw, err := conn.ReadMessage()
		if err != nil {
			break
		}
		var msg clientMsg
		if json.Unmarshal(raw, &msg) != nil {
			continue // ignore malformed frames rather than tearing down
		}
		switch msg.Op {
		case opSubscribe:
			hub.stateSubscribe(sc, msg)
		case opUnsubscribe:
			hub.stateUnsubscribe(sc, msg)
		case opPreviewScope:
			// The connection addresses itself by its own conn id — the same
			// identity POST /api/preview-scope uses (decision D4). Validate the
			// server key against the same barrier as subscribe (Constitution §I):
			// setPreviewScope indexes h.clients[server], and a raw key must not
			// reach hub state unchecked. Reject with an error frame carrying
			// msg.Req (0 when the client sent none — preview-scope has no ack).
			if verr := validate.ValidateServerName(msg.Server); verr != "" {
				hub.emitError(sc, msg.Req, verr)
				break
			}
			hub.setPreviewScope(msg.Server, sc.connID, msg.Expanded)
		case opHello:
			// A second hello is a no-op (idempotent); ignore.
		default:
			// Route the error frame through the send channel so ONLY the writer
			// pump ever writes to the socket (gorilla forbids concurrent writes).
			if b, e := json.Marshal(errorFrame{Op: "error", Req: msg.Req, Message: "unknown op: " + msg.Op}); e == nil {
				select {
				case sc.ch <- hubEvent{raw: b}:
				default:
				}
			}
		}
	}

	cancel()
	<-writerDone
}

// writeStateWSError writes a single error frame directly to the socket (used on
// the handshake path before the writer pump owns the connection). Best-effort.
func writeStateWSError(conn *websocket.Conn, req int64, message string) {
	b, _ := json.Marshal(errorFrame{Op: "error", Req: req, Message: message})
	conn.SetWriteDeadline(time.Now().Add(stateWSWriteWait))
	_ = conn.WriteMessage(websocket.TextMessage, b)
}
