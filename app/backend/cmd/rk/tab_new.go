package main

// rk tab new — create a window, optionally born with a layout and/or running a
// command: the layout is validated before creation and written in the creation
// ops (no second round trip, no un-laid-out tick). Session resolution is the
// presentViaNewWindow rule, shared via resolveTabNewSession: --session wins
// (=S exact form); else the caller's current session inside tmux; else the
// target server's current session.
//
// The command form is argv after `--`, never a shell string: every token is
// single-quoted via internal/shellq so the window's shell receives it as one
// literal word, and rk's agent-exit fallback (`; exec "${SHELL:-/bin/sh}") is
// appended unless --no-shell-fallback. --json swaps the bare @N datum for the
// {session, window_id, pane_id} envelope; --ready (requires --json and a
// command) adds the boot-readiness verdict via the rk mux await --ready seam.

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"time"

	"rk/internal/layoutspec"
	"rk/internal/shellq"
	"rk/internal/tmux"
	"rk/internal/validate"

	"github.com/spf13/cobra"
)

var (
	tabNewSessionFlag         string
	tabNewCwdFlag             string
	tabNewNameFlag            string
	tabNewLayoutFlag          string
	tabNewJSONFlag            bool
	tabNewReadyFlag           bool
	tabNewTimeoutFlag         int
	tabNewNoShellFallbackFlag bool
)

var tabNewCmd = &cobra.Command{
	Use:   "new [--session =S] [--cwd DIR] [--name N] [--layout L] [--json] [--ready [--timeout SECS]] [--no-shell-fallback] [-- CMD [ARG…]]",
	Short: "Create a window, optionally born with a layout and/or running a command",
	Long: "Create a window and print its id (@N). --layout <shape>:<surface,…> is\n" +
		"validated before creation and written as @rk_win_layout in the creation\n" +
		"call, so the window is born with its layout. --session takes the =S\n" +
		"exact form (no prefix matching); the default is the caller's current\n" +
		"session inside tmux, else the target server's current session. --name\n" +
		"names the window (tmux's own default otherwise); --cwd sets its start\n" +
		"directory (the caller's cwd otherwise).\n\n" +
		"A command for the new window follows `--` as argv — never a shell string:\n" +
		"rk single-quotes every token, so each one reaches the process as one\n" +
		"literal word ($(…), spaces, and quotes survive verbatim). Shell expansion\n" +
		"inside the window is opt-in by naming the shell:\n" +
		"  rk tab new --cwd DIR -- sh -c \"<string>\"\n" +
		"The command gets rk's agent-exit fallback appended\n" +
		"(; exec \"${SHELL:-/bin/sh}\") so the pane drops into an interactive shell\n" +
		"when the command exits; --no-shell-fallback omits the tail and lets the\n" +
		"pane die with the command.\n\n" +
		"--json prints {\"session\", \"window_id\", \"pane_id\"} instead of the bare\n" +
		"@N — session is tmux's own report of where the window landed. --ready\n" +
		"(requires --json and a `--` command) also waits for the new pane's boot\n" +
		"readiness — the rk mux await --ready classification — and adds the verdict\n" +
		"as the JSON \"ready\" key: ready|parked|narrow|running (exit 0; the parked\n" +
		"screen snippet or the narrow remedy rides stderr) or gone (exit 1, after\n" +
		"the JSON prints). --timeout SECS bounds the wait (default 300,\n" +
		"0 = indefinite).",
	Args:         tabNewArgs,
	SilenceUsage: true,
	RunE:         runTabNew,
}

func init() {
	tabNewCmd.Flags().StringVar(&tabNewSessionFlag, "session", "",
		"Session to create the window in, in the =S exact form (default: the caller's current session, else the server's current session)")
	tabNewCmd.Flags().StringVar(&tabNewCwdFlag, "cwd", "",
		"Start directory for the window (default: the caller's cwd)")
	tabNewCmd.Flags().StringVar(&tabNewNameFlag, "name", "",
		"Window name (default: tmux's own)")
	tabNewCmd.Flags().StringVar(&tabNewLayoutFlag, "layout", "",
		"Layout the window is born with, e.g. split-h:tty,web (validated before creation)")
	tabNewCmd.Flags().BoolVar(&tabNewJSONFlag, "json", false,
		"Print {session, window_id, pane_id} as JSON instead of the bare @N")
	tabNewCmd.Flags().BoolVar(&tabNewReadyFlag, "ready", false,
		"Wait for the new pane's boot readiness (the rk mux await --ready classification) and add the verdict as the JSON \"ready\" key; requires --json and a `--` command")
	tabNewCmd.Flags().IntVar(&tabNewTimeoutFlag, "timeout", awaitDefaultTimeoutSec,
		"Seconds --ready waits before reporting `running` (0 = indefinite); requires --ready")
	tabNewCmd.Flags().BoolVar(&tabNewNoShellFallbackFlag, "no-shell-fallback", false,
		"Omit the `; exec \"${SHELL:-/bin/sh}\"` tail so the pane dies with the command")
}

