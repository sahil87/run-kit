package main

import (
	"fmt"

	"github.com/spf13/cobra"
)

// urlCmd prints the run-kit server origin resolved for the CALLER,
// newline-terminated, to stdout. It is the stable seam an agent uses to
// discover where the server would bind — the server-URL derivation formerly
// carried by `rk context`.
//
// Resolution precedence (see resolveOrigin): explicit RK_HOST/RK_PORT env in
// the caller's environment wins; inside a tmux pane, the covering server's
// @rk_origin tmux option (stamped by the covering daemon) is read next;
// otherwise the config default (127.0.0.1:3000).
//
// The value is a HEURISTIC, NOT a liveness probe: it does not read a .env
// file, does not check the port owner, and does not confirm a server is
// actually running. (Smarter port-owner discovery is a deferred enhancement;
// this command is the seam that keeps that door open.)
var urlCmd = &cobra.Command{
	Use:   "url",
	Short: "Print the run-kit server URL (env → tmux option → default)",
	Long: "Print the run-kit server URL resolved for this caller. Precedence: " +
		"explicit RK_HOST/RK_PORT env vars win; when run inside a tmux pane, the " +
		"covering tmux server's @rk_origin option (stamped by the run-kit daemon " +
		"covering that server) is used next; otherwise the config default " +
		"(127.0.0.1:3000) applies. This is a heuristic: it reports " +
		"what the server WOULD bind, not proof that a server is running. It " +
		"performs no liveness or port-owner probe.",
	Args:         cobra.NoArgs,
	SilenceUsage: true,
	RunE: func(cmd *cobra.Command, _ []string) error {
		_, err := fmt.Fprintln(cmd.OutOrStdout(), resolveOrigin(cmd.Context()))
		return err
	},
}
