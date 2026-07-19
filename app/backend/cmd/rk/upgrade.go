package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
	"syscall"
	"time"

	"rk/internal/daemon"
	"rk/internal/selfpath"

	"github.com/spf13/cobra"
)

// Brew-mutation bounds (shll update standard, brew-handling safety clause):
// brew mutations are NOT interruptible without damage — a keg swap runs
// `brew unlink` then `brew link`, and a process killed between them leaves the
// tool half-installed. brew can also legitimately block for minutes on the
// network (Homebrew 6 makes an un-timed api.github.com call inside every
// tap-formula upgrade; observed 2026-07-19: a 120s hard kill landed mid-swap
// and corrupted the keg). So any bound on a mutating brew subcommand MUST be
// generous — sized for a network transfer, never a short hard cap — and
// terminate gracefully (SIGTERM + grace, see newBrewCmd), per the standard's
// "MUST NOT impose a short hard timeout on brew upgrade" / "MUST NOT send
// SIGKILL to a package-manager subprocess mid-transaction". Timeouts are kept
// at all (rather than unbounded) per Constitution § Process Execution.
const (
	// brewUpgradeTimeout bounds `brew upgrade` — the keg-swapping mutation.
	brewUpgradeTimeout = 30 * time.Minute
	// brewUpdateTimeout bounds `brew update` — also a network-bound
	// package-manager mutation with the same stall profile.
	brewUpdateTimeout = 10 * time.Minute
	// brewCancelGrace is the WaitDelay window a mutating brew subprocess gets
	// between SIGTERM (on context expiry) and the runtime's final kill —
	// enough for brew to unwind a keg swap cleanly.
	brewCancelGrace = 30 * time.Second
)

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
// Command construction goes through newBrewCmd, which configures graceful
// cancellation (SIGTERM + WaitDelay grace) for the mutating subcommands —
// see its doc comment. The seam itself only relocates the call behind a var,
// matching the daemon_start.go innerServePIDFn idiom.
//
// Per-subcommand stdout/stderr wiring is keyed on args[0]; a new brew
// subcommand not matched here inherits the default (Stderr-only) wiring.
//
// Quiet (Toolkit Principle 9): the streamed brew subprocess output is the
// definitional "raw brew output" chatter — under --quiet the streams are
// suppressed so nothing but data + errors survives. The default impl reads the
// package-level `quiet` var (set by cobra flag parsing via root.go's
// PersistentFlags BoolVar), keeping the seam signature unchanged so tests still
// observe calls without a real brew. The `info` path is unaffected — it captures
// stdout via .Output() rather than streaming, and its bytes are data (the
// version lookup), not chatter.
//
// Under --quiet the suppressed brew stderr is BUFFERED rather than discarded and,
// on a non-zero exit, its captured detail is wrapped into the returned error
// (R2's errors-always-survive rule): otherwise a failing `rk update --quiet`
// would surface only "exit status 1" with all diagnostics destroyed. Non-quiet
// runs keep streaming stderr live — the detail is already on the terminal, so
// the bare exit error suffices.
var runBrewFn = func(ctx context.Context, args ...string) ([]byte, error) {
	cmd := newBrewCmd(ctx, args...)
	if len(args) > 0 && args[0] == "info" {
		return cmd.Output()
	}
	stdout, stderr, errBuf := brewStreams(quiet)
	cmd.Stderr = stderr
	if len(args) > 0 && args[0] == "upgrade" {
		cmd.Stdout = stdout
	}
	err := cmd.Run()
	if err != nil && errBuf != nil {
		if detail := strings.TrimSpace(errBuf.String()); detail != "" {
			return nil, fmt.Errorf("%w: %s", err, detail)
		}
	}
	return nil, err
}

// newBrewCmd constructs the *exec.Cmd for a brew invocation. Mutating
// subcommands (update, upgrade) perform keg transactions that must never be
// SIGKILLed mid-swap (shll update standard: "MUST NOT send SIGKILL to a
// package-manager subprocess mid-transaction" — SIGKILL cannot be trapped, so
// brew gets no chance to finish or roll back the keg swap). For those, the
// command is configured for graceful cancellation: on context expiry brew
// receives SIGTERM (cmd.Cancel) and gets a brewCancelGrace window
// (cmd.WaitDelay) to unwind before the runtime's final kill. Read-only
// subcommands (info, list) keep Go's default cancel (immediate kill) — a
// killed query corrupts nothing, so fast-fail is correct there. Keyed on
// args[0], like runBrewFn's per-subcommand stream wiring: an unmatched brew
// subcommand inherits the read-only default.
//
// It is a standalone helper so the cancel configuration is unit-testable
// without spawning a real `brew` (tests assert on the returned Cmd's fields).
func newBrewCmd(ctx context.Context, args ...string) *exec.Cmd {
	cmd := exec.CommandContext(ctx, "brew", args...)
	if len(args) > 0 && (args[0] == "update" || args[0] == "upgrade") {
		cmd.Cancel = func() error { return cmd.Process.Signal(syscall.SIGTERM) }
		cmd.WaitDelay = brewCancelGrace
	}
	return cmd
}

