package main

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"rk/internal/riff"

	"github.com/spf13/cobra"
)

// NOTE (tmux safety): these tests never start, attach to, or kill any tmux
// server. Every tmux invocation routes through the
// tutorialRunFn/tutorialRunOutputFn seams, which the tests stub; the $TMUX
// seam (tutorialOriginalTMUXFn) is stubbed likewise because the real
// tmux.OriginalTMUX is fixed at package-init time. The suite must also pass
// under `env -u TMUX -u TMUX_PANE go test ./cmd/rk/` (ambient-env false-green
// guard) — no test may read the ambient tmux env.

// tutorialTestSocket is the fake $TMUX the seam serves so every test runs the
// inside-tmux path deterministically.
const tutorialTestSocket = "/tmp/rk-test.sock,1234,0"

// tutorialTestPane is the pane id the stubbed new-window prints; the delivery
// sends/captures must target it.
const tutorialTestPane = "%42"

// kickoffEchoScreen is a capture frame carrying the kickoff wrapped in a
// bordered input box the way an agent TUI renders it — the echo check must see
// through the wrapping.
const kickoffEchoScreen = "╭──────────────╮\n│ > Run rk skill tutorial and   │\n│   follow it exactly           │\n╰──────────────╯\n"

// tutorialCall is one recorded seam invocation: the tmux argv and the child
// env it ran with.
type tutorialCall struct {
	args []string
	env  []string
}

// tutorialStub owns the stubbed seam state for one test: recorded calls, the
// list-windows probe output, and the scripted capture-pane frames (consumed in
// order; the last frame repeats once the script is exhausted).
type tutorialStub struct {
	calls      []tutorialCall
	listOutput string
	captures   []string
	captureIdx int
	repoRoot   string
	tier       string
}

func (s *tutorialStub) nextCapture() string {
	if len(s.captures) == 0 {
		return ""
	}
	if s.captureIdx >= len(s.captures) {
		return s.captures[len(s.captures)-1]
	}
	out := s.captures[s.captureIdx]
	s.captureIdx++
	return out
}

// stubTutorialSeams installs recording stubs for the tmux + launcher seams,
// the inside-tmux $TMUX seam, and zeroed delivery pacing (no real sleeps; a
// short real-clock deadline bounds the degrade paths). captures scripts the
// capture-pane frames.
func stubTutorialSeams(t *testing.T, listOutput string, captures []string) *tutorialStub {
	t.Helper()
	s := &tutorialStub{listOutput: listOutput, captures: captures}

	origTMUX := tutorialOriginalTMUXFn
	tutorialOriginalTMUXFn = func() string { return tutorialTestSocket }
	origRun, origOut := tutorialRunFn, tutorialRunOutputFn
	origResolve := tutorialResolveLauncherFn
	origDeadline, origInterval, origSettle := tutorialDeliverDeadline, tutorialPollInterval, tutorialSubmitSettle
	origSleep := tutorialSleepFn
	tutorialDeliverDeadline = 2 * time.Second
	tutorialPollInterval = 0
	tutorialSubmitSettle = 0
	tutorialSleepFn = func(time.Duration) {}
	tutorialRunFn = func(_ context.Context, args, env []string) error {
		s.calls = append(s.calls, tutorialCall{args: args, env: env})
		return nil
	}
	tutorialRunOutputFn = func(_ context.Context, args, env []string) ([]byte, error) {
		s.calls = append(s.calls, tutorialCall{args: args, env: env})
		switch args[0] {
		case "list-windows":
			return []byte(s.listOutput), nil
		case "new-window":
			return []byte(tutorialTestPane + "\n"), nil
		case "capture-pane":
			return []byte(s.nextCapture()), nil
		}
		return nil, fmt.Errorf("unexpected RunOutput verb %q", args[0])
	}
	tutorialResolveLauncherFn = func(_ context.Context, rr, tr string) string {
		s.repoRoot = rr
		s.tier = tr
		return riff.DefaultLauncher
	}
	t.Cleanup(func() {
		tutorialOriginalTMUXFn = origTMUX
		tutorialRunFn, tutorialRunOutputFn = origRun, origOut
		tutorialResolveLauncherFn = origResolve
		tutorialDeliverDeadline, tutorialPollInterval, tutorialSubmitSettle = origDeadline, origInterval, origSettle
		tutorialSleepFn = origSleep
	})
	return s
}

// happyCaptures is a capture script that walks the whole delivery: one boot
// frame, the same frame again (settle), the kickoff echo, then a changed
// screen (submitted).
func happyCaptures() []string {
	return []string{"boot screen", "boot screen", kickoffEchoScreen, "transcript: working…"}
}

