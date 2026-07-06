package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"rk/internal/tmux"

	"github.com/spf13/cobra"
)

// rk agent-setup — install the generic agent-state hooks that write the
// @rk_agent_state pane user option (see docs/specs/agent-state.md). It registers
// hook commands in a user-global agent config so any session of that agent, in
// any directory, under any workflow, reports lifecycle state. v1 targets Claude
// Code (~/.claude/settings.json); the per-agent registry makes codex/copilot/
// gemini/opencode additive follow-ups.
//
// The install is a JSON merge that preserves existing (non-rk) hooks and all
// other config, is idempotent (re-run replaces rk-owned entries in place, never
// duplicates), shows a diff and asks for confirmation before writing (it mutates
// user-global config), and supports --uninstall to remove exactly the rk-owned
// entries. All file writes go through Go; the hook command is a fixed literal per
// state with nothing user-provided interpolated (Constitution §I).

// rkHookMarker is the substring that identifies an rk-owned hook command inside
// an agent config. Every rk hook writes the @rk_agent_state pane option, so its
// presence in a command string is the unambiguous "this entry is ours" signal
// used for idempotent replace + surgical uninstall — non-rk hooks never carry it.
// It IS the option name: one source of truth per binary (A-021) — the canonical
// convention string lives in internal/tmux, not re-declared here.
const rkHookMarker = tmux.AgentStateOption

// agentStateHookCommand builds the fixed, self-contained hook command for a
// given state. It is a no-op outside tmux, never fails the agent, and writes the
// pane option via plain tmux with no rk/server dependency at hook-fire time. The
// state and comm are fixed registry literals (never user input), so there is no
// injection surface (Constitution §I).
//
// The pid segment is resolved by a bounded, comm-validated ancestor walk (up to
// 3 hops from $PPID) rather than raw $PPID: harnesses spawn hook commands
// through an EPHEMERAL intermediate shell that exits the moment the hook
// finishes (measured with Claude Code — a raw $PPID recorded that dead wrapper,
// so the reader's liveness check suppressed every value). The walk climbs until
// the process name equals the agent's comm (e.g. "claude"), which is the pid
// the PID-liveness reconciler actually needs. If the walk cannot validate an
// ancestor, the pid segment is omitted — a two-segment value that degrades to
// the reader's legacy shell-name fallback, never a wrong pid.
func agentStateHookCommand(state, comm string) string {
	return fmt.Sprintf(
		`sh -c '[ -n "$TMUX_PANE" ] || exit 0; p=$PPID; i=0; while [ $i -lt 3 ] && [ -n "$p" ] && [ "$(ps -o comm= -p "$p" 2>/dev/null)" != "%s" ]; do p=$(ps -o ppid= -p "$p" 2>/dev/null | tr -d " "); i=$((i+1)); done; [ "$(ps -o comm= -p "$p" 2>/dev/null)" = "%s" ] || p=""; tmux set-option -pt "$TMUX_PANE" %s "%s:$(date +%%s)${p:+:$p}" 2>/dev/null || true'`,
		comm, comm, rkHookMarker, state,
	)
}

// agentHook is one hook entry in an agent's event mapping: which harness event,
// an optional matcher (empty = no matcher), and the fixed state the command
// writes.
type agentHook struct {
	event   string // e.g. "UserPromptSubmit", "PreToolUse", "Notification", "Stop"
	matcher string // optional; empty means the entry carries no "matcher" key
	state   string // agentStateActive | agentStateWaiting | agentStateIdle
}

// agentConfig is one agent's install target: a display name, the user-global
// settings file to merge into, the agent process's comm name (for the hook's
// pid-resolution walk), and the ordered event→state hook mapping.
type agentConfig struct {
	name         string
	settingsPath string
	comm         string // process name of the agent binary, e.g. "claude"
	hooks        []agentHook
}

// The three agent states are the canonical tokens from internal/tmux — imported,
// not re-declared, so the cross-repo @rk_agent_state convention has ONE source of
// truth per binary (A-021).
const (
	agentStateActive  = tmux.AgentStateActive
	agentStateWaiting = tmux.AgentStateWaiting
	agentStateIdle    = tmux.AgentStateIdle
)

// claudeSettingsRelPath is the user-global Claude Code settings file, relative to
// the home dir.
var claudeSettingsRelPath = filepath.Join(".claude", "settings.json")

// agentRegistry returns the per-agent install registry. v1: Claude Code only.
// The event mapping matches docs/specs/agent-state.md § Claude Code.
func agentRegistry(home string) []agentConfig {
	return []agentConfig{
		{
			name:         "Claude Code",
			settingsPath: filepath.Join(home, claudeSettingsRelPath),
			comm:         "claude",
			hooks: []agentHook{
				{event: "UserPromptSubmit", state: agentStateActive},
				{event: "PreToolUse", state: agentStateActive},
				{event: "Notification", matcher: "permission_prompt|elicitation_dialog|agent_needs_input", state: agentStateWaiting},
				{event: "Notification", matcher: "idle_prompt", state: agentStateIdle},
				{event: "Stop", state: agentStateIdle},
			},
		},
	}
}

