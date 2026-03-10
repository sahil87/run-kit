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

	"run-kit/internal/tmux"
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

func handleRelay(w http.ResponseWriter, r *http.Request) {
	session := chi.URLParam(r, "session")
	windowIndex := chi.URLParam(r, "window")

	// Validate inputs
	if errMsg := validate.ValidateName(session, "Session name"); errMsg != "" {
		http.Error(w, errMsg, http.StatusBadRequest)
		return
	}
	// Window index must be a non-negative integer
	for _, c := range windowIndex {
		if c < '0' || c > '9' {
			http.Error(w, "Window index must be an integer", http.StatusBadRequest)
			return
		}
	}

	winIdx, _ := strconv.Atoi(windowIndex)

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		slog.Error("websocket upgrade failed", "err", err)
		return
	}
	defer conn.Close()

	// Create independent pane via split-window (agent pane 0 untouched)
	paneID, err := tmux.SplitWindow(session, winIdx)
	if err != nil {
		slog.Error("split-window failed", "err", err, "session", session, "window", windowIndex)
		conn.WriteMessage(websocket.CloseMessage,
			websocket.FormatCloseMessage(4001, "Failed to create tmux pane"))
		return
	}

	// Attach to the NEW pane via pty
	ctx, cancel := context.WithCancel(context.Background())
	cmd := exec.CommandContext(ctx, "tmux", "attach-session", "-t", paneID)
	cmd.Env = os.Environ()

	ptmx, err := pty.Start(cmd)
	if err != nil {
		cancel()
		tmux.KillPane(paneID)
		slog.Error("pty start failed", "err", err, "paneID", paneID)
		conn.WriteMessage(websocket.CloseMessage,
			websocket.FormatCloseMessage(4001, "Failed to attach to tmux pane"))
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
			tmux.KillPane(paneID)
			slog.Debug("relay cleanup", "paneID", paneID)
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
			if err := conn.WriteMessage(websocket.TextMessage, buf[:n]); err != nil {
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