// sendCalls filters the recorded calls down to the send-keys argvs (joined).
func sendCalls(s *tutorialStub) []string {
	var out []string
	for _, c := range s.calls {
		if c.args[0] == "send-keys" {
			out = append(out, strings.Join(c.args, " "))
		}
	}
	return out
}

func tutorialTestCmd() (*cobra.Command, *bytes.Buffer, *bytes.Buffer) {
	outBuf, errBuf := &bytes.Buffer{}, &bytes.Buffer{}
	cmd := &cobra.Command{}
	cmd.SetOut(outBuf)
	cmd.SetErr(errBuf)
	return cmd, outBuf, errBuf
}

// resetTutorialTier restores the --tier package var to its default after a
// test mutates it.
func resetTutorialTier(t *testing.T) {
	t.Helper()
	orig := tutorialTierFlag
	t.Cleanup(func() { tutorialTierFlag = orig })
}

// Outside tmux the command fails as an operational error (exit 1) with
// dashboard-pointing guidance and runs zero tmux subprocesses.
func TestTutorialOutsideTmuxErrors(t *testing.T) {
	s := stubTutorialSeams(t, "", nil)
	origTMUX := tutorialOriginalTMUXFn
	tutorialOriginalTMUXFn = func() string { return "" }
	t.Cleanup(func() { tutorialOriginalTMUXFn = origTMUX })

	cmd, _, _ := tutorialTestCmd()
	err := runTutorial(cmd)
	if err == nil {
		t.Fatal("runTutorial() = nil, want a precondition error")
	}
	var ece *riff.ExitCodeError
	if !errors.As(err, &ece) {
		t.Fatalf("runTutorial() error = %T %v, want *riff.ExitCodeError", err, err)
	}
	if ece.Code != riff.ExitPrecondition {
		t.Errorf("exit code = %d, want %d (operational/precondition)", ece.Code, riff.ExitPrecondition)
	}
	if !strings.Contains(ece.Msg, "dashboard") || !strings.Contains(ece.Msg, "$TMUX") {
		t.Errorf("message = %q, want dashboard guidance naming $TMUX", ece.Msg)
	}
	if len(s.calls) != 0 {
		t.Errorf("tmux calls = %v, want none before the precondition passes", s.calls)
	}
}

// The --tier flag's declared default is "fast".
func TestTutorialTierFlagDefault(t *testing.T) {
	f := tutorialCmd.Flags().Lookup("tier")
	if f == nil {
		t.Fatal("tutorialCmd has no --tier flag")
	}
	if f.DefValue != "fast" {
		t.Errorf("--tier default = %q, want %q", f.DefValue, "fast")
	}
}

// The --tier value reaches launcher resolution verbatim — default "fast" when
// the flag is omitted, the override when set.
func TestTutorialTierPlumbing(t *testing.T) {
	resetTutorialTier(t)
	for _, tc := range []struct{ name, flagValue, want string }{
		{"default fast", "fast", "fast"},
		{"override", "review", "review"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			tutorialTierFlag = tc.flagValue
			s := stubTutorialSeams(t, "@3\tother\n", happyCaptures())
			cmd, _, _ := tutorialTestCmd()
			if err := runTutorial(cmd); err != nil {
				t.Fatalf("runTutorial() = %v", err)
			}
			if s.tier != tc.want {
				t.Errorf("ResolveLauncher tier = %q, want %q", s.tier, tc.want)
			}
		})
	}
}

// The launcher resolution is rooted at the git root of the process cwd (the
// riff CLI's own derivation; empty tolerated outside a repo).
func TestTutorialLauncherRepoRoot(t *testing.T) {
	resetTutorialTier(t)
	s := stubTutorialSeams(t, "@3\tother\n", happyCaptures())
	cmd, _, _ := tutorialTestCmd()
	if err := runTutorial(cmd); err != nil {
		t.Fatalf("runTutorial() = %v", err)
	}
	cwd, err := os.Getwd()
	if err != nil {
		t.Fatalf("Getwd: %v", err)
	}
	// The test binary runs inside this repo, so the derivation is non-empty
	// and rooted at an ancestor of the package dir.
	if s.repoRoot == "" || !strings.HasPrefix(cwd, s.repoRoot) {
		t.Errorf("ResolveLauncher repoRoot = %q, want a non-empty ancestor of cwd %q", s.repoRoot, cwd)
	}
}

// The window runs the BARE launcher — the kickoff is typed after boot, never a
// positional argument (only claude's CLI accepts one; the launcher is
// provider-opaque).
func TestTutorialBareLauncherComposition(t *testing.T) {
	got := riff.SkillPaneCommand(riff.DefaultLauncher, "")
	want := `${SHELL:-/bin/sh} -i -c 'claude --dangerously-skip-permissions'; exec "${SHELL:-/bin/sh}"`
	if got != want {
		t.Errorf("SkillPaneCommand(DefaultLauncher, \"\") =\n  %q\nwant\n  %q", got, want)
	}
	if strings.Contains(got, "tutorial") {
		t.Errorf("bare composition %q must not embed the kickoff prompt", got)
	}
}

