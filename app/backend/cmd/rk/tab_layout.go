package main

// rk tab layout — read or mutate a tab's @rk_win_layout. The verbs are
// internal/layoutspec's pure port of the frontend mutations, so agent and
// human go through one growth/collapse table. An unset or unparseable stored
// value reads as layoutspec.Default() (single:tty — the frontend's
// effectiveLayout fallback) and is REPLACED on write, never an error
// (Constitution II degrade rule).

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"rk/internal/layoutspec"
	"rk/internal/tmux"

	"github.com/spf13/cobra"
)

var (
	tabLayoutAddFlag     string
	tabLayoutRmFlag      string
	tabLayoutPromoteFlag string
	tabLayoutCycleFlag   bool
)

var tabLayoutCmd = &cobra.Command{
	Use:   "layout [@N] [L | --add S | --rm S | --promote S | --cycle]",
	Short: "Read or mutate a tab's surface layout",
	Long: "Read or mutate a tab's @rk_win_layout (<shape>:<surface,…>).\n\n" +
		"With a positional value the layout is SET (validated; malformed is a\n" +
		"usage error). The flag forms mutate the current value through the shared\n" +
		"layout table: --add appends a surface (1→2 split-h, 2→3 main-left),\n" +
		"--rm removes one (3→2 split-h, 2→1 single), --promote moves one to slot\n" +
		"A, --cycle walks the same-arity shape presets. Exactly one form may be\n" +
		"given. With neither, the effective layout prints and nothing is written.\n\n" +
		"An unset or unparseable stored value reads as single:tty. Every mutating\n" +
		"form prints the resulting layout value on stdout.",
	Args:         cobra.MaximumNArgs(2),
	SilenceUsage: true,
	RunE:         runTabLayout,
}

func init() {
	tabLayoutCmd.Flags().StringVar(&tabLayoutAddFlag, "add", "",
		"Append a surface to the layout (grows the shape)")
	tabLayoutCmd.Flags().StringVar(&tabLayoutRmFlag, "rm", "",
		"Remove a surface from the layout (collapses the shape)")
	tabLayoutCmd.Flags().StringVar(&tabLayoutPromoteFlag, "promote", "",
		"Move a surface to slot A")
	tabLayoutCmd.Flags().BoolVar(&tabLayoutCycleFlag, "cycle", false,
		"Cycle to the next same-arity shape preset")
	tabLayoutCmd.MarkFlagsMutuallyExclusive("add", "rm", "promote", "cycle")
}

// layoutSentinelError maps a layoutspec sentinel to its exit class:
// ErrUnknownSurface is user input (usage, exit 2); the rest are operational
// (exit 1).
func layoutSentinelError(err error) error {
	switch {
	case errors.Is(err, layoutspec.ErrUnknownSurface):
		return usageError(err)
	default:
		return err
	}
}

func runTabLayout(cmd *cobra.Command, args []string) error {
	addrArg := ""
	value := ""
	switch len(args) {
	case 1:
		// One bare argument is the layout value to set (layoutspec decides);
		// a leading-@ or leading-= argument is the address, read-only form.
		if strings.HasPrefix(args[0], "@") || strings.HasPrefix(args[0], "=") {
			addrArg = args[0]
		} else {
			value = args[0]
		}
	case 2:
		addrArg, value = args[0], args[1]
	}

	mutating := value != "" || tabLayoutAddFlag != "" || tabLayoutRmFlag != "" ||
		tabLayoutPromoteFlag != "" || tabLayoutCycleFlag
	if value != "" && (tabLayoutAddFlag != "" || tabLayoutRmFlag != "" ||
		tabLayoutPromoteFlag != "" || tabLayoutCycleFlag) {
		return usageError(fmt.Errorf("give exactly one of a positional layout, --add, --rm, --promote, or --cycle"))
	}

	ctx := tabContext(cmd)
	_, windowID, server, err := resolveTabAddr(ctx, addrArg)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, tabCmdTimeout)
	defer cancel()
	sink := newSink(cmd)

	if value != "" {
		parsed, err := layoutspec.Parse(value)
		if err != nil {
			return usageError(err)
		}
		v := parsed.String()
		if err := webSetWindowOptionsFn(ctx, windowID, server, []tmux.WindowOptionOp{{Key: tmux.LayoutOption, Value: &v}}); err != nil {
			return err
		}
		sink.Dataf("%s\n", v)
		return nil
	}

	raw, err := tmux.GetWindowOption(ctx, windowID, server, tmux.LayoutOption)
	if err != nil {
		return err
	}
	layout, lerr := layoutspec.Parse(raw)
	if lerr != nil {
		if raw != "" {
			sink.Notef("replacing unparseable @rk_win_layout %q with %s\n", raw, layoutspec.Default())
		}
		layout = layoutspec.Default()
	}

	if !mutating {
		sink.Dataf("%s\n", layout.String())
		return nil
	}

	var next layoutspec.Layout
	switch {
	case tabLayoutAddFlag != "":
		next, err = layoutspec.Add(layout, tabLayoutAddFlag)
	case tabLayoutRmFlag != "":
		next, err = layoutspec.Close(layout, tabLayoutRmFlag)
	case tabLayoutPromoteFlag != "":
		if !layout.Has(tabLayoutPromoteFlag) {
			if !layoutspec.IsSurface(tabLayoutPromoteFlag) {
				err = fmt.Errorf("%w: %q", layoutspec.ErrUnknownSurface, tabLayoutPromoteFlag)
			} else {
				err = fmt.Errorf("%w: %q", layoutspec.ErrSurfaceAbsent, tabLayoutPromoteFlag)
			}
		} else {
			next = layoutspec.Promote(layout, tabLayoutPromoteFlag)
		}
	case tabLayoutCycleFlag:
		next = layoutspec.Cycle(layout)
	}
	if err != nil {
		return layoutSentinelError(err)
	}

	v := next.String()
	if err := webSetWindowOptionsFn(ctx, windowID, server, []tmux.WindowOptionOp{{Key: tmux.LayoutOption, Value: &v}}); err != nil {
		return err
	}
	sink.Dataf("%s\n", v)
	return nil
}
