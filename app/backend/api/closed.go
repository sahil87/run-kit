package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"rk/internal/config"
	"rk/internal/riff"
	"rk/internal/sessions"
	"rk/internal/snapshot"
	"rk/internal/validate"
)

// closed.go — the recently-closed-window surface. One kill-seam recorder plus
// four routes (all ?server=-addressed, mutations POST per Constitution IX):
//
//	GET  /api/windows/closed                    → {"closed": [...]}  newest-first
//	POST /api/windows/closed/{id}/reopen        → {"server","session","window","windowId"} (riff-shaped)
//	POST /api/windows/closed/{id}/dismiss       → {"ok": true}
//	POST /api/windows/closed/{id}/resume        → riff-shaped; body {"replaceWindowId": "@N"}
//
// The records live on the per-server {server}.closed/ ring in the snapshot
// store (internal/snapshot) — a per-window recovery backup taken before the
// window dies, exactly the Constitution II recovery-backup category the server
// snapshots already occupy. A nil store degrades the whole surface to an empty
// list / 404s, never errors (the recovery endpoints' posture).

// closedCaptureTimeout bounds the pre-kill capture in handleWindowKill.
// Dedicated (not r.Context()) because the captured record feeds the PushClosed
// mutation — a client disconnect must not truncate it (the handleWindowCreate
// cwd-resolution rationale).
const closedCaptureTimeout = 5 * time.Second

// closedReopenTimeout bounds the synchronous reopen drive. Documented
// exception to the 5s handler-blocking guidance: reopen is rare and
// user-initiated, and each inner tmux call stays individually TmuxTimeout-
// bounded inside snapshot.ReopenWindow — the recovery-restore precedent
// (recoveryRestoreTimeout), sized to a handful of tmux calls rather than a
// whole-server restore.
const closedReopenTimeout = 30 * time.Second

// captureWindowFn / reopenWindowFn are package-var seams over the snapshot
// package so handler tests inject fakes without a live tmux server (mirrors
// restoreSnapshotFn in recovery.go).
var (
	captureWindowFn = snapshot.CaptureWindow
	reopenWindowFn  = snapshot.ReopenWindow
)

// recordClosedWindow captures the about-to-be-killed window onto the server's
// recently-closed ring, returning the pushed record (nil when nothing was
// recorded). It runs BEFORE the kill — the option set dies with the window —
// and ANY failure (capture read, agent-identity walk, push) degrades to
// slog.Debug + nil: recording must never block or fail the kill itself.
func (s *Server) recordClosedWindow(server, windowID string) *snapshot.ClosedWindow {
	ctx, cancel := context.WithTimeout(context.Background(), closedCaptureTimeout)
	defer cancel()

	win, session, err := captureWindowFn(ctx, server, windowID)
	if err != nil {
		slog.Debug("closed-window capture failed; killing without recording", "server", server, "window", windowID, "err", err)
		return nil
	}
	rec := snapshot.ClosedWindow{Server: server, Session: session, Window: win}

	// Agent identity needs a second walk: the layout capture reads carry no
	// @rk_pane_agent_session, so the reconciled identity comes from
	// FetchSessions via the same active-pane-first rollup fork uses. A walk
	// failure forfeits only the agent session fields — the window record
	// itself still pushes.
	if sess, ferr := s.sessions.FetchSessions(ctx, server); ferr != nil {
		slog.Debug("closed-window agent identity walk failed", "server", server, "window", windowID, "err", ferr)
	} else {
		for si := range sess {
			for wi := range sess[si].Windows {
				w := &sess[si].Windows[wi]
				if w.WindowID == windowID {
					rec.AgentProvider, rec.AgentRef, _ = sessions.ResolveAgentPane(w.Panes)
				}
			}
		}
	}

	pushed, err := s.snapshotStore.PushClosed(rec)
	if err != nil {
		slog.Debug("closed-window push failed; killing without recording", "server", server, "window", windowID, "err", err)
		return nil
	}
	return &pushed
}

// handleClosedList serves the server's recently-closed ring newest-first. An
// unwired (nil) or empty store yields an empty list, never an error.
func (s *Server) handleClosedList(w http.ResponseWriter, r *http.Request) {
	closed := []snapshot.ClosedWindow{}
	if s.snapshotStore != nil {
		list, err := s.snapshotStore.ListClosed(serverFromRequest(r))
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		if list != nil {
			closed = list
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"closed": closed})
}