// tabNewArgs gates positionals to the post-`--` command form: every positional
// is one argv element of the window's command, so a positional without (or
// before) `--` is a usage error naming the form.
func tabNewArgs(cmd *cobra.Command, args []string) error {
	if len(args) > 0 && cmd.ArgsLenAtDash() != 0 {
		return fmt.Errorf("command must follow --, e.g. rk tab new -- claude --model opus")
	}
	return nil
}

// presentCreateWindowIDFn is the window-creation seam (the present.go
// pattern); tabCreateWindowIDFn is the same seam under the tab family's name —
// `rk present --window` creates through it, and tests stub both.
var presentCreateWindowIDFn = func(session, name, cwd, server string, ops []tmux.WindowOptionOp) (string, error) {
	return tmux.CreateWindowWithOptionsID(session, name, cwd, server, ops)
}

var tabCreateWindowIDFn = presentCreateWindowIDFn

// tabNewCreateWindowFn is `rk tab new`'s creation seam (the
// tabCreateWindowIDFn pattern, widened with the shell-command positional and
// the full WindowBirth triple); tests stub it so the command/JSON/ready
// contract runs tmux-free.
var tabNewCreateWindowFn = func(session, name, cwd, server, shellCmd string, ops []tmux.WindowOptionOp) (tmux.WindowBirth, error) {
	return tmux.CreateWindowWithCommandID(session, name, cwd, server, shellCmd, ops)
}

// resolveTabNewSession decides the session a new window lands in: an explicit
// --session (=S exact form, validated) wins; else the caller's current
// session via $TMUX_PANE inside tmux; else the target server's current
// session (serverFlag names it — outside tmux the serverFlag/derived/default
// rule applies, the rk mux order).
func resolveTabNewSession(ctx context.Context, serverFlag string) (session, server string, err error) {
	if tabNewSessionFlag != "" {
		if !strings.HasPrefix(tabNewSessionFlag, "=") {
			return "", "", usageError(fmt.Errorf("--session takes the =S exact form (got %q)", tabNewSessionFlag))
		}
		name := tabNewSessionFlag[1:]
		if errMsg := validate.ValidateName(name, "Session name"); errMsg != "" {
			return "", "", usageError(fmt.Errorf("--session: %s", errMsg))
		}
		session = name
	}

	server = serverFlag
	if server == "" {
		if _, serverName, ok := callerContext(); ok {
			server = serverName
		} else {
			server = "default"
		}
	}

	if session != "" {
		return session, server, nil
	}
	if pane := os.Getenv("TMUX_PANE"); pane != "" {
		prefix, _, ok := callerContext()
		if !ok {
			return "", "", fmt.Errorf("cannot derive this pane's tmux server socket from $TMUX (unset or malformed)")
		}
		session, err = ownTabDisplayValue(ctx, prefix, pane, "#{session_name}")
	} else {
		args := []string{"display-message", "-p", "#{session_name}"}
		if server != "default" {
			args = append([]string{"-L", server}, args...)
		}
		ctx, cancel := context.WithTimeout(ctx, ownTabTimeout)
		defer cancel()
		out, rerr := ownTabRunOutputFn(ctx, args)
		if rerr != nil {
			return "", "", fmt.Errorf("resolve target session: %w", rerr)
		}
		session = strings.TrimSpace(string(out))
		if session == "" {
			return "", "", fmt.Errorf("resolve target session: empty response from tmux")
		}
	}
	if err != nil {
		return "", "", fmt.Errorf("resolve target session: %w", err)
	}
	return session, server, nil
}

