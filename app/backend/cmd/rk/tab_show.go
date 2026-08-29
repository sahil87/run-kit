package main

// rk tab show — dump every @rk_win_* option of a tab in one read (the
// internal/tmux ShowWindowOptions primitive), human key-value rows or --json.

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"text/tabwriter"

	"rk/internal/tmux"

	"github.com/spf13/cobra"
)

var _ = context.Background // tabContext's return type anchors the import

var tabShowJSONFlag bool

var tabShowCmd = &cobra.Command{
	Use:   "show [@N] [--json]",
	Short: "Dump every @rk_win_* option of a tab",
	Long: "Dump a tab's @rk_win_* tmux options (layout, web-tab family, code root)\n" +
		"in one read: key<TAB>value rows sorted by key, so 'rk tab show | grep web_'\n" +
		"works. --json prints the flat object. An empty tab prints nothing and\n" +
		"exits 0 — an unset tab is a state, not an error.",
	Args:         cobra.MaximumNArgs(1),
	SilenceUsage: true,
	RunE:         runTabShow,
}

func init() {
	tabShowCmd.Flags().BoolVar(&tabShowJSONFlag, "json", false,
		"Print the options as a flat JSON object")
}

func runTabShow(cmd *cobra.Command, args []string) error {
	addrArg := ""
	if len(args) == 1 {
		addrArg = args[0]
	}
	ctx := tabContext(cmd)
	_, windowID, server, err := resolveTabAddr(ctx, addrArg)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, tabCmdTimeout)
	defer cancel()
	opts, err := tmux.ShowWindowOptions(ctx, windowID, server)
	if err != nil {
		return err
	}

	sink := newSink(cmd)
	if tabShowJSONFlag {
		b, err := json.Marshal(opts)
		if err != nil {
			return fmt.Errorf("encoding window options: %w", err)
		}
		sink.Dataf("%s\n", b)
		return nil
	}

	if len(opts) == 0 {
		return nil
	}
	keys := make([]string, 0, len(opts))
	for k := range opts {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var buf strings.Builder
	tw := tabwriter.NewWriter(&buf, 0, 0, 2, ' ', 0)
	for _, k := range keys {
		fmt.Fprintf(tw, "%s\t%s\n", k, opts[k])
	}
	if err := tw.Flush(); err != nil {
		return err
	}
	sink.Dataf("%s", buf.String())
	return nil
}
