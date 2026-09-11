package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/spf13/cobra"
	"github.com/spf13/pflag"

	"rk/internal/fabconfig"
	"rk/internal/riff"
	"rk/internal/testutil"
)

// These tests cover the CLI FRONTEND surface that stays in cmd/rk after the
// spawn engine was extracted to internal/riff (260713-sbk1): the repeatable
// pane-flag argv grammar (rewrite + paneFlag parsing), the --count flag, the
// post-rename --fan-out rejection, and --list-presets rendering. The engine's
// pure helpers (layout/spec/shell/launcher) are tested in internal/riff.

// chdir changes into dir and returns a restore function. Used by TestPrintPresets
// to run the ordered-read fallback path in a directory with no fab config.
func chdir(t *testing.T, dir string) func() {
	t.Helper()
	orig, err := os.Getwd()
	if err != nil {
		t.Fatalf("Getwd: %v", err)
	}
	resolved, err := filepath.EvalSymlinks(dir)
	if err != nil {
		t.Fatalf("EvalSymlinks(%q): %v", dir, err)
	}
	if err := os.Chdir(resolved); err != nil {
		t.Fatalf("Chdir(%q): %v", resolved, err)
	}
	return func() {
		if err := os.Chdir(orig); err != nil {
			t.Fatalf("Chdir(restore): %v", err)
		}
	}
}

// TestRewritePaneSpaceForm covers the argv pre-processor that translates
// `--skill VAL` / `--cmd VAL` into equals-form before cobra parses.
func TestRewritePaneSpaceForm(t *testing.T) {
	cases := []struct {
		name string
		in   []string
		want []string
	}{
		{
			name: "bare --cmd at end",
			in:   []string{"--cmd"},
			want: []string{"--cmd"},
		},
		{
			name: "space-form --cmd htop",
			in:   []string{"--cmd", "htop"},
			want: []string{"--cmd=htop"},
		},
		{
			name: "bare --cmd followed by another flag",
			in:   []string{"--cmd", "--skill", "/foo"},
			want: []string{"--cmd", "--skill=/foo"},
		},
		{
			name: "equals form preserved",
			in:   []string{"--cmd=htop"},
			want: []string{"--cmd=htop"},
		},
		{
			name: "interleaved",
			in:   []string{"--cmd", "--skill", "/fab-discuss", "--cmd", "htop", "--skill"},
			want: []string{"--cmd", "--skill=/fab-discuss", "--cmd=htop", "--skill"},
		},
		{
			name: "after -- separator tokens preserved verbatim",
			in:   []string{"--skill", "/foo", "--", "--cmd", "something"},
			want: []string{"--skill=/foo", "--", "--cmd", "something"},
		},
		{
			name: "unrelated flags untouched",
			in:   []string{"--layout", "tiled", "--count", "3"},
			want: []string{"--layout", "tiled", "--count", "3"},
		},
		{
			name: "next token is bare --",
			in:   []string{"--skill", "--", "foo"},
			want: []string{"--skill", "--", "foo"},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := rewritePaneSpaceForm(tc.in)
			if !reflect.DeepEqual(got, tc.want) {
				t.Errorf("rewritePaneSpaceForm(%v) = %v, want %v", tc.in, got, tc.want)
			}
		})
	}
}

// TestPaneFlagParsing exercises the full argv-rewrite + pflag.Parse round trip
// to assert that interleaved --skill/--cmd occurrences produce the correct
// ordered riff.PaneSpec slice.
func TestPaneFlagParsing(t *testing.T) {
	cases := []struct {
		name string
		argv []string
		want []riff.PaneSpec
	}{
		{
			name: "single bare skill",
			argv: []string{"--skill"},
			want: []riff.PaneSpec{{Kind: riff.PaneKindSkill, Value: ""}},
		},
		{
			name: "single skill with value",
			argv: []string{"--skill", "/fab-discuss"},
			want: []riff.PaneSpec{{Kind: riff.PaneKindSkill, Value: "/fab-discuss"}},
		},
		{
			name: "single cmd with equals",
			argv: []string{"--cmd=htop"},
			want: []riff.PaneSpec{{Kind: riff.PaneKindCmd, Value: "htop"}},
		},
		{
			name: "bare cmd followed by flag",
			argv: []string{"--cmd", "--skill", "/foo"},
			want: []riff.PaneSpec{
				{Kind: riff.PaneKindCmd, Value: ""},
				{Kind: riff.PaneKindSkill, Value: "/foo"},
			},
		},
		{
			name: "interleaved four-pane",
			argv: []string{"--cmd", "--skill", "/fab-discuss", "--cmd", "htop", "--skill"},
			want: []riff.PaneSpec{
				{Kind: riff.PaneKindCmd, Value: ""},
				{Kind: riff.PaneKindSkill, Value: "/fab-discuss"},
				{Kind: riff.PaneKindCmd, Value: "htop"},
				{Kind: riff.PaneKindSkill, Value: ""},
			},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := []riff.PaneSpec{}
			skill := &paneFlag{kind: riff.PaneKindSkill, target: &got}
			cmd := &paneFlag{kind: riff.PaneKindCmd, target: &got}
			fs := freshPaneFlagSet(skill, cmd)
			rewritten := rewritePaneSpaceForm(tc.argv)
			if err := fs.Parse(rewritten); err != nil {
				t.Fatalf("Parse(%v): %v", rewritten, err)
			}
			if !reflect.DeepEqual(got, tc.want) {
				t.Errorf("panes = %#v, want %#v", got, tc.want)
			}
		})
	}
}

