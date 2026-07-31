package main

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"rk/internal/desktop"

	"github.com/spf13/cobra"
)

// resetDesktopFlags restores the desktop subcommands' flag state after a test.
// Cobra retains flag values on the shared global commands between Execute()
// calls (the same footgun resetRootFlagState guards), so every test that
// passes desktop flags registers this cleanup.
func resetDesktopFlags(t *testing.T) {
	t.Helper()
	reset := func(cmd *cobra.Command, defs map[string]string) {
		for name, def := range defs {
			if f := cmd.Flags().Lookup(name); f != nil {
				_ = f.Value.Set(def)
				f.Changed = false
			}
		}
	}
	t.Cleanup(func() {
		reset(desktopInstallCmd, map[string]string{"version": "", "force": "false", "path": desktop.DefaultInstallDir})
		reset(desktopUpdateCmd, map[string]string{"force": "false", "path": desktop.DefaultInstallDir})
		reset(desktopStatusCmd, map[string]string{"path": desktop.DefaultInstallDir})
		quiet = false
		if f := rootCmd.PersistentFlags().Lookup("quiet"); f != nil {
			_ = f.Value.Set("false")
			f.Changed = false
		}
	})
}

// execDesktop runs the shared rootCmd with the given argv, capturing stdout
// and stderr.
func execDesktop(t *testing.T, args ...string) (stdout, stderr string, err error) {
	t.Helper()
	resetDesktopFlags(t)
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

// desktopReleaseServer serves a canned latest-release document (per-arch DMG
// assets, no digest) plus the asset bytes, counting asset downloads.
func desktopReleaseServer(t *testing.T, version string, assetHits *int) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/dl/") {
			*assetHits++
			w.Write([]byte("fake-dmg"))
			return
		}
		base := "http://" + r.Host
		fmt.Fprintf(w, `{"tag_name":"v%s","assets":[
			{"name":"run-kit-desktop-%s-arm64.dmg","browser_download_url":"%s/dl/arm64.dmg"},
			{"name":"run-kit-desktop-%s-x64.dmg","browser_download_url":"%s/dl/x64.dmg"}]}`,
			version, version, base, version, base)
	}))
	t.Cleanup(srv.Close)
	return srv
}

// withDesktopStub forces the darwin gate open and swaps the installer factory
// for one wired to the given httptest server and runner (deterministic arm64).
func withDesktopStub(t *testing.T, srv *httptest.Server, run desktop.Runner) {
	t.Helper()
	origGOOS := desktopGOOS
	desktopGOOS = "darwin"
	origFactory := newDesktopInstallerFn
	newDesktopInstallerFn = func() *desktop.Installer {
		ins := desktop.New()
		ins.Client = srv.Client()
		ins.APIBase = srv.URL
		ins.Arch = "arm64"
		ins.Token = ""
		ins.Run = run
		return ins
	}
	t.Cleanup(func() {
		desktopGOOS = origGOOS
		newDesktopInstallerFn = origFactory
	})
}

// desktopFakeRunner fakes the macOS tool set: plutil reports the given
// installed version, pgrep reports the given running state, hdiutil attach
// materializes the .app in the mountpoint, ditto creates the destination.
// It is stateful for the auto-restart flow: after the osascript graceful
// quit, pgrep flips to not-running (the app "exited"), and `open` (the
// relaunch) succeeds silently.
func desktopFakeRunner(t *testing.T, installedVersion string, running bool) desktop.Runner {
	t.Helper()
	quitSeen := false
	return func(_ context.Context, name string, args ...string) ([]byte, error) {
		switch name {
		case "plutil":
			return []byte(installedVersion + "\n"), nil
		case "pgrep":
			if running && !quitSeen {
				return []byte("123\n"), nil
			}
			return nil, errors.New("exit status 1")
		case "osascript":
			quitSeen = true
			return nil, nil
		case "open":
			return nil, nil
		case "hdiutil":
			if len(args) > 4 && args[0] == "attach" {
				if err := os.MkdirAll(filepath.Join(args[4], desktop.AppBundleName), 0o755); err != nil {
					t.Fatal(err)
				}
			}
			return nil, nil
		case "codesign":
			return nil, nil
		case "ditto":
			if err := os.MkdirAll(args[1], 0o755); err != nil {
				t.Fatal(err)
			}
			return nil, nil
		}
		t.Fatalf("unexpected command: %s %v", name, args)
		return nil, nil
	}
}

