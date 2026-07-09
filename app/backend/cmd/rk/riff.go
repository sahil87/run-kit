package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"syscall"
	"time"

	"rk/internal/config"
	"rk/internal/fabconfig"
	"rk/internal/tmux"

	"github.com/spf13/cobra"
)

// Exit code discipline for `rk riff` — see spec `## rk: Error Handling and
// Exit Codes`. These are implemented locally in this file (via exitCodeError
// + a RunE wrapper) because main.execute() is shared with every other
// subcommand and must keep returning exit 1 for generic errors.
const (
	exitPrecondition = 2 // $TMUX unset, wt not on PATH
	exitSubprocess   = 3 // wt/tmux non-zero exit, output parse failure, timeouts
)

// Subprocess timeouts — `wt create` is the slowest step (matches constitution
// §Process Execution's 30s build-op guidance); tmux and fab operations are
// cheap. fabTimeout bounds the `fab agent --print` launcher-resolution call.
const (
	wtTimeout        = 30 * time.Second
	tmuxTimeout      = 10 * time.Second
	fabTimeout       = 10 * time.Second
	defaultRiffSkill = "/fab-discuss"
	defaultLauncher  = "claude --dangerously-skip-permissions"
)

// exitCodeError signals that the command should exit with a specific non-zero
// code. The local RunE wrapper inspects this and calls os.Exit after printing
// msg to stderr — this is the only way to get distinct exit codes without
// touching main.execute(), which is shared with every other subcommand.
type exitCodeError struct {
	code int
	msg  string
}

func (e *exitCodeError) Error() string { return e.msg }

// preconditionErr / subprocessErr are small constructors for the two classes
// of failure that riff.go can produce.
func preconditionErr(format string, a ...any) error {
	return &exitCodeError{code: exitPrecondition, msg: fmt.Sprintf(format, a...)}
}

func subprocessErr(format string, a ...any) error {
	return &exitCodeError{code: exitSubprocess, msg: fmt.Sprintf(format, a...)}
}

var (
	// riffPaneSpecs is the shared ordered list of pane specs accumulated from
	// argv-order occurrences of --skill and --cmd. Both flags append into
	// this same slice via the paneFlag.target binding, so interleaved uses
	// (e.g., `--cmd --skill /fab --cmd htop`) produce the correct pane order.
	riffPaneSpecs []PaneSpec

	riffLayoutFlag     string
	riffCountFlag      int
	riffPresetFlag     string
	riffListPresetsFlg bool
)

var riffCmd = &cobra.Command{
	Use:   "riff [preset] [--skill <skill>...] [--cmd <cmd>...] [--layout <name>] [--count <N>] [--preset <name>] [--list-presets] [-- <wt-flags>...]",
	Short: "Create a worktree, tmux window, and Claude Code session",
	Long: `Create a git worktree via wt, open a new tmux window in it, and launch
a Claude Code session with a skill or slash-command. Supports multi-pane
windows via repeatable --skill and --cmd flags, named layouts, presets
defined in fab/project/config.yaml, and parallel spawning across N worktrees
via --count.

Prerequisites:
  - You must be inside a tmux session ($TMUX set).
  - 'wt' must be on your PATH (https://github.com/sahil87/wt).
  - The resolved launcher command (default: claude --dangerously-skip-permissions) must be available.
  - 'fab' on PATH is optional: it is used to resolve the launcher (see below);
    when absent, the default launcher is used.

Flags before -- are parsed by run-kit; flags after -- are forwarded verbatim to
wt create (e.g., --worktree-name, --base, --reuse). Run 'wt create --help' to
see the available passthrough flags.

Pane array model:
  --skill and --cmd are repeatable. Each occurrence adds one pane; argv order
  (left to right) becomes pane order (pane 0, 1, 2, …). Both flags may be
  interleaved. Bare --skill (no value) launches a blank Claude session; bare
  --cmd drops into $SHELL (fallback /bin/sh).

Launcher resolution:
  The launcher is resolved by running 'fab agent --print', which prints
  fab-kit's fully-resolved default-tier session command. If 'fab' is not on
  PATH or the call fails, falls back to 'claude --dangerously-skip-permissions'.

Presets:
  Named invocations like 'run-kit riff ship' or 'run-kit riff --preset ship' pull
  layout, panes, and wt_args from fab/project/config.yaml under riff.presets.
  CLI --skill/--cmd flags replace the preset's panes entirely. CLI --layout
  overrides preset layout. Run 'run-kit riff --list-presets' to see defined presets.

Count:
  --count N (short -N) creates N worktree/window pairs in parallel, each with
  the same pane shape. Worktree names come from wt's random adjective-noun
  generator. On any failure, successful worktrees and windows are rolled back
  before returning a non-zero exit.

Examples:
  run-kit riff                                           # default: 1 pane, /fab-discuss
  run-kit riff --skill /review                           # single-pane with specific skill
  run-kit riff --skill /fab-fff --cmd "just dev"         # 2 panes (even-horizontal by default)
  run-kit riff --cmd --skill /fab --cmd htop --skill     # 4 interleaved panes (auto-tiled)
  run-kit riff --skill /a --cmd x --cmd y --layout main-vertical
  run-kit riff ship                                      # invoke the 'ship' preset
  run-kit riff --preset investigate                      # named-flag preset alias
  run-kit riff ship --count 3                            # 3 parallel ship workspaces (also: -N 3)
  run-kit riff -- --worktree-name pacing-canyon          # name the worktree

Exit codes:
  0  success
  2  precondition failure ($TMUX unset, wt not found)
  3  subprocess failure (wt or tmux non-zero, output parse failure, timeout)`,
	// Interspersed=false so the "--" separator terminates cobra's flag parsing
	// and the remainder lands in args[] for passthrough to `wt create`.
	//
	// DisableFlagParsing=true lets us pre-process argv (rewriting `--skill V`
	// to `--skill=V` so pflag's NoOptDefVal + Set path handles both bare
	// and with-value forms uniformly) before handing the cleaned argv to
	// pflag.Parse. See pane_spec.go for the motivation.
	DisableFlagParsing: true,
	RunE:               runRiffWithExitCode,
}

// skillPaneFlag / cmdPaneFlag are the two pflag.Value instances bound to
// --skill and --cmd. Both append into the shared riffPaneSpecs slice so
// argv-order is preserved across interleaved occurrences. Module-level so
// init() can hold references; both get their target field set to
// &riffPaneSpecs before cobra sees them.
var (
	skillPaneFlag = &paneFlag{kind: PaneKindSkill, target: &riffPaneSpecs}
	cmdPaneFlag   = &paneFlag{kind: PaneKindCmd, target: &riffPaneSpecs}
)

