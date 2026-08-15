package tmux

import (
	"context"
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"rk/internal/validate"
)

// pane_target.go — the pane-level primitives the `rk mux` pane-scoped verbs
// (send/await/capture/kill/process) need: strict target-form parsing,
// single-pane agent-state and fact reads (the same parse + pid-liveness
// reconcile the sessions path applies), pane liveness, raw key-name sends, and
// window→agent-pane resolution. Every subprocess runs under the CALLER's
// context via the tmuxExec* helpers (exec.CommandContext argv slices —
// Constitution §I).

// paneIDPattern matches tmux pane IDs: %N.
var paneIDPattern = regexp.MustCompile(`^%[0-9]+$`)

// ValidPaneID reports whether id is a well-formed tmux pane ID (%N).
func ValidPaneID(id string) bool {
	return paneIDPattern.MatchString(id)
}

// PaneTarget is a parsed mux-verb target: exactly one field is set. PaneID is
// a direct pane target (%N); WindowTarget is a window form (@N or
// =session:window) the caller resolves to the window's agent pane via
// ResolveAgentPane.
type PaneTarget struct {
	PaneID       string
	WindowTarget string
}

// ParsePaneTarget parses a mux-verb target, accepting EXACTLY three forms —
// pane ID (%N), window ID (@N), and exact session:window (=session:window) —
// and rejecting everything else. Bare session:window names are rejected on
// purpose: tmux's target grammar resolves a bare name against window names
// before session names, so a window named like a session hijacks the target
// (the documented ExactSessionTarget footgun) — the `=` prefix forces
// exact-match parsing. The returned WindowTarget for the `=` form is passed to
// tmux verbatim (the leading `=` disables prefix/fnmatch matching).
func ParsePaneTarget(s string) (PaneTarget, error) {
	switch {
	case ValidPaneID(s):
		return PaneTarget{PaneID: s}, nil
	case ValidWindowID(s):
		return PaneTarget{WindowTarget: s}, nil
	case strings.HasPrefix(s, "="):
		rest := s[1:]
		i := strings.IndexByte(rest, ':')
		if i <= 0 || i == len(rest)-1 {
			return PaneTarget{}, badPaneTarget(s)
		}
		session, window := rest[:i], rest[i+1:]
		if errMsg := validate.ValidateName(session, "Session name"); errMsg != "" {
			return PaneTarget{}, badPaneTarget(s)
		}
		// The window part may be a name or a numeric index; a second colon
		// would make the target ambiguous (session:window:pane grammar), so
		// reject it.
		if strings.ContainsAny(window, ": \t") {
			return PaneTarget{}, badPaneTarget(s)
		}
		return PaneTarget{WindowTarget: s}, nil
	default:
		return PaneTarget{}, badPaneTarget(s)
	}
}

func badPaneTarget(s string) error {
	return fmt.Errorf("invalid target %q: want a pane ID (%%N), a window ID (@N), or an exact session:window (=session:window)", s)
}

// PaneAgentState reads ONE pane's reconciled @rk_agent_state on the given
// server: the raw value is parsed via parseAgentState and then reconciled
// exactly as the sessions path (parsePanes) does — a pid-carrying value is
// trusted iff the agent process is alive (kill-0 liveness); a legacy
// two-segment value falls back to the shell-command heuristic (a plain-shell
// pane has no agent). Returns "" (unknown) for an absent, unparseable, or
// reconciled-away value — never partial trust. A tmux failure (e.g. the pane
// does not exist) is returned as the error.
func PaneAgentState(ctx context.Context, paneID, server string) (string, error) {
	facts, err := PaneFactsCtx(ctx, paneID, server)
	return facts.AgentState, err
}

// PaneFacts is a single pane's substrate fact bundle, read in one
// display-message round trip by PaneFactsCtx. AgentState/AgentStateEpoch/
// AgentPID carry the reconciled @rk_agent_state read (AgentState "" = unknown:
// absent, unparseable, or reconciled away); AgentPID is the live agent pid a
// 3-segment value carried (0 when the value carried none — the pid is never
// reported for a reconciled-away state).
type PaneFacts struct {
	CWD             string
	AgentState      string
	AgentStateEpoch int64
	AgentPID        int
}

// PaneFactsCtx reads ONE pane's substrate facts on the given server in a single
// display-message round trip: the pane cwd (#{pane_current_path}) plus the
// reconciled @rk_agent_state (the same parse + pid-liveness/shell-command
// reconcile the sessions path applies — shared with PaneAgentState, which this
// superset read backs). A tmux failure (e.g. the pane does not exist) is
// returned as the error.
func PaneFactsCtx(ctx context.Context, paneID, server string) (PaneFacts, error) {
	raw, err := tmuxExecRawServer(ctx, server, "display-message", "-pt", paneID,
		"#{pane_current_path}\t#{pane_current_command}\t#{@rk_agent_state}")
	if err != nil {
		return PaneFacts{}, err
	}
	return parsePaneFacts(raw), nil
}

