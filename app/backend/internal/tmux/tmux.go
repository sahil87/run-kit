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
	"syscall"
	"time"

	"rk/internal/validate"
)

// SessionOrderOption is the tmux server-scoped user option that stores the
// JSON-encoded sidebar session order.
const SessionOrderOption = "@rk_session_order"

// ServerRankOption is the tmux server-scoped user option that stores this
// server's user-defined display rank (an integer, ascending) among the other
// tmux servers. Order data rides each server so a killed server takes only its
// own rank — no cross-server merge rule is needed. Mirrors SessionOrderOption.
const ServerRankOption = "@rk_server_rank"

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

// ExactSessionTarget returns the unambiguous tmux target string for a session
// name: `=name:`. The leading `=` disables tmux's prefix/fnmatch name matching
// (exact match only) and the trailing `:` forces the string to parse as a
// session — never as a window name.
//
// The colon is load-bearing for commands whose `-t` is a *window* target
// (new-window; list-panes, even under `-s`): tmux resolves a bare name against
// the window names of the current/attached session BEFORE trying it as a
// session name, so a window that shares its name with the target session
// hijacks the command. Observed live (server "ext", 2026-07-17): with a window
// named "planner" in the attached session, `new-window -a -t planner` created
// its window in the attached session instead of session "planner", and
// `list-panes -s -t planner` listed the attached session's panes — which the
// window-index pane join then glued onto session "planner"'s windows. Since
// windows AND sessions are auto-named from folder basenames
// (automatic-rename-format), such collisions are routine, not exotic.
//
// Session names are validated to contain no `:` or `.` (validate.ValidateName)
// and cannot start with `=` in practice; pin-session names (`_rk-pin-<digits>`)
// and the control anchor are equally safe to wrap.
func ExactSessionTarget(session string) string {
	return "=" + session + ":"
}

// exactWindowInSession returns a session-qualified window target with an
// exact-match session part: `=session:windowSpec`. windowSpec must itself be
// unambiguous within the session — a window ID (@N) or a numeric index.
func exactWindowInSession(session, windowSpec string) string {
	return "=" + session + ":" + windowSpec
}

const (
	// TmuxTimeout is the default timeout for tmux commands.
	TmuxTimeout = 10 * time.Second
	// ActivityThresholdSeconds is how recently a window must have had activity to be "active".
	ActivityThresholdSeconds = 10
	// listDelim is the tab delimiter used in tmux format strings.
	listDelim = "\t"
	// PinSessionPrefix is the reserved name prefix for run-kit's single-window
	// board pin-sessions. Each pinned window is LINKED into its own session named
	// `_rk-pin-<windowDigits>` (the window's `@N` id with the `@` stripped, since
	// tmux session names disallow `@`) — the window stays a member of its home
	// session too (dual membership). Sessions matching this prefix are filtered
	// out of user-facing session lists — a board is the set of pin-sessions
	// sharing an `@rk_board` value, not a session itself. Pin-sessions are
	// persistent across rk restarts (Constitution VI); there is no startup sweep.
	PinSessionPrefix = "_rk-pin-"
	// ControlAnchorSessionName is the literal name of the hidden anchor session
	// created by the tmuxctl package on tmux servers that have zero user
	// sessions (a `tmux -CC attach` requires an attached session). It is
	// filtered from user-facing session lists in parseSessions — it's owned by
	// tmuxctl, not user-facing.
	ControlAnchorSessionName = "_rk-ctl"
)

// PinSessionName derives the single-window pin-session name for a window id by
// stripping the leading `@` (tmux session names disallow `@`): `@42` →
// `_rk-pin-42`. Returns ("", false) for an invalid window id. The mapping is
// pure and reversible (see WindowIDFromPinSession), so membership needs no
// name→id lookup table.
func PinSessionName(windowID string) (string, bool) {
	if !ValidWindowID(windowID) {
		return "", false
	}
	return PinSessionPrefix + windowID[1:], true
}

// WindowIDFromPinSession is the inverse of PinSessionName: `_rk-pin-42` → `@42`.
// Returns ("", false) when name lacks the prefix or the recovered id is not a
// valid `@<digits>` window id.
func WindowIDFromPinSession(name string) (string, bool) {
	if !strings.HasPrefix(name, PinSessionPrefix) {
		return "", false
	}
	id := "@" + strings.TrimPrefix(name, PinSessionPrefix)
	if !ValidWindowID(id) {
		return "", false
	}
	return id, true
}

// AgentStateOption is the tmux PANE-scoped user option that carries the generic
// agent-lifecycle state written by agent-harness hooks (installed via
// `rk agent-setup`). Value schema: "<state>:<epoch_seconds>", state ∈
// active|waiting|idle. It is the tier-2 signal owned by run-kit (tier 1 —
// change/stage — stays fab's). See docs/specs/agent-state.md.
const AgentStateOption = "@rk_agent_state"

// Agent lifecycle states carried by @rk_agent_state. Any other token parses as
// unknown (empty state, zero epoch).
const (
	AgentStateActive  = "active"
	AgentStateWaiting = "waiting"
	AgentStateIdle    = "idle"
)

// ChatOption is the tmux PANE-scoped user option that ties a pane to the live
// agent chat session running in it. Value schema: "<provider>:<session-ref>"
// (e.g. "claude:6f0d9e2a-1c3b-4f7e-9a2d-8b5c4e1f0a37"). <provider> is the
// rk agent-setup registry agent name; <session-ref> is a provider-defined opaque
// reference (the session UUID for claude). It is written by the same
// `rk agent-hook` binary that writes @rk_agent_state, on the same fires. The
// pane→session mapping is underivable from disk/tmux/git (multiple transcripts
// share a cwd), which is exactly the class of fact Constitution X reserves for
// hooks. See docs/specs/agent-state.md § Chat Session Identity.
const ChatOption = "@rk_chat"

// shellCommands is the set of plain-shell pane_current_command values that the
// LEGACY reconciler fallback treats as "no agent" — applied only to
// two-segment @rk_agent_state values (no pid segment, older writers). A pane
// running one of these has no agent regardless of a leftover value (the guppi
// auto-clear lesson: a killed agent can strand a stale `active`). Pid-carrying
// values use the precise PID-liveness reconciler instead (agentProcessAlive)
// and never consult this set. See docs/specs/agent-state.md § Reader rules.
var shellCommands = map[string]bool{
	"bash": true,
	"zsh":  true,
	"fish": true,
	"sh":   true,
	"dash": true,
}

// isShellCommand reports whether cmd is one of the plain shells the reconciler
// treats as having no agent.
func isShellCommand(cmd string) bool {
	return shellCommands[cmd]
}

// isAgentState reports whether s is one of the three known agent states.
func isAgentState(s string) bool {
	return s == AgentStateActive || s == AgentStateWaiting || s == AgentStateIdle
}

// agentProcessAlive reports whether the agent process with the given pid is
// still alive, via the classic kill(pid, 0) liveness probe: no signal is sent,
// only existence/permission is checked. EPERM counts as alive (the process
// exists but belongs to another user). Package-level var so tests can stub it —
// parsePanes stays deterministic without real processes.
var agentProcessAlive = func(pid int) bool {
	err := syscall.Kill(pid, 0)
	return err == nil || err == syscall.EPERM
}