func init() {
	// Interspersed=true (pflag default) so flags may appear before OR after
	// the positional preset token (e.g., `rk riff ship --count 3`). The
	// `--` separator still terminates parsing so wt passthrough works.
	riffCmd.Flags().SetInterspersed(true)

	// --skill and --cmd are repeatable pane flags. NoOptDefVal is set to the
	// bare sentinel so pflag accepts bare usage (no argv lookahead in pflag
	// itself; space-form with a value is handled by rewritePaneSpaceForm
	// PreRunE below which rewrites argv to equals-form before cobra parses).
	riffCmd.Flags().Var(skillPaneFlag, "skill", "Claude Code skill/slash-command for a pane (repeatable; bare form launches a blank Claude session)")
	riffCmd.Flags().Lookup("skill").NoOptDefVal = paneBareSentinel
	riffCmd.Flags().Var(cmdPaneFlag, "cmd", "Shell command for a pane (repeatable; bare form drops into $SHELL)")
	riffCmd.Flags().Lookup("cmd").NoOptDefVal = paneBareSentinel

	riffCmd.Flags().StringVar(&riffLayoutFlag, "layout", "auto", layoutFlagUsage())
	riffCmd.Flags().IntVarP(&riffCountFlag, "count", "N", 1, "Spawn N worktree/window pairs in parallel (N >= 1)")
	riffCmd.Flags().StringVar(&riffPresetFlag, "preset", "", "Named preset from fab/project/config.yaml (riff.presets.<name>)")
	riffCmd.Flags().BoolVar(&riffListPresetsFlg, "list-presets", false, "List defined presets and exit")

	// PreRunE rewrites argv to translate `--skill VAL` → `--skill=VAL` for
	// the custom pane flags before pflag does its parsing. This keeps pflag
	// happy (it sees equals-form), while giving users the conventional
	// space-form syntax (`--cmd htop`). See pane_spec.go for details.
	riffCmd.Args = cobra.ArbitraryArgs
	cobra.OnInitialize() // no-op but retains ordering explicitly
}

// runRiffWithExitCode is the cobra RunE. Because the command sets
// DisableFlagParsing=true (so we can pre-process --skill/--cmd space-form),
// we manually call Flags().Parse on the rewritten argv. --help / -h are
// handled explicitly since cobra's own help path is bypassed.
//
// After parsing, it delegates to runRiff for the actual work, then inspects
// the returned error: if it's an *exitCodeError we print msg to stderr and
// os.Exit with the specified code; otherwise we return it so main.execute()
// handles it as a generic exit-1 error.
func runRiffWithExitCode(cmd *cobra.Command, args []string) error {
	// Reset accumulator slice so repeated cobra.Execute() calls (e.g.,
	// tests) start fresh. Flag vars also need reset to their defaults.
	riffPaneSpecs = nil
	riffLayoutFlag = "auto"
	riffCountFlag = 1
	riffPresetFlag = ""
	riffListPresetsFlg = false

	// Pre-process argv: rewrite space-form --skill/--cmd to equals-form so
	// pflag's NoOptDefVal path handles both uniformly. See pane_spec.go.
	rewritten := rewritePaneSpaceForm(args)

	// Help handling — since DisableFlagParsing short-circuits cobra's help,
	// detect -h/--help manually and delegate to cobra's renderer.
	for _, tok := range rewritten {
		if tok == "-h" || tok == "--help" {
			return cmd.Help()
		}
		if tok == "--" {
			break
		}
	}

	// Parse flags. pflag respects SetInterspersed(false) and stops at the
	// first non-flag argument; the remainder lands in flags.Args().
	if err := cmd.Flags().Parse(rewritten); err != nil {
		return err
	}
	// Non-flag positional args (includes everything after `--`, which pflag
	// strips from the argv but preserves as args).
	remaining := cmd.Flags().Args()

	err := runRiff(cmd, remaining)
	if err == nil {
		return nil
	}
	var ece *exitCodeError
	if errors.As(err, &ece) {
		fmt.Fprintln(cmd.ErrOrStderr(), ece.msg)
		os.Exit(ece.code)
	}
	return err
}

// effectiveSpec is the fully-resolved plan for spawning one riff window.
// Populated by resolveEffectiveSpec from the CLI flags + optional preset.
type effectiveSpec struct {
	Panes       []PaneSpec
	Layout      string   // canonical name, or "" for single-pane / explicit single-pane no-op
	Count       int      // --count / -N: number of parallel worktree/window pairs (≥ 1)
	Passthrough []string // forwarded to wt create
	Launcher    string
}

