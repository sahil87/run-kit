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

// --- shared xdotool seam ---

// xdoCall is one captured guiXdoRunFn invocation.
type xdoCall struct {
	argv  []string
	stdin string
}

// xdoResult is one scripted response for an xdotool argv.
type xdoResult struct {
	out string
	err error
}

// withGuiXdoSeams captures every guiXdoRunFn call (argv + stdin) and answers
// from script, keyed by strings.Join(argv, " "). A multi-entry queue is
// consumed in order; a single entry answers every call (a poll loop gets the
// same response each tick). Unscripted argv returns "", nil. Restores via
// t.Cleanup.
func withGuiXdoSeams(t *testing.T, script map[string][]xdoResult) *[]xdoCall {
	t.Helper()
	calls := new([]xdoCall)
	orig := guiXdoRunFn
	t.Cleanup(func() { guiXdoRunFn = orig })
	guiXdoRunFn = func(_ context.Context, _ string, argv []string, stdin string) (string, error) {
		*calls = append(*calls, xdoCall{argv: argv, stdin: stdin})
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

// xdoArgvStrings renders the captured calls' argv for assertions.
func xdoArgvStrings(calls []xdoCall) []string {
	out := make([]string, 0, len(calls))
	for _, c := range calls {
		out = append(out, strings.Join(c.argv, " "))
	}
	return out
}

// --- bare command builders (the shotCmdWith idiom) ---

// setFlags applies "flag=value" pairs onto cmd (the flags are registered by
// the builder; the bareCmd idiom ignores the Set error like offCmdWith).
func setFlags(cmd *cobra.Command, flags map[string]string) {
	for k, v := range flags {
		_ = cmd.Flags().Set(k, v)
	}
}

func clickCmdWith(out, errOut *bytes.Buffer, flags map[string]string) *cobra.Command {
	cmd := bareCmd(out, errOut)
	cmd.Flags().Bool("right", false, "")
	cmd.Flags().Bool("middle", false, "")
	cmd.Flags().Bool("double", false, "")
	cmd.Flags().Uint64("window", 0, "")
	cmd.Flags().Bool("force", false, "")
	setFlags(cmd, flags)
	return cmd
}

func moveCmdWith(out, errOut *bytes.Buffer, flags map[string]string) *cobra.Command {
	cmd := bareCmd(out, errOut)
	cmd.Flags().Bool("force", false, "")
	setFlags(cmd, flags)
	return cmd
}

func scrollCmdWith(out, errOut *bytes.Buffer, flags map[string]string) *cobra.Command {
	cmd := bareCmd(out, errOut)
	cmd.Flags().Int("n", 3, "")
	cmd.Flags().IntSlice("at", nil, "")
	cmd.Flags().Bool("force", false, "")
	setFlags(cmd, flags)
	return cmd
}

func typeCmdWith(out, errOut *bytes.Buffer, in *strings.Reader, flags map[string]string) *cobra.Command {
	cmd := bareCmdIn(out, errOut, in)
	cmd.Flags().Bool("stdin", false, "")
	cmd.Flags().Bool("force", false, "")
	setFlags(cmd, flags)
	return cmd
}

func keyCmdWith(out, errOut *bytes.Buffer, flags map[string]string) *cobra.Command {
	cmd := bareCmd(out, errOut)
	cmd.Flags().Bool("force", false, "")
	setFlags(cmd, flags)
	return cmd
}

// --- click ---

func TestGuiClickMovesThenClicks(t *testing.T) {
	calls := withGuiXdoSeams(t, nil)
	withGuiCLISeams(t)
	seedGuiOn(t)

	if err := runGuiClick(clickCmdWith(&bytes.Buffer{}, &bytes.Buffer{}, nil), []string{"10", "20"}); err != nil {
		t.Fatal(err)
	}
	want := []string{"mousemove 10 20", "click 1"}
	if got := xdoArgvStrings(*calls); strings.Join(got, "|") != strings.Join(want, "|") {
		t.Errorf("xdo calls = %v, want %v", got, want)
	}
}

func TestGuiClickButtonFlags(t *testing.T) {
	cases := []struct {
		name  string
		flags map[string]string
		want  string
	}{
		{"right", map[string]string{"right": "true"}, "click 3"},
		{"middle", map[string]string{"middle": "true"}, "click 2"},
		{"double", map[string]string{"double": "true"}, "click --repeat 2 --delay 100 1"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			calls := withGuiXdoSeams(t, nil)
			withGuiCLISeams(t)
			seedGuiOn(t)

			if err := runGuiClick(clickCmdWith(&bytes.Buffer{}, &bytes.Buffer{}, tc.flags), []string{"10", "20"}); err != nil {
				t.Fatal(err)
			}
			want := []string{"mousemove 10 20", tc.want}
			if got := xdoArgvStrings(*calls); strings.Join(got, "|") != strings.Join(want, "|") {
				t.Errorf("xdo calls = %v, want %v", got, want)
			}
		})
	}
}

func TestGuiClickWindowTranslatesCoordinates(t *testing.T) {
	calls := withGuiXdoSeams(t, map[string][]xdoResult{
		"getwindowgeometry --shell 42": {{out: "WINDOW=42\nX=100\nY=200\nWIDTH=800\nHEIGHT=600\nSCREEN=0"}},
	})
	withGuiCLISeams(t)
	seedGuiOn(t)

	err := runGuiClick(clickCmdWith(&bytes.Buffer{}, &bytes.Buffer{}, map[string]string{"window": "42"}), []string{"10", "20"})
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"getwindowgeometry --shell 42", "mousemove 110 220", "click 1"}
	if got := xdoArgvStrings(*calls); strings.Join(got, "|") != strings.Join(want, "|") {
		t.Errorf("xdo calls = %v, want %v", got, want)
	}
}