// freshPaneFlagSet sets up a standalone FlagSet with the two pane flags
// registered, so tests don't touch the package-level riffCmd state.
func freshPaneFlagSet(skill, cmd *paneFlag) *pflag.FlagSet {
	fs := pflag.NewFlagSet("test", pflag.ContinueOnError)
	fs.SetInterspersed(false)
	fs.Var(skill, "skill", "")
	fs.Lookup("skill").NoOptDefVal = paneBareSentinel
	fs.Var(cmd, "cmd", "")
	fs.Lookup("cmd").NoOptDefVal = paneBareSentinel
	return fs
}

// TestPrintPresets covers the empty-map and multi-preset rendering (CLI-side).
func TestPrintPresets(t *testing.T) {
	t.Run("empty map prints no-presets line", func(t *testing.T) {
		var buf bytes.Buffer
		if err := printPresets(map[string]fabconfig.Preset{}, &buf, ""); err != nil {
			t.Fatalf("err: %v", err)
		}
		if !strings.Contains(buf.String(), "No presets defined in fab/project/config.yaml") {
			t.Errorf("output missing no-presets line: %q", buf.String())
		}
	})

	t.Run("two presets render all fields", func(t *testing.T) {
		// Change into a tempdir with no fab/project/config.yaml so the
		// ordered-read fallback path kicks in (alphabetical order).
		restore := chdir(t, t.TempDir())
		defer restore()

		presets := map[string]fabconfig.Preset{
			"ship": {
				Layout: "deck-h",
				Panes: []fabconfig.PaneSpec{
					{Kind: fabconfig.PaneKindSkill, Skill: "/fab-fff"},
					{Kind: fabconfig.PaneKindCmd, Cmd: "just dev"},
				},
				WtArgs: []string{"--base", "main"},
			},
			"bare": {
				Layout: "",
				Panes:  nil,
			},
		}
		var buf bytes.Buffer
		if err := printPresets(presets, &buf, ""); err != nil {
			t.Fatalf("err: %v", err)
		}
		out := buf.String()
		for _, want := range []string{"ship:", "bare:", "/fab-fff", "just dev", "--base", "main", "layout: deck-h"} {
			if !strings.Contains(out, want) {
				t.Errorf("output missing %q; got: %s", want, out)
			}
		}
		bareIdx := strings.Index(out, "bare:")
		shipIdx := strings.Index(out, "ship:")
		if bareIdx < 0 || shipIdx < 0 || bareIdx > shipIdx {
			t.Errorf("alphabetical order failed: bare=%d ship=%d", bareIdx, shipIdx)
		}
	})
}

// TestRiffCountShortForm verifies pflag's `-N` short-form parses into the same
// integer value that `--count` populates.
func TestRiffCountShortForm(t *testing.T) {
	cases := []struct {
		name string
		argv []string
		want int
	}{
		{name: "short form -N 3", argv: []string{"-N", "3"}, want: 3},
		{name: "long form --count 3", argv: []string{"--count", "3"}, want: 3},
		{name: "equals form --count=3", argv: []string{"--count=3"}, want: 3},
		{name: "default when omitted", argv: nil, want: 1},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var got int
			fs := pflag.NewFlagSet("test", pflag.ContinueOnError)
			fs.IntVarP(&got, "count", "N", 1, "Spawn N worktree/window pairs in parallel (N >= 1)")
			if err := fs.Parse(tc.argv); err != nil {
				t.Fatalf("Parse(%v): %v", tc.argv, err)
			}
			if got != tc.want {
				t.Errorf("count = %d, want %d", got, tc.want)
			}
		})
	}
}

