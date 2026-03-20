package main

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/spf13/cobra"
)

const brewTimeout = 120 * time.Second

var upgradeCmd = &cobra.Command{
	Use:   "upgrade",
	Short: "Upgrade run-kit to the latest version",
	RunE: func(cmd *cobra.Command, args []string) error {
		exePath, err := os.Executable()
		if err != nil {
			return fmt.Errorf("could not determine executable path: %w", err)
		}
		resolved, err := filepath.EvalSymlinks(exePath)
		if err != nil {
			resolved = exePath
		}

		if !strings.Contains(resolved, "/Cellar/run-kit/") {
			fmt.Println("Local install detected. Run: git pull && just build")
			return nil
		}

		fmt.Printf("run-kit version %s (Homebrew)\n", version)
		fmt.Println("Updating Homebrew...")

		updateCtx, updateCancel := context.WithTimeout(context.Background(), brewTimeout)
		defer updateCancel()

		update := exec.CommandContext(updateCtx, "brew", "update")
		update.Stdout = os.Stdout
		update.Stderr = os.Stderr
		if err := update.Run(); err != nil {
			return fmt.Errorf("brew update failed: %w", err)
		}

		fmt.Println("Upgrading run-kit...")

		upgradeCtx, upgradeCancel := context.WithTimeout(context.Background(), brewTimeout)
		defer upgradeCancel()

		upgrade := exec.CommandContext(upgradeCtx, "brew", "upgrade", "run-kit")
		upgrade.Stdout = os.Stdout
		upgrade.Stderr = os.Stderr
		if err := upgrade.Run(); err != nil {
			return fmt.Errorf("brew upgrade failed: %w", err)
		}

		fmt.Println("Upgrade complete.")
		return nil
	},
}