func TestGuiClickWindowNotAWindow(t *testing.T) {
	withGuiXdoSeams(t, map[string][]xdoResult{
		"getwindowgeometry --shell 42": {{err: errors.New("exit status 1")}},
	})
	withGuiCLISeams(t)
	seedGuiOn(t)

	err := runGuiClick(clickCmdWith(&bytes.Buffer{}, &bytes.Buffer{}, map[string]string{"window": "42"}), []string{"10", "20"})
	if err == nil || err.Error() != "--window 42: not a window" {
		t.Errorf("err = %v, want --window 42: not a window", err)
	}
	if code := exitCode(err); code != 1 {
		t.Errorf("exit code = %d, want 1", code)
	}
}

func TestGuiClickBadCoordinateIsUsage(t *testing.T) {
	for _, args := range [][]string{{"-1", "20"}, {"x", "20"}} {
		withGuiXdoSeams(t, nil)
		withGuiCLISeams(t)
		seedGuiOn(t)

		err := runGuiClick(clickCmdWith(&bytes.Buffer{}, &bytes.Buffer{}, nil), args)
		if err == nil {
			t.Errorf("click %v: err = nil, want a usage error", args)
			continue
		}
		if code := exitCode(err); code != exitUsage {
			t.Errorf("click %v: exit code = %d, want %d (usage)", args, code, exitUsage)
		}
	}
}

// --- move ---

func TestGuiMoveMovesOnly(t *testing.T) {
	calls := withGuiXdoSeams(t, nil)
	withGuiCLISeams(t)
	seedGuiOn(t)

	if err := runGuiMove(moveCmdWith(&bytes.Buffer{}, &bytes.Buffer{}, nil), []string{"5", "6"}); err != nil {
		t.Fatal(err)
	}
	want := []string{"mousemove 5 6"}
	if got := xdoArgvStrings(*calls); strings.Join(got, "|") != strings.Join(want, "|") {
		t.Errorf("xdo calls = %v, want %v", got, want)
	}
}

// --- scroll ---

func TestGuiScrollDirections(t *testing.T) {
	cases := []struct {
		dir  string
		want string
	}{
		{"up", "click --repeat 3 --delay 30 4"},
		{"down", "click --repeat 3 --delay 30 5"},
		{"left", "click --repeat 3 --delay 30 6"},
		{"right", "click --repeat 3 --delay 30 7"},
	}
	for _, tc := range cases {
		t.Run(tc.dir, func(t *testing.T) {
			calls := withGuiXdoSeams(t, nil)
			withGuiCLISeams(t)
			seedGuiOn(t)

			if err := runGuiScroll(scrollCmdWith(&bytes.Buffer{}, &bytes.Buffer{}, nil), []string{tc.dir}); err != nil {
				t.Fatal(err)
			}
			if got := xdoArgvStrings(*calls); len(got) != 1 || got[0] != tc.want {
				t.Errorf("xdo calls = %v, want [%s]", got, tc.want)
			}
		})
	}
}

