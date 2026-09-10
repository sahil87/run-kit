package main

// rk tab mark — the tab's left-gutter marker. Writes @rk_win_marker through
// the shared signal setter (tab_signal.go); reads go through `rk tab show`.

import (
	"rk/internal/tmux"
	"rk/internal/validate"

	"github.com/spf13/cobra"
)

var tabMarkOffFlag bool

var tabMarkCmd = &cobra.Command{
	Use:   "mark [@N] <mode>[:<stage>] | --off",
	Short: "Set or clear the tab's left-gutter marker",
	Long: "Write @rk_win_marker — the left-gutter marker the sidebar renders.\n" +
		"Accepted values: manual|auto|blocked, each optionally suffixed :1|:2|:3\n" +
		"(a bare mode means stage 1). Prints the stored token on stdout; --off\n" +
		"clears the option and prints nothing (also when already unset).\n" +
		"Reads go through 'rk tab show'.",
	Args:         cobra.RangeArgs(0, 2),
	SilenceUsage: true,
	RunE: func(cmd *cobra.Command, args []string) error {
		return runTabOptionSet(cmd, args, tmux.MarkerOption, tabMarkOffFlag,
			func(v string) (string, string) {
				if msg := validate.ValidateMarkerValue(v); msg != "" {
					return "", msg
				}
				return v, ""
			})
	},
}

func init() {
	tabMarkCmd.Flags().BoolVar(&tabMarkOffFlag, "off", false, "Clear the marker (unset @rk_win_marker)")
	tabCmd.AddCommand(tabMarkCmd)
	// Arg-count violations are usage-class (exit 2) — wrapped at the add site
	// (tab.go's init runs before this file's).
	tabMarkCmd.Args = usageArgs(tabMarkCmd.Args)
}
