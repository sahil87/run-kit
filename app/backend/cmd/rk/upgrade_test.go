package main

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// withResolveExe swaps resolveExeFn to return the given path/err for the test's
// duration. Tests use this to satisfy the /Cellar/run-kit/ Homebrew-install guard
// without depending on the test binary's real location.
func withResolveExe(t *testing.T, path string, err error) {
	t.Helper()
	orig := resolveExeFn
	resolveExeFn = func() (string, error) { return path, err }
	t.Cleanup(func() { resolveExeFn = orig })
}

// withBrewRecorder swaps runBrewFn for a recording stub. Each invocation appends
// its subcommand (args[0]) to *rec. For "info" it returns the supplied JSON; all
// other subcommands return (nil, nil). No real `brew` is spawned.
func withBrewRecorder(t *testing.T, rec *[]string, infoJSON string) {
	t.Helper()
	orig := runBrewFn
	runBrewFn = func(ctx context.Context, args ...string) ([]byte, error) {
		if len(args) > 0 {
			*rec = append(*rec, args[0])
			if args[0] == "info" {
				return []byte(infoJSON), nil
			}
		}
		return nil, nil
	}
	t.Cleanup(func() { runBrewFn = orig })
}

// withRestartRecorder swaps restartDaemonFn for a recording stub returning nil.
// It records the call count and the bin path of the last call.
func withRestartRecorder(t *testing.T, calls *int, lastPath *string) {
	t.Helper()
	orig := restartDaemonFn
	restartDaemonFn = func(binPath string) error {
		*calls++
		*lastPath = binPath
		return nil
	}
	t.Cleanup(func() { restartDaemonFn = orig })
}

// resetSkipFlag forces skipBrewUpdate back to false after the test. Cobra does
// not reset package-global flag vars between Execute() calls, so tests that set
// it must restore it.
func resetSkipFlag(t *testing.T) {
	t.Helper()
	orig := skipBrewUpdate
	t.Cleanup(func() { skipBrewUpdate = orig })
}

// brewInfoJSON builds a canned `brew info --json=v2` payload with the given
// stable version, exercising the real parseBrewVersion.
func brewInfoJSON(stable string) string {
	return fmt.Sprintf(`{"formulae":[{"versions":{"stable":%q}}]}`, stable)
}

func containsStr(xs []string, want string) bool {
	for _, x := range xs {
		if x == want {
			return true
		}
	}
	return false
}

func TestUpdate_SkipBrewUpdateFlag_Registered(t *testing.T) {
	f := updateCmd.Flags().Lookup("skip-brew-update")
	if f == nil {
		t.Fatal("updateCmd has no --skip-brew-update flag")
	}
	if f.Value.Type() != "bool" {
		t.Errorf("--skip-brew-update type = %q, want bool", f.Value.Type())
	}
	if f.DefValue != "false" {
		t.Errorf("--skip-brew-update default = %q, want false", f.DefValue)
	}
}

func TestUpdate_SkipBrewUpdate_OmitsUpdateButUpgradesAndRestarts(t *testing.T) {
	resetSkipFlag(t)
	withResolveExe(t, "/opt/homebrew/Cellar/run-kit/9.9.9/bin/run-kit", nil)

	var rec []string
	// stable 9.9.9 differs from compiled-in version ("dev"), so the up-to-date
	// short-circuit is skipped and brew upgrade is reached.
	withBrewRecorder(t, &rec, brewInfoJSON("9.9.9"))

	var restartCalls int
	var restartPath string
	withRestartRecorder(t, &restartCalls, &restartPath)

	skipBrewUpdate = true
	if err := updateCmd.RunE(updateCmd, nil); err != nil {
		t.Fatalf("updateCmd.RunE returned error: %v", err)
	}

	if containsStr(rec, "update") {
		t.Errorf("brew update was invoked with --skip-brew-update set; recorded subcommands: %v", rec)
	}
	if !containsStr(rec, "info") {
		t.Errorf("brew info was not invoked; recorded subcommands: %v", rec)
	}
	if !containsStr(rec, "upgrade") {
		t.Errorf("brew upgrade was not invoked; recorded subcommands: %v", rec)
	}
	if restartCalls != 1 {
		t.Errorf("restartDaemonFn called %d times, want 1", restartCalls)
	}
	if !strings.HasSuffix(restartPath, "/bin/run-kit") {
		t.Errorf("restart bin path = %q, want it to end with /bin/run-kit", restartPath)
	}
}

