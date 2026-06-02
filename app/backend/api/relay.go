package api

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"

	"github.com/creack/pty"
	"github.com/gorilla/websocket"

	"rk/internal/tmux"
)

// No timeout for the attach command — it's a long-lived process that stays alive
// for the duration of the WebSocket connection. Cancellation happens via the
// cancel() call in the cleanup function on disconnect.

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

type resizeMsg struct {
	Type string `json:"type"`
	Cols uint16 `json:"cols"`
	Rows uint16 `json:"rows"`
}

// ensureTERM returns a copy of env with TERM set to xterm-256color if absent.
// forceTERM sets TERM=xterm-256color for relay clients, replacing any inherited
// value. The relay PTY is always an xterm-256color terminal (xterm.js), and tmux
// matches terminal-overrides against this value to enable true-color (RGB/Tc).
func forceTERM(env []string) []string {
	result := make([]string, 0, len(env)+1)
	for _, e := range env {
		if !strings.HasPrefix(e, "TERM=") {
			result = append(result, e)
		}
	}
	return append(result, "TERM=xterm-256color")
}

func (s *Server) handleRelay(w http.ResponseWriter, r *http.Request) {
	// Percent-decode + validate the window ID through the single shared helper
	// (the same one parseWindowID uses) so the REST and relay entry points
	// cannot drift (the drift that caused bug #205). A malformed/non-decodable
	// ID is a 400 before any tmux interaction or WS upgrade (constitution §I —
	// Security First).
	windowID, ok := decodeWindowID(r)
	if !ok {
		http.Error(w, "Invalid window ID", http.StatusBadRequest)
		return
	}

	// Determine which tmux server this window lives on
	server := serverFromRequest(r)

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		slog.Error("websocket upgrade failed", "err", err)
		return
	}
	defer conn.Close()

	// Resolve the owning session from the window ID. In the move-based model a
	// window lives in exactly ONE session — either a normal home session or its
	// board pin-session (`_rk-pin-*`). The relay attaches the PTY DIRECTLY to that
	// real session (no per-WebSocket ephemeral grouped session): single-window
	// pin-sessions remove window *sharing*, which was the only reason the
	// ephemeral isolation layer existed. A missing window (resolution fails or
	// returns empty) preserves the existing 4004 close code.
	resolveCtx, resolveCancel := context.WithTimeout(r.Context(), 5*time.Second)
	session, err := s.tmux.ResolveWindowSession(resolveCtx, server, windowID)
	resolveCancel()
	if err != nil || session == "" {
		slog.Warn("window not found", "windowID", windowID, "err", err)
		conn.WriteMessage(websocket.CloseMessage,
			websocket.FormatCloseMessage(4004, "Window not found"))
		return
	}

	// Select the window on its real session so the attach renders the right
	// window. The accepted tradeoff (#1 in the intake): the real session has a
	// single active-window pointer shared across attachments, so multi-client
	// navigation mutates the real session's active window. For a pin-session this
	// is a no-op — its sole window is permanently active.
	if err := s.tmux.SelectWindow(windowID, server); err != nil {
		slog.Error("select-window failed", "err", err, "session", session, "windowID", windowID)
		conn.WriteMessage(websocket.CloseMessage,
			websocket.FormatCloseMessage(4004, "Window not found"))
		return
	}

	// Wait for the first resize message so we can start the PTY at the correct
	// dimensions. Without this, tmux attaches at the default 80x24 and the
	// status bar renders in the wrong position.
	var initialSize pty.Winsize
	initialSize.Cols = 80
	initialSize.Rows = 24

	conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	if _, msg, err := conn.ReadMessage(); err == nil {
		var resize resizeMsg
		if json.Unmarshal(msg, &resize) == nil && resize.Type == "resize" && resize.Cols > 0 && resize.Rows > 0 {
			initialSize.Cols = resize.Cols
			initialSize.Rows = resize.Rows
		}
	}
	conn.SetReadDeadline(time.Time{}) // clear deadline

	// Attach to the session via PTY — renders the selected window as-is (no split)
	ctx, cancel := context.WithCancel(context.Background())
	var attachArgs []string
	if server != "default" {
		attachArgs = []string{"-L", server}
	}
	if confPath := tmux.ConfigPath(); confPath != "" {
		attachArgs = append(attachArgs, "-f", confPath)
	}
	// Source-file the config into the running server so terminal-overrides
	// (true color) and style settings are active even if the server was
	// created outside of rk. Best-effort — don't block the attach.
	if err := tmux.ReloadConfig(server); err != nil {
		slog.Debug("config reload before attach (best-effort)", "server", server, "err", err)
	}

	// Attach DIRECTLY to the resolved owning session (home or `_rk-pin-*`). No
	// ephemeral, no defer-kill — the session is durable and owned by tmux.
	attachArgs = append(attachArgs, "attach-session", "-t", session)
	cmd := exec.CommandContext(ctx, "tmux", attachArgs...)
	cmd.Env = forceTERM(os.Environ())

	ptmx, err := pty.StartWithSize(cmd, &initialSize)
	if err != nil {
		cancel()
		slog.Error("pty start failed", "err", err, "session", session, "windowID", windowID)
		conn.WriteMessage(websocket.CloseMessage,
			websocket.FormatCloseMessage(4001, "Failed to attach to tmux session"))
		return
	}

	var once sync.Once
	cleanup := func() {
		once.Do(func() {
			cancel()
			ptmx.Close()
			if cmd.Process != nil {
				cmd.Process.Kill()
			}
			// Set a short read deadline to unblock the main goroutine's
			// conn.ReadMessage() when the PTY dies while the client is idle.
			conn.SetReadDeadline(time.Now().Add(100 * time.Millisecond))
			slog.Debug("relay cleanup", "session", session, "windowID", windowID)
		})
	}
	defer cleanup()

	// Relay pty output -> WebSocket
	go func() {
		buf := make([]byte, 4096)
		for {
			n, err := ptmx.Read(buf)
			if err != nil {
				if err != io.EOF {
					slog.Debug("pty read error", "err", err)
				}
				cleanup()
				return
			}
			if err := conn.WriteMessage(websocket.BinaryMessage, buf[:n]); err != nil {
				return
			}
		}
	}()

	// Relay WebSocket input -> pty
	for {
		_, msg, err := conn.ReadMessage()
		if err != nil {
			break
		}

		// Check for resize messages
		var resize resizeMsg
		if json.Unmarshal(msg, &resize) == nil && resize.Type == "resize" && resize.Cols > 0 && resize.Rows > 0 {
			pty.Setsize(ptmx, &pty.Winsize{Cols: resize.Cols, Rows: resize.Rows})
			continue
		}

		// Send raw input to pty
		if _, err := ptmx.Write(msg); err != nil {
			break
		}
	}
}
