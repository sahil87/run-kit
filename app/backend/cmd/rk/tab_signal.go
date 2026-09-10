package main

// rk tab signal verbs — the shared setter behind mark/note/color/flair/owner:
// each writes one validated @rk_win_* window option through the family's
// tabSetWindowOptionsFn seam. One helper carries the whole contract (arg
// shape, validation-before-write, datum output, SSE wake) so the five verbs
// cannot drift apart.

import (
	"context"
	"fmt"

	"rk/internal/tmux"

	"github.com/spf13/cobra"
)

// runTabOptionSet is the shared body of the rk tab signal setter verbs.
// Argument shape (cobra RangeArgs(0, 2), wrapped by usageArgs at the add
// site): two positionals are address then value; one positional is the value
// (own tab), or the address when --off is set; zero positionals requires
// --off. --off with a value is a usage error. validate maps the raw argument
// to the STORED string (color normalizes; note stamps its epoch) or returns a
// user-facing message, which the helper surfaces as usage-class (exit 2)
// before any tmux write. A set prints the stored datum via sink.Dataf; --off
// prints nothing (the web rm/select idiom). The fail-silent SSE wake fires
// after a successful set/unset, never on failure.
func runTabOptionSet(cmd *cobra.Command, args []string, option string, off bool, validateFn func(value string) (stored string, errMsg string)) error {
	var addrArg string
	var op tmux.WindowOptionOp

	if off {
		if len(args) == 2 {
			return usageError(fmt.Errorf("--off takes no value"))
		}
		if len(args) == 1 {
			addrArg = args[0]
		}
		op = tmux.WindowOptionOp{Key: option, Value: nil}
	} else {
		var valueArg string
		switch len(args) {
		case 0:
			return usageError(fmt.Errorf("a value is required (use --off to clear)"))
		case 1:
			valueArg = args[0]
		default:
			addrArg, valueArg = args[0], args[1]
		}
		stored, errMsg := validateFn(valueArg)
		if errMsg != "" {
			return usageError(fmt.Errorf("%s", errMsg))
		}
		op = tmux.WindowOptionOp{Key: option, Value: &stored}
	}

	ctx := tabContext(cmd)
	_, windowID, server, err := resolveTabAddr(ctx, addrArg, tabServerFlag)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, tabCmdTimeout)
	defer cancel()
	if err := tabSetWindowOptionsFn(ctx, windowID, server, []tmux.WindowOptionOp{op}); err != nil {
		return err
	}
	if op.Value != nil {
		newSink(cmd).Dataf("%s\n", *op.Value)
	}
	tabWakeFn(ctx, server)
	return nil
}