// parseAgentState parses a raw @rk_agent_state value of the form
// "<state>:<epoch_seconds>[:<pid>]" into a validated (state, epoch, pid)
// triple. The pid segment is optional (written by rk agent-setup's hooks as
// $PPID — the agent process itself, since the hook runs as its `sh -c` child);
// pid is 0 when the segment is absent (legacy two-segment writers). A value
// that is empty, has the wrong segment count, carries an unknown state token,
// a non-integer epoch, or a malformed/non-positive pid yields ("", 0, 0) —
// unknown (malformed values are never partially trusted).
func parseAgentState(raw string) (string, int64, int) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", 0, 0
	}
	parts := strings.Split(raw, ":")
	if len(parts) < 2 || len(parts) > 3 {
		return "", 0, 0
	}
	state := parts[0]
	if !isAgentState(state) {
		return "", 0, 0
	}
	epoch, err := strconv.ParseInt(parts[1], 10, 64)
	if err != nil {
		return "", 0, 0
	}
	pid := 0
	if len(parts) == 3 {
		pid, err = strconv.Atoi(parts[2])
		if err != nil || pid <= 0 {
			return "", 0, 0
		}
	}
	return state, epoch, pid
}

// parseChatRef parses a raw @rk_chat value of the form
// "<provider>:<session-ref>" into a validated (provider, ref) pair. It trims the
// value, splits on the FIRST colon (providers never contain a colon; a ref might
// in principle, so the tail after the first colon is the ref verbatim), and
// validates the provider shape ([a-z][a-z0-9_-]*, non-empty) and the ref
// (non-empty, no whitespace or control chars). Any violation — empty value,
// missing colon, empty/invalid provider, empty/whitespace ref — yields ("", "")
// (wholly unknown, mirroring parseAgentState's never-partially-trust tolerance).
// An unknown-but-well-formed provider is NOT rejected: presence-gating is
// provider-agnostic and codex/gemini adapters are additive.
func parseChatRef(raw string) (provider, ref string) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", ""
	}
	i := strings.IndexByte(raw, ':')
	if i < 0 {
		return "", ""
	}
	provider = raw[:i]
	ref = raw[i+1:]
	if !isChatProvider(provider) || !isChatRef(ref) {
		return "", ""
	}
	return provider, ref
}

// isChatProvider reports whether p matches [a-z][a-z0-9_-]* (a lowercase token,
// the shape of an rk agent-setup registry agent name). Non-empty is implied by
// the leading-char requirement.
func isChatProvider(p string) bool {
	if p == "" {
		return false
	}
	for i := 0; i < len(p); i++ {
		c := p[i]
		if i == 0 {
			if c < 'a' || c > 'z' {
				return false
			}
			continue
		}
		if (c < 'a' || c > 'z') && (c < '0' || c > '9') && c != '_' && c != '-' {
			return false
		}
	}
	return true
}

// isChatRef reports whether r is a valid session-ref: non-empty with no
// whitespace or control characters (a well-formed opaque token; the provider
// defines its inner structure). A ref carrying whitespace/control bytes is a
// malformed value the reader must not trust.
func isChatRef(r string) bool {
	if r == "" {
		return false
	}
	for _, c := range r {
		if c <= ' ' || c == 0x7f {
			return false
		}
	}
	return true
}

// PaneInfo describes a single tmux pane within a window.
type PaneInfo struct {
	PaneID    string `json:"paneId"`
	PaneIndex int    `json:"paneIndex"`
	Cwd       string `json:"cwd"`
	Command   string `json:"command"`
	IsActive  bool   `json:"isActive"`
	GitBranch string `json:"gitBranch,omitempty"`
	// CwdMissing is true when Cwd is non-empty but no longer exists on disk —
	// e.g. a worktree that was deleted (archived) out from under a still-live
	// tmux pane. tmux keeps reporting the stale path until the shell's cwd
	// recovers, so the UI surfaces this as a "(deleted)" marker.
	CwdMissing bool `json:"cwdMissing,omitempty"`
	// AgentState is the generic agent-lifecycle state from the pane's
	// @rk_agent_state option (active|waiting|idle; empty = unknown), after the
	// reconciler (PID liveness for pid-carrying values; shell-command fallback
	// for legacy two-segment values). AgentStateEpoch is the option's
	// epoch-seconds segment (0 = unknown), from which idle/waiting duration is
	// computed rk-side.
	AgentState      string `json:"agentState,omitempty"`
	AgentStateEpoch int64  `json:"agentStateEpoch,omitempty"`
	// ChatProvider / ChatSessionRef are the pre-parsed halves of the pane's
	// @rk_chat option (provider = the agent-setup registry name, ref = the
	// provider-defined session reference; both empty = no chat), after the same
	// reconciler that governs the agent-state fields (a dead-pid or shell pane
	// never surfaces chat). Parsed once here via parseChatRef so no consumer
	// re-splits the raw value. See ChatOption / docs/specs/agent-state.md.
	ChatProvider   string `json:"chatProvider,omitempty"`
	ChatSessionRef string `json:"chatSessionRef,omitempty"`
}

