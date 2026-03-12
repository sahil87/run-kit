package api

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/exec"
	"strconv"
	"sync"

	"github.com/creack/pty"
	"github.com/go-chi/chi/v5"
	"github.com/gorilla/websocket"

	"run-kit/internal/validate"
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

	// Select the target window so attach-session shows the right content
	if err := s.tmux.SelectWindow(session, winIdx); err != nil {
		slog.Error("select-window failed", "err", err, "session", session, "window", windowIndex)
		conn.WriteMessage(websocket.CloseMessage,
			websocket.FormatCloseMessage(4001, "Failed to select tmux window"))
		return
	}

	// Attach to the session via PTY — renders the selected window as-is (no split)
	ctx, cancel := context.WithCancel(context.Background())
	cmd := exec.CommandContext(ctx, "tmux", "attach-session", "-t", session)
	cmd.Env = os.Environ()

	ptmx, err := pty.Start(cmd)
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
				conn.Close()
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
