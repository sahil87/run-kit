package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"rk/internal/config"
	"rk/internal/riff"
	"rk/internal/tmux"

	"github.com/spf13/cobra"
)

// rk tutorial — the human-typable entry to the guided tour (`rk skill
// tutorial`). Opens a window named 'tutorial' in the CURRENT tmux session
// running the --tier-resolved launcher with the kickoff prompt as its
// positional argument (the fab operator launcher pattern: the kickoff rides
// the launcher, never send-keys). Re-running selects the existing window
// rather than stacking a duplicate — a tour belongs to the project session it
// started in, so the singleton is session-scoped (not operator's server-wide
// probe) and no `tutorial-2` suffixing.
//
// The command composes its own two tmux calls (list-windows probe +
// new-window/select-window) directly — riff.Run's worktree/collision/layout
// machinery is the wrong shape for select-or-create in the current session.
// Every subprocess is an argv-slice exec via the internal/tmux Run core with
// a bounded context (constitution §I); the launcher string stays riff's one
// documented shell-expansion exception, and the kickoff prompt is a
// compile-time constant single-quote-escaped by riff.SkillPaneCommand.

const (
	// tutorialKickoffPrompt is the exact kickoff the tour agent is launched
	// with — the launcher receives it single-quote-escaped as its positional
	// argument.
	tutorialKickoffPrompt = "Run rk skill tutorial and follow it exactly"
	// tutorialWindowName is the exact window name the singleton probe
	// matches — no prefix/substring.
	tutorialWindowName = "tutorial"
	// tutorialCmdTimeout bounds every tmux subprocess the command spawns
	// (constitution §I: 5-10s for short-lived tmux helpers).
	tutorialCmdTimeout = 10 * time.Second
)

var tutorialTierFlag string

var tutorialCmd = &cobra.Command{
	Use:   "tutorial [--tier <role>]",
	Short: "Open the guided tour — an agent-run tutorial tab in this session",
	Long: `Open the run-kit guided tour: a window named 'tutorial' in the current
tmux session, running an agent that walks you through run-kit act by act.

The agent launcher is resolved for the --tier fab role via 'fab agent <tier>
--print'; when fab is absent or resolution fails, the plain default launcher
(claude --dangerously-skip-permissions) is used. The default fast tier keeps
the tour's short narration beats snappy.

Re-running 'rk tutorial' when a window named 'tutorial' already exists in the
current session switches to it instead of opening a duplicate. The pane drops
to an interactive shell when the agent exits.

Prerequisites:
  - You must be inside a tmux session ($TMUX set). Not inside one? Open the
    run-kit dashboard, create a session/window, and run this inside it.

Examples:
  run-kit tutorial              # open (or return to) the tour on the fast tier
  run-kit tutorial --tier doing # run the tour on another fab role

Exit codes:
  0  success
  1  precondition failure ($TMUX unset)
  3  subprocess failure (tmux non-zero exit, timeout)`,
	Args: cobra.NoArgs,
	RunE: runTutorialWithExitCode,
}

func init() {
	tutorialCmd.Flags().StringVar(&tutorialTierFlag, "tier", "fast", "fab role tier the tour agent's launcher resolves from")
}

// tutorial*Fn are package-level seams so runTutorial can be tested without a
// live tmux server or fab (the role.go pattern); the defaults delegate to
// internal/tmux / internal/riff. tutorialOriginalTMUXFn is the $TMUX seam:
// internal/tmux's init() strips $TMUX from the process, so the captured
// OriginalTMUX is fixed at package-init time and cannot be varied with
// t.Setenv.
var (
	tutorialOriginalTMUXFn = func() string { return tmux.OriginalTMUX }
	tutorialRunFn          = func(ctx context.Context, args, env []string) error {
		return tmux.Run(ctx, args, tmux.RunOpts{Env: env})
	}
	tutorialRunOutputFn = func(ctx context.Context, args, env []string) ([]byte, error) {
		return tmux.RunOutput(ctx, args, tmux.RunOpts{Env: env})
	}
	tutorialResolveLauncherFn = riff.ResolveLauncher
)

