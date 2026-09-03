package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"regexp"
	"strings"
	"time"

	"rk/internal/config"
	"rk/internal/inject"
	"rk/internal/riff"
	"rk/internal/tmux"
	"rk/internal/validate"

	"github.com/spf13/cobra"
)

// rk operator — open (or switch to) the server's operator: a per-tmux-server
// singleton window named 'operator' running the operator-tier launcher BARE,
// with the /fab-operator kickoff TYPED into the booted agent. The launcher is
// resolved by fab (`fab agent operator --print`) — rk never parses fab config
// (constitution §III) — and the kickoff is typed, never a positional argument,
// because the launcher string is provider-opaque: only claude's CLI accepts a
// positional prompt (the tutorial.go rationale). Creation is atomic with the
// role mark: the new window is immediately stamped @rk_win_role=operator via
// the full rk role write-path (stampOperatorRole), so no window can exist
// unmarked.
//
// Both preconditions are HARD (exit 1): inside tmux, and fab on PATH. Unlike
// tutorial's fail-open posture there is no default-launcher degrade for a
// missing fab — an operator without fab-kit is meaningless (the /fab-operator
// skill would not exist). No tmux subprocess runs before both pass.
//
// The singleton probe is server-WIDE (unlike tutorial's session scope):
// `list-windows -a` on the current server, matching @rk_win_role=operator first
// (rk's identity convention) and falling back to the exact window name
// 'operator' (fab operator's legacy convention). Every tmux call is an
// argv-slice exec with a bounded context via the internal/tmux Run core
// (constitution §I); the launcher string stays riff's one documented
// shell-expansion exception, and the --workers value is charset-gated before
// it may enter that shell string. The kickoff delivery goes through the shared
// inject composite (inject.DeliverWhenReady) with the CLI's per-invocation
// buffer; the typed text never passes through a shell.

const (
	// operatorKickoffPrompt is the exact kickoff typed into the operator agent
	// after it boots.
	operatorKickoffPrompt = "/fab-operator"
	// operatorWindowName is the created window's name and the exact-name
	// singleton fallback — no prefix/substring.
	operatorWindowName = "operator"
	// operatorRoleValue is the @rk_win_role value the singleton probe matches
	// first and the create path stamps.
	operatorRoleValue = "operator"
	// operatorTier is the fab role tier the launcher resolves from.
	operatorTier = "operator"
	// operatorListFormat is the list-windows format the singleton probe parses:
	// window id, role option, window name (the name LAST so tab-containing
	// names stay intact and can never exact-match).
	operatorListFormat = "#{window_id}\t#{" + tmux.RoleOption + "}\t#{window_name}"
	// operatorCmdTimeout bounds every individual subprocess the command spawns
	// (constitution §I: 5-10s for short-lived tmux helpers) — each tmux call,
	// and launcher resolution as the parent of riff.FabTimeout.
	operatorCmdTimeout = 10 * time.Second
)

// operatorDeliverDeadline is the wall-clock budget for the boot-readiness wait
// inside the kickoff delivery (inject.AwaitReady's deadline); past it the
// command degrades to a paste-it-yourself note (never a non-zero exit — the
// window and agent exist either way). A var (not a const) so tests can shrink
// it; the default tolerates a slow agent boot.
var operatorDeliverDeadline = 25 * time.Second

// operatorWorkersRe is the charset gate for --workers: the value enters the
// deliberately-unescaped launcher shell string (constitution §I), so only this
// alphabet may pass — anything else is a usage error before any subprocess.
var operatorWorkersRe = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)

var operatorWorkersFlag string

