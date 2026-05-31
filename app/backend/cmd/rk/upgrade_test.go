package main

import (
	"context"
	"fmt"
	"strings"
	"testing"
)

// withResolveExe swaps resolveExeFn to return the given path/err for the test's
// duration. Tests use this to satisfy the /Cellar/rk/ Homebrew-install guard
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
	withResolveExe(t, "/opt/homebrew/Cellar/rk/9.9.9/bin/rk", nil)

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
	if !strings.HasSuffix(restartPath, "/bin/rk") {
		t.Errorf("restart bin path = %q, want it to end with /bin/rk", restartPath)
	}
}

func TestUpdate_Default_RunsUpdateAndUpgradeAndRestarts(t *testing.T) {
	resetSkipFlag(t)
	withResolveExe(t, "/opt/homebrew/Cellar/rk/9.9.9/bin/rk", nil)

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

func TestUpdate_SkipBrewUpdate_ShortCircuitsWhenUpToDate(t *testing.T) {
	resetSkipFlag(t)
	withResolveExe(t, "/opt/homebrew/Cellar/rk/dev/bin/rk", nil)

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
