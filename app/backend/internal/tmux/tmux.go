package tmux

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// configPath holds the tmux config file path read from RK_TMUX_CONF at init.
var configPath string

func init() {
	configPath = os.Getenv("RK_TMUX_CONF")
	if configPath != "" && !filepath.IsAbs(configPath) {
		if abs, err := filepath.Abs(configPath); err == nil {
			configPath = abs
		}
	}
}

// ConfigPath returns the resolved tmux config path (empty if RK_TMUX_CONF was not set).
func ConfigPath() string {
	return configPath
}

// ReloadConfig hot-reloads the tmux config via source-file on the specified server.
// Returns an error if no config path is set or the source-file command fails.
func ReloadConfig(server string) error {
	if configPath == "" {
		return fmt.Errorf("RK_TMUX_CONF not set")
	}
	ctx, cancel := withTimeout()
	defer cancel()
	if server == "default" {
		_, err := tmuxExecDefault(ctx, "source-file", configPath)
		return err
	}
	_, err := tmuxExec(ctx, "source-file", configPath)
	return err
}

// runkitPrefix returns the argument prefix for commands targeting the runkit server.
func runkitPrefix() []string {
	args := []string{"-L", "runkit"}
	if configPath != "" {
		args = append(args, "-f", configPath)
	}
	return args
}

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
	Index             int    `json:"index"`
	Name              string `json:"name"`
	WorktreePath      string `json:"worktreePath"`
	Activity          string `json:"activity"` // "active" or "idle"
	IsActiveWindow    bool   `json:"isActiveWindow"`
	PaneCommand       string `json:"paneCommand,omitempty"`
	ActivityTimestamp int64  `json:"activityTimestamp"`
	AgentState        string `json:"agentState,omitempty"`
	AgentIdleDuration string `json:"agentIdleDuration,omitempty"`
	FabChange         string `json:"fabChange,omitempty"`
	FabStage          string `json:"fabStage,omitempty"`
}

// tmuxExec runs a tmux command targeting the runkit server and returns stdout lines (empty lines filtered).
func tmuxExec(ctx context.Context, args ...string) ([]string, error) {
	full := append(runkitPrefix(), args...)
	cmd := exec.CommandContext(ctx, "tmux", full...)
	var stderr strings.Builder
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("%w: %s", err, strings.TrimSpace(stderr.String()))
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

// tmuxExecRaw runs a tmux command targeting the runkit server and returns raw stdout.
func tmuxExecRaw(ctx context.Context, args ...string) (string, error) {
	full := append(runkitPrefix(), args...)
	cmd := exec.CommandContext(ctx, "tmux", full...)
	out, err := cmd.Output()
	if err != nil {
		return "", err
	}
	return string(out), nil
}

// tmuxExecDefault runs a tmux command against the default server (no -L, no -f).
func tmuxExecDefault(ctx context.Context, args ...string) ([]string, error) {
	cmd := exec.CommandContext(ctx, "tmux", args...)
	var stderr strings.Builder
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("%w: %s", err, strings.TrimSpace(stderr.String()))
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

// withTimeout creates a context with the default tmux timeout.
func withTimeout() (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), TmuxTimeout)
}

// SessionInfo describes a tmux session with metadata about its origin server.
type SessionInfo struct {
	Name   string `json:"name"`
	Server string `json:"server"` // "runkit" or "default"
}

// parseSessions parses tmux list-sessions output lines into SessionInfo structs,
// filtering out session-group copies. The server parameter tags each result.
// Exported for testing.
func parseSessions(lines []string, server string) []SessionInfo {
	var sessions []SessionInfo
	for _, line := range lines {
		parts := strings.Split(line, listDelim)
		if len(parts) < 2 {
			continue
		}
		name, grouped := parts[0], parts[1]
		group := ""
		if len(parts) >= 3 {
			group = parts[2]
		}
		// Filter out session-group copies: keep if ungrouped or if name matches group
		if grouped == "0" || name == group {
			sessions = append(sessions, SessionInfo{
				Name:   name,
				Server: server,
			})
		}
	}
	return sessions
}

