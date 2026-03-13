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
	"strings"
	"sync"
	"time"

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

// ensureTERM returns a copy of env with TERM set to xterm-256color if absent.
// tmux uses the attaching client's TERM to parse input escape sequences (e.g.,
// function keys). Without a proper TERM, sequences like F2 are not recognized.
func ensureTERM(env []string) []string {
	for _, e := range env {
		if strings.HasPrefix(e, "TERM=") {
			return env
		}
	}
	return append(env, "TERM=xterm-256color")
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

	// Wait for the first resize message so we can start the PTY at the correct
	// dimensions. Without this, tmux attaches at the default 80x24 and byobu's
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
	cmd := exec.CommandContext(ctx, "tmux", "attach-session", "-t", session)
	cmd.Env = ensureTERM(os.Environ())

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
