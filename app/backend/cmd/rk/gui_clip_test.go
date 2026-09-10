package main

import (
	"bytes"
	"context"
	"strings"
	"testing"

	"rk/internal/gui"

	"github.com/spf13/cobra"
)

// clipCall is one captured clipboard tool invocation (text is the set stdin).
type clipCall struct {
	argv []string
	text string
}

// withGuiClipSeams captures the clipboard get/set invocations; getText is
// what the read seam returns. Restores via t.Cleanup.
func withGuiClipSeams(t *testing.T) (getText *string, calls *[]clipCall) {
	t.Helper()
	getText, calls = new(string), new([]clipCall)

	origGet, origSet := guiClipGetFn, guiClipSetFn
	t.Cleanup(func() { guiClipGetFn, guiClipSetFn = origGet, origSet })

	guiClipGetFn = func(_ context.Context, _ string, argv []string) (string, error) {
		*calls = append(*calls, clipCall{argv: argv})
		return *getText, nil
	}
	guiClipSetFn = func(_ context.Context, _ string, argv []string, text string) error {
		*calls = append(*calls, clipCall{argv: argv, text: text})
		return nil
	}
	return getText, calls
}

// clipCmdWith builds a bare command carrying the clip verb's --stdin flag.
func clipCmdWith(out, errOut *bytes.Buffer, in *strings.Reader, flags map[string]string) *cobra.Command {
	var cmd *cobra.Command
	if in != nil {
		cmd = bareCmdIn(out, errOut, in)
	} else {
		cmd = bareCmd(out, errOut)
	}
	cmd.Flags().Bool("stdin", false, "")
	setFlags(cmd, flags)
	return cmd
}

func TestGuiClipArgvLadder(t *testing.T) {
	cases := []struct {
		tool string
		out  bool
		want string
	}{
		{"xclip", true, "xclip -selection clipboard -o"},
		{"xclip", false, "xclip -selection clipboard -i"},
		{"xsel", true, "xsel --clipboard --output"},
		{"xsel", false, "xsel --clipboard --input"},
	}
	for _, tc := range cases {
		if got := strings.Join(guiClipArgv(tc.tool, tc.out), " "); got != tc.want {
			t.Errorf("guiClipArgv(%s, out=%v) = %q, want %q", tc.tool, tc.out, got, tc.want)
		}
	}
}

func TestGuiClipGetPrintsVerbatim(t *testing.T) {
	getText, calls := withGuiClipSeams(t)
	withGuiCLISeams(t)
	seedGuiOn(t)
	guiLookPathFn = lookPathOnly("xclip")
	*getText = "clip text\nwith newline"

	var out bytes.Buffer
	if err := runGuiClip(clipCmdWith(&out, &bytes.Buffer{}, nil, nil), []string{"get"}); err != nil {
		t.Fatal(err)
	}
	// The datum is the clipboard verbatim — no trailing newline added.
	if got, want := out.String(), "clip text\nwith newline"; got != want {
		t.Errorf("stdout = %q, want %q", got, want)
	}
	if got := (*calls)[0].argv; strings.Join(got, " ") != "xclip -selection clipboard -o" {
		t.Errorf("get argv = %v, want xclip -selection clipboard -o", got)
	}
}

func TestGuiClipGetFallsBackToXsel(t *testing.T) {
	_, calls := withGuiClipSeams(t)
	withGuiCLISeams(t)
	seedGuiOn(t)
	guiLookPathFn = lookPathOnly("xsel")

	if err := runGuiClip(clipCmdWith(&bytes.Buffer{}, &bytes.Buffer{}, nil, nil), []string{"get"}); err != nil {
		t.Fatal(err)
	}
	if got := (*calls)[0].argv; strings.Join(got, " ") != "xsel --clipboard --output" {
		t.Errorf("get argv = %v, want the xsel form", got)
	}
}