// writeDesktopBundle creates <dir>/Run Kit.app/Contents/Info.plist so the
// installed-version probe finds an installed app.
func writeDesktopBundle(t *testing.T, dir string) {
	t.Helper()
	contents := filepath.Join(dir, desktop.AppBundleName, "Contents")
	if err := os.MkdirAll(contents, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(contents, "Info.plist"), []byte("fake"), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestDesktopRegisteredWithChildrenAndFlags(t *testing.T) {
	var found *cobra.Command
	for _, c := range rootCmd.Commands() {
		if c.Name() == "desktop" {
			found = c
		}
	}
	if found == nil {
		t.Fatal("desktop command not registered on rootCmd")
	}
	children := map[string]bool{}
	for _, c := range found.Commands() {
		children[c.Name()] = true
	}
	for _, want := range []string{"install", "update", "status"} {
		if !children[want] {
			t.Errorf("desktop child %q not registered", want)
		}
	}
	for _, flag := range []string{"version", "force", "path"} {
		if desktopInstallCmd.Flags().Lookup(flag) == nil {
			t.Errorf("install missing --%s", flag)
		}
	}
	for _, flag := range []string{"force", "path"} {
		if desktopUpdateCmd.Flags().Lookup(flag) == nil {
			t.Errorf("update missing --%s", flag)
		}
	}
	if desktopStatusCmd.Flags().Lookup("path") == nil {
		t.Error("status missing --path")
	}
	// help-dump publishes UsageString, so the Long: help blocks are part of
	// the contract surface (the daemon-children pattern).
	if desktopCmd.Long == "" {
		t.Error("desktop parent missing a Long: help block")
	}
	for _, c := range []*cobra.Command{desktopInstallCmd, desktopUpdateCmd, desktopStatusCmd} {
		if c.Long == "" {
			t.Errorf("desktop %s missing a Long: help block", c.Name())
		}
	}
	// The documented flag semantics the Long blocks exist to carry.
	if !strings.Contains(desktopUpdateCmd.Long, "no --version") {
		t.Error("update Long should state that update deliberately has no --version flag")
	}
	for _, c := range []*cobra.Command{desktopInstallCmd, desktopUpdateCmd} {
		if !strings.Contains(c.Long, "version state ONLY") {
			t.Errorf("%s Long should scope --force to version state", c.Name())
		}
		if !strings.Contains(c.Long, "quit gracefully") {
			t.Errorf("%s Long should describe the running-app auto-restart (quit gracefully → swap → relaunch)", c.Name())
		}
	}
}

// TestDesktopEmptyPathUsageError: an explicitly-empty --path is a usage error
// (exit 2), not a silent fallback to /Applications.
func TestDesktopEmptyPathUsageError(t *testing.T) {
	orig := desktopGOOS
	desktopGOOS = "darwin"
	t.Cleanup(func() { desktopGOOS = orig })

	origFactory := newDesktopInstallerFn
	newDesktopInstallerFn = func() *desktop.Installer {
		t.Fatal("installer constructed despite the empty --path usage error")
		return nil
	}
	t.Cleanup(func() { newDesktopInstallerFn = origFactory })

	for _, sub := range []string{"install", "update", "status"} {
		t.Run(sub, func(t *testing.T) {
			_, _, err := execDesktop(t, "desktop", sub, "--path", "")
			if err == nil {
				t.Fatal("expected a usage error, got nil")
			}
			if !strings.Contains(err.Error(), "--path") {
				t.Errorf("error = %q, want it to name --path", err.Error())
			}
			if got := exitCode(err); got != exitUsage {
				t.Errorf("exitCode = %d, want %d (usage)", got, exitUsage)
			}
		})
	}
}

func TestDesktopMacOSGate(t *testing.T) {
	orig := desktopGOOS
	desktopGOOS = "linux"
	t.Cleanup(func() { desktopGOOS = orig })

	origFactory := newDesktopInstallerFn
	newDesktopInstallerFn = func() *desktop.Installer {
		t.Fatal("installer constructed despite the platform gate")
		return nil
	}
	t.Cleanup(func() { newDesktopInstallerFn = origFactory })

	for _, sub := range []string{"install", "update", "status"} {
		t.Run(sub, func(t *testing.T) {
			_, _, err := execDesktop(t, "desktop", sub)
			if err == nil {
				t.Fatal("expected the macOS-only error, got nil")
			}
			want := "rk desktop is macOS-only (the shell is packaged as a macOS .app)"
			if err.Error() != want {
				t.Errorf("error = %q, want %q", err.Error(), want)
			}
			if got := exitCode(err); got != 1 {
				t.Errorf("exitCode = %d, want 1 (operational)", got)
			}
		})
	}
}

func TestDesktopUsageErrorsExitTwo(t *testing.T) {
	cases := [][]string{
		{"desktop", "install", "extra-arg"},
		{"desktop", "update", "extra-arg"},
		{"desktop", "status", "extra-arg"},
		{"desktop", "install", "--nope"},
	}
	for _, argv := range cases {
		t.Run(strings.Join(argv, " "), func(t *testing.T) {
			_, _, err := execDesktop(t, argv...)
			if err == nil {
				t.Fatal("expected a usage error, got nil")
			}
			if got := exitCode(err); got != exitUsage {
				t.Errorf("exitCode = %d, want %d (usage)", got, exitUsage)
			}
		})
	}
}

func TestDesktopInstallAlreadyCurrent(t *testing.T) {
	var assetHits int
	srv := desktopReleaseServer(t, "3.13.0", &assetHits)
	withDesktopStub(t, srv, desktopFakeRunner(t, "3.13.0", false))
	dir := t.TempDir()
	writeDesktopBundle(t, dir)

	stdout, _, err := execDesktop(t, "desktop", "install", "--path", dir)
	if err != nil {
		t.Fatalf("install: %v", err)
	}
	if !strings.Contains(stdout, "already installed") || !strings.Contains(stdout, "--force") {
		t.Errorf("stdout = %q, want an already-installed outcome naming --force", stdout)
	}
	if assetHits != 0 {
		t.Errorf("asset downloaded %d times despite already-current short-circuit", assetHits)
	}
}

func TestDesktopInstallForceReinstalls(t *testing.T) {
	var assetHits int
	srv := desktopReleaseServer(t, "3.13.0", &assetHits)
	withDesktopStub(t, srv, desktopFakeRunner(t, "3.13.0", false))
	dir := t.TempDir()
	writeDesktopBundle(t, dir)

	stdout, _, err := execDesktop(t, "desktop", "install", "--path", dir, "--force")
	if err != nil {
		t.Fatalf("install --force: %v", err)
	}
	if !strings.Contains(stdout, "Installed Run Kit v3.13.0") {
		t.Errorf("stdout = %q, want an installed outcome line", stdout)
	}
	if assetHits != 1 {
		t.Errorf("asset downloads = %d, want 1", assetHits)
	}
}

func TestDesktopUpdateNotInstalled(t *testing.T) {
	var assetHits int
	srv := desktopReleaseServer(t, "3.13.0", &assetHits)
	withDesktopStub(t, srv, desktopFakeRunner(t, "", false))
	dir := t.TempDir() // no bundle

	_, _, err := execDesktop(t, "desktop", "update", "--path", dir)
	if err == nil {
		t.Fatal("expected a not-installed error, got nil")
	}
	if !strings.Contains(err.Error(), "rk desktop install") {
		t.Errorf("error = %q, want a pointer at 'rk desktop install'", err.Error())
	}
	if got := exitCode(err); got != 1 {
		t.Errorf("exitCode = %d, want 1", got)
	}
}

func TestDesktopUpdateAlreadyUpToDate(t *testing.T) {
	var assetHits int
	srv := desktopReleaseServer(t, "3.13.0", &assetHits)
	withDesktopStub(t, srv, desktopFakeRunner(t, "3.13.0", false))
	dir := t.TempDir()
	writeDesktopBundle(t, dir)

	stdout, _, err := execDesktop(t, "desktop", "update", "--path", dir)
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	if !strings.Contains(stdout, "Already up to date (v3.13.0).") {
		t.Errorf("stdout = %q, want the up-to-date outcome line", stdout)
	}
	if assetHits != 0 {
		t.Errorf("asset downloaded %d times despite up-to-date", assetHits)
	}
}

func TestDesktopUpdateInstallsNewer(t *testing.T) {
	var assetHits int
	srv := desktopReleaseServer(t, "3.13.0", &assetHits)
	withDesktopStub(t, srv, desktopFakeRunner(t, "3.12.2", false))
	dir := t.TempDir()
	writeDesktopBundle(t, dir)

	stdout, _, err := execDesktop(t, "desktop", "update", "--path", dir)
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	if !strings.Contains(stdout, "Updated Run Kit v3.12.2 -> v3.13.0") {
		t.Errorf("stdout = %q, want the updated outcome line", stdout)
	}
	if assetHits != 1 {
		t.Errorf("asset downloads = %d, want 1", assetHits)
	}
}

// TestDesktopUpdateRunningAppAutoRestarts: a running app no longer blocks the
// update — it is quit, swapped, and relaunched, and the restart announcement
// is a stdout data line alongside the updated outcome (R2, R5, R6).
func TestDesktopUpdateRunningAppAutoRestarts(t *testing.T) {
	var assetHits int
	srv := desktopReleaseServer(t, "3.13.0", &assetHits)
	withDesktopStub(t, srv, desktopFakeRunner(t, "3.12.2", true))
	dir := t.TempDir()
	writeDesktopBundle(t, dir)

	stdout, _, err := execDesktop(t, "desktop", "update", "--path", dir)
	if err != nil {
		t.Fatalf("update with a running app must auto-restart, not refuse: %v", err)
	}
	if !strings.Contains(stdout, "Updated Run Kit v3.12.2 -> v3.13.0") {
		t.Errorf("stdout = %q, want the updated outcome line", stdout)
	}
	if !strings.Contains(stdout, "Run Kit was running — restarted on the new version.") {
		t.Errorf("stdout = %q, want the restart announcement data line", stdout)
	}
	if assetHits != 1 {
		t.Errorf("asset downloads = %d, want 1", assetHits)
	}
}

// TestDesktopInstallForceRunningAppAutoRestarts: --force stays scoped to
// version state; a running app is auto-restarted, never refused (R6).
func TestDesktopInstallForceRunningAppAutoRestarts(t *testing.T) {
	var assetHits int
	srv := desktopReleaseServer(t, "3.13.0", &assetHits)
	withDesktopStub(t, srv, desktopFakeRunner(t, "3.13.0", true))
	dir := t.TempDir()
	writeDesktopBundle(t, dir)

	stdout, _, err := execDesktop(t, "desktop", "install", "--path", dir, "--force")
	if err != nil {
		t.Fatalf("install --force with a running app must auto-restart, not refuse: %v", err)
	}
	if !strings.Contains(stdout, "Installed Run Kit v3.13.0") {
		t.Errorf("stdout = %q, want the installed outcome line", stdout)
	}
	if !strings.Contains(stdout, "restarted on the new version") {
		t.Errorf("stdout = %q, want the restart announcement", stdout)
	}
}

func TestDesktopStatusReport(t *testing.T) {
	var assetHits int
	srv := desktopReleaseServer(t, "3.13.0", &assetHits)
	withDesktopStub(t, srv, desktopFakeRunner(t, "3.12.2", false))
	dir := t.TempDir()
	writeDesktopBundle(t, dir)

	stdout, _, err := execDesktop(t, "desktop", "status", "--path", dir)
	if err != nil {
		t.Fatalf("status: %v", err)
	}
	for _, want := range []string{"Installed: v3.12.2", "Latest:    v3.13.0", "Update available"} {
		if !strings.Contains(stdout, want) {
			t.Errorf("stdout = %q, want it to contain %q", stdout, want)
		}
	}
	if assetHits != 0 {
		t.Errorf("status downloaded the asset %d times — it must be read-only", assetHits)
	}
}

func TestDesktopStatusNotInstalled(t *testing.T) {
	var assetHits int
	srv := desktopReleaseServer(t, "3.13.0", &assetHits)
	withDesktopStub(t, srv, desktopFakeRunner(t, "", false))
	dir := t.TempDir()

	stdout, _, err := execDesktop(t, "desktop", "status", "--path", dir)
	if err != nil {
		t.Fatalf("status: %v", err)
	}
	for _, want := range []string{"Installed: not installed", "Latest:    v3.13.0", "rk desktop install"} {
		if !strings.Contains(stdout, want) {
			t.Errorf("stdout = %q, want it to contain %q", stdout, want)
		}
	}
}

// TestDesktopQuietSplitsDataFromChatter: the outcome line is data (survives
// --quiet on stdout); the resolve/progress narration is chatter (stderr,
// dropped under --quiet) — Toolkit Principle 9.
func TestDesktopQuietSplitsDataFromChatter(t *testing.T) {
	var assetHits int
	srv := desktopReleaseServer(t, "3.13.0", &assetHits)
	withDesktopStub(t, srv, desktopFakeRunner(t, "3.13.0", false))
	dir := t.TempDir()
	writeDesktopBundle(t, dir)

	stdout, stderr, err := execDesktop(t, "desktop", "install", "--path", dir, "--quiet")
	if err != nil {
		t.Fatalf("install --quiet: %v", err)
	}
	if !strings.Contains(stdout, "already installed") {
		t.Errorf("stdout = %q, want the outcome line to survive --quiet", stdout)
	}
	if stderr != "" {
		t.Errorf("stderr = %q, want empty under --quiet", stderr)
	}
}
