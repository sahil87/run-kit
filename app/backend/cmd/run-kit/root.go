package main

import (
	"os"

	"github.com/spf13/cobra"
)

// version is set at build time via ldflags: -X main.version=...
var version = "dev"

var rootCmd = &cobra.Command{
	Use:   "run-kit",
	Short: "run-kit — tmux session manager with web UI",
	// No-args invocation defaults to serve (backwards compat).
	RunE: func(cmd *cobra.Command, args []string) error {
		return serveCmd.RunE(cmd, args)
	},
	SilenceUsage: true,
}

func init() {
	rootCmd.AddCommand(serveCmd)
	rootCmd.AddCommand(versionCmd)
	rootCmd.AddCommand(upgradeCmd)
	rootCmd.AddCommand(doctorCmd)
	rootCmd.AddCommand(statusCmd)
}

func execute() {
	if err := rootCmd.Execute(); err != nil {
		os.Exit(1)
	}
}
