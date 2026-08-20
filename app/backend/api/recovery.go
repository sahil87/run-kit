package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"rk/internal/snapshot"
	"rk/internal/validate"
)

// recoveryRestoreTimeout bounds the synchronous restore drive. Explicit,
// documented exception to the 5s handler-blocking guidance: restore is rare
// and user-initiated, and each inner tmux call stays individually
// TmuxTimeout-bounded inside snapshot.Restore.
const recoveryRestoreTimeout = 60 * time.Second

// restoreSnapshotFn is the package-var seam over snapshot.Restore so handler
// tests inject a fake engine without a live tmux server (mirrors
// daemonRunningFn in update.go).
var restoreSnapshotFn = snapshot.Restore

// recoveryOffersResponse is the GET /api/recovery wire shape.
type recoveryOffersResponse struct {
	Offers []snapshot.Offer `json:"offers"`
}

// handleRecoveryList serves the restorable-offer set: lingering live-latest
// snapshots whose servers have no live tmux socket. An unwired (nil) or empty
// store yields an empty offers list, never an error. Read-only — live state
// is still derived from tmux (ListServers), never from snapshots.
func (s *Server) handleRecoveryList(w http.ResponseWriter, r *http.Request) {
	offers := []snapshot.Offer{}
	if s.snapshotStore != nil {
		live, err := s.tmux.ListServers(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		derived, err := s.snapshotStore.RestorableOffers(live)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		offers = derived
	}
	writeJSON(w, http.StatusOK, recoveryOffersResponse{Offers: offers})
}

// recoveryServerBody is the shared body of the two recovery mutations —
// body-style server addressing, mirroring POST /api/servers/kill.
type recoveryServerBody struct {
	Server string `json:"server"`
}

// decodeRecoveryBody decodes and validates the body; on failure it writes the
// 400 and returns false. Validation MUST run before any filesystem or tmux
// use — no JSON-sourced value reaches a tmux target unvalidated.
func decodeRecoveryBody(w http.ResponseWriter, r *http.Request) (recoveryServerBody, bool) {
	var body recoveryServerBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid JSON body")
		return body, false
	}
	if errMsg := validate.ValidateServerName(body.Server); errMsg != "" {
		writeError(w, http.StatusBadRequest, errMsg)
		return body, false
	}
	return body, true
}

// handleRecoveryRestore loads the server's latest snapshot and drives the
// restore engine synchronously. The engine's refusal semantics (server alive
// with user-facing sessions, empty snapshot, target disagreement) surface as
// error responses — never as partial success.
func (s *Server) handleRecoveryRestore(w http.ResponseWriter, r *http.Request) {
	body, ok := decodeRecoveryBody(w, r)
	if !ok {
		return
	}
	if s.snapshotStore == nil {
		writeError(w, http.StatusNotFound, fmt.Sprintf("no snapshot found for server %q", body.Server))
		return
	}
	snap, err := s.snapshotStore.LoadLatest(body.Server)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if snap == nil {
		writeError(w, http.StatusNotFound, fmt.Sprintf("no snapshot found for server %q", body.Server))
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), recoveryRestoreTimeout)
	defer cancel()
	report, err := restoreSnapshotFn(ctx, body.Server, snap)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, report)
}

// handleRecoveryDismiss tombstones the server's lingering live-latest so it
// never re-qualifies as an offer. Idempotent: a server with no latest is a
// no-op success.
func (s *Server) handleRecoveryDismiss(w http.ResponseWriter, r *http.Request) {
	body, ok := decodeRecoveryBody(w, r)
	if !ok {
		return
	}
	if s.snapshotStore == nil {
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
		return
	}
	if err := s.snapshotStore.Dismiss(body.Server); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// SetSnapshotStore wires the layout-snapshot store backing the /api/recovery
// endpoints — the same store the snapshotter writes to. nil degrades the
// recovery surface to empty offers / no-op dismiss (the Recovery section then
// never renders).
func (s *Server) SetSnapshotStore(store *snapshot.Store) {
	s.snapshotStore = store
}
