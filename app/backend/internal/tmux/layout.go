package tmux

// Layout snapshot primitives: read-only queries that derive a server's full
// recreate-able layout (sessions → windows → panes, plus the rk-owned user
// options that shape the UI), and the restore-side mutators that recreate a
// layout on a fresh server. Consumed by internal/snapshot (the daemon's
// periodic layout snapshotter and the `rk mux snapshot restore` engine).
//
// Read helpers deliberately do NOT map dead-server errors to empty results
// (unlike ListSessions): a capture racing server death must surface as an
// error, never as "server is empty" — an empty snapshot overwriting a good
// one is exactly the data loss snapshots exist to prevent.

import (
	"context"
	"fmt"
	"strconv"
	"strings"
)

// LayoutSession is one user-facing session in a layout snapshot read.
type LayoutSession struct {
	Name string
	// Created is the session's creation time in unix seconds
	// (#{session_created}).
	Created int64
	// Color is the raw @session_color option value ("" when unset).
	Color string
}

// LayoutWindow is one window in a layout snapshot read, keyed to its non-pin
// owning session.
type LayoutWindow struct {
	Session  string
	WindowID string
	Index    int
	Name     string
	Active   bool
	// Layout is the tmux layout string (#{window_layout}, checksum-prefixed),
	// replayable via select-layout when the pane count matches.
	Layout string
	// Raw rk-owned window option values ("" when unset).
	Color  string
	RkType string
	RkURL  string
	Marker string
	Role   string
	Flair  string
}

// LayoutPane is one pane in a layout snapshot read.
type LayoutPane struct {
	WindowID string
	PaneID   string
	Index    int
	Cwd      string
	// Command is the pane's current command at snapshot time. Informational
	// only — restore never relaunches it.
	Command string
	Active  bool
}

// layoutSessionFormat lists name, creation time, and the raw session color.
var layoutSessionFormat = strings.Join([]string{
	"#{session_name}",
	"#{session_created}",
	"#{@session_color}",
}, listDelim)

// layoutWindowFormat lists the owning session plus everything needed to
// recreate the window (id, index, name, active flag, layout string) and the
// rk-owned presentation options.
var layoutWindowFormat = strings.Join([]string{
	"#{session_name}",
	"#{window_id}",
	"#{window_index}",
	"#{window_name}",
	"#{window_active}",
	"#{window_layout}",
	"#{@color}",
	"#{@rk_type}",
	"#{@rk_url}",
	"#{@rk_marker}",
	"#{@rk_role}",
	"#{@rk_flair}",
}, listDelim)

// layoutPaneFormat lists the owning window id plus everything needed to
// recreate the pane (index, cwd) and report it (command).
var layoutPaneFormat = strings.Join([]string{
	"#{window_id}",
	"#{pane_id}",
	"#{pane_index}",
	"#{pane_current_path}",
	"#{pane_current_command}",
	"#{pane_active}",
}, listDelim)

// isLayoutHiddenSession reports whether a session name is one of run-kit's
// non-user-facing sessions excluded from layout snapshots: board pin-sessions
// (their windows persist via home-session membership) and the tmuxctl control
// anchor (recreated automatically by the daemon).
func isLayoutHiddenSession(name string) bool {
	return strings.HasPrefix(name, PinSessionPrefix) || name == ControlAnchorSessionName
}

// ListLayoutSessions returns every user-facing session on the server with its
// creation time and raw color option. Pin-sessions and the control anchor are
// excluded. A dead/unreachable server returns an error (never an empty list).
func ListLayoutSessions(ctx context.Context, server string) ([]LayoutSession, error) {
	ctx, cancel := context.WithTimeout(ctx, TmuxTimeout)
	defer cancel()

	lines, err := tmuxExecServer(ctx, server, "list-sessions", "-F", layoutSessionFormat)
	if err != nil {
		return nil, fmt.Errorf("layout list-sessions: %w", err)
	}
	return parseLayoutSessions(lines), nil
}

// parseLayoutSessions parses layoutSessionFormat lines, skipping hidden
// sessions and malformed lines. Accessible to same-package tests.
func parseLayoutSessions(lines []string) []LayoutSession {
	var out []LayoutSession
	for _, line := range lines {
		parts := strings.Split(line, listDelim)
		if len(parts) < 3 {
			continue
		}
		name := parts[0]
		if name == "" || isLayoutHiddenSession(name) {
			continue
		}
		created, err := strconv.ParseInt(strings.TrimSpace(parts[1]), 10, 64)
		if err != nil {
			continue
		}
		out = append(out, LayoutSession{
			Name:    name,
			Created: created,
			Color:   strings.TrimSpace(parts[2]),
		})
	}
	return out
}