func TestUpdate_Default_RunsUpdateAndUpgradeAndRestarts(t *testing.T) {
	resetSkipFlag(t)
	withResolveExe(t, "/opt/homebrew/Cellar/run-kit/9.9.9/bin/run-kit", nil)

	var rec []string
	withBrewRecorder(t, &rec, brewInfoJSON("9.9.9"))

	var restartCalls int
	var restartPath string
	withRestartRecorder(t, &restartCalls, &restartPath)

	skipBrewUpdate = false
	if err := updateCmd.RunE(updateCmd, nil); err != nil {
		t.Fatalf("updateCmd.RunE returned error: %v", err)
	}

	if !containsStr(rec, "update") {
		t.Errorf("brew update was NOT invoked on the default path; recorded subcommands: %v", rec)
	}
	if !containsStr(rec, "upgrade") {
		t.Errorf("brew upgrade was NOT invoked; recorded subcommands: %v", rec)
	}
	if restartCalls != 1 {
		t.Errorf("restartDaemonFn called %d times, want 1", restartCalls)
	}
}

// setUpdateBuffers wires updateCmd's stdout/stderr to the given buffers for the
// test's duration, so a quiet-gating test can observe the data vs chatter split.
func setUpdateBuffers(t *testing.T, stdout, stderr *bytes.Buffer) {
	t.Helper()
	updateCmd.SetOut(stdout)
	updateCmd.SetErr(stderr)
	t.Cleanup(func() { updateCmd.SetOut(nil); updateCmd.SetErr(nil) })
}

// TestUpdate_Quiet_OutcomeSurvivesProgressDropped pins R3: under --quiet the
// outcome line ("Updated to v…") survives on stdout (data) while progress lines
// ("Current version", "Updating", "Restarting") are dropped from stderr
// (chatter). Errors and exit codes are unaffected.
func TestUpdate_Quiet_OutcomeSurvivesProgressDropped(t *testing.T) {
	resetSkipFlag(t)
	withQuiet(t, true)
	withResolveExe(t, "/opt/homebrew/Cellar/run-kit/9.9.9/bin/run-kit", nil)

	var rec []string
	withBrewRecorder(t, &rec, brewInfoJSON("9.9.9"))
	var restartCalls int
	var restartPath string
	withRestartRecorder(t, &restartCalls, &restartPath)

	var stdout, stderr bytes.Buffer
	setUpdateBuffers(t, &stdout, &stderr)

	if err := updateCmd.RunE(updateCmd, nil); err != nil {
		t.Fatalf("updateCmd.RunE returned error: %v", err)
	}

	// Outcome line is data — survives --quiet on stdout.
	if !strings.Contains(stdout.String(), "Updated to v9.9.9.") {
		t.Errorf("--quiet must keep the outcome line on stdout, got: %q", stdout.String())
	}
	// Progress/decoration lines are chatter — dropped under --quiet.
	for _, chatter := range []string{"Current version", "Updating v", "Restarting run-kit daemon", "run-kit daemon started"} {
		if strings.Contains(stderr.String(), chatter) {
			t.Errorf("--quiet must drop chatter %q, got stderr: %q", chatter, stderr.String())
		}
	}
	// The mutation still happened — --quiet changes output only, never behavior.
	if restartCalls != 1 {
		t.Errorf("restartDaemonFn called %d times, want 1 (--quiet must not change behavior)", restartCalls)
	}
}

