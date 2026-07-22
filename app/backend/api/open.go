package api

import (
	"context"
	"encoding/json"
	"net/http"
	"path/filepath"
	"time"

	"rk/internal/sessions"
	"rk/internal/wt"
)

// open.go — the Open-in-App backend surface (260722-6d0f):
//
//   - GET  /api/open-apps — the host-detected app registry from
//     `wt open --list --json`, degrading FAIL-SILENT to `[]` when wt is
//     absent, older than the --list flag, or erroring (toolkit discipline:
//     the frontend hides the "on host" section when the list is empty).
//   - POST /api/open      — launch an app on the host via `wt open <path> -a
//     <app>` (POST per Constitution IX). Both body fields are validated
//     BEFORE exec (Constitution I): the path against the server-derived pane
//     cwds / worktree paths (never trusting the client), the app id against
//     the live registry.
//
// All wt interaction goes through the WtOps seam (Constitution III wrapper,
// internal/wt) so tests stub the wrapper.

// openDeriveTimeout bounds the FetchSessions snapshot used for the path
// allowlist — the same 5s route-blocking budget the other tmux-derived
// handlers keep.
const openDeriveTimeout = 5 * time.Second

// handleOpenApps returns the host app registry.
//
//	GET /api/open-apps
//	200: [{"id":"vscode","label":"VS Code","kind":"editor"}, ...]
//	200: [] — wt absent / too old / erroring (fail-silent, never an error status)
func (s *Server) handleOpenApps(w http.ResponseWriter, r *http.Request) {
	apps, err := s.wt.ListApps(r.Context())
	if err != nil || apps == nil {
		// Fail-silent degradation: an absent or pre---list wt is an expected
		// deployment state, not a server error. Debug-log for diagnosability.
		if err != nil {
			s.logger.Debug("open-apps: wt registry unavailable", "err", err)
		}
		apps = []wt.App{}
	}
	writeJSON(w, http.StatusOK, apps)
}

// handleOpen launches a host app on a validated folder.
//
//	POST /api/open?server=<name>
//	body: {"path": "<abs path>", "app": "<app id>"}
//	200: {"ok": true}
//	400: invalid JSON; missing/relative path; path not derived from the
//	     server's panes/worktrees; app id not in the live registry
//	500: session snapshot unavailable
//	502: wt launch failed
func (s *Server) handleOpen(w http.ResponseWriter, r *http.Request) {
	server := serverFromRequest(r)

	var body struct {
		Path string `json:"path"`
		App  string `json:"app"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid JSON body")
		return
	}
	if body.Path == "" || !filepath.IsAbs(body.Path) {
		writeError(w, http.StatusBadRequest, "path must be an absolute path")
		return
	}
	if body.App == "" {
		writeError(w, http.StatusBadRequest, "app is required")
		return
	}

	// Validate the app id against the LIVE registry. When the registry is
	// unavailable (wt absent/old/erroring) no app is launchable — reject
	// rather than exec blind.
	apps, err := s.wt.ListApps(r.Context())
	if err != nil || !appInRegistry(apps, body.App) {
		writeError(w, http.StatusBadRequest, "unknown app")
		return
	}

	// Validate the path against server-derived state (Constitution X): it
	// must match a currently-derived pane cwd or window worktree path on the
	// request's server. Dedicated timeout — the derivation feeds the launch.
	ctx, cancel := context.WithTimeout(r.Context(), openDeriveTimeout)
	defer cancel()
	snapshot, err := s.sessions.FetchSessions(ctx, server)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to derive session paths")
		return
	}
	if !pathDerivedFromSessions(snapshot, body.Path) {
		writeError(w, http.StatusBadRequest, "path is not a known pane or worktree path")
		return
	}

	if err := s.wt.Open(r.Context(), body.Path, body.App); err != nil {
		s.logger.Error("open: wt launch failed", "path", body.Path, "app", body.App, "err", err)
		writeError(w, http.StatusBadGateway, "Failed to launch app")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// appInRegistry reports whether the app id is present in the registry.
func appInRegistry(apps []wt.App, id string) bool {
	for _, a := range apps {
		if a.ID == id {
			return true
		}
	}
	return false
}

// pathDerivedFromSessions reports whether the candidate path matches a pane
// cwd or a window worktree path in the sessions snapshot. Both sides are
// filepath.Clean-normalized so trailing-slash variants of the same derived
// path compare equal; no other transformation is applied (the allowlist is
// exact-match by design — parents/children of a derived path do NOT pass).
func pathDerivedFromSessions(snapshot []sessions.ProjectSession, candidate string) bool {
	want := filepath.Clean(candidate)
	for _, sess := range snapshot {
		for _, win := range sess.Windows {
			if win.WorktreePath != "" && filepath.Clean(win.WorktreePath) == want {
				return true
			}
			for _, pane := range win.Panes {
				if pane.Cwd != "" && filepath.Clean(pane.Cwd) == want {
					return true
				}
			}
		}
	}
	return false
}
