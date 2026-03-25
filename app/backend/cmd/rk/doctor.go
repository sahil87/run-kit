package main

import (
	"fmt"
	"os/exec"
	"runtime"

	"rk/internal/tmux"

	"github.com/spf13/cobra"
)

var doctorCmd = &cobra.Command{
	Use:   "doctor",
	Short: "Check runtime dependencies",
	RunE: func(cmd *cobra.Command, args []string) error {
		failed := false

		cmd.Println("Checking runtime dependencies...")

		if _, err := exec.LookPath("tmux"); err != nil {
			hint := "install tmux and ensure it is on PATH"
			if runtime.GOOS == "darwin" {
				hint = "install with: brew install tmux"
			}
			cmd.Printf("  [FAIL] tmux not found — %s\n", hint)
			failed = true
		} else if err := tmux.CheckMinVersion(3, 3); err != nil {
			v, _ := tmux.Version()
			cmd.Printf("  [FAIL] tmux %s — version 3.3+ required for synchronized output\n", v.Raw)
			failed = true
		} else {
			v, _ := tmux.Version()
			cmd.Printf("  [ OK ] tmux %s\n", v.Raw)
		}

		if failed {
			return fmt.Errorf("one or more dependency checks failed")
		}
		cmd.Println("\nAll checks passed.")
		return nil
	},
}