var operatorCmd = &cobra.Command{
	Use:   "operator [--workers <provider>]",
	Short: "Open the operator — the server-wide orchestrator agent tab (singleton)",
	Long: `Open (or switch to) the run-kit operator: a per-tmux-server singleton
window named 'operator' running the fab operator-tier agent, role-marked so
the dashboard pins it as the server's orchestrator.

The operator is SERVER-wide: re-running from any session on the same tmux
server switches to the existing operator window instead of opening a
duplicate. A window carrying the @rk_win_role=operator marker wins over one
merely named 'operator'.

The agent launcher is resolved via 'fab agent operator --print'; when
resolution fails, the plain default launcher is used. Once the agent has
booted, the kickoff (/fab-operator) is typed into it and submitted — never
passed as a positional argument, so any provider's CLI works. If that delivery
cannot be verified, the command says exactly what to paste instead. A newly
created window is marked @rk_win_role=operator and promoted into the server's
operator session atomically — the same end state 'rk role operator' produces.
The pane drops to an interactive shell when the agent exits.

--workers <provider> sets FAB_AGENT_WORKERS for the launched agent. The value
is restricted to letters, digits, '_' and '-' (it enters the launch shell
string), and an invalid value is a usage error before anything runs.

Prerequisites (both hard — the command refuses without either):
  - You must be inside a tmux session ($TMUX set).
  - fab must be on PATH. The operator is meaningless without fab-kit — the
    companion toolkit that provides the /fab-operator skill and the agent
    profiles — so there is no degraded fallback when it is missing.

Examples:
  run-kit operator                  # open (or return to) the server operator
  run-kit operator --workers kimi   # run its stage workers on another provider

Exit codes:
  0  success (including a window opened with an undeliverable kickoff)
  1  precondition failure ($TMUX unset, fab not on PATH)
  2  usage error (invalid --workers value)
  3  subprocess failure (tmux non-zero exit, timeout)`,
	Args: cobra.NoArgs,
	RunE: runOperatorWithExitCode,
}

func init() {
	operatorCmd.Flags().StringVar(&operatorWorkersFlag, "workers", "",
		"set FAB_AGENT_WORKERS for the launched operator agent (letters, digits, '_' and '-' only)")
}

// operator*Fn are package-level seams so runOperator can be tested without a
// live tmux server or fab (the tutorial.go pattern); the defaults delegate to
// internal/tmux / internal/riff. operatorOriginalTMUXFn is the $TMUX seam:
// internal/tmux's init() strips $TMUX from the process, so the captured
// OriginalTMUX is fixed at package-init time and cannot be varied with
// t.Setenv. The role-stamp steps route through role.go's own seams
// (roleClearExceptFn / roleRunFn / roleDemoteFn / roleMoveInFn) — one
// implementation of the write path.
var (
	operatorOriginalTMUXFn = func() string { return tmux.OriginalTMUX }
	operatorLookPathFn     = func(file string) (string, error) { return exec.LookPath(file) }
	operatorRunFn          = func(ctx context.Context, args, env []string) error {
		return tmux.Run(ctx, args, tmux.RunOpts{Env: env})
	}
	operatorRunOutputFn = func(ctx context.Context, args, env []string) ([]byte, error) {
		return tmux.RunOutput(ctx, args, tmux.RunOpts{Env: env})
	}
	operatorResolveLauncherFn = riff.ResolveLauncher
)

