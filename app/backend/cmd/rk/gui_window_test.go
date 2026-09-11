package main

import (
	"bytes"
	"context"
	"errors"
	"strings"
	"testing"

	"rk/internal/gui"

	"github.com/spf13/cobra"
)

// windowsCmdWith builds a bare command carrying the windows verb's --json flag.
func windowsCmdWith(out, errOut *bytes.Buffer, jsonOut bool) *cobra.Command {
	cmd := bareCmd(out, errOut)
	cmd.Flags().Bool("json", false, "")
	if jsonOut {
		_ = cmd.Flags().Set("json", "true")
	}
	return cmd
}

// focusCmdWith builds a bare command carrying the focus verb's flags.
func focusCmdWith(out, errOut *bytes.Buffer, flags map[string]string) *cobra.Command {
	cmd := bareCmd(out, errOut)
	cmd.Flags().String("title", "", "")
	cmd.Flags().Bool("force", false, "")
	setFlags(cmd, flags)
	return cmd
}

// twoWindowScript is the scripted display behind the windows tests: the
// root-class window 42 (no _NET_WM_PID) and xterm 9001 (the active one).
func twoWindowScript() map[string][]xdoResult {
	return map[string][]xdoResult{
		// The empty-regex search: xdotool lists every visible top-level window.
		"search --onlyvisible --name ":   {{out: "9001\n42\n"}},
		"getwindowname 42":               {{out: "root-ish"}},
		"getwindowname 9001":             {{out: "xterm"}},
		"getwindowgeometry --shell 42":   {{out: "WINDOW=42\nX=0\nY=0\nWIDTH=1920\nHEIGHT=1080\nSCREEN=0"}},
		"getwindowgeometry --shell 9001": {{out: "WINDOW=9001\nX=10\nY=20\nWIDTH=800\nHEIGHT=600\nSCREEN=0"}},
		// No _NET_WM_PID on 42 degrades to pid 0, never an error.
		"getwindowpid 42":   {{err: errors.New("exit status 1")}},
		"getwindowpid 9001": {{out: "4242"}},
		"getactivewindow":   {{out: "9001"}},
	}
}

func TestGuiWindowsRowsSortedActiveMarked(t *testing.T) {
	withGuiXdoSeams(t, twoWindowScript())
	withGuiCLISeams(t)
	seedGuiOn(t)

	var out bytes.Buffer
	if err := runGuiWindows(windowsCmdWith(&out, &bytes.Buffer{}, false), nil); err != nil {
		t.Fatal(err)
	}
	want := "42 0 1920x1080+0+0 root-ish\n9001 4242 800x600+10+20 xterm *\n"
	if got := out.String(); got != want {
		t.Errorf("stdout = %q, want %q", got, want)
	}
}

func TestGuiWindowsJSON(t *testing.T) {
	withGuiXdoSeams(t, twoWindowScript())
	withGuiCLISeams(t)
	seedGuiOn(t)

	var out bytes.Buffer
	if err := runGuiWindows(windowsCmdWith(&out, &bytes.Buffer{}, true), nil); err != nil {
		t.Fatalf("runGuiWindows: %v, want exit 0", err)
	}
	var windows []gui.Window
	unwrapEnvelopeResult(t, out.String(), &windows)
	if len(windows) != 2 {
		t.Fatalf("windows = %+v, want 2 rows", windows)
	}
	root, term := windows[0], windows[1]
	if root.ID != 42 || root.PID != 0 || root.Width != 1920 || root.Height != 1080 || root.X != 0 || root.Y != 0 || root.Title != "root-ish" || root.Active {
		t.Errorf("row 42 = %+v, want the pid-0 root-class row", root)
	}
	if root.App != "" {
		t.Errorf("row 42 app = %q, want empty without a pid", root.App)
	}
	if term.ID != 9001 || term.PID != 4242 || term.Width != 800 || term.Height != 600 || term.X != 10 || term.Y != 20 || term.Title != "xterm" || !term.Active {
		t.Errorf("row 9001 = %+v, want the active xterm row", term)
	}
}

// xdotool exits 1 with empty stdout when the search matches nothing — an
// empty display is an empty inventory ("result": [] inside the envelope),
// never an error.
func TestGuiWindowsEmptyDisplayEmitsEmptyJSON(t *testing.T) {
	withGuiXdoSeams(t, map[string][]xdoResult{
		"search --onlyvisible --name ": {{out: "", err: errors.New("exit status 1")}},
	})
	withGuiCLISeams(t)
	seedGuiOn(t)

	var out bytes.Buffer
	if err := runGuiWindows(windowsCmdWith(&out, &bytes.Buffer{}, true), nil); err != nil {
		t.Fatalf("runGuiWindows: %v, want exit 0", err)
	}
	if got, want := out.String(), "{\n  \"ok\": true,\n  \"result\": []\n}\n"; got != want {
		t.Errorf("stdout = %q, want %q", got, want)
	}
}

func TestGuiWindowsXdotoolMissing(t *testing.T) {
	withGuiXdoSeams(t, nil)
	withGuiCLISeams(t)
	seedGuiOn(t)
	guiLookPathFn = lookPathOnly()

	err := runGuiWindows(windowsCmdWith(&bytes.Buffer{}, &bytes.Buffer{}, false), nil)
	if err == nil || err.Error() != "xdotool not found — sudo apt install xdotool" {
		t.Errorf("err = %v, want the xdotool install hint", err)
	}
	if code := exitCode(err); code != 1 {
		t.Errorf("exit code = %d, want 1", code)
	}
}