// loadClosedRecord resolves the {id} path param to a record, writing the error
// response and returning false on any failure (nil store, invalid id, store
// fault, unknown id — all 404-class except a store fault). The id shape is
// checked here so a malformed param never reaches the store as a 500.
func (s *Server) loadClosedRecord(w http.ResponseWriter, r *http.Request, server string) (*snapshot.ClosedWindow, bool) {
	id := chi.URLParam(r, "id")
	if s.snapshotStore == nil || !snapshot.ValidClosedID(id) {
		writeError(w, http.StatusNotFound, "no closed-window record "+id)
		return nil, false
	}
	rec, err := s.snapshotStore.LoadClosed(server, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return nil, false
	}
	if rec == nil {
		writeError(w, http.StatusNotFound, "no closed-window record "+chi.URLParam(r, "id"))
		return nil, false
	}
	return rec, true
}

// handleClosedReopen recreates the record's window as a fresh shell (same
// session/name/index-where-feasible/cwd/options/panes/layout) via
// snapshot.ReopenWindow, then drops the record unless it carries an agent
// identity (the resume toast still needs it). A gone session is a 409 naming
// the session AND drops the record — it can never reopen. Engine failures keep
// the record (a transient fault must not lose it).
func (s *Server) handleClosedReopen(w http.ResponseWriter, r *http.Request) {
	server := serverFromRequest(r)
	rec, ok := s.loadClosedRecord(w, r, server)
	if !ok {
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), closedReopenTimeout)
	defer cancel()
	windowID, err := reopenWindowFn(ctx, server, *rec)
	if err != nil {
		var sg *snapshot.SessionGoneError
		if errors.As(err, &sg) {
			if derr := s.snapshotStore.DeleteClosed(server, rec.ID); derr != nil {
				slog.Warn("closed-window record not dropped after session-gone reopen", "server", server, "id", rec.ID, "err", derr)
			}
			writeError(w, http.StatusConflict, err.Error())
			return
		}
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	// A record with an agent identity SURVIVES the plain reopen: the client's
	// post-reopen toast resolves the same id for its "Resume agent" action and
	// drops it via dismiss/resume. Without an agent there is nothing left to
	// offer, so the record is dropped here. A delete failure leaves a stale
	// record the ring cap eventually prunes; it must not turn a successful
	// reopen into an error.
	if rec.AgentProvider == "" {
		if derr := s.snapshotStore.DeleteClosed(server, rec.ID); derr != nil {
			slog.Warn("closed-window record not dropped after reopen", "server", server, "id", rec.ID, "err", derr)
		}
	}
	writeJSON(w, http.StatusOK, map[string]string{
		"server":   server,
		"session":  rec.Session,
		"window":   rec.Window.Name,
		"windowId": windowID,
	})
}