// parsePaneFacts parses the cwd\tcommand\t@rk_agent_state triple read by
// PaneFactsCtx. Only the trailing newline is trimmed before the split —
// TrimSpace would eat the tabs delimiting an empty first or last field and
// shift the remaining fields into the wrong slots.
func parsePaneFacts(raw string) PaneFacts {
	var facts PaneFacts
	parts := strings.SplitN(strings.TrimRight(raw, "\r\n"), "\t", 3)
	facts.CWD = parts[0]
	command, stateRaw := "", ""
	if len(parts) >= 2 {
		command = parts[1]
	}
	if len(parts) == 3 {
		stateRaw = parts[2]
	}
	state, epoch, pid := parseAgentState(stateRaw)
	if state == "" {
		return facts
	}
	// The same reconcile the sessions path applies (parsePanes) — one shared
	// decision, never a divergent copy.
	if agentStateStale(pid, command) {
		return facts
	}
	facts.AgentState, facts.AgentStateEpoch, facts.AgentPID = state, epoch, pid
	return facts
}

// PanePIDCtx reads the pane's shell PID (#{pane_pid}) on the given server,
// bounded by the caller's context — the process-tree root `rk mux process`
// walks from.
func PanePIDCtx(ctx context.Context, paneID, server string) (int, error) {
	raw, err := tmuxExecRawServer(ctx, server, "display-message", "-pt", paneID, "#{pane_pid}")
	if err != nil {
		return 0, err
	}
	pid, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil {
		return 0, fmt.Errorf("parsing pane_pid %q: %w", strings.TrimSpace(raw), err)
	}
	return pid, nil
}

// PaneExists reports whether the given pane ID is live on the server. A tmux
// "can't find pane" diagnostic is the false case; any other failure is a real
// error (dead server, malformed target).
func PaneExists(ctx context.Context, paneID, server string) (bool, error) {
	_, err := tmuxExecRawServer(ctx, server, "display-message", "-pt", paneID, "#{pane_id}")
	if err != nil {
		if strings.Contains(err.Error(), "can't find pane") {
			return false, nil
		}
		return false, err
	}
	return true, nil
}

// SendKeysToPane sends raw tmux KEY NAMES (Enter, Up, C-c, …) to the target
// pane — no literal flag, no bracketed paste: this is the key-name arm for
// callers that mean keys, not text. Bounded by the caller's context.
func SendKeysToPane(ctx context.Context, paneID, server string, keys ...string) error {
	args := append([]string{"send-keys", "-t", paneID}, keys...)
	_, err := tmuxExecServer(ctx, server, args...)
	return err
}

// ResolveAgentPane resolves a WINDOW target (@N or =session:window) to the
// window's agent pane: the pane carrying a known (post-reconcile)
// @rk_agent_state, preferring the active pane when several qualify and falling
// back to the window's active pane when none does (the resolveWindowChat
// precedent — a window target must route to the agent pane, not whatever split
// happens to be active). An unknown window target is a tmux error.
func ResolveAgentPane(ctx context.Context, windowTarget, server string) (string, error) {
	lines, err := tmuxExecServer(ctx, server, "list-panes", "-t", windowTarget, "-F", paneFormat)
	if err != nil {
		return "", err
	}
	var panes []PaneInfo
	for _, p := range parsePanes(lines) {
		panes = p // exactly one window's worth
		break
	}
	if len(panes) == 0 {
		return "", fmt.Errorf("no panes found for window target %q", windowTarget)
	}
	return SelectAgentPane(panes), nil
}

// SelectAgentPane is the pure selection rule behind ResolveAgentPane: the
// active pane when it carries a known agent state, else the first
// state-carrying pane, else the active pane (the agent-pane fallback), else
// the first pane. Returns "" for an empty pane list.
func SelectAgentPane(panes []PaneInfo) string {
	var activeID, firstStateID string
	for _, p := range panes {
		if p.IsActive {
			activeID = p.PaneID
			if p.AgentState != "" {
				return p.PaneID
			}
		}
		if firstStateID == "" && p.AgentState != "" {
			firstStateID = p.PaneID
		}
	}
	if firstStateID != "" {
		return firstStateID
	}
	if activeID != "" {
		return activeID
	}
	return panes[0].PaneID
}
