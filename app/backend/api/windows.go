package api

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net"
	"net/http"
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

		// Allocate a free port via net.Listen
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

		// Store VNC port as tmux window option via internal/tmux (not in shell script)
		if err := s.tmux.SetWindowOption(session, windowIndex, "@rk_vnc_port", strconv.Itoa(port), server); err != nil {
			slog.Error("failed to set VNC port window option", "err", err)
			// Non-fatal — relay will fail to connect but desktop still works
		}

		// Generate and send startup script
		script := desktopStartupScript(displayNum, port, resolution)
		if err := s.tmux.SendKeys(session, windowIndex, script, server); err != nil {
			slog.Error("failed to send desktop startup script", "err", err)
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

// desktopStartupScript generates the shell script to launch Xvfb, detect WM, and start x11vnc.
// The VNC port is stored as a tmux window option by the caller (via SetWindowOption),
// not inside this script, to keep all tmux interaction through internal/tmux.
func desktopStartupScript(displayNum, port int, resolution string) string {
	return fmt.Sprintf(`export DISPLAY=:%d && `+
		`Xvfb :%d -screen 0 %sx24 &>/dev/null & `+
		`sleep 1 && `+
		`WM=""; `+
		`if command -v x-session-manager &>/dev/null; then WM=x-session-manager; `+
		`elif [ -n "$XDG_CURRENT_DESKTOP" ]; then `+
		`case "$XDG_CURRENT_DESKTOP" in `+
		`GNOME) command -v mutter &>/dev/null && WM=mutter;; `+
		`KDE) command -v kwin &>/dev/null && WM=kwin;; `+
		`XFCE) command -v xfwm4 &>/dev/null && WM=xfwm4;; `+
		`esac; `+
		`fi; `+
		`if [ -z "$WM" ]; then `+
		`for wm in openbox fluxbox i3 xfwm4 mutter kwin; do `+
		`if command -v "$wm" &>/dev/null; then WM="$wm"; break; fi; `+
		`done; `+
		`fi; `+
		`[ -n "$WM" ] && $WM &>/dev/null & `+
		`exec x11vnc -display :%d -rfbport %d -nopw -forever -shared -noxdamage -ws`,
		displayNum, displayNum, resolution,
		displayNum, port,
	)
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

	// Read existing VNC port from window option
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

	// Send restart script: kill existing Xvfb and x11vnc, relaunch at new resolution
	script := fmt.Sprintf(
		`pkill -f 'Xvfb :%d' 2>/dev/null; pkill -f 'x11vnc.*:%d' 2>/dev/null; sleep 0.5 && `+
			`export DISPLAY=:%d && `+
			`Xvfb :%d -screen 0 %sx24 &>/dev/null & `+
			`sleep 1 && `+
			`exec x11vnc -display :%d -rfbport %d -nopw -forever -shared -noxdamage -ws`,
		displayNum, displayNum,
		displayNum,
		displayNum, body.Resolution,
		displayNum, port,
	)

	if err := s.tmux.SendKeys(session, index, script, server); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