// runTutorialWithExitCode is the cobra RunE. The riff ExitCodeError discipline
// applies (same as runRiffWithExitCode): the message prints bare to stderr and
// the process exits with the carried code; any other error returns to
// main.execute() as a generic exit-1 error.
func runTutorialWithExitCode(cmd *cobra.Command, _ []string) error {
	err := runTutorial(cmd)
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

// runTutorial is the testable core: precondition ($TMUX) → session-scoped
// singleton probe → resolve launcher → compose pane command → new-window. No
// tmux subprocess runs before the precondition passes.
func runTutorial(cmd *cobra.Command) error {
	if tutorialOriginalTMUXFn() == "" {
		return &riff.ExitCodeError{Code: riff.ExitPrecondition, Msg: "run-kit tutorial: not inside a tmux session ($TMUX unset) — open the run-kit dashboard, create a session/window for this directory, then run `rk tutorial` inside it"}
	}

	parent := cmd.Context()
	if parent == nil {
		parent = context.Background()
	}
	ctx, cancel := context.WithTimeout(parent, tutorialCmdTimeout)
	defer cancel()

	env := tutorialChildEnv()

	// Singleton probe: list-windows with $TMUX restored enumerates only the
	// current session's windows. The @N id is the select target — window-id
	// targeting is exempt from tmux's prefix/glob name resolution.
	out, err := tutorialRunOutputFn(ctx, []string{"list-windows", "-F", "#{window_id}\t#{window_name}"}, env)
	if err != nil {
		return &riff.ExitCodeError{Code: riff.ExitSubprocess, Msg: fmt.Sprintf("run-kit tutorial: tmux list-windows failed: %v", err)}
	}
	if id := findTutorialWindowID(string(out)); id != "" {
		if err := tutorialRunFn(ctx, []string{"select-window", "-t", id}, env); err != nil {
			return &riff.ExitCodeError{Code: riff.ExitSubprocess, Msg: fmt.Sprintf("run-kit tutorial: tmux select-window failed: %v", err)}
		}
		fmt.Fprintln(cmd.OutOrStdout(), "Switched to existing tutorial tab.")
		return nil
	}

	cwd, err := os.Getwd()
	if err != nil {
		return fmt.Errorf("run-kit tutorial: resolve working directory: %w", err)
	}

	// Launcher resolution never errors — any failure (fab absent, non-zero,
	// timeout, malformed output) degrades silently to riff.DefaultLauncher.
	launcher := tutorialResolveLauncherFn(ctx, config.FindGitRoot(cwd), tutorialTierFlag)
	shellCmd := riff.SkillPaneCommand(launcher, tutorialKickoffPrompt)

	if err := tutorialRunFn(ctx, []string{"new-window", "-c", cwd, "-n", tutorialWindowName, shellCmd}, env); err != nil {
		return &riff.ExitCodeError{Code: riff.ExitSubprocess, Msg: fmt.Sprintf("run-kit tutorial: tmux new-window failed: %v", err)}
	}
	fmt.Fprintf(cmd.OutOrStdout(), "Opened tutorial tab (window %q, tier %q).\n", tutorialWindowName, tutorialTierFlag)
	return nil
}

// findTutorialWindowID scans `tmux list-windows -F '#{window_id}\t#{window_name}'`
// output for a window named exactly 'tutorial' and returns its @N id ("" when
// absent). The name is everything after the FIRST tab — the last field of the
// format string — so tab-containing names stay intact and can never exact-match.
// Pure.
func findTutorialWindowID(listOutput string) string {
	for _, line := range strings.Split(listOutput, "\n") {
		id, name, found := strings.Cut(line, "\t")
		if found && name == tutorialWindowName {
			return id
		}
	}
	return ""
}

// tutorialChildEnv returns the subprocess env with the caller's $TMUX restored
// (captured pre-init by internal/tmux, which strips it from the process) so
// bare tmux calls reach the caller's current server — the riff CLI-path
// pattern (childEnv with an empty server label).
func tutorialChildEnv() []string {
	env := os.Environ()
	if t := tutorialOriginalTMUXFn(); t != "" {
		env = append(env, "TMUX="+t)
	}
	return env
}