// TestUpdate_NonQuiet_ProgressOnStderrOutcomeOnStdout pins A-009: without
// --quiet, progress lines route to stderr (the convention re-routes update's
// former stdout progress onto stderr) while the outcome line stays on stdout.
func TestUpdate_NonQuiet_ProgressOnStderrOutcomeOnStdout(t *testing.T) {
	resetSkipFlag(t)
	withQuiet(t, false)
	withResolveExe(t, "/opt/homebrew/Cellar/run-kit/9.9.9/bin/run-kit", nil)

	var rec []string
	withBrewRecorder(t, &rec, brewInfoJSON("9.9.9"))
	var restartCalls int
	var restartPath string
	withRestartRecorder(t, &restartCalls, &restartPath)

	var stdout, stderr bytes.Buffer
	setUpdateBuffers(t, &stdout, &stderr)

	if err := updateCmd.RunE(updateCmd, nil); err != nil {
		t.Fatalf("updateCmd.RunE returned error: %v", err)
	}

	if !strings.Contains(stdout.String(), "Updated to v9.9.9.") {
		t.Errorf("outcome line must be on stdout, got stdout: %q", stdout.String())
	}
	if strings.Contains(stdout.String(), "Current version") {
		t.Errorf("progress must NOT be on stdout (convention: stdout is data), got: %q", stdout.String())
	}
	if !strings.Contains(stderr.String(), "Current version") {
		t.Errorf("progress must be on stderr, got stderr: %q", stderr.String())
	}
}

// TestUpdate_Quiet_NotBrewGuidanceSurvives pins R3's guidance clause: the
// not-a-brew-install guidance is data (it explains why nothing happened) and
// survives --quiet on stdout.
func TestUpdate_Quiet_NotBrewGuidanceSurvives(t *testing.T) {
	resetSkipFlag(t)
	withQuiet(t, true)
	// A non-Cellar path → IsBrewInstalled is false → guidance block prints.
	withResolveExe(t, "/usr/local/bin/run-kit", nil)

	var stdout, stderr bytes.Buffer
	setUpdateBuffers(t, &stdout, &stderr)

	if err := updateCmd.RunE(updateCmd, nil); err != nil {
		t.Fatalf("updateCmd.RunE returned error: %v", err)
	}
	if !strings.Contains(stdout.String(), "was not installed via Homebrew") {
		t.Errorf("--quiet must keep the not-brew guidance on stdout, got: %q", stdout.String())
	}
	if !strings.Contains(stdout.String(), "brew install sahil87/tap/run-kit") {
		t.Errorf("--quiet must keep the reinstall hint, got: %q", stdout.String())
	}
}

// TestBrewStreams_QuietGating pins that under --quiet the brew subprocess stdout
// (the definitional "raw brew output" chatter) is discarded while stderr is
// BUFFERED into the returned *bytes.Buffer (so a failing quiet run can surface
// the diagnostic detail in its error), and that a non-quiet run streams to the
// real process streams with a nil errBuf. This is the seam the default runBrewFn
// uses, tested without spawning a real `brew`.
func TestBrewStreams_QuietGating(t *testing.T) {
	stdout, stderr, errBuf := brewStreams(true)
	if stdout != io.Discard {
		t.Errorf("brewStreams(true) stdout = %v, want io.Discard", stdout)
	}
	if errBuf == nil {
		t.Fatal("brewStreams(true) errBuf = nil, want a buffer to capture stderr under --quiet")
	}
	// Under --quiet stderr and errBuf are the SAME buffer (captured, not discarded).
	if stderr != io.Writer(errBuf) {
		t.Errorf("brewStreams(true) stderr must be the errBuf capture buffer, got %v", stderr)
	}

	stdout, stderr, errBuf = brewStreams(false)
	if stdout != io.Writer(os.Stdout) || stderr != io.Writer(os.Stderr) {
		t.Errorf("brewStreams(false) must return the real os.Stdout/os.Stderr, got (%v, %v)", stdout, stderr)
	}
	if errBuf != nil {
		t.Errorf("brewStreams(false) errBuf = %v, want nil (non-quiet streams live, buffers nothing)", errBuf)
	}
}