// The echo check sees the kickoff through TUI wrapping (borders, line breaks)
// and rejects screens without it.
func TestPaneEchoesKickoff(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want bool
	}{
		{"wrapped in input box", kickoffEchoScreen, true},
		{"verbatim", tutorialKickoffPrompt, true},
		{"absent", "│ > │\nwelcome to the agent\n", false},
		{"partial only", "Run rk skill tutorial", false},
		{"empty", "", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := paneEchoesKickoff(tc.in); got != tc.want {
				t.Errorf("paneEchoesKickoff(%q) = %v, want %v", tc.in, got, tc.want)
			}
		})
	}
}

// The singleton matcher exact-matches the name as everything after the first
// tab (the last field of the list-windows format) — no prefix/substring hits,
// tab-containing names never match.
func TestFindTutorialWindowID(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
	}{
		{"exact match", "@7\ttutorial", "@7"},
		{"first match wins", "@7\ttutorial\n@9\ttutorial", "@7"},
		{"no match", "@3\tother\n@4\tshell", ""},
		{"no prefix match", "@3\ttutorial-2", ""},
		{"no substring match", "@3\tmy tutorial", ""},
		{"tab-containing name never exact-matches", "@5\tfoo\ttutorial", ""},
		{"empty output", "", ""},
		{"line without tab skipped", "garbage\n@2\ttutorial", "@2"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := findTutorialWindowID(tc.in); got != tc.want {
				t.Errorf("findTutorialWindowID(%q) = %q, want %q", tc.in, got, tc.want)
			}
		})
	}
}

// An existing exact-name tutorial window in the current session is selected by
// its @N id — no new window is created, and the switch is reported.
func TestTutorialSelectsExistingWindow(t *testing.T) {
	resetTutorialTier(t)
	s := stubTutorialSeams(t, "@3\tother\n@7\ttutorial\n", nil)
	cmd, outBuf, _ := tutorialTestCmd()
	if err := runTutorial(cmd); err != nil {
		t.Fatalf("runTutorial() = %v", err)
	}
	want := []tutorialCall{
		{args: []string{"list-windows", "-F", "#{window_id}\t#{window_name}"}},
		{args: []string{"select-window", "-t", "@7"}},
	}
	if len(s.calls) != len(want) {
		t.Fatalf("tmux calls = %v, want %v", s.calls, want)
	}
	for i, c := range s.calls {
		if strings.Join(c.args, " ") != strings.Join(want[i].args, " ") {
			t.Errorf("call %d argv = %v, want %v", i, c.args, want[i].args)
		}
		if !strings.Contains(strings.Join(c.env, "\n"), "TMUX="+tutorialTestSocket) {
			t.Errorf("call %d env lacks restored TMUX=%s", i, tutorialTestSocket)
		}
	}
	if got := outBuf.String(); got != "Switched to existing tutorial tab.\n" {
		t.Errorf("stdout = %q, want the switch report", got)
	}
}

// With no tutorial window in the current session, a new window opens at the
// process cwd running the BARE launcher, the pane id is captured, and the
// typed delivery lands: literal kickoff, echo verified, Enter submitted. No
// degrade note is printed on the happy path.
func TestTutorialOpensNewWindowAndDeliversKickoff(t *testing.T) {
	resetTutorialTier(t)
	tutorialTierFlag = "fast"
	s := stubTutorialSeams(t, "@3\tother\n", happyCaptures())
	cmd, outBuf, errBuf := tutorialTestCmd()
	if err := runTutorial(cmd); err != nil {
		t.Fatalf("runTutorial() = %v", err)
	}
	cwd, err := os.Getwd()
	if err != nil {
		t.Fatalf("Getwd: %v", err)
	}

	var newWindow []string
	for _, c := range s.calls {
		if c.args[0] == "new-window" {
			newWindow = c.args
		}
		if !strings.Contains(strings.Join(c.env, "\n"), "TMUX="+tutorialTestSocket) {
			t.Errorf("call %v env lacks restored TMUX=%s", c.args, tutorialTestSocket)
		}
	}
	wantNewWindow := []string{
		"new-window", "-P", "-F", "#{pane_id}", "-c", cwd, "-n", "tutorial",
		`${SHELL:-/bin/sh} -i -c 'claude --dangerously-skip-permissions'; exec "${SHELL:-/bin/sh}"`,
	}
	if strings.Join(newWindow, " ") != strings.Join(wantNewWindow, " ") {
		t.Errorf("new-window argv =\n  %v\nwant\n  %v", newWindow, wantNewWindow)
	}

	wantSends := []string{
		"send-keys -t " + tutorialTestPane + " -l " + tutorialKickoffPrompt,
		"send-keys -t " + tutorialTestPane + " Enter",
	}
	if got := sendCalls(s); strings.Join(got, "\n") != strings.Join(wantSends, "\n") {
		t.Errorf("send-keys calls =\n  %v\nwant\n  %v", got, wantSends)
	}

	out := outBuf.String()
	if !strings.Contains(out, "tutorial") || !strings.Contains(out, "fast") {
		t.Errorf("stdout = %q, want a launch report naming the window and tier", out)
	}
	if errBuf.Len() != 0 {
		t.Errorf("stderr = %q, want empty on a verified delivery", errBuf.String())
	}
}

