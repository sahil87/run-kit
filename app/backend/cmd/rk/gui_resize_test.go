package main

import (
	"bytes"
	"context"
	"errors"
	"strings"
	"testing"

	"rk/internal/gui"
	"rk/internal/settings"
)

// --- xrandr seam ---

// xrandrCall is one captured guiXrandrRunFn invocation.
type xrandrCall struct {
	display string
	argv    []string
}

// withGuiXrandrSeams captures every guiXrandrRunFn call (display + argv) and
// answers from script, keyed by strings.Join(argv, " ") — the
// withGuiXdoSeams shape. A multi-entry queue is consumed in order; a single
// entry answers every call. Unscripted argv returns "", nil. Restores via
// t.Cleanup.
func withGuiXrandrSeams(t *testing.T, script map[string][]xdoResult) *[]xrandrCall {
	t.Helper()
	calls := new([]xrandrCall)
	orig := guiXrandrRunFn
	t.Cleanup(func() { guiXrandrRunFn = orig })
	guiXrandrRunFn = func(_ context.Context, display string, argv []string) (string, error) {
		*calls = append(*calls, xrandrCall{display: display, argv: argv})
		key := strings.Join(argv, " ")
		if q := script[key]; len(q) > 0 {
			r := q[0]
			if len(q) > 1 {
				script[key] = q[1:]
			}
			return r.out, r.err
		}
		return "", nil
	}
	return calls
}

// xrandrArgvStrings renders the captured calls' argv for assertions.
func xrandrArgvStrings(calls []xrandrCall) []string {
	out := make([]string, 0, len(calls))
	for _, c := range calls {
		out = append(out, strings.Join(c.argv, " "))
	}
	return out
}

// xrandrQueryOut lists both 1920x1080 and 1600x900 on the connected output,
// so a resize between them needs the single --output --mode step.
const xrandrQueryOut = "Screen 0: minimum 320 x 200, current 1920 x 1080, maximum 8192 x 8192\n" +
	"default connected 1920x1080+0+0 0mm x 0mm\n" +
	"   1920x1080     60.00* \n" +
	"   1600x900      60.00\n"

// --- the three § UX invocations ---

func TestGuiResizeFixedAppliesAndPersists(t *testing.T) {
	calls := withGuiXrandrSeams(t, map[string][]xdoResult{
		"xrandr --query": {{out: xrandrQueryOut}},
	})
	withGuiCLISeams(t)
	seedGuiOn(t)

	var out bytes.Buffer
	if err := runGuiResize(bareCmd(&out, &bytes.Buffer{}), []string{"1600x900"}); err != nil {
		t.Fatal(err)
	}
	want := []string{"xrandr --query", "xrandr --output default --mode 1600x900"}
	if got := xrandrArgvStrings(*calls); strings.Join(got, "|") != strings.Join(want, "|") {
		t.Errorf("xrandr calls = %v, want %v (query then resize)", got, want)
	}
	for _, c := range *calls {
		if c.display != ":10" {
			t.Errorf("display = %q, want :10 (the status display)", c.display)
		}
	}
	if got := settings.Load().GUIGeometry; got != "1600x900" {
		t.Errorf("gui.geometry = %q, want 1600x900", got)
	}
	if got, want := out.String(), "resized :10 to 1600x900 (was 1920x1080)\n"; got != want {
		t.Errorf("stdout = %q, want %q", got, want)
	}
}

func TestGuiResizeAutoPersistsWithoutXrandr(t *testing.T) {
	calls := withGuiXrandrSeams(t, nil)
	withGuiCLISeams(t)
	seedGuiOn(t)

	var out bytes.Buffer
	if err := runGuiResize(bareCmd(&out, &bytes.Buffer{}), []string{"auto"}); err != nil {
		t.Fatal(err)
	}
	if len(*calls) != 0 {
		t.Errorf("xrandr calls = %v, want none for auto", xrandrArgvStrings(*calls))
	}
	if got := settings.Load().GUIGeometry; got != "auto" {
		t.Errorf("gui.geometry = %q, want auto", got)
	}
	if got, want := out.String(), "desktop follows the focused viewer (gui.geometry=auto)\n"; got != want {
		t.Errorf("stdout = %q, want %q", got, want)
	}
}

func TestGuiResizeOutOfRangeIsUsage(t *testing.T) {
	calls := withGuiXrandrSeams(t, nil)
	withGuiCLISeams(t)
	seedGuiOn(t)

	err := runGuiResize(bareCmd(&bytes.Buffer{}, &bytes.Buffer{}), []string{"100x100"})
	if err == nil || err.Error() != "geometry 100x100 out of range (320–7680 per side)" {
		t.Errorf("err = %v, want exactly the range usage error", err)
	}
	if code := exitCode(err); code != exitUsage {
		t.Errorf("exit code = %d, want %d (usage)", code, exitUsage)
	}
	if len(*calls) != 0 {
		t.Errorf("xrandr calls = %v, want none on a usage error", xrandrArgvStrings(*calls))
	}
	if got := settings.Load().GUIGeometry; got != "1920x1080" {
		t.Errorf("gui.geometry = %q, want unchanged 1920x1080", got)
	}
}