var agentSetupUninstall bool

var agentSetupCmd = &cobra.Command{
	Use:   "agent-setup",
	Short: "Install agent-harness hooks that report agent state to run-kit",
	Long: "Install (or --uninstall) the hooks that write the @rk_agent_state tmux " +
		"pane option so run-kit can show any agent's active/waiting/idle state. " +
		"v1 targets Claude Code (~/.claude/settings.json). The install is a JSON " +
		"merge: existing hooks are preserved, re-running is idempotent, and a diff " +
		"is shown for confirmation before anything is written.",
	Args:         cobra.NoArgs,
	SilenceUsage: true,
	RunE: func(cmd *cobra.Command, args []string) error {
		return runAgentSetup(cmd.OutOrStdout(), cmd.InOrStdin(), agentSetupUninstall)
	},
}

func init() {
	agentSetupCmd.Flags().BoolVar(&agentSetupUninstall, "uninstall", false, "Remove the rk-owned hook entries instead of installing them")
}

// runAgentSetup applies the install/uninstall to every agent in the registry,
// showing a diff and prompting for confirmation before each write. It is split
// from the cobra RunE with explicit io.Writer/io.Reader so it is testable without
// a TTY.
func runAgentSetup(out io.Writer, in io.Reader, uninstall bool) error {
	home, err := os.UserHomeDir()
	if err != nil {
		return fmt.Errorf("could not determine home directory: %w", err)
	}

	reader := bufio.NewReader(in)
	for _, ac := range agentRegistry(home) {
		if err := applyAgentConfig(out, reader, ac, uninstall); err != nil {
			return err
		}
	}
	return nil
}

// applyAgentConfig reads one agent's settings file, computes the merged (or
// unmerged) result, prints a diff, and — on confirmation — writes it back. A
// no-op (result identical to current) is reported and skipped without prompting.
func applyAgentConfig(out io.Writer, reader *bufio.Reader, ac agentConfig, uninstall bool) error {
	current, err := readSettings(ac.settingsPath)
	if err != nil {
		return fmt.Errorf("%s: read %s: %w", ac.name, ac.settingsPath, err)
	}

	next := cloneJSONMap(current)
	if uninstall {
		unmergeHooks(next)
	} else {
		mergeHooks(next, ac.hooks, ac.comm)
	}

	beforeJSON := mustMarshalIndent(current)
	afterJSON := mustMarshalIndent(next)
	if beforeJSON == afterJSON {
		verb := "installed"
		if uninstall {
			verb = "absent"
		}
		fmt.Fprintf(out, "%s: hooks already %s in %s — nothing to do.\n", ac.name, verb, ac.settingsPath)
		return nil
	}

	action := "install"
	if uninstall {
		action = "uninstall"
	}
	fmt.Fprintf(out, "%s: will %s rk agent-state hooks in %s\n\n", ac.name, action, ac.settingsPath)
	fmt.Fprintln(out, "--- current")
	fmt.Fprintln(out, beforeJSON)
	fmt.Fprintln(out, "+++ proposed")
	fmt.Fprintln(out, afterJSON)
	fmt.Fprint(out, "\nWrite these changes? [y/N] ")

	if !confirm(reader) {
		fmt.Fprintf(out, "%s: skipped (no changes written).\n", ac.name)
		return nil
	}

	if err := writeSettings(ac.settingsPath, next); err != nil {
		return fmt.Errorf("%s: write %s: %w", ac.name, ac.settingsPath, err)
	}
	fmt.Fprintf(out, "%s: wrote %s.\n", ac.name, ac.settingsPath)
	return nil
}

// confirm reads a single line and returns true only for an explicit yes
// (y/yes, case-insensitive). Default (empty / anything else) is No — the
// conventional destructive-write default.
func confirm(reader *bufio.Reader) bool {
	line, _ := reader.ReadString('\n')
	switch strings.ToLower(strings.TrimSpace(line)) {
	case "y", "yes":
		return true
	default:
		return false
	}
}

// readSettings loads a JSON settings file into a generic map. A missing, empty,
// or all-whitespace file is treated tolerantly as an empty object (never an
// error) — install must work on a fresh machine with no settings.json yet. A
// genuinely malformed (non-empty, non-JSON) file IS surfaced as an error so we
// never silently clobber a file we failed to understand.
func readSettings(path string) (map[string]any, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return map[string]any{}, nil
		}
		return nil, err
	}
	if len(strings.TrimSpace(string(data))) == 0 {
		return map[string]any{}, nil
	}
	var m map[string]any
	if err := json.Unmarshal(data, &m); err != nil {
		return nil, fmt.Errorf("existing settings is not valid JSON: %w", err)
	}
	if m == nil {
		m = map[string]any{}
	}
	return m, nil
}

