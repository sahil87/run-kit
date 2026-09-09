package api

import (
	"context"
	"log/slog"
	"net"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/gorilla/websocket"

	"rk/internal/daemon"
	"rk/internal/gui"
	"rk/internal/settings"
	"rk/internal/validate"
)

// GUI relay — `/ws/gui/{id}`.
//
// One WebSocket per viewer carries the raw RFB byte stream between the
// browser (noVNC) and the GUI backend, which never listens on TCP itself —
// this relay is the only door. Binary frames only: noVNC consumes the bytes
// verbatim. Errors ride WS close frames so noVNC gets a reason (the
// /ws/terminals posture): 4400 invalid id, 4403 gui disabled, 4404 backend
// unreachable.
//
// Lifecycle mirrors the state_ws.go hijack rule: the context is rooted at
// Background — NOT r.Context(), which some servers cancel at upgrade — and a
// read error on either side cancels it and closes BOTH connections (no
// orphaned backend sockets). The hub's per-id viewer count tracks live
// relays (the `event: gui` payload's viewers field and the probe's
// viewer-skip gate).
//
// On the tcp backend (macOS Screen Sharing) the client→server direction
// passes through the view-only filter (gui_filter.go), which drops KeyEvent
// and PointerEvent after the RFB handshake — a Screen Sharing mirror is
// view-only through rk.

// GUI relay close codes — private-range WS codes carrying the gate outcome.
const (
	guiCloseInvalidID  = 4400 // ValidateGUIID failed
	guiCloseDisabled   = 4403 // gui.enabled is off
	guiCloseNotRunning = 4404 // backend dial failed
)

const (
	// guiDialTimeout bounds the backend dial (local socket/loopback; refused
	// is instant — the timeout covers a filtered/hung endpoint).
	guiDialTimeout = 2 * time.Second
	// guiReadLimit caps a single inbound WS message: ReadMessage buffers the
	// whole frame, and an unbounded limit is a memory-DoS (the
	// terminalsReadLimit rationale). An RFB client message is small; the
	// clipboard is the largest.
	guiReadLimit = 1 << 20 // 1 MiB
	// guiBackendReadChunk is the backend→WS read buffer size.
	guiBackendReadChunk = 64 << 10 // 64 KiB
)

// guiDial is the injectable backend-dial seam: production dials with
// guiDialTimeout; tests substitute a fake listener.
var guiDial = func(network, addr string) (net.Conn, error) {
	return net.DialTimeout(network, addr, guiDialTimeout)
}

// guiBackendAddr returns the OS-appropriate backend endpoint: the unix socket
// under the GUI state dir on Linux, loopback VNC on macOS (Screen Sharing).
func guiBackendAddr() (network, addr string, err error) {
	return gui.BackendAddr(daemon.GUIWindowName)
}

// handleGuiWS upgrades a `/ws/gui/{id}` request, gates (id, enabled, dial),
// then pipes binary frames both ways until either side's read fails.
func (s *Server) handleGuiWS(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		slog.Error("gui ws upgrade failed", "err", err)
		return
	}
	defer conn.Close()

	// Pre-pipe gate failures are reported as close frames. No other writer
	// exists yet, so the handler may write directly.
	closeWith := func(code int, reason string) {
		conn.SetWriteDeadline(time.Now().Add(terminalsWriteWait))
		_ = conn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(code, reason))
	}

	if verr := validate.ValidateGUIID(id); verr != "" {
		closeWith(guiCloseInvalidID, "invalid gui id")
		return
	}
	if !settings.Load().GUIEnabled {
		closeWith(guiCloseDisabled, "gui disabled")
		return
	}
	network, addr, aerr := guiBackendAddr()
	if aerr != nil {
		closeWith(guiCloseNotRunning, "gui not running: "+aerr.Error())
		return
	}
	backend, err := guiDial(network, addr)
	if err != nil {
		closeWith(guiCloseNotRunning, "gui not running: "+err.Error())
		return
	}

	s.initSSEHub()
	hub := s.sseHub
	hub.guiViewerAdd(id)
	defer hub.guiViewerRemove(id)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	filter := newGuiViewFilter(network)

	// Backend → WS pump: the ONLY writer on the socket from here on (gorilla
	// forbids concurrent writes). A backend read error (EOF = backend closed)
	// or a write failure cancels the lifecycle and sets a short read deadline
	// so the read loop's blocked ReadMessage returns promptly and runs
	// teardown (the terminalsCleanupWait idiom). On backend EOF the client
	// first gets a real close frame — noVNC distinguishes a clean close from
	// a network cut.
	pumpDone := make(chan struct{})
	go func() {
		defer close(pumpDone)
		defer cancel()
		buf := make([]byte, guiBackendReadChunk)
		for {
			select {
			case <-ctx.Done():
				return
			default:
			}
			n, rerr := backend.Read(buf)
			if rerr != nil {
				conn.SetWriteDeadline(time.Now().Add(terminalsWriteWait))
				_ = conn.WriteMessage(websocket.CloseMessage,
					websocket.FormatCloseMessage(websocket.CloseNormalClosure, "gui backend closed"))
				conn.SetReadDeadline(time.Now().Add(terminalsCleanupWait))
				return
			}
			payload := filter.feedServer(buf[:n])
			if len(payload) == 0 {
				continue
			}
			conn.SetWriteDeadline(time.Now().Add(terminalsWriteWait))
			if werr := conn.WriteMessage(websocket.BinaryMessage, payload); werr != nil {
				conn.SetReadDeadline(time.Now().Add(terminalsCleanupWait))
				return
			}
		}
	}()

	// Read loop: WS → backend. Text frames are ignored (forward-compat).
	// Bound each inbound frame (memory-DoS). On exit, close BOTH conns and
	// wait for the pump so no goroutine outlives the handler.
	conn.SetReadLimit(guiReadLimit)
	for {
		msgType, msg, rerr := conn.ReadMessage()
		if rerr != nil {
			break
		}
		if msgType != websocket.BinaryMessage {
			continue
		}
		out := filter.feedClient(msg)
		if len(out) == 0 {
			continue
		}
		if _, werr := backend.Write(out); werr != nil {
			break
		}
	}

	cancel()
	backend.Close()
	<-pumpDone
}