func TestGuiClipSetArg(t *testing.T) {
	_, calls := withGuiClipSeams(t)
	withGuiCLISeams(t)
	seedGuiOn(t)
	guiLookPathFn = lookPathOnly("xclip")

	var out bytes.Buffer
	if err := runGuiClip(clipCmdWith(&out, &bytes.Buffer{}, nil, nil), []string{"set", "foo"}); err != nil {
		t.Fatal(err)
	}
	if got := out.String(); got != "" {
		t.Errorf("stdout = %q, want empty (set prints nothing)", got)
	}
	call := (*calls)[0]
	if got := strings.Join(call.argv, " "); got != "xclip -selection clipboard -i" {
		t.Errorf("set argv = %q, want xclip -selection clipboard -i", got)
	}
	if call.text != "foo" {
		t.Errorf("set stdin = %q, want %q", call.text, "foo")
	}
}

func TestGuiClipSetStdin(t *testing.T) {
	_, calls := withGuiClipSeams(t)
	withGuiCLISeams(t)
	seedGuiOn(t)
	guiLookPathFn = lookPathOnly("xsel")

	err := runGuiClip(clipCmdWith(&bytes.Buffer{}, &bytes.Buffer{}, strings.NewReader("line1\nline2\n"), map[string]string{"stdin": "true"}), []string{"set"})
	if err != nil {
		t.Fatal(err)
	}
	call := (*calls)[0]
	if got := strings.Join(call.argv, " "); got != "xsel --clipboard --input" {
		t.Errorf("set argv = %q, want the xsel form", got)
	}
	if call.text != "line1\nline2\n" {
		t.Errorf("set stdin = %q, want the stdin text verbatim", call.text)
	}
}

func TestGuiClipUsageErrors(t *testing.T) {
	cases := []struct {
		name  string
		args  []string
		flags map[string]string
	}{
		{"no subcommand", nil, nil},
		{"bad subcommand", []string{"flip"}, nil},
		{"set arg and stdin", []string{"set", "foo"}, map[string]string{"stdin": "true"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, calls := withGuiClipSeams(t)
			withGuiCLISeams(t)
			seedGuiOn(t)

			err := runGuiClip(clipCmdWith(&bytes.Buffer{}, &bytes.Buffer{}, nil, tc.flags), tc.args)
			if err == nil || exitCode(err) != exitUsage {
				t.Errorf("err = %v (code %d), want a usage error (exit 2)", err, exitCode(err))
			}
			if len(*calls) != 0 {
				t.Errorf("clipboard tool called %d times on a usage error", len(*calls))
			}
		})
	}
}

func TestGuiClipNoToolHint(t *testing.T) {
	withGuiClipSeams(t)
	withGuiCLISeams(t)
	seedGuiOn(t)
	guiLookPathFn = lookPathOnly()

	err := runGuiClip(clipCmdWith(&bytes.Buffer{}, &bytes.Buffer{}, nil, nil), []string{"get"})
	if err == nil || err.Error() != "no clipboard tool found (tried xclip, xsel) — sudo apt install xclip" {
		t.Errorf("err = %v, want the clipboard install hint", err)
	}
	if code := exitCode(err); code != 1 {
		t.Errorf("exit code = %d, want 1", code)
	}
}

// clip is not an input verb: a recent human input must NOT block it.
func TestGuiClipNotGuarded(t *testing.T) {
	getText, _ := withGuiClipSeams(t)
	withGuiCLISeams(t)
	seedGuiOn(t)
	guiLookPathFn = lookPathOnly("xclip")
	*getText = "data"
	guiFetchDaemonStatusFn = func(context.Context) (gui.Status, bool) {
		return gui.Status{HumanInputAgoMS: 100}, true
	}

	var out bytes.Buffer
	if err := runGuiClip(clipCmdWith(&out, &bytes.Buffer{}, nil, nil), []string{"get"}); err != nil {
		t.Fatalf("clip get refused under recent human input: %v", err)
	}
	if got := out.String(); got != "data" {
		t.Errorf("stdout = %q, want %q", got, "data")
	}
}
