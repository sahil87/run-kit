package main

// rk tab — the tab-state command family (docs/specs/ui-state.md § rk tab):
// every verb resolves a tab address (internal/tabaddr), performs one or two
// tmux option writes (or a new-window), and prints the resulting datum on
// stdout. Substrate only — works with rk serve down (cli-layering.md); tmux
// is the store, the daemon a renderer. The parent carries the shared
// persistent -L/--server flag (the rk mux pattern): it wins over the caller's
// own server derived from $TMUX, which wins over "default". An -L without an
// @N address is a usage error — there is no own tab on a foreign server.
//
// Exit codes follow the toolkit convention (Principle 4): 0 ok, 1 operational
// (not in tmux, family full, index out of range, missing dir, tmux failure),
// 2 usage (malformed address/layout, unknown surface, flag conflicts, arg
// counts). Stdout is data via sink.Dataf (survives --quiet); diagnostics are
// sink.Notef/stderr. No verb prompts.

import (
	"github.com/spf13/cobra"
)

var tabServerFlag string

var tabCmd = &cobra.Command{
	Use:   "tab",
	Short: "Drive a tab's UI state — layout, web tabs, code root — from the shell",
	Long: "Drive a tab's UI state from the shell — substrate verbs over the @rk_win_*\n" +
		"tmux options the dashboard renders; works with rk serve down.\n\n" +
		"Every verb takes a tab address: @N, =session:window, or omitted for the\n" +
		"caller's own tab (requires $TMUX_PANE). Web slots address as @N/web/<n>,\n" +
		"web/<n>, or a bare <n> (own tab). -L/--server names a foreign tmux server\n" +
		"and then requires an explicit @N.\n\n" +
		"Subcommands:\n" +
		"  new      Create a window, optionally born with a layout\n" +
		"  layout   Set or mutate @rk_win_layout (add/rm/promote/cycle)\n" +
		"  web      Add, remove, select, or list web tabs\n" +
		"  code     Set the code surface's folder\n" +
		"  show     Dump every @rk_win_* option of a tab\n\n" +
		"See 'rk tab <subcommand> --help' for details.",
}

func init() {
	tabCmd.PersistentFlags().StringVarP(&tabServerFlag, "server", "L", "",
		"tmux server name (default: the caller's own server from $TMUX, else the default server); requires an explicit @N")
	tabCmd.AddCommand(tabNewCmd)
	tabCmd.AddCommand(tabLayoutCmd)
	tabCmd.AddCommand(tabWebCmd)
	tabCmd.AddCommand(tabCodeCmd)
	tabCmd.AddCommand(tabShowCmd)

	// Arg-count violations on the family's DIRECT members are usage-class
	// (exit 2). root.go's central wrap loop covers only rootCmd's direct
	// children, so the family wraps its own (the code.go init idiom); the
	// nested web/code members wrap at their own add sites (tab_web.go /
	// tab_code.go) — init order runs this init before those files' inits, so
	// their members do not exist here yet.
	for _, c := range tabCmd.Commands() {
		if c.Args != nil {
			c.Args = usageArgs(c.Args)
		}
	}
}
