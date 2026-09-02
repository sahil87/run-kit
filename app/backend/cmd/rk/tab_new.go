package main

// rk tab new — create a window, optionally born with a layout: the layout is
// validated before creation and written in the creation ops (no second round
// trip, no un-laid-out tick). Session resolution is the presentViaNewWindow
// rule, shared via resolveTabNewSession: --session wins (=S exact form); else
// the caller's current session inside tmux; else the target server's current
// session.

import (
	"context"
	"fmt"
	"os"
	"strings"

	"rk/internal/layoutspec"
	"rk/internal/tmux"
	"rk/internal/validate"

	"github.com/spf13/cobra"
)

var (
	tabNewSessionFlag string
	tabNewCwdFlag     string
	tabNewNameFlag    string
	tabNewLayoutFlag  string
)

var tabNewCmd = &cobra.Command{
	Use:   "new [--session =S] [--cwd DIR] [--name N] [--layout L]",
	Short: "Create a window, optionally born with a layout",
	Long: "Create a window and print its id (@N). --layout <shape>:<surface,…> is\n" +
		"validated before creation and written as @rk_win_layout in the creation\n" +
		"call, so the window is born with its layout. --session takes the =S\n" +
		"exact form (no prefix matching); the default is the caller's current\n" +
		"session inside tmux, else the target server's current session. --name\n" +
		"names the window (tmux's own default otherwise); --cwd sets its start\n" +
		"directory (the caller's cwd otherwise).",
	Args:         cobra.NoArgs,
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
}

// presentCreateWindowIDFn is the window-creation seam (the present.go
// pattern); tabCreateWindowIDFn is the same seam under the tab family's name —
// `rk tab new` and present's --window arm create through one path, and tests
// stub both.
var presentCreateWindowIDFn = func(session, name, cwd, server string, ops []tmux.WindowOptionOp) (string, error) {
	return tmux.CreateWindowWithOptionsID(session, name, cwd, server, ops)
}

var tabCreateWindowIDFn = presentCreateWindowIDFn

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

func runTabNew(cmd *cobra.Command, _ []string) error {
	ctx := tabContext(cmd)

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

	ctx, cancel := context.WithTimeout(ctx, tabCmdTimeout)
	defer cancel()
	id, err := tabCreateWindowIDFn(session, name, cwd, server, ops)
	if err != nil {
		return fmt.Errorf("create window: %w", err)
	}
	newSink(cmd).Dataf("%s\n", id)
	tabWakeFn(ctx, server)
	return nil
}
