package snapshot

import (
	"context"
	"fmt"
	"log/slog"
)

// SessionGoneError reports that the session a closed-window record belongs to
// no longer exists on its server. Reopen refuses (never recreates a session —
// a reopen that silently births a session group is a bigger action than the
// user asked for); the api layer maps this to 409 and drops the record, since
// a record whose session is gone can never reopen.
type SessionGoneError struct{ Session string }

func (e *SessionGoneError) Error() string {
	return fmt.Sprintf("session %q no longer exists", e.Session)
}

// ReopenWindow recreates one closed window from its record onto the named
// (live) server: same session, name, index where feasible, pane cwds as fresh
// shells, split geometry from the stored layout (best-effort), and the
// rk-owned presentation options. A fresh shell, never a process resurrection —
// Pane.Command is informational only. Every tmux invocation goes through
// internal/tmux with the explicit server socket (Constitution §I); reopen is
// user-initiated only.
func ReopenWindow(ctx context.Context, server string, rec ClosedWindow) (windowID string, err error) {
	return reopenWindow(ctx, server, rec, productionRestoreOps())
}

// reopenWindow is the engine half of ReopenWindow, driving the restore engine's
// per-window helpers over an injectable restoreOps (mirrors Restore/restore).
//
// Failure posture mirrors restore: the SESSION check and the window CREATE are
// fatal (there is nothing to hang the rest on); every per-step degradation
// after that (cwd fallback, split/layout/pane-select/options/select failures)
// degrades to a log line — reopen returns no report, so the notes restore would
// collect become slog lines here. The window the user asked for exists either
// way; a missing web tab or an unselected window is cosmetic, a silent abort is
// not.
func reopenWindow(ctx context.Context, server string, rec ClosedWindow, ops restoreOps) (string, error) {
	// Session check: the record's owning session must still exist. ListSessions
	// maps a dead server to (nil, nil), which lands here as session-gone too —
	// a reopen onto a dead server is the whole-snapshot Restore path's job.
	live, err := ops.listSessions(ctx, server)
	if err != nil {
		return "", fmt.Errorf("reopen %s: probing sessions: %w", server, err)
	}
	found := false
	for _, sess := range live {
		if sess.Name == rec.Session {
			found = true
			break
		}
	}
	if !found {
		return "", &SessionGoneError{Session: rec.Session}
	}

	// A stored cwd whose directory is gone (deleted worktree) degrades to ""
	// (the server default dir) — a dead cwd must never fail the reopen.
	cwd, cwdNote := restoreCwd(ops, firstPaneCwd(rec.Window))
	if cwdNote != "" {
		slog.Debug("reopen: "+cwdNote, "server", server, "session", rec.Session, "window", rec.Window.Name)
	}

	newID, err := ops.createWindowAt(rec.Session, rec.Window.Index, rec.Window.Name, cwd, server)
	if err != nil {
		// The stored index is occupied on the live session — fall back to
		// appending after the current window (never renumber live neighbours).
		newID, err = ops.createWindowAppend(rec.Session, rec.Window.Name, cwd, server)
		if err != nil {
			return "", fmt.Errorf("reopen %s session %q: %w", server, rec.Session, err)
		}
		slog.Debug("reopen: stored index occupied, appended after current window",
			"server", server, "session", rec.Session, "index", rec.Window.Index)
	}

	// Additional panes: fresh shells at the recorded cwds, appended as
	// sequential splits. Fidelity note: select-layout below maps panes to layout
	// cells POSITIONALLY (by pane order), so geometry is restored, but a window
	// whose original panes were created in a different split order can see panes
	// occupy different cells than they originally did — each pane's cwd stays
	// with the pane, not the cell.
	//
	// newPaneIDs tracks the created pane id per stored-pane position for the
	// active-pane re-select: position 0 rides the window create (no id handle),
	// later positions are the split returns.
	panes := 1
	newPaneIDs := make([]string, len(rec.Window.Panes))
	for pi, pane := range rec.Window.Panes {
		if pi == 0 {
			continue // rides the window create
		}
		pcwd, pnote := restoreCwd(ops, pane.Cwd)
		if pnote != "" {
			slog.Debug("reopen: pane "+pnote, "server", server, "pane", pane.Index)
		}
		paneID, serr := ops.splitWindow(newID, false, pcwd, server)
		if serr != nil {
			slog.Debug("reopen: pane not recreated", "server", server, "pane", pane.Index, "err", serr)
			continue
		}
		newPaneIDs[pi] = paneID
		panes++
	}

	// Split geometry: best-effort replay of the stored layout string — valid
	// only when every pane came back.
	if panes > 1 && rec.Window.Layout != "" {
		if lerr := ops.selectLayout(newID, rec.Window.Layout, server); lerr != nil {
			slog.Debug("reopen: layout not reapplied", "server", server, "window", newID, "err", lerr)
		}
	}

	// Re-select the stored active pane. Splits are created detached (-d), so
	// the first pane is active by default — only a stored active pane beyond
	// position 0 needs an explicit select (and its id is in hand from the split;
	// a failed split's position has no id).
	for pi, pane := range rec.Window.Panes {
		if !pane.Active {
			continue
		}
		if pi > 0 && newPaneIDs[pi] != "" {
			if perr := ops.selectPane(newPaneIDs[pi], server); perr != nil {
				slog.Debug("reopen: active pane not re-selected", "server", server, "err", perr)
			}
		}
		break
	}

	// rk presentation options ride one chained set-option call. /present/
	// URLs are restored verbatim (snapshot parity — no @N remap).
	if wops := WindowOptionOps(rec.Window); len(wops) > 0 {
		if oerr := ops.setWindowOpts(ctx, newID, server, wops); oerr != nil {
			slog.Debug("reopen: window options not reapplied", "server", server, "window", newID, "err", oerr)
		}
	}

	// Focus the reopened window; the client also navigates to it, so a select
	// failure is cosmetic.
	if serr := ops.selectWindow(rec.Session, newID, server); serr != nil {
		slog.Debug("reopen: window not selected", "server", server, "window", newID, "err", serr)
	}

	return newID, nil
}