// A swallowed Enter (pane byte-identical after the settle wait) is retried
// exactly once; the retry's changed screen completes the delivery.
func TestTutorialEnterRetryOnUnchangedPane(t *testing.T) {
	resetTutorialTier(t)
	s := stubTutorialSeams(t, "@3\tother\n", []string{
		"boot screen", "boot screen", // settle
		kickoffEchoScreen,      // echo verified
		kickoffEchoScreen,      // after Enter 1: unchanged — swallowed
		"transcript: working…", // after Enter 2: submitted
	})
	cmd, _, errBuf := tutorialTestCmd()
	if err := runTutorial(cmd); err != nil {
		t.Fatalf("runTutorial() = %v", err)
	}
	got := sendCalls(s)
	wantSends := []string{
		"send-keys -t " + tutorialTestPane + " -l " + tutorialKickoffPrompt,
		"send-keys -t " + tutorialTestPane + " Enter",
		"send-keys -t " + tutorialTestPane + " Enter",
	}
	if strings.Join(got, "\n") != strings.Join(wantSends, "\n") {
		t.Errorf("send-keys calls =\n  %v\nwant type + Enter + one retry:\n  %v", got, wantSends)
	}
	if errBuf.Len() != 0 {
		t.Errorf("stderr = %q, want empty when the retry lands", errBuf.String())
	}
}

// When the delivery cannot be verified (here: the echo never appears), the
// command still succeeds — the window exists — and stderr carries the
// paste-it-yourself note with the exact kickoff text.
func TestTutorialDeliveryDegradesToPasteNote(t *testing.T) {
	resetTutorialTier(t)
	origDeadline := tutorialDeliverDeadline
	s := stubTutorialSeams(t, "@3\tother\n", []string{"boot screen", "boot screen", "still no echo"})
	// Shrink the real-clock budget further: the echo poll busy-loops (zeroed
	// sleeps) until the deadline passes.
	tutorialDeliverDeadline = 50 * time.Millisecond
	t.Cleanup(func() { tutorialDeliverDeadline = origDeadline })

	cmd, outBuf, errBuf := tutorialTestCmd()
	if err := runTutorial(cmd); err != nil {
		t.Fatalf("runTutorial() = %v, want nil (delivery miss degrades, never errors)", err)
	}
	if !strings.Contains(outBuf.String(), "Opened tutorial tab") {
		t.Errorf("stdout = %q, want the launch report", outBuf.String())
	}
	if !strings.Contains(errBuf.String(), tutorialKickoffPrompt) {
		t.Errorf("stderr = %q, want the paste-it-yourself note carrying the kickoff text", errBuf.String())
	}
	// The type happened; Enter never did (echo was never verified).
	got := sendCalls(s)
	if len(got) != 1 || !strings.HasSuffix(got[0], tutorialKickoffPrompt) {
		t.Errorf("send-keys calls = %v, want only the literal type", got)
	}
}

// A failing list-windows probe is a subprocess-class (exit 3) error.
func TestTutorialListWindowsFailure(t *testing.T) {
	s := stubTutorialSeams(t, "", nil)
	origOut := tutorialRunOutputFn
	tutorialRunOutputFn = func(_ context.Context, _, _ []string) ([]byte, error) {
		return nil, fmt.Errorf("boom")
	}
	t.Cleanup(func() { tutorialRunOutputFn = origOut })

	cmd, _, _ := tutorialTestCmd()
	err := runTutorial(cmd)
	var ece *riff.ExitCodeError
	if !errors.As(err, &ece) || ece.Code != riff.ExitSubprocess {
		t.Errorf("runTutorial() error = %v, want *riff.ExitCodeError code %d", err, riff.ExitSubprocess)
	}
	if len(s.calls) != 0 {
		// The failing call itself went through the replaced seam, not the recorder.
		t.Errorf("recorded calls = %v, want none past the failed probe", s.calls)
	}
}
