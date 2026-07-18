package main

import (
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"os/signal"
	"sort"
	"syscall"

	"rk/internal/config"
	"rk/internal/fabconfig"
	"rk/internal/riff"
	"rk/internal/tmux"

	"github.com/spf13/cobra"
)

// The spawn engine lives in internal/riff (extracted by 260713-sbk1). This file
// is the CLI FRONTEND: it parses flags, checks CLI-only preconditions ($TMUX
// set, wt on PATH), derives the repo root from the process cwd, resolves the
// effective spec + launcher via the engine's exported helpers, and hands off to
// riff.Run with an EMPTY server label (target the user's current tmux server via
// the restored $TMUX). The engine owns the wt+tmux spawn mechanics, fan-out,
// and rollback.

var (
	// riffPaneSpecs is the shared ordered list of pane specs accumulated from
	// argv-order occurrences of --skill and --cmd. Both flags append into this
	// same slice via the paneFlag.target binding, so interleaved uses produce
	// the correct pane order.
	riffPaneSpecs []riff.PaneSpec

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
  1  precondition failure ($TMUX unset, wt not found)
  2  validation/usage error (unknown layout, invalid --count, unknown/conflicting preset, bad flag)
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
// argv-order is preserved across interleaved occurrences.
var (
	skillPaneFlag = &paneFlag{kind: riff.PaneKindSkill, target: &riffPaneSpecs}
	cmdPaneFlag   = &paneFlag{kind: riff.PaneKindCmd, target: &riffPaneSpecs}
)

func init() {
	// Interspersed=true (pflag default) so flags may appear before OR after
	// the positional preset token (e.g., `rk riff ship --count 3`). The
	// `--` separator still terminates parsing so wt passthrough works.
	riffCmd.Flags().SetInterspersed(true)

	// --skill and --cmd are repeatable pane flags. NoOptDefVal is set to the
	// bare sentinel so pflag accepts bare usage; space-form with a value is
	// handled by rewritePaneSpaceForm which rewrites argv to equals-form.
	riffCmd.Flags().Var(skillPaneFlag, "skill", "Claude Code skill/slash-command for a pane (repeatable; bare form launches a blank Claude session)")
	riffCmd.Flags().Lookup("skill").NoOptDefVal = paneBareSentinel
	riffCmd.Flags().Var(cmdPaneFlag, "cmd", "Shell command for a pane (repeatable; bare form drops into $SHELL)")
	riffCmd.Flags().Lookup("cmd").NoOptDefVal = paneBareSentinel

	riffCmd.Flags().StringVar(&riffLayoutFlag, "layout", "auto", layoutFlagUsage())
	riffCmd.Flags().IntVarP(&riffCountFlag, "count", "N", 1, "Spawn N worktree/window pairs in parallel (N >= 1)")
	riffCmd.Flags().StringVar(&riffPresetFlag, "preset", "", "Named preset from fab/project/config.yaml (riff.presets.<name>)")
	riffCmd.Flags().BoolVar(&riffListPresetsFlg, "list-presets", false, "List defined presets and exit")

	riffCmd.Args = cobra.ArbitraryArgs
	cobra.OnInitialize() // no-op but retains ordering explicitly
}

// runRiffWithExitCode is the cobra RunE. Because the command sets
// DisableFlagParsing=true (so we can pre-process --skill/--cmd space-form),
// we manually call Flags().Parse on the rewritten argv. --help / -h are
// handled explicitly since cobra's own help path is bypassed.
//
// A manual flag-parse failure is returned as a usageError (CLI-local
// *exitCodeError, exit 2) so cobra's own error path prints `Error: <msg>` and
// the central execute() seam owns the exit code. On a successful parse it
// delegates to runRiff and inspects the returned error: a *riff.ExitCodeError is
// printed to stderr and os.Exited with its Code (the riff engine's own 1/2/3
// classes); any other error is returned to main.execute() as a generic exit-1
// error.
func runRiffWithExitCode(cmd *cobra.Command, args []string) error {
	// Reset accumulator + flag vars so repeated cobra.Execute() calls (tests)
	// start fresh.
	riffPaneSpecs = nil
	riffLayoutFlag = "auto"
	riffCountFlag = 1
	riffPresetFlag = ""
	riffListPresetsFlg = false

	rewritten := rewritePaneSpaceForm(args)

	for _, tok := range rewritten {
		if tok == "-h" || tok == "--help" {
			return cmd.Help()
		}
		if tok == "--" {
			break
		}
	}

	// A manual flag-parse failure (e.g. `riff --nope`) is a usage error.
	// DisableFlagParsing means the root SetFlagErrorFunc never sees this parse
	// error, so we tag it usage-class locally with usageError (the CLI-local
	// *exitCodeError, exit 2) and RETURN it — this lets cobra's own error path
	// print `Error: unknown flag: --nope` exactly as the pre-DisableFlagParsing
	// binary did (usageError preserves the message verbatim), and the central
	// execute() seam classifies the carried code to exit 2. A riff-engine error
	// (*riff.ExitCodeError, from runRiff) is still printed here and os.Exited with
	// its own class code (1/2/3) — that path owns its bare-message stderr and is
	// unchanged.
	if parseErr := cmd.Flags().Parse(rewritten); parseErr != nil {
		return usageError(parseErr)
	}
	err := runRiff(cmd, cmd.Flags().Args())
	if err == nil {
		return nil
	}
	var ece *riff.ExitCodeError
	if errors.As(err, &ece) {
		fmt.Fprintln(cmd.ErrOrStderr(), ece.Msg)
		os.Exit(ece.Code)
	}
	return err
}

// runRiff orchestrates the CLI flow:
//  1. --list-presets short-circuit (before any other work — never side-effects)
//  2. Preconditions ($TMUX set, wt on PATH)
//  3. Signal wrap on root context
//  4. Layout / count / preset-conflict validation (fail-fast, no subprocess)
//  5. Launcher resolution (engine helper, rooted at the process cwd)
//  6. Preset resolution (positional or --preset)
//  7. Effective spec assembly (engine helper)
//  8. Dispatch to riff.Run (engine owns count==1 direct spawn + count≥2 fan-out)
func runRiff(cmd *cobra.Command, args []string) error {
	// Step 1: --list-presets is a pure read + print. Must short-circuit BEFORE
	// preconditions — a user outside tmux should still be able to list presets.
	if riffListPresetsFlg {
		presets := readPresetsForRepo()
		return printPresets(presets, cmd.OutOrStdout())
	}

	// Step 2: preconditions (fast-fail order: $TMUX first, wt second).
	if err := checkPreconditions(); err != nil {
		return err
	}

	// Step 3: signal wrap — Ctrl-C / SIGTERM cancel every subprocess below via
	// exec.CommandContext propagation.
	ctx, stop := signal.NotifyContext(cmd.Context(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	// Step 4a: count validation — must be ≥ 1.
	if riffCountFlag < 1 {
		return &riff.ExitCodeError{Code: riff.ExitValidation, Msg: fmt.Sprintf("run-kit riff: --count requires a positive integer (got %d)", riffCountFlag)}
	}

	// Step 4b: layout validation — resolve to canonical or error with full list.
	canonicalLayout, err := riff.ResolveLayout(riffLayoutFlag)
	if err != nil {
		return &riff.ExitCodeError{Code: riff.ExitValidation, Msg: err.Error()}
	}

	// The repo root for launcher resolution + wt create is the process cwd (rk
	// riff always runs inside the repo). Empty (rare) is tolerated — the engine
	// then runs subprocesses in the inherited cwd, matching prior behavior.
	repoRoot := ""
	if cwd, cwdErr := os.Getwd(); cwdErr == nil {
		repoRoot = config.FindGitRoot(cwd)
	}

	// Step 5: launcher resolution via the engine helper (rooted at the process
	// cwd so fab resolves this repo). An empty tier = the default tier (`fab
	// agent --print`), preserving today's CLI behavior — the per-tier picker is
	// a web-UI-only affordance. Never errors — falls back to the default.
	launcher := riff.ResolveLauncher(ctx, repoRoot, "")

	// Step 6: preset resolution.
	presets := readPresetsForRepo()
	positional := ""
	if len(args) > 0 {
		positional = args[0]
	}
	preset, remaining, err := riff.ResolveActivePreset(args, positional, riffPresetFlag, presets)
	if err != nil {
		return &riff.ExitCodeError{Code: riff.ExitValidation, Msg: err.Error()}
	}

	// Step 7: effective spec (engine helper). cobra's Changed() tells us whether
	// --layout was explicitly set — the signal to override a preset layout.
	layoutExplicit := cmd.Flags().Changed("layout")
	spec, err := riff.ResolveEffectiveSpec(riffPaneSpecs, layoutExplicit, canonicalLayout, riffCountFlag, preset, remaining)
	if err != nil {
		return err
	}
	spec.Launcher = launcher
	// Empty server label → target the user's current tmux server via the
	// restored $TMUX (captured before internal/tmux's init() stripped it).
	spec.Server = ""
	spec.RepoRoot = repoRoot
	spec.OriginalTMUX = tmux.OriginalTMUX

	// Step 8: dispatch to the engine.
	return riff.Run(ctx, spec)
}

// checkPreconditions validates that we're inside tmux and that wt is on PATH.
// $TMUX first, wt second; fast-fail on the first miss. internal/tmux's init()
// strips $TMUX; we read the original via tmux.OriginalTMUX (captured pre-init).
func checkPreconditions() error {
	if tmux.OriginalTMUX == "" {
		return &riff.ExitCodeError{Code: riff.ExitPrecondition, Msg: "run-kit riff: not inside a tmux session ($TMUX unset) — start tmux first"}
	}
	if _, err := exec.LookPath("wt"); err != nil {
		return &riff.ExitCodeError{Code: riff.ExitPrecondition, Msg: "run-kit riff: wt not found on PATH (required companion tool — see https://github.com/sahil87/wt)"}
	}
	return nil
}

// readPresetsForRepo returns the presets map from fab/project/config.yaml at the
// current repo root. Returns an empty map on any failure (matching fabconfig's
// silent-best-effort posture).
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

// printPresets writes the presets map to out as indented YAML-like plain text,
// in YAML source order (via readPresetsOrderedForRepo). Empty map → a single
// "no presets defined" line. Returns nil on all paths.
func printPresets(presets map[string]fabconfig.Preset, out io.Writer) error {
	ordered := readPresetsOrderedForRepo()
	// If ordered is empty but presets is non-empty, the map was supplied by a
	// test (bypassing disk). Fall back to sorted keys for deterministic output.
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

// quoteIfEmpty renders an empty string as the literal "" so bare skill/cmd
// entries are visually distinguishable from a missing line.
func quoteIfEmpty(s string) string {
	if s == "" {
		return `""`
	}
	return s
}
