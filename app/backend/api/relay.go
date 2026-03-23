package api

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/creack/pty"
	"github.com/go-chi/chi/v5"
	"github.com/gorilla/websocket"

	"rk/internal/tmux"
	"rk/internal/validate"
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
	session := chi.URLParam(r, "session")
	windowIndex := chi.URLParam(r, "window")

	// Validate inputs
	if errMsg := validate.ValidateName(session, "Session name"); errMsg != "" {
		http.Error(w, errMsg, http.StatusBadRequest)
		return
	}
	// Window index must be a non-negative integer
	winIdx, err := strconv.Atoi(windowIndex)
	if err != nil || winIdx < 0 {
		http.Error(w, "Window index must be a non-negative integer", http.StatusBadRequest)
		return
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		slog.Error("websocket upgrade failed", "err", err)
		return
	}
	defer conn.Close()

	// Determine which tmux server this session lives on
	server := serverFromRequest(r)

	// Verify the session exists and detect window type
	windows, err := s.tmux.ListWindows(r.Context(), session, server)
	if err != nil || windows == nil {
		slog.Warn("session not found", "session", session)
		conn.WriteMessage(websocket.CloseMessage,
			websocket.FormatCloseMessage(4004, "Session not found"))
		return
	}

	// Find the target window and check its type
	var windowType string
	windowFound := false
	for _, win := range windows {
		if win.Index == winIdx {
			windowType = win.Type
			windowFound = true
			break
		}
	}
	if !windowFound {
		conn.WriteMessage(websocket.CloseMessage,
			websocket.FormatCloseMessage(4004, "Window not found"))
		return
	}

	// Branch: desktop VNC proxy vs terminal PTY relay
	if windowType == "desktop" {
		s.handleDesktopRelay(conn, session, winIdx, server)
		return
	}

	// Terminal relay (existing behavior)
	if err := s.tmux.SelectWindow(session, winIdx, server); err != nil {
		slog.Error("select-window failed", "err", err, "session", session, "window", windowIndex)
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

	attachArgs = append(attachArgs, "attach-session", "-t", session)
	cmd := exec.CommandContext(ctx, "tmux", attachArgs...)
	cmd.Env = forceTERM(os.Environ())

	ptmx, err := pty.StartWithSize(cmd, &initialSize)
	if err != nil {
		cancel()
		slog.Error("pty start failed", "err", err, "session", session, "window", windowIndex)
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
			slog.Debug("relay cleanup", "session", session, "window", windowIndex)
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

// handleDesktopRelay proxies a WebSocket connection to the x11vnc VNC WebSocket.
func (s *Server) handleDesktopRelay(conn *websocket.Conn, session string, windowIndex int, server string) {
	// Read @rk_vnc_port from the tmux window option
	portStr, err := s.tmux.GetWindowOption(session, windowIndex, "@rk_vnc_port", server)
	if err != nil {
		slog.Warn("VNC port not found for desktop window", "session", session, "window", windowIndex, "err", err)
		conn.WriteMessage(websocket.CloseMessage,
			websocket.FormatCloseMessage(4002, "VNC port not found"))
		return
	}

	port, err := strconv.Atoi(portStr)
	if err != nil {
		slog.Error("invalid VNC port value", "port", portStr, "err", err)
		conn.WriteMessage(websocket.CloseMessage,
			websocket.FormatCloseMessage(4002, "Invalid VNC port"))
		return
	}

	// Dial the VNC WebSocket on localhost only (security: no external connections)
	vncURL := fmt.Sprintf("ws://localhost:%d", port)
	dialer := websocket.Dialer{
		HandshakeTimeout: 10 * time.Second,
	}
	vncConn, _, err := dialer.Dial(vncURL, nil)
	if err != nil {
		slog.Error("failed to connect to VNC WebSocket", "url", vncURL, "err", err)
		conn.WriteMessage(websocket.CloseMessage,
			websocket.FormatCloseMessage(4003, "VNC connection failed"))
		return
	}

	var once sync.Once
	cleanup := func() {
		once.Do(func() {
			conn.Close()
			vncConn.Close()
			slog.Debug("desktop relay cleanup", "session", session, "window", windowIndex)
		})
	}
	defer cleanup()

	// Bidirectional copy: browser -> VNC
	go func() {
		defer cleanup()
		for {
			msgType, msg, err := conn.ReadMessage()
			if err != nil {
				return
			}
			if err := vncConn.WriteMessage(msgType, msg); err != nil {
				return
			}
		}
	}()

	// Bidirectional copy: VNC -> browser
	for {
		msgType, msg, err := vncConn.ReadMessage()
		if err != nil {
			return
		}
		if err := conn.WriteMessage(msgType, msg); err != nil {
			return
		}
	}
}
