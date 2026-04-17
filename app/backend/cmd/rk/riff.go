package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strings"
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
	wtTimeout       = 30 * time.Second
	tmuxTimeout     = 10 * time.Second
	defaultRiffCmd  = "/fab-discuss"
	defaultLauncher = "claude --dangerously-skip-permissions"
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
	riffCmdFlag   string
	riffSplitFlag string
)

var riffCmd = &cobra.Command{
	Use:   "riff [-- wt-flags...]",
	Short: "Create a worktree, tmux window, and Claude Code session",
	Long: `Create a git worktree via wt, open a new tmux window in it, and launch
a Claude Code session with a command/skill.

Flags before -- are parsed by rk; flags after -- are forwarded verbatim to
wt create (e.g., --worktree-name, --base, --reuse).`,
	// Interspersed=false so the "--" separator terminates cobra's flag parsing
	// and the remainder lands in args[] for passthrough to `wt create`.
	RunE: runRiffWithExitCode,
}

func init() {
	riffCmd.Flags().SetInterspersed(false)
	riffCmd.Flags().StringVar(&riffCmdFlag, "cmd", defaultRiffCmd, "Claude Code command/skill to launch")
	riffCmd.Flags().StringVar(&riffSplitFlag, "split", "", "If non-empty, split the window and run this setup command in the right pane")
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

	// Step 2: resolve launcher from fab/project/config.yaml. Never errors —
	// falls back to "claude --dangerously-skip-permissions" when config is
	// absent / malformed / empty.
	launcher := resolveLauncher()

	// Step 3: create the worktree via wt. args[] here is everything after the
	// cobra-recognized flags (and "--", if present) — passthrough to wt.
	worktreePath, err := runWtCreate(cmd.Context(), args)
	if err != nil {
		return err
	}

	// Step 4: open a tmux window rooted at the worktree, running launcher +
	// cmd. The second arg to tmux new-window is a shell string interpreted by
	// tmux's shell — this is the documented exception to constitution §I
	// (Security First).
	if err := runTmuxNewWindow(cmd.Context(), worktreePath, launcher, riffCmdFlag); err != nil {
		return err
	}

	// Step 5: optional horizontal split with a setup command. Skipped entirely
	// when --split is empty (treated identically to the flag being unset).
	if riffSplitFlag != "" {
		if err := runTmuxSplitWindow(cmd.Context(), worktreePath, riffSplitFlag); err != nil {
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
// not found. Exported for direct testing.
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

// runTmuxNewWindow opens a new tmux window rooted at worktreePath, with the
// initial command being `<launcher> '<cmd>'` (cmd single-quote-escaped). The
// second arg to tmux new-window IS a shell string interpreted by tmux's shell
// — this is the spec's documented exception to the argv-only rule.
func runTmuxNewWindow(parent context.Context, worktreePath, launcher, cmdArg string) error {
	ctx, cancel := context.WithTimeout(parent, tmuxTimeout)
	defer cancel()

	shellCmd := fmt.Sprintf("%s '%s'", launcher, escapeSingleQuotes(cmdArg))
	cmd := exec.CommandContext(ctx, "tmux", "new-window", "-c", worktreePath, shellCmd)
	cmd.Env = tmuxChildEnv()
	out, err := cmd.CombinedOutput()
	if err != nil {
		return subprocessErr("rk riff: tmux new-window failed: %v\n%s", err, string(out))
	}
	return nil
}

// runTmuxSplitWindow creates a horizontal split of the just-created window
// running `<setupCmd>; exec zsh` so the pane stays interactive after setup.
// The split target defaults to the current window, which is the one we just
// created via tmux new-window — so no explicit -t flag is needed.
func runTmuxSplitWindow(parent context.Context, worktreePath, setupCmd string) error {
	ctx, cancel := context.WithTimeout(parent, tmuxTimeout)
	defer cancel()

	shellCmd := fmt.Sprintf("%s; exec zsh", setupCmd)
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

// escapeSingleQuotes returns s with every literal ' replaced by '\” so it
// can be embedded inside a single-quoted shell string. This matches the
// canonical POSIX shell-safe encoding.
func escapeSingleQuotes(s string) string {
	return strings.ReplaceAll(s, "'", `'\''`)
}