// WindowInfo describes a single tmux window within a session.
type WindowInfo struct {
	Index             int    `json:"index"`
	WindowID          string `json:"windowId"`
	Name              string `json:"name"`
	WorktreePath      string `json:"worktreePath"`
	Activity          string `json:"activity"` // "active" or "idle"
	IsActiveWindow    bool   `json:"isActiveWindow"`
	PaneCommand       string `json:"paneCommand,omitempty"`
	ActivityTimestamp int64   `json:"activityTimestamp"`
	Color             *string `json:"color,omitempty"`
	AgentState        string  `json:"agentState,omitempty"`
	AgentIdleDuration string `json:"agentIdleDuration,omitempty"`
	// ChatProvider / ChatSessionRef are the window-level rollup of the panes'
	// reconciled @rk_chat (the active pane's chat if set, else the first pane
	// carrying one), computed rk-side in FetchSessions by rollupChat. Per-pane
	// truth is preserved on Panes[].ChatProvider/ChatSessionRef. See ChatOption.
	ChatProvider      string `json:"chatProvider,omitempty"`
	ChatSessionRef    string `json:"chatSessionRef,omitempty"`
	FabChange         string `json:"fabChange,omitempty"`
	FabStage          string `json:"fabStage,omitempty"`
	FabDisplayState   string `json:"fabDisplayState,omitempty"` // pipeline state of the displayed stage; empty when fab reports null/omits the field
	// PR fields. PrURL/PrNumber come from `fab pane map` (filesystem, cheap)
	// via the sessions enrichment join (Layer 1). PrState/PrChecks/PrReview/
	// PrIsDraft are attached by the SSE hub from the in-memory prstatus
	// collector snapshot (Layer 3) — only for change-bound windows. Both
	// layers are populated outside this package.
	PrURL     *string    `json:"prUrl,omitempty"`
	PrNumber  *int       `json:"prNumber,omitempty"`
	PrState   string     `json:"prState,omitempty"`
	PrChecks  string     `json:"prChecks,omitempty"`
	PrReview  string     `json:"prReview,omitempty"`
	PrIsDraft bool       `json:"prIsDraft,omitempty"`
	// PrFetchedAt is when the joined PR status was last fetched by the viewer-wide
	// collector (prstatus.PRStatus.FetchedAt). Collector-join-owned like
	// PrChecks/PrReview/PrIsDraft: set on a URL-keyed snapshot hit, reset to nil on
	// a miss. Surfaced in the StatusDotTip as an ambient "checked Xs ago" freshness
	// line; a manual refresh visibly resets it.
	PrFetchedAt *time.Time `json:"prFetchedAt,omitempty"`
	RkType    string     `json:"rkType,omitempty"`
	RkUrl     string     `json:"rkUrl,omitempty"`
	// Marker is the window's left-gutter marker state, sourced from the
	// @rk_marker window user option: "" (unset)/"dotted"/"solid"/"double". An
	// independent label axis from Color — see docs/specs/themes.md. Unknown
	// tokens are dropped to "" by parseWindows.
	Marker    string     `json:"marker,omitempty"`
	Panes     []PaneInfo `json:"panes,omitempty"`
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
	Name  string  `json:"name"`
	Color *string `json:"color,omitempty"`
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
		// Filter run-kit's single-window board pin-sessions from every
		// user-facing session list. A pinned window is LINKED into its
		// `_rk-pin-*` session (it stays a member of its home session too, so it
		// still appears in the sidebar natively via its home membership); the
		// pin-session ITSELF is never a user-facing SESSIONS entry (it is
		// rendered only as a BOARDS pane). This is the single chokepoint — every
		// consumer (REST, SSE, board derivation, server-aggregate) flows
		// through ListSessions/parseSessions, so a single early-skip here
		// guarantees no pin-session leaks into the SESSIONS UI while the pinned
		// window is still shown under its home session.
		if strings.HasPrefix(parts[0], PinSessionPrefix) {
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
			// Color is a value descriptor ("4" / "1+3"); normalize the raw
			// option token, dropping anything malformed.
			if normalized, ok := validate.NormalizeColorValue(e.colorStr); ok {
				si.Color = &normalized
			}
			sessions = append(sessions, si)
		}
	}
	return sessions
}

// ListPinSessionNames returns every `_rk-pin-*` session name on the given
// server. Board membership is derived from these single-window pin-sessions and
// their session vars (`@rk_board`/`@rk_home`/`@rk_board_order`). Returns nil
// (no error) if the server is not running. Read-only.
func ListPinSessionNames(ctx context.Context, server string) ([]string, error) {
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
	var pins []string
	for _, name := range lines {
		if strings.HasPrefix(name, PinSessionPrefix) {
			pins = append(pins, name)
		}
	}
	return pins, nil
}

// ListSessions returns sessions from the specified tmux server,
// filtering out session-group copies and run-kit's board pin-sessions
// (PinSessionPrefix). Returns nil if no server is running.
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

// parsePanes parses tmux list-panes output lines into a window-id→[]PaneInfo map.
// Lines are 8-field tab-delimited: window_id, pane_id, pane_index, cwd,
// command, is_active, @rk_agent_state, @rk_chat. Field 0 (window_id) is
// consumed for grouping and not stored in PaneInfo. Lines with fewer than 8
// fields are silently skipped. Empty input returns nil.
//
// The grouping key is the stable window ID (@N), NOT the window index: the
// panes come from a separate list-panes call than the windows they are joined
// to (ListWindows), and an index join silently glues the wrong session's panes
// onto a window whenever the two calls' targets diverge (the bare-name
// session/window target collision ExactSessionTarget guards against) or a
// concurrent reorder shifts indices between the calls. A window-id join can
// only attach a pane to the window that actually owns it — at worst a window
// gets an empty pane list, a visible degradation instead of wrong data.
//
// The @rk_agent_state field (field 6) is parsed into
// AgentState/AgentStateEpoch (+ an optional agent pid) via parseAgentState,
// then reconciled: pid-carrying values are trusted iff the agent process is
// alive (kill-0 liveness — precise, wrapper-launch-proof); legacy two-segment
// values fall back to the shell-command heuristic (a plain-shell pane has no
// agent — the guppi auto-clear lesson that prevents a stranded `active` after
// a kill).
//
// The @rk_chat field (field 7) is parsed into ChatProvider/ChatSessionRef via
// parseChatRef and reconciled by the SAME liveness signal: @rk_chat carries no
// pid, so a dead agent (or a plain-shell pane with no live pid-bearing
// agent-state) must not leave a live-looking chat ref (plan risk #4). The chat
// fields are zeroed on exactly the same condition that zeros the agent-state
// fields — a dead pid, or the shell-command fallback.
//
// Accessible to same-package tests.
func parsePanes(lines []string) map[string][]PaneInfo {
	if len(lines) == 0 {
		return nil
	}
	byWindow := make(map[string][]PaneInfo)
	for _, line := range lines {
		parts := strings.Split(line, listDelim)
		if len(parts) < 8 {
			continue
		}
		windowID := strings.TrimSpace(parts[0])
		if !ValidWindowID(windowID) {
			continue
		}

		paneIndex, err := strconv.Atoi(strings.TrimSpace(parts[2]))
		if err != nil {
			continue
		}
		isActive := strings.TrimSpace(parts[5]) == "1"
		command := strings.TrimSpace(parts[4])
		agentState, agentEpoch, agentPID := parseAgentState(parts[6])
		chatProvider, chatRef := parseChatRef(parts[7])
		// Reconciler. Primary form (pid-carrying values from current
		// agent-setup hooks): PID liveness — the state is trusted iff the agent
		// process is still alive, regardless of the pane's command name. This
		// fixes the wrapped-launch false negative (an agent started via a
		// non-exec'ing shell wrapper reports pane_current_command = "bash"
		// while genuinely running) and precisely clears state from a
		// killed/crashed agent. Legacy fallback (two-segment values, no pid):
		// the original shell-command heuristic — a plain-shell pane has no
		// agent regardless of a leftover value.
		//
		// stale is the single dead/no-agent decision shared by both tiers:
		// @rk_chat has no pid of its own, so it borrows the same pane's
		// agent-state liveness (written by the same binary on the same fires) —
		// a dead agent zeros BOTH the agent-state and chat fields, and a
		// plain-shell pane never surfaces chat.
		stale := false
		if agentPID > 0 {
			stale = !agentProcessAlive(agentPID)
		} else {
			stale = isShellCommand(command)
		}
		if stale {
			agentState, agentEpoch = "", 0
			chatProvider, chatRef = "", ""
		}
		p := PaneInfo{
			PaneID:          strings.TrimSpace(parts[1]),
			PaneIndex:       paneIndex,
			Cwd:             parts[3],
			Command:         command,
			IsActive:        isActive,
			AgentState:      agentState,
			AgentStateEpoch: agentEpoch,
			ChatProvider:    chatProvider,
			ChatSessionRef:  chatRef,
		}
		byWindow[windowID] = append(byWindow[windowID], p)
	}
	if len(byWindow) == 0 {
		return nil
	}
	return byWindow
}

