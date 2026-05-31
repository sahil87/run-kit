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

// updateSkipBrewUpdate, when true, skips ONLY the internal `brew update --quiet`
// tap-metadata refresh. The version check, "already up to date" short-circuit,
// `brew upgrade`, and daemon restart all still run. Wired to the
// `--skip-brew-update` boolean flag — a cross-toolkit contract shared with the
// other sahil87 tools (flag name and semantics must stay exactly as-is).
var updateSkipBrewUpdate bool

// brewRun streams a `brew <args...>` invocation to stdout/stderr (default
// behavior). restartDaemon restarts the daemon with the given binary. Both are
// package-level seams swapped in tests — mirroring the findPortOwner /
// innerServePIDFn pattern in this package — so the update flow can be exercised
// without spawning real Homebrew or a real tmux daemon. The defaults preserve
// the exact subprocess style used everywhere else in this command.
var (
	brewRun = func(ctx context.Context, args ...string) error {
		cmd := exec.CommandContext(ctx, "brew", args...)
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
		return cmd.Run()
	}
	brewOutput = func(ctx context.Context, args ...string) ([]byte, error) {
		return exec.CommandContext(ctx, "brew", args...).Output()
	}
	restartDaemon = daemon.RestartWithBinary
	osExecutable  = os.Executable
)

var updateCmd = &cobra.Command{
	Use:     "update",
	Aliases: []string{"upgrade"},
	Short:   "Update rk to the latest version",
	RunE: func(cmd *cobra.Command, args []string) error {
		exePath, err := osExecutable()
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
			fmt.Println("  brew tap sahil87/tap")
			fmt.Println("  brew install rk")
			return nil
		}

		fmt.Printf("Current version: v%s\n", version)

		// Refresh tap metadata, unless --skip-brew-update was passed. Skipping
		// touches ONLY this step; the version check, upgrade, and daemon
		// restart below all run regardless.
		if updateSkipBrewUpdate {
			fmt.Println("Skipping brew update (--skip-brew-update).")
		} else {
			updateCtx, updateCancel := context.WithTimeout(context.Background(), 30*time.Second)
			if err := brewRun(updateCtx, "update", "--quiet"); err != nil {
				updateCancel()
				return fmt.Errorf("could not check for updates (brew update failed): %w", err)
			}
			updateCancel()
		}

		// Get latest version from Homebrew
		infoCtx, infoCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer infoCancel()

		infoOut, err := brewOutput(infoCtx, "info", "--json=v2", "sahil87/tap/rk")
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

		if err := brewRun(upgradeCtx, "upgrade", "sahil87/tap/rk"); err != nil {
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
		if err := restartDaemon(brewBinPath); err != nil {
			return fmt.Errorf("restarting daemon after upgrade: %w", err)
		}
		fmt.Printf("rk daemon started (%s/%s/%s)\n",
			daemon.ServerSocket, daemon.SessionName, daemon.WindowName)

		return nil
	},
}

func init() {
	updateCmd.Flags().BoolVar(&updateSkipBrewUpdate, "skip-brew-update", false,
		"Skip the internal 'brew update' tap-metadata refresh (version check, upgrade, and daemon restart still run)")
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