// validateTabNewFlagRules enforces the flag-combination contract before any
// window is created: --ready reports through --json and needs a command to
// boot; --timeout bounds only a --ready wait; --no-shell-fallback only makes
// sense with a command.
func validateTabNewFlagRules(cmd *cobra.Command, hasCommand bool) error {
	if cmd.Flags().Changed("timeout") && !tabNewReadyFlag {
		return usageError(fmt.Errorf("--timeout requires --ready"))
	}
	if tabNewReadyFlag && !tabNewJSONFlag {
		return usageError(fmt.Errorf("--ready reports through --json; add --json or drop --ready"))
	}
	if tabNewReadyFlag && !hasCommand {
		return usageError(fmt.Errorf("--ready needs a command after --"))
	}
	if tabNewNoShellFallbackFlag && !hasCommand {
		return usageError(fmt.Errorf("--no-shell-fallback needs a command after --"))
	}
	if tabNewReadyFlag && tabNewTimeoutFlag < 0 {
		return usageError(fmt.Errorf("--timeout must be >= 0 (0 = indefinite)"))
	}
	return nil
}

// tabNewBirthJSON is the --json envelope; Ready rides only with --ready
// (omitempty — the key set is stable otherwise, the toolkit P2 schema rule).
type tabNewBirthJSON struct {
	Session  string `json:"session"`
	WindowID string `json:"window_id"`
	PaneID   string `json:"pane_id"`
	Ready    string `json:"ready,omitempty"`
}

func runTabNew(cmd *cobra.Command, args []string) error {
	ctx := tabContext(cmd)

	if err := validateTabNewFlagRules(cmd, len(args) > 0); err != nil {
		return err
	}

	var ops []tmux.WindowOptionOp
	if tabNewLayoutFlag != "" {
		if _, err := layoutspec.Parse(tabNewLayoutFlag); err != nil {
			return usageError(fmt.Errorf("--layout: %w", err))
		}
		v := tabNewLayoutFlag
		ops = append(ops, tmux.WindowOptionOp{Key: tmux.LayoutOption, Value: &v})
	}

	name := tabNewNameFlag
	if name != "" {
		if errMsg := validate.ValidateNewName(name, "Window name"); errMsg != "" {
			return usageError(fmt.Errorf("--name: %s", errMsg))
		}
	}

	// The tmux shell-command positional is composed ONLY from rk-quoted argv
	// tokens plus rk's fixed fallback literal (constitution §I) — the window's
	// shell receives every token as one literal word.
	shellCmd := ""
	if len(args) > 0 {
		shellCmd = shellq.QuoteArgv(args)
		if !tabNewNoShellFallbackFlag {
			shellCmd = shellq.WithShellFallback(shellCmd)
		}
	}

	cwd := tabNewCwdFlag
	if cwd == "" {
		var err error
		cwd, err = os.Getwd()
		if err != nil {
			return fmt.Errorf("resolve working directory: %w", err)
		}
	}

	session, server, err := resolveTabNewSession(ctx, tabServerFlag)
	if err != nil {
		return err
	}

	birth, err := tabNewCreateWindowFn(session, name, cwd, server, shellCmd, ops)
	if err != nil {
		return fmt.Errorf("create window: %w", err)
	}
	// The wake fires after creation — before any --ready wait — so dashboards
	// repaint while the agent boots.
	tabWakeFn(ctx, server)

	sink := newSink(cmd)
	if !tabNewJSONFlag {
		sink.Dataf("%s\n", birth.WindowID)
		return nil
	}

	out := tabNewBirthJSON{Session: birth.Session, WindowID: birth.WindowID, PaneID: birth.PaneID}
	var reportErr error
	if tabNewReadyFlag {
		// The wait rides the command's parent context (never the creation
		// timeout): it may legitimately run for the full --timeout.
		readiness, rerr := muxAwaitReadyFn(ctx, server, birth.PaneID, time.Duration(tabNewTimeoutFlag)*time.Second)
		rep, rerr := mapReadyReport(birth.PaneID, readiness, rerr)
		if rerr != nil {
			return rerr
		}
		if rep.diag != "" {
			fmt.Fprint(cmd.ErrOrStderr(), rep.diag)
		}
		out.Ready = strings.Fields(rep.line)[0]
		reportErr = rep.reportErr
	}
	enc := json.NewEncoder(sink.data)
	enc.SetIndent("", "  ")
	if err := enc.Encode(out); err != nil {
		return fmt.Errorf("encode --json output: %w", err)
	}
	// gone exits 1, but only after the JSON is printed — the envelope is the
	// caller's record of what was created before the pane died.
	return reportErr
}