// TestRiffFanOutFlagRejected asserts the post-rename hard-rename contract:
// `--fan-out` is no longer a registered flag.
func TestRiffFanOutFlagRejected(t *testing.T) {
	var count int
	fs := pflag.NewFlagSet("test", pflag.ContinueOnError)
	fs.SetOutput(io.Discard)
	fs.IntVarP(&count, "count", "N", 1, "Spawn N worktree/window pairs in parallel (N >= 1)")
	err := fs.Parse([]string{"--fan-out", "2"})
	if err == nil {
		t.Fatalf("expected parse error for --fan-out, got nil")
	}
	if !strings.Contains(err.Error(), "fan-out") {
		t.Errorf("error message should reference 'fan-out': %v", err)
	}
}

// riffTargetFixture wires the stub-binaries harness for the -L/--repo/--json
// path: wt/tmux/git/fab stubs on PATH (tmux logs its argv), a temp repo with a
// .git dir, and the riff flag vars reset on cleanup.
func riffTargetFixture(t *testing.T) (repoRoot, tmuxLog, wtLog string) {
	t.Helper()
	dir := t.TempDir()
	repoRoot = filepath.Join(t.TempDir(), "repo")
	if err := os.MkdirAll(filepath.Join(repoRoot, ".git"), 0o755); err != nil {
		t.Fatalf("mkdir .git: %v", err)
	}
	worktree := filepath.Join(t.TempDir(), "swift-fox")
	if err := os.MkdirAll(worktree, 0o755); err != nil {
		t.Fatalf("mkdir worktree: %v", err)
	}
	tmuxLog = filepath.Join(dir, "tmux.log")
	wtLog = filepath.Join(dir, "wt.log")
	testutil.WriteStub(t, dir, "wt", "#!/bin/sh\nprintf '%s\n' \"$PWD\" >> "+wtLog+"\nprintf 'Path: %s\\n' '"+worktree+"'\n")
	testutil.WriteStub(t, dir, "tmux", "#!/bin/sh\nprintf '%s\n' \"$*\" >> "+tmuxLog+"\n"+
		"last=\"${!#}\"\n"+
		"case \" $* \" in\n"+
		"  *\" list-windows \"*) exit 0 ;;\n"+
		"esac\n"+
		"case \"$1\" in\n"+
		"  -L) shift 2 ;;\n"+
		"esac\n"+
		"case \"$1\" in\n"+
		"  list-windows) exit 0 ;;\n"+
		"  new-window) echo '%20' ;;\n"+
		"  select-pane) exit 0 ;;\n"+
		"  display-message) echo '@9' ;;\n"+
		"  list-panes) printf '%s\n' '%20' '%21' ;;\n"+
		"  *) exit 0 ;;\n"+
		"esac\n")
	testutil.WriteStub(t, dir, "git", "#!/bin/sh\necho 'feature-x'\n")
	testutil.WriteStub(t, dir, "fab", "#!/bin/sh\nprintf 'command: claude --dangerously-skip-permissions\\nskill_prefix: /\\n'\n")
	t.Setenv("PATH", dir)

	origServer, origSession, origRepo, origJSON := riffServerFlag, riffSessionFlag, riffRepoFlag, riffJSONFlag
	origSess := riffCurrentSessionFn
	riffCurrentSessionFn = func(_ context.Context, _ string) (string, error) { return "boot", nil }
	t.Cleanup(func() {
		riffServerFlag, riffSessionFlag, riffRepoFlag, riffJSONFlag = origServer, origSession, origRepo, origJSON
		riffCurrentSessionFn = origSess
	})
	return repoRoot, tmuxLog, wtLog
}

