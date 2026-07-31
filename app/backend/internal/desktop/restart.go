package desktop

import (
	"context"
	"fmt"
	"strings"
	"time"
)

// appName is the running application's name as osascript addresses it —
// derived from AppBundleName so the quit target can never drift from the
// bundle the installer manages.
var appName = strings.TrimSuffix(AppBundleName, ".app")

// Restart bounds. The quit poll mirrors the intake's VSCode-pattern sizing: a
// graceful Electron quit normally completes in a second or two, so a 30s cap
// means "user interaction is needed" (an unsaved-state dialog, a hung
// renderer) rather than "still shutting down". Both are upper bounds on
// failure, not expected durations.
const (
	quitTimeout      = 15 * time.Second
	quitWaitTimeout  = 30 * time.Second
	quitPollInterval = 1 * time.Second
	relaunchTimeout  = 30 * time.Second
)

// quitApp asks the running app to quit gracefully via AppleScript. A graceful
// quit (vs pkill) matters twice over: Electron gets its shutdown hooks, and
// the shell's window `close` handler captures lastPath so the relaunch
// restores the user's route.
func (ins *Installer) quitApp(ctx context.Context) error {
	quitCtx, cancel := context.WithTimeout(ctx, quitTimeout)
	defer cancel()
	script := fmt.Sprintf("tell application %q to quit", appName)
	if _, err := ins.Run(quitCtx, "osascript", "-e", script); err != nil {
		return fmt.Errorf("asking %s to quit: %w", appName, err)
	}
	return nil
}

// waitAppExit polls AppRunning until the app's processes are gone, bounded by
// ins.QuitWait. The osascript quit returns as soon as the app *accepts* the
// Apple event — actual process exit lags it, so the swap must wait here. The
// bound is a context derived from QuitWait so a slow probe cannot stretch the
// total wall time past it (probeTimeout caps each probe individually, but the
// probe context descends from waitCtx).
func (ins *Installer) waitAppExit(ctx context.Context) error {
	waitCtx, cancel := context.WithTimeout(ctx, ins.QuitWait)
	defer cancel()
	for {
		running := ins.AppRunning(waitCtx)
		// Check the contexts before trusting the probe: AppRunning reads any
		// probe error — including waitCtx dying mid-pgrep — as "not running",
		// and a false at the deadline must not pass for a clean exit.
		if err := ctx.Err(); err != nil {
			return err
		}
		if waitCtx.Err() != nil {
			return fmt.Errorf("%s did not exit within %s — quit the app manually, then re-run this command", appName, ins.QuitWait)
		}
		if !running {
			return nil
		}
		select {
		case <-waitCtx.Done():
		case <-time.After(ins.QuitPoll):
		}
	}
}

// relaunchApp opens the freshly-installed bundle via `open -a`. Callers treat
// a failure as non-fatal: the swap already succeeded, so failing the update
// over a relaunch hiccup would misreport a completed install.
func (ins *Installer) relaunchApp(ctx context.Context, appPath string) error {
	openCtx, cancel := context.WithTimeout(ctx, relaunchTimeout)
	defer cancel()
	if _, err := ins.Run(openCtx, "open", "-a", appPath); err != nil {
		return fmt.Errorf("relaunching %s: %w", appName, err)
	}
	return nil
}
