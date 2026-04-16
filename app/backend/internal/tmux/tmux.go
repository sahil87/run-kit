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
	"sync"
	"time"
)

// DefaultConfigPath is the default location for the tmux config file.
var DefaultConfigPath string

// configPath holds the resolved tmux config file path.
var configPath string

func init() {
	// Strip TMUX so subprocess calls target the correct tmux server.
	// The daemon runs inside the rk-daemon tmux pane and inherits TMUX
	// pointing to that server; bare tmux commands would target rk-daemon
	// instead of the default socket without this.
	os.Unsetenv("TMUX")


	home, err := os.UserHomeDir()
	if err == nil {
		DefaultConfigPath = filepath.Join(home, ".rk", "tmux.conf")
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
// if the file does not already exist. Always creates the tmux.d/ drop-in
// directory alongside the config (even if the config already exists).
// No-op if no home dir.
func EnsureConfig() error {
	if DefaultConfigPath == "" {
		return nil
	}
	// Always ensure tmux.d/ exists for drop-in configs.
	if err := ensureDropInDir(); err != nil {
		return err
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

// ForceWriteConfig writes the embedded default tmux.conf to DefaultConfigPath,
// overwriting any existing file. Also creates the tmux.d/ drop-in directory.
// Equivalent to `rk init-conf --force`.
func ForceWriteConfig() error {
	if DefaultConfigPath == "" {
		return fmt.Errorf("could not determine home directory")
	}
	if err := os.MkdirAll(filepath.Dir(DefaultConfigPath), 0o755); err != nil {
		return fmt.Errorf("creating config directory: %w", err)
	}
	if err := ensureDropInDir(); err != nil {
		return err
	}
	return os.WriteFile(DefaultConfigPath, DefaultConfigBytes(), 0o644)
}

// ensureDropInDir creates a tmux.d/ drop-in directory alongside DefaultConfigPath
// for user drop-in configs.
func ensureDropInDir() error {
	if DefaultConfigPath == "" {
		return nil
	}
	dropInDir := filepath.Join(filepath.Dir(DefaultConfigPath), "tmux.d")
	if err := os.MkdirAll(dropInDir, 0o755); err != nil {
		return fmt.Errorf("creating tmux drop-in directory: %w", err)
	}
	return nil
}

// ReloadConfig hot-reloads the tmux config via source-file on the specified server.
// Returns an error if no config path is set or the source-file command fails.
func ReloadConfig(server string) error {
	if configPath == "" {
		return fmt.Errorf("no tmux config path (run 'rk init-conf' or set RK_TMUX_CONF)")
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

// PaneInfo describes a single tmux pane within a window.
type PaneInfo struct {
	PaneID    string `json:"paneId"`
	PaneIndex int    `json:"paneIndex"`
	Cwd       string `json:"cwd"`
	Command   string `json:"command"`
	IsActive  bool   `json:"isActive"`
	GitBranch string `json:"gitBranch,omitempty"`
}

// WindowInfo describes a single tmux window within a session.
type WindowInfo struct {
	Index             int        `json:"index"`
	WindowID          string     `json:"windowId"`
	Name              string     `json:"name"`
	WorktreePath      string     `json:"worktreePath"`
	Activity          string     `json:"activity"` // "active" or "idle"
	IsActiveWindow    bool       `json:"isActiveWindow"`
	PaneCommand       string     `json:"paneCommand,omitempty"`
	ActivityTimestamp int64      `json:"activityTimestamp"`
	Color             *int       `json:"color,omitempty"`
	AgentState        string     `json:"agentState,omitempty"`
	AgentIdleDuration string     `json:"agentIdleDuration,omitempty"`
	FabChange         string     `json:"fabChange,omitempty"`
	FabStage          string     `json:"fabStage,omitempty"`
	Panes             []PaneInfo `json:"panes,omitempty"`
}

// tmuxExecServer runs a tmux command targeting the specified server and returns stdout lines (empty lines filtered).
func tmuxExecServer(ctx context.Context, server string, args ...string) ([]string, error) {
	full := append(serverArgs(server), args...)
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

// tmuxExecRawServer runs a tmux command targeting the specified server and returns raw stdout.
func tmuxExecRawServer(ctx context.Context, server string, args ...string) (string, error) {
	full := append(serverArgs(server), args...)
	cmd := exec.CommandContext(ctx, "tmux", full...)
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
func ListSessions(ctx context.Context, server string) ([]SessionInfo, error) {
	ctx, cancel := context.WithTimeout(ctx, TmuxTimeout)
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

// parsePanes parses tmux list-panes output lines into a window-index→[]PaneInfo map.
// Lines are 6-field tab-delimited: window_index, pane_id, pane_index, cwd, command, is_active.
// Field 0 (window_index) is consumed for grouping and not stored in PaneInfo.
// Lines with fewer than 6 fields are silently skipped. Empty input returns nil.
// Accessible to same-package tests.
func parsePanes(lines []string) map[int][]PaneInfo {
	if len(lines) == 0 {
		return nil
	}
	byWindow := make(map[int][]PaneInfo)
	for _, line := range lines {
		parts := strings.Split(line, listDelim)
		if len(parts) < 6 {
			continue
		}
		windowIndex, err := strconv.Atoi(strings.TrimSpace(parts[0]))
		if err != nil {
			continue
		}

		paneIndex, err := strconv.Atoi(strings.TrimSpace(parts[2]))
		if err != nil {
			continue
		}
		isActive := strings.TrimSpace(parts[5]) == "1"
		p := PaneInfo{
			PaneID:    strings.TrimSpace(parts[1]),
			PaneIndex: paneIndex,
			Cwd:       parts[3],
			Command:   strings.TrimSpace(parts[4]),
			IsActive:  isActive,
		}
		byWindow[windowIndex] = append(byWindow[windowIndex], p)
	}
	if len(byWindow) == 0 {
		return nil
	}
	return byWindow
}

// parseWindows parses tmux list-windows output lines into WindowInfo structs.
// nowUnix is the current Unix timestamp for activity threshold computation.
// Exported for testing.
func parseWindows(lines []string, nowUnix int64) []WindowInfo {
	var windows []WindowInfo
	for _, line := range lines {
		parts := strings.Split(line, listDelim)
		if len(parts) < 8 {
			continue
		}

		windowID := strings.TrimSpace(parts[0])
		index, _ := strconv.Atoi(parts[1])
		activityTs, _ := strconv.ParseInt(parts[4], 10, 64)

		activity := "idle"
		if nowUnix-activityTs <= ActivityThresholdSeconds {
			activity = "active"
		}
		isActive := strings.TrimSpace(parts[5]) == "1"
		paneCmd := strings.TrimSpace(parts[6])

		var color *int
		if colorStr := strings.TrimSpace(parts[7]); colorStr != "" {
			if c, err := strconv.Atoi(colorStr); err == nil {
				color = &c
			}
		}

		windows = append(windows, WindowInfo{
			Index:             index,
			WindowID:          windowID,
			Name:              parts[2],
			WorktreePath:      parts[3],
			Activity:          activity,
			IsActiveWindow:    isActive,
			PaneCommand:       paneCmd,
			ActivityTimestamp: activityTs,
			Color:             color,
		})
	}
	return windows
}

// paneFormat is the list-panes format string: window_index, pane_id, pane_index,
// pane_current_path, pane_current_command, pane_active (6 fields).
var paneFormat = strings.Join([]string{
	"#{window_index}",
	"#{pane_id}",
	"#{pane_index}",
	"#{pane_current_path}",
	"#{pane_current_command}",
	"#{pane_active}",
}, listDelim)

// ListWindows returns windows for a given session on the specified server.
// Returns nil if session does not exist.
// Pane data is populated from a separate list-panes call; failure of that call
// is non-fatal — windows are returned with empty Panes fields.
func ListWindows(ctx context.Context, session string, server string) ([]WindowInfo, error) {
	ctx, cancel := context.WithTimeout(ctx, TmuxTimeout)
	defer cancel()

	format := strings.Join([]string{
		"#{window_id}",
		"#{window_index}",
		"#{window_name}",
		"#{pane_current_path}",
		"#{window_activity}",
		"#{window_active}",
		"#{pane_current_command}",
		"#{@color}",
	}, listDelim)

	lines, err := tmuxExecServer(ctx, server, "list-windows", "-t", session, "-F", format)
	if err != nil {
		return nil, nil
	}

	windows := parseWindows(lines, time.Now().Unix())

	// Fetch pane data — non-fatal if list-panes fails (e.g., session disappears mid-tick).
	paneLines, paneErr := tmuxExecServer(ctx, server, "list-panes", "-s", "-t", session, "-F", paneFormat)
	if paneErr == nil {
		byWindow := parsePanes(paneLines)
		if byWindow != nil {
			for i := range windows {
				windows[i].Panes = byWindow[windows[i].Index]
			}
		}
	}

	return windows, nil
}

// CreateSession creates a new detached tmux session on the specified server,
// optionally in a specific directory.
//
// Because new-session may start the tmux server process, the command runs with
// a sanitized environment: PATH is reset to a POSIX default and all DIRENV_*
// vars are removed. Without this, the server inherits direnv-modified PATH from
// the shell that launched rk, and every new pane gets stale/duplicated
// PATH entries that corrupt direnv's diff computation.
func CreateSession(name string, cwd string, server string) error {
	ctx, cancel := withTimeout()
	defer cancel()

	// new-session may start the tmux server, so pass -f to load our config.
	args := configArgs()
	args = append(args, "new-session", "-d", "-s", name)
	if cwd != "" {
		args = append(args, "-c", cwd)
	}

	full := append(serverArgs(server), args...)
	return runTmuxWithEnv(ctx, full, cleanEnvForServer())
}

// runTmuxWithEnv executes a tmux command with an optional environment override,
// capturing stderr for diagnostics.
func runTmuxWithEnv(ctx context.Context, args []string, env []string) error {
	cmd := exec.CommandContext(ctx, "tmux", args...)
	if env != nil {
		cmd.Env = env
	}
	var stderr strings.Builder
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		if msg := strings.TrimSpace(stderr.String()); msg != "" {
			return fmt.Errorf("%w: %s", err, msg)
		}
		return err
	}
	return nil
}

// cleanPATH is the POSIX default PATH used to sanitize the tmux server environment.
const cleanPATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

// cleanEnvForServer returns a copy of the current environment with PATH reset
// to a clean POSIX default and all DIRENV_* variables removed. This prevents
// the tmux server process from inheriting direnv state.
func cleanEnvForServer() []string {
	return sanitizeEnv(os.Environ())
}

// sanitizeEnv filters an environment slice: replaces PATH with a clean POSIX
// default (deduplicating if present multiple times), strips DIRENV_* vars,
// and ensures PATH is always present.
func sanitizeEnv(environ []string) []string {
	env := make([]string, 0, len(environ)+1)
	pathSeen := false
	for _, e := range environ {
		if strings.HasPrefix(e, "DIRENV_") {
			continue
		}
		if strings.HasPrefix(e, "PATH=") {
			if !pathSeen {
				env = append(env, "PATH="+cleanPATH)
				pathSeen = true
			}
			continue
		}
		env = append(env, e)
	}
	if !pathSeen {
		env = append(env, "PATH="+cleanPATH)
	}
	return env
}

// CreateWindow creates a new window in an existing session on the specified server.
func CreateWindow(session, name, cwd string, server string) error {
	ctx, cancel := withTimeout()
	defer cancel()

	_, err := tmuxExecServer(ctx, server, "new-window", "-a", "-t", session, "-n", name, "-c", cwd)
	return err
}

// KillSession kills an entire tmux session on the specified server.
func KillSession(session string, server string) error {
	ctx, cancel := withTimeout()
	defer cancel()

	_, err := tmuxExecServer(ctx, server, "kill-session", "-t", session)
	return err
}

// MoveWindow moves a window from srcIndex to before dstIndex within the same session,
// shifting intermediate windows via adjacent swaps. This gives "insert before" semantics
// (e.g., moving index 0 to index 2 in [a b c d] produces [b a c d]).
func MoveWindow(session string, srcIndex int, dstIndex int, server string) error {
	if srcIndex == dstIndex {
		return nil
	}

	// Get sorted window indices so we can bubble via adjacent swaps
	ctx, cancel := withTimeout()
	defer cancel()
	out, err := tmuxExecServer(ctx, server, "list-windows", "-t", session, "-F", "#{window_index}")
	if err != nil {
		return fmt.Errorf("list windows: %w", err)
	}

	var indices []int
	for _, line := range out {
		if idx, err := strconv.Atoi(strings.TrimSpace(line)); err == nil {
			indices = append(indices, idx)
		}
	}
	sort.Ints(indices)

	srcPos, dstPos := -1, -1
	for i, idx := range indices {
		if idx == srcIndex {
			srcPos = i
		}
		if idx == dstIndex {
			dstPos = i
		}
	}
	if srcPos < 0 {
		return fmt.Errorf("source window index %d not found", srcIndex)
	}
	// Sentinel index (past the last window) → move source to end.
	// In this case, use "move to position" (full swaps), not "insert before."
	sentinel := dstPos < 0
	if sentinel {
		dstPos = len(indices) - 1
	}

	// "Insert before" semantics: source lands just before the target item.
	// When moving forward, stop one short (source ends up before dst).
	// When moving backward, go all the way (source takes dst's slot, dst shifts right).
	// Sentinel overrides: full swaps so source lands AT the end, not before it.
	endPos := dstPos
	if srcPos < dstPos && !sentinel {
		endPos = dstPos - 1
	}
	if srcPos == endPos {
		return nil
	}
	step := 1
	if srcPos > endPos {
		step = -1
	}
	for pos := srcPos; pos != endPos; pos += step {
		src := fmt.Sprintf("%s:%d", session, indices[pos])
		dst := fmt.Sprintf("%s:%d", session, indices[pos+step])
		ctx2, cancel2 := withTimeout()
		_, err := tmuxExecServer(ctx2, server, "swap-window", "-s", src, "-t", dst)
		cancel2()
		if err != nil {
			return fmt.Errorf("swap %d↔%d: %w", indices[pos], indices[pos+step], err)
		}
	}
	return nil
}

// MoveWindowToSession moves a window from one session to another on the specified server.
func MoveWindowToSession(srcSession string, srcIndex int, dstSession string, server string) error {
	ctx, cancel := withTimeout()
	defer cancel()

	src := fmt.Sprintf("%s:%d", srcSession, srcIndex)
	dst := fmt.Sprintf("%s:", dstSession)
	_, err := tmuxExecServer(ctx, server, "move-window", "-s", src, "-t", dst)
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

// SetWindowColor sets the @color user option on a window.
func SetWindowColor(session string, index int, color int, server string) error {
	ctx, cancel := withTimeout()
	defer cancel()

	target := fmt.Sprintf("%s:%d", session, index)
	_, err := tmuxExecServer(ctx, server, "set-option", "-w", "-t", target, "@color", strconv.Itoa(color))
	return err
}

// UnsetWindowColor removes the @color user option from a window.
func UnsetWindowColor(session string, index int, server string) error {
	ctx, cancel := withTimeout()
	defer cancel()

	target := fmt.Sprintf("%s:%d", session, index)
	_, err := tmuxExecServer(ctx, server, "set-option", "-wu", "-t", target, "@color")
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
// If horizontal is true, the pane is split left/right (-h flag); otherwise top/bottom.
// If cwd is non-empty, the new pane starts in that directory (-c flag).
func SplitWindow(session string, window int, horizontal bool, cwd string, server string) (string, error) {
	ctx, cancel := withTimeout()
	defer cancel()

	target := fmt.Sprintf("%s:%d", session, window)
	args := []string{"split-window"}
	if horizontal {
		args = append(args, "-h")
	}
	if cwd != "" {
		args = append(args, "-c", cwd)
	}
	args = append(args, "-t", target, "-d", "-P", "-F", "#{pane_id}")
	lines, err := tmuxExecServer(ctx, server, args...)
	if err != nil {
		return "", err
	}
	if len(lines) == 0 {
		return "", fmt.Errorf("split-window returned no pane ID")
	}
	return lines[0], nil
}

// KillActivePane kills the active pane of the specified window on the given server.
// Errors are silently ignored (pane may already be dead), matching KillPane pattern.
func KillActivePane(session string, window int, server string) error {
	ctx, cancel := withTimeout()
	defer cancel()

	target := fmt.Sprintf("%s:%d", session, window)
	_, err := tmuxExecServer(ctx, server, "kill-pane", "-t", target)
	// Pane may already be dead — ignore errors
	_ = err
	return nil
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
func ListServers(ctx context.Context) ([]string, error) {
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

	// Probe each socket concurrently — bounded goroutine pool.
	sem := make(chan struct{}, 10)
	var mu sync.Mutex
	var wg sync.WaitGroup
	var servers []string

	for _, name := range candidates {
		wg.Add(1)
		sem <- struct{}{} // acquire semaphore slot
		go func(name string) {
			defer wg.Done()
			defer func() { <-sem }() // release
			probeCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
			defer cancel()
			cmd := exec.CommandContext(probeCtx, "tmux", "-L", name, "list-sessions")
			if cmd.Run() == nil {
				mu.Lock()
				servers = append(servers, name)
				mu.Unlock()
			}
		}(name)
	}
	wg.Wait()

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
