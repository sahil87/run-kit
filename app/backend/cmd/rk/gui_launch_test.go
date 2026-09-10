package main

import (
	"bytes"
	"errors"
	"os"
	"strings"
	"testing"
)

// withGuiLaunchSeams points the launch verb's own seams at capturing stubs and
// restores them on cleanup; the returned recorder holds the start calls as
// argv followed by env entries (the withGuiExecSeams shape).
func withGuiLaunchSeams(t *testing.T) (startCalls *[][]string) {
	t.Helper()
	startCalls = new([][]string)

	origStat, origStart, origGOOS := guiStatFn, guiLaunchStartFn, guiGOOS
	t.Cleanup(func() {
		guiStatFn, guiLaunchStartFn = origStat, origStart
		guiGOOS = origGOOS
	})

	guiStatFn = func(string) (os.FileInfo, error) { return nil, nil }
	guiLaunchStartFn = func(argv []string, env []string) (int, error) {
		*startCalls = append(*startCalls, append(argv, env...))
		return 4321, nil
	}
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
