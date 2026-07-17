package api

import (
	"net/http"
	"strings"

	"github.com/gorilla/websocket"
)

// Shared WebSocket upgrader for the muxed sockets (/ws/state, /ws/terminals).
// The per-pane /relay/{windowId} endpoint and its handleRelay were retired in
// 260717-803u-relay-mux — all terminal I/O now rides the terminals mux (see
// api/terminals_ws.go), which absorbed handleRelay's per-stream semantics
// verbatim (resolve → session-scoped select → direct attach → PTY pump).
var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

// forceTERM returns a copy of env with TERM set to xterm-256color, replacing
// any inherited value. A relay PTY is always an xterm-256color terminal
// (xterm.js), and tmux matches terminal-overrides against this value to enable
// true-color (RGB/Tc). Shared by the terminals mux's per-stream attach.
func forceTERM(env []string) []string {
	result := make([]string, 0, len(env)+1)
	for _, e := range env {
		if !strings.HasPrefix(e, "TERM=") {
			result = append(result, e)
		}
	}
	return append(result, "TERM=xterm-256color")
}
