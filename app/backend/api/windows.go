package api

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"rk/internal/validate"
)

func (s *Server) handleWindowCreate(w http.ResponseWriter, r *http.Request) {
	session := chi.URLParam(r, "session")
	if errMsg := validate.ValidateName(session, "Session name"); errMsg != "" {
		writeError(w, http.StatusBadRequest, errMsg)
		return
	}

	var body struct {
		Name       string `json:"name"`
		CWD        string `json:"cwd"`
		Type       string `json:"type"`
		Resolution string `json:"resolution"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid JSON body")
		return
	}

	if errMsg := validate.ValidateName(body.Name, "Window name"); errMsg != "" {
		writeError(w, http.StatusBadRequest, errMsg)
		return
	}

	server := serverFromRequest(r)

	// Desktop window creation
	if body.Type == "desktop" {
		resolution := body.Resolution
		if resolution == "" {
			resolution = "1920x1080"
		}
		if errMsg := validate.ValidateResolution(resolution); errMsg != "" {
			writeError(w, http.StatusBadRequest, errMsg)
			return
		}

		// Allocate a free port for VNC
		port, err := allocateFreePort()
		if err != nil {
			writeError(w, http.StatusInternalServerError, "Failed to allocate VNC port")
			return
		}

		// Derive display number from port
		displayNum := port - 5900
		if displayNum < 0 {
			displayNum = port % 1000
		}

		// Create tmux window with desktop: prefix
		windowName := "desktop:" + body.Name
		var resolvedCwd string
		if windows, listErr := s.tmux.ListWindows(session, server); listErr == nil && len(windows) > 0 {
			resolvedCwd = windows[0].WorktreePath
		}
		if err := s.tmux.CreateWindow(session, windowName, resolvedCwd, server); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}

		// Find the newly created window index
		windows, err := s.tmux.ListWindows(session, server)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		windowIndex := -1
		for _, win := range windows {
			if win.Name == windowName {
				windowIndex = win.Index
			}
		}
		if windowIndex < 0 {
			writeError(w, http.StatusInternalServerError, "Failed to find created desktop window")
			return
		}

		// Store VNC port as tmux window option
		if err := s.tmux.SetWindowOption(session, windowIndex, "@rk_vnc_port", strconv.Itoa(port), server); err != nil {
			slog.Error("failed to set VNC port window option", "err", err)
		}

		// Write startup script to temp file (too large for send-keys buffer)
		script := desktopStartupScript(displayNum, port, resolution)
		scriptFile := fmt.Sprintf("/tmp/rk-desktop-%d.sh", port)
		if err := os.WriteFile(scriptFile, []byte(script), 0700); err != nil {
			writeError(w, http.StatusInternalServerError, "Failed to write startup script")
			return
		}
		if err := s.tmux.SendKeys(session, windowIndex, scriptFile, server); err != nil {
			slog.Error("failed to send desktop startup command", "err", err)
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}

		writeJSON(w, http.StatusCreated, map[string]bool{"ok": true})
		return
	}

	// Terminal window creation (existing behavior)
	var resolvedCwd string
	if body.CWD != "" {
		if errMsg := validate.ValidatePath(body.CWD, "Working directory"); errMsg != "" {
			writeError(w, http.StatusBadRequest, errMsg)
			return
		}
		expanded, expandErr := validate.ExpandTilde(body.CWD)
		if expandErr != "" {
			writeError(w, http.StatusBadRequest, expandErr)
			return
		}
		resolvedCwd = expanded
	} else {
		// Default to the cwd of the first window in the session.
		// Use a dedicated timeout context (not the request context) because the
		// result feeds into the subsequent CreateWindow mutation. If we used
		// r.Context() and the client disconnected, ListWindows would return
		// (nil, nil) and the mutation would create the window with an empty cwd.
		cwdCtx, cwdCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cwdCancel()
		if windows, err := s.tmux.ListWindows(cwdCtx, session, server); err == nil && len(windows) > 0 {
			resolvedCwd = windows[0].WorktreePath
		}
	}

	if err := s.tmux.CreateWindow(session, body.Name, resolvedCwd, server); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusCreated, map[string]bool{"ok": true})
}

// allocateFreePort finds a free TCP port using the net.Listen trick.
func allocateFreePort() (int, error) {
	l, err := net.Listen("tcp", ":0")
	if err != nil {
		return 0, err
	}
	port := l.Addr().(*net.TCPAddr).Port
	l.Close()
	return port, nil
}

// desktopStartupScript generates a bash script to launch Xvfb, detect WM, and x11vnc.
// Written to a temp file and executed, avoiding send-keys one-liner parsing issues.
func desktopStartupScript(displayNum, port int, resolution string) string {
	return fmt.Sprintf(`#!/bin/bash
export DISPLAY=:%d

# Isolate per-desktop state so apps (browsers, etc.) don't collide across desktops.
# Each desktop gets unique XDG dirs keyed by display number.
DESKTOP_ID=desktop-%d
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/$DESKTOP_ID"
export XDG_CONFIG_HOME="$HOME/.config/$DESKTOP_ID"
export XDG_DATA_HOME="$HOME/.local/share/$DESKTOP_ID"
export XDG_CACHE_HOME="$HOME/.cache/$DESKTOP_ID"
export XDG_STATE_HOME="$HOME/.local/state/$DESKTOP_ID"
mkdir -p "$XDG_RUNTIME_DIR" "$XDG_CONFIG_HOME" "$XDG_DATA_HOME" "$XDG_CACHE_HOME" "$XDG_STATE_HOME"
chmod 0700 "$XDG_RUNTIME_DIR"

# Chrome/Chromium ignore XDG — patch .desktop files and create wrappers
WRAPPER_DIR="$XDG_RUNTIME_DIR/bin"
DESKTOP_DIR="$XDG_DATA_HOME/applications"
mkdir -p "$WRAPPER_DIR" "$DESKTOP_DIR"

# Find all Chrome/Chromium .desktop files and patch them
for df in /usr/share/applications/google-chrome*.desktop /usr/share/applications/chromium*.desktop; do
  [ -f "$df" ] || continue
  # Extract the actual binary from the first Exec= line
  REAL=$(grep -m1 "^Exec=" "$df" | sed 's/^Exec=//; s/ .*//')
  BNAME=$(basename "$REAL")
  DATA_DIR="$HOME/.config/$DESKTOP_ID/$BNAME"
  # Create wrapper
  cat > "$WRAPPER_DIR/$BNAME" << WRAPPER
#!/bin/bash
exec "$REAL" --user-data-dir="$DATA_DIR" "\$@"
WRAPPER
  chmod +x "$WRAPPER_DIR/$BNAME"
  # Patch .desktop file to use wrapper
  sed "s|Exec=$REAL|Exec=$WRAPPER_DIR/$BNAME|g" "$df" > "$DESKTOP_DIR/$(basename "$df")"
done
export PATH="$WRAPPER_DIR:$PATH"

Xvfb :%d -screen 0 %sx24 &
sleep 1

# Detect window manager / desktop environment
WM=""
NEEDS_DBUS=false
RESOLVED=""
if command -v x-session-manager &>/dev/null; then
  WM=x-session-manager
  RESOLVED="$(readlink -f "$(command -v x-session-manager)" 2>/dev/null)"
elif command -v startplasma-x11 &>/dev/null; then
  WM=startplasma-x11
  RESOLVED=startplasma-x11
else
  for wm in kwin_x11 openbox fluxbox i3 xfwm4 mutter kwin; do
    if command -v "$wm" &>/dev/null; then WM="$wm"; break; fi
  done
fi

# Full desktop sessions need their own dbus
case "$RESOLVED" in
  *startplasma*|*gnome-session*|*xfce4-session*) NEEDS_DBUS=true;;
esac

if [ -n "$WM" ]; then
  if $NEEDS_DBUS && command -v dbus-run-session &>/dev/null; then
    dbus-run-session "$WM" &
  else
    "$WM" &
  fi
  sleep 3
fi

x11vnc -display :%d -rfbport %d -nopw -forever -shared -noxdamage
`, displayNum, displayNum, displayNum, resolution, displayNum, port)
}

// parseWindowIndex extracts and validates the window index from the URL.
func parseWindowIndex(r *http.Request) (int, bool) {
	indexStr := chi.URLParam(r, "index")
	index, err := strconv.Atoi(indexStr)
	if err != nil || index < 0 {
		return 0, false
	}
	return index, true
}

func (s *Server) handleWindowKill(w http.ResponseWriter, r *http.Request) {
	session := chi.URLParam(r, "session")
	if errMsg := validate.ValidateName(session, "Session name"); errMsg != "" {
		writeError(w, http.StatusBadRequest, errMsg)
		return
	}

	index, ok := parseWindowIndex(r)
	if !ok {
		writeError(w, http.StatusBadRequest, "Invalid window index")
		return
	}

	if err := s.tmux.KillWindow(session, index, serverFromRequest(r)); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleWindowRename(w http.ResponseWriter, r *http.Request) {
	session := chi.URLParam(r, "session")
	if errMsg := validate.ValidateName(session, "Session name"); errMsg != "" {
		writeError(w, http.StatusBadRequest, errMsg)
		return
	}

	index, ok := parseWindowIndex(r)
	if !ok {
		writeError(w, http.StatusBadRequest, "Invalid window index")
		return
	}

	var body struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid JSON body")
		return
	}

	if errMsg := validate.ValidateName(body.Name, "Window name"); errMsg != "" {
		writeError(w, http.StatusBadRequest, errMsg)
		return
	}

	if err := s.tmux.RenameWindow(session, index, body.Name, serverFromRequest(r)); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleWindowSelect(w http.ResponseWriter, r *http.Request) {
	session := chi.URLParam(r, "session")
	if errMsg := validate.ValidateName(session, "Session name"); errMsg != "" {
		writeError(w, http.StatusBadRequest, errMsg)
		return
	}

	index, ok := parseWindowIndex(r)
	if !ok {
		writeError(w, http.StatusBadRequest, "Invalid window index")
		return
	}

	if err := s.tmux.SelectWindow(session, index, serverFromRequest(r)); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleWindowSplit(w http.ResponseWriter, r *http.Request) {
	session := chi.URLParam(r, "session")
	if errMsg := validate.ValidateName(session, "Session name"); errMsg != "" {
		writeError(w, http.StatusBadRequest, errMsg)
		return
	}

	index, ok := parseWindowIndex(r)
	if !ok {
		writeError(w, http.StatusBadRequest, "Invalid window index")
		return
	}

	var body struct {
		Horizontal bool `json:"horizontal"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid JSON body")
		return
	}

	paneID, err := s.tmux.SplitWindow(session, index, body.Horizontal, serverFromRequest(r))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "pane_id": paneID})
}

