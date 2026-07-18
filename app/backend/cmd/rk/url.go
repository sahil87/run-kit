package main

import (
	"fmt"

	"rk/internal/config"

	"github.com/spf13/cobra"
)

// urlCmd prints the run-kit server URL derived from config (RK_HOST/RK_PORT env
// vars with 127.0.0.1:3000 defaults), newline-terminated, to stdout. It is the
// stable seam an agent uses to discover where the server would bind — the
// server-URL derivation formerly carried by `rk context`.
//
// The value is a CONFIG-DERIVED HEURISTIC — what the server would bind given
// this environment — NOT a liveness probe: it does not read a .env file, does
// not check the port owner, and does not confirm a server is actually running.
// (Smarter port-owner discovery is a deferred enhancement; this command is the
// seam that keeps that door open.)
var urlCmd = &cobra.Command{
	Use:   "url",
	Short: "Print the run-kit server URL (config-derived)",
	Long: "Print the run-kit server URL derived from configuration — RK_HOST and " +
		"RK_PORT (defaults 127.0.0.1:3000). This is a config-derived heuristic: it " +
		"reports what the server WOULD bind given this environment, not proof that a " +
		"server is running. It performs no liveness or port-owner probe.",
	Args:         cobra.NoArgs,
	SilenceUsage: true,
	RunE: func(cmd *cobra.Command, _ []string) error {
		cfg := config.Load()
		_, err := fmt.Fprintf(cmd.OutOrStdout(), "http://%s:%d\n", cfg.Host, cfg.Port)
		return err
	},
}
