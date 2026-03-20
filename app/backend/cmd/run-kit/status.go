package main

import (
	"fmt"

	"run-kit/internal/tmux"

	"github.com/spf13/cobra"
)

var statusCmd = &cobra.Command{
	Use:   "status",
	Short: "Show tmux session summary",
	RunE: func(cmd *cobra.Command, args []string) error {
		server := "runkit"
		sessions, err := tmux.ListSessions(server)
		if err != nil {
			return fmt.Errorf("listing sessions: %w", err)
		}

		if len(sessions) == 0 {
			fmt.Println("No tmux sessions found")
			return nil
		}

		for _, s := range sessions {
			windows, err := tmux.ListWindows(s.Name, server)
			if err != nil {
				fmt.Printf("  %s (error listing windows)\n", s.Name)
				continue
			}
			fmt.Printf("  %s (%d windows)\n", s.Name, len(windows))
		}

		return nil
	},
}