// ListLayoutWindows returns every window on the server keyed to its non-pin
// owning session, deduplicated by window id. A board-pinned window is linked
// into both its home session and its `_rk-pin-*` pin-session, so `list-windows
// -a` surfaces it once per link; pin/anchor rows are skipped and the first
// remaining occurrence wins. A dead/unreachable server returns an error.
func ListLayoutWindows(ctx context.Context, server string) ([]LayoutWindow, error) {
	ctx, cancel := context.WithTimeout(ctx, TmuxTimeout)
	defer cancel()

	lines, err := tmuxExecServer(ctx, server, "list-windows", "-a", "-F", layoutWindowFormat)
	if err != nil {
		return nil, fmt.Errorf("layout list-windows: %w", err)
	}
	return parseLayoutWindows(lines), nil
}

// parseLayoutWindows parses layoutWindowFormat lines, skipping hidden-session
// rows and malformed lines, deduplicating by window id (first non-hidden
// occurrence wins). Accessible to same-package tests.
func parseLayoutWindows(lines []string) []LayoutWindow {
	seen := map[string]bool{}
	var out []LayoutWindow
	for _, line := range lines {
		parts := strings.Split(line, listDelim)
		if len(parts) < 10 {
			continue
		}
		session := parts[0]
		if session == "" || isLayoutHiddenSession(session) {
			continue
		}
		windowID := strings.TrimSpace(parts[1])
		if !ValidWindowID(windowID) || seen[windowID] {
			continue
		}
		index, err := strconv.Atoi(strings.TrimSpace(parts[2]))
		if err != nil {
			continue
		}
		seen[windowID] = true
		win := LayoutWindow{
			Session:  session,
			WindowID: windowID,
			Index:    index,
			Name:     parts[3],
			Active:   strings.TrimSpace(parts[4]) == "1",
			Layout:   strings.TrimSpace(parts[5]),
			Color:    strings.TrimSpace(parts[6]),
			RkType:   strings.TrimSpace(parts[7]),
			RkURL:    strings.TrimSpace(parts[8]),
			Marker:   strings.TrimSpace(parts[9]),
		}
		// Field 11 (@rk_role) is optional — absent on older captures.
		if len(parts) >= 11 {
			win.Role = strings.TrimSpace(parts[10])
		}
		// Field 12 (@rk_flair) is optional — absent on older captures.
		if len(parts) >= 12 {
			win.Flair = strings.TrimSpace(parts[11])
		}
		out = append(out, win)
	}
	return out
}

// ListLayoutPanes returns every pane on the server grouped by owning window
// id, deduplicated by pane id (a window linked into multiple sessions is one
// window object, but dedup guards against any duplicate listing). A
// dead/unreachable server returns an error.
func ListLayoutPanes(ctx context.Context, server string) (map[string][]LayoutPane, error) {
	ctx, cancel := context.WithTimeout(ctx, TmuxTimeout)
	defer cancel()

	lines, err := tmuxExecServer(ctx, server, "list-panes", "-a", "-F", layoutPaneFormat)
	if err != nil {
		return nil, fmt.Errorf("layout list-panes: %w", err)
	}
	return parseLayoutPanes(lines), nil
}

// parseLayoutPanes parses layoutPaneFormat lines into a windowID→panes map,
// skipping malformed lines and deduplicating by pane id. Accessible to
// same-package tests.
func parseLayoutPanes(lines []string) map[string][]LayoutPane {
	byWindow := map[string][]LayoutPane{}
	seen := map[string]bool{}
	for _, line := range lines {
		parts := strings.Split(line, listDelim)
		if len(parts) < 6 {
			continue
		}
		windowID := strings.TrimSpace(parts[0])
		paneID := strings.TrimSpace(parts[1])
		if !ValidWindowID(windowID) || paneID == "" || seen[paneID] {
			continue
		}
		index, err := strconv.Atoi(strings.TrimSpace(parts[2]))
		if err != nil {
			continue
		}
		seen[paneID] = true
		byWindow[windowID] = append(byWindow[windowID], LayoutPane{
			WindowID: windowID,
			PaneID:   paneID,
			Index:    index,
			Cwd:      parts[3],
			Command:  strings.TrimSpace(parts[4]),
			Active:   strings.TrimSpace(parts[5]) == "1",
		})
	}
	if len(byWindow) == 0 {
		return nil
	}
	return byWindow
}

// buildRestoreSessionArgs builds the argv slice (after the "tmux" binary and
// any -L server prefix) for CreateSessionForRestore. Pure so the -n/-c
// conditional branches are unit-testable without a live tmux server (mirrors
// buildCreateWindowArgs).
func buildRestoreSessionArgs(name, windowName, cwd string) []string {
	// new-session may start the tmux server, so pass -f to load our config
	// (same as CreateSession).
	args := configArgs()
	args = append(args, "new-session", "-d", "-P", "-F", "#{window_id}\t#{window_index}", "-s", name)
	if windowName != "" {
		args = append(args, "-n", windowName)
	}
	if cwd != "" {
		args = append(args, "-c", cwd)
	}
	return args
}