// TestRunBrewFn_QuietFailureSurfacesStderrDetail pins T004's fix: a failing brew
// under --quiet must not destroy diagnostics. The default runBrewFn buffers brew
// stderr under --quiet and wraps the captured detail into the returned error, so
// a caller sees the actual failure reason — not just "exit status 1". Uses a
// fake `brew` on PATH that writes to stderr and exits non-zero.
func TestRunBrewFn_QuietFailureSurfacesStderrDetail(t *testing.T) {
	const detail = "Error: brew-upgrade-boom-detail"
	withFakeBrew(t, detail, 1)
	withQuiet(t, true)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	_, err := runBrewFn(ctx, "upgrade", "sahil87/tap/run-kit")
	if err == nil {
		t.Fatal("failing brew under --quiet must return an error")
	}
	// The captured stderr detail must be wrapped into the error (not discarded).
	if !strings.Contains(err.Error(), detail) {
		t.Errorf("--quiet failure must surface the captured brew stderr detail, got: %v", err)
	}
}

// withFakeBrew installs a fake `brew` executable on PATH (prepended) for the
// test's duration. The fake writes stderrText to stderr and exits with exitCode,
// so runBrewFn's real exec.CommandContext path is exercised without a real brew.
func withFakeBrew(t *testing.T, stderrText string, exitCode int) {
	t.Helper()
	installFakeBrew(t, fmt.Sprintf("#!/bin/sh\nprintf '%%s\\n' %q 1>&2\nexit %d\n", stderrText, exitCode))
}

// installFakeBrew writes the given shell script as a `brew` executable in a
// temp dir and prepends that dir to PATH for the test's duration.
func installFakeBrew(t *testing.T, script string) {
	t.Helper()
	dir := t.TempDir()
	brewPath := filepath.Join(dir, "brew")
	if err := os.WriteFile(brewPath, []byte(script), 0o755); err != nil {
		t.Fatalf("write fake brew: %v", err)
	}
	origPath := os.Getenv("PATH")
	t.Setenv("PATH", dir+string(os.PathListSeparator)+origPath)
}

// TestNewBrewCmd_GracefulCancelConfig pins the per-subcommand-class cancel
// configuration (shll update standard, brew-handling safety clause): mutating
// brew subcommands (update, upgrade) get the SIGTERM-with-grace treatment
// (WaitDelay == brewCancelGrace), while read-only queries (info) keep Go's
// default cancel with no grace window (WaitDelay zero). WaitDelay is the
// observable discriminator — exec.CommandContext always sets a non-nil default
// Kill cancel, so Cancel != nil distinguishes nothing; the SIGTERM (not
// SIGKILL) semantics are pinned behaviorally by
// TestNewBrewCmd_ContextCancelDeliversSIGTERM.
func TestNewBrewCmd_GracefulCancelConfig(t *testing.T) {
	for _, sub := range []string{"update", "upgrade"} {
		cmd := newBrewCmd(context.Background(), sub, "sahil87/tap/run-kit")
		if cmd.WaitDelay != brewCancelGrace {
			t.Errorf("newBrewCmd(%q).WaitDelay = %v, want %v (mutating brew subcommands must get a SIGTERM grace window)", sub, cmd.WaitDelay, brewCancelGrace)
		}
		if cmd.Cancel == nil {
			t.Errorf("newBrewCmd(%q).Cancel = nil, want the SIGTERM cancel func", sub)
		}
	}

	cmd := newBrewCmd(context.Background(), "info", "--json=v2", "sahil87/tap/run-kit")
	if cmd.WaitDelay != 0 {
		t.Errorf("newBrewCmd(\"info\").WaitDelay = %v, want 0 (read-only queries keep default fast-fail cancel)", cmd.WaitDelay)
	}
}