// TestRiffTargetingFlagsJSONReceipt pins the R10/R9 contract: with $TMUX
// unusable (the -L form), `rk riff -L scratch --repo <root> --json` skips the
// $TMUX precondition (wt on PATH still required — the stubs provide it),
// addresses every tmux call with -L scratch, runs wt create with Dir = the
// --repo root, and prints exactly one envelope whose windows[0] carries the
// spawned window's id, panes, worktree, and branch.
func TestRiffTargetingFlagsJSONReceipt(t *testing.T) {
	repoRoot, tmuxLog, wtLog := riffTargetFixture(t)
	riffServerFlag = "scratch"
	riffRepoFlag = repoRoot
	riffJSONFlag = true
	riffPaneSpecs = nil
	riffLayoutFlag = "auto"
	riffCountFlag = 1

	var stdout bytes.Buffer
	cmd := &cobra.Command{}
	cmd.SetOut(&stdout)
	cmd.SetErr(&bytes.Buffer{})
	cmd.SetContext(context.Background())

	if err := runRiff(cmd, nil); err != nil {
		t.Fatalf("runRiff: %v", err)
	}

	var doc struct {
		OK     bool `json:"ok"`
		Result struct {
			Windows []struct {
				ID       string   `json:"id"`
				Name     string   `json:"name"`
				Server   string   `json:"server"`
				Panes    []string `json:"panes"`
				Worktree string   `json:"worktree"`
				Branch   string   `json:"branch"`
			} `json:"windows"`
		} `json:"result"`
	}
	if err := json.Unmarshal(bytes.TrimSpace(stdout.Bytes()), &doc); err != nil {
		t.Fatalf("stdout is not one JSON document: %v (%q)", err, stdout.String())
	}
	if !doc.OK || len(doc.Result.Windows) != 1 {
		t.Fatalf("receipt = %q, want ok:true with one window", stdout.String())
	}
	w := doc.Result.Windows[0]
	if w.ID != "@9" || w.Server != "scratch" || w.Branch != "feature-x" {
		t.Errorf("window = %+v, want id @9, server scratch, branch feature-x", w)
	}
	if len(w.Panes) != 2 || w.Panes[0] != "%20" || w.Panes[1] != "%21" {
		t.Errorf("panes = %v, want [%%20 %%21]", w.Panes)
	}
	if !strings.HasSuffix(w.Worktree, "swift-fox") {
		t.Errorf("worktree = %q, want the wt-created path", w.Worktree)
	}

	tmuxData, err := os.ReadFile(tmuxLog)
	if err != nil {
		t.Fatalf("read tmux log: %v", err)
	}
	for _, line := range strings.Split(strings.TrimSpace(string(tmuxData)), "\n") {
		if !strings.HasPrefix(line, "-L scratch ") {
			t.Errorf("tmux call lacks the -L scratch prefix: %q", line)
		}
	}
	wtData, err := os.ReadFile(wtLog)
	if err != nil {
		t.Fatalf("read wt log: %v", err)
	}
	if got := strings.TrimSpace(string(wtData)); got != repoRoot {
		t.Errorf("wt create ran in %q, want the --repo root %q", got, repoRoot)
	}
}

// TestRiffSessionFlagValidation: --session without the =S exact form and
// --repo naming a non-toplevel directory are usage errors (exit 2) before any
// subprocess.
func TestRiffSessionFlagValidation(t *testing.T) {
	repoRoot, _, _ := riffTargetFixture(t)

	bare := &cobra.Command{}
	bare.SetContext(context.Background())
	riffSessionFlag = "boot" // no "=" prefix
	if err := runRiff(bare, nil); err == nil || exitCode(err) != exitUsage {
		t.Errorf("--session boot: err = %v (code %d), want exit 2", err, exitCode(err))
	}
	riffSessionFlag = ""

	riffRepoFlag = filepath.Join(repoRoot, "sub")
	if err := os.MkdirAll(riffRepoFlag, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := runRiff(bare, nil); err == nil || exitCode(err) != exitUsage {
		t.Errorf("--repo <subdir>: err = %v (code %d), want exit 2", err, exitCode(err))
	}
}

// TestRiffJSONPreconditionEnvelope: `rk riff --json` with $TMUX unset and no
// -L writes the operational error envelope to stdout before the wrapper's
// os.Exit — observed out of process (the RK_RIFF_SUBPROC re-exec pattern).
func TestRiffJSONPreconditionEnvelope(t *testing.T) {
	if os.Getenv("RK_RIFF_SUBPROC") == "json-precondition" {
		rootCmd.SetArgs([]string{"riff", "--json"})
		execute()
		os.Exit(0) // unreachable when the precondition fired
	}
	cmd := exec.Command(os.Args[0], "-test.run", "^TestRiffJSONPreconditionEnvelope$")
	var env []string
	for _, kv := range os.Environ() {
		if strings.HasPrefix(kv, "TMUX=") || strings.HasPrefix(kv, "TMUX_PANE=") {
			continue
		}
		env = append(env, kv)
	}
	cmd.Env = append(env, "RK_RIFF_SUBPROC=json-precondition")
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	var ee *exec.ExitError
	if !errors.As(err, &ee) {
		t.Fatalf("expected the child to exit non-zero, got err=%v (stdout %q)", err, stdout.String())
	}
	if got := ee.ExitCode(); got != 1 {
		t.Errorf("exit code = %d, want 1 (precondition)", got)
	}
	var doc struct {
		OK    bool `json:"ok"`
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if jsonErr := json.Unmarshal(bytes.TrimSpace(stdout.Bytes()), &doc); jsonErr != nil {
		t.Fatalf("child stdout is not one JSON document: %v (%q)", jsonErr, stdout.String())
	}
	if doc.OK || doc.Error.Code != "operational" || !strings.Contains(doc.Error.Message, "not inside a tmux session") {
		t.Errorf("envelope = %q, want ok:false operational naming the precondition", stdout.String())
	}
}
