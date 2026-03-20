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

	"github.com/spf13/cobra"
)

const brewTimeout = 120 * time.Second

var updateCmd = &cobra.Command{
	Use:     "update",
	Aliases: []string{"upgrade"},
	Short:   "Update run-kit to the latest version",
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
			fmt.Printf("run-kit v%s was not installed via Homebrew.\n", version)
			fmt.Println("Update manually, or reinstall with: brew install wvrdz/tap/run-kit")
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

		info := exec.CommandContext(infoCtx, "brew", "info", "--json=v2", "run-kit")
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

		upgrade := exec.CommandContext(upgradeCtx, "brew", "upgrade", "run-kit")
		upgrade.Stdout = os.Stdout
		upgrade.Stderr = os.Stderr
		if err := upgrade.Run(); err != nil {
			return fmt.Errorf("brew upgrade failed: %w", err)
		}

		fmt.Printf("Updated to v%s.\n", latest)
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
