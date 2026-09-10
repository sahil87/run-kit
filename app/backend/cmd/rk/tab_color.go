package main

// rk tab color — the tab's row color. Writes @rk_win_color through the shared
// signal setter (tab_signal.go), storing the normalized form; reads go through
// `rk tab show`.

import (
	"rk/internal/tmux"
	"rk/internal/validate"

	"github.com/spf13/cobra"
)

var tabColorOffFlag bool

var tabColorCmd = &cobra.Command{
	Use:   "color [@N] <value> | --off",
	Short: "Set or clear the tab's color",
	Long: "Write @rk_win_color — the row color the sidebar renders. Accepted\n" +
		"values: an ANSI index 0-15, a palette family name (e.g. blue, optionally\n" +
		"-dark/-light suffixed), or a two-hue blend a+b (each 0-15). The value is\n" +
		"stored and printed in its normalized form (\"01\" → \"1\", \" 1 + 3 \" →\n" +
		"\"1+3\"). --off clears the option and prints nothing (also when already\n" +
		"unset). Reads go through 'rk tab show'.",
	Args:         cobra.RangeArgs(0, 2),
	SilenceUsage: true,
	RunE: func(cmd *cobra.Command, args []string) error {
		return runTabOptionSet(cmd, args, tmux.ColorOption, tabColorOffFlag,
			func(v string) (string, string) {
				if msg := validate.ValidateColorValue(v); msg != "" {
					return "", msg
				}
				normalized, _ := validate.NormalizeColorValue(v)
				return normalized, ""
			})
	},
}

func init() {
	tabColorCmd.Flags().BoolVar(&tabColorOffFlag, "off", false, "Clear the color (unset @rk_win_color)")
	tabCmd.AddCommand(tabColorCmd)
	// Arg-count violations are usage-class (exit 2) — wrapped at the add site
	// (tab.go's init runs before this file's).
	tabColorCmd.Args = usageArgs(tabColorCmd.Args)
}
