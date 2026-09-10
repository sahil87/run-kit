package main

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"rk/internal/gui"

	"github.com/spf13/cobra"
)

// withGuiLaunchSeams points the launch verb's own seams at capturing stubs and
// restores them on cleanup; the returned recorder holds the start calls as
// argv followed by env entries (the withGuiExecSeams shape).
func withGuiLaunchSeams(t *testing.T) (startCalls *[][]string) {
	t.Helper()
	startCalls = new([][]string)

	origStat, origStart, origGOOS := guiStatFn, guiLaunchStartFn, guiGOOS
	origEval, origDial := guiEvalSymlinksFn, guiDialFn
	t.Cleanup(func() {
		guiStatFn, guiLaunchStartFn = origStat, origStart
		guiGOOS = origGOOS
		guiEvalSymlinksFn, guiDialFn = origEval, origDial
	})

	guiStatFn = func(string) (os.FileInfo, error) { return nil, nil }
	guiLaunchStartFn = func(argv []string, env []string) (int, error) {
		*startCalls = append(*startCalls, append(argv, env...))
		return 4321, nil
	}
	// --cdp: the symlink resolution defaults to identity (tests point it at a
	// family member or Firefox) and the CDP port defaults to answering.
	guiEvalSymlinksFn = func(p string) (string, error) { return p, nil }
	guiDialFn = func(context.Context, string) error { return nil }
	guiGOOS = "linux"
	return startCalls
}

func TestGuiLaunchTerminalStarts(t *testing.T) {
	startCalls := withGuiLaunchSeams(t)
	withGuiCLISeams(t)
	seedGuiOn(t)
	guiLookPathFn = lookPathOnly("xterm")

	var out bytes.Buffer
	if err := runGuiLaunch(bareCmd(&out, &bytes.Buffer{}), []string{"terminal"}); err != nil {
		t.Fatal(err)
	}
	if len(*startCalls) != 1 {
		t.Fatalf("start calls = %d, want 1", len(*startCalls))
	}
	call := (*startCalls)[0]
	if call[0] != "/usr/bin/xterm" {
		t.Errorf("start argv = %v, want [/usr/bin/xterm] (the resolved path only)", call[:1])
	}
	foundDisplay := false
	for _, kv := range call[1:] {
		if kv == "DISPLAY=:10" {
			foundDisplay = true
		}
	}
	if !foundDisplay {
		t.Errorf("start env lacks DISPLAY=:10: %v", call[1:])
	}
	if got, want := out.String(), "started xterm (pid 4321) on :10\n"; got != want {
		t.Errorf("stdout = %q, want %q", got, want)
	}
}

func TestGuiLaunchBrowserMissPrintsHint(t *testing.T) {
	startCalls := withGuiLaunchSeams(t)
	withGuiCLISeams(t)
	seedGuiOn(t)
	guiLookPathFn = lookPathOnly("apt-get")

	err := runGuiLaunch(bareCmd(&bytes.Buffer{}, &bytes.Buffer{}), []string{"browser"})
	if err == nil || err.Error() != "no browser on the GUI host — sudo apt install chromium-browser" {
		t.Errorf("err = %v, want the browser install hint", err)
	}
	if code := exitCode(err); code != 1 {
		t.Errorf("exit code = %d, want 1", code)
	}
	if len(*startCalls) != 0 {
		t.Errorf("start seam called %d times after a ladder miss", len(*startCalls))
	}
}

func TestGuiLaunchOffRefuses(t *testing.T) {
	startCalls := withGuiLaunchSeams(t)
	withGuiCLISeams(t)

	err := runGuiLaunch(bareCmd(&bytes.Buffer{}, &bytes.Buffer{}), []string{"terminal"})
	if err == nil || err.Error() != guiErrOff {
		t.Errorf("err = %v, want the off refusal", err)
	}
	if code := exitCode(err); code != 1 {
		t.Errorf("exit code = %d, want 1", code)
	}
	if len(*startCalls) != 0 {
		t.Errorf("start seam called %d times while off — no process may start", len(*startCalls))
	}
}

func TestGuiLaunchDarwinRefusesBeforeStatusRead(t *testing.T) {
	startCalls := withGuiLaunchSeams(t)
	guiGOOS = "darwin"
	guiDaemonRunningFn = func() bool {
		t.Error("status seams consulted on darwin — the OS refusal must fire first")
		return false
	}

	err := runGuiLaunch(bareCmd(&bytes.Buffer{}, &bytes.Buffer{}), []string{"terminal"})
	if err == nil || err.Error() != "gui launch is not supported on macOS in v1 — the GUI mirrors your live session view-only" {
		t.Errorf("err = %v, want the macOS refusal", err)
	}
	if code := exitCode(err); code != 1 {
		t.Errorf("exit code = %d, want 1", code)
	}
	if len(*startCalls) != 0 {
		t.Errorf("start seam called %d times on darwin", len(*startCalls))
	}
}