// writeSettings writes the settings map as indented JSON, creating the parent
// directory if needed. Mode 0600 matches the sensitivity of user agent config.
func writeSettings(path string, m map[string]any) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("creating config directory: %w", err)
	}
	data, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')
	return os.WriteFile(path, data, 0o600)
}

// mergeHooks installs the given hook entries under settings["hooks"], preserving
// every non-rk entry. It is idempotent: for each (event, matcher) it first
// removes any existing rk-owned entry (identified by rkHookMarker in a command)
// from that event's array, then appends the fresh rk entry — so a re-run
// replaces in place and never duplicates. Non-rk entries and their order are
// preserved. The Claude hooks shape is:
//
//	hooks → <Event> → [ { matcher?, hooks: [ {type:"command", command} ] } ]
func mergeHooks(settings map[string]any, hooks []agentHook, comm string) {
	hooksRoot := asMap(settings["hooks"])
	if hooksRoot == nil {
		hooksRoot = map[string]any{}
	}

	// Strip every existing rk entry from each touched event array FIRST, once —
	// an event may carry more than one rk hook (e.g. Notification maps to both a
	// waiting and an idle entry), so removing per-hook would drop entries added
	// earlier in this same pass. Non-rk entries are untouched.
	touched := make(map[string]bool)
	for _, h := range hooks {
		if !touched[h.event] {
			hooksRoot[h.event] = removeRkEntries(asSlice(hooksRoot[h.event]))
			touched[h.event] = true
		}
	}

	// Now append the fresh rk entries.
	for _, h := range hooks {
		hooksRoot[h.event] = append(asSlice(hooksRoot[h.event]), rkHookEntry(h, comm))
	}

	settings["hooks"] = hooksRoot
}

// unmergeHooks removes exactly the rk-owned hook entries from every event array,
// leaving non-rk entries and all other config untouched. An event array that
// becomes empty is deleted; a "hooks" object that becomes empty is deleted.
func unmergeHooks(settings map[string]any) {
	hooksRoot := asMap(settings["hooks"])
	if hooksRoot == nil {
		return
	}
	for event, v := range hooksRoot {
		arr := removeRkEntries(asSlice(v))
		if len(arr) == 0 {
			delete(hooksRoot, event)
		} else {
			hooksRoot[event] = arr
		}
	}
	if len(hooksRoot) == 0 {
		delete(settings, "hooks")
	} else {
		settings["hooks"] = hooksRoot
	}
}

// rkHookEntry builds the Claude hook-entry object for one agentHook: an optional
// matcher plus a single command handler.
func rkHookEntry(h agentHook, comm string) map[string]any {
	entry := map[string]any{
		"hooks": []any{
			map[string]any{
				"type":    "command",
				"command": agentStateHookCommand(h.state, comm),
			},
		},
	}
	if h.matcher != "" {
		entry["matcher"] = h.matcher
	}
	return entry
}

// removeRkEntries returns arr with every rk-owned entry removed. An entry is
// rk-owned if any of its command handlers carries the rkHookMarker. Non-rk
// entries keep their relative order.
func removeRkEntries(arr []any) []any {
	if len(arr) == 0 {
		return arr
	}
	out := make([]any, 0, len(arr))
	for _, e := range arr {
		if isRkEntry(asMap(e)) {
			continue
		}
		out = append(out, e)
	}
	return out
}

// isRkEntry reports whether a hook-entry object is rk-owned — i.e. one of its
// nested command handlers contains the rkHookMarker.
func isRkEntry(entry map[string]any) bool {
	if entry == nil {
		return false
	}
	for _, hv := range asSlice(entry["hooks"]) {
		handler := asMap(hv)
		if handler == nil {
			continue
		}
		if cmd, ok := handler["command"].(string); ok && strings.Contains(cmd, rkHookMarker) {
			return true
		}
	}
	return false
}

// --- generic JSON helpers -------------------------------------------------------

// asMap returns v as a map[string]any, or nil if it is not one.
func asMap(v any) map[string]any {
	m, _ := v.(map[string]any)
	return m
}

// asSlice returns v as a []any, or nil if it is not one.
func asSlice(v any) []any {
	s, _ := v.([]any)
	return s
}

// cloneJSONMap deep-copies a JSON-shaped map (objects/arrays/scalars) via a
// marshal round-trip, so mutating the clone never touches the original (used to
// compute the "proposed" side of the diff without disturbing "current").
func cloneJSONMap(m map[string]any) map[string]any {
	data, err := json.Marshal(m)
	if err != nil {
		return map[string]any{}
	}
	var out map[string]any
	if err := json.Unmarshal(data, &out); err != nil || out == nil {
		return map[string]any{}
	}
	return out
}

// mustMarshalIndent renders a settings map as stable, indented JSON for the diff
// (map keys are sorted by encoding/json, so output is deterministic).
func mustMarshalIndent(m map[string]any) string {
	data, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return fmt.Sprintf("<unmarshalable: %v>", err)
	}
	return string(data)
}
