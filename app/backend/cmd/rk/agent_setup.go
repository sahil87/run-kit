package main

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"rk/internal/tmux"

	"github.com/spf13/cobra"
	"golang.org/x/term"
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
//
// Hooks are now the ONLY thing agent-setup installs. It used to write a second
// managed artifact — a user-global "rk-display" SKILL.md that put run-kit's
// visual-display capability into an agent's context — but that context-injection
// responsibility has moved to the `rk skill` bundle (served by the skill
// subcommand, aggregated by the coming `shll agent-setup`). All agent-setup does
// with the legacy skill now is a one-release CLEANUP courtesy: on BOTH the
// install and uninstall passes it offers to remove a stale, marker-owned
// rk-display skill left by an older run-kit (see removeLegacySkill). An absent
// file is silent in both modes — a fresh machine sees zero rk-display output.
// The cleanup path (and agentConfig.skillsDir, which locates the legacy skill)
// is scheduled for removal one release after this change.

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

// The rk-display skill was a SECOND managed artifact rk agent-setup used to
// install — a user-global Claude Code skill that put run-kit's visual-display
// capability into an agent's context. That responsibility has moved to the
// `rk skill` bundle, so agent-setup no longer WRITES this skill; it only cleans a
// stale copy for one release (see removeLegacySkill).
//
// rkDisplaySkillDir / rkDisplaySkillFile are the directory (under an agent's
// skillsDir) and file basename of the legacy skill; skillManagedByMarker is the
// ownership marker embedded in the skill's frontmatter. They are retained solely
// to LOCATE and RECOGNIZE a marker-owned legacy file for removal — scheduled for
// deletion one release after this change.
const (
	rkDisplaySkillDir    = "rk-display"
	rkDisplaySkillFile   = "SKILL.md"
	skillManagedByMarker = "managed-by: rk agent-setup"
)

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
// pid-resolution walk), the ordered event→state hook mapping, and the harness's
// user-global skills directory.
//
// skillsDir locates the LEGACY rk-display skill for one-release cleanup only
// (as {skillsDir}/rk-display/SKILL.md — see removeLegacySkill). agent-setup no
// longer installs any skill; an EMPTY skillsDir means "no legacy skill to clean"
// — only the hooks merge runs for that agent. v1 sets it only for Claude Code.
// This field is scheduled for removal one release after this change.
type agentConfig struct {
	name         string
	settingsPath string
	comm         string // process name of the agent binary, e.g. "claude"
	hooks        []agentHook
	skillsDir    string // user-global skills dir; empty = no skill install
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
			skillsDir:    filepath.Join(home, ".claude", "skills"),
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

var (
	agentSetupUninstall bool
	agentSetupYes       bool
	agentSetupDryRun    bool
)

// consent captures how a write should be authorized for a single agent-setup
// run, reconciling Principle 1 (a warranted confirmation MUST be satisfiable by
// a flag, and a non-TTY invocation MUST refuse — never hang on a prompt no one
// will answer) with Principle 5 (destructive writes MUST support --dry-run):
//   - dryRun: show the diff, write nothing, need no consent (--dry-run wins if
//     both are passed — a preview must never mutate).
//   - yes: skip the interactive prompt and write (non-interactive consent).
//   - neither, stdin is a TTY: fall back to the interactive [y/N] prompt.
//   - neither, stdin is NOT a TTY: refuse with an error naming --yes (a
//     success-looking silent no-op is the agent trap Principle 1 targets;
//     reference impl: shll uninstall).
//
// stdinIsTTY records whether the invocation's stdin is an interactive terminal.
// The zero value is false, so a default consent{} is "no flags, no TTY" — which
// refuses. Production sets it by inspecting the real stdin (see runAgentSetup);
// tests simulating an interactive session set it explicitly.
type consent struct {
	yes        bool
	dryRun     bool
	stdinIsTTY bool
}

// errNonInteractiveConsent is returned when a write is pending, neither --yes
// nor --dry-run was passed, and stdin is not a TTY — the Principle 1 non-TTY
// refusal. It names --yes so the caller (agent) knows how to proceed, and its
// presence guarantees nothing was written.
var errNonInteractiveConsent = errors.New("refusing to write without confirmation: stdin is not a TTY — pass --yes to consent non-interactively, or --dry-run to preview without writing")

// diffWriter selects the channel a pending write's diff renders to, given this
// consent mode (R5). On the --yes path the write is already authorized, so the
// diff is narration → the chatter channel (quiet-gated: `--yes --quiet` is
// silent on success). On the interactive and --dry-run paths the diff is either
// the context for the [y/N] prompt or the explicitly-requested dry-run output →
// the data channel (never gated). --dry-run wins over --yes (a preview is data),
// matching authorizeWrite's precedence.
func (c consent) diffWriter(sink outputSink) io.Writer {
	if c.yes && !c.dryRun {
		return sink.chatter
	}
	return sink.data
}

// authorizeWrite decides whether a pending write proceeds. On --dry-run it
// reports the preview to out and returns (false, nil) (no write); on --yes it
// returns (true, nil) without prompting; on a TTY with neither flag it prints
// promptSuffix and defers to the interactive prompt; with neither flag on a
// non-TTY stdin it refuses, returning (false, errNonInteractiveConsent) so
// nothing is written (Principle 1).
//
// promptSuffix (e.g. "Write these changes? [y/N] ") is emitted ONLY on the
// interactive path — the auto-answered --yes/--dry-run paths never read the
// prompt, so printing "[y/N] " there reads as a hang in an agent's transcript.
func (c consent) authorizeWrite(out io.Writer, reader *bufio.Reader, dryRunNote, promptSuffix string) (bool, error) {
	if c.dryRun {
		fmt.Fprintf(out, "%s\n", dryRunNote)
		return false, nil
	}
	if c.yes {
		return true, nil
	}
	if !c.stdinIsTTY {
		return false, errNonInteractiveConsent
	}
	fmt.Fprint(out, promptSuffix)
	return confirm(reader), nil
}

var agentSetupCmd = &cobra.Command{
	Use:   "agent-setup",
	Short: "Install agent-harness hooks that report agent state to run-kit",
	Long: "Install (or --uninstall) the hooks that write the @rk_agent_state tmux " +
		"pane option so run-kit can show any agent's active/waiting/idle state. " +
		"v1 targets Claude Code (~/.claude/settings.json). The install is a JSON " +
		"merge: existing hooks are preserved, re-running is idempotent, and a diff " +
		"is shown for confirmation before anything is written. Use --yes to write " +
		"without prompting (non-interactive), or --dry-run to preview the diff and " +
		"write nothing.",
	Args:         cobra.NoArgs,
	SilenceUsage: true,
	RunE: func(cmd *cobra.Command, args []string) error {
		in := cmd.InOrStdin()
		return runAgentSetup(newSink(cmd), in, agentSetupUninstall, consent{yes: agentSetupYes, dryRun: agentSetupDryRun, stdinIsTTY: isTerminal(in)})
	},
}

func init() {
	agentSetupCmd.Flags().BoolVar(&agentSetupUninstall, "uninstall", false, "Remove the rk-owned hook entries instead of installing them")
	agentSetupCmd.Flags().BoolVarP(&agentSetupYes, "yes", "y", false, "Write without prompting (non-interactive consent)")
	agentSetupCmd.Flags().BoolVar(&agentSetupDryRun, "dry-run", false, "Show the diff and write nothing (wins over --yes)")
}

// runAgentSetup applies the install/uninstall to every agent in the registry,
// showing a diff and prompting for confirmation before each write. It is split
// from the cobra RunE with an explicit outputSink/io.Reader so it is testable
// without a TTY.
//
// Output convention (Toolkit Principle 9): informational status lines go to the
// sink's chatter channel (dropped by --quiet); the settings diff and the
// interactive consent prompt go to the data channel (never gated — a consent
// prompt without the diff it asks about would be a dark pattern, and a dry-run's
// diff is the requested data). The non-TTY refusal is an error and always
// surfaces regardless of --quiet.
func runAgentSetup(sink outputSink, in io.Reader, uninstall bool, cons consent) error {
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
		if err := applyAgentConfig(sink, reader, ac, rkPath, uninstall, cons); err != nil {
			return err
		}
	}
	return nil
}

