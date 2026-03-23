package main

import (
	"fmt"
	"os/exec"
	"runtime"

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
		} else {
			cmd.Println("  [ OK ] tmux")
		}

		if failed {
			return fmt.Errorf("one or more dependency checks failed")
		}
		cmd.Println("\nAll checks passed.")
		return nil
	},
}
