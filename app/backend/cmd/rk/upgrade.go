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

// skipBrewUpdate is bound to the --skip-brew-update flag (registered in init).
// When true, the update command skips ONLY the internal `brew update --quiet`
// tap-metadata refresh; all other behavior (version check, upgrade, daemon
// restart) is unchanged.
var skipBrewUpdate bool

// runBrewFn is the package-level seam for invoking `brew`. All three call sites
// (update, info, upgrade) route through it so tests can observe which brew
// subcommands ran without spawning a real `brew`. The default impl preserves
// today's exact stdout/stderr wiring per subcommand:
//   - update  → streams to os.Stderr only (returns no captured bytes)
//   - upgrade → streams to os.Stdout + os.Stderr (returns no captured bytes)
//   - info    → captures stdout via .Output() and returns the bytes
//
// It does NOT change the exec.CommandContext calling style — it only relocates
// it behind a var, matching the daemon_start.go innerServePIDFn idiom.
//
// Per-subcommand stdout/stderr wiring is keyed on args[0]; a new brew
// subcommand not matched here inherits the default (Stderr-only) wiring.
var runBrewFn = func(ctx context.Context, args ...string) ([]byte, error) {
	cmd := exec.CommandContext(ctx, "brew", args...)
	if len(args) > 0 && args[0] == "info" {
		return cmd.Output()
	}
	cmd.Stderr = os.Stderr
	if len(args) > 0 && args[0] == "upgrade" {
		cmd.Stdout = os.Stdout
	}
	return nil, cmd.Run()
}

// restartDaemonFn is the package-level seam for the post-upgrade daemon
// restart. Defaults to the real daemon.RestartWithBinary so tests can record
// the call without restarting a real daemon. Mirrors innerServePIDFn.
var restartDaemonFn = daemon.RestartWithBinary

// resolveExeFn is the package-level seam for resolving this binary's on-disk
// path (used to detect a Homebrew install via the /Cellar/rk/ marker). Defaults
// to os.Executable + EvalSymlinks; tests stub it to return a synthetic Cellar
// path so the upgrade/restart code path is reachable independent of the test
// binary's real location.
var resolveExeFn = func() (string, error) {
	exePath, err := os.Executable()
	if err != nil {
		return "", err
	}
	resolved, err := filepath.EvalSymlinks(exePath)
	if err != nil {
		resolved = exePath
	}
	return resolved, nil
}

func init() {
	updateCmd.Flags().BoolVar(&skipBrewUpdate, "skip-brew-update", false,
		"Skip the internal 'brew update' tap-metadata refresh (still runs brew info/upgrade and restarts the daemon)")
}

var updateCmd = &cobra.Command{
	Use:     "update",
	Aliases: []string{"upgrade"},
	Short:   "Update rk to the latest version",
	RunE: func(cmd *cobra.Command, args []string) error {
		resolved, err := resolveExeFn()
		if err != nil {
			return fmt.Errorf("could not determine executable path: %w", err)
		}

		if !strings.Contains(resolved, "/Cellar/rk/") {
			fmt.Printf("rk v%s was not installed via Homebrew.\n", version)
			fmt.Println("Update manually (git pull && just build), or reinstall with:")
			fmt.Println("  brew tap sahil87/tap")
			fmt.Println("  brew install rk")
			return nil
		}

		fmt.Printf("Current version: v%s\n", version)

		// Refresh tap metadata (skippable via --skip-brew-update).
		if !skipBrewUpdate {
			updateCtx, updateCancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer updateCancel()

			if _, err := runBrewFn(updateCtx, "update", "--quiet"); err != nil {
				return fmt.Errorf("could not check for updates (brew update failed): %w", err)
			}
		}

		// Get latest version from Homebrew
		infoCtx, infoCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer infoCancel()

		infoOut, err := runBrewFn(infoCtx, "info", "--json=v2", "sahil87/tap/rk")
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

		if _, err := runBrewFn(upgradeCtx, "upgrade", "sahil87/tap/rk"); err != nil {
			return fmt.Errorf("brew upgrade failed: %w", err)
		}

		fmt.Printf("Updated to v%s.\n", latest)

		// Derive the stable Homebrew bin symlink from the Cellar path.
		// resolved is e.g. /opt/homebrew/Cellar/rk/0.5.3/bin/rk
		// We want:         /opt/homebrew/bin/rk
		cellarIdx := strings.Index(resolved, "/Cellar/rk/")
		if cellarIdx == -1 {
			return fmt.Errorf("could not derive brew prefix from %s", resolved)
		}
		brewBinPath := resolved[:cellarIdx] + "/bin/rk"

		// Restart daemon so it picks up the new binary.
		// Idempotent: if no daemon is running, this starts one.
		fmt.Println("Restarting rk daemon...")
		if err := restartDaemonFn(brewBinPath); err != nil {
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
