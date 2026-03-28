package main

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/spf13/cobra"
	"rk/internal/tmux"
)

var initConfForce bool

var initConfCmd = &cobra.Command{
	Use:   "init-conf",
	Short: "Scaffold default tmux.conf to ~/.rk/tmux.conf",
	RunE: func(cmd *cobra.Command, args []string) error {
		dest := tmux.DefaultConfigPath
		if dest == "" {
			return fmt.Errorf("could not determine home directory")
		}

		if !initConfForce {
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

		fmt.Printf("Wrote %s\n", dest)
		return nil
	},
}

func init() {
	initConfCmd.Flags().BoolVar(&initConfForce, "force", false, "Overwrite existing config")
}