func TestGuiScrollAtMovesFirst(t *testing.T) {
	calls := withGuiXdoSeams(t, nil)
	withGuiCLISeams(t)
	seedGuiOn(t)

	err := runGuiScroll(scrollCmdWith(&bytes.Buffer{}, &bytes.Buffer{}, map[string]string{"n": "5", "at": "10,20"}), []string{"down"})
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"mousemove 10 20", "click --repeat 5 --delay 30 5"}
	if got := xdoArgvStrings(*calls); strings.Join(got, "|") != strings.Join(want, "|") {
		t.Errorf("xdo calls = %v, want %v", got, want)
	}
}

func TestGuiScrollBadDirectionIsUsage(t *testing.T) {
	withGuiXdoSeams(t, nil)
	withGuiCLISeams(t)
	seedGuiOn(t)

	err := runGuiScroll(scrollCmdWith(&bytes.Buffer{}, &bytes.Buffer{}, nil), []string{"sideways"})
	if err == nil || err.Error() != `scroll: "sideways" is not a direction (up|down|left|right)` {
		t.Errorf("err = %v, want the direction usage error", err)
	}
	if code := exitCode(err); code != exitUsage {
		t.Errorf("exit code = %d, want %d (usage)", code, exitUsage)
	}
}

// --- type ---

func TestGuiTypeTextRidesStdin(t *testing.T) {
	calls := withGuiXdoSeams(t, nil)
	withGuiCLISeams(t)
	seedGuiOn(t)

	if err := runGuiType(typeCmdWith(&bytes.Buffer{}, &bytes.Buffer{}, nil, nil), []string{"hello"}); err != nil {
		t.Fatal(err)
	}
	if len(*calls) != 1 {
		t.Fatalf("xdo calls = %v, want one type call", xdoArgvStrings(*calls))
	}
	got := (*calls)[0]
	if want := "type --delay 12 --file -"; strings.Join(got.argv, " ") != want {
		t.Errorf("argv = %v, want %s", got.argv, want)
	}
	if got.stdin != "hello" {
		t.Errorf("stdin = %q, want %q (text never rides argv)", got.stdin, "hello")
	}
}

func TestGuiTypeStdinNewlinesBecomeReturn(t *testing.T) {
	calls := withGuiXdoSeams(t, nil)
	withGuiCLISeams(t)
	seedGuiOn(t)

	in := strings.NewReader("a\nb\n")
	err := runGuiType(typeCmdWith(&bytes.Buffer{}, &bytes.Buffer{}, in, map[string]string{"stdin": "true"}), nil)
	if err != nil {
		t.Fatal(err)
	}
	want := []xdoCall{
		{argv: []string{"type", "--delay", "12", "--file", "-"}, stdin: "a"},
		{argv: []string{"key", "--clearmodifiers", "Return"}, stdin: ""},
		{argv: []string{"type", "--delay", "12", "--file", "-"}, stdin: "b"},
		{argv: []string{"key", "--clearmodifiers", "Return"}, stdin: ""},
	}
	if len(*calls) != len(want) {
		t.Fatalf("xdo calls = %+v, want %+v", *calls, want)
	}
	for i, w := range want {
		got := (*calls)[i]
		if strings.Join(got.argv, " ") != strings.Join(w.argv, " ") || got.stdin != w.stdin {
			t.Errorf("call %d = %+v, want %+v", i, got, w)
		}
	}
}

func TestGuiTypeArgAndStdinIsUsage(t *testing.T) {
	withGuiXdoSeams(t, nil)
	withGuiCLISeams(t)
	seedGuiOn(t)

	err := runGuiType(typeCmdWith(&bytes.Buffer{}, &bytes.Buffer{}, nil, map[string]string{"stdin": "true"}), []string{"hi"})
	if err == nil || exitCode(err) != exitUsage {
		t.Errorf("err = %v (code %d), want a usage error", err, exitCode(err))
	}
}

func TestGuiTypeEmptyIsNoOp(t *testing.T) {
	calls := withGuiXdoSeams(t, nil)
	withGuiCLISeams(t)
	seedGuiOn(t)

	if err := runGuiType(typeCmdWith(&bytes.Buffer{}, &bytes.Buffer{}, nil, nil), []string{""}); err != nil {
		t.Fatal(err)
	}
	if len(*calls) != 0 {
		t.Errorf("xdo calls = %v, want none for empty text", xdoArgvStrings(*calls))
	}
}

// --- key ---

