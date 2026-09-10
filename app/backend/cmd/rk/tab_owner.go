package main

// rk tab owner — the tab's operator-ownership trail. Writes @rk_win_owner
// through the shared signal setter (tab_signal.go). Operator-facing: the
// intended writer is the operator at enrollment; the value persists after
// monitoring ends as the operator-touched trail. Reads go through
// `rk tab show`.

import (
	"rk/internal/tmux"
	"rk/internal/validate"

	"github.com/spf13/cobra"
)

var tabOwnerOffFlag bool

var tabOwnerCmd = &cobra.Command{
	Use:   "owner [@N] operator | --off",
	Short: "Set or clear the tab's operator-ownership trail",
	Long: "Write @rk_win_owner — records that an operator has taken responsibility\n" +
		"for this window at least once (the trail persists after monitoring ends;\n" +
		"the sidebar shows it as done · operator-touched). The only accepted value\n" +
		"is operator. Prints the stored token on stdout; --off clears the option\n" +
		"and prints nothing (also when already unset). Reads go through\n" +
		"'rk tab show'.",
	Args:         cobra.RangeArgs(0, 2),
	SilenceUsage: true,
	RunE: func(cmd *cobra.Command, args []string) error {
		return runTabOptionSet(cmd, args, tmux.OwnerOption, tabOwnerOffFlag,
			func(v string) (string, string) {
				if msg := validate.ValidateOwnerValue(v); msg != "" {
					return "", msg
				}
				return v, ""
			})
	},
}

func init() {
	tabOwnerCmd.Flags().BoolVar(&tabOwnerOffFlag, "off", false, "Clear the owner trail (unset @rk_win_owner)")
	tabCmd.AddCommand(tabOwnerCmd)
	// Arg-count violations are usage-class (exit 2) — wrapped at the add site
	// (tab.go's init runs before this file's).
	tabOwnerCmd.Args = usageArgs(tabOwnerCmd.Args)
}
