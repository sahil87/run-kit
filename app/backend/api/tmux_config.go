package api

import (
	"context"
	"log/slog"
	"net/http"

	"rk/internal/tmux"
)

// reloadIsManaged / reloadConfigFn / reloadMigrateLegacy are the
// reload-config handler's seams — tests substitute them to pin the
// managed-only gate without a live server. reloadMigrateLegacy is the
// NON-re-marking entry: the once-guard is taken synchronously in the handler
// before the sweep is spawned, so the seam must not mark again.
var (
	reloadIsManaged     = tmux.IsManagedServer
	reloadConfigFn      = tmux.ReloadConfig
	reloadMigrateLegacy = tmux.MigrateLegacyOptionsReport
)

// handleTmuxReloadConfig reloads the managed tmux.conf on the target server.
// External (unmarked) targets are skipped and reported as such — a 200 report,
// not an error — because an external server must never receive rk's conf. A
// managed-check read failure also reports skipped: this path must not 5xx on a
// tmux read wobble. The legacy-option sweep rides the same gate; when it
// changed something the SSE hub is woken (set-option is invisible to the
// control-mode parser).
func (s *Server) handleTmuxReloadConfig(w http.ResponseWriter, r *http.Request) {
	server := serverFromRequest(r)

	managed, err := reloadIsManaged(r.Context(), server)
	if err != nil {
		slog.Debug("tmux reload-config: managed check failed; reporting skipped", "err", err, "server", server)
		writeJSON(w, http.StatusOK, map[string]string{"status": "skipped", "reason": "external"})
		return
	}
	if !managed {
		slog.Debug("tmux reload-config: external server; skipping", "server", server)
		writeJSON(w, http.StatusOK, map[string]string{"status": "skipped", "reason": "external"})
		return
	}
	if err := reloadConfigFn(server); err != nil {
		slog.Error("tmux config reload failed", "err", err, "server", server)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	// The sweep runs off the request path: it is O(carriers) tmux round-trips
	// and must not hold the route past its budget. The once-guard is taken
	// synchronously so concurrent requests never double-run; the hub wake from
	// inside the goroutine already decouples the repaint.
	if tmux.MarkLegacyMigrationAttempt(server) {
		go func() {
			if changed, err := reloadMigrateLegacy(context.Background(), server); err != nil {
				slog.Warn("legacy option sweep failed (best-effort)", "err", err, "server", server)
			} else if changed {
				s.initSSEHub()
				s.sseHub.wake(server)
			}
		}()
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) handleTmuxInitConf(w http.ResponseWriter, r *http.Request) {
	if err := tmux.ForceWriteConfig(); err != nil {
		slog.Error("tmux init-conf failed", "err", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "path": tmux.DefaultConfigPath})
}
