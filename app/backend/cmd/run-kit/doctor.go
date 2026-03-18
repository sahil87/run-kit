package main

import (
	"fmt"
	"os"
	"os/exec"

	"github.com/spf13/cobra"
)

var doctorCmd = &cobra.Command{
	Use:   "doctor",
	Short: "Check runtime dependencies",
	Run: func(cmd *cobra.Command, args []string) {
		exitCode := 0

		fmt.Println("Checking runtime dependencies...")

		if _, err := exec.LookPath("tmux"); err != nil {
			fmt.Println("  [FAIL] tmux not found — install with: brew install tmux")
			exitCode = 1
		} else {
			fmt.Println("  [ OK ] tmux")
		}

		if exitCode != 0 {
			os.Exit(1)
		}
		fmt.Println("\nAll checks passed.")
	},
}