// runOperatorWithExitCode is the cobra RunE. The riff ExitCodeError discipline
// applies (same as runTutorialWithExitCode): the message prints bare to stderr
// and the process exits with the carried code; any other error returns to
// main.execute() as a generic exit-1 error (usageError-wrapped ones carry
// their exit 2 through exitCode's classification).
func runOperatorWithExitCode(cmd *cobra.Command, _ []string) error {
	err := runOperator(cmd)
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

// runOperator is the testable core: --workers validation → hard preconditions
// ($TMUX, fab on PATH) → server-wide singleton probe → create-and-mark → typed
// kickoff delivery. No subprocess runs before the preconditions pass.
func runOperator(cmd *cobra.Command) error {
	// The charset gate is pure validation — it runs before ANY subprocess, so a
	// rejected value never reaches a shell string (constitution §I). An empty
	// value is the unset case: byte-identical bare composition.
	if operatorWorkersFlag != "" && !operatorWorkersRe.MatchString(operatorWorkersFlag) {
		return usageError(fmt.Errorf("invalid --workers value %q: must match %s", operatorWorkersFlag, operatorWorkersRe))
	}
	if operatorOriginalTMUXFn() == "" {
		return &riff.ExitCodeError{Code: riff.ExitPrecondition, Msg: "run-kit operator: not inside a tmux session ($TMUX unset) — open the run-kit dashboard, create a session/window for this directory, then run `rk operator` inside it"}
	}
	if _, err := operatorLookPathFn("fab"); err != nil {
		return &riff.ExitCodeError{Code: riff.ExitPrecondition, Msg: "run-kit operator: fab not found on PATH — the operator requires fab-kit (the companion toolkit that provides the /fab-operator skill and agent profiles); install it first"}
	}

	parent := cmd.Context()
	if parent == nil {
		parent = context.Background()
	}
	ctx, cancel := context.WithTimeout(parent, operatorCmdTimeout)
	defer cancel()

	env := cliChildEnv(operatorOriginalTMUXFn())

	// Server-wide singleton probe: list-windows -a with $TMUX restored
	// enumerates every session's windows on the current server. The @N id is
	// the select target — window-id targeting is exempt from tmux's
	// prefix/glob name resolution.
	out, err := operatorRunOutputFn(ctx, []string{"list-windows", "-a", "-F", operatorListFormat}, env)
	if err != nil {
		return &riff.ExitCodeError{Code: riff.ExitSubprocess, Msg: fmt.Sprintf("run-kit operator: tmux list-windows failed: %v", err)}
	}
	if id := findOperatorWindowID(string(out)); id != "" {
		if err := operatorRunFn(ctx, []string{"select-window", "-t", id}, env); err != nil {
			return &riff.ExitCodeError{Code: riff.ExitSubprocess, Msg: fmt.Sprintf("run-kit operator: tmux select-window failed: %v", err)}
		}
		// Best-effort: the window may live in another session, so move the
		// user's client there — a failure is ignored (the singleton invariant
		// is already preserved).
		_ = operatorRunFn(ctx, []string{"switch-client", "-t", id}, env)
		fmt.Fprintln(cmd.OutOrStdout(), "Switched to existing operator tab.")
		return nil
	}

	cwd, err := os.Getwd()
	if err != nil {
		return fmt.Errorf("run-kit operator: resolve working directory: %w", err)
	}
	root := config.FindGitRoot(cwd)
	windowDir := root
	if windowDir == "" {
		windowDir = cwd
	}

	// Launcher resolution never errors — any failure (non-zero, timeout,
	// malformed output) degrades silently to riff.DefaultLauncher.
	launcher := operatorResolveLauncherFn(ctx, root, operatorTier)
	// Bare launcher (empty prompt): the kickoff is typed after boot, below.
	shellCmd := operatorShellCommand(launcher, operatorWorkersFlag)

	// -P -F captures the new pane's id — the typed delivery's send/capture
	// target (pane-id targeting, like window-id, is exempt from name
	// resolution).
	paneOut, err := operatorRunOutputFn(ctx, []string{"new-window", "-P", "-F", "#{pane_id}", "-c", windowDir, "-n", operatorWindowName, shellCmd}, env)
	if err != nil {
		return &riff.ExitCodeError{Code: riff.ExitSubprocess, Msg: fmt.Sprintf("run-kit operator: tmux new-window failed: %v", err)}
	}
	paneID := strings.TrimSpace(string(paneOut))
	if paneID == "" {
		return &riff.ExitCodeError{Code: riff.ExitSubprocess, Msg: "run-kit operator: tmux new-window output parse failed: empty pane id"}
	}

	// Atomic create-and-mark: stamp the operator role on the new window via
	// the full rk role write-path before reporting — no window exists unmarked.
	winOut, err := operatorRunOutputFn(ctx, []string{"display-message", "-p", "-t", paneID, "#{window_id}"}, env)
	if err != nil {
		return &riff.ExitCodeError{Code: riff.ExitSubprocess, Msg: fmt.Sprintf("run-kit operator: resolve new window id failed: %v", err)}
	}
	// Validate before stamping (the role.go pattern): an empty or malformed id
	// reaching stampOperatorRole would radio-clear @rk_win_role from every
	// window (ClearWindowRoleExcept keeps nothing when keepWindowID is "").
	winID := strings.TrimSpace(string(winOut))
	if errMsg := validate.ValidateWindowID(winID, "Window ID"); errMsg != "" {
		return &riff.ExitCodeError{Code: riff.ExitSubprocess, Msg: fmt.Sprintf("run-kit operator: resolve new window id failed: %s", errMsg)}
	}
	if err := stampOperatorRole(ctx, tmuxSocketArgs(operatorOriginalTMUXFn()), winID); err != nil {
		return &riff.ExitCodeError{Code: riff.ExitSubprocess, Msg: fmt.Sprintf("run-kit operator: mark operator role: %v", err)}
	}

	fmt.Fprintf(cmd.OutOrStdout(), "Opened operator tab (window %q).\n", operatorWindowName)

	// Typed-kickoff delivery is best-effort: the window and its agent exist
	// either way, so a delivery miss degrades to telling the user exactly what
	// to paste — never a non-zero exit.
	if deliverErr := deliverAgentKickoff(parent, operatorDeliverFn, operatorOriginalTMUXFn(), paneID, operatorKickoffPrompt, operatorDeliverDeadline, operatorCmdTimeout); deliverErr != nil {
		fmt.Fprintf(cmd.ErrOrStderr(), "run-kit operator: could not deliver the kickoff prompt (%v) — paste this into the operator agent yourself:\n  %s\n", deliverErr, operatorKickoffPrompt)
	}
	return nil
}

// operatorDeliverFn is the delivery seam (the tutorialDeliverFn pattern):
// production drives inject.DeliverWhenReady with the reconciled state reader;
// tests substitute a recorder so the command path runs tmux-free.
var operatorDeliverFn = func(ctx context.Context, engine *inject.Engine, t inject.Tmux, server, paneID, text string) (inject.Readiness, error) {
	return inject.DeliverWhenReady(ctx, t, server, paneID, inject.Sanitize(text), true, engine, inject.ReadyOpts{
		State:    boundedPaneAgentState,
		Deadline: operatorDeliverDeadline,
	})
}

// findOperatorWindowID scans `tmux list-windows -a -F '<id>\t<role>\t<name>'`
// output for the server-wide operator singleton and returns its @N id (""
// when absent). A window whose role option equals 'operator' wins over a
// name-only match REGARDLESS of order; the name fallback exact-matches the
// LAST field (everything after the second tab), so tab-containing names stay
// intact and can never exact-match, and prefix/substring never match. Pure.
func findOperatorWindowID(listOutput string) string {
	nameHit := ""
	for _, line := range strings.Split(listOutput, "\n") {
		id, rest, found := strings.Cut(line, "\t")
		if !found {
			continue
		}
		role, name, found := strings.Cut(rest, "\t")
		if !found {
			continue
		}
		if role == operatorRoleValue {
			return id
		}
		if nameHit == "" && name == operatorWindowName {
			nameHit = id
		}
	}
	return nameHit
}

// operatorShellCommand composes the pane's shell string: the bare launcher
// (the kickoff is typed after boot, never positional), with the
// charset-validated FAB_AGENT_WORKERS prefix scoped to the AGENT COMMAND ONLY
// when --workers is set — layer 1 of the composition, before the interactive
// wrap and the exec-shell tail. An empty workers value yields the
// byte-identical bare composition. Pure.
func operatorShellCommand(launcher, workers string) string {
	if workers != "" {
		launcher = "FAB_AGENT_WORKERS=" + workers + " " + launcher
	}
	return riff.SkillPaneCommand(launcher, "")
}