// applyAgentConfig applies the hooks merge for one agent and, on BOTH the install
// and uninstall passes, cleans up any stale legacy rk-display skill. The hooks
// merge is the only artifact agent-setup still INSTALLS; the legacy cleanup is a
// one-release courtesy that removes a marker-owned rk-display skill left by an
// older run-kit. Each step is handled independently — its own tolerant read,
// diff/prompt, and no-op report — so declining or no-op-ing one does not skip the
// other. The legacy cleanup is skipped entirely when skillsDir is empty (e.g. a
// future codex/copilot row with no skills convention).
func applyAgentConfig(sink outputSink, reader *bufio.Reader, ac agentConfig, rkPath string, uninstall bool, cons consent) error {
	if err := applyAgentHooks(sink, reader, ac, rkPath, uninstall, cons); err != nil {
		return err
	}
	if ac.skillsDir != "" {
		if err := removeLegacySkill(sink, reader, ac, cons); err != nil {
			return err
		}
	}
	return nil
}

// applyAgentHooks reads one agent's settings file, computes the merged (or
// unmerged) result, prints a diff, and — on confirmation — writes it back. A
// no-op (result identical to current) is reported and skipped without prompting.
func applyAgentHooks(sink outputSink, reader *bufio.Reader, ac agentConfig, rkPath string, uninstall bool, cons consent) error {
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
		// Informational status line — chatter (dropped by --quiet).
		sink.Notef("%s: hooks already %s in %s — nothing to do.\n", ac.name, verb, ac.settingsPath)
		return nil
	}

	action := "install"
	if uninstall {
		action = "uninstall"
	}
	// The diff routes PER CONSENT MODE (R5's net-effect clause: `--yes --quiet`
	// is fully silent on success):
	//   - interactive prompt / --dry-run → data (never gated): the interactive
	//     prompt without the diff it asks about would be a dark pattern, and a
	//     --dry-run diff is the explicitly-requested output.
	//   - --yes → chatter (quiet-gated): the write is already authorized, so the
	//     diff is narration of an action that will happen regardless. `--yes`
	//     non-quiet still shows it on stderr; `--yes --quiet` drops it, leaving
	//     the invocation silent on success.
	// The consent prompt itself (prompt suffix / dry-run note) always goes to the
	// data channel via authorizeWrite.
	header := fmt.Sprintf("%s: will %s run-kit agent-state hooks in %s", ac.name, action, ac.settingsPath)
	renderArtifactDiff(cons.diffWriter(sink), header, beforeJSON, afterJSON)

	dryRunNote := fmt.Sprintf("%s: dry run — no changes written.", ac.name)
	ok, err := cons.authorizeWrite(sink.data, reader, dryRunNote, "\nWrite these changes? [y/N] ")
	if err != nil {
		return err
	}
	if !ok {
		if !cons.dryRun {
			// Status line — chatter.
			sink.Notef("%s: skipped (no changes written).\n", ac.name)
		}
		return nil
	}

	if err := writeSettings(ac.settingsPath, next); err != nil {
		return fmt.Errorf("%s: write %s: %w", ac.name, ac.settingsPath, err)
	}
	// Status line — chatter.
	sink.Notef("%s: wrote %s.\n", ac.name, ac.settingsPath)
	return nil
}

