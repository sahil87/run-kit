package main

// rk tab flair — the tab's per-row flair decoration. Writes @rk_win_flair
// through the shared signal setter (tab_signal.go); reads go through
// `rk tab show`.

import (
	"rk/internal/tmux"
	"rk/internal/validate"

	"github.com/spf13/cobra"
)

var tabFlairOffFlag bool

var tabFlairCmd = &cobra.Command{
	Use:   "flair [@N] <name> | --off",
	Short: "Set or clear the tab's per-row flair",
	Long: "Write @rk_win_flair — the per-row flair animation the sidebar renders.\n" +
		"Accepted values: rain, scan, nyan, naruto, onepiece, pacman, matrix,\n" +
		"aquarium, roadrunner, invaders, cube, warp, spidey, ironman, noon.\n" +
		"Prints the stored token on stdout; --off clears the option and prints\n" +
		"nothing (also when already unset). Reads go through 'rk tab show'.",
	Args:         cobra.RangeArgs(0, 2),
	SilenceUsage: true,
	RunE: func(cmd *cobra.Command, args []string) error {
		return runTabOptionSet(cmd, args, tmux.FlairOption, tabFlairOffFlag,
			func(v string) (string, string) {
				if msg := validate.ValidateFlairValue(v); msg != "" {
					return "", msg
				}
				return v, ""
			})
	},
}

func init() {
	tabFlairCmd.Flags().BoolVar(&tabFlairOffFlag, "off", false, "Clear the flair (unset @rk_win_flair)")
	tabCmd.AddCommand(tabFlairCmd)
	// Arg-count violations are usage-class (exit 2) — wrapped at the add site
	// (tab.go's init runs before this file's).
	tabFlairCmd.Args = usageArgs(tabFlairCmd.Args)
}