func TestGuiLaunchBadRoleIsUsage(t *testing.T) {
	startCalls := withGuiLaunchSeams(t)
	withGuiCLISeams(t)
	seedGuiOn(t)

	err := runGuiLaunch(bareCmd(&bytes.Buffer{}, &bytes.Buffer{}), []string{"xterm"})
	if err == nil || err.Error() != "app must be terminal or browser" {
		t.Errorf("err = %v, want the role refusal", err)
	}
	if code := exitCode(err); code != 2 {
		t.Errorf("exit code = %d, want 2 (usage)", code)
	}
	if len(*startCalls) != 0 {
		t.Errorf("start seam called %d times on a bad role", len(*startCalls))
	}
}

func TestGuiLaunchStartFailure(t *testing.T) {
	withGuiLaunchSeams(t)
	withGuiCLISeams(t)
	seedGuiOn(t)
	guiLookPathFn = lookPathOnly("xterm")
	guiLaunchStartFn = func([]string, []string) (int, error) { return 0, errors.New("fork/exec: permission denied") }

	err := runGuiLaunch(bareCmd(&bytes.Buffer{}, &bytes.Buffer{}), []string{"terminal"})
	if err == nil || !strings.Contains(err.Error(), "error: xterm: fork/exec: permission denied") {
		t.Errorf("err = %v, want error: <name>: <reason>", err)
	}
	if code := exitCode(err); code != 1 {
		t.Errorf("exit code = %d, want 1", code)
	}
}

// --- launch browser --cdp (R11) ---

// launchCmdWith builds a bare command carrying the launch verb's --cdp/--port
// flags.
func launchCmdWith(out, errOut *bytes.Buffer, flags map[string]string) *cobra.Command {
	cmd := bareCmd(out, errOut)
	cmd.Flags().Bool("cdp", false, "")
	cmd.Flags().Int("port", guiCDPDefaultPort, "")
	setFlags(cmd, flags)
	return cmd
}

func TestGuiLaunchCDPArgvAndPortLine(t *testing.T) {
	startCalls := withGuiLaunchSeams(t)
	withGuiCLISeams(t)
	seedGuiOn(t)
	guiLookPathFn = lookPathOnly("chromium")

	var out bytes.Buffer
	err := runGuiLaunch(launchCmdWith(&out, &bytes.Buffer{}, map[string]string{"cdp": "true"}), []string{"browser"})
	if err != nil {
		t.Fatal(err)
	}
	stateDir, err := gui.StateDir()
	if err != nil {
		t.Fatal(err)
	}
	call := (*startCalls)[0]
	want := []string{
		"/usr/bin/chromium",
		"--remote-debugging-port=9222",
		"--user-data-dir=" + filepath.Join(stateDir, "cdp-9222"),
	}
	if strings.Join(call[:3], " ") != strings.Join(want, " ") {
		t.Errorf("start argv = %v, want %v", call[:3], want)
	}
	wantOut := "started chromium (pid 4321) on :10\ncdp http://127.0.0.1:9222\n"
	if got := out.String(); got != wantOut {
		t.Errorf("stdout = %q, want %q", got, wantOut)
	}
}

func TestGuiLaunchCDPPortTimeout(t *testing.T) {
	withGuiLaunchSeams(t)
	withGuiCLISeams(t)
	seedGuiOn(t)
	guiLookPathFn = lookPathOnly("chromium")
	guiDialFn = func(context.Context, string) error { return errors.New("connection refused") }
	origTimeout, origPoll := guiCDPWaitTimeout, guiCDPWaitPoll
	guiCDPWaitTimeout, guiCDPWaitPoll = 100*time.Millisecond, 5*time.Millisecond
	t.Cleanup(func() { guiCDPWaitTimeout, guiCDPWaitPoll = origTimeout, origPoll })

	var out bytes.Buffer
	err := runGuiLaunch(launchCmdWith(&out, &bytes.Buffer{}, map[string]string{"cdp": "true"}), []string{"browser"})
	if err == nil || err.Error() != "cdp port 9222 did not open within 100ms (browser pid 4321 is running)" {
		t.Errorf("err = %v, want the port-timeout error (naming the shrunk budget)", err)
	}
	if code := exitCode(err); code != 1 {
		t.Errorf("exit code = %d, want 1", code)
	}
	if got, want := out.String(), "started chromium (pid 4321) on :10\n"; got != want {
		t.Errorf("stdout = %q, want %q (the started line already printed)", got, want)
	}
}