// --- refusals and the xrandr failure ---

func TestGuiResizeOffRefuses(t *testing.T) {
	calls := withGuiXrandrSeams(t, nil)
	withGuiCLISeams(t)

	err := runGuiResize(bareCmd(&bytes.Buffer{}, &bytes.Buffer{}), []string{"1600x900"})
	if err == nil || err.Error() != guiErrOff {
		t.Errorf("err = %v, want the gui-off refusal", err)
	}
	if code := exitCode(err); code != 1 {
		t.Errorf("exit code = %d, want 1", code)
	}
	if len(*calls) != 0 {
		t.Errorf("xrandr calls = %v, want none while off", xrandrArgvStrings(*calls))
	}
}

func TestGuiResizeNotRunningRefuses(t *testing.T) {
	calls := withGuiXrandrSeams(t, nil)
	withGuiCLISeams(t)
	seedGuiOn(t)
	guiProbeFn = func(context.Context, string, string) (gui.Info, error) {
		return gui.Info{}, errors.New("connection refused")
	}

	err := runGuiResize(bareCmd(&bytes.Buffer{}, &bytes.Buffer{}), []string{"1600x900"})
	if err == nil || err.Error() != guiErrNotRunning {
		t.Errorf("err = %v, want the not-running refusal", err)
	}
	if code := exitCode(err); code != 1 {
		t.Errorf("exit code = %d, want 1", code)
	}
	if len(*calls) != 0 {
		t.Errorf("xrandr calls = %v, want none while not running", xrandrArgvStrings(*calls))
	}
}

func TestGuiResizeXrandrFailureLeavesSetting(t *testing.T) {
	calls := withGuiXrandrSeams(t, map[string][]xdoResult{
		"xrandr --query": {{out: xrandrQueryOut}},
		"xrandr --output default --mode 1600x900": {{err: errors.New("X Error of failed request")}},
	})
	withGuiCLISeams(t)
	seedGuiOn(t)

	err := runGuiResize(bareCmd(&bytes.Buffer{}, &bytes.Buffer{}), []string{"1600x900"})
	if err == nil || err.Error() != "error: xrandr failed: X Error of failed request" {
		t.Errorf("err = %v, want exactly the xrandr failure with the stderr tail", err)
	}
	if code := exitCode(err); code != 1 {
		t.Errorf("exit code = %d, want 1", code)
	}
	if len(*calls) != 2 {
		t.Errorf("xrandr calls = %v, want the query then the failing resize step", xrandrArgvStrings(*calls))
	}
	if got := settings.Load().GUIGeometry; got != "1920x1080" {
		t.Errorf("gui.geometry = %q, want untouched 1920x1080 on an xrandr failure", got)
	}
}

func TestGuiResizeXrandrMissingRefuses(t *testing.T) {
	calls := withGuiXrandrSeams(t, nil)
	withGuiCLISeams(t)
	seedGuiOn(t)
	guiLookPathFn = func(name string) (string, error) {
		if name == "xrandr" {
			return "", errors.New("not found")
		}
		return "/usr/bin/" + name, nil
	}

	err := runGuiResize(bareCmd(&bytes.Buffer{}, &bytes.Buffer{}), []string{"1600x900"})
	if err == nil || err.Error() != "xrandr not found — sudo apt install x11-xserver-utils" {
		t.Errorf("err = %v, want the xrandr install hint", err)
	}
	if code := exitCode(err); code != 1 {
		t.Errorf("exit code = %d, want 1", code)
	}
	if len(*calls) != 0 {
		t.Errorf("xrandr calls = %v, want none without the tool", xrandrArgvStrings(*calls))
	}
	if got := settings.Load().GUIGeometry; got != "1920x1080" {
		t.Errorf("gui.geometry = %q, want unchanged 1920x1080", got)
	}
}

func TestGuiResizeDarwinRefusesBeforeStatusRead(t *testing.T) {
	withGuiXrandrSeams(t, nil)
	withGuiCLISeams(t)
	origGOOS := guiGOOS
	guiGOOS = "darwin"
	t.Cleanup(func() { guiGOOS = origGOOS })
	guiDaemonRunningFn = func() bool {
		t.Error("status seams consulted on darwin — the OS refusal must fire first")
		return false
	}

	err := runGuiResize(bareCmd(&bytes.Buffer{}, &bytes.Buffer{}), []string{"1600x900"})
	if err == nil || err.Error() != guiDarwinRefusal("resize").Error() {
		t.Errorf("err = %v, want the macOS refusal for resize", err)
	}
	if code := exitCode(err); code != 1 {
		t.Errorf("exit code = %d, want 1", code)
	}
}

func TestGuiResizeArgCountIsUsage(t *testing.T) {
	for _, args := range [][]string{nil, {"1600x900", "auto"}} {
		if err := guiResizeCmd.Args(guiResizeCmd, args); err == nil || exitCode(err) != exitUsage {
			t.Errorf("args %v: err = %v, exit code = %d, want %d (usage)", args, err, exitCode(err), exitUsage)
		}
	}
}
