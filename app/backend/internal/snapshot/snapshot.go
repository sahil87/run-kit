// Package snapshot persists per-tmux-server layout snapshots as
// disaster-recovery backups and restores them onto dead servers.
//
// Snapshots are WRITE-ONLY at runtime (Constitution II): nothing at request
// time reads a snapshot to answer API queries — live state stays derived from
// tmux and the filesystem. The only reader is the user-initiated `rk snapshot`
// CLI, and the daemon never restores automatically (Constitution VI). This is
// the same category as the daemon's log file: an artifact about the past, not
// a database about the present.
package snapshot

import (
	"context"
	"fmt"
	"log/slog"
	"sort"
	"time"

	"rk/internal/tmux"
)

// Snapshot is one server's persisted layout at a point in time. The capture
// set is derived entirely from tmux at snapshot time; scrollback contents,
// environment variables, and running processes are deliberately NOT captured.
type Snapshot struct {
	Server  string    `json:"server"`
	TakenAt time.Time `json:"takenAt"`
	// ServerRank mirrors the @rk_server_rank server option (nil when unset).
	ServerRank *int `json:"serverRank,omitempty"`
	// SessionOrder mirrors the @rk_session_order server option.
	SessionOrder []string  `json:"sessionOrder,omitempty"`
	Sessions     []Session `json:"sessions"`
	// DiedAt / AuditedKill are tombstone-only fields, stamped by
	// Store.Tombstone when the server's socket is removed. AuditedKill marks a
	// death preceded by a kill through run-kit's audited kill path
	// (POST /api/servers/kill).
	DiedAt      *time.Time `json:"diedAt,omitempty"`
	AuditedKill bool       `json:"auditedKill,omitempty"`
}

// Session is one user-facing tmux session in a snapshot.
type Session struct {
	Name string `json:"name"`
	// CreatedAt is the session's creation time in unix seconds.
	CreatedAt int64 `json:"createdAt"`
	// Color is the raw @session_color option value ("" when unset).
	Color   string   `json:"color,omitempty"`
	Windows []Window `json:"windows"`
}

// Window is one tmux window in a snapshot.
type Window struct {
	Index  int    `json:"index"`
	ID     string `json:"id"`
	Name   string `json:"name"`
	Active bool   `json:"active,omitempty"`
	// Layout is the tmux layout string, replayed best-effort on restore.
	Layout string `json:"layout,omitempty"`
	Color  string `json:"color,omitempty"`
	RkType string `json:"rkType,omitempty"`
	RkURL  string `json:"rkUrl,omitempty"`
	Marker string `json:"marker,omitempty"`
	Role   string `json:"role,omitempty"`
	Panes  []Pane `json:"panes"`
}

// Pane is one tmux pane in a snapshot. Command is informational only —
// restore recreates fresh shells at Cwd and reports the former command so the
// user can decide what to resume; it is never relaunched.
type Pane struct {
	ID      string `json:"id"`
	Index   int    `json:"index"`
	Cwd     string `json:"cwd,omitempty"`
	Command string `json:"command,omitempty"`
	Active  bool   `json:"active,omitempty"`
}

// SessionCount / WindowCount summarize a snapshot for list rendering.
func (s *Snapshot) SessionCount() int { return len(s.Sessions) }

// WindowCount returns the total number of windows across all sessions.
func (s *Snapshot) WindowCount() int {
	n := 0
	for _, sess := range s.Sessions {
		n += len(sess.Windows)
	}
	return n
}

// Injectable tmux read seams so CaptureServer is unit-testable without a live
// tmux server (mirrors the internal/tmux agentProcessAlive var-seam pattern).
var (
	listLayoutSessions = tmux.ListLayoutSessions
	listLayoutWindows  = tmux.ListLayoutWindows
	listLayoutPanes    = tmux.ListLayoutPanes
	getSessionOrder    = tmux.GetSessionOrder
	getServerRank      = tmux.GetServerRank
)

// CaptureServer derives a full layout snapshot of the named server from tmux.
// A dead/unreachable server returns an error (the layout reads never map
// dead-server to empty), so a capture racing server death can never overwrite
// a good snapshot with an empty one.
//
// The rk option reads (@rk_session_order / @rk_server_rank) are best-effort:
// a malformed stored value must not sink the layout capture, so their errors
// degrade to slog.Debug with the field left empty.
func CaptureServer(ctx context.Context, server string) (*Snapshot, error) {
	sessions, err := listLayoutSessions(ctx, server)
	if err != nil {
		return nil, fmt.Errorf("capture %s: %w", server, err)
	}
	windows, err := listLayoutWindows(ctx, server)
	if err != nil {
		return nil, fmt.Errorf("capture %s: %w", server, err)
	}
	panes, err := listLayoutPanes(ctx, server)
	if err != nil {
		return nil, fmt.Errorf("capture %s: %w", server, err)
	}

	snap := &Snapshot{
		Server:  server,
		TakenAt: time.Now().UTC(),
	}

	if order, err := getSessionOrder(ctx, server); err != nil {
		slog.Debug("snapshot: session order read failed", "server", server, "err", err)
	} else if len(order) > 0 {
		snap.SessionOrder = order
	}
	if rank, err := getServerRank(ctx, server); err != nil {
		slog.Debug("snapshot: server rank read failed", "server", server, "err", err)
	} else {
		snap.ServerRank = rank
	}

	// Group windows (and their panes) under their owning sessions,
	// deterministically ordered: sessions by creation time then name, windows
	// and panes by index. Determinism matters — the store's write dedup
	// compares serialized content, so equal layouts must serialize equally.
	bySession := map[string][]Window{}
	for _, w := range windows {
		win := Window{
			Index:  w.Index,
			ID:     w.WindowID,
			Name:   w.Name,
			Active: w.Active,
			Layout: w.Layout,
			Color:  w.Color,
			RkType: w.RkType,
			RkURL:  w.RkURL,
			Marker: w.Marker,
			Role:   w.Role,
		}
		for _, p := range panes[w.WindowID] {
			win.Panes = append(win.Panes, Pane{
				ID:      p.PaneID,
				Index:   p.Index,
				Cwd:     p.Cwd,
				Command: p.Command,
				Active:  p.Active,
			})
		}
		sort.Slice(win.Panes, func(i, j int) bool { return win.Panes[i].Index < win.Panes[j].Index })
		bySession[w.Session] = append(bySession[w.Session], win)
	}

	sort.Slice(sessions, func(i, j int) bool {
		if sessions[i].Created != sessions[j].Created {
			return sessions[i].Created < sessions[j].Created
		}
		return sessions[i].Name < sessions[j].Name
	})
	for _, ls := range sessions {
		sess := Session{
			Name:      ls.Name,
			CreatedAt: ls.Created,
			Color:     ls.Color,
			Windows:   bySession[ls.Name],
		}
		sort.Slice(sess.Windows, func(i, j int) bool { return sess.Windows[i].Index < sess.Windows[j].Index })
		snap.Sessions = append(snap.Sessions, sess)
	}

	return snap, nil
}