// TestBrewMutationTimeouts_Generous pins the generous bounds so a future
// refactor cannot silently reintroduce a short hard cap — the exact regression
// the update standard's failure-mode paragraph warns about (a 120s hard kill
// landed mid keg-swap and corrupted the install, observed 2026-07-19).
func TestBrewMutationTimeouts_Generous(t *testing.T) {
	if brewUpgradeTimeout < 30*time.Minute {
		t.Errorf("brewUpgradeTimeout = %v, want >= 30m (bound must be sized for a network transfer, never a short hard cap)", brewUpgradeTimeout)
	}
	if brewUpdateTimeout < 10*time.Minute {
		t.Errorf("brewUpdateTimeout = %v, want >= 10m (brew update is also a network-bound package-manager mutation)", brewUpdateTimeout)
	}
}

// TestNewBrewCmd_ContextCancelDeliversSIGTERM behaviorally pins that context
// expiry on a mutating brew subcommand delivers a trappable SIGTERM — never an
// untrappable SIGKILL. A fake `brew` installs a TERM trap (writes a marker,
// exits 0), signals readiness, then loops; the test cancels the context and
// asserts the process exits within the grace window with the trap having run.
// Under SIGKILL the trap could never run and the marker would be absent.
func TestNewBrewCmd_ContextCancelDeliversSIGTERM(t *testing.T) {
	if testing.Short() {
		t.Skip("spawns a real subprocess; skipped under -short")
	}

	dir := t.TempDir()
	ready := filepath.Join(dir, "ready")
	marker := filepath.Join(dir, "graceful")
	installFakeBrew(t, fmt.Sprintf(`#!/bin/sh
trap 'touch %s; exit 0' TERM
touch %s
while :; do sleep 0.1; done
`, marker, ready))

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	cmd := newBrewCmd(ctx, "upgrade", "sahil87/tap/run-kit")
	if err := cmd.Start(); err != nil {
		t.Fatalf("start fake brew: %v", err)
	}

	// Wait for the fake brew to install its trap before canceling, so an
	// early SIGTERM can't hit the shell pre-trap and false-negative the test.
	readyDeadline := time.Now().Add(5 * time.Second)
	for {
		if _, err := os.Stat(ready); err == nil {
			break
		}
		if time.Now().After(readyDeadline) {
			t.Fatal("fake brew never signaled readiness")
		}
		time.Sleep(10 * time.Millisecond)
	}

	cancel()

	done := make(chan struct{})
	go func() {
		_ = cmd.Wait() // returns ctx err after a clean post-Cancel exit — expected
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(10 * time.Second):
		t.Fatal("process did not exit within the grace window after context cancel")
	}

	if _, err := os.Stat(marker); err != nil {
		t.Error("SIGTERM trap did not run (marker missing) — the process was killed, not gracefully terminated")
	}
}

func TestUpdate_SkipBrewUpdate_ShortCircuitsWhenUpToDate(t *testing.T) {
	resetSkipFlag(t)
	withResolveExe(t, "/opt/homebrew/Cellar/run-kit/dev/bin/run-kit", nil)

	var rec []string
	// stable equals compiled-in version ("dev"): up-to-date short-circuit fires.
	withBrewRecorder(t, &rec, brewInfoJSON(version))

	var restartCalls int
	var restartPath string
	withRestartRecorder(t, &restartCalls, &restartPath)

	skipBrewUpdate = true
	if err := updateCmd.RunE(updateCmd, nil); err != nil {
		t.Fatalf("updateCmd.RunE returned error: %v", err)
	}

	if containsStr(rec, "update") {
		t.Errorf("brew update was invoked with --skip-brew-update set; recorded subcommands: %v", rec)
	}
	if !containsStr(rec, "info") {
		t.Errorf("brew info was not invoked; recorded subcommands: %v", rec)
	}
	if containsStr(rec, "upgrade") {
		t.Errorf("brew upgrade was invoked despite being up to date; recorded subcommands: %v", rec)
	}
	if restartCalls != 0 {
		t.Errorf("restartDaemonFn called %d times, want 0 (up to date)", restartCalls)
	}
}
