package tmux

import (
	"context"
	"fmt"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

const (
	// TmuxTimeout is the default timeout for tmux commands.
	TmuxTimeout = 10 * time.Second
	// ActivityThresholdSeconds is how recently a window must have had activity to be "active".
	ActivityThresholdSeconds = 10
	// listDelim is the tab delimiter used in tmux format strings.
	listDelim = "\t"
)

// WindowInfo describes a single tmux window within a session.
type WindowInfo struct {
	Index          int    `json:"index"`
	Name           string `json:"name"`
	WorktreePath   string `json:"worktreePath"`
	Activity       string `json:"activity"` // "active" or "idle"
	IsActiveWindow bool   `json:"isActiveWindow"`
	FabChange      string `json:"fabChange,omitempty"`
	FabStage       string `json:"fabStage,omitempty"`
}

// tmuxExec runs a tmux command with a timeout and returns stdout lines (empty lines filtered).
func tmuxExec(ctx context.Context, args ...string) ([]string, error) {
	cmd := exec.CommandContext(ctx, "tmux", args...)
	out, err := cmd.Output()
	if err != nil {
		return nil, err
	}
	raw := strings.TrimSpace(string(out))
	if raw == "" {
		return nil, nil
	}
	lines := strings.Split(raw, "\n")
	var result []string
	for _, l := range lines {
		if l != "" {
			result = append(result, l)
		}
	}
	return result, nil
}

// tmuxExecRaw runs a tmux command and returns raw stdout.
func tmuxExecRaw(ctx context.Context, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, "tmux", args...)
	out, err := cmd.Output()
	if err != nil {
		return "", err
	}
	return string(out), nil
}

// withTimeout creates a context with the default tmux timeout.
func withTimeout() (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), TmuxTimeout)
}

// parseSessions parses tmux list-sessions output lines into session names,
// filtering out byobu session-group copies. Exported for testing.
func parseSessions(lines []string) []string {
	var sessions []string
	for _, line := range lines {
		parts := strings.Split(line, listDelim)
		if len(parts) < 3 {
			continue
		}
		name, grouped, group := parts[0], parts[1], parts[2]
		// Filter out session-group copies: keep if ungrouped or if name matches group
		if grouped == "0" || name == group {
			sessions = append(sessions, name)
		}
	}
	return sessions
}

// ListSessions returns all tmux session names, filtering out byobu session-group copies.
// Returns nil if tmux server is not running.
func ListSessions() ([]string, error) {
	ctx, cancel := withTimeout()
	defer cancel()

	format := fmt.Sprintf("#{session_name}%s#{session_grouped}%s#{session_group}", listDelim, listDelim)
	lines, err := tmuxExec(ctx, "list-sessions", "-F", format)
	if err != nil {
		// tmux not running or no sessions
		return nil, nil
	}

	return parseSessions(lines), nil
}

// parseWindows parses tmux list-windows output lines into WindowInfo structs.
// nowUnix is the current Unix timestamp for activity threshold computation.
// Exported for testing.
func parseWindows(lines []string, nowUnix int64) []WindowInfo {
	var windows []WindowInfo
	for _, line := range lines {
		parts := strings.Split(line, listDelim)
		if len(parts) < 5 {
			continue
		}

		index, _ := strconv.Atoi(parts[0])
		activityTs, _ := strconv.ParseInt(parts[3], 10, 64)

		activity := "idle"
		if nowUnix-activityTs <= ActivityThresholdSeconds {
			activity = "active"
		}
		isActive := strings.TrimSpace(parts[4]) == "1"

		windows = append(windows, WindowInfo{
			Index:          index,
			Name:           parts[1],
			WorktreePath:   parts[2],
			Activity:       activity,
			IsActiveWindow: isActive,
		})
	}
	return windows
}

// ListWindows returns windows for a given session. Returns nil if session does not exist.
func ListWindows(session string) ([]WindowInfo, error) {
	ctx, cancel := withTimeout()
	defer cancel()

	format := strings.Join([]string{
		"#{window_index}",
		"#{window_name}",
		"#{pane_current_path}",
		"#{window_activity}",
		"#{window_active}",
	}, listDelim)

	lines, err := tmuxExec(ctx, "list-windows", "-t", session, "-F", format)
	if err != nil {
		return nil, nil
	}

	return parseWindows(lines, time.Now().Unix()), nil
}

// CreateSession creates a new detached tmux session, optionally in a specific directory.
func CreateSession(name string, cwd string) error {
	ctx, cancel := withTimeout()
	defer cancel()

	args := []string{"new-session", "-d", "-s", name}
	if cwd != "" {
		args = append(args, "-c", cwd)
	}
	_, err := tmuxExec(ctx, args...)
	return err
}

// CreateWindow creates a new window in an existing session.
func CreateWindow(session, name, cwd string) error {
	ctx, cancel := withTimeout()
	defer cancel()

	_, err := tmuxExec(ctx, "new-window", "-t", session, "-n", name, "-c", cwd)
	return err
}

// KillSession kills an entire tmux session.
func KillSession(session string) error {
	ctx, cancel := withTimeout()
	defer cancel()

	_, err := tmuxExec(ctx, "kill-session", "-t", session)
	return err
}

// KillWindow kills a window by session and index.
func KillWindow(session string, index int) error {
	ctx, cancel := withTimeout()
	defer cancel()

	target := fmt.Sprintf("%s:%d", session, index)
	_, err := tmuxExec(ctx, "kill-window", "-t", target)
	return err
}

// RenameWindow renames a window by session and index.
func RenameWindow(session string, index int, name string) error {
	ctx, cancel := withTimeout()
	defer cancel()

	target := fmt.Sprintf("%s:%d", session, index)
	_, err := tmuxExec(ctx, "rename-window", "-t", target, name)
	return err
}

// SendKeys sends keystrokes to a tmux window.
func SendKeys(session string, window int, keys string) error {
	ctx, cancel := withTimeout()
	defer cancel()

	target := fmt.Sprintf("%s:%d", session, window)
	_, err := tmuxExec(ctx, "send-keys", "-t", target, keys, "Enter")
	return err
}

// SplitWindow splits a window to create an independent pane. Returns the new pane ID.
func SplitWindow(session string, window int) (string, error) {
	ctx, cancel := withTimeout()
	defer cancel()

	target := fmt.Sprintf("%s:%d", session, window)
	lines, err := tmuxExec(ctx, "split-window", "-t", target, "-d", "-P", "-F", "#{pane_id}")
	if err != nil {
		return "", err
	}
	if len(lines) == 0 {
		return "", fmt.Errorf("split-window returned no pane ID")
	}
	return lines[0], nil
}

// KillPane kills a specific pane by ID.
func KillPane(paneID string) error {
	ctx, cancel := withTimeout()
	defer cancel()

	_, err := tmuxExec(ctx, "kill-pane", "-t", paneID)
	// Pane may already be dead — ignore errors
	_ = err
	return nil
}

// CapturePane captures pane content (last N lines). Preserves blank lines.
func CapturePane(paneID string, lines int) (string, error) {
	ctx, cancel := withTimeout()
	defer cancel()

	start := -lines
	return tmuxExecRaw(ctx, "capture-pane", "-t", paneID, "-p", "-S", strconv.Itoa(start))
}
