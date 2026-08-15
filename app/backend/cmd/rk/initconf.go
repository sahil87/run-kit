package main

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/spf13/cobra"
	"rk/internal/tmux"
)

// newInitConfCmd builds one instance of the init-conf command. A cobra command
// object cannot have two parents, so the family member (`rk mux init-conf`)
// and the hidden root alias (`rk init-conf`) are two instances sharing the same
// RunE core; the flag variable binds per-instance so the two never share state.
// deprecated marks the root alias: hidden from help, and cobra prints the
// pointer (to OutOrStderr — stderr in production) before still running the
// command with identical flags and exit codes.
func newInitConfCmd(use string, deprecated bool) *cobra.Command {
	var force bool

	c := &cobra.Command{
		Use:   use,
		Short: "Scaffold default tmux.conf and tmux.d/ drop-in directory to ~/.rk/",
		RunE: func(cmd *cobra.Command, args []string) error {
			if err := muxRejectInheritedServerFlag(cmd); err != nil {
				return err
			}
			dest := tmux.DefaultConfigPath
			if dest == "" {
				return fmt.Errorf("could not determine home directory")
			}

			if !force {
				if _, err := os.Stat(dest); err == nil {
					return fmt.Errorf("%s already exists (use --force to overwrite)", dest)
				}
			}

			if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
				return fmt.Errorf("creating directory: %w", err)
			}

			if err := os.WriteFile(dest, tmux.DefaultConfigBytes(), 0o644); err != nil {
				return fmt.Errorf("writing config: %w", err)
			}

			// Create drop-in config directory alongside the config file.
			dropInDir := filepath.Join(filepath.Dir(dest), "tmux.d")
			if err := os.MkdirAll(dropInDir, 0o755); err != nil {
				return fmt.Errorf("creating tmux.d directory: %w", err)
			}

			fmt.Fprintf(cmd.OutOrStdout(), "Wrote %s\n", dest)
			fmt.Fprintf(cmd.OutOrStdout(), "Drop-in configs: %s/*.conf\n", dropInDir)
			return nil
		},
	}
	c.Flags().BoolVar(&force, "force", false, "Overwrite existing config")
	if deprecated {
		c.Hidden = true
		c.Deprecated = "use `rk mux init-conf` instead"
	}
	return c
}

var (
	// initConfFamilyCmd is the `rk mux init-conf` family member.
	initConfFamilyCmd = newInitConfCmd("init-conf", false)
	// initConfAliasCmd is the hidden deprecation alias kept at the root so the
	// old human-typed form keeps working while pointing at the new one.
	initConfAliasCmd = newInitConfCmd("init-conf", true)
)