func (s *Server) handleClosePaneKill(w http.ResponseWriter, r *http.Request) {
	session := chi.URLParam(r, "session")
	if errMsg := validate.ValidateName(session, "Session name"); errMsg != "" {
		writeError(w, http.StatusBadRequest, errMsg)
		return
	}

	index, ok := parseWindowIndex(r)
	if !ok {
		writeError(w, http.StatusBadRequest, "Invalid window index")
		return
	}

	if err := s.tmux.KillActivePane(session, index, serverFromRequest(r)); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleWindowKeys(w http.ResponseWriter, r *http.Request) {
	session := chi.URLParam(r, "session")
	if errMsg := validate.ValidateName(session, "Session name"); errMsg != "" {
		writeError(w, http.StatusBadRequest, errMsg)
		return
	}

	index, ok := parseWindowIndex(r)
	if !ok {
		writeError(w, http.StatusBadRequest, "Invalid window index")
		return
	}

	var body struct {
		Keys string `json:"keys"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid JSON body")
		return
	}

	if strings.TrimSpace(body.Keys) == "" {
		writeError(w, http.StatusBadRequest, "Keys cannot be empty")
		return
	}

	if err := s.tmux.SendKeys(session, index, body.Keys, serverFromRequest(r)); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// handleWindowResolution changes the desktop resolution by restarting Xvfb + x11vnc.
func (s *Server) handleWindowResolution(w http.ResponseWriter, r *http.Request) {
	session := chi.URLParam(r, "session")
	if errMsg := validate.ValidateName(session, "Session name"); errMsg != "" {
		writeError(w, http.StatusBadRequest, errMsg)
		return
	}

	index, ok := parseWindowIndex(r)
	if !ok {
		writeError(w, http.StatusBadRequest, "Invalid window index")
		return
	}

	var body struct {
		Resolution string `json:"resolution"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid JSON body")
		return
	}

	if errMsg := validate.ValidateResolution(body.Resolution); errMsg != "" {
		writeError(w, http.StatusBadRequest, errMsg)
		return
	}

	server := serverFromRequest(r)

	// Read existing VNC and websockify ports from window options
	portStr, err := s.tmux.GetWindowOption(session, index, "@rk_vnc_port", server)
	if err != nil {
		writeError(w, http.StatusBadRequest, "Window is not a desktop window or VNC port not set")
		return
	}
	port, err := strconv.Atoi(portStr)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Invalid VNC port value")
		return
	}
	// Derive display number from port (same logic as creation)
	displayNum := port - 5900
	if displayNum < 0 {
		displayNum = port % 1000
	}

	// Send C-c to kill the running bash -c (which kills Xvfb, x11vnc, WM),
	// then send the full startup script at the new resolution.
	if err := s.tmux.SendKeys(session, index, "C-c", server); err != nil {
		slog.Error("failed to send C-c", "err", err)
	}
	time.Sleep(1 * time.Second)

	script := desktopStartupScript(displayNum, port, body.Resolution)
	scriptFile := fmt.Sprintf("/tmp/rk-desktop-%d.sh", port)
	if err := os.WriteFile(scriptFile, []byte(script), 0700); err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to write startup script")
		return
	}
	if err := s.tmux.SendKeys(session, index, scriptFile, server); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// handleDesktopInfo returns the websockify port for a desktop window.
func (s *Server) handleDesktopInfo(w http.ResponseWriter, r *http.Request) {
	session := chi.URLParam(r, "session")
	if errMsg := validate.ValidateName(session, "Session name"); errMsg != "" {
		writeError(w, http.StatusBadRequest, errMsg)
		return
	}

	index, ok := parseWindowIndex(r)
	if !ok {
		writeError(w, http.StatusBadRequest, "Invalid window index")
		return
	}

	server := serverFromRequest(r)

	wsPortStr, err := s.tmux.GetWindowOption(session, index, "@rk_ws_port", server)
	if err != nil {
		writeError(w, http.StatusNotFound, "Not a desktop window or websockify port not set")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"wsPort": wsPortStr})
}