// brewStreams selects the stdout/stderr writers for the streamed brew
// subprocesses (update/upgrade). Under --quiet the streamed brew output is the
// definitional "raw brew output" chatter (Toolkit Principle 9), so stdout is
// discarded; stderr is captured into the returned *bytes.Buffer so a failing
// quiet run can wrap the diagnostic detail into its error (errBuf is non-nil
// ONLY under --quiet). Non-quiet runs stream to the process's real streams and
// return a nil errBuf (nothing to buffer — the detail is already live on the
// terminal). It is a standalone helper so the quiet-gating decision is
// unit-testable without spawning a real `brew`.
func brewStreams(q bool) (stdout, stderr io.Writer, errBuf *bytes.Buffer) {
	if q {
		buf := &bytes.Buffer{}
		return io.Discard, buf, buf
	}
	return os.Stdout, os.Stderr, nil
}

// restartDaemonFn is the package-level seam for the post-upgrade daemon
// restart. Defaults to the real daemon.RestartWithBinary so tests can record
// the call without restarting a real daemon. Mirrors innerServePIDFn.
var restartDaemonFn = daemon.RestartWithBinary

// resolveExeFn is the package-level seam for resolving this binary's on-disk
// path (used to detect a Homebrew install via the selfpath.CellarMarker).
// Defaults to the shared selfpath.Resolve (os.Executable + EvalSymlinks) — the
// same resolver api/update.go uses, so brew-install detection cannot drift
// between the two entry points; tests stub it to return a synthetic Cellar path
// so the upgrade/restart code path is reachable independent of the test binary's
// real location.
var resolveExeFn = selfpath.Resolve

func init() {
	updateCmd.Flags().BoolVar(&skipBrewUpdate, "skip-brew-update", false,
		"Skip the internal 'brew update' tap-metadata refresh (still runs brew info/upgrade and restarts the daemon)")
}

var updateCmd = &cobra.Command{
	Use:     "update",
	Aliases: []string{"upgrade"},
	Short:   "Update run-kit to the latest version",
	RunE: func(cmd *cobra.Command, args []string) error {
		// stdout carries data (outcome lines + the not-brew guidance), stderr
		// carries chatter (progress/decoration + streamed brew output) which
		// --quiet drops (Toolkit Principle 9). Adopting the convention re-routes
		// update's former stdout progress lines onto stderr on non-quiet runs —
		// intentional per "decide the stdout-vs-stderr convention once".
		sink := newSink(cmd)

		resolved, err := resolveExeFn()
		if err != nil {
			return fmt.Errorf("could not determine executable path: %w", err)
		}

		if !selfpath.IsBrewInstalled(resolved) {
			// The not-a-brew-install guidance is data: it explains why nothing
			// happened, and silence there would misreport a no-op as success.
			sink.Dataf("run-kit v%s was not installed via Homebrew.\n", version)
			sink.Dataf("Update manually (git pull && just build), or reinstall with:\n")
			sink.Dataf("  brew install sahil87/tap/run-kit\n")
			return nil
		}

		sink.Notef("Current version: v%s\n", version)

		// Refresh tap metadata (skippable via --skip-brew-update).
		if !skipBrewUpdate {
			updateCtx, updateCancel := context.WithTimeout(context.Background(), brewUpdateTimeout)
			defer updateCancel()

			if _, err := runBrewFn(updateCtx, "update", "--quiet"); err != nil {
				return fmt.Errorf("could not check for updates (brew update failed): %w", err)
			}
		}

		// Get latest version from Homebrew
		infoCtx, infoCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer infoCancel()

		infoOut, err := runBrewFn(infoCtx, "info", "--json=v2", "sahil87/tap/run-kit")
		if err != nil {
			return fmt.Errorf("could not determine latest version: %w", err)
		}

		latest, err := parseBrewVersion(infoOut)
		if err != nil {
			return fmt.Errorf("could not determine latest version: %w", err)
		}

		if latest == version {
			// Outcome line — data: full silence would make "updated" vs
			// "already current" indistinguishable to a caller.
			sink.Dataf("Already up to date (v%s).\n", version)
			return nil
		}

		sink.Notef("Updating v%s → v%s...\n", version, latest)

		upgradeCtx, upgradeCancel := context.WithTimeout(context.Background(), brewUpgradeTimeout)
		defer upgradeCancel()

		if _, err := runBrewFn(upgradeCtx, "upgrade", "sahil87/tap/run-kit"); err != nil {
			return fmt.Errorf("brew upgrade failed: %w", err)
		}

		// Outcome line — data (survives --quiet).
		sink.Dataf("Updated to v%s.\n", latest)

		// Derive the stable Homebrew bin symlink from the Cellar path.
		// resolved is e.g. /opt/homebrew/Cellar/run-kit/0.5.3/bin/run-kit
		// We want:         /opt/homebrew/bin/run-kit
		cellarIdx := strings.Index(resolved, selfpath.CellarMarker)
		if cellarIdx == -1 {
			return fmt.Errorf("could not derive brew prefix from %s", resolved)
		}
		brewBinPath := resolved[:cellarIdx] + "/bin/run-kit"

		// Restart daemon so it picks up the new binary.
		// Idempotent: if no daemon is running, this starts one.
		sink.Notef("Restarting run-kit daemon...\n")
		if err := restartDaemonFn(brewBinPath); err != nil {
			return fmt.Errorf("restarting daemon after upgrade: %w", err)
		}
		sink.Notef("run-kit daemon started (%s/%s/%s)\n",
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
