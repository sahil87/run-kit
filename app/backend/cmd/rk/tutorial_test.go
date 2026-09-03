package main

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"testing"

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

// tutorialCall is one recorded seam invocation: the tmux argv and the child
// env it ran with.
type tutorialCall struct {
	args []string
	env  []string
}

// stubTutorialSeams installs recording stubs for the tmux + launcher seams and
// the inside-tmux $TMUX seam. listOutput is what the list-windows probe
// returns. Returns the recorded calls plus pointers capturing the (repoRoot,
// tier) handed to launcher resolution.
func stubTutorialSeams(t *testing.T, listOutput string) (calls *[]tutorialCall, gotRepoRoot *string, gotTier *string) {
	t.Helper()
	recorded := []tutorialCall{}
	calls = &recorded
	repoRoot := ""
	gotRepoRoot = &repoRoot
	tier := ""
	gotTier = &tier

	origTMUX := tutorialOriginalTMUXFn
	tutorialOriginalTMUXFn = func() string { return tutorialTestSocket }
	origRun, origOut := tutorialRunFn, tutorialRunOutputFn
	origResolve := tutorialResolveLauncherFn
	tutorialRunFn = func(_ context.Context, args, env []string) error {
		recorded = append(recorded, tutorialCall{args: args, env: env})
		return nil
	}
	tutorialRunOutputFn = func(_ context.Context, args, env []string) ([]byte, error) {
		recorded = append(recorded, tutorialCall{args: args, env: env})
		return []byte(listOutput), nil
	}
	tutorialResolveLauncherFn = func(_ context.Context, rr, tr string) string {
		repoRoot = rr
		tier = tr
		return riff.DefaultLauncher
	}
	t.Cleanup(func() {
		tutorialOriginalTMUXFn = origTMUX
		tutorialRunFn, tutorialRunOutputFn = origRun, origOut
		tutorialResolveLauncherFn = origResolve
	})
	return calls, gotRepoRoot, gotTier
}

func tutorialTestCmd() (*cobra.Command, *bytes.Buffer) {
	buf := &bytes.Buffer{}
	cmd := &cobra.Command{}
	cmd.SetOut(buf)
	return cmd, buf
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
	calls, _, _ := stubTutorialSeams(t, "")
	origTMUX := tutorialOriginalTMUXFn
	tutorialOriginalTMUXFn = func() string { return "" }
	t.Cleanup(func() { tutorialOriginalTMUXFn = origTMUX })

	cmd, _ := tutorialTestCmd()
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
	if len(*calls) != 0 {
		t.Errorf("tmux calls = %v, want none before the precondition passes", *calls)
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
			calls, _, gotTier := stubTutorialSeams(t, "@3\tother\n")
			cmd, _ := tutorialTestCmd()
			if err := runTutorial(cmd); err != nil {
				t.Fatalf("runTutorial() = %v", err)
			}
			if *gotTier != tc.want {
				t.Errorf("ResolveLauncher tier = %q, want %q", *gotTier, tc.want)
			}
			if len(*calls) != 2 {
				t.Fatalf("tmux calls = %v, want list-windows + new-window", *calls)
			}
		})
	}
}

// The launcher resolution is rooted at the git root of the process cwd (the
// riff CLI's own derivation; empty tolerated outside a repo).
func TestTutorialLauncherRepoRoot(t *testing.T) {
	resetTutorialTier(t)
	_, gotRepoRoot, _ := stubTutorialSeams(t, "@3\tother\n")
	cmd, _ := tutorialTestCmd()
	if err := runTutorial(cmd); err != nil {
		t.Fatalf("runTutorial() = %v", err)
	}
	cwd, err := os.Getwd()
	if err != nil {
		t.Fatalf("Getwd: %v", err)
	}
	// The test binary runs inside this repo, so the derivation is non-empty
	// and rooted at an ancestor of the package dir.
	if *gotRepoRoot == "" || !strings.HasPrefix(cwd, *gotRepoRoot) {
		t.Errorf("ResolveLauncher repoRoot = %q, want a non-empty ancestor of cwd %q", *gotRepoRoot, cwd)
	}
}

