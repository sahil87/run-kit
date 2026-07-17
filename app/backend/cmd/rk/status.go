package main

import (
	"context"
	"encoding/json"
	"fmt"

	"rk/internal/tmux"

	"github.com/spf13/cobra"
)

// statusJSON requests machine-readable output on stdout instead of the human
// summary. Principle 2 (stdout is data): status output is meant to be consumed
// programmatically, so it offers a stable --json format.
var statusJSON bool

// statusSession is one entry in the --json document. The shape is a stable,
// versionless contract for callers: session name plus its window count. New
// fields, if ever added, are added as optional so consumers never break.
type statusSession struct {
	Name    string `json:"name"`
	Windows int    `json:"windows"`
}

var statusCmd = &cobra.Command{
	Use:   "status",
	Short: "Show tmux session summary",
	RunE: func(cmd *cobra.Command, args []string) error {
		ctx := cmd.Context()
		server := "runkit"
		sessions, err := tmux.ListSessions(ctx, server)
		if err != nil {
			return fmt.Errorf("listing sessions: %w", err)
		}

		if statusJSON {
			return writeSessionStatusJSON(ctx, cmd, server, sessions)
		}

		if len(sessions) == 0 {
			fmt.Fprintln(cmd.OutOrStdout(), "No tmux sessions found")
			return nil
		}

		for _, s := range sessions {
			windows, err := tmux.ListWindows(ctx, s.Name, server)
			if err != nil {
				fmt.Fprintf(cmd.OutOrStdout(), "  %s (error listing windows)\n", s.Name)
				continue
			}
			fmt.Fprintf(cmd.OutOrStdout(), "  %s (%d windows)\n", s.Name, len(windows))
		}

		return nil
	},
}

// writeSessionStatusJSON emits the session summary as a JSON array to stdout. Unlike
// the human path (which prints a per-session error line and continues), a
// window-listing failure here fails the whole command with a non-zero exit and
// a stderr error — a machine consumer must never receive a partial document it
// would parse as complete.
func writeSessionStatusJSON(ctx context.Context, cmd *cobra.Command, server string, sessions []tmux.SessionInfo) error {
	out := make([]statusSession, 0, len(sessions))
	for _, s := range sessions {
		windows, err := tmux.ListWindows(ctx, s.Name, server)
		if err != nil {
			return fmt.Errorf("listing windows for session %q: %w", s.Name, err)
		}
		out = append(out, statusSession{Name: s.Name, Windows: len(windows)})
	}

	data, err := json.MarshalIndent(out, "", "  ")
	if err != nil {
		return fmt.Errorf("encoding status JSON: %w", err)
	}
	fmt.Fprintln(cmd.OutOrStdout(), string(data))
	return nil
}

func init() {
	statusCmd.Flags().BoolVar(&statusJSON, "json", false, "Emit the session summary as JSON to stdout")
}
