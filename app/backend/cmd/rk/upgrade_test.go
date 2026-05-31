package main

import (
	"bytes"
	"context"
	"io"
	"os"
	"strings"
	"testing"
)

// brewInfoJSON returns a minimal `brew info --json=v2` payload reporting the
// given stable version, matching the shape parseBrewVersion expects.
func brewInfoJSON(stable string) []byte {
	return []byte(`{"formulae":[{"versions":{"stable":"` + stable + `"}}]}`)
}

// upgradeHarness swaps the update command's package-level seams (executable
// path, brew invocations, daemon restart) for recording stubs and restores
// them when the test ends. It mirrors the findPortOwner / innerServePIDFn
// stubbing convention used elsewhere in this package.
type upgradeHarness struct {
	brewArgs        [][]string // every `brew <args...>` invocation, in order
	daemonRestarted bool
	daemonBinPath   string
}

func newUpgradeHarness(t *testing.T, fakeExe, latest string) *upgradeHarness {
	t.Helper()
	h := &upgradeHarness{}

	origExe := osExecutable
	origRun := brewRun
	origOutput := brewOutput
	origRestart := restartDaemon
	origSkip := updateSkipBrewUpdate
	t.Cleanup(func() {
		osExecutable = origExe
		brewRun = origRun
		brewOutput = origOutput
		restartDaemon = origRestart
		updateSkipBrewUpdate = origSkip
	})

	osExecutable = func() (string, error) { return fakeExe, nil }
	brewRun = func(_ context.Context, args ...string) error {
		h.brewArgs = append(h.brewArgs, args)
		return nil
	}
	brewOutput = func(_ context.Context, args ...string) ([]byte, error) {
		h.brewArgs = append(h.brewArgs, args)
		return brewInfoJSON(latest), nil
	}
	restartDaemon = func(binPath string) error {
		h.daemonRestarted = true
		h.daemonBinPath = binPath
		return nil
	}
	return h
}

// ranBrew reports whether any recorded brew invocation began with the given
// subcommand (e.g. "update", "upgrade", "info").
func (h *upgradeHarness) ranBrew(sub string) bool {
	for _, args := range h.brewArgs {
		if len(args) > 0 && args[0] == sub {
			return true
		}
	}
	return false
}

// runUpdate executes `rk update [args...]` against the real cobra command tree.
// The command writes progress via fmt.Print* to the process stdout (not the
// cobra out-writer), so we redirect os.Stdout to a pipe to capture it. Cobra
// flag state is reset afterward so it does not leak into sibling tests.
func runUpdate(t *testing.T, args ...string) (string, error) {
	t.Helper()

	origStdout := os.Stdout
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatalf("os.Pipe: %v", err)
	}
	os.Stdout = w

	buf := new(bytes.Buffer)
	rootCmd.SetOut(buf)
	rootCmd.SetErr(buf)
	rootCmd.SetArgs(append([]string{"update"}, args...))
	t.Cleanup(func() {
		rootCmd.SetArgs(nil)
		_ = updateCmd.Flags().Set("skip-brew-update", "false")
	})

	runErr := rootCmd.Execute()

	_ = w.Close()
	os.Stdout = origStdout
	captured, _ := io.ReadAll(r)
	return buf.String() + string(captured), runErr
}

// withVersion pins the package-level `version` for the test and restores it.
func withVersion(t *testing.T, v string) {
	t.Helper()
	orig := version
	version = v
	t.Cleanup(func() { version = orig })
}

const fakeCellarExe = "/opt/homebrew/Cellar/rk/0.5.0/bin/rk"