// --- focus ---

func TestGuiFocusByTitleActivates(t *testing.T) {
	calls := withGuiXdoSeams(t, map[string][]xdoResult{
		"search --onlyvisible --name foo": {{out: "42"}},
	})
	withGuiCLISeams(t)
	seedGuiOn(t)

	if err := runGuiFocus(focusCmdWith(&bytes.Buffer{}, &bytes.Buffer{}, map[string]string{"title": "foo"}), nil); err != nil {
		t.Fatal(err)
	}
	want := []string{"search --onlyvisible --name foo", "windowactivate --sync 42"}
	if got := xdoArgvStrings(*calls); strings.Join(got, "|") != strings.Join(want, "|") {
		t.Errorf("xdo calls = %v, want %v", got, want)
	}
}

func TestGuiFocusNoMatch(t *testing.T) {
	withGuiXdoSeams(t, map[string][]xdoResult{
		"search --onlyvisible --name foo": {{out: "", err: errors.New("exit status 1")}},
	})
	withGuiCLISeams(t)
	seedGuiOn(t)

	err := runGuiFocus(focusCmdWith(&bytes.Buffer{}, &bytes.Buffer{}, map[string]string{"title": "foo"}), nil)
	if err == nil || err.Error() != `no window matches "foo"` {
		t.Errorf("err = %v, want the no-match refusal", err)
	}
	if code := exitCode(err); code != 1 {
		t.Errorf("exit code = %d, want 1", code)
	}
}

func TestGuiFocusAmbiguousNamesEveryMatch(t *testing.T) {
	withGuiXdoSeams(t, map[string][]xdoResult{
		"search --onlyvisible --name term": {{out: "42\n77"}},
		"getwindowname 42":                 {{out: "alpha"}},
		"getwindowname 77":                 {{out: "beta"}},
	})
	withGuiCLISeams(t)
	seedGuiOn(t)

	err := runGuiFocus(focusCmdWith(&bytes.Buffer{}, &bytes.Buffer{}, map[string]string{"title": "term"}), nil)
	if err == nil || err.Error() != `ambiguous "term": 2 windows match — 42 alpha, 77 beta` {
		t.Errorf("err = %v, want the ambiguous refusal naming both", err)
	}
	if code := exitCode(err); code != 1 {
		t.Errorf("exit code = %d, want 1", code)
	}
}

func TestGuiFocusNumericIDNotAWindow(t *testing.T) {
	withGuiXdoSeams(t, map[string][]xdoResult{
		"getwindowgeometry --shell 42": {{err: errors.New("exit status 1")}},
	})
	withGuiCLISeams(t)
	seedGuiOn(t)

	err := runGuiFocus(focusCmdWith(&bytes.Buffer{}, &bytes.Buffer{}, nil), []string{"42"})
	if err == nil || err.Error() != "42: not a window" {
		t.Errorf("err = %v, want 42: not a window", err)
	}
	if code := exitCode(err); code != 1 {
		t.Errorf("exit code = %d, want 1", code)
	}
}

func TestGuiFocusGuardedByHumanInput(t *testing.T) {
	calls := withGuiXdoSeams(t, map[string][]xdoResult{
		"getwindowgeometry --shell 42": {{out: "WINDOW=42\nX=0\nY=0\nWIDTH=100\nHEIGHT=100\nSCREEN=0"}},
	})
	withGuiCLISeams(t)
	seedGuiOn(t)
	guiFetchDaemonStatusFn = func(context.Context) (gui.Status, bool) {
		return gui.Status{HumanInputAgoMS: 100}, true
	}

	err := runGuiFocus(focusCmdWith(&bytes.Buffer{}, &bytes.Buffer{}, nil), []string{"42"})
	if err == nil || err.Error() != "human input 1s ago — retry or pass --force" {
		t.Errorf("err = %v, want the human-input refusal", err)
	}
	if code := exitCode(err); code != 1 {
		t.Errorf("exit code = %d, want 1", code)
	}
	for _, c := range *calls {
		if c.argv[0] == "windowactivate" {
			t.Errorf("windowactivate ran under the guard: %v", xdoArgvStrings(*calls))
		}
	}

	if err := runGuiFocus(focusCmdWith(&bytes.Buffer{}, &bytes.Buffer{}, map[string]string{"force": "true"}), []string{"42"}); err != nil {
		t.Fatalf("--force: %v", err)
	}
	got := xdoArgvStrings(*calls)
	if got[len(got)-1] != "windowactivate --sync 42" {
		t.Errorf("xdo calls = %v, want windowactivate --sync 42 last", got)
	}
}

func TestGuiFocusArgAndTitleIsUsage(t *testing.T) {
	withGuiXdoSeams(t, nil)
	withGuiCLISeams(t)
	seedGuiOn(t)

	err := runGuiFocus(focusCmdWith(&bytes.Buffer{}, &bytes.Buffer{}, map[string]string{"title": "foo"}), []string{"42"})
	if err == nil || exitCode(err) != exitUsage {
		t.Errorf("err = %v (code %d), want a usage error (exit 2)", err, exitCode(err))
	}
}