// parseWindows parses tmux list-windows output lines into WindowInfo structs.
// nowUnix is the current Unix timestamp for activity threshold computation.
// Lines have 11 tab-delimited fields: window_id, window_index, window_name,
// pane_current_path, window_activity, window_active, pane_current_command,
// @color, @rk_type, @rk_url, @rk_marker. Lines with fewer than 8 fields are
// skipped; fields 9-11 are optional (empty string if absent).
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

		// Color is a value descriptor ("4" / "1+3"); normalize the raw option
		// token, dropping anything malformed.
		var color *string
		if normalized, ok := validate.NormalizeColorValue(parts[7]); ok {
			color = &normalized
		}

		var rkType, rkUrl string
		if len(parts) >= 9 {
			rkType = strings.TrimSpace(parts[8])
		}
		if len(parts) >= 10 {
			rkUrl = strings.TrimSpace(parts[9])
		}

		// Marker is a closed-set token ("dotted"/"solid"/"double"); drop any
		// value outside the set (including "") to the empty unset state.
		var marker string
		if len(parts) >= 11 {
			if m := strings.TrimSpace(parts[10]); validate.MarkerValues[m] {
				marker = m
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
			RkType:            rkType,
			RkUrl:             rkUrl,
			Marker:            marker,
		})
	}
	return windows
}

// paneFormat is the list-panes format string: window_id, pane_id, pane_index,
// pane_current_path, pane_current_command, pane_active, @rk_agent_state, @rk_chat
// (8 fields). The @rk_agent_state field carries the generic agent-lifecycle state
// and @rk_chat the pane→chat-session mapping (see AgentStateOption / ChatOption /
// docs/specs/agent-state.md); both cost no extra subprocess since they ride the
// existing list-panes call.
var paneFormat = strings.Join([]string{
	"#{window_id}",
	"#{pane_id}",
	"#{pane_index}",
	"#{pane_current_path}",
	"#{pane_current_command}",
	"#{pane_active}",
	"#{@rk_agent_state}",
	"#{@rk_chat}",
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
		"#{@rk_marker}",
	}, listDelim)

	lines, err := tmuxExecServer(ctx, server, "list-windows", "-t", ExactSessionTarget(session), "-F", format)
	if err != nil {
		return nil, nil
	}

	windows := parseWindows(lines, time.Now().Unix())

	// Fetch pane data — non-fatal if list-panes fails (e.g., session disappears mid-tick).
	paneLines, paneErr := tmuxExecServer(ctx, server, "list-panes", "-s", "-t", ExactSessionTarget(session), "-F", paneFormat)
	if paneErr == nil {
		byWindow := parsePanes(paneLines)
		if byWindow != nil {
			for i := range windows {
				windows[i].Panes = byWindow[windows[i].WindowID]
			}
		}
	}

	return windows, nil
}

// baseGroupName returns the user-facing base session name for a session group,
// given the session's own name and its `#{session_group_list}` value (a
// comma-separated list of MEMBER NAMES). The base is the member that is not the
// _rk-ctl anchor — i.e. the real, user-facing session that the dashboard keys
// on. (Relay ephemerals no longer exist, so only the anchor is filtered.) When
// the list is empty (ungrouped session) or yields no qualifying member, the
// session's own name is returned.
//
// This MUST NOT key on `#{session_group}`: tmux 3.6a reports that field as an
// opaque NUMERIC group id (e.g. "0"), not the leader's name — so `name ==
// session_group` is never true for real grouped sessions. The group-list is the
// reliable cross-reference to the base session name. The returned name is the
// same value `parseSessions` keeps as `SessionInfo.Name`, so the active-window
// tracker keys (event + re-seed) align with the derivation lookup in
// internal/sessions.
func baseGroupName(name, groupList string) string {
	for _, member := range strings.Split(groupList, ",") {
		m := strings.TrimSpace(member)
		if m == "" {
			continue
		}
		if m == ControlAnchorSessionName {
			continue
		}
		return m
	}
	return name
}