// TestUpdateSkipBrewUpdate_SkipsOnlyBrewUpdate is the core contract: with
// --skip-brew-update set, the internal `brew update` MUST NOT run, but the
// version check, `brew upgrade`, AND the daemon restart MUST all still fire.
func TestUpdateSkipBrewUpdate_SkipsOnlyBrewUpdate(t *testing.T) {
	withVersion(t, "0.5.0")
	h := newUpgradeHarness(t, fakeCellarExe, "0.6.0")

	out, err := runUpdate(t, "--skip-brew-update")
	if err != nil {
		t.Fatalf("rk update --skip-brew-update: %v\noutput:\n%s", err, out)
	}

	if h.ranBrew("update") {
		t.Errorf("expected `brew update` NOT to run with --skip-brew-update, got invocations: %v", h.brewArgs)
	}
	if !h.ranBrew("info") {
		t.Errorf("expected `brew info` version check to still run, got: %v", h.brewArgs)
	}
	if !h.ranBrew("upgrade") {
		t.Errorf("expected `brew upgrade` to still run, got: %v", h.brewArgs)
	}
	if !h.daemonRestarted {
		t.Error("expected daemon restart to still fire with --skip-brew-update")
	}
	if h.daemonBinPath != "/opt/homebrew/bin/rk" {
		t.Errorf("daemon restarted with %q, want %q", h.daemonBinPath, "/opt/homebrew/bin/rk")
	}
	if !strings.Contains(out, "Skipping brew update") {
		t.Errorf("expected skip notice in output, got:\n%s", out)
	}
}

// TestUpdateDefault_RunsBrewUpdate verifies the flag-absent default preserves
// current behavior: `brew update` runs alongside everything else.
func TestUpdateDefault_RunsBrewUpdate(t *testing.T) {
	withVersion(t, "0.5.0")
	h := newUpgradeHarness(t, fakeCellarExe, "0.6.0")

	out, err := runUpdate(t)
	if err != nil {
		t.Fatalf("rk update: %v\noutput:\n%s", err, out)
	}

	if !h.ranBrew("update") {
		t.Errorf("expected `brew update` to run by default, got: %v", h.brewArgs)
	}
	if !h.ranBrew("upgrade") {
		t.Errorf("expected `brew upgrade` to run by default, got: %v", h.brewArgs)
	}
	if !h.daemonRestarted {
		t.Error("expected daemon restart to fire by default")
	}
}

// TestUpdateSkipBrewUpdate_AlreadyUpToDate confirms the skip flag still honors
// the "already up to date" short-circuit (no upgrade, no daemon restart) when
// the installed version matches the latest.
func TestUpdateSkipBrewUpdate_AlreadyUpToDate(t *testing.T) {
	withVersion(t, "0.6.0")
	h := newUpgradeHarness(t, fakeCellarExe, "0.6.0")

	out, err := runUpdate(t, "--skip-brew-update")
	if err != nil {
		t.Fatalf("rk update --skip-brew-update: %v\noutput:\n%s", err, out)
	}

	if h.ranBrew("update") {
		t.Errorf("expected `brew update` skipped, got: %v", h.brewArgs)
	}
	if h.ranBrew("upgrade") {
		t.Errorf("expected no `brew upgrade` when already up to date, got: %v", h.brewArgs)
	}
	if h.daemonRestarted {
		t.Error("expected no daemon restart when already up to date")
	}
	if !strings.Contains(out, "Already up to date") {
		t.Errorf("expected up-to-date notice, got:\n%s", out)
	}
}

// TestUpdateSkipBrewUpdateFlagRegistered guards the cross-toolkit flag contract:
// the boolean must be named exactly `--skip-brew-update` and default to false.
func TestUpdateSkipBrewUpdateFlagRegistered(t *testing.T) {
	f := updateCmd.Flags().Lookup("skip-brew-update")
	if f == nil {
		t.Fatal("update command has no --skip-brew-update flag")
	}
	if f.Value.Type() != "bool" {
		t.Errorf("--skip-brew-update type = %q, want bool", f.Value.Type())
	}
	if f.DefValue != "false" {
		t.Errorf("--skip-brew-update default = %q, want false", f.DefValue)
	}
}
