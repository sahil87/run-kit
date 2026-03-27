package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"rk/internal/daemon"

	"github.com/spf13/cobra"
)

const brewTimeout = 120 * time.Second

var updateCmd = &cobra.Command{
	Use:     "update",
	Aliases: []string{"upgrade"},
	Short:   "Update rk to the latest version",
	RunE: func(cmd *cobra.Command, args []string) error {
		exePath, err := os.Executable()
		if err != nil {
			return fmt.Errorf("could not determine executable path: %w", err)
		}
		resolved, err := filepath.EvalSymlinks(exePath)
		if err != nil {
			resolved = exePath
		}

		if !strings.Contains(resolved, "/Cellar/rk/") {
			fmt.Printf("rk v%s was not installed via Homebrew.\n", version)
			fmt.Println("Update manually (git pull && just build), or reinstall with:")
			fmt.Println("  brew tap wvrdz/tap git@github.com:wvrdz/homebrew-tap.git")
			fmt.Println("  brew install rk")
			return nil
		}

		fmt.Printf("Current version: v%s\n", version)

		// Refresh tap metadata
		updateCtx, updateCancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer updateCancel()

		update := exec.CommandContext(updateCtx, "brew", "update", "--quiet")
		update.Stderr = os.Stderr
		if err := update.Run(); err != nil {
			return fmt.Errorf("could not check for updates (brew update failed): %w", err)
		}

		// Get latest version from Homebrew
		infoCtx, infoCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer infoCancel()

		info := exec.CommandContext(infoCtx, "brew", "info", "--json=v2", "wvrdz/tap/rk")
		infoOut, err := info.Output()
		if err != nil {
			return fmt.Errorf("could not determine latest version: %w", err)
		}

		latest, err := parseBrewVersion(infoOut)
		if err != nil {
			return fmt.Errorf("could not determine latest version: %w", err)
		}

		if latest == version {
			fmt.Printf("Already up to date (v%s).\n", version)
			return nil
		}

		fmt.Printf("Updating v%s → v%s...\n", version, latest)

		upgradeCtx, upgradeCancel := context.WithTimeout(context.Background(), brewTimeout)
		defer upgradeCancel()

		upgrade := exec.CommandContext(upgradeCtx, "brew", "upgrade", "wvrdz/tap/rk")
		upgrade.Stdout = os.Stdout
		upgrade.Stderr = os.Stderr
		if err := upgrade.Run(); err != nil {
			return fmt.Errorf("brew upgrade failed: %w", err)
		}

		fmt.Printf("Updated to v%s.\n", latest)

		// Restart daemon so it picks up the new binary.
		// Idempotent: if no daemon is running, this starts one.
		fmt.Println("Restarting rk daemon...")
		if err := daemon.RestartWithBinary(exePath); err != nil {
			return fmt.Errorf("restarting daemon after upgrade: %w", err)
		}
		fmt.Printf("rk daemon started (%s/%s/%s)\n",
			daemon.ServerSocket, daemon.SessionName, daemon.WindowName)

		return nil
	},
}

// parseBrewVersion extracts the stable version from brew info --json=v2 output.
func parseBrewVersion(data []byte) (string, error) {
	var result struct {
		Formulae []struct {
			Versions struct {
				Stable string `json:"stable"`
			} `json:"versions"`
		} `json:"formulae"`
	}
	if err := json.Unmarshal(data, &result); err != nil {
		return "", err
	}
	if len(result.Formulae) == 0 || result.Formulae[0].Versions.Stable == "" {
		return "", fmt.Errorf("no stable version found")
	}
	return result.Formulae[0].Versions.Stable, nil
}
