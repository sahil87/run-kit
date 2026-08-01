package main

import (
	"bytes"
	"context"
	"path/filepath"
	"strings"
	"testing"

	"rk/internal/remote"
)

// withRemoteStore points the remote commands at a temp store and a scripted
// listener set for the test's duration (the findPortOwner seam idiom).
func withRemoteStore(t *testing.T, livePorts []int) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "remotes.yaml")
	origPath, origPorts := remotesPathFn, liveTCPPortsFn
	remotesPathFn = func() (string, error) { return path, nil }
	liveTCPPortsFn = func(context.Context) []int { return livePorts }
	t.Cleanup(func() { remotesPathFn, liveTCPPortsFn = origPath, origPorts })
	return path
}

// resetRemoteFlags restores the remote add flags to their defaults. Cobra
// retains flag values on the shared global commands between Execute() calls,
// so execRemote resets BEFORE every run (a cleanup-only reset would leak flag
// state between calls within one test).
func resetRemoteFlags() {
	for name, def := range map[string]string{"name": "", "local-port": "0"} {
		if f := remoteAddCmd.Flags().Lookup(name); f != nil {
			_ = f.Value.Set(def)
			f.Changed = false
		}
	}
	quiet = false
	if f := rootCmd.PersistentFlags().Lookup("quiet"); f != nil {
		_ = f.Value.Set("false")
		f.Changed = false
	}
}

// execRemote runs the shared rootCmd with the given argv, capturing output.
func execRemote(t *testing.T, args ...string) (stdout, stderr string, err error) {
	t.Helper()
	resetRemoteFlags()
	t.Cleanup(resetRemoteFlags)
	var out, errBuf bytes.Buffer
	rootCmd.SetOut(&out)
	rootCmd.SetErr(&errBuf)
	t.Cleanup(func() {
		rootCmd.SetOut(nil)
		rootCmd.SetErr(nil)
	})
	rootCmd.SetArgs(args)
	err = rootCmd.Execute()
	return out.String(), errBuf.String(), err
}

func TestRemoteCommandSurface(t *testing.T) {
	// Exactly the six designed verbs — and deliberately no `update` (folded
	// into connect).
	want := map[string]bool{
		"add": true, "connect": true, "list": true,
		"status": true, "disconnect": true, "remove": true,
	}
	var got []string
	for _, c := range remoteCmd.Commands() {
		got = append(got, c.Name())
		if !want[c.Name()] {
			t.Errorf("unexpected remote subcommand %q", c.Name())
		}
		if c.Hidden {
			t.Errorf("remote %s must be visible (help-dump contract surface)", c.Name())
		}
	}
	if len(got) != len(want) {
		t.Errorf("remote subcommands = %v, want the six designed verbs", got)
	}

	// Registered on the root.
	found := false
	for _, c := range rootCmd.Commands() {
		if c == remoteCmd {
			found = true
		}
	}
	if !found {
		t.Error("remoteCmd is not registered on rootCmd")
	}
}

func TestRemoteAdd_AssignsPortAndPrintsDataLines(t *testing.T) {
	path := withRemoteStore(t, []int{3100}) // 3100 squatted by a live listener

	stdout, _, err := execRemote(t, "remote", "add", "sahil@buildbox")
	if err != nil {
		t.Fatalf("add error = %v", err)
	}
	for _, line := range []string{"Name:   buildbox", "Target: sahil@buildbox", "Local:  http://127.0.0.1:3101"} {
		if !strings.Contains(stdout, line) {
			t.Errorf("stdout missing %q:\n%s", line, stdout)
		}
	}
	f, err := remote.Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if r := f.FindByName("buildbox"); r == nil || r.LocalPort != 3101 || r.Target != "sahil@buildbox" {
		t.Errorf("persisted = %+v, want buildbox@3101", f.Remotes)
	}
}

func TestRemoteAdd_IdempotentReAdd(t *testing.T) {
	withRemoteStore(t, nil)

	if _, _, err := execRemote(t, "remote", "add", "sahil@buildbox"); err != nil {
		t.Fatal(err)
	}
	stdout, _, err := execRemote(t, "remote", "add", "sahil@buildbox")
	if err != nil {
		t.Fatalf("re-add error = %v, want idempotent success", err)
	}
	if !strings.Contains(stdout, "Local:  http://127.0.0.1:3100") {
		t.Errorf("re-add should reprint the existing entry:\n%s", stdout)
	}

	// Conflicting overrides on a registered target error.
	if _, _, err := execRemote(t, "remote", "add", "sahil@buildbox", "--name", "other"); err == nil {
		t.Error("re-add with a conflicting --name should error")
	}
	if _, _, err := execRemote(t, "remote", "add", "sahil@buildbox", "--local-port", "3105"); err == nil {
		t.Error("re-add with a conflicting --local-port should error")
	}
}

func TestRemoteAdd_Validation(t *testing.T) {
	withRemoteStore(t, nil)

	// Flag-injection defense: a leading '-' target never reaches ssh argv.
	if _, _, err := execRemote(t, "remote", "add", "--", "-oProxyCommand=evil"); err == nil {
		t.Error("hostile target should be rejected")
	}
	// Out-of-range explicit port.
	if _, _, err := execRemote(t, "remote", "add", "vm2", "--local-port", "3050"); err == nil ||
		!strings.Contains(err.Error(), "reserved range") {
		t.Errorf("out-of-range port error = %v", err)
	}
	// Invalid explicit name.
	if _, _, err := execRemote(t, "remote", "add", "vm2", "--name", "bad name"); err == nil {
		t.Error("invalid --name should be rejected")
	}
	// Name collision across different targets.
	if _, _, err := execRemote(t, "remote", "add", "sahil@buildbox", "--name", "box"); err != nil {
		t.Fatal(err)
	}
	if _, _, err := execRemote(t, "remote", "add", "other@host", "--name", "box"); err == nil {
		t.Error("duplicate name should be rejected")
	}
}

func TestRemoteAdd_DerivedNameMapsDots(t *testing.T) {
	withRemoteStore(t, nil)
	stdout, _, err := execRemote(t, "remote", "add", "sahil@build.example.com")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(stdout, "Name:   build-example-com") {
		t.Errorf("stdout = %s, want dot-mapped derived name", stdout)
	}
}

func TestRemoteList_EmptyStore(t *testing.T) {
	withRemoteStore(t, nil)
	stdout, _, err := execRemote(t, "remote", "list")
	if err != nil {
		t.Fatalf("list error = %v", err)
	}
	if !strings.Contains(stdout, "No remotes registered") {
		t.Errorf("stdout = %q", stdout)
	}
}

func TestRemoteVerbs_UnknownNameErrors(t *testing.T) {
	withRemoteStore(t, nil)
	for _, verb := range []string{"connect", "status", "disconnect", "remove"} {
		if _, _, err := execRemote(t, "remote", verb, "ghost"); err == nil ||
			!strings.Contains(err.Error(), `"ghost"`) {
			t.Errorf("remote %s ghost error = %v, want unknown-remote error", verb, err)
		}
	}
}

func TestRemoteAdd_QuietKeepsDataLines(t *testing.T) {
	withRemoteStore(t, nil)
	stdout, stderr, err := execRemote(t, "remote", "add", "vm9", "--quiet")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(stdout, "Name:   vm9") {
		t.Errorf("--quiet must keep data lines:\n%s", stdout)
	}
	if strings.Contains(stderr, "Next:") {
		t.Errorf("--quiet must drop chatter:\n%s", stderr)
	}
}
