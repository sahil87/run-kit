package tmux

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

// DefaultConfigPath is the default location for the tmux config file.
var DefaultConfigPath string

// configPath holds the resolved tmux config file path.
var configPath string

// CleanEnv returns the current environment with the TMUX variable removed.
// This prevents tmux commands from inheriting the parent server context
// when the daemon runs inside a tmux pane (e.g. rk-daemon).
func CleanEnv() []string {
	var env []string
	for _, e := range os.Environ() {
		if !strings.HasPrefix(e, "TMUX=") {
			env = append(env, e)
		}
	}
	return env
}

func init() {
	home, err := os.UserHomeDir()
	if err == nil {
		DefaultConfigPath = filepath.Join(home, ".run-kit", "tmux.conf")
	}

	configPath = os.Getenv("RK_TMUX_CONF")
	if configPath == "" {
		configPath = DefaultConfigPath
	}
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

// configArgs returns ["-f", configPath] if a config path is set, or nil.
// Used by commands that start the tmux server (CreateSession) or reload config.
func configArgs() []string {
	if configPath != "" {
		return []string{"-f", configPath}
	}
	return nil
}

// EnsureConfig writes the embedded default tmux.conf to DefaultConfigPath
// if the file does not already exist. No-op if the file exists or no home dir.
func EnsureConfig() error {
	if DefaultConfigPath == "" {
		return nil
	}
	if _, err := os.Stat(DefaultConfigPath); err == nil {
		return nil
	} else if !os.IsNotExist(err) {
		return fmt.Errorf("checking config file: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(DefaultConfigPath), 0o755); err != nil {
		return fmt.Errorf("creating config directory: %w", err)
	}
	return os.WriteFile(DefaultConfigPath, DefaultConfigBytes(), 0o644)
}

// ReloadConfig hot-reloads the tmux config via source-file on the specified server.
// Returns an error if no config path is set or the source-file command fails.
func ReloadConfig(server string) error {
	if configPath == "" {
		return fmt.Errorf("no tmux config path (run 'run-kit init-conf' or set RK_TMUX_CONF)")
	}
	ctx, cancel := withTimeout()
	defer cancel()
	args := append(configArgs(), "source-file", configPath)
	_, err := tmuxExecServer(ctx, server, args...)
	return err
}

// serverArgs returns the argument prefix for commands targeting a given server.
// For "default", returns an empty slice (no -L flag). For any other name, returns
// ["-L", name]. The -f config flag is only needed on server-creating commands
// (CreateSession) and ReloadConfig — not on every command.
func serverArgs(server string) []string {
	if server == "default" {
		return nil
	}
	return []string{"-L", server}
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

// tmuxExecServer runs a tmux command targeting the specified server and returns stdout lines (empty lines filtered).
func tmuxExecServer(ctx context.Context, server string, args ...string) ([]string, error) {
	full := append(serverArgs(server), args...)
	cmd := exec.CommandContext(ctx, "tmux", full...)
	cmd.Env = CleanEnv()
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

// tmuxExecRawServer runs a tmux command targeting the specified server and returns raw stdout.
func tmuxExecRawServer(ctx context.Context, server string, args ...string) (string, error) {
	full := append(serverArgs(server), args...)
	cmd := exec.CommandContext(ctx, "tmux", full...)
	cmd.Env = CleanEnv()
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

// SessionInfo describes a tmux session.
type SessionInfo struct {
	Name string `json:"name"`
}

// parseSessions parses tmux list-sessions output lines into SessionInfo structs,
// filtering out session-group copies.
// Exported for testing.
func parseSessions(lines []string) []SessionInfo {
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
				Name: name,
			})
		}
	}
	return sessions
}

// ListSessions returns sessions from the specified tmux server,
// filtering out session-group copies. Returns nil if no server is running.
func ListSessions(server string) ([]SessionInfo, error) {
	ctx, cancel := withTimeout()
	defer cancel()

	format := fmt.Sprintf("#{session_name}%s#{session_grouped}%s#{session_group}", listDelim, listDelim)

	lines, err := tmuxExecServer(ctx, server, "list-sessions", "-F", format)
	if err != nil {
		errMsg := err.Error()
		if strings.Contains(errMsg, "no server running") || strings.Contains(errMsg, "failed to connect") {
			return nil, nil
		}
		return nil, err
	}
	sessions := parseSessions(lines)

	if len(sessions) == 0 {
		return nil, nil
	}
	return sessions, nil
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

// ListWindows returns windows for a given session on the specified server.
// Returns nil if session does not exist.
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

	lines, err := tmuxExecServer(ctx, server, "list-windows", "-t", session, "-F", format)
	if err != nil {
		return nil, nil
	}

	return parseWindows(lines, time.Now().Unix()), nil
}

// CreateSession creates a new detached tmux session on the specified server,
// optionally in a specific directory.
func CreateSession(name string, cwd string, server string) error {
	ctx, cancel := withTimeout()
	defer cancel()

	// new-session may start the tmux server, so pass -f to load our config.
	args := configArgs()
	args = append(args, "new-session", "-d", "-s", name)
	if cwd != "" {
		args = append(args, "-c", cwd)
	}

	_, err := tmuxExecServer(ctx, server, args...)
	return err
}

// CreateWindow creates a new window in an existing session on the specified server.
func CreateWindow(session, name, cwd string, server string) error {
	ctx, cancel := withTimeout()
	defer cancel()

	_, err := tmuxExecServer(ctx, server, "new-window", "-t", session, "-n", name, "-c", cwd)
	return err
}

// KillSession kills an entire tmux session on the specified server.
func KillSession(session string, server string) error {
	ctx, cancel := withTimeout()
	defer cancel()

	_, err := tmuxExecServer(ctx, server, "kill-session", "-t", session)
	return err
}

// KillWindow kills a window by session and index on the specified server.
func KillWindow(session string, index int, server string) error {
	ctx, cancel := withTimeout()
	defer cancel()

	target := fmt.Sprintf("%s:%d", session, index)
	_, err := tmuxExecServer(ctx, server, "kill-window", "-t", target)
	return err
}

// RenameSession renames a tmux session on the specified server.
func RenameSession(session, name string, server string) error {
	ctx, cancel := withTimeout()
	defer cancel()

	_, err := tmuxExecServer(ctx, server, "rename-session", "-t", session, name)
	return err
}

// RenameWindow renames a window by session and index on the specified server.
func RenameWindow(session string, index int, name string, server string) error {
	ctx, cancel := withTimeout()
	defer cancel()

	target := fmt.Sprintf("%s:%d", session, index)
	_, err := tmuxExecServer(ctx, server, "rename-window", "-t", target, name)
	return err
}

// SendKeys sends keystrokes to a tmux window on the specified server.
func SendKeys(session string, window int, keys string, server string) error {
	ctx, cancel := withTimeout()
	defer cancel()

	target := fmt.Sprintf("%s:%d", session, window)
	_, err := tmuxExecServer(ctx, server, "send-keys", "-t", target, keys, "Enter")
	return err
}

// SelectWindow selects (focuses) a window by session and index on the specified server.
func SelectWindow(session string, index int, server string) error {
	ctx, cancel := withTimeout()
	defer cancel()

	target := fmt.Sprintf("%s:%d", session, index)
	_, err := tmuxExecServer(ctx, server, "select-window", "-t", target)
	return err
}

// SplitWindow splits a window to create an independent pane on the specified server. Returns the new pane ID.
func SplitWindow(session string, window int, server string) (string, error) {
	ctx, cancel := withTimeout()
	defer cancel()

	target := fmt.Sprintf("%s:%d", session, window)
	lines, err := tmuxExecServer(ctx, server, "split-window", "-t", target, "-d", "-P", "-F", "#{pane_id}")
	if err != nil {
		return "", err
	}
	if len(lines) == 0 {
		return "", fmt.Errorf("split-window returned no pane ID")
	}
	return lines[0], nil
}

// KillPane kills a specific pane by ID on the specified server.
func KillPane(paneID string, server string) error {
	ctx, cancel := withTimeout()
	defer cancel()

	_, err := tmuxExecServer(ctx, server, "kill-pane", "-t", paneID)
	// Pane may already be dead — ignore errors
	_ = err
	return nil
}

// CapturePane captures pane content (last N lines) on the specified server. Preserves blank lines.
func CapturePane(paneID string, lines int, server string) (string, error) {
	ctx, cancel := withTimeout()
	defer cancel()

	start := -lines
	return tmuxExecRawServer(ctx, server, "capture-pane", "-t", paneID, "-p", "-S", strconv.Itoa(start))
}

// ListServers discovers available tmux servers by scanning the tmux socket directory
// at /tmp/tmux-{uid}/. Probes each socket to confirm the server is alive.
// Returns sorted server names.
func ListServers() ([]string, error) {
	uid := os.Getuid()
	socketDir := fmt.Sprintf("/tmp/tmux-%d", uid)

	entries, err := os.ReadDir(socketDir)
	if err != nil {
		// Directory doesn't exist or can't be read — no servers running
		return nil, nil
	}

	var candidates []string
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		if info.Mode()&os.ModeSocket == 0 {
			continue
		}
		candidates = append(candidates, e.Name())
	}

	// Probe each socket — only include servers that are actually running.
	var servers []string
	for _, name := range candidates {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		cmd := exec.CommandContext(ctx, "tmux", "-L", name, "list-sessions")
		cmd.Env = CleanEnv()
		err := cmd.Run()
		cancel()
		if err == nil {
			servers = append(servers, name)
		}
	}
	sort.Strings(servers)
	return servers, nil
}

// ListKeys runs "tmux list-keys" on the given server and returns the raw output lines.
// Returns nil (no error) if the server is not running.
func ListKeys(server string) ([]string, error) {
	ctx, cancel := withTimeout()
	defer cancel()

	lines, err := tmuxExecServer(ctx, server, "list-keys")
	if err != nil {
		// Server not running — return empty, not error
		if strings.Contains(err.Error(), "No such file or directory") ||
			strings.Contains(err.Error(), "no server running") {
			return nil, nil
		}
		return nil, err
	}
	return lines, nil
}

// KillServer kills a tmux server by name.
// Returns nil if the server is already gone (no socket).
func KillServer(server string) error {
	ctx, cancel := withTimeout()
	defer cancel()

	_, err := tmuxExecServer(ctx, server, "kill-server")
	if err != nil && strings.Contains(err.Error(), "No such file or directory") {
		return nil
	}
	return err
}
