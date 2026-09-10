package main

// rk tab note — the tab's one-line status note. Writes @rk_win_note through
// the shared signal setter (tab_signal.go), stamping the "<unix-epoch>:"
// prefix itself exactly as the /options handler does; reads go through
// `rk tab show`.

import (
	"fmt"
	"io"
	"time"

	"rk/internal/tmux"
	"rk/internal/validate"

	"github.com/spf13/cobra"
)

var tabNoteOffFlag bool

// tabNowFn is the note epoch clock (package-level seam so tests can pin the
// stamped prefix — the presentNowFn pattern).
var tabNowFn = func() int64 { return time.Now().Unix() }

var tabNoteCmd = &cobra.Command{
	Use:   "note [@N] <text> | - | --off",
	Short: "Set or clear the tab's one-line status note",
	Long: "Write @rk_win_note — the one-line status note the sidebar renders.\n" +
		"The text is trimmed and capped at 120 characters with no control\n" +
		"characters; the stored value is \"<unix-epoch>:<text>\" (the CLI owns the\n" +
		"clock) and printed on stdout. Quote multi-word text, or pass - to read\n" +
		"the text from stdin. --off clears the option and prints nothing (also\n" +
		"when already unset). Reads go through 'rk tab show'.",
	Args:         cobra.RangeArgs(0, 2),
	SilenceUsage: true,
	RunE:         runTabNote,
}

func init() {
	tabNoteCmd.Flags().BoolVar(&tabNoteOffFlag, "off", false, "Clear the note (unset @rk_win_note)")
	tabCmd.AddCommand(tabNoteCmd)
	// Arg-count violations are usage-class (exit 2) — wrapped at the add site
	// (tab.go's init runs before this file's).
	tabNoteCmd.Args = usageArgs(tabNoteCmd.Args)
}

func runTabNote(cmd *cobra.Command, args []string) error {
	// A lone "-" value reads all of stdin as the note text (the rk mux send
	// idiom) — resolved BEFORE the shared setter so a read failure stays
	// operational (exit 1), not usage-class.
	if !tabNoteOffFlag {
		for i, a := range args {
			if a == "-" && (len(args) == 1 || i == 1) {
				data, err := io.ReadAll(cmd.InOrStdin())
				if err != nil {
					return fmt.Errorf("read note from stdin: %w", err)
				}
				args[i] = string(data)
			}
		}
	}
	return runTabOptionSet(cmd, args, tmux.NoteOption, tabNoteOffFlag,
		func(v string) (string, string) {
			trimmed, msg := validate.ValidateNoteText(v)
			if msg != "" {
				return "", msg
			}
			if trimmed == "" {
				return "", "note text is empty — use --off to clear"
			}
			return fmt.Sprintf("%d:%s", tabNowFn(), trimmed), ""
		})
}
