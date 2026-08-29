package main

// rk tab code — the code surface's folder. `set` writes @rk_win_code_root
// (the folder the code surface opens, and the --folder source for
// `rk code exec --tab`). Reads go through `rk tab show`.

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"rk/internal/tmux"

	"github.com/spf13/cobra"
)

var tabCodeCmd = &cobra.Command{
	Use:   "code",
	Short: "Set the code surface's folder",
	Long: "Manage the tab's code surface. 'set' writes @rk_win_code_root — the\n" +
		"folder the code surface opens and the folder 'rk code exec --tab'\n" +
		"resolves its host by. Reads go through 'rk tab show'.\n\n" +
		"See 'rk tab code <subcommand> --help' for details.",
}

var tabCodeSetCmd = &cobra.Command{
	Use:   "set [@N] <folder>",
	Short: "Point the tab's code surface at a folder",
	Long: "Write @rk_win_code_root to the given folder, resolved to an absolute\n" +
		"path against the cwd. The folder must exist and be a directory. Prints\n" +
		"the absolute path on stdout; a missing or non-directory path is an\n" +
		"operational failure and the option is untouched.",
	Args:         cobra.RangeArgs(1, 2),
	SilenceUsage: true,
	RunE:         runTabCodeSet,
}

func init() {
	tabCodeCmd.AddCommand(tabCodeSetCmd)
	// Arg-count violations are usage-class (exit 2) — wrapped at the add site.
	for _, c := range tabCodeCmd.Commands() {
		if c.Args != nil {
			c.Args = usageArgs(c.Args)
		}
	}
}

func runTabCodeSet(cmd *cobra.Command, args []string) error {
	folderArg := args[0]
	addrArg := ""
	if len(args) == 2 {
		addrArg, folderArg = args[0], args[1]
	}

	abs, err := filepath.Abs(folderArg)
	if err != nil {
		return fmt.Errorf("resolve %q: %w", folderArg, err)
	}
	info, err := os.Stat(abs)
	if err != nil {
		return fmt.Errorf("folder %q does not exist", folderArg)
	}
	if !info.IsDir() {
		return fmt.Errorf("folder %q is not a directory", folderArg)
	}

	ctx := tabContext(cmd)
	_, windowID, server, err := resolveTabAddr(ctx, addrArg, tabServerFlag)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, tabCmdTimeout)
	defer cancel()
	if err := tabSetWindowOptionsFn(ctx, windowID, server, []tmux.WindowOptionOp{{Key: tmux.CodeRootOption, Value: &abs}}); err != nil {
		return err
	}
	newSink(cmd).Dataf("%s\n", abs)
	return nil
}
