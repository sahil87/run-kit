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

	// Verify the session exists
	windows, err := s.tmux.ListWindows(r.Context(), session, server)
	if err != nil || windows == nil {
		slog.Warn("session not found", "session", session)
		conn.WriteMessage(websocket.CloseMessage,
			websocket.FormatCloseMessage(4004, "Session not found"))
		return
	}

	// Verify the target window exists
	windowFound := false
	for _, w := range windows {
		if w.Index == winIdx {
			windowFound = true
			break
		}
	}
	if !windowFound {
		slog.Error("window not found", "session", session, "window", windowIndex)
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

	// Create a linked (grouped) session so this relay connection has its own
	// independent window focus. Multiple connections to the same session each
	// get their own linked session and can view different windows simultaneously.
	linkedSession := fmt.Sprintf("_rk-relay-%d", time.Now().UnixNano())
	var newSessArgs []string
	if server != "default" {
		newSessArgs = []string{"-L", server}
	}
	newSessArgs = append(newSessArgs, "new-session", "-d", "-t", session, "-s", linkedSession)
	newSessCmd := exec.CommandContext(r.Context(), "tmux", newSessArgs...)
	if out, err := newSessCmd.CombinedOutput(); err != nil {
		slog.Error("linked session creation failed", "err", err, "output", string(out), "session", session)
		conn.WriteMessage(websocket.CloseMessage,
			websocket.FormatCloseMessage(4001, "Failed to create linked session"))
		return
	}

	// Hide status bar in linked session
	var statusArgs []string
	if server != "default" {
		statusArgs = []string{"-L", server}
	}
	statusArgs = append(statusArgs, "set-option", "-s", "-t", linkedSession, "status", "off")
	exec.CommandContext(r.Context(), "tmux", statusArgs...).Run()

	// Select the target window in the linked session
	var selectArgs []string
	if server != "default" {
		selectArgs = []string{"-L", server}
	}
	selectArgs = append(selectArgs, "select-window", "-t", fmt.Sprintf("%s:%d", linkedSession, winIdx))
	selectCmd := exec.CommandContext(r.Context(), "tmux", selectArgs...)
	if out, err := selectCmd.CombinedOutput(); err != nil {
		slog.Error("select-window in linked session failed", "err", err, "output", string(out))
	}

	ctx, cancel := context.WithCancel(context.Background())
	var attachArgs []string
	if server != "default" {
		attachArgs = []string{"-L", server}
	}
	if confPath := tmux.ConfigPath(); confPath != "" {
		attachArgs = append(attachArgs, "-f", confPath)
	}
	if err := tmux.ReloadConfig(server); err != nil {
		slog.Debug("config reload before attach (best-effort)", "server", server, "err", err)
	}

	attachArgs = append(attachArgs, "attach-session", "-t", linkedSession)
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
			// Kill the linked session so it doesn't linger after disconnect
			var killArgs []string
			if server != "default" {
				killArgs = []string{"-L", server}
			}
			killArgs = append(killArgs, "kill-session", "-t", linkedSession)
			killCmd := exec.Command("tmux", killArgs...)
			if err := killCmd.Run(); err != nil {
				slog.Debug("linked session cleanup failed", "err", err, "linked", linkedSession)
			}
			// Set a short read deadline to unblock the main goroutine's
			// conn.ReadMessage() when the PTY dies while the client is idle.
			conn.SetReadDeadline(time.Now().Add(100 * time.Millisecond))
			slog.Debug("relay cleanup", "session", session, "window", windowIndex, "linked", linkedSession)
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