func TestGuiLaunchCDPOnTerminalIsUsage(t *testing.T) {
	startCalls := withGuiLaunchSeams(t)
	withGuiCLISeams(t)
	seedGuiOn(t)
	guiLookPathFn = lookPathOnly("xterm")

	err := runGuiLaunch(launchCmdWith(&bytes.Buffer{}, &bytes.Buffer{}, map[string]string{"cdp": "true"}), []string{"terminal"})
	if err == nil || exitCode(err) != exitUsage {
		t.Errorf("err = %v (code %d), want a usage error (exit 2)", err, exitCode(err))
	}
	if len(*startCalls) != 0 {
		t.Errorf("start called %d times for --cdp on terminal", len(*startCalls))
	}
}

func TestGuiLaunchCDPFirefoxRefuses(t *testing.T) {
	startCalls := withGuiLaunchSeams(t)
	withGuiCLISeams(t)
	seedGuiOn(t)
	guiLookPathFn = lookPathOnly("firefox")

	err := runGuiLaunch(launchCmdWith(&bytes.Buffer{}, &bytes.Buffer{}, map[string]string{"cdp": "true"}), []string{"browser"})
	if err == nil || err.Error() != "--cdp needs a Chromium-family browser (resolved firefox)" {
		t.Errorf("err = %v, want the Chromium-family refusal", err)
	}
	if code := exitCode(err); code != 1 {
		t.Errorf("exit code = %d, want 1", code)
	}
	if len(*startCalls) != 0 {
		t.Errorf("start called %d times for a Firefox resolution", len(*startCalls))
	}
}

// The x-www-browser alternative joins the family by its symlink target's
// basename.
func TestGuiLaunchCDPWWWBrowserResolvesBySymlinkTarget(t *testing.T) {
	startCalls := withGuiLaunchSeams(t)
	withGuiCLISeams(t)
	seedGuiOn(t)
	guiLookPathFn = lookPathOnly("x-www-browser")
	guiEvalSymlinksFn = func(string) (string, error) { return "/usr/lib/chromium/chromium", nil }

	var out bytes.Buffer
	if err := runGuiLaunch(launchCmdWith(&out, &bytes.Buffer{}, map[string]string{"cdp": "true"}), []string{"browser"}); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out.String(), "cdp http://127.0.0.1:9222\n") {
		t.Errorf("stdout = %q, want the cdp line for the chromium-resolving alternative", out.String())
	}
	if len(*startCalls) != 1 {
		t.Fatalf("start calls = %d, want 1", len(*startCalls))
	}
}

func TestGuiLaunchCDPWWWBrowserToFirefoxRefuses(t *testing.T) {
	startCalls := withGuiLaunchSeams(t)
	withGuiCLISeams(t)
	seedGuiOn(t)
	guiLookPathFn = lookPathOnly("x-www-browser")
	guiEvalSymlinksFn = func(string) (string, error) { return "/usr/bin/firefox", nil }

	err := runGuiLaunch(launchCmdWith(&bytes.Buffer{}, &bytes.Buffer{}, map[string]string{"cdp": "true"}), []string{"browser"})
	if err == nil || err.Error() != "--cdp needs a Chromium-family browser (resolved x-www-browser)" {
		t.Errorf("err = %v, want the Chromium-family refusal", err)
	}
	if code := exitCode(err); code != 1 {
		t.Errorf("exit code = %d, want 1", code)
	}
	if len(*startCalls) != 0 {
		t.Errorf("start called %d times for a firefox-resolving alternative", len(*startCalls))
	}
}

func TestGuiLaunchCDPPortZeroIsUsage(t *testing.T) {
	startCalls := withGuiLaunchSeams(t)
	withGuiCLISeams(t)
	seedGuiOn(t)
	guiLookPathFn = lookPathOnly("chromium")

	err := runGuiLaunch(launchCmdWith(&bytes.Buffer{}, &bytes.Buffer{}, map[string]string{"cdp": "true", "port": "0"}), []string{"browser"})
	if err == nil || exitCode(err) != exitUsage {
		t.Errorf("err = %v (code %d), want a usage error (exit 2)", err, exitCode(err))
	}
	if len(*startCalls) != 0 {
		t.Errorf("start called %d times for --port 0", len(*startCalls))
	}
}

func TestGuiWaitCDPPortStopsOnCancel(t *testing.T) {
	origDial := guiDialFn
	origTimeout, origPoll := guiCDPWaitTimeout, guiCDPWaitPoll
	t.Cleanup(func() { guiDialFn, guiCDPWaitTimeout, guiCDPWaitPoll = origDial, origTimeout, origPoll })
	guiDialFn = func(context.Context, string) error { return errors.New("connection refused") }
	guiCDPWaitTimeout, guiCDPWaitPoll = 10*time.Second, 5*time.Second

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	start := time.Now()
	err := guiWaitCDPPort(ctx, 9222)
	if !errors.Is(err, context.Canceled) {
		t.Errorf("err = %v, want context.Canceled", err)
	}
	if time.Since(start) > time.Second {
		t.Errorf("wait ran %s after cancel, want an immediate return", time.Since(start))
	}
}
