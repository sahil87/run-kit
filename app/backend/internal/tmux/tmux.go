package tmux

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// SessionOrderOption is the tmux server-scoped user option that stores the
// JSON-encoded sidebar session order.
const SessionOrderOption = "@rk_session_order"

// OwnerPIDOption is the session-scoped user option stamped on each relay
// ephemeral with the PID of the owning `rk serve` process. The startup sweep
// reads it to distinguish a live sibling's relays (spare) from a crashed
// predecessor's orphans (reap). Session-scoped so it dies with the ephemeral
// and never bleeds onto the real session through the session group.
const OwnerPIDOption = "@rk_owner_pid"

// OriginalTMUX captures the TMUX env var before init() strips it.
// Package-level var init runs before init(), so this sees the original value.
// Used by cmd/rk/context.go to restore TMUX in child process environments
// when querying the pane's own tmux server.
var OriginalTMUX = os.Getenv("TMUX")

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
	// RelaySessionPrefix is the reserved name prefix for run-kit's per-WebSocket
	// ephemeral grouped sessions. Sessions matching this prefix are filtered out
	// of user-facing session lists and reaped at server start.
	RelaySessionPrefix = "rk-relay-"
	// ControlAnchorSessionName is the literal name of the hidden anchor session
	// created by the tmuxctl package on tmux servers that have zero user
	// sessions (a `tmux -CC attach` requires an attached session). It is
	// filtered from user-facing session lists in parseSessions and is NEVER
	// touched by the relay sweep — it's owned by tmuxctl, not the relay.
	ControlAnchorSessionName = "_rk-ctl"
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
	RkType            string     `json:"rkType,omitempty"`
	RkUrl             string     `json:"rkUrl,omitempty"`
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
	raw := strings.Trim(string(out), "\n\r ")
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

// tmuxExecRawServer runs a tmux command targeting the specified server and
// returns raw stdout. On non-zero exit, captured stderr is appended to the
// error message so callers can pattern-match on tmux's diagnostic text
// (e.g., "invalid option", "no server running") to distinguish operational
// states from real failures.
func tmuxExecRawServer(ctx context.Context, server string, args ...string) (string, error) {
	full := append(serverArgs(server), args...)
	cmd := exec.CommandContext(ctx, "tmux", full...)
	var stderr strings.Builder
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("%w: %s", err, strings.TrimSpace(stderr.String()))
	}
	return string(out), nil
}

// withTimeout creates a context with the default tmux timeout.
func withTimeout() (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), TmuxTimeout)
}

// SessionInfo describes a tmux session.
type SessionInfo struct {
	Name  string `json:"name"`
	Color *int   `json:"color,omitempty"`
}

// parseSessions parses tmux list-sessions output lines into SessionInfo structs,
// filtering out session-group copies.
// Format: name, grouped, group, group_size, @color (5 fields).
// Exported for testing.
func parseSessions(lines []string) []SessionInfo {
	type rawEntry struct {
		name      string
		grouped   bool
		group     string
		groupSize int
		colorStr  string
	}

	// Pass 1: parse all valid lines.
	var entries []rawEntry
	for _, line := range lines {
		parts := strings.Split(line, listDelim)
		if len(parts) < 2 {
			continue
		}
		// Filter run-kit's per-WebSocket ephemeral grouped sessions from every
		// user-facing session list. This is the single chokepoint — every
		// consumer (REST, SSE, board derivation, server-aggregate) flows
		// through ListSessions/parseSessions, so a single early-skip here
		// guarantees no ephemeral leaks into the UI.
		if strings.HasPrefix(parts[0], RelaySessionPrefix) {
			continue
		}
		// Filter the tmuxctl control-mode anchor session — owned by the
		// tmuxctl package, not user-visible. Single chokepoint mirrors the
		// rk-relay-* skip above so every consumer (REST, SSE, board
		// derivation, server-aggregate) excludes it automatically.
		if parts[0] == ControlAnchorSessionName {
			continue
		}
		e := rawEntry{name: parts[0], grouped: parts[1] == "1"}
		if len(parts) >= 3 {
			e.group = parts[2]
		}
		if len(parts) >= 4 {
			e.groupSize, _ = strconv.Atoi(parts[3])
		}
		if len(parts) >= 5 {
			e.colorStr = parts[4]
		}
		entries = append(entries, e)
	}

	// Build set of groups that still have a name-matching leader.
	groupHasLeader := make(map[string]bool)
	for _, e := range entries {
		if e.grouped && e.name == e.group {
			groupHasLeader[e.group] = true
		}
	}

	// Pass 2: filter — keep ungrouped sessions, group leaders, sole members,
	// and one representative from leaderless groups (renamed leader).
	leaderlessIncluded := make(map[string]bool)
	var sessions []SessionInfo
	for _, e := range entries {
		keep := false
		switch {
		case !e.grouped:
			keep = true
		case e.name == e.group:
			keep = true
		case e.groupSize == 1:
			keep = true
		case !groupHasLeader[e.group] && !leaderlessIncluded[e.group]:
			// Leader was renamed — no session matches the group name.
			// Include the first member as representative.
			leaderlessIncluded[e.group] = true
			keep = true
		}
		if keep {
			si := SessionInfo{Name: e.name}
			if e.colorStr != "" {
				if n, err := strconv.Atoi(e.colorStr); err == nil {
					si.Color = &n
				}
			}
			sessions = append(sessions, si)
		}
	}
	return sessions
}