// removeLegacySkill cleans up a stale, rk-owned rk-display skill left by an older
// run-kit. It runs on BOTH the install and uninstall passes (see applyAgentConfig)
// because re-running plain `rk agent-setup` is the documented upgrade action, so
// most machines only ever reach the install path — a cleanup gated on --uninstall
// would never fire for them. agent-setup no longer WRITES this skill; this is a
// one-release courtesy scheduled for removal one release after this change.
//
// Behavior is uniform across both passes:
//   - ABSENT file → silent (a fresh machine must see zero rk-display output).
//   - marker-less (user-rewritten) file → left untouched with a skip note (rk only
//     removes files it owns).
//   - marker-owned file → offer removal (confirm), then os.RemoveAll the whole
//     rk-display/ directory. Removal is confirmed first because it deletes the
//     entire directory, including any user-added files within it.
func removeLegacySkill(sink outputSink, reader *bufio.Reader, ac agentConfig, cons consent) error {
	skillDir := filepath.Join(ac.skillsDir, rkDisplaySkillDir)
	skillPath := filepath.Join(skillDir, rkDisplaySkillFile)

	current, err := readSkill(skillPath)
	if err != nil {
		return fmt.Errorf("%s: read %s: %w", ac.name, skillPath, err)
	}

	if current == "" {
		// Absent legacy skill: nothing to clean, and nothing to say — a fresh
		// machine must produce no rk-display output at all.
		return nil
	}
	if !skillHasMarker(current) {
		// Removal narration — chatter (dropped by --quiet).
		sink.Notef("%s: %s was rewritten without the %q marker — leaving it untouched (rk only removes files it owns).\n", ac.name, skillPath, skillManagedByMarker)
		return nil
	}

	// The "found a legacy skill" line is narration (chatter), but the consent
	// prompt + dry-run note are interaction/requested-data and go to the data
	// channel (survive --quiet), mirroring applyAgentHooks.
	sink.Notef("%s: found a legacy rk-display skill at %s (agent-setup no longer installs it).\n\n", ac.name, skillPath)
	dryRunNote := fmt.Sprintf("%s: dry run — legacy rk-display skill left in place (nothing removed).", ac.name)
	promptSuffix := fmt.Sprintf("Remove the %s directory? [y/N] ", skillDir)
	ok, err := cons.authorizeWrite(sink.data, reader, dryRunNote, promptSuffix)
	if err != nil {
		return err
	}
	if !ok {
		if !cons.dryRun {
			// Status line — chatter.
			sink.Notef("%s: legacy rk-display skill left in place (nothing removed).\n", ac.name)
		}
		return nil
	}

	if err := os.RemoveAll(skillDir); err != nil {
		return fmt.Errorf("%s: remove %s: %w", ac.name, skillDir, err)
	}
	// Status line — chatter.
	sink.Notef("%s: removed %s.\n", ac.name, skillDir)
	return nil
}