// handleClosedDismiss drops the record without reopening (the toast-dismissal
// path). Idempotent at the store level; an unknown id is still a 404 (the
// client asked about a specific record).
func (s *Server) handleClosedDismiss(w http.ResponseWriter, r *http.Request) {
	server := serverFromRequest(r)
	rec, ok := s.loadClosedRecord(w, r, server)
	if !ok {
		return
	}
	if err := s.snapshotStore.DeleteClosed(server, rec.ID); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// closedResumeBody is the resume request: the window to replace with the
// resumed agent (the fresh shell the reopen just created).
type closedResumeBody struct {
	ReplaceWindowID string `json:"replaceWindowId"`
}

// handleClosedResume relaunches the record's agent conversation through the
// riff fork seam and replaces the reopened placeholder shell with the spawned
// window. Gates mirror handleWindowFork (the record IS the resolve output —
// captured at the kill seam — so no FetchSessions walk here):
//
//	400: malformed body/replaceWindowId; the record's first-pane cwd is not
//	     inside a git repo (forkNonRepoMsg); engine validation errors
//	404: unknown record id; no agent identity recorded; a non-claude provider;
//	     a non-UUID recorded ref
//	500: unwired engine; engine subprocess failure; the placeholder kill
//
// The record is dropped only on success (and a gate that makes resume
// impossible leaves it — the client falls back to the plain-reopened shell and
// dismisses).
func (s *Server) handleClosedResume(w http.ResponseWriter, r *http.Request) {
	server := serverFromRequest(r)
	rec, ok := s.loadClosedRecord(w, r, server)
	if !ok {
		return
	}

	var body closedResumeBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid JSON body")
		return
	}
	if errMsg := validate.ValidateWindowID(body.ReplaceWindowID, "Window ID"); errMsg != "" {
		writeError(w, http.StatusBadRequest, errMsg)
		return
	}

	if rec.AgentProvider == "" {
		writeError(w, http.StatusNotFound, "no agent session recorded for this window")
		return
	}
	if rec.AgentProvider != forkProviderClaude {
		// A well-formed but non-resumable provider: the window HAS an agent
		// session, just not one --resume applies to (fork's non-claude posture).
		writeError(w, http.StatusNotFound, fmt.Sprintf("cannot resume a %q session — conversation resume requires provider %q", rec.AgentProvider, forkProviderClaude))
		return
	}
	// Strict UUID gate BEFORE the ref can reach any argv/shell composition
	// (Constitution I) — the same gate fork applies to a live pane's ref.
	if !forkSessionUUIDRe.MatchString(rec.AgentRef) {
		writeError(w, http.StatusNotFound, "malformed agent session ref for this window")
		return
	}

	// The record's first pane cwd is the resume directory (the fork gate's
	// cwd-verbatim rule: claude keys its transcript store by the exact cwd).
	// FindGitRoot only answers "is this inside a repo at all".
	cwd := ""
	if len(rec.Window.Panes) > 0 {
		cwd = rec.Window.Panes[0].Cwd
	}
	if config.FindGitRoot(cwd) == "" {
		writeError(w, http.StatusBadRequest, forkNonRepoMsg(cwd))
		return
	}

	// Guard the optional engine (NewTestRouter leaves it nil) — an unwired
	// engine is a server misconfiguration (500), not a client fault.
	if s.riff == nil {
		writeError(w, http.StatusInternalServerError, "Riff engine not configured")
		return
	}

	// Background context (not r.Context()) bounded by the engine's aggregate
	// budget, so a client disconnect never orphans a half-created window —
	// handleWindowFork's rationale, same constant.
	engineCtx, engineCancel := context.WithTimeout(context.Background(), riffSpawnTimeout)
	defer engineCancel()

	res, err := s.riff.Spawn(engineCtx, riff.Options{
		Server:  server,
		Session: rec.Session,
		// Byte-for-byte the fork wiring: checkout mode roots the window at the
		// passed directory (no wt create), the ref composes
		// `--resume <uuid> --fork-session` inside the engine.
		Where:            "checkout",
		RepoRoot:         cwd,
		ResumeSessionRef: rec.AgentRef,
		WindowNameBase:   rec.Window.Name,
	})
	if err != nil {
		writeError(w, riffStatusForError(err), err.Error())
		return
	}

	// Re-stamp the record's @rk_win_* set onto the spawned window — riff's
	// spawn does not know it. Best-effort: the window exists and works, it just
	// misses presentation options, so a stamp failure logs and the request still
	// succeeds.
	stampCtx, stampCancel := context.WithTimeout(context.Background(), closedCaptureTimeout)
	defer stampCancel()
	if wops := snapshot.WindowOptionOps(rec.Window); len(wops) > 0 {
		if serr := s.tmux.SetWindowOptions(stampCtx, res.WindowID, server, wops); serr != nil {
			slog.Warn("closed-window resume: options not re-stamped on spawned window",
				"server", server, "window", res.WindowID, "err", serr)
		}
	}

	// Kill the reopened placeholder shell DIRECTLY — never through
	// handleWindowKill, or the placeholder would land on the ring as a phantom
	// closed record. A kill failure is a 500 with the record KEPT (resume did
	// not complete: both windows exist, the user can retry).
	if err := s.tmux.KillWindow(body.ReplaceWindowID, server); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	if derr := s.snapshotStore.DeleteClosed(server, rec.ID); derr != nil {
		slog.Warn("closed-window record not dropped after resume", "server", server, "id", rec.ID, "err", derr)
	}
	writeJSON(w, http.StatusOK, map[string]string{
		"server":   res.Server,
		"session":  res.Session,
		"window":   res.WindowName,
		"windowId": res.WindowID,
	})
}