// The kickoff prompt is the exact constant text, single-quote-escaped as the
// launcher's positional argument inside riff's three-layer composition.
func TestTutorialKickoffComposition(t *testing.T) {
	got := riff.SkillPaneCommand(riff.DefaultLauncher, tutorialKickoffPrompt)
	want := `${SHELL:-/bin/sh} -i -c 'claude --dangerously-skip-permissions '\''Run rk skill tutorial and follow it exactly'\'''; exec "${SHELL:-/bin/sh}"`
	if got != want {
		t.Errorf("SkillPaneCommand(DefaultLauncher, kickoff) =\n  %q\nwant\n  %q", got, want)
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
	calls, _, _ := stubTutorialSeams(t, "@3\tother\n@7\ttutorial\n")
	cmd, buf := tutorialTestCmd()
	if err := runTutorial(cmd); err != nil {
		t.Fatalf("runTutorial() = %v", err)
	}
	want := []tutorialCall{
		{args: []string{"list-windows", "-F", "#{window_id}\t#{window_name}"}},
		{args: []string{"select-window", "-t", "@7"}},
	}
	if len(*calls) != len(want) {
		t.Fatalf("tmux calls = %v, want %v", *calls, want)
	}
	for i, c := range *calls {
		if strings.Join(c.args, " ") != strings.Join(want[i].args, " ") {
			t.Errorf("call %d argv = %v, want %v", i, c.args, want[i].args)
		}
		if !strings.Contains(strings.Join(c.env, "\n"), "TMUX="+tutorialTestSocket) {
			t.Errorf("call %d env lacks restored TMUX=%s", i, tutorialTestSocket)
		}
	}
	if got := buf.String(); got != "Switched to existing tutorial tab.\n" {
		t.Errorf("stdout = %q, want the switch report", got)
	}
}

// With no tutorial window in the current session (a tutorial window in another
// session is invisible to the probe by construction), a new window opens at
// the process cwd running the composed launcher + kickoff command.
func TestTutorialOpensNewWindow(t *testing.T) {
	resetTutorialTier(t)
	tutorialTierFlag = "fast"
	calls, _, _ := stubTutorialSeams(t, "@3\tother\n")
	cmd, buf := tutorialTestCmd()
	if err := runTutorial(cmd); err != nil {
		t.Fatalf("runTutorial() = %v", err)
	}
	if len(*calls) != 2 {
		t.Fatalf("tmux calls = %v, want list-windows + new-window", *calls)
	}
	cwd, err := os.Getwd()
	if err != nil {
		t.Fatalf("Getwd: %v", err)
	}
	wantArgv := []string{
		"new-window", "-c", cwd, "-n", "tutorial",
		`${SHELL:-/bin/sh} -i -c 'claude --dangerously-skip-permissions '\''Run rk skill tutorial and follow it exactly'\'''; exec "${SHELL:-/bin/sh}"`,
	}
	gotArgv := (*calls)[1].args
	if strings.Join(gotArgv, " ") != strings.Join(wantArgv, " ") {
		t.Errorf("new-window argv =\n  %v\nwant\n  %v", gotArgv, wantArgv)
	}
	if !strings.Contains(strings.Join((*calls)[1].env, "\n"), "TMUX="+tutorialTestSocket) {
		t.Errorf("new-window env lacks restored TMUX=%s", tutorialTestSocket)
	}
	out := buf.String()
	if !strings.Contains(out, "tutorial") || !strings.Contains(out, "fast") {
		t.Errorf("stdout = %q, want a launch report naming the window and tier", out)
	}
}

// A failing list-windows probe is a subprocess-class (exit 3) error.
func TestTutorialListWindowsFailure(t *testing.T) {
	calls, _, _ := stubTutorialSeams(t, "")
	origOut := tutorialRunOutputFn
	tutorialRunOutputFn = func(_ context.Context, _, _ []string) ([]byte, error) {
		return nil, fmt.Errorf("boom")
	}
	t.Cleanup(func() { tutorialRunOutputFn = origOut })

	cmd, _ := tutorialTestCmd()
	err := runTutorial(cmd)
	var ece *riff.ExitCodeError
	if !errors.As(err, &ece) || ece.Code != riff.ExitSubprocess {
		t.Errorf("runTutorial() error = %v, want *riff.ExitCodeError code %d", err, riff.ExitSubprocess)
	}
	if len(*calls) != 0 {
		// The failing call itself went through the replaced seam, not the recorder.
		t.Errorf("recorded calls = %v, want none past the failed probe", *calls)
	}
}
