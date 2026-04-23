package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strings"
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
// §Process Execution's 30s build-op guidance); tmux operations are cheap.
const (
	wtTimeout        = 30 * time.Second
	tmuxTimeout      = 10 * time.Second
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
	riffSkillFlag     string
	riffSetupPaneFlag string
)

var riffCmd = &cobra.Command{
	Use:   "riff [--skill <skill>] [--setup-pane <cmd>] [-- <wt-flags>...]",
	Short: "Create a worktree, tmux window, and Claude Code session",
	Long: `Create a git worktree via wt, open a new tmux window in it, and launch
a Claude Code session with a skill or slash-command.

Prerequisites:
  - You must be inside a tmux session ($TMUX set).
  - 'wt' must be on your PATH (https://github.com/sahil87/wt).
  - The launcher command (default: claude --dangerously-skip-permissions) must be available.

Flags before -- are parsed by rk; flags after -- are forwarded verbatim to
wt create (e.g., --worktree-name, --base, --reuse). Run 'wt create --help' to
see the available passthrough flags.

Launcher resolution:
  If 'fab/project/config.yaml' has 'agent.spawn_command', that value is used
  as the launcher. Otherwise, falls back to 'claude --dangerously-skip-permissions'.

Examples:
  rk riff                                     # default skill in a new worktree
  rk riff --skill /review                     # pick a specific skill
  rk riff --setup-pane "just dev"             # add a setup pane running 'just dev'
  rk riff -- --worktree-name pacing-canyon    # name the worktree
  rk riff --skill /ship -- --reuse --base main

Exit codes:
  0  success
  2  precondition failure ($TMUX unset, wt not found)
  3  subprocess failure (wt or tmux non-zero, output parse failure, timeout)`,
	// Interspersed=false so the "--" separator terminates cobra's flag parsing
	// and the remainder lands in args[] for passthrough to `wt create`.
	RunE: runRiffWithExitCode,
}

func init() {
	riffCmd.Flags().SetInterspersed(false)
	riffCmd.Flags().StringVar(&riffSkillFlag, "skill", defaultRiffSkill, "Claude Code skill or slash-command to run in the new window")
	riffCmd.Flags().StringVar(&riffSetupPaneFlag, "setup-pane", "", "If non-empty, split the window and run this setup command in the right pane")
}

