package api

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"

	"github.com/creack/pty"
	"github.com/go-chi/chi/v5"
	"github.com/gorilla/websocket"

	"rk/internal/tmux"
	"rk/internal/validate"
)

// newEphemeralRelayName returns a unique ephemeral session name of the form
// "rk-relay-<8 hex chars>". The 8-hex suffix is read from crypto/rand and is
// never derived from user input — keeping the surface inside the relay handler
// closed against injection (constitution I).
func newEphemeralRelayName() (string, error) {
	var b [4]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	return fmt.Sprintf("%s%s", tmux.RelaySessionPrefix, hex.EncodeToString(b[:])), nil
}

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
	// Percent-decode the path param: window IDs contain '@', which clients
	// URL-encode to '%40', and chi v5 preserves the encoded form in URLParam
	// when RawPath is set.
	windowID, err := url.PathUnescape(chi.URLParam(r, "windowId"))
	if err != nil {
		http.Error(w, "Invalid window ID encoding", http.StatusBadRequest)
		return
	}

	// Validate the window ID before any tmux interaction or WS upgrade
	// (constitution §I — Security First). A malformed ID is a 400 before upgrade.
	if errMsg := validate.ValidateWindowID(windowID, "Window ID"); errMsg != "" {
		http.Error(w, errMsg, http.StatusBadRequest)
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

	// Resolve the owning session from the window ID. The per-WebSocket ephemeral
	// grouped-session mechanism keys off the *real session name*, so we derive it
	// from the window ID via a targeted display-message lookup. A missing window
	// (resolution fails or returns empty) preserves the existing 4004 close code.
	resolveCtx, resolveCancel := context.WithTimeout(r.Context(), 5*time.Second)
	session, err := s.tmux.ResolveWindowSession(resolveCtx, server, windowID)
	resolveCancel()
	if err != nil || session == "" {
		slog.Warn("window not found", "windowID", windowID, "err", err)
		conn.WriteMessage(websocket.CloseMessage,
			websocket.FormatCloseMessage(4004, "Window not found"))
		return
	}

	// Allocate a per-WebSocket ephemeral grouped session. tmux session groups
	// share window membership but maintain independent active-window state, so
	// each relay can SelectWindow on its own ephemeral without disturbing other
	// clients attached to the same real session (e.g., other board panes, or
	// other browser tabs).
	ephemeral, err := newEphemeralRelayName()
	if err != nil {
		slog.Error("ephemeral name generation failed", "err", err)
		conn.WriteMessage(websocket.CloseMessage,
			websocket.FormatCloseMessage(4001, "Failed to allocate relay session"))
		return
	}
	if err := s.tmux.NewGroupedSession(r.Context(), server, session, ephemeral); err != nil {
		slog.Warn("new-session (grouped) failed", "err", err, "session", session, "ephemeral", ephemeral)
		conn.WriteMessage(websocket.CloseMessage,
			websocket.FormatCloseMessage(4004, "Session not found"))
		return
	}
	// Best-effort cleanup with a fresh context — r.Context() is cancelled at
	// disconnect time (the trigger for this defer), so reusing it would cause
	// the kill to be cancelled before tmux can run it.
	defer func() {
		if err := s.tmux.KillSessionCtx(context.Background(), server, ephemeral); err != nil {
			slog.Debug("ephemeral cleanup failed", "err", err, "ephemeral", ephemeral)
		}
	}()

	// Stamp the ephemeral with this rk serve process's PID BEFORE it becomes
	// attachable (before SelectWindowInSession). A sibling startup sweep reaps
	// any rk-relay-* whose @rk_owner_pid is empty, so an attachable-but-unstamped
	// relay is indistinguishable from an orphan and would be wrongly killed.
	// Stamping first guarantees the only unstamped relays a sweep can see are
	// genuine orphans (owner already exited), never this live instance's relay.
	//
	// On stamp failure the relay is unprotectable — keeping it open is a false
	// promise (the next sweep would reap owner=="" and drop the terminal). So we
	// abort cleanly: log, close the WebSocket with the relay-allocation close
	// code, and return — the deferred KillSessionCtx above reaps the half-owned
	// ephemeral. This mirrors every other setup-step failure in handleRelay.
	if err := s.tmux.SetSessionOwnerPID(r.Context(), server, ephemeral, os.Getpid()); err != nil {
		slog.Warn("relay owner-pid stamp failed", "err", err, "ephemeral", ephemeral)
		conn.WriteMessage(websocket.CloseMessage,
			websocket.FormatCloseMessage(4001, "Failed to allocate relay session"))
		return
	}

	// Select the window on the ephemeral, scoped to the ephemeral session. A bare
	// window-id target (`select-window -t @N`) is ambiguous inside a session group
	// — members share window membership but keep independent active-window state,
	// so tmux could set the active window on the real session or another group
	// member. Qualifying the target as "<ephemeral>:@N" pins the active window to
	// THIS WebSocket's ephemeral, preserving multi-client isolation.
	if err := s.tmux.SelectWindowInSession(ephemeral, windowID, server); err != nil {
		slog.Error("select-window failed", "err", err, "ephemeral", ephemeral, "windowID", windowID)
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

	// Attach to the ephemeral, not the real session — this is the linchpin of
	// the grouped-session fix.
	attachArgs = append(attachArgs, "attach-session", "-t", ephemeral)
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