// ListSessions returns sessions from both the runkit and default tmux servers,
// filtering out session-group copies. Returns nil if no servers are running.
func ListSessions() ([]SessionInfo, error) {
	ctx, cancel := withTimeout()
	defer cancel()

	format := fmt.Sprintf("#{session_name}%s#{session_grouped}%s#{session_group}", listDelim, listDelim)

	// Query runkit server
	runkitLines, _ := tmuxExec(ctx, "list-sessions", "-F", format)
	runkitSessions := parseSessions(runkitLines, "runkit")

	// Query default server
	defaultLines, _ := tmuxExecDefault(ctx, "list-sessions", "-F", format)
	defaultSessions := parseSessions(defaultLines, "default")

	all := append(runkitSessions, defaultSessions...)
	if len(all) == 0 {
		return nil, nil
	}
	return all, nil
}

// parseWindows parses tmux list-windows output lines into WindowInfo structs.
// nowUnix is the current Unix timestamp for activity threshold computation.
// Exported for testing.
func parseWindows(lines []string, nowUnix int64) []WindowInfo {
	var windows []WindowInfo
	for _, line := range lines {
		parts := strings.Split(line, listDelim)
		if len(parts) < 6 {
			continue
		}

		index, _ := strconv.Atoi(parts[0])
		activityTs, _ := strconv.ParseInt(parts[3], 10, 64)

		activity := "idle"
		if nowUnix-activityTs <= ActivityThresholdSeconds {
			activity = "active"
		}
		isActive := strings.TrimSpace(parts[4]) == "1"
		paneCmd := strings.TrimSpace(parts[5])

		windows = append(windows, WindowInfo{
			Index:             index,
			Name:              parts[1],
			WorktreePath:      parts[2],
			Activity:          activity,
			IsActiveWindow:    isActive,
			PaneCommand:       paneCmd,
			ActivityTimestamp:  activityTs,
		})
	}
	return windows
}

// ListWindows returns windows for a given session. The server parameter selects
// which tmux server to query: "runkit" or "default". Returns nil if session does not exist.
func ListWindows(session string, server string) ([]WindowInfo, error) {
	ctx, cancel := withTimeout()
	defer cancel()

	format := strings.Join([]string{
		"#{window_index}",
		"#{window_name}",
		"#{pane_current_path}",
		"#{window_activity}",
		"#{window_active}",
		"#{pane_current_command}",
	}, listDelim)

	var lines []string
	var err error
	if server == "default" {
		lines, err = tmuxExecDefault(ctx, "list-windows", "-t", session, "-F", format)
	} else {
		lines, err = tmuxExec(ctx, "list-windows", "-t", session, "-F", format)
	}
	if err != nil {
		return nil, nil
	}

	return parseWindows(lines, time.Now().Unix()), nil
}

// CreateSession creates a new detached tmux session on the runkit server,
// optionally in a specific directory.
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

// RenameSession renames a tmux session.
func RenameSession(session, name string) error {
	ctx, cancel := withTimeout()
	defer cancel()

	_, err := tmuxExec(ctx, "rename-session", "-t", session, name)
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

// SelectWindow selects (focuses) a window by session and index.
func SelectWindow(session string, index int) error {
	return SelectWindowOnServer(session, index, "runkit")
}

// SelectWindowOnServer selects a window, targeting the specified server ("runkit" or "default").
func SelectWindowOnServer(session string, index int, server string) error {
	ctx, cancel := withTimeout()
	defer cancel()

	target := fmt.Sprintf("%s:%d", session, index)
	if server == "default" {
		_, err := tmuxExecDefault(ctx, "select-window", "-t", target)
		return err
	}
	_, err := tmuxExec(ctx, "select-window", "-t", target)
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