// runRiffWithExitCode is the cobra RunE. It delegates to runRiff for the
// actual work, then inspects the returned error: if it's an *exitCodeError
// we print msg to stderr and os.Exit with the specified code; otherwise we
// return it so main.execute() handles it as a generic exit-1 error.
func runRiffWithExitCode(cmd *cobra.Command, args []string) error {
	err := runRiff(cmd, args)
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

// runRiff executes the full workflow: preconditions → launcher resolution →
// wt create → tmux new-window → optional tmux split-window.
func runRiff(cmd *cobra.Command, args []string) error {
	// Step 1: validate preconditions in fast-fail order (spec §Precondition order).
	if err := checkPreconditions(); err != nil {
		return err
	}

	// Wrap the root context with a signal handler so Ctrl-C / SIGTERM
	// cancel every subprocess call below (wt create, tmux new-window, tmux
	// split-window). Matches the stdlib idiom for CLI tools — single-site
	// handler, propagate the cancellable context downstream. See spec
	// §SIGINT Propagation.
	ctx, stop := signal.NotifyContext(cmd.Context(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	// Step 2: resolve launcher from fab/project/config.yaml. Never errors —
	// falls back to "claude --dangerously-skip-permissions" when config is
	// absent / malformed / empty.
	launcher := resolveLauncher()

	// Step 3: create the worktree via wt. args[] here is everything after the
	// cobra-recognized flags (and "--", if present) — passthrough to wt.
	worktreePath, err := runWtCreate(ctx, args)
	if err != nil {
		return err
	}

	// Step 4: open a tmux window rooted at the worktree, running launcher +
	// cmd. The second arg to tmux new-window is a shell string interpreted by
	// tmux's shell — this is the documented exception to constitution §I
	// (Security First).
	if err := runTmuxNewWindow(ctx, worktreePath, launcher, riffSkillFlag); err != nil {
		return err
	}

	// Step 5: optional horizontal split with a setup command. Skipped entirely
	// when --setup-pane is empty (treated identically to the flag being unset).
	if riffSetupPaneFlag != "" {
		if err := runTmuxSplitWindow(ctx, worktreePath, riffSetupPaneFlag); err != nil {
			return err
		}
	}

	return nil
}

// checkPreconditions validates that we're inside tmux and that wt is on PATH.
// Order matters per spec: $TMUX first, wt second; fast-fail on the first miss.
//
// NOTE: `internal/tmux`'s init() strips $TMUX from the process env so that
// bare tmux subprocess calls target the default socket. We read the original
// value via `tmux.OriginalTMUX`, which is captured before init() runs.
func checkPreconditions() error {
	if tmux.OriginalTMUX == "" {
		return preconditionErr("rk riff: not inside a tmux session ($TMUX unset) — start tmux first")
	}
	if _, err := exec.LookPath("wt"); err != nil {
		return preconditionErr("rk riff: wt not found on PATH (required companion tool — see https://github.com/sahil87/wt)")
	}
	return nil
}

// resolveLauncher discovers the repo root, reads fab/project/config.yaml's
// agent.spawn_command, and falls back to the hardcoded default if resolution
// yields an empty string. Never errors.
func resolveLauncher() string {
	cwd, err := os.Getwd()
	if err != nil {
		return defaultLauncher
	}
	root := config.FindGitRoot(cwd)
	if root == "" {
		return defaultLauncher
	}
	if v := fabconfig.ReadSpawnCommand(root); v != "" {
		return v
	}
	return defaultLauncher
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
		return "", subprocessErr("rk riff: wt create failed: %v\n%s", runErr, output)
	}

	path := parseWorktreePath(output)
	if path == "" {
		return "", subprocessErr("rk riff: could not find 'Path:' line in wt output:\n%s", output)
	}
	if info, err := os.Stat(path); err != nil || !info.IsDir() {
		return "", subprocessErr("rk riff: worktree path %q does not exist or is not a directory\n%s", path, output)
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
// passed to `tmux new-window` by runTmuxNewWindow. Pure, no side effects —
// exposed as the test seam so riff_test.go can assert the naming and argv
// ordering rules without invoking real tmux. The window name is taken from
// resolvedName verbatim (collision resolution happens upstream in
// resolveWindowName). -n and -c are distinct argv elements per constitution §I
// (Security First); the trailing shell-command element is the documented
// exception to the argv-only rule (interpreted by tmux's shell).
//
// The trailing shell string is composed in three layers:
//  1. launcher-with-cmd-arg: `<launcher> '<escaped-cmdArg>'`
//  2. interactive wrap: `${SHELL:-/bin/sh} -i -c '<escaped-layer-1>'` so
//     .zshrc/.bashrc aliases, functions, and interactive PATH tweaks are
//     available to the launcher.
//  3. shellWrap suffix: `; exec "${SHELL:-/bin/sh}"` so the pane stays
//     interactive after the launcher exits.
func buildNewWindowArgs(worktreePath, resolvedName, launcher, cmdArg string) []string {
	launcherWithArg := fmt.Sprintf("%s '%s'", launcher, escapeSingleQuotes(cmdArg))
	interactive := fmt.Sprintf(`${SHELL:-/bin/sh} -i -c '%s'`, escapeSingleQuotes(launcherWithArg))
	shellCmd := shellWrap(interactive)
	return []string{"new-window", "-n", resolvedName, "-c", worktreePath, shellCmd}
}

// runTmuxNewWindow opens a new tmux window rooted at worktreePath, with the
// initial command being `<launcher> '<cmd>'` (cmd single-quote-escaped). The
// window name defaults to `riff-<worktree-basename>`; on collision with an
// existing window in the current tmux session it is auto-suffixed via
// resolveWindowName (-2, -3, …). The argv is constructed by
// buildNewWindowArgs. The trailing shell-command arg to tmux new-window IS a
// shell string interpreted by tmux's shell — this is the spec's documented
// exception to the argv-only rule.
//
// Note on TOCTOU: there is a small window between listWindowNames and
// new-window where another process can create a conflicting name. This race
// is explicitly accepted (see spec §Window-Name Collision Resolution) — the
// fallback behavior is identical to the pre-change behavior (silent duplicate
// under default allow-rename).
func runTmuxNewWindow(parent context.Context, worktreePath, launcher, cmdArg string) error {
	existing, err := listWindowNames(parent)
	if err != nil {
		return err
	}
	base := "riff-" + filepath.Base(worktreePath)
	resolvedName := resolveWindowName(existing, base)

	ctx, cancel := context.WithTimeout(parent, tmuxTimeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, "tmux", buildNewWindowArgs(worktreePath, resolvedName, launcher, cmdArg)...)
	cmd.Env = tmuxChildEnv()
	out, runErr := cmd.CombinedOutput()
	if runErr != nil {
		return subprocessErr("rk riff: tmux new-window failed: %v\n%s", runErr, string(out))
	}
	return nil
}

// runTmuxSplitWindow creates a horizontal split of the just-created window
// running `<setupCmd>; exec "${SHELL:-/bin/sh}"` so the pane stays
// interactive after setup. The split target defaults to the current window,
// which is the one we just created via tmux new-window — so no explicit -t
// flag is needed. The setup command is passed through shellWrap directly
// (no interactive-launcher wrap — that applies only to the new-window path).
func runTmuxSplitWindow(parent context.Context, worktreePath, setupCmd string) error {
	ctx, cancel := context.WithTimeout(parent, tmuxTimeout)
	defer cancel()

	shellCmd := shellWrap(setupCmd)
	cmd := exec.CommandContext(ctx, "tmux", "split-window", "-h", "-c", worktreePath, shellCmd)
	cmd.Env = tmuxChildEnv()
	out, err := cmd.CombinedOutput()
	if err != nil {
		return subprocessErr("rk riff: tmux split-window failed: %v\n%s", err, string(out))
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
		return nil, subprocessErr("rk riff: tmux list-windows failed: %v\n%s", err, string(out))
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
// never a leading `; exec …`. In practice neither caller passes an empty
// string today (runTmuxNewWindow always composes a non-empty `interactive`
// string, and runTmuxSplitWindow guards on `riffSetupPaneFlag != ""`), but this
// keeps the helper safe in isolation.
func shellWrap(cmd string) string {
	if strings.TrimSpace(cmd) == "" {
		return `exec "${SHELL:-/bin/sh}"`
	}
	return fmt.Sprintf(`%s; exec "${SHELL:-/bin/sh}"`, cmd)
}
