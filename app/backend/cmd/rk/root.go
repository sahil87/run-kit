package main

import (
	"os"
	"strings"

	"github.com/spf13/cobra"
)

// version is set at build time via ldflags: -X main.version=...
var version = "dev"

// displayVersion prefixes a numeric version with "v" to match the sahil87
// toolkit standard (e.g. "rk version v1.5.3"). The "dev" sentinel used for
// non-ldflags builds is left untouched so we don't end up with "vdev".
func displayVersion() string {
	if version == "dev" || strings.HasPrefix(version, "v") {
		return version
	}
	return "v" + version
}

var rootCmd = &cobra.Command{
	Use:     "rk",
	Short:   "rk — tmux session manager with web UI",
	Version: displayVersion(),
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
	rootCmd.AddCommand(daemonCmd)
	rootCmd.AddCommand(initConfCmd)
	rootCmd.AddCommand(contextCmd)
	rootCmd.AddCommand(notifyCmd)
	rootCmd.AddCommand(agentSetupCmd)
	rootCmd.AddCommand(agentHookCmd)
	rootCmd.AddCommand(riffCmd)
	rootCmd.AddCommand(reaperCmd)
	rootCmd.AddCommand(newShellInitCmd())
	rootCmd.AddCommand(helpDumpCmd)
}

func execute() {
	if err := rootCmd.Execute(); err != nil {
		os.Exit(1)
	}
}
