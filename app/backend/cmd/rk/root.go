package main

import (
	"os"

	"github.com/spf13/cobra"
)

// version is set at build time via ldflags: -X main.version=...
var version = "dev"

var rootCmd = &cobra.Command{
	Use:     "rk",
	Short:   "rk — tmux session manager with web UI",
	Version: version,
	// No-args invocation defaults to serve (backwards compat).
	RunE: func(cmd *cobra.Command, args []string) error {
		return serveCmd.RunE(cmd, args)
	},
	SilenceUsage: true,
}

func init() {
	rootCmd.AddCommand(serveCmd)
	rootCmd.AddCommand(updateCmd)
	rootCmd.AddCommand(doctorCmd)
	rootCmd.AddCommand(statusCmd)
	rootCmd.AddCommand(initConfCmd)
	rootCmd.AddCommand(contextCmd)
	rootCmd.AddCommand(riffCmd)
}

func execute() {
	if err := rootCmd.Execute(); err != nil {
		os.Exit(1)
	}
}