// skillHasMarker reports whether a legacy skill file carries the rk ownership
// marker. It is the whole-file analogue of isRkEntry: rk owned the entire
// SKILL.md, so a simple frontmatter-marker presence check gates its destructive
// removal (never a merge). A user who rewrote the file dropped the marker and
// thereby opts out of rk-managed removal.
func skillHasMarker(content string) bool {
	return strings.Contains(content, skillManagedByMarker)
}

// readSkill loads the current legacy skill file for cleanup. A missing file is
// treated tolerantly as empty content (never an error) — a fresh machine has no
// legacy skill, and removeLegacySkill treats empty as "nothing to clean". Any
// other read error surfaces so we never act on a file we failed to read.
func readSkill(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return "", nil
		}
		return "", err
	}
	return string(data), nil
}

// renderArtifactDiff prints the shared "will <action> … / --- current / +++
// proposed" block for the settings-hooks merge. It was once shared with the
// rk-display skill install (now removed), so it stays a standalone helper — the
// diff framing is kept in one place.
//
// `current` and `proposed` are the already-formatted body strings (indented JSON
// for hooks); this helper adds no further trimming. The header carries no trailing
// newline — this function appends the blank line that separates it from the diff.
// The "Write these changes? [y/N] " prompt suffix is NOT emitted here — it is
// printed by authorizeWrite only on the interactive path, so the auto-answered
// --yes/--dry-run paths never dangle an unanswered prompt.
func renderArtifactDiff(out io.Writer, header, current, proposed string) {
	fmt.Fprintf(out, "%s\n\n", header)
	fmt.Fprintln(out, "--- current")
	fmt.Fprintln(out, current)
	fmt.Fprintln(out, "+++ proposed")
	fmt.Fprintln(out, proposed)
}

// isTerminal reports whether r is an interactive terminal, used to decide
// between the interactive [y/N] prompt and the Principle 1 non-TTY refusal. It
// uses term.IsTerminal (a TCGETS/TIOCGETA ioctl), NOT a bare os.ModeCharDevice
// check: a char-device test alone treats /dev/null (`agent-setup </dev/null`,
// the exact non-interactive shape an agent uses) as a terminal, which would make
// the refusal silently not fire. A non-*os.File reader (e.g. a test's
// strings.Reader or a pipe) is not a TTY, so tests default to the
// non-interactive path unless they say otherwise.
func isTerminal(r io.Reader) bool {
	f, ok := r.(*os.File)
	if !ok {
		return false
	}
	return term.IsTerminal(int(f.Fd()))
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
