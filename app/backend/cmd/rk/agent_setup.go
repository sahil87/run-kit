package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
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

// rkHookMarker is the LEGACY substring that identifies an rk-owned hook command:
// the pre-indirection self-contained one-liner inlined `tmux set-option … @rk_agent_state`,
// so the option name appearing in a command string was the "this entry is ours"
// signal. It IS the option name — one source of truth per binary (A-021), the
// canonical convention string lives in internal/tmux, not re-declared here.
//
// The NEW-generation command (agentStateHookCommand below) delegates to
// `rk agent-hook` and no longer contains the option name, so it is instead
// identified by rkHookMarkerAgentHook. isRkEntry matches EITHER marker so a
// re-run of `rk agent-setup` on the new binary strips old-generation entries and
// replaces them in place, and `--uninstall` removes both generations.
const rkHookMarker = tmux.AgentStateOption

// rkHookMarkerAgentHook identifies the new-generation delegating hook command by
// its ` agent-hook ` invocation substring. The surrounding spaces keep it from
// matching an unrelated token that merely contains "agent-hook".
const rkHookMarkerAgentHook = " agent-hook "

// agentStateHookCommand builds the STABLE delegating hook command for a given
// state: a thin wrapper that invokes `rk agent-hook`, keeping all logic in the
// binary so hook behavior tracks `brew upgrade rk` with no settings churn and no
// agent session restarts. The former self-contained one-liner (which inlined the
// comm-validated ancestor walk and the `tmux set-option`) was frozen twice — once
// in ~/.claude/settings.json at install time, once in the harness's session-start
// snapshot — so a hook fix shipped in the binary reached zero running agents until
// every session was restarted (the #320↔#321 skew). Delegating to the binary
// lifts that freeze.
//
//	sh -c '[ -n "$TMUX_PANE" ] || exit 0; "<abs-rk>" agent-hook --agent <comm> <state> 2>/dev/null || true'
//
// The $TMUX_PANE guard stays in the wrapper as a cheap short-circuit (no binary
// spawn outside tmux). `|| true` preserves the never-fail contract even if the
// binary is missing or moved. rkPath is the absolute rk path resolved at install
// time (a stable symlink, never the version-pinned Cellar path — see
// resolveRkPath); it is embedded double-quoted INSIDE the single-quoted sh -c
// body, so a path containing any of ' " $ ` \ would break out of (or be
// reinterpreted within) that quoting. state and comm are fixed registry literals
// (never user input); rkPath is machine-derived and MUST be pre-validated by
// validateHookPath (the install flow rejects shell-active characters rather than
// attempting escaping), which together close the interpolation surface
// (Constitution §I).
func agentStateHookCommand(rkPath, state, comm string) string {
	return fmt.Sprintf(
		`sh -c '[ -n "$TMUX_PANE" ] || exit 0; "%s" agent-hook --agent %s %s 2>/dev/null || true'`,
		rkPath, comm, state,
	)
}

// resolveRkPath returns the absolute path to embed in the installed hook. It
// prefers exec.LookPath("run-kit") — the canonical command name — then
// exec.LookPath("rk") (the permanent short alias); on a Homebrew machine either
// yields the STABLE symlink (/home/linuxbrew/.linuxbrew/bin/run-kit or
// /opt/homebrew/bin/run-kit, and likewise for rk), NOT the version-pinned Cellar
// path. Both stable symlinks resolve to the same binary, so the order is a
// canonical-identity preference, not a correctness one. It falls back to
// os.Executable() WITHOUT resolving symlinks. Symlink resolution is deliberately
// avoided: it would pin the Cellar version and re-freeze the hook (the exact
// failure this change removes). On total resolution failure it returns "" so
// validateHookPath fails the install fast with a clear error: a bare-name
// fallback would reintroduce the PATH dependency the absolute path exists to
// eliminate, and writing a PATH-dependent hook that silently no-ops when the
// binary is off PATH at fire time is worse than a loud install-time failure the
// (interactive) user can act on.
func resolveRkPath() string {
	for _, name := range []string{"run-kit", "rk"} {
		if p, err := exec.LookPath(name); err == nil {
			if abs, err := filepath.Abs(p); err == nil {
				return abs
			}
			return p
		}
	}
	if p, err := os.Executable(); err == nil {
		// Intentionally NOT filepath.EvalSymlinks(p): that would pin the Cellar path.
		return p
	}
	return ""
}

// hookUnsafePathChars are the characters that must not appear in the rk path
// embedded in the hook command: the path sits inside a double-quoted region of a
// single-quoted `sh -c` string, so a single quote terminates the outer string
// and " $ ` \ are shell-active inside the double quotes.
const hookUnsafePathChars = "'\"$`\\"

// validateHookPath rejects a resolved rk path that cannot be embedded verbatim
// in the hook command as a STABLE, PATH-independent absolute path. It rejects
// three classes: (1) empty — resolveRkPath returning "" means total resolution
// failure, so there is no path to embed; (2) non-absolute (including a bare "rk")
// — the stable-hook design embeds an absolute path precisely to avoid the PATH
// dependency at hook-fire time, so a relative path defeats the whole change; and
// (3) shell-unsafe characters — the path sits inside a double-quoted region of a
// single-quoted sh -c string, so any of ' " $ ` \ would break the quoting.
// Rejection (a clear install-time error) is chosen over escaping or a silent
// fallback: escaping would have to survive three nested quoting layers
// (shell-in-shell-in-JSON — fragile to get right and to review), and such paths
// do not occur under Homebrew or any conventional install layout. agent-setup is
// interactive, so the user is present to see the error and act on it.
func validateHookPath(path string) error {
	if path == "" {
		return fmt.Errorf("could not resolve the run-kit binary path; install run-kit on PATH (or at a conventional Homebrew location) and re-run")
	}
	if !filepath.IsAbs(path) {
		return fmt.Errorf("resolved run-kit path %q is not absolute; the hook must embed an absolute path to be PATH-independent at fire time — install run-kit at a conventional path and re-run", path)
	}
	if strings.ContainsAny(path, hookUnsafePathChars) {
		return fmt.Errorf("resolved run-kit path %q contains a shell-unsafe character (one of %s) and cannot be embedded in the hook command; install run-kit at a conventional path and re-run", path, hookUnsafePathChars)
	}
	return nil
}