// parseSessionGroups parses `list-sessions` output of the form
// `#{session_id}<delim>#{session_name}<delim>#{session_group_list}` into a
// `$sid`→base-session-name map. The _rk-ctl anchor is NOT filtered here — it
// shares its base session's group, so its `$sid` must resolve to the SAME base
// name for an active-window event fired against the anchor member to update the
// correct (user-facing) group. The
// group key is the base session name (via baseGroupName), NOT tmux's numeric
// `#{session_group}` id, so it matches the `SessionInfo.Name` the derivation
// path looks up. Lines with fewer than 3 fields are skipped. Exported
// (same-package) for testing.
func parseSessionGroups(lines []string) map[string]string {
	out := make(map[string]string, len(lines))
	for _, line := range lines {
		parts := strings.Split(line, listDelim)
		if len(parts) < 3 {
			continue
		}
		sid := strings.TrimSpace(parts[0])
		name := strings.TrimSpace(parts[1])
		groupList := strings.TrimSpace(parts[2])
		if sid == "" {
			continue
		}
		group := baseGroupName(name, groupList)
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
		"#{session_group_list}",
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
// `#{session_group_list}<delim>#{session_name}<delim>#{window_id}<delim>#{window_active}`
// into a base-session-name→active-`@wid` map for use as the Tier-1 re-seed.
//
// In a session group, EACH member carries its own active-window pointer, so
// `list-windows -a` emits one `window_active=1` row per member. The seed MUST
// reflect the BASE (user-facing) session's pointer — the same signal Tier 2
// reads — so only the row whose `#{session_name}` IS the base name (derived from
// `#{session_group_list}` via baseGroupName, never tmux's numeric
// `#{session_group}`) is honored. The map is keyed by that base name so it
// aligns with both parseSessionGroups and the derivation lookup
// (SessionInfo.Name). Ungrouped sessions have an empty group-list, so the base
// is their own name and their sole `window_active=1` row is taken. As a
// best-effort fallback, if a group never produces a base-member row in this
// listing (e.g. the base session is momentarily absent), the first active row
// for that base name is recorded. Lines with fewer than 4 fields are skipped.
// Exported (same-package) for testing.
func parseActiveWindowsByGroup(lines []string) map[string]string {
	out := make(map[string]string)
	baseSeen := make(map[string]bool)
	for _, line := range lines {
		parts := strings.Split(line, listDelim)
		if len(parts) < 4 {
			continue
		}
		groupList := strings.TrimSpace(parts[0])
		name := strings.TrimSpace(parts[1])
		wid := strings.TrimSpace(parts[2])
		active := strings.TrimSpace(parts[3]) == "1"
		if !active || wid == "" {
			continue
		}
		base := baseGroupName(name, groupList)
		if base == "" {
			continue
		}
		if name == base {
			// The base session's own pointer is authoritative for the seed.
			out[base] = wid
			baseSeen[base] = true
			continue
		}
		// Non-base (anchor) row — only used as a fallback if the
		// group never produces a base-member row in this listing.
		if !baseSeen[base] {
			if _, ok := out[base]; !ok {
				out[base] = wid
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
		"#{session_group_list}",
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
// Because new-session may start the tmux server process, the command runs "as
// if the user had started tmux from $HOME" — on both halves of that contract:
//
//   - Environment (see sanitizeEnv): direnv's DIRENV_DIFF is reverse-applied so
//     the server is born with the operator's from-home environment, and
//     rk-owned (RK_*) and direnv-state (DIRENV_*) vars are stripped. Without
//     this, a server first-touched by the rk daemon inherits run-kit's
//     direnv-polluted environment (WORKTREE_INIT_SCRIPT, IDEAS_FILE,
//     RK_PORT/RK_HOST, RK_DAEMON_LOG, a direnv-mangled PATH), leaking run-kit's
//     project config into unrelated repos.
//   - Working directory (see ServerBirthDir): the exec runs with cmd.Dir pinned
//     to the operator's home, so a server this call births never inherits rk's
//     own CWD. A tmux server keeps the CWD of the process that first touches
//     its socket for its whole life; inheriting rk's CWD (often a git worktree
//     that is later deleted) parks the server on a dead inode — on tmux 3.7 the
//     server-side chdir guard (`getcwd` in spawn.c) then fails and every new
//     pane silently ignores its `-c` path. The explicit cwd argument still
//     lands as `-c` on the session itself; the Dir pin anchors only the server
//     process and the session's default start dir.
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
	return runTmuxWithEnv(ctx, full, CleanEnvForServer(), ServerBirthDir())
}

// runTmuxWithEnv executes a tmux command with an optional environment override
// and an optional working-directory override (empty dir inherits the process
// CWD), capturing stderr for diagnostics. Server-birth-capable invocations pass
// ServerBirthDir() so the born server never sits on rk's own CWD.
func runTmuxWithEnv(ctx context.Context, args []string, env []string, dir string) error {
	cmd := exec.CommandContext(ctx, "tmux", args...)
	if env != nil {
		cmd.Env = env
	}
	cmd.Dir = dir
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

// ServerBirthDir returns the working directory every rk-birthed tmux server
// (and rk-created pin-session) is anchored to: the operator's home directory,
// falling back to "/" when the home cannot be resolved. "/" always exists and
// can never dangle — mirroring tmux ≤ 3.6a's own child-side fallback chain
// (target → $HOME → /). $HOME is what a login-shell-started tmux would give,
// so it is the least-surprising stable anchor. Shared by CreateSession,
// board.go's pin-session create, daemon.startSession, and
// tmuxctl.createAnchor.
func ServerBirthDir() string {
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		return "/"
	}
	return home
}

// cleanPATH is the POSIX default PATH used only as a last-resort guard when the
// sanitized environment carries no PATH at all (see sanitizeEnv). It is no
// longer an unconditional reset — the direnv-reversed environment carries the
// operator's true from-home PATH.
const cleanPATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

// CleanEnvForServer returns a sanitized copy of the current environment for a
// tmux server rk is about to birth. See sanitizeEnv. Exported so every
// birth-capable seam shares one sanitization (CreateSession here;
// tmuxctl.createAnchor cross-package).
func CleanEnvForServer() []string {
	return sanitizeEnv(os.Environ())
}

// sanitizeEnv produces the environment for a user-facing tmux server born by
// rk, targeting the semantics "as if the user had started tmux from $HOME":
//
//  1. Reverse-apply direnv's DIRENV_DIFF (undoing run-kit's .envrc changes,
//     including restoring the operator's true pre-direnv PATH). A malformed
//     diff is logged and treated as absent — sanitization never fails hard.
//  2. Strip all RK_*-prefixed vars (RK_DAEMON_LOG, RK_PORT, RK_HOST, ...): rk
//     adds these post-direnv so diff reversal does not catch them.
//  3. Strip all DIRENV_*-prefixed vars (incl. DIRENV_DIFF itself): direnv
//     excludes its own state vars from the diff, so reversal leaves them; a
//     from-home shell has none.
//  4. As a last-resort guard, inject PATH=cleanPATH only if no PATH survives,
//     so the tmux server never starts with an empty PATH.
func sanitizeEnv(environ []string) []string {
	reversed, err := reverseDirenvDiff(environ)
	if err != nil {
		slog.Warn("direnv diff reversal failed; passing env through with strips",
			"err", err,
		)
		reversed = environ
	}

	env := make([]string, 0, len(reversed)+1)
	pathSeen := false
	for _, e := range reversed {
		if strings.HasPrefix(e, "RK_") || strings.HasPrefix(e, "DIRENV_") {
			continue
		}
		if strings.HasPrefix(e, "PATH=") {
			pathSeen = true
		}
		env = append(env, e)
	}
	if !pathSeen {
		env = append(env, "PATH="+cleanPATH)
	}
	return env
}

// buildCreateWindowArgs builds the argv slice (after the "tmux" binary and any
// -L server prefix) for a plain window create. When name is empty the -n token
// is omitted entirely, so tmux applies its automatic-rename-format
// ('#{b:pane_current_path}' in the embedded configs) and the window names itself
// to the folder basename immediately — no rename round-trip is needed because
// -c cwd is passed on the create. A non-empty name pins the window (tmux
// disables automatic-rename on an explicit name), which is the desired behavior
// for deliberately named windows. Pure, no side effects, so the -n-conditional
// branch is unit-testable without a live tmux server (mirrors riff.go's
// buildNewWindowArgs).
func buildCreateWindowArgs(session, name, cwd string) []string {
	args := []string{"new-window", "-a", "-t", ExactSessionTarget(session)}
	if name != "" {
		args = append(args, "-n", name)
	}
	args = append(args, "-c", cwd)
	return args
}

// CreateWindow creates a new window in an existing session on the specified server.
// An empty name lets tmux auto-name the window to its folder basename (see
// buildCreateWindowArgs); a non-empty name pins it.
func CreateWindow(session, name, cwd string, server string) error {
	ctx, cancel := withTimeout()
	defer cancel()

	_, err := tmuxExecServer(ctx, server, buildCreateWindowArgs(session, name, cwd)...)
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
	_, err := tmuxExecServer(ctx, server, "kill-session", "-t", ExactSessionTarget(session))
	return err
}

// ResolveWindowSession returns the window's HOME (non-pin) session on the given
// server. A board-pinned window is a member of TWO sessions at once — its home
// session AND its single-window `_rk-pin-*` pin-session (Pin uses link-window,
// not move-window) — so a naive `display-message -t <windowID> -p
// "#{session_name}"` may report EITHER link (tmux's pick across links is
// order-unspecified). When the naive result is a pin-session name, this
// re-resolves deterministically to the non-pin owner by enumerating
// `list-windows -a` and choosing the session for @N that is not a `_rk-pin-*`
// name. A window whose ONLY link is its pin-session (its home session died while
// pinned, or a legacy move-based pin) legitimately resolves to the pin-session.
// The relay layers its own pin-session-first attach preference ABOVE this (see
// api/terminals_ws.go); this function's job is to name the home session for
// callers that need it (the REST /select handler, ProjectRoot).
//
// Not-found contract: callers (e.g. the relay) rely on a missing window
// surfacing as `window %q not found`. On tmux 3.6a, `display-message` for a
// missing `-t @N` exits 0 with empty stdout, so the empty-result guard is the
// primary not-found path. A tmux error whose stderr names a missing window
// (other tmux versions/phrasings) is also mapped to the same contract; genuine
// operational errors (dead server, deadline) are returned unchanged so callers
// can distinguish "window gone" from "tmux unavailable".
func ResolveWindowSession(ctx context.Context, server, windowID string) (string, error) {
	lines, err := tmuxExecServer(ctx, server, "display-message", "-t", windowID, "-p", "#{session_name}")
	if err != nil {
		if isMissingWindowErr(err) {
			return "", fmt.Errorf("window %q not found", windowID)
		}
		return "", err
	}
	if len(lines) == 0 {
		return "", fmt.Errorf("window %q not found", windowID)
	}
	session := strings.TrimSpace(lines[0])
	if session == "" {
		return "", fmt.Errorf("window %q not found", windowID)
	}
	// Dual membership: if tmux named the pin-session, re-resolve to the home
	// (non-pin) session. A window whose only link is its pin-session keeps the
	// pin-session (home is gone).
	if strings.HasPrefix(session, PinSessionPrefix) {
		if home, ok, herr := resolveHomeSession(ctx, server, windowID); herr != nil {
			return "", herr
		} else if ok {
			return home, nil
		}
	}
	return session, nil
}

// resolveHomeSession enumerates every session the window identified by windowID
// is linked into (via `list-windows -a`) and returns the first non-pin
// (non-`_rk-pin-*`) session. ok is false when the window is linked ONLY into
// pin-session(s) — i.e. it has no live home session — in which case the caller
// keeps the pin-session as the resolved owner. Read-only.
func resolveHomeSession(ctx context.Context, server, windowID string) (string, bool, error) {
	lines, err := tmuxExecServer(ctx, server, "list-windows", "-a", "-F", "#{session_name}\t#{window_id}")
	if err != nil {
		return "", false, err
	}
	for _, line := range lines {
		parts := strings.SplitN(strings.TrimSpace(line), "\t", 2)
		if len(parts) != 2 {
			continue
		}
		name := strings.TrimSpace(parts[0])
		wid := strings.TrimSpace(parts[1])
		if wid != windowID {
			continue
		}
		if strings.HasPrefix(name, PinSessionPrefix) {
			continue
		}
		return name, true, nil
	}
	return "", false, nil
}

// isMissingWindowErr reports whether err's stderr text matches tmux's
// missing-window phrasings (e.g. "can't find window: @N"). Used to map a tmux
// target-not-found error back to the not-found contract without swallowing
// operational failures (a dead server reports different stderr — see
// serverGoneText).
func isMissingWindowErr(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	return strings.Contains(msg, "can't find window") ||
		strings.Contains(msg, "window not found")
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
//
// Active-window preservation: tmux pins a session's active window to its *index
// slot* during swap-window, so after the shuffle a DIFFERENT window would occupy
// the active slot. To keep the user's viewed terminal from drifting, the session's
// active window ID is captured before the swaps (from the same list-windows call)
// and restored with a final session-qualified select-window (-t <session>:@N)
// appended to the SAME \;-chained invocation — atomic, so no SSE poll or concurrent
// mutation observes the intermediate active-window state. The target is
// session-qualified rather than a bare @N because a bare window-id select is
// ambiguous inside a tmux session group (see SelectWindowInSession). Restoring by
// stable window ID also handles the edge where the dragged window is itself the
// active one.
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

	// Get sorted window indices so we can bubble via adjacent swaps, and — from the
	// same call, no extra subprocess — the active window's stable ID so it can be
	// restored after the shuffle (tmux otherwise pins the active window to its index
	// slot, drifting it to whatever window lands there).
	out, err := tmuxExecServer(ctx, server, "list-windows", "-t", ExactSessionTarget(session), "-F", "#{window_index}\t#{window_active}\t#{window_id}")
	if err != nil {
		return fmt.Errorf("list windows: %w", err)
	}

	var indices []int
	var activeWindowID string
	for _, line := range out {
		fields := strings.Split(strings.TrimSpace(line), "\t")
		if len(fields) < 3 {
			continue
		}
		idx, err := strconv.Atoi(strings.TrimSpace(fields[0]))
		if err != nil {
			continue
		}
		indices = append(indices, idx)
		if strings.TrimSpace(fields[1]) == "1" {
			activeWindowID = strings.TrimSpace(fields[2])
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
	// Past this point the swap chain WILL run, drifting the active window off its
	// stable ID. Preserving it depends on having captured that ID above; every
	// session has exactly one active window, so an empty activeWindowID here means
	// the list-windows parse failed to find it. Fail before mutating rather than
	// execute the swaps and silently skip the restore (which would reintroduce the
	// active-window drift this function exists to prevent).
	if activeWindowID == "" {
		return fmt.Errorf("could not determine active window for session %q; refusing to reorder without an active-window ID to restore", session)
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
		src := exactWindowInSession(session, strconv.Itoa(indices[pos]))
		dst := exactWindowInSession(session, strconv.Itoa(indices[pos+step]))
		args = append(args, "swap-window", "-s", src, "-t", dst)
	}
	// Restore the pre-shuffle active window by its stable ID, appended to the SAME
	// chained invocation so the active-window slot is corrected atomically with the
	// swaps. Reached only on the swap-executing path — the srcIndex==dstIndex and
	// srcPos==endPos early returns above emit no swaps and no restore, and the
	// empty-activeWindowID guard above already bailed, so activeWindowID is non-empty here.
	//
	// The target is session-qualified (<session>:@N), not a bare @N: a bare
	// window-id select is ambiguous inside a tmux session group — group members
	// share window membership but keep independent active-window pointers, so a
	// bare -t @N may set the active window on the wrong member (see
	// SelectWindowInSession). Qualifying with the owning session pins the restore
	// to the session whose reorder we just performed.
	args = append(args, ";", "select-window", "-t", exactWindowInSession(session, activeWindowID))
	if _, err := tmuxExecServer(ctx, server, args...); err != nil {
		return fmt.Errorf("swap-window/select-window chain: %w", err)
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

	dst := ExactSessionTarget(dstSession)
	_, err := tmuxExecServer(ctx, server, "move-window", "-s", windowID, "-t", dst)
	return err
}

// LinkWindowToSession links the window identified by windowID INTO another
// session on the specified server, leaving it a member of its original
// session(s) too. Unlike MoveWindowToSession (which removes the window from its
// source), link-window makes the window a shared member of both sessions — the
// board pin-session model relies on this so a pinned window stays visible in its
// home session AND attachable via its `_rk-pin-*` session. The source is a
// self-contained window ID; the destination is a session name. link-window
// preserves the window's ID (tmux contract). tmux destroys the window only when
// its LAST link is removed, which is what makes Unpin = kill-session on the
// pin-session leave the window intact in home.
func LinkWindowToSession(windowID string, dstSession string, server string) error {
	ctx, cancel := withTimeout()
	defer cancel()

	dst := ExactSessionTarget(dstSession)
	_, err := tmuxExecServer(ctx, server, "link-window", "-s", windowID, "-t", dst)
	return err
}

// HasSession reports whether a session with the given name exists on the server.
// Uses an exact-match `has-session` probe (via ExactSessionTarget). Any error
// (unset session, dead server, deadline) is reported as false — the caller wants
// a boolean existence answer, not an operational error. Read-only.
func HasSession(ctx context.Context, server, session string) bool {
	ctx, cancel := context.WithTimeout(ctx, TmuxTimeout)
	defer cancel()
	_, err := tmuxExecRawServer(ctx, server, "has-session", "-t", ExactSessionTarget(session))
	return err == nil
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

	args := []string{"new-window", "-a", "-t", ExactSessionTarget(session), "-n", name}
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

	_, err := tmuxExecServer(ctx, server, "rename-session", "-t", ExactSessionTarget(session), name)
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

// ChatSendBuffer is the named tmux paste buffer used by the chat-send injection
// path. A NAMED buffer (rather than the anonymous top-of-stack) means loading a
// chat message never clobbers whatever the user has on their buffer stack, and
// the paste (-d) deletes it afterwards so the buffer set stays clean.
const ChatSendBuffer = "rk-chat-send"

// SetChatSendBufferCtx loads text into the named chat-send buffer
// (ChatSendBuffer) on the specified server, bounded by the CALLER's context. The
// chat-send handler threads ONE shared deadline through the whole injection
// sequence (set → paste → probe → Enter) so the route stays well under the 5s
// route-blocking budget (code-review.md) rather than granting each subprocess an
// independent 10s timeout. The text is a DISCRETE argv element (no shell string,
// no stdin) so any content — including newlines, tmux key names, or special
// characters — is stored verbatim (Constitution §I). tmuxExecServer has no stdin
// plumbing, so `set-buffer <text>` is used rather than `load-buffer -`.
//
// The `--` option terminator precedes the text so a message that itself starts
// with a dash (e.g. "--force is broken") is treated as the positional buffer
// data, not parsed as set-buffer flags (which would hard-fail). Verified on tmux
// 3.6a: with `--`, leading-dash text stores verbatim.
func SetChatSendBufferCtx(ctx context.Context, text string, server string) error {
	_, err := tmuxExecServer(ctx, server, "set-buffer", "-b", ChatSendBuffer, "--", text)
	return err
}

// PasteChatSendBufferCtx pastes the named chat-send buffer into the target PANE
// (not a window) on the specified server, bounded by the CALLER's context. `-p`
// requests bracketed paste (the Claude Code TUI enables bracketed paste, so a
// multiline / special-character message lands as one literal block with no
// per-line submission); `-d` deletes the buffer after pasting so the buffer set
// stays clean.
func PasteChatSendBufferCtx(ctx context.Context, paneID string, server string) error {
	_, err := tmuxExecServer(ctx, server, "paste-buffer", "-d", "-p", "-b", ChatSendBuffer, "-t", paneID)
	return err
}

// SendEnterToPaneCtx sends a single literal Enter key to the target PANE on the
// specified server (`send-keys -t <paneID> Enter`), bounded by the CALLER's
// context. Used by the chat-send path to submit a pasted message ONLY after the
// echo probe confirms it reached the live input buffer — never blindly. Targets
// the resolved pane, not the window.
func SendEnterToPaneCtx(ctx context.Context, paneID string, server string) error {
	_, err := tmuxExecServer(ctx, server, "send-keys", "-t", paneID, "Enter")
	return err
}

// SetSessionColor sets the @session_color user option on a session. The value
// is a color-value descriptor ("4" / "1+3"), validated by the caller before it
// reaches this function. Passed as a discrete arg (no shell string) so a '+' in
// a blend value is safe (constitution §I).
// Uses a distinct name from window @color to avoid tmux option inheritance.
func SetSessionColor(session string, colorValue string, server string) error {
	ctx, cancel := withTimeout()
	defer cancel()

	_, err := tmuxExecServer(ctx, server, "set-option", "-t", ExactSessionTarget(session), "@session_color", colorValue)
	return err
}

// UnsetSessionColor removes the @session_color user option from a session.
func UnsetSessionColor(session string, server string) error {
	ctx, cancel := withTimeout()
	defer cancel()

	_, err := tmuxExecServer(ctx, server, "set-option", "-u", "-t", ExactSessionTarget(session), "@session_color")
	return err
}

// SetWindowColor sets the @color user option on a window by its window ID. The
// value is a color-value descriptor ("4" / "1+3"), validated by the caller. In
// practice window color now flows through SetWindowOptions; this remains for
// interface symmetry. Passed as a discrete arg (no shell string) per §I.
func SetWindowColor(windowID string, colorValue string, server string) error {
	ctx, cancel := withTimeout()
	defer cancel()

	_, err := tmuxExecServer(ctx, server, "set-option", "-w", "-t", windowID, "@color", colorValue)
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
// the wrong member. The REST window-select handler (api/windows.go handleWindowSelect)
// resolves the owning session and qualifies the target with it so the active window
// is set on the intended session, not an arbitrary group member.
func SelectWindowInSession(session, windowID, server string) error {
	ctx, cancel := withTimeout()
	defer cancel()

	target := exactWindowInSession(session, windowID)
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

// CapturePane captures pane content (last N lines) on the specified server.
// Preserves blank lines. The -e flag preserves ANSI escape sequences (color +
// text attributes) so callers can render the pane in color rather than as flat
// monochrome text; the sole caller (the tile-grid preview) parses these with a
// client-side SGR renderer. Non-color callers can strip the escapes downstream.
func CapturePane(paneID string, lines int, server string) (string, error) {
	ctx, cancel := withTimeout()
	defer cancel()
	return CapturePaneCtx(ctx, paneID, lines, server)
}

// CapturePaneCtx captures pane content (last N lines) on the specified server,
// bounded by the CALLER's context — used by the chat-send echo probe, which
// threads one shared deadline across all its captures so the retry loop stays
// under the route budget. See CapturePane for the flag semantics.
func CapturePaneCtx(ctx context.Context, paneID string, lines int, server string) (string, error) {
	start := -lines
	return tmuxExecRawServer(ctx, server, "capture-pane", "-t", paneID, "-e", "-p", "-S", strconv.Itoa(start))
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

// ServerAllowlistEnv is the environment variable that, when set, scopes
// ListServers to only the live servers whose names prefix-match one of its
// comma-separated tokens. It is read directly in-package (like RK_TMUX_CONF /
// OriginalTMUX above), NOT threaded through internal/config — ListServers is a
// ctx-only free function and internal/tmux has no config dependency to carry it.
//
// It exists solely for test isolation: the e2e harness sets it to the test
// server name so the backend's enumeration ignores the operator's live
// kit/runWork servers. Production leaves it UNSET, in which case ListServers
// behaves exactly as before (all live servers). See matchesServerAllowlist.
const ServerAllowlistEnv = "RK_SERVER_ALLOWLIST"

// matchesServerAllowlist reports whether a tmux server name is admitted by the
// allowlist. An empty or whitespace-only allowlist is treated as UNSET and
// admits every name (so an empty RK_SERVER_ALLOWLIST never means "match
// nothing"). Otherwise the allowlist is a comma-separated list of prefixes:
// each token is trimmed of surrounding whitespace, empty tokens are ignored,
// and name matches when it HasPrefix ANY remaining token (exact match is the
// prefix-of-itself case). Prefix matching is required because multi-server e2e
// specs create rk-test-e2e-<role>-<pid>-<epoch> secondaries that an exact
// match would wrongly exclude. Extracted as a pure helper so it is unit-testable
// without live tmux servers.
func matchesServerAllowlist(name, allowlist string) bool {
	if strings.TrimSpace(allowlist) == "" {
		return true
	}
	for _, token := range strings.Split(allowlist, ",") {
		token = strings.TrimSpace(token)
		if token == "" {
			continue
		}
		if strings.HasPrefix(name, token) {
			return true
		}
	}
	return false
}

// ListServers discovers available tmux servers by scanning the tmux socket directory
// at /tmp/tmux-{uid}/. Probes each socket to confirm the server is alive.
// Returns sorted server names.
//
// When the RK_SERVER_ALLOWLIST env var is set, the live-server list is further
// narrowed to names that prefix-match the allowlist (see matchesServerAllowlist).
// The filter lives HERE, not solely in the /api/servers handler, because the
// board route attaches servers from two distinct ListServers-rooted paths
// (GET /api/servers and the internal board.go board-entry enumeration); filtering
// only the handler would leave board enumeration unscoped. Production leaves the
// var UNSET, so this branch is a no-op there and the "surface every server"
// contract (see IsTestServerName / tmux.go:1332) is preserved byte-for-byte.
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

	// Env-gated test-isolation filter. Applied AFTER the liveness probe so only
	// matching LIVE servers survive. Unset/empty env => admits everything, so
	// production behavior is unchanged.
	if allowlist := os.Getenv(ServerAllowlistEnv); strings.TrimSpace(allowlist) != "" {
		filtered := servers[:0]
		for _, name := range servers {
			if matchesServerAllowlist(name, allowlist) {
				filtered = append(filtered, name)
			}
		}
		servers = filtered
	}

	sort.Strings(servers)
	return servers, nil
}

// SetExitEmptyOff sets the server-scoped `exit-empty off` option on the named
// tmux server so the server is NOT reaped when its session count momentarily
// reaches zero. tmux's default is `exit-empty on`, which destroys the whole
// server (taking live agent sessions with it) the instant the last session
// closes — a Constitution VI violation. The embedded tmux.conf only reaches
// run-kit-CREATED servers via `-f`; this imperative set covers every server
// run-kit touches, including hand-created/foreign ones that never loaded our
// config. It is the backstop for the brief restart/reconnect window where the
// `_rk-ctl` anchor floor is momentarily absent (see tmuxctl.productionDial,
// which calls this BEFORE creating the anchor on every dial/reconnect).
//
// Server-scoped (`-g`) and idempotent — safe to re-run on every dial. Mirrors
// the existing tmuxExecServer/serverArgs exec pattern (no shell strings,
// ctx-scoped with TmuxTimeout). Change: 260602-a1wo-prevent-exit-empty-server-death.
func SetExitEmptyOff(ctx context.Context, server string) error {
	ctx, cancel := context.WithTimeout(ctx, TmuxTimeout)
	defer cancel()

	_, err := tmuxExecServer(ctx, server, "set-option", "-g", "exit-empty", "off")
	return err
}

// serverGoneText holds the tmux stderr fragments that mean the server's socket
// is gone — killed, never started, or otherwise unreachable. tmux uses several
// phrasings: a killed server reports "no server running on <path>", a socket
// that never existed reports "error connecting to <path> (No such file or
// directory)", and "failed to connect" is the older/alternate phrasing. This is
// the single definition of the bare dead-server sentinel set shared with the
// tmuxctl layer (Constitution III): tmuxctl.matchesServerDeadText delegates here
// via IsServerGone. Note: other tmux-package sites (e.g. ListKeys, KillServer,
// board enumeration) intentionally pair these phrasings with "invalid option"/
// "unknown option" for a distinct "absent-option-OR-dead" check and are out of
// scope here.
var serverGoneText = []string{
	"no server running",
	"failed to connect",
	"No such file or directory",
}

// IsServerGone reports whether err indicates the tmux server's socket is gone —
// killed, never started, or otherwise unreachable. Matches tmux's stderr for a
// missing/dead socket across the known phrasings. A nil error returns false.
func IsServerGone(err error) bool {
	if err == nil {
		return false
	}
	return containsServerGoneText(err.Error())
}

// containsServerGoneText reports whether s contains any dead-server sentinel
// substring. Accepts a raw string so callers holding stderr/error text (not an
// error value) can share the same sentinel set.
func containsServerGoneText(s string) bool {
	for _, frag := range serverGoneText {
		if strings.Contains(s, frag) {
			return true
		}
	}
	return false
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

// GetServerRank reads this server's user-defined display rank from the
// server-scoped user option @rk_server_rank.
//
// Returns (nil, nil) when the option is unset. "Unset" is detected by tmux's
// stderr ("invalid option"/"unknown option") OR by the "no server running" /
// "failed to connect" socket-not-found cases — all normal operational states
// (fresh server, no rank ever set) that must NOT bubble as errors, exactly
// mirroring GetSessionOrder's taxonomy.
//
// Other subprocess failures AND a malformed (non-integer) stored value
// propagate as wrapped errors so callers can distinguish real failure.
func GetServerRank(ctx context.Context, server string) (*int, error) {
	ctx, cancel := context.WithTimeout(ctx, TmuxTimeout)
	defer cancel()

	out, err := tmuxExecRawServer(ctx, server, "show-option", "-sv", ServerRankOption)
	if err != nil {
		errMsg := err.Error()
		// Unset user-option ("invalid/unknown option") OR a dead/absent server
		// socket (IsServerGone: "no server running" / "failed to connect" /
		// "No such file or directory") are all normal first-use states, not
		// errors. IsServerGone is the shared dead-server sentinel (Constitution
		// III), covering the socket-file-missing case that a bare
		// "failed to connect" substring check would miss.
		if strings.Contains(errMsg, "invalid option") ||
			strings.Contains(errMsg, "unknown option") ||
			IsServerGone(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("read %s: %w", ServerRankOption, err)
	}
	raw := strings.TrimSpace(out)
	if raw == "" {
		return nil, nil
	}
	rank, cerr := strconv.Atoi(raw)
	if cerr != nil {
		return nil, fmt.Errorf("decode %s: %w", ServerRankOption, cerr)
	}
	return &rank, nil
}

// SetServerRank writes this server's display rank to the server-scoped user
// option @rk_server_rank as a decimal integer string. Mirrors SetSessionOrder.
func SetServerRank(ctx context.Context, server string, rank int) error {
	ctx, cancel := context.WithTimeout(ctx, TmuxTimeout)
	defer cancel()

	_, err := tmuxExecRawServer(ctx, server, "set-option", "-s", ServerRankOption, strconv.Itoa(rank))
	return err
}