// CreateSessionForRestore creates a detached session carrying its first
// restored window (named windowName at cwd) and returns the created window's
// id plus its born index (the server's base-index, which the restore engine
// compares against the stored index for a RenumberWindow fixup).
// Server-birth-capable: the first restore invocation births the target
// server, so it carries the same pins as CreateSession — config via -f,
// sanitized environment (CleanEnvForServer), and CWD anchored to
// ServerBirthDir so the born server never sits on rk's own (possibly
// later-deleted) working directory.
func CreateSessionForRestore(name, windowName, cwd, server string) (string, int, error) {
	ctx, cancel := withTimeout()
	defer cancel()

	full := append(serverArgs(server), buildRestoreSessionArgs(name, windowName, cwd)...)
	out, err := RunOutput(ctx, full, RunOpts{Env: CleanEnvForServer(), Dir: ServerBirthDir()})
	if err != nil {
		return "", 0, err
	}
	parts := strings.Split(strings.TrimSpace(string(out)), listDelim)
	if len(parts) < 2 || parts[0] == "" {
		return "", 0, fmt.Errorf("new-session returned no window ID")
	}
	index, err := strconv.Atoi(strings.TrimSpace(parts[1]))
	if err != nil {
		return "", 0, fmt.Errorf("new-session returned bad window index: %w", err)
	}
	return strings.TrimSpace(parts[0]), index, nil
}

// buildRestoreWindowArgs builds the argv slice for CreateWindowAtIndex. Pure
// for unit testing (mirrors buildCreateWindowArgs).
func buildRestoreWindowArgs(session string, index int, name, cwd string) []string {
	args := []string{"new-window", "-d", "-P", "-F", "#{window_id}",
		"-t", exactWindowInSession(session, strconv.Itoa(index))}
	if name != "" {
		args = append(args, "-n", name)
	}
	if cwd != "" {
		args = append(args, "-c", cwd)
	}
	return args
}

// CreateWindowAtIndex creates a detached window at an explicit index in an
// existing session and returns the created window's id. The target index must
// be free — restore creates windows in ascending stored-index order on a
// fresh server, so a conflict is unexpected and surfaces as a tmux error the
// caller degrades on (append + MoveWindow fallback in the restore engine).
func CreateWindowAtIndex(session string, index int, name, cwd, server string) (string, error) {
	ctx, cancel := withTimeout()
	defer cancel()

	lines, err := tmuxExecServer(ctx, server, buildRestoreWindowArgs(session, index, name, cwd)...)
	if err != nil {
		return "", err
	}
	if len(lines) == 0 {
		return "", fmt.Errorf("new-window returned no window ID")
	}
	return strings.TrimSpace(lines[0]), nil
}

// RenumberWindow moves a window to an explicit (free) index within its
// session: `move-window -s <windowID> -t =session:<index>`. Unlike MoveWindow
// (a reorder-among-existing-windows primitive built on adjacent swaps, which
// no-ops when the target index is unoccupied), this RENUMBERS the window —
// the restore engine uses it to fix a session's first window up from the born
// base-index to its stored index. An occupied target index errors.
func RenumberWindow(session, windowID string, index int, server string) error {
	ctx, cancel := withTimeout()
	defer cancel()

	_, err := tmuxExecServer(ctx, server, "move-window", "-s", windowID,
		"-t", exactWindowInSession(session, strconv.Itoa(index)))
	return err
}

// SelectLayout applies a stored tmux layout string to a window. tmux accepts
// checksum-prefixed layout strings (#{window_layout}) only when the window's
// pane count matches the layout; the restore engine treats a failure here as
// best-effort (panes keep their default split geometry). The `--` pins the
// layout string as a positional argument, never parsed as flags (mirrors
// set-buffer in SetChatSendBuffer) — stored layout strings are
// checksum-prefixed and cannot start with '-', so this is belt-and-braces.
func SelectLayout(windowID, layout, server string) error {
	ctx, cancel := withTimeout()
	defer cancel()

	_, err := tmuxExecServer(ctx, server, "select-layout", "-t", windowID, "--", layout)
	return err
}

// SelectPane makes the given pane its window's active pane
// (`select-pane -t %N`). The restore engine uses it to re-select a window's
// stored active pane after splits and layout apply: restore's splits are
// created detached (-d), so the first pane stays active by default and only a
// stored active pane beyond the first needs an explicit re-select.
func SelectPane(paneID, server string) error {
	ctx, cancel := withTimeout()
	defer cancel()

	_, err := tmuxExecServer(ctx, server, "select-pane", "-t", paneID)
	return err
}