// agentHook is one hook entry in an agent's event mapping: which harness event,
// an optional matcher (empty = no matcher), and the fixed state the command
// writes.
type agentHook struct {
	event   string // e.g. "UserPromptSubmit", "PreToolUse", "Notification", "Stop", "SessionStart"
	matcher string // optional; empty means the entry carries no "matcher" key
	// state is the positional token the installed wrapper passes to `rk
	// agent-hook`: one of agentStateActive|Waiting|Idle (writes @rk_agent_state,
	// and also stamps @rk_chat when the hook stdin carries a session id) or
	// agentHookStampToken (writes @rk_chat ONLY — the SessionStart row).
	state string
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
				// SessionStart stamps @rk_chat only (token "stamp" — see
				// agentHookStampToken): the pane→session mapping appears within
				// seconds of session start, before any prompt, and re-stamps on
				// every session-id rotation (SessionStart fires on startup/resume/
				// clear/compact). It writes NO agent-state because source=compact
				// fires mid-turn, where an idle write would clobber a live active.
				{event: "SessionStart", state: agentHookStampToken},
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

	// Resolve the absolute rk path ONCE per invocation — it is install-host-stable
	// within a single run, and resolving once keeps every installed hook entry
	// consistent. Only the install path needs it; uninstall passes "". The path is
	// validated before any merge: a shell-unsafe path must fail the install with a
	// clear error, never be embedded (see validateHookPath).
	rkPath := ""
	if !uninstall {
		rkPath = resolveRkPath()
		if err := validateHookPath(rkPath); err != nil {
			return err
		}
	}

	reader := bufio.NewReader(in)
	for _, ac := range agentRegistry(home) {
		if err := applyAgentConfig(out, reader, ac, rkPath, uninstall); err != nil {
			return err
		}
	}
	return nil
}

// applyAgentConfig reads one agent's settings file, computes the merged (or
// unmerged) result, prints a diff, and — on confirmation — writes it back. A
// no-op (result identical to current) is reported and skipped without prompting.
func applyAgentConfig(out io.Writer, reader *bufio.Reader, ac agentConfig, rkPath string, uninstall bool) error {
	current, err := readSettings(ac.settingsPath)
	if err != nil {
		return fmt.Errorf("%s: read %s: %w", ac.name, ac.settingsPath, err)
	}

	next := cloneJSONMap(current)
	if uninstall {
		unmergeHooks(next)
	} else {
		mergeHooks(next, ac.hooks, rkPath, ac.comm)
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
	fmt.Fprintf(out, "%s: will %s run-kit agent-state hooks in %s\n\n", ac.name, action, ac.settingsPath)
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
func mergeHooks(settings map[string]any, hooks []agentHook, rkPath, comm string) {
	hooksRoot := asMap(settings["hooks"])
	if hooksRoot == nil {
		hooksRoot = map[string]any{}
	}

	// Strip every existing rk entry from each touched event array FIRST, once —
	// an event may carry more than one rk hook (e.g. Notification maps to both a
	// waiting and an idle entry), so removing per-hook would drop entries added
	// earlier in this same pass. removeRkEntries matches BOTH generations, so a
	// re-run over old-generation entries replaces them in place. Non-rk entries
	// are untouched.
	touched := make(map[string]bool)
	for _, h := range hooks {
		if !touched[h.event] {
			hooksRoot[h.event] = removeRkEntries(asSlice(hooksRoot[h.event]))
			touched[h.event] = true
		}
	}

	// Now append the fresh rk entries.
	for _, h := range hooks {
		hooksRoot[h.event] = append(asSlice(hooksRoot[h.event]), rkHookEntry(h, rkPath, comm))
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
func rkHookEntry(h agentHook, rkPath, comm string) map[string]any {
	entry := map[string]any{
		"hooks": []any{
			map[string]any{
				"type":    "command",
				"command": agentStateHookCommand(rkPath, h.state, comm),
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

// isRkEntry reports whether a hook-entry object is rk-owned. It matches BOTH
// generations of the hook command: the LEGACY self-contained one-liner (which
// inlined the @rk_agent_state option name → rkHookMarker) and the NEW delegating
// one-liner (which invokes `rk agent-hook` → rkHookMarkerAgentHook and no longer
// contains the option name). Matching both is what lets `rk agent-setup` on the
// new binary strip old-generation entries and replace them in place, and lets
// `--uninstall` remove both generations. Non-rk hooks carry neither marker and
// are preserved untouched.
func isRkEntry(entry map[string]any) bool {
	if entry == nil {
		return false
	}
	for _, hv := range asSlice(entry["hooks"]) {
		handler := asMap(hv)
		if handler == nil {
			continue
		}
		cmd, ok := handler["command"].(string)
		if !ok {
			continue
		}
		if strings.Contains(cmd, rkHookMarker) || strings.Contains(cmd, rkHookMarkerAgentHook) {
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