// runRiff orchestrates the full workflow. Order:
//  1. --list-presets short-circuit (before any other work — never side-effects)
//  2. Preconditions
//  3. Signal wrap on root context
//  4. Layout / count / preset-conflict validation (fail-fast, no subprocess)
//  5. Launcher resolution
//  6. Preset resolution (positional or --preset)
//  7. effectiveSpec assembly
//  8. Dispatch: count == 1 → direct spawn; count ≥ 2 → runCount
func runRiff(cmd *cobra.Command, args []string) error {
	// Step 1: --list-presets is a pure read + print. Must short-circuit BEFORE
	// preconditions — a user outside tmux should still be able to list
	// presets, and no subprocess invocation is permitted per spec.
	if riffListPresetsFlg {
		presets := readPresetsForRepo()
		return printPresets(presets, cmd.OutOrStdout())
	}

	// Step 2: preconditions (fast-fail order: $TMUX first, wt second).
	if err := checkPreconditions(); err != nil {
		return err
	}

	// Step 3: signal wrap — Ctrl-C / SIGTERM cancel every subprocess below
	// via exec.CommandContext propagation. Single-site handler; stdlib
	// idiom for CLI tools. Spec §SIGINT Propagation.
	ctx, stop := signal.NotifyContext(cmd.Context(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	// Step 4a: count validation — must be ≥ 1.
	if riffCountFlag < 1 {
		return &exitCodeError{code: 1, msg: fmt.Sprintf("run-kit riff: --count requires a positive integer (got %d)", riffCountFlag)}
	}

	// Step 4b: layout validation — resolve to canonical or error with full list.
	canonicalLayout, err := resolveLayout(riffLayoutFlag)
	if err != nil {
		return &exitCodeError{code: 1, msg: err.Error()}
	}

	// Step 5: launcher resolution via `fab agent --print`. Never errors —
	// falls back to the built-in default when fab is absent / fails / prints
	// nothing usable. Threads the signal ctx so Ctrl-C / SIGTERM cancels the
	// `fab agent --print` subprocess too (Step 3 propagation invariant).
	launcher := resolveLauncher(ctx)

	// Step 6: preset resolution. Determines whether args[0] is a preset name
	// (positional form) vs a pass-through token. --preset and positional
	// forms are mutually exclusive.
	presets := readPresetsForRepo()
	positional := ""
	if len(args) > 0 {
		positional = args[0]
	}
	preset, remaining, err := resolveActivePreset(args, positional, riffPresetFlag, presets)
	if err != nil {
		return &exitCodeError{code: 1, msg: err.Error()}
	}

	// Step 7: effective spec — panes list, layout, count, and passthrough
	// all merged per the resolution-order rules (CLI > preset > default).
	// cobra's Changed() tells us whether --layout was explicitly set; that's
	// the signal the user wants to override a preset layout (even with "auto").
	layoutExplicit := cmd.Flags().Changed("layout")
	spec, err := resolveEffectiveSpec(riffPaneSpecs, layoutExplicit, canonicalLayout, riffCountFlag, preset, remaining)
	if err != nil {
		return err
	}
	spec.Launcher = launcher

	// Step 8: dispatch. N == 1 path invokes the same primitives used by
	// the fan-out path's goroutines, just inlined to keep the simple case
	// simple (no goroutine scheduling overhead).
	if spec.Count == 1 {
		worktreePath, err := runWtCreate(ctx, spec.Passthrough)
		if err != nil {
			return err
		}
		if err := spawnRiff(ctx, worktreePath, spec); err != nil {
			return err
		}
		return nil
	}

	return runCount(ctx, spec)
}

// checkPreconditions validates that we're inside tmux and that wt is on PATH.
// Order matters per spec: $TMUX first, wt second; fast-fail on the first miss.
//
// NOTE: `internal/tmux`'s init() strips $TMUX from the process env so that
// bare tmux subprocess calls target the default socket. We read the original
// value via `tmux.OriginalTMUX`, which is captured before init() runs.
func checkPreconditions() error {
	if tmux.OriginalTMUX == "" {
		return preconditionErr("run-kit riff: not inside a tmux session ($TMUX unset) — start tmux first")
	}
	if _, err := exec.LookPath("wt"); err != nil {
		return preconditionErr("run-kit riff: wt not found on PATH (required companion tool — see https://github.com/sahil87/wt)")
	}
	return nil
}

// resolveLauncher resolves the agent launcher by shelling out to
// `fab agent --print`, which prints fab-kit's fully-resolved default-tier
// session command (tier → provider → session_command, with {model}/{effort}
// substitution). Delegating to the fab CLI means rk never has to parse
// fab-kit's config schema itself and can't drift from it (constitution §III
// Wrap, Don't Reinvent). fab discovers the repo from the process cwd — and
// `rk riff` always runs inside the repo — so no --repo flag or FindGitRoot
// walk is needed here.
//
// Best-effort and never errors: on ANY failure (fab absent from PATH, non-zero
// exit, timeout, empty/whitespace-only stdout, or multi-line stdout) it falls
// back silently to defaultLauncher with no stderr noise, preserving the
// documented never-errors posture of runRiff Step 5.
//
// parent is the caller's signal context (runRiff Step 3) so a Ctrl-C / SIGTERM
// cancels the `fab agent --print` subprocess rather than leaving the user
// waiting up to fabTimeout after an interrupt — matching the propagation of
// every other subprocess (runWtCreate, the tmux calls).
func resolveLauncher(parent context.Context) string {
	ctx, cancel := context.WithTimeout(parent, fabTimeout)
	defer cancel()

	// Output() (not CombinedOutput()) so stderr can't pollute the launcher.
	out, err := exec.CommandContext(ctx, "fab", "agent", "--print").Output()
	if launcher, ok := parseFabAgentOutput(string(out), err); ok {
		return launcher
	}
	return defaultLauncher
}

// parseFabAgentOutput is the pure post-processing seam for resolveLauncher's
// `fab agent --print` call: it decides whether the subprocess result yields a
// usable launcher. Returns (trimmed launcher, true) only when err is nil and
// stdout trims to a single non-empty line; otherwise (\"\", false) so the
// caller falls back to defaultLauncher. A trimmed string containing an embedded
// newline (multi-line output) is treated as malformed — a valid session command
// is one line. Pure — no I/O — so the fallback rules are testable in isolation,
// mirroring parsePaneID.
func parseFabAgentOutput(stdout string, err error) (string, bool) {
	if err != nil {
		return "", false
	}
	launcher := strings.TrimSpace(stdout)
	if launcher == "" {
		return "", false
	}
	if strings.ContainsRune(launcher, '\n') {
		return "", false
	}
	return launcher, true
}

// readPresetsForRepo returns the presets map from fab/project/config.yaml at
// the current repo root. Wraps the path discovery boilerplate. Returns an
// empty map on any failure (matching fabconfig's silent-best-effort posture).
func readPresetsForRepo() map[string]fabconfig.Preset {
	cwd, err := os.Getwd()
	if err != nil {
		return map[string]fabconfig.Preset{}
	}
	root := config.FindGitRoot(cwd)
	if root == "" {
		return map[string]fabconfig.Preset{}
	}
	return fabconfig.ReadPresets(root)
}

// readPresetsOrderedForRepo is readPresetsForRepo but preserves YAML source
// order. Used by printPresets for deterministic --list-presets output.
func readPresetsOrderedForRepo() []fabconfig.PresetEntry {
	cwd, err := os.Getwd()
	if err != nil {
		return nil
	}
	root := config.FindGitRoot(cwd)
	if root == "" {
		return nil
	}
	return fabconfig.ReadPresetsOrdered(root)
}

// resolveActivePreset determines which preset (if any) applies to this
// invocation. Returns the preset, the remaining positional args after any
// preset-consumption, and an error on ambiguous/unknown inputs.
//
// Rules per spec §Positional and named preset invocation:
//   - If both --preset and a matching positional are provided, error.
//   - If --preset is provided and unknown, error (lists defined presets).
//   - Else if positional matches a defined preset exactly, consume arg[0].
//   - Else no preset applies; args are returned untouched.
func resolveActivePreset(args []string, positionalCandidate, presetFlag string, available map[string]fabconfig.Preset) (*fabconfig.Preset, []string, error) {
	positionalMatch := positionalCandidate != "" && hasPreset(available, positionalCandidate)

	if presetFlag != "" && positionalMatch {
		return nil, args, fmt.Errorf("run-kit riff: positional preset %q and --preset %q are mutually exclusive", positionalCandidate, presetFlag)
	}
	if presetFlag != "" {
		p, ok := available[presetFlag]
		if !ok {
			return nil, args, fmt.Errorf("run-kit riff: unknown preset %q (defined: %s)", presetFlag, joinPresetNames(available))
		}
		return &p, args, nil
	}
	if positionalMatch {
		p := available[positionalCandidate]
		return &p, args[1:], nil
	}
	return nil, args, nil
}

// hasPreset reports whether name exists as a key in available. Small helper
// to keep resolveActivePreset readable.
func hasPreset(available map[string]fabconfig.Preset, name string) bool {
	_, ok := available[name]
	return ok
}

// joinPresetNames returns a comma-separated sorted list of preset names, or
// `(none)` if the map is empty. Used in error messages where a list of
// valid inputs helps the user.
func joinPresetNames(m map[string]fabconfig.Preset) string {
	if len(m) == 0 {
		return "(none)"
	}
	names := make([]string, 0, len(m))
	for k := range m {
		names = append(names, k)
	}
	sort.Strings(names)
	return strings.Join(names, ", ")
}

// resolveEffectiveSpec merges CLI flags with an optional preset into a single
// effectiveSpec. Resolution order for each field:
//
//	panes:   CLI (replaces) > preset > built-in default single-pane
//	layout:  explicit --layout (including --layout auto) > preset > default auto-by-count
//	count:   --count CLI (presets don't carry count in this change)
//	wt args: preset wt_args prepended to CLI passthrough
//
// layoutExplicit is true when the user passed --layout on the CLI (from
// cobra's Flags().Changed("layout")). This distinguishes "user didn't set
// --layout" from "user explicitly set --layout auto" — the latter should
// override a preset layout, the former should defer to it.
//
// Single-pane windows have their layout forced empty regardless of source —
// tmux select-layout has no meaningful effect on a 1-pane window.
func resolveEffectiveSpec(cliPanes []PaneSpec, layoutExplicit bool, layoutCanonical string, cliCount int, preset *fabconfig.Preset, passthrough []string) (effectiveSpec, error) {
	spec := effectiveSpec{Count: cliCount}

	// Panes: CLI replaces preset entirely if any CLI pane flags were given.
	switch {
	case len(cliPanes) > 0:
		spec.Panes = append(spec.Panes, cliPanes...)
	case preset != nil && len(preset.Panes) > 0:
		for _, p := range preset.Panes {
			spec.Panes = append(spec.Panes, presetPaneToSpec(p))
		}
	default:
		// No panes anywhere → preserve the change-2 default: single /fab-discuss pane.
		spec.Panes = []PaneSpec{{Kind: PaneKindSkill, Value: defaultRiffSkill}}
	}

	// Layout: explicit CLI override (even --layout auto) wins over preset.
	// Preset layout wins over default when user didn't override.
	switch {
	case layoutExplicit:
		if layoutCanonical == "auto" {
			spec.Layout = autoLayout(len(spec.Panes))
		} else {
			spec.Layout = layoutCanonical
		}
	case preset != nil && preset.Layout != "":
		canonical, err := resolveLayout(preset.Layout)
		if err != nil {
			return effectiveSpec{}, &exitCodeError{code: 1, msg: fmt.Sprintf("run-kit riff: preset layout invalid: %v", err)}
		}
		spec.Layout = canonical
	default:
		spec.Layout = autoLayout(len(spec.Panes))
	}

	// Single-pane windows have no layout — tmux select-layout would be a no-op
	// and the spec explicitly forbids emitting it for 1-pane cases.
	if len(spec.Panes) <= 1 {
		spec.Layout = ""
	}

	// Passthrough: preset wt_args prepended to user passthrough.
	if preset != nil && len(preset.WtArgs) > 0 {
		spec.Passthrough = append(spec.Passthrough, preset.WtArgs...)
	}
	spec.Passthrough = append(spec.Passthrough, passthrough...)

	return spec, nil
}

// presetPaneToSpec converts an fabconfig.PaneSpec (YAML-layer) into the
// rk-internal PaneSpec used by spawnRiff. The two types split because the
// YAML struct has separate Skill/Cmd fields (round-tripping to disk is
// clearer that way), while the rk type uses a single Value dispatched by
// Kind (matches the argv-flag shape).
func presetPaneToSpec(p fabconfig.PaneSpec) PaneSpec {
	out := PaneSpec{Kind: p.Kind}
	switch p.Kind {
	case fabconfig.PaneKindSkill:
		out.Value = p.Skill
	case fabconfig.PaneKindCmd:
		out.Value = p.Cmd
	}
	return out
}

// runWtCreate invokes `wt create --non-interactive --worktree-open skip
// <passthrough...>` and parses the resulting `Path:` line to discover the
// worktree path. Returns a subprocessErr on wt failure, output parse failure,
// or timeout.
func runWtCreate(parent context.Context, passthrough []string) (string, error) {
	ctx, cancel := context.WithTimeout(parent, wtTimeout)
	defer cancel()

	argv := append([]string{"create", "--non-interactive", "--worktree-open", "skip"}, passthrough...)
	cmd := exec.CommandContext(ctx, "wt", argv...)
	out, runErr := cmd.CombinedOutput()
	output := string(out)
	if runErr != nil {
		return "", subprocessErr("run-kit riff: wt create failed: %v\n%s", runErr, output)
	}

	path := parseWorktreePath(output)
	if path == "" {
		return "", subprocessErr("run-kit riff: could not find 'Path:' line in wt output:\n%s", output)
	}
	if info, err := os.Stat(path); err != nil || !info.IsDir() {
		return "", subprocessErr("run-kit riff: worktree path %q does not exist or is not a directory\n%s", path, output)
	}
	return path, nil
}

// parseWorktreePath scans wt's combined output line by line looking for
// `^Path: <path>$` (after trimming whitespace). Returns the path or "" if
// not found. Split into its own function so riff_test.go can assert the
// parsing rules directly, without staging a full wt invocation.
func parseWorktreePath(output string) string {
	for _, raw := range strings.Split(output, "\n") {
		line := strings.TrimSpace(raw)
		if !strings.HasPrefix(line, "Path:") {
			continue
		}
		value := strings.TrimSpace(strings.TrimPrefix(line, "Path:"))
		if value != "" {
			return value
		}
	}
	return ""
}

// buildNewWindowArgs returns the argv slice (after the binary name "tmux")
// passed to `tmux new-window` for a skill pane. Pure, no side effects — the
// test seam used by riff_test.go to assert argv ordering without invoking
// real tmux. See buildSpawnArgvs for the multi-pane variant.
//
// The trailing shell string is composed in three layers:
//  1. launcher-with-cmd-arg: `<launcher> '<escaped-cmdArg>'` OR just
//     `<launcher>` when cmdArg is empty (bare-claude: no positional).
//  2. interactive wrap: `${SHELL:-/bin/sh} -i -c '<escaped-layer-1>'` so
//     .zshrc/.bashrc aliases, functions, and interactive PATH tweaks are
//     available to the launcher.
//  3. shellWrap suffix: `; exec "${SHELL:-/bin/sh}"` so the pane stays
//     interactive after the launcher exits.
func buildNewWindowArgs(worktreePath, resolvedName, launcher, cmdArg string) []string {
	shellCmd := buildSkillShellString(launcher, cmdArg)
	return []string{"new-window", "-n", resolvedName, "-c", worktreePath, shellCmd}
}

// buildSkillShellString composes the shell string for a skill-type pane.
// Preserves the three-layer wrap from buildNewWindowArgs (launcher + optional
// escaped skill arg → interactive sh -i -c → shellWrap suffix). Empty
// cmdArg is rendered as a bare `<launcher>` in layer 1 (no single-quoted
// positional), matching spec §Bare-flag semantics.
//
// Reused by both the first-pane (new-window) and subsequent-pane
// (split-window) paths so skill-pane composition is uniform across panes.
func buildSkillShellString(launcher, cmdArg string) string {
	var layer1 string
	if cmdArg == "" {
		// Bare skill: no positional argument. A trailing `<launcher>` keeps the
		// interactive wrap syntactically valid (sh -i -c '<cmd>') and is
		// equivalent to running the launcher with no args.
		layer1 = launcher
	} else {
		layer1 = fmt.Sprintf("%s '%s'", launcher, escapeSingleQuotes(cmdArg))
	}
	interactive := fmt.Sprintf(`${SHELL:-/bin/sh} -i -c '%s'`, escapeSingleQuotes(layer1))
	return shellWrap(interactive)
}

// buildCmdShellString composes the shell string for a cmd-type pane. Unlike
// skill panes, cmd panes do NOT get the interactive `sh -i -c` wrap — the
// user's command is expected to be self-sufficient (e.g., `just dev`, `htop`),
// and wrapping would alter argv semantics. shellWrap still appends the
// `; exec $SHELL` tail so the pane stays interactive after the command exits.
//
// Empty value is the bare-shell path — shellWrap("") returns just
// `exec "${SHELL:-/bin/sh}"`, which drops the user into their shell.
func buildCmdShellString(value string) string {
	return shellWrap(value)
}

// buildSpawnArgvs returns the ordered slice of tmux argvs to execute for a
// given (worktreePath, resolvedName, spec) triple. Pure, no side effects —
// the test seam for argv construction. The order is:
//
//	[0]: new-window (creates the window with pane 0)
//	[1..N-1]: split-window (one per additional pane, horizontal splits)
//	[-1]: select-layout (skipped when spec.Layout == "")
//
// The trailing `select-pane` step is NOT in this slice — pane id is a
// runtime value (returned by `tmux new-window -P -F '#{pane_id}'`), so the
// orchestrator (`spawnRiffReturningName`) constructs that argv from the
// captured pane id and runs it after this slice. Hardcoding a pane index
// (e.g., `<name>.0`) is wrong — user tmux configs vary in
// `pane-base-index` (commonly 0 or 1) and the canonical primitive is the
// pane id, not the index.
//
// Each split-window uses the same -c <worktreePath> so the new pane inherits
// the worktree cwd. Target selection is the resolved window name —
// consistent with new-window's implicit target; tmux's "new pane is active
// after split" semantics make sequential splits work without explicit
// pane-id targeting.
func buildSpawnArgvs(worktreePath, resolvedName string, spec effectiveSpec) [][]string {
	argvs := make([][]string, 0, len(spec.Panes)+1)
	if len(spec.Panes) == 0 {
		return argvs
	}
	// Pane 0 → new-window.
	argvs = append(argvs, []string{
		"new-window",
		"-n", resolvedName,
		"-c", worktreePath,
		paneShellString(spec.Launcher, spec.Panes[0]),
	})
	// Panes 1..N → split-window. -h keeps the previous "horizontal split"
	// semantics (panes placed side-by-side) as the initial split direction;
	// tmux select-layout then rearranges per canonical layout name. When
	// spec.Layout is empty and there are 2+ panes, the -h direction is what
	// the user sees — matching the pre-refactor baseline behavior.
	for _, pane := range spec.Panes[1:] {
		argvs = append(argvs, []string{
			"split-window",
			"-h",
			"-t", resolvedName,
			"-c", worktreePath,
			paneShellString(spec.Launcher, pane),
		})
	}
	// select-layout: only when spec.Layout is non-empty. Empty layout means
	// either single-pane or explicit single-pane no-op.
	if spec.Layout != "" {
		argvs = append(argvs, []string{"select-layout", "-t", resolvedName, spec.Layout})
	}
	return argvs
}

// buildNewWindowCaptureArgs returns the argv slice (after the binary "tmux")
// passed to `tmux new-window -P -F '#{pane_id}'` for the first pane. The
// `-P` flag prints information about the new window and `-F '#{pane_id}'`
// formats that output as just the new pane id (e.g., `%87`). The orchestrator
// then parses stdout, trims it, and uses the captured id as the target of a
// subsequent runtime `select-pane -t <pane-id>`.
//
// Pure helper — no I/O — so the argv shape is testable. The trailing argv
// element is the same shell string `buildSpawnArgvs` uses for pane 0.
func buildNewWindowCaptureArgs(worktreePath, resolvedName string, spec effectiveSpec) []string {
	return []string{
		"new-window",
		"-P",
		"-F", "#{pane_id}",
		"-n", resolvedName,
		"-c", worktreePath,
		paneShellString(spec.Launcher, spec.Panes[0]),
	}
}

// parsePaneID parses the stdout of `tmux new-window -P -F '#{pane_id}'`,
// which writes a single line containing the new pane's id (e.g., `%87\n`).
// Returns the trimmed id or an error when the input is empty/whitespace-only.
//
// Pure helper — no I/O — so the parsing rules are testable in isolation.
// Spec §"pane-id capture parses a single trimmed line".
func parsePaneID(stdout string) (string, error) {
	id := strings.TrimSpace(stdout)
	if id == "" {
		return "", fmt.Errorf("empty pane id from tmux new-window -P")
	}
	return id, nil
}

// paneShellString dispatches between buildSkillShellString and
// buildCmdShellString based on the pane kind. Keeps buildSpawnArgvs readable.
func paneShellString(launcher string, pane PaneSpec) string {
	if pane.Kind == PaneKindSkill {
		return buildSkillShellString(launcher, pane.Value)
	}
	return buildCmdShellString(pane.Value)
}

// spawnRiff performs the full tmux window-spawn sequence for one riff. It
// probes existing window names for collision resolution, then runs three
// phases: (1) `tmux new-window -P -F '#{pane_id}' …` via
// runTmuxNewWindowCapturePaneID to capture the first pane's id; (2) the
// remaining argv rows from buildSpawnArgvs (split-window × N + optional
// select-layout) via runTmuxArgv; (3) `tmux select-pane -t <pane-id>`
// constructed at runtime from the captured id (pane id is the canonical
// tmux primitive — unaffected by `pane-base-index` config). Each tmux
// invocation gets its own tmuxTimeout context; a failure mid-sequence
// aborts and returns a subprocessErr — by design, panes created before the
// failure remain in the window (tmux has no batch rollback). Multi-window
// rollback at the window level is handled by runCount.
//
// Returns the resolved window name so fan-out can use it for rollback.
func spawnRiff(ctx context.Context, worktreePath string, spec effectiveSpec) error {
	_, err := spawnRiffReturningName(ctx, worktreePath, spec)
	return err
}

func spawnRiffReturningName(ctx context.Context, worktreePath string, spec effectiveSpec) (string, error) {
	existing, err := listWindowNames(ctx)
	if err != nil {
		return "", err
	}
	base := "riff-" + filepath.Base(worktreePath)
	resolvedName := resolveWindowName(existing, base)

	if len(spec.Panes) == 0 {
		// Invariant: resolveEffectiveSpec always populates at least one pane.
		// Reaching this branch means a caller bypassed that resolver; fail
		// fast rather than silently succeeding with no window/panes (which
		// would leak any worktree already created upstream).
		return resolvedName, &exitCodeError{code: 1, msg: "run-kit riff: spawnRiff invariant violated: spec.Panes is empty"}
	}

	// Pane 0 — `tmux new-window -P -F '#{pane_id}'` so we can target the
	// final select-pane by pane id rather than a hardcoded `.0` suffix
	// (which is wrong on tmux configs with `pane-base-index 1`).
	paneID, err := runTmuxNewWindowCapturePaneID(ctx, buildNewWindowCaptureArgs(worktreePath, resolvedName, spec))
	if err != nil {
		return resolvedName, err
	}

	// Panes 1..N + optional select-layout — pure argv slice from
	// buildSpawnArgvs minus the new-window row (already executed above).
	rest := buildSpawnArgvs(worktreePath, resolvedName, spec)
	if len(rest) > 0 {
		rest = rest[1:]
	}
	for _, argv := range rest {
		if err := runTmuxArgv(ctx, argv); err != nil {
			return resolvedName, err
		}
	}

	// Focus the first pane by id. Pane id is the canonical tmux primitive
	// and is unaffected by `pane-base-index` config differences.
	if err := runTmuxArgv(ctx, []string{"select-pane", "-t", paneID}); err != nil {
		return resolvedName, err
	}
	return resolvedName, nil
}

// runTmuxNewWindowCapturePaneID runs `tmux new-window -P -F '#{pane_id}' …`
// (argv supplied by buildNewWindowCaptureArgs) under a tmuxTimeout context
// and the user's tmux child env. Returns the captured pane id (trimmed) on
// success, or a subprocessErr (exit 3) on non-zero exit, timeout, or empty
// stdout.
//
// Mirrors runTmuxArgv's posture (same timeout, same env) but uses Output()
// rather than CombinedOutput() so stderr is excluded from the parsed pane
// id. On non-zero exit, *exec.ExitError carries Stderr (when Output() is
// used) which we surface in the error message for parity with runTmuxArgv.
func runTmuxNewWindowCapturePaneID(parent context.Context, argv []string) (string, error) {
	ctx, cancel := context.WithTimeout(parent, tmuxTimeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, "tmux", argv...)
	cmd.Env = tmuxChildEnv()
	stdout, err := cmd.Output()
	if err != nil {
		var stderr string
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) {
			stderr = string(exitErr.Stderr)
		}
		return "", subprocessErr("run-kit riff: tmux new-window failed: %v\n%s", err, stderr)
	}
	id, parseErr := parsePaneID(string(stdout))
	if parseErr != nil {
		return "", subprocessErr("run-kit riff: tmux new-window output parse failed: %v", parseErr)
	}
	return id, nil
}

// runTmuxArgv executes one tmux argv with a tmuxTimeout context and the
// child-env restore (so the user's tmux server, not the managed runkit one,
// receives the call). Returns subprocessErr on non-zero exit / timeout.
func runTmuxArgv(parent context.Context, argv []string) error {
	ctx, cancel := context.WithTimeout(parent, tmuxTimeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, "tmux", argv...)
	cmd.Env = tmuxChildEnv()
	out, err := cmd.CombinedOutput()
	if err != nil {
		return subprocessErr("run-kit riff: tmux %s failed: %v\n%s", argv[0], err, string(out))
	}
	return nil
}

// fanOutResult records one goroutine's outcome: the created worktree path
// (empty if creation failed) and the tmux window name (empty if the window
// step was not reached or failed before naming). Used to build the rollback
// plan on partial failure.
type fanOutResult struct {
	Index        int
	WorktreePath string
	WindowName   string
	Err          error
}

// rollbackPlan lists the cleanup operations needed after a partial fan-out
// failure. Worktrees are identified by their basename (`wt delete
// --worktree-name <name>`) and windows by their resolved tmux name
// (`tmux kill-window -t <name>`).
type rollbackPlan struct {
	Worktrees []string
	Windows   []string
}

// planFanOutRollback computes the rollback plan from a completed set of
// goroutine results. Pure function — no I/O. The plan includes all
// successful (or partially-successful) worktrees + windows, excluding the
// failing goroutine's own artifacts (because those either don't exist, or
// exist in a partial state that `wt delete` + `tmux kill-window` would
// already handle if we tried — but we're conservative and skip them, since
// the failing goroutine may have its own cleanup path within `wt create`).
//
// Successes are identified by: Err == nil (full success) OR Err != nil but
// worktree/window was successfully created before the later-step failure
// (partial success — we DO want to clean these up).
//
// The failureIdx parameter identifies the first-reported failure's index;
// its own worktree/window are skipped from the plan even if present, because
// the single failing goroutine is expected to have its own cleanup semantics
// (wt failure → no worktree; tmux failure → window may exist but is the
// failure point).
//
// Actually — simpler: include every worktree/window the goroutine reported
// as created (non-empty field), because `wt delete` / `tmux kill-window` are
// idempotent-friendly (kill-window fails quietly if the window is gone, we
// log and continue). The "exclude failing goroutine" nuance is handled by
// the fact that the failing goroutine won't have populated both fields.
func planFanOutRollback(results []fanOutResult, failureIdx int) rollbackPlan {
	plan := rollbackPlan{}
	for _, r := range results {
		// Skip the failing goroutine's own artifacts — its partial state is
		// the error we're reporting, not something to clean up blindly.
		if r.Index == failureIdx {
			continue
		}
		if r.WorktreePath != "" {
			plan.Worktrees = append(plan.Worktrees, filepath.Base(r.WorktreePath))
		}
		if r.WindowName != "" {
			plan.Windows = append(plan.Windows, r.WindowName)
		}
	}
	return plan
}

// runCount spawns spec.Count worktree/window pairs in parallel. Each
// goroutine runs `wt create` + `spawnRiff`; on any failure the successful
// ones are rolled back (wt delete + tmux kill-window) before returning.
// The first-reported error propagates out; rollback errors are logged to
// stderr but do not mask the primary error.
//
// The internal helpers (`fanOutResult`, `planFanOutRollback`,
// `rollbackFanOut`, `rollbackPlan`) keep their `fanOut` naming because
// they describe the parallelism mechanic — distinct from the user-facing
// `--count` flag, which is just how the count is requested.
func runCount(ctx context.Context, spec effectiveSpec) error {
	n := spec.Count
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	results := make([]fanOutResult, n)
	var wg sync.WaitGroup
	wg.Add(n)

	// Capture the first goroutine to actually fail, using sync.Once to break
	// ties at the moment of failure (not by index scan afterwards). Once one
	// goroutine cancels the context, siblings may also surface errors
	// (context.Canceled) — but only the first true failure should be treated
	// as the primary error and be excluded from the rollback plan.
	var firstFailOnce sync.Once
	firstFailIdx := -1
	var firstFailErr error
	recordFailure := func(i int, err error) {
		firstFailOnce.Do(func() {
			firstFailIdx = i
			firstFailErr = err
		})
	}

	for i := 0; i < n; i++ {
		go func(i int) {
			defer wg.Done()
			res := fanOutResult{Index: i}
			defer func() { results[i] = res }()

			worktreePath, err := runWtCreate(ctx, spec.Passthrough)
			if err != nil {
				res.Err = err
				recordFailure(i, err)
				cancel() // tear down siblings
				return
			}
			res.WorktreePath = worktreePath

			windowName, err := spawnRiffReturningName(ctx, worktreePath, spec)
			res.WindowName = windowName
			if err != nil {
				res.Err = err
				recordFailure(i, err)
				cancel()
				return
			}
		}(i)
	}
	wg.Wait()

	if firstFailErr == nil {
		return nil
	}
	failureIdx := firstFailIdx
	firstErr := firstFailErr

	// Roll back the other goroutines' artifacts.
	plan := planFanOutRollback(results, failureIdx)
	rollbackFanOut(context.Background(), plan)

	// Return a subprocessErr that preserves the first goroutine's error
	// message. If the underlying error is already an exitCodeError we
	// preserve its code; otherwise wrap as subprocess (exit 3).
	var ece *exitCodeError
	if errors.As(firstErr, &ece) {
		return ece
	}
	return subprocessErr("run-kit riff: fan-out failed: %v", firstErr)
}

// rollbackFanOut invokes wt delete per worktree and tmux kill-window per
// window listed in plan. Errors are logged to stderr but do not halt
// rollback — best-effort cleanup matches the spec's rollback posture.
//
// Uses a fresh (non-cancelled) context because the parent context may have
// been cancelled as part of the failure path; rollback itself needs to run
// to completion.
func rollbackFanOut(ctx context.Context, plan rollbackPlan) {
	for _, wtName := range plan.Worktrees {
		if err := runWtDelete(ctx, wtName); err != nil {
			fmt.Fprintf(os.Stderr, "run-kit riff: rollback warning: wt delete %s failed: %v\n", wtName, err)
		}
	}
	for _, winName := range plan.Windows {
		if err := runTmuxArgv(ctx, []string{"kill-window", "-t", winName}); err != nil {
			fmt.Fprintf(os.Stderr, "run-kit riff: rollback warning: tmux kill-window %s failed: %v\n", winName, err)
		}
	}
}

// buildWtDeleteArgs returns the argv slice (after the binary "wt") passed to
// `wt delete` from the rollback path. Pure helper, exposed for testing the
// argv shape without invoking real wt. The argv MUST contain
// `--non-interactive` so the wrapped `wt` does not prompt on stdin (rollback
// runs without a tty), and the worktree name MUST be a positional argument
// (the `--worktree-name` flag was deprecated by `wt`).
func buildWtDeleteArgs(name string) []string {
	return []string{"delete", "--non-interactive", name}
}

// runWtDelete invokes `wt delete --non-interactive <name>` with a wtTimeout
// context. Used exclusively by the fan-out rollback path. The
// `--non-interactive` flag suppresses `wt`'s `Delete this worktree?` prompt;
// without it, the rollback subprocess (which has no tty) reads EOF on stdin
// and exits 1, silently leaking worktrees. The name is passed as a
// positional argument because `wt` deprecated `--worktree-name`. Returns
// the raw exec error (not a subprocessErr) because the caller logs and
// continues.
func runWtDelete(parent context.Context, name string) error {
	ctx, cancel := context.WithTimeout(parent, wtTimeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, "wt", buildWtDeleteArgs(name)...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("%v\n%s", err, string(out))
	}
	return nil
}

// tmuxChildEnv returns the process env with TMUX restored to the value it
// had before internal/tmux init() stripped it. Required so tmux subprocesses
// target the user's current tmux server (where they invoked `rk riff`)
// instead of the default socket. Mirrors the pattern used by cmd/rk/context.go.
func tmuxChildEnv() []string {
	env := os.Environ()
	if tmux.OriginalTMUX != "" {
		env = append(env, "TMUX="+tmux.OriginalTMUX)
	}
	return env
}

// escapeSingleQuotes returns s with every literal ' replaced by the
// 4-character sequence '\'' so the result can be embedded inside a
// single-quoted shell string. This matches the canonical POSIX shell-safe
// encoding: close the current single-quoted string, escape a literal quote,
// then reopen.
func escapeSingleQuotes(s string) string {
	return strings.ReplaceAll(s, "'", `'\''`)
}

// listWindowNames invokes `tmux list-windows -F '#W'` against the user's
// current tmux server (via tmuxChildEnv) and returns the resulting window
// names with surrounding whitespace trimmed and empty lines dropped. Uses
// exec.CommandContext with tmuxTimeout. Returns a subprocessErr (exit 3) on
// non-zero exit or timeout, surfacing tmux's error output in the message.
func listWindowNames(ctx context.Context) ([]string, error) {
	qctx, cancel := context.WithTimeout(ctx, tmuxTimeout)
	defer cancel()

	cmd := exec.CommandContext(qctx, "tmux", "list-windows", "-F", "#W")
	cmd.Env = tmuxChildEnv()
	out, err := cmd.CombinedOutput()
	if err != nil {
		return nil, subprocessErr("run-kit riff: tmux list-windows failed: %v\n%s", err, string(out))
	}

	var names []string
	for _, raw := range strings.Split(string(out), "\n") {
		line := strings.TrimSpace(raw)
		if line == "" {
			continue
		}
		names = append(names, line)
	}
	return names, nil
}

// resolveWindowName returns base if no entry in existing matches, otherwise
// probes base-2, base-3, … and returns the first free name. Pure helper: no
// I/O, no context, deterministic for a given input. The suffix scheme starts
// at -2 so the user's first-choice name (base) is preferred when free; gaps
// are filled before appending beyond the current max.
func resolveWindowName(existing []string, base string) string {
	set := make(map[string]struct{}, len(existing))
	for _, name := range existing {
		set[name] = struct{}{}
	}
	if _, clash := set[base]; !clash {
		return base
	}
	for i := 2; ; i++ {
		candidate := fmt.Sprintf("%s-%d", base, i)
		if _, clash := set[candidate]; !clash {
			return candidate
		}
	}
}

// shellWrap appends `; exec "${SHELL:-/bin/sh}"` to cmd so the tmux pane that
// ran cmd drops into an interactive shell rather than closing when cmd exits.
// The `${SHELL:-/bin/sh}` expansion is evaluated by tmux's shell at
// window-creation time — if the user's $SHELL is set it is used verbatim,
// otherwise /bin/sh is the POSIX-safe fallback. Pure helper: no I/O, no env
// reads, deterministic for a given input.
//
// Empty/whitespace-only input yields just the bare `exec "${SHELL:-/bin/sh}"`
// form so the result is always a syntactically valid POSIX command list —
// never a leading `; exec …`. This is the bare-cmd path (user ran `--cmd`
// with no value).
func shellWrap(cmd string) string {
	if strings.TrimSpace(cmd) == "" {
		return `exec "${SHELL:-/bin/sh}"`
	}
	return fmt.Sprintf(`%s; exec "${SHELL:-/bin/sh}"`, cmd)
}

// printPresets writes the presets map to out as indented YAML-like plain
// text. Preset names appear in YAML source order (via
// readPresetsOrderedForRepo). Empty map → a single "no presets defined"
// line. Returns nil on all paths — rendering cannot fail.
func printPresets(presets map[string]fabconfig.Preset, out io.Writer) error {
	ordered := readPresetsOrderedForRepo()
	// If ordered is empty but presets is non-empty, the map was supplied by
	// a test (bypassing disk). Fall back to sorted keys for deterministic
	// output in that case.
	if len(ordered) == 0 && len(presets) > 0 {
		names := make([]string, 0, len(presets))
		for k := range presets {
			names = append(names, k)
		}
		sort.Strings(names)
		for _, n := range names {
			ordered = append(ordered, fabconfig.PresetEntry{Name: n, Preset: presets[n]})
		}
	}
	if len(ordered) == 0 {
		fmt.Fprintln(out, "No presets defined in fab/project/config.yaml")
		return nil
	}
	for i, entry := range ordered {
		if i > 0 {
			fmt.Fprintln(out)
		}
		fmt.Fprintf(out, "%s:\n", entry.Name)
		layout := entry.Preset.Layout
		if layout == "" {
			layout = "(default: auto)"
		}
		fmt.Fprintf(out, "  layout: %s\n", layout)
		fmt.Fprintln(out, "  panes:")
		if len(entry.Preset.Panes) == 0 {
			fmt.Fprintln(out, "    (none)")
		} else {
			for _, p := range entry.Preset.Panes {
				switch p.Kind {
				case fabconfig.PaneKindSkill:
					fmt.Fprintf(out, "    - skill: %s\n", quoteIfEmpty(p.Skill))
				case fabconfig.PaneKindCmd:
					fmt.Fprintf(out, "    - cmd: %s\n", quoteIfEmpty(p.Cmd))
				}
			}
		}
		fmt.Fprintln(out, "  wt_args:")
		if len(entry.Preset.WtArgs) == 0 {
			fmt.Fprintln(out, "    (none)")
		} else {
			for _, a := range entry.Preset.WtArgs {
				fmt.Fprintf(out, "    - %s\n", a)
			}
		}
	}
	return nil
}

// quoteIfEmpty renders an empty string as the literal "" so bare
// skill/cmd entries (`skill:` with no value) are visually distinguishable
// from a missing line.
func quoteIfEmpty(s string) string {
	if s == "" {
		return `""`
	}
	return s
}