// ListRawSessionNames returns every session name on the given server WITHOUT
// the user-facing filters applied by ListSessions (group-copy de-duplication
// and rk-relay-* exclusion). It is intended only for housekeeping callers that
// need to see every session, such as the startup sweep that reaps orphan
// rk-relay-* ephemerals from a prior crashed instance.
//
// Returns nil if the server is not running.
func ListRawSessionNames(ctx context.Context, server string) ([]string, error) {
	ctx, cancel := context.WithTimeout(ctx, TmuxTimeout)
	defer cancel()

	lines, err := tmuxExecServer(ctx, server, "list-sessions", "-F", "#{session_name}")
	if err != nil {
		errMsg := err.Error()
		if strings.Contains(errMsg, "no server running") || strings.Contains(errMsg, "failed to connect") {
			return nil, nil
		}
		return nil, err
	}
	return lines, nil
}

// ListSessions returns sessions from the specified tmux server,
// filtering out session-group copies and run-kit's per-WebSocket ephemerals
// (RelaySessionPrefix). Returns nil if no server is running.
func ListSessions(ctx context.Context, server string) ([]SessionInfo, error) {
	ctx, cancel := context.WithTimeout(ctx, TmuxTimeout)
	defer cancel()

	format := fmt.Sprintf("#{session_name}%s#{session_grouped}%s#{session_group}%s#{session_group_size}%s#{@session_color}", listDelim, listDelim, listDelim, listDelim)

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
// Lines have 10 tab-delimited fields: window_id, window_index, window_name,
// pane_current_path, window_activity, window_active, pane_current_command,
// @color, @rk_type, @rk_url. Lines with fewer than 8 fields are skipped;
// fields 9-10 are optional (empty string if absent).
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

		var rkType, rkUrl string
		if len(parts) >= 9 {
			rkType = strings.TrimSpace(parts[8])
		}
		if len(parts) >= 10 {
			rkUrl = strings.TrimSpace(parts[9])
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
			RkType:            rkType,
			RkUrl:             rkUrl,
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
		"#{@rk_type}",
		"#{@rk_url}",
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

// parseSessionGroups parses `list-sessions` output of the form
// `#{session_id}<delim>#{session_name}<delim>#{session_group}` into a
// `$sid`→group map. tmux reports an EMPTY `#{session_group}` for ungrouped
// sessions; in that case the session's own name is used as the group key so a
// single-session (ungrouped) server still tracks under a stable key. The
// rk-relay-* ephemerals and the _rk-ctl anchor are NOT filtered here — they
// share their base session's group, so their `$sid` must resolve to that same
// group for an active-window event fired against an ephemeral member to update
// the correct (user-facing) group. Lines with fewer than 3 fields are skipped.
// Exported (same-package) for testing.
func parseSessionGroups(lines []string) map[string]string {
	out := make(map[string]string, len(lines))
	for _, line := range lines {
		parts := strings.Split(line, listDelim)
		if len(parts) < 3 {
			continue
		}
		sid := strings.TrimSpace(parts[0])
		name := strings.TrimSpace(parts[1])
		group := strings.TrimSpace(parts[2])
		if sid == "" {
			continue
		}
		if group == "" {
			group = name
		}
		if group == "" {
			continue
		}
		out[sid] = group
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

// ListSessionGroups returns a `$sid`→session-group map for the server, used by
// the active-window tracker to resolve the `$sid` carried by
// `%session-window-changed` to a group in O(1). Ungrouped sessions fall back to
// their own name as the group key (see parseSessionGroups). Returns nil (no
// error) when the server is not running. Read-only — never mutates sessions
// (Constitution §VI).
func ListSessionGroups(ctx context.Context, server string) (map[string]string, error) {
	ctx, cancel := context.WithTimeout(ctx, TmuxTimeout)
	defer cancel()

	format := strings.Join([]string{
		"#{session_id}",
		"#{session_name}",
		"#{session_group}",
	}, listDelim)

	lines, err := tmuxExecServer(ctx, server, "list-sessions", "-F", format)
	if err != nil {
		errMsg := err.Error()
		if strings.Contains(errMsg, "no server running") || strings.Contains(errMsg, "failed to connect") {
			return nil, nil
		}
		return nil, err
	}
	return parseSessionGroups(lines), nil
}

// parseActiveWindowsByGroup parses `list-windows -a` output of the form
// `#{session_group}<delim>#{session_name}<delim>#{window_id}<delim>#{window_active}`
// into a group→active-`@wid` map for use as the Tier-1 re-seed.
//
// In a session group, EACH member carries its own active-window pointer, so
// `list-windows -a` emits one `window_active=1` row per member. The seed MUST
// reflect the BASE (leader) session's pointer — the same signal Tier 2 reads —
// so only the leader row (where `session_name == session_group`) is honored for
// grouped sessions. Ungrouped sessions report an empty group; their own name is
// the group key and their sole `window_active=1` row is taken. A leaderless
// group (renamed leader, no name==group row) records the first active row seen
// as a best-effort representative. Lines with fewer than 4 fields are skipped.
// Exported (same-package) for testing.
func parseActiveWindowsByGroup(lines []string) map[string]string {
	out := make(map[string]string)
	leaderSeen := make(map[string]bool)
	for _, line := range lines {
		parts := strings.Split(line, listDelim)
		if len(parts) < 4 {
			continue
		}
		group := strings.TrimSpace(parts[0])
		name := strings.TrimSpace(parts[1])
		wid := strings.TrimSpace(parts[2])
		active := strings.TrimSpace(parts[3]) == "1"
		if !active || wid == "" {
			continue
		}
		if group == "" {
			group = name
		}
		if group == "" {
			continue
		}
		isLeader := name == group
		if isLeader {
			// Leader pointer is authoritative for the group's seed.
			out[group] = wid
			leaderSeen[group] = true
			continue
		}
		// Non-leader (ephemeral) row — only used as a fallback if the group
		// never produces a leader row in this listing.
		if !leaderSeen[group] {
			if _, ok := out[group]; !ok {
				out[group] = wid
			}
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

// ListActiveWindowsByGroup returns a group→active-`@wid` map snapshotting the
// current active window per session group, used to re-seed the active-window
// tracker on control-client (re)connect. tmux does NOT replay
// `%session-window-changed` on a fresh `-CC` attach, so without this seed the
// tracker would be empty (cold start) or stale (reconnect). Returns nil (no
// error) when the server is not running. Read-only — never mutates sessions
// (Constitution §VI).
func ListActiveWindowsByGroup(ctx context.Context, server string) (map[string]string, error) {
	ctx, cancel := context.WithTimeout(ctx, TmuxTimeout)
	defer cancel()

	format := strings.Join([]string{
		"#{session_group}",
		"#{session_name}",
		"#{window_id}",
		"#{window_active}",
	}, listDelim)

	lines, err := tmuxExecServer(ctx, server, "list-windows", "-a", "-F", format)
	if err != nil {
		errMsg := err.Error()
		if strings.Contains(errMsg, "no server running") || strings.Contains(errMsg, "failed to connect") {
			return nil, nil
		}
		return nil, err
	}
	return parseActiveWindowsByGroup(lines), nil
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

// killAudit emits a loud, durable WARN line before any tmux teardown so that
// post-mortem analysis can answer "who killed this server/session?". It is
// deliberately WARN (not Debug) because the failures it diagnoses — a real
// user session or whole server vanishing unexpectedly — are rare and we want
// the evidence to survive the default log level and the daemon log tee
// (RK_DAEMON_LOG). The `audit=kill` field makes every teardown greppable:
//
//	grep 'audit=kill' ~/Library/Caches/rk/daemon.log
//
// `callers` captures the immediate call chain (skipping killAudit + the kill
// wrapper itself) so an unexpected `kit` teardown points straight at the
// responsible code path (HTTP handler, relay cleanup, sweep, daemon reap).
func killAudit(op, server, target string) {
	slog.Warn("tmux teardown",
		"audit", "kill",
		"op", op,
		"server", server,
		"target", target,
		"callers", callerChain(2, 4),
	)
}

// callerChain returns a "file:line<-file:line<-…" string of up to `depth`
// frames starting `skip` levels above callerChain itself. Used only for audit
// logging — kept allocation-light and never on a hot path.
func callerChain(skip, depth int) string {
	pcs := make([]uintptr, depth)
	n := runtime.Callers(skip+1, pcs)
	if n == 0 {
		return "unknown"
	}
	frames := runtime.CallersFrames(pcs[:n])
	var b strings.Builder
	for i := 0; ; i++ {
		frame, more := frames.Next()
		if i > 0 {
			b.WriteString("<-")
		}
		b.WriteString(fmt.Sprintf("%s:%d", filepath.Base(frame.File), frame.Line))
		if !more {
			break
		}
	}
	return b.String()
}

// KillSession kills an entire tmux session on the specified server. Uses the
// default tmux timeout via context.Background — see KillSessionCtx for callers
// that need to supply their own context (e.g., relay handler cleanup that runs
// after the request context is cancelled).
func KillSession(session string, server string) error {
	return KillSessionCtx(context.Background(), server, session)
}

// KillSessionCtx kills a tmux session, scoping the underlying tmux call to the
// provided parent context wrapped with TmuxTimeout. Callers that need cleanup
// to survive request-context cancellation MUST pass context.Background() — the
// relay handler's deferred cleanup is the canonical use case.
func KillSessionCtx(ctx context.Context, server, session string) error {
	ctx, cancel := context.WithTimeout(ctx, TmuxTimeout)
	defer cancel()

	killAudit("kill-session", server, session)
	_, err := tmuxExecServer(ctx, server, "kill-session", "-t", session)
	return err
}

// NewGroupedSession creates a detached ephemeral session in the same group as
// realSession on the given tmux server using `tmux new-session -d -s <ephemeral>
// -t <realSession>`. The new session shares window membership with realSession
// but maintains independent active-window state — clients attached to it can
// navigate windows independently of clients attached to other group members.
//
// Used by the WebSocket relay to give each connection its own attach target so
// concurrent board panes targeting the same real session do not steal each
// other's active window. The returned session MUST be killed by the caller
// (typically via `defer KillSessionCtx`).
//
// The parent ctx is wrapped with TmuxTimeout consistent with sibling helpers.
//
// Returns a non-nil error if realSession does not exist on the server. tmux's
// new-session -t silently creates an empty group when the target is missing,
// which would leak a useless ephemeral; we explicitly probe with has-session
// first so the caller's defer-kill is the only path that creates ephemerals.
func NewGroupedSession(ctx context.Context, server, realSession, ephemeral string) error {
	ctx, cancel := context.WithTimeout(ctx, TmuxTimeout)
	defer cancel()

	if _, err := tmuxExecServer(ctx, server, "has-session", "-t", realSession); err != nil {
		return fmt.Errorf("real session %q not found: %w", realSession, err)
	}
	_, err := tmuxExecServer(ctx, server, "new-session", "-d", "-s", ephemeral, "-t", realSession)
	return err
}

// ResolveWindowSession returns the name of the user-facing session that owns
// the window identified by windowID on the given server. Ephemeral relay
// sessions (RelaySessionPrefix) are filtered out — a window in a session group
// appears under every group member, and `display-message -t @N` may pick the
// ephemeral over the real session, which would make a fresh relay group itself
// against a dying ephemeral. Returns an error when the window ID does not exist
// in any non-ephemeral session — callers (e.g. the relay) treat that as
// "window not found".
func ResolveWindowSession(ctx context.Context, server, windowID string) (string, error) {
	lines, err := tmuxExecServer(ctx, server, "list-windows", "-a", "-F", "#{session_name}"+listDelim+"#{window_id}")
	if err != nil {
		return "", err
	}
	for _, line := range lines {
		parts := strings.SplitN(line, listDelim, 2)
		if len(parts) != 2 {
			continue
		}
		session := strings.TrimSpace(parts[0])
		id := strings.TrimSpace(parts[1])
		if id != windowID {
			continue
		}
		if strings.HasPrefix(session, RelaySessionPrefix) {
			continue
		}
		if session == "" {
			continue
		}
		return session, nil
	}
	return "", fmt.Errorf("window %q not found", windowID)
}

// resolveWindowSessionIndex resolves both the owning session name and the current
// window index for the window identified by windowID. Used by positional
// operations (MoveWindow) that must translate a stable ID into a mutable index.
func resolveWindowSessionIndex(ctx context.Context, server, windowID string) (string, int, error) {
	lines, err := tmuxExecServer(ctx, server, "display-message", "-t", windowID, "-p", "#{session_name}\t#{window_index}")
	if err != nil {
		return "", 0, err
	}
	if len(lines) == 0 {
		return "", 0, fmt.Errorf("window %q not found", windowID)
	}
	parts := strings.SplitN(strings.TrimSpace(lines[0]), "\t", 2)
	if len(parts) != 2 || parts[0] == "" {
		return "", 0, fmt.Errorf("window %q: unexpected display-message output %q", windowID, lines[0])
	}
	idx, err := strconv.Atoi(strings.TrimSpace(parts[1]))
	if err != nil {
		return "", 0, fmt.Errorf("window %q: parse window index %q: %w", windowID, parts[1], err)
	}
	return parts[0], idx, nil
}

// MoveWindow reorders the window identified by windowID to before dstIndex within
// its own session, shifting intermediate windows via adjacent swaps. This gives
// "insert before" semantics (e.g., moving index 0 to index 2 in [a b c d] produces
// [b a c d]). The source is addressed by its stable window ID; reorder is inherently
// positional, so the destination remains a numeric index. The window's ID is
// preserved by the swaps (tmux move-window/swap-window contract).
func MoveWindow(windowID string, dstIndex int, server string) error {
	ctx, cancel := withTimeout()
	defer cancel()

	// Resolve the owning session and the source window's current index from its
	// stable window ID. Index is needed because the reorder is positional.
	session, srcIndex, err := resolveWindowSessionIndex(ctx, server, windowID)
	if err != nil {
		return err
	}
	if srcIndex == dstIndex {
		return nil
	}

	// Get sorted window indices so we can bubble via adjacent swaps
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
	// Emit all adjacent swaps as one \;-chained tmux invocation so no other
	// mutation can interleave mid-reorder (a concurrent kill/move observes only
	// the pre- or post-reorder layout). This mirrors the CreateWindowWithOptions
	// chaining pattern. The source index was resolved exactly once above.
	var args []string
	for pos := srcPos; pos != endPos; pos += step {
		if len(args) > 0 {
			args = append(args, ";")
		}
		src := fmt.Sprintf("%s:%d", session, indices[pos])
		dst := fmt.Sprintf("%s:%d", session, indices[pos+step])
		args = append(args, "swap-window", "-s", src, "-t", dst)
	}
	if _, err := tmuxExecServer(ctx, server, args...); err != nil {
		return fmt.Errorf("swap-window chain: %w", err)
	}
	return nil
}

// MoveWindowToSession moves the window identified by windowID to another session
// on the specified server. The source is a self-contained window ID; the
// destination is a session name. move-window preserves the window's ID in its new
// session (tmux contract).
func MoveWindowToSession(windowID string, dstSession string, server string) error {
	ctx, cancel := withTimeout()
	defer cancel()

	dst := fmt.Sprintf("%s:", dstSession)
	_, err := tmuxExecServer(ctx, server, "move-window", "-s", windowID, "-t", dst)
	return err
}

// SetWindowOption sets a user-defined window option on the specified server.
func SetWindowOption(ctx context.Context, windowID string, server, option, value string) error {
	_, err := tmuxExecServer(ctx, server, "set-option", "-w", "-t", windowID, option, value)
	return err
}

// UnsetWindowOption removes a user-defined window option on the specified server.
func UnsetWindowOption(ctx context.Context, windowID string, server, option string) error {
	_, err := tmuxExecServer(ctx, server, "set-option", "-wu", "-t", windowID, option)
	return err
}

// WindowOptionOp is a single set-or-unset operation on a window option, consumed
// by SetWindowOptions. A non-nil Value sets the option to that value; a nil Value
// unsets it (set-option -w -u). This pointer convention mirrors the JSON
// string|null shape the /options endpoint decodes.
type WindowOptionOp struct {
	Key   string
	Value *string
}

// appendOptionOps appends the `set-option` argv for each op to args, prefixing a
// "\;" chain separator before all but the first appended op when args is already
// non-empty. A non-nil op.Value emits `set-option -w -t <target> <key> <value>`;
// a nil Value emits `set-option -w -u -t <target> <key>`. When target is empty,
// the `-t <target>` qualifier is omitted (used by CreateWindowWithOptions, where
// the preceding new-window already scopes the chained set-options to the new
// window). All values are passed as argv elements — no shell strings (§I).
func appendOptionOps(args []string, target string, ops []WindowOptionOp) []string {
	for _, op := range ops {
		if len(args) > 0 {
			args = append(args, ";")
		}
		args = append(args, "set-option", "-w")
		if op.Value == nil {
			args = append(args, "-u")
		}
		if target != "" {
			args = append(args, "-t", target)
		}
		args = append(args, op.Key)
		if op.Value != nil {
			args = append(args, *op.Value)
		}
	}
	return args
}

// SetWindowOptions applies a batch of window-option set/unset operations to the
// window identified by windowID as a single \;-chained tmux invocation. Chaining
// makes the whole merge atomic — the SSE poll never observes a half-applied
// state — and reuses the same pattern CreateWindowWithOptions uses. A non-nil
// op.Value sets via `set-option -w -t <windowID> <key> <value>`; a nil Value
// unsets via `set-option -w -u -t <windowID> <key>`. All arguments are passed as
// an argv slice — no shell strings (constitution §I). A no-op (empty ops) issues
// no tmux call.
func SetWindowOptions(ctx context.Context, windowID, server string, ops []WindowOptionOp) error {
	if len(ops) == 0 {
		return nil
	}
	args := appendOptionOps(nil, windowID, ops)
	_, err := tmuxExecServer(ctx, server, args...)
	return err
}

// CreateWindowWithOptions creates a new window and atomically sets user-defined
// options using a single \;-chained tmux command. This prevents SSE from seeing
// the window before its metadata is set. The post-create option-setting reuses
// the same WindowOptionOp chaining primitive (appendOptionOps) the
// SetWindowOptions primitive uses; window creation and option-set stay in one
// invocation so they are atomic at creation. The new-window scopes the chained
// set-options to itself, so the ops are emitted without a `-t` target.
func CreateWindowWithOptions(session, name, cwd, server string, ops []WindowOptionOp) error {
	ctx, cancel := withTimeout()
	defer cancel()

	args := []string{"new-window", "-a", "-t", session, "-n", name}
	if cwd != "" {
		args = append(args, "-c", cwd)
	}
	args = appendOptionOps(args, "", ops)
	_, err := tmuxExecServer(ctx, server, args...)
	return err
}

// KillWindow kills a window by its window ID on the specified server.
func KillWindow(windowID string, server string) error {
	ctx, cancel := withTimeout()
	defer cancel()

	_, err := tmuxExecServer(ctx, server, "kill-window", "-t", windowID)
	return err
}

// RenameSession renames a tmux session on the specified server.
func RenameSession(session, name string, server string) error {
	ctx, cancel := withTimeout()
	defer cancel()

	_, err := tmuxExecServer(ctx, server, "rename-session", "-t", session, name)
	return err
}

// RenameWindow renames a window by its window ID on the specified server.
func RenameWindow(windowID string, name string, server string) error {
	ctx, cancel := withTimeout()
	defer cancel()

	_, err := tmuxExecServer(ctx, server, "rename-window", "-t", windowID, name)
	return err
}

// SendKeys sends keystrokes to a tmux window by its window ID on the specified server.
func SendKeys(windowID string, keys string, server string) error {
	ctx, cancel := withTimeout()
	defer cancel()

	_, err := tmuxExecServer(ctx, server, "send-keys", "-t", windowID, keys, "Enter")
	return err
}

// SetSessionColor sets the @session_color user option on a session.
// Uses a distinct name from window @color to avoid tmux option inheritance.
func SetSessionColor(session string, color int, server string) error {
	ctx, cancel := withTimeout()
	defer cancel()

	_, err := tmuxExecServer(ctx, server, "set-option", "-t", session, "@session_color", strconv.Itoa(color))
	return err
}

// UnsetSessionColor removes the @session_color user option from a session.
func UnsetSessionColor(session string, server string) error {
	ctx, cancel := withTimeout()
	defer cancel()

	_, err := tmuxExecServer(ctx, server, "set-option", "-u", "-t", session, "@session_color")
	return err
}

// SetSessionOwnerPID stamps the @rk_owner_pid user option on a relay ephemeral
// session with the owning `rk serve` process PID. Session-scoped (mirrors
// SetSessionColor's `set-option -t <session>` pattern) so ownership lives on the
// ephemeral itself and is never inherited by the real session through the
// session group. The startup sweep reads this to spare a live sibling's relays.
func SetSessionOwnerPID(ctx context.Context, server, session string, pid int) error {
	ctx, cancel := context.WithTimeout(ctx, TmuxTimeout)
	defer cancel()

	_, err := tmuxExecServer(ctx, server, "set-option", "-t", session, OwnerPIDOption, strconv.Itoa(pid))
	return err
}

// GetSessionOwnerPID reads the @rk_owner_pid user option from a session and
// returns its raw string value, or "" when the option is unset or the server is
// unreachable. Mirrors GetSessionOrder's tolerance: tmux reports an unset
// user-option as "invalid option"/"unknown option" and an absent socket as
// "no server running"/"failed to connect" — both are normal states that the
// sweep MUST treat as "no owner" (→ orphan) rather than a hard error. Other
// subprocess failures propagate so the caller can log + accumulate per server.
func GetSessionOwnerPID(ctx context.Context, server, session string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, TmuxTimeout)
	defer cancel()

	out, err := tmuxExecRawServer(ctx, server, "show-options", "-v", "-t", session, OwnerPIDOption)
	if err != nil {
		errMsg := err.Error()
		if strings.Contains(errMsg, "invalid option") ||
			strings.Contains(errMsg, "unknown option") ||
			strings.Contains(errMsg, "no server running") ||
			strings.Contains(errMsg, "failed to connect") {
			return "", nil
		}
		return "", fmt.Errorf("read %s on %s: %w", OwnerPIDOption, session, err)
	}
	return strings.TrimSpace(out), nil
}

// SetWindowColor sets the @color user option on a window by its window ID.
func SetWindowColor(windowID string, color int, server string) error {
	ctx, cancel := withTimeout()
	defer cancel()

	_, err := tmuxExecServer(ctx, server, "set-option", "-w", "-t", windowID, "@color", strconv.Itoa(color))
	return err
}

// UnsetWindowColor removes the @color user option from a window by its window ID.
func UnsetWindowColor(windowID string, server string) error {
	ctx, cancel := withTimeout()
	defer cancel()

	_, err := tmuxExecServer(ctx, server, "set-option", "-wu", "-t", windowID, "@color")
	return err
}

// SelectWindow selects (focuses) a window by its window ID on the specified server.
func SelectWindow(windowID string, server string) error {
	ctx, cancel := withTimeout()
	defer cancel()

	_, err := tmuxExecServer(ctx, server, "select-window", "-t", windowID)
	return err
}

// SelectWindowInSession selects a window scoped to a specific session, targeting
// "<session>:<windowID>". A bare window-id target (`select-window -t @N`) is
// ambiguous inside a tmux session group — group members share window membership
// but keep independent active-window state, so tmux may set the active window on
// the wrong member. The relay needs the active window set on its per-WebSocket
// ephemeral specifically, so it qualifies the target with the ephemeral session.
func SelectWindowInSession(session, windowID, server string) error {
	ctx, cancel := withTimeout()
	defer cancel()

	target := fmt.Sprintf("%s:%s", session, windowID)
	_, err := tmuxExecServer(ctx, server, "select-window", "-t", target)
	return err
}

// SplitWindow splits a window to create an independent pane on the specified server. Returns the new pane ID.
// If horizontal is true, the pane is split left/right (-h flag); otherwise top/bottom.
// If cwd is non-empty, the new pane starts in that directory (-c flag).
func SplitWindow(windowID string, horizontal bool, cwd string, server string) (string, error) {
	ctx, cancel := withTimeout()
	defer cancel()

	args := []string{"split-window"}
	if horizontal {
		args = append(args, "-h")
	}
	if cwd != "" {
		args = append(args, "-c", cwd)
	}
	args = append(args, "-t", windowID, "-d", "-P", "-F", "#{pane_id}")
	lines, err := tmuxExecServer(ctx, server, args...)
	if err != nil {
		return "", err
	}
	if len(lines) == 0 {
		return "", fmt.Errorf("split-window returned no pane ID")
	}
	return lines[0], nil
}

// KillActivePane kills the active pane of the window identified by windowID on
// the given server. Targeting a window ID with kill-pane kills that window's
// active pane.
//
// Silent-success contract (canonical pane-kill behavior): any tmux error is
// swallowed and nil is returned, because the pane may already be dead by the
// time this runs (e.g. the process exited, or a concurrent close-pane already
// killed it). Callers treat "close the pane" as best-effort idempotent — a
// missing pane is success, not failure.
func KillActivePane(windowID string, server string) error {
	ctx, cancel := withTimeout()
	defer cancel()

	_, err := tmuxExecServer(ctx, server, "kill-pane", "-t", windowID)
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

// IsTestServerName reports whether name belongs to the unified test-socket
// umbrella: every Go and Playwright test tmux server is named
// rk-test-<role>-<pid>-<ns>, so "is this a test artifact?" collapses to a
// single HasPrefix("rk-test-") check. This is the one place the "rk-test-"
// literal lives; the tmuxctl supervisor (resurrection guard) consumes it.
//
// It is intentionally NOT applied in ListServers nor in the /api/servers
// handler — internal consumers (board.go in particular) iterate every real
// tmux server, and /api/servers surfaces every server so the operator sees
// exactly what `rk reaper` will reap.
func IsTestServerName(name string) bool {
	return strings.HasPrefix(name, "rk-test-")
}

// socketDirPath returns the tmux socket directory for the current uid
// (/tmp/tmux-{uid}). This is the single definition of the socket-dir
// convention — both ScanSocketDir and the reaper consume it.
func socketDirPath() string {
	return fmt.Sprintf("/tmp/tmux-%d", os.Getuid())
}

// LockSocketSuffix is the filename suffix tmux uses for its per-socket lock
// files in the socket directory. Unlike the sockets themselves these are
// REGULAR files, not unix sockets, so the socket-mode filter alone would never
// surface them. The reaper sweeps stale `*.lock` files (PR #199 orphan class);
// ListServers ignores them. Single source of truth for the suffix.
const LockSocketSuffix = ".lock"

// ScanSocketDir returns the raw candidate names in the tmux socket directory
// (/tmp/tmux-{uid}) that the reaper may act on: every unix-socket file PLUS
// every `*.lock` regular file. It does NOT probe for liveness, so dead sockets
// ARE included. Returns nil (no error) when the directory does not exist or
// cannot be read (no servers running). This is the single source for the
// socket-dir candidate-collection convention, shared by ListServers (which
// skips the `.lock` entries — see ListServers) and the reaper.
func ScanSocketDir(ctx context.Context) ([]string, error) {
	entries, err := os.ReadDir(socketDirPath())
	if err != nil {
		// Directory doesn't exist or can't be read — no servers running
		return nil, nil
	}
	return filterSocketEntries(entries), nil
}

// filterSocketEntries keeps the reapable candidates from a socket-dir listing:
// unix-socket files (live or dead tmux servers) AND `*.lock` regular files
// (tmux's per-socket lock artifacts, which are NOT sockets and so must be
// matched by name). Directories and all other regular files are dropped.
// Extracted so the filter is testable against a temp directory without
// depending on the hardcoded /tmp/tmux-{uid} path.
func filterSocketEntries(entries []os.DirEntry) []string {
	var candidates []string
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		if strings.HasSuffix(e.Name(), LockSocketSuffix) {
			// tmux lock files are regular files, not sockets — match by name.
			candidates = append(candidates, e.Name())
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
	return candidates
}

// probeServerAlive reports whether a tmux server is reachable on the named
// socket by running `tmux -L <name> list-sessions` with a short timeout.
// Used by ListServers (to keep only live servers) and the reaper (to
// distinguish live orphan test servers from dead sockets).
func probeServerAlive(ctx context.Context, name string) bool {
	probeCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	cmd := exec.CommandContext(probeCtx, "tmux", "-L", name, "list-sessions")
	return cmd.Run() == nil
}

// ListServers discovers available tmux servers by scanning the tmux socket directory
// at /tmp/tmux-{uid}/. Probes each socket to confirm the server is alive.
// Returns sorted server names.
func ListServers(ctx context.Context) ([]string, error) {
	candidates, err := ScanSocketDir(ctx)
	if err != nil {
		return nil, err
	}

	// Probe each socket concurrently — bounded goroutine pool.
	sem := make(chan struct{}, 10)
	var mu sync.Mutex
	var wg sync.WaitGroup
	var servers []string

	for _, name := range candidates {
		// `.lock` files are not servers — ScanSocketDir surfaces them for the
		// reaper, but ListServers only enumerates real tmux servers, so skip
		// them rather than spend a doomed probe subprocess on each.
		if strings.HasSuffix(name, LockSocketSuffix) {
			continue
		}
		wg.Add(1)
		sem <- struct{}{} // acquire semaphore slot
		go func(name string) {
			defer wg.Done()
			defer func() { <-sem }() // release
			if probeServerAlive(ctx, name) {
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

	killAudit("kill-server", server, server)
	_, err := tmuxExecServer(ctx, server, "kill-server")
	if err != nil && strings.Contains(err.Error(), "No such file or directory") {
		return nil
	}
	return err
}

// GetSessionOrder reads the user-defined session order from tmux user-option
// @rk_session_order. The stored value is a JSON-encoded array of session names.
//
// Returns an empty (non-nil) slice and a nil error when the option is unset.
// "Unset" is detected by tmux's stderr message ("unknown option") OR by the
// "no server running" / "failed to connect" socket-not-found cases — these
// are normal operational states (fresh server, no order ever set) and not
// errors that should bubble up.
//
// Other subprocess failures (exec failure, permission, malformed value) AND
// JSON decode errors propagate as wrapped errors so callers can surface 5xx.
func GetSessionOrder(ctx context.Context, server string) ([]string, error) {
	ctx, cancel := context.WithTimeout(ctx, TmuxTimeout)
	defer cancel()

	out, err := tmuxExecRawServer(ctx, server, "show-option", "-sv", SessionOrderOption)
	if err != nil {
		errMsg := err.Error()
		// Treat "option unset" and "no server" as empty rather than an error.
		// Both are normal first-use states. tmux uses "invalid option:" for
		// unset user-options and "no server running"/"failed to connect" for
		// the absent-socket case.
		if strings.Contains(errMsg, "invalid option") ||
			strings.Contains(errMsg, "unknown option") ||
			strings.Contains(errMsg, "no server running") ||
			strings.Contains(errMsg, "failed to connect") {
			return []string{}, nil
		}
		return nil, fmt.Errorf("read %s: %w", SessionOrderOption, err)
	}
	raw := strings.TrimSpace(out)
	if raw == "" {
		return []string{}, nil
	}
	var order []string
	if jerr := json.Unmarshal([]byte(raw), &order); jerr != nil {
		return nil, fmt.Errorf("decode %s: %w", SessionOrderOption, jerr)
	}
	if order == nil {
		order = []string{}
	}
	return order, nil
}

// SetSessionOrder writes the session order to tmux user-option
// @rk_session_order as a JSON-encoded array. A nil slice is treated as the
// empty slice (encoded as "[]") so that round-trips through GetSessionOrder
// are lossless.
func SetSessionOrder(ctx context.Context, server string, order []string) error {
	if order == nil {
		order = []string{}
	}
	encoded, err := json.Marshal(order)
	if err != nil {
		return fmt.Errorf("encode session order: %w", err)
	}
	ctx, cancel := context.WithTimeout(ctx, TmuxTimeout)
	defer cancel()

	_, err = tmuxExecRawServer(ctx, server, "set-option", "-s", SessionOrderOption, string(encoded))
	return err
}