func TestGuiKeyPassesChordsVerbatim(t *testing.T) {
	calls := withGuiXdoSeams(t, nil)
	withGuiCLISeams(t)
	seedGuiOn(t)

	if err := runGuiKey(keyCmdWith(&bytes.Buffer{}, &bytes.Buffer{}, nil), []string{"ctrl+l", "Return"}); err != nil {
		t.Fatal(err)
	}
	want := []string{"key --clearmodifiers ctrl+l Return"}
	if got := xdoArgvStrings(*calls); strings.Join(got, "|") != strings.Join(want, "|") {
		t.Errorf("xdo calls = %v, want %v", got, want)
	}
}

// --- the human-input guard covers every input verb ---

func TestGuiInputVerbsRefuseOnRecentHumanInput(t *testing.T) {
	verbs := []struct {
		name string
		cmd  func(flags map[string]string) *cobra.Command
		run  func(*cobra.Command) error
	}{
		{"click", func(f map[string]string) *cobra.Command { return clickCmdWith(&bytes.Buffer{}, &bytes.Buffer{}, f) },
			func(c *cobra.Command) error { return runGuiClick(c, []string{"10", "20"}) }},
		{"move", func(f map[string]string) *cobra.Command { return moveCmdWith(&bytes.Buffer{}, &bytes.Buffer{}, f) },
			func(c *cobra.Command) error { return runGuiMove(c, []string{"5", "6"}) }},
		{"scroll", func(f map[string]string) *cobra.Command { return scrollCmdWith(&bytes.Buffer{}, &bytes.Buffer{}, f) },
			func(c *cobra.Command) error { return runGuiScroll(c, []string{"up"}) }},
		{"type", func(f map[string]string) *cobra.Command { return typeCmdWith(&bytes.Buffer{}, &bytes.Buffer{}, nil, f) },
			func(c *cobra.Command) error { return runGuiType(c, []string{"hi"}) }},
		{"key", func(f map[string]string) *cobra.Command { return keyCmdWith(&bytes.Buffer{}, &bytes.Buffer{}, f) },
			func(c *cobra.Command) error { return runGuiKey(c, []string{"Return"}) }},
	}
	for _, v := range verbs {
		t.Run(v.name+" refuses", func(t *testing.T) {
			calls := withGuiXdoSeams(t, nil)
			withGuiCLISeams(t)
			seedGuiOn(t)
			guiFetchDaemonStatusFn = func(context.Context) (gui.Status, bool) {
				return gui.Status{HumanInputAgoMS: 1000}, true
			}

			err := v.run(v.cmd(nil))
			if err == nil || err.Error() != "human input 1s ago — retry or pass --force" {
				t.Errorf("err = %v, want the human-input refusal", err)
			}
			if code := exitCode(err); code != 1 {
				t.Errorf("exit code = %d, want 1", code)
			}
			if len(*calls) != 0 {
				t.Errorf("xdo calls = %v, want none under the guard", xdoArgvStrings(*calls))
			}
		})
		t.Run(v.name+" --force proceeds", func(t *testing.T) {
			calls := withGuiXdoSeams(t, nil)
			withGuiCLISeams(t)
			seedGuiOn(t)
			guiFetchDaemonStatusFn = func(context.Context) (gui.Status, bool) {
				return gui.Status{HumanInputAgoMS: 1000}, true
			}

			if err := v.run(v.cmd(map[string]string{"force": "true"})); err != nil {
				t.Fatalf("--force: %v", err)
			}
			if len(*calls) == 0 {
				t.Error("--force made no xdotool call, want the verb to act")
			}
		})
	}
}

func TestGuiClickDarwinRefusesBeforeStatusRead(t *testing.T) {
	withGuiXdoSeams(t, nil)
	withGuiCLISeams(t)
	origGOOS := guiGOOS
	guiGOOS = "darwin"
	t.Cleanup(func() { guiGOOS = origGOOS })
	guiDaemonRunningFn = func() bool {
		t.Error("status seams consulted on darwin — the OS refusal must fire first")
		return false
	}

	err := runGuiClick(clickCmdWith(&bytes.Buffer{}, &bytes.Buffer{}, nil), []string{"10", "20"})
	if err == nil || err.Error() != "gui click is not supported on macOS in v1 — the GUI mirrors your live session view-only" {
		t.Errorf("err = %v, want the macOS refusal", err)
	}
	if code := exitCode(err); code != 1 {
		t.Errorf("exit code = %d, want 1", code)
	}
}
