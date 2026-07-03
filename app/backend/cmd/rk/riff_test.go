package main

import (
	"bytes"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/spf13/pflag"

	"rk/internal/fabconfig"
)

func TestParseWorktreePath(t *testing.T) {
	cases := []struct {
		name   string
		output string
		want   string
	}{
		{
			name:   "simple happy path",
			output: "Path: /tmp/myrepo.worktrees/alpha\n",
			want:   "/tmp/myrepo.worktrees/alpha",
		},
		{
			name:   "whitespace trimmed",
			output: "   Path:    /tmp/myrepo.worktrees/alpha   \n",
			want:   "/tmp/myrepo.worktrees/alpha",
		},
		{
			name: "Path line among other lines",
			output: "Created worktree\n" +
				"Branch: feature/foo\n" +
				"Path: /tmp/myrepo.worktrees/beta\n" +
				"Done.\n",
			want: "/tmp/myrepo.worktrees/beta",
		},
		{
			name:   "no Path line",
			output: "wt: something went wrong\nhave a nice day\n",
			want:   "",
		},
		{
			name:   "Path with empty value",
			output: "Path: \n",
			want:   "",
		},
		{
			name:   "empty output",
			output: "",
			want:   "",
		},
		{
			name: "first Path line wins",
			output: "Path: /a\n" +
				"Path: /b\n",
			want: "/a",
		},
		{
			name:   "path containing spaces preserved",
			output: "Path: /tmp/has spaces/alpha\n",
			want:   "/tmp/has spaces/alpha",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := parseWorktreePath(tc.output)
			if got != tc.want {
				t.Errorf("parseWorktreePath(%q) = %q, want %q", tc.output, got, tc.want)
			}
		})
	}
}

func TestEscapeSingleQuotes(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
	}{
		{"no quotes", "/fab-discuss", "/fab-discuss"},
		{"one quote", "say 'hi'", `say '\''hi'\''`},
		{"multiple quotes", "'a'b'c'", `'\''a'\''b'\''c'\''`},
		{"only a quote", "'", `'\''`},
		{"empty string", "", ""},
		{"mixed content", `it's a "test"`, `it'\''s a "test"`},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := escapeSingleQuotes(tc.in)
			if got != tc.want {
				t.Errorf("escapeSingleQuotes(%q) = %q, want %q", tc.in, got, tc.want)
			}
		})
	}
}

// TestBuildNewWindowArgs asserts the argv slice produced by buildNewWindowArgs
// for the `tmux new-window` invocation. This is a pure-function test — it MUST
// NOT invoke real tmux or exec.CommandContext. The helper is the test seam
// required by the spec's "Test seam for argv construction" requirement; this
// test covers the resolvedName verbatim rule, argv ordering
// (`new-window -n <name> -c <path> <shellCmd>`), the distinct-argv security
// constraint, the interactive-shell wrap, and the shellWrap suffix.
//
// The trailing shell string has the shape
//
//	${SHELL:-/bin/sh} -i -c '<launcher-with-cmd-arg-single-quote-escaped>'; exec "${SHELL:-/bin/sh}"
//
// where single quotes in the layer-1 launcher-with-cmd-arg are escaped via
// the canonical `'\''` sequence before being wrapped in `sh -i -c '…'`.
func TestBuildNewWindowArgs(t *testing.T) {
	cases := []struct {
		name         string
		worktreePath string
		resolvedName string
		launcher     string
		cmdArg       string
		want         []string
	}{
		{
			name:         "typical .worktrees/ path",
			worktreePath: "/home/sahil/code/sahil87/run-kit.worktrees/pacing-canyon",
			resolvedName: "riff-pacing-canyon",
			launcher:     "claude --dangerously-skip-permissions",
			cmdArg:       "/fab-discuss",
			want: []string{
				"new-window",
				"-n", "riff-pacing-canyon",
				"-c", "/home/sahil/code/sahil87/run-kit.worktrees/pacing-canyon",
				`${SHELL:-/bin/sh} -i -c 'claude --dangerously-skip-permissions '\''/fab-discuss'\'''; exec "${SHELL:-/bin/sh}"`,
			},
		},
		{
			name:         "trailing slash preserved in -c",
			worktreePath: "/tmp/myrepo.worktrees/alpha/",
			resolvedName: "riff-alpha",
			launcher:     "claude",
			cmdArg:       "/x",
			want: []string{
				"new-window",
				"-n", "riff-alpha",
				"-c", "/tmp/myrepo.worktrees/alpha/",
				`${SHELL:-/bin/sh} -i -c 'claude '\''/x'\'''; exec "${SHELL:-/bin/sh}"`,
			},
		},
		{
			name:         "relative path no dir",
			worktreePath: "alpha",
			resolvedName: "riff-alpha",
			launcher:     "claude",
			cmdArg:       "/x",
			want: []string{
				"new-window",
				"-n", "riff-alpha",
				"-c", "alpha",
				`${SHELL:-/bin/sh} -i -c 'claude '\''/x'\'''; exec "${SHELL:-/bin/sh}"`,
			},
		},
		{
			name:         "cmdArg with single quote",
			worktreePath: "/tmp/myrepo.worktrees/alpha",
			resolvedName: "riff-alpha",
			launcher:     "claude",
			cmdArg:       "it's a test",
			// Layer 1: claude 'it'\''s a test'
			// Layer 2 escapes every ' in layer 1 to '\'' — the layer-1 string
			// has 3 single quotes (one before `it`, the `'\''` sequence contains
			// two more single quotes: the opening and closing wrappers contain
			// quotes too — in full, layer 1 is: claude 'it'\''s a test' which
			// has 4 single quotes). Each becomes '\'' in layer 2. The test
			// asserts the final string verbatim.
			want: []string{
				"new-window",
				"-n", "riff-alpha",
				"-c", "/tmp/myrepo.worktrees/alpha",
				`${SHELL:-/bin/sh} -i -c 'claude '\''it'\''\'\'''\''s a test'\'''; exec "${SHELL:-/bin/sh}"`,
			},
		},
		{
			name:         "empty launcher tolerated",
			worktreePath: "/tmp/myrepo.worktrees/alpha",
			resolvedName: "riff-alpha",
			launcher:     "",
			cmdArg:       "/x",
			want: []string{
				"new-window",
				"-n", "riff-alpha",
				"-c", "/tmp/myrepo.worktrees/alpha",
				`${SHELL:-/bin/sh} -i -c ' '\''/x'\'''; exec "${SHELL:-/bin/sh}"`,
			},
		},
		{
			name:         "resolved name with suffix used verbatim",
			worktreePath: "/tmp/myrepo.worktrees/alpha",
			resolvedName: "riff-alpha-3",
			launcher:     "claude",
			cmdArg:       "/x",
			want: []string{
				"new-window",
				"-n", "riff-alpha-3",
				"-c", "/tmp/myrepo.worktrees/alpha",
				`${SHELL:-/bin/sh} -i -c 'claude '\''/x'\'''; exec "${SHELL:-/bin/sh}"`,
			},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := buildNewWindowArgs(tc.worktreePath, tc.resolvedName, tc.launcher, tc.cmdArg)
			if !reflect.DeepEqual(got, tc.want) {
				t.Errorf("buildNewWindowArgs(%q, %q, %q, %q) =\n  %#v\nwant\n  %#v", tc.worktreePath, tc.resolvedName, tc.launcher, tc.cmdArg, got, tc.want)
			}
		})
	}
}

// TestShellWrap asserts shellWrap's output for the empty, simple, and
// embedded-quote cases. Pure string equality — no tmux or exec invocation.
func TestShellWrap(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
	}{
		{
			name: "empty input produces only the exec suffix",
			in:   "",
			want: `exec "${SHELL:-/bin/sh}"`,
		},
		{
			name: "whitespace-only input produces only the exec suffix",
			in:   "   \t  ",
			want: `exec "${SHELL:-/bin/sh}"`,
		},
		{
			name: "simple command",
			in:   "claude '/fab-discuss'",
			want: `claude '/fab-discuss'; exec "${SHELL:-/bin/sh}"`,
		},
		{
			name: "command with embedded single quotes",
			in:   `echo 'hello '\''world'\'''`,
			want: `echo 'hello '\''world'\'''; exec "${SHELL:-/bin/sh}"`,
		},
		{
			name: "command with embedded double quotes",
			in:   `echo "hello \"world\""`,
			want: `echo "hello \"world\""; exec "${SHELL:-/bin/sh}"`,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := shellWrap(tc.in)
			if got != tc.want {
				t.Errorf("shellWrap(%q) = %q, want %q", tc.in, got, tc.want)
			}
		})
	}
}

// TestResolveWindowName asserts the collision-resolution rules for the pure
// window-name helper. The scheme is "first gap wins, starting from base-2".
func TestResolveWindowName(t *testing.T) {
	cases := []struct {
		name     string
		existing []string
		base     string
		want     string
	}{
		{
			name:     "no collision returns base",
			existing: []string{"other-window", "unrelated"},
			base:     "riff-alpha",
			want:     "riff-alpha",
		},
		{
			name:     "one collision returns base-2",
			existing: []string{"riff-alpha"},
			base:     "riff-alpha",
			want:     "riff-alpha-2",
		},
		{
			name:     "three collisions return base-4",
			existing: []string{"riff-alpha", "riff-alpha-2", "riff-alpha-3"},
			base:     "riff-alpha",
			want:     "riff-alpha-4",
		},
		{
			name:     "empty existing-list returns base",
			existing: nil,
			base:     "riff-alpha",
			want:     "riff-alpha",
		},
		{
			name:     "gap at base-2 filled before base-3",
			existing: []string{"riff-alpha", "riff-alpha-3"},
			base:     "riff-alpha",
			want:     "riff-alpha-2",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := resolveWindowName(tc.existing, tc.base)
			if got != tc.want {
				t.Errorf("resolveWindowName(%v, %q) = %q, want %q", tc.existing, tc.base, got, tc.want)
			}
		})
	}
}

// TestParseFabAgentOutput covers the pure post-processing seam for
// resolveLauncher's `fab agent --print` call: it decides whether the
// subprocess result yields a usable launcher. Pure — no subprocess. A trimmed
// multi-line result is malformed (a valid session command is one line).
func TestParseFabAgentOutput(t *testing.T) {
	cases := []struct {
		name    string
		stdout  string
		err     error
		want    string
		wantOK  bool
	}{
		{
			name:   "single line returns launcher",
			stdout: "claude --dangerously-skip-permissions --effort xhigh\n",
			err:    nil,
			want:   "claude --dangerously-skip-permissions --effort xhigh",
			wantOK: true,
		},
		{
			name:   "leading and trailing whitespace trimmed",
			stdout: "   claude --model x   \n\n",
			err:    nil,
			want:   "claude --model x",
			wantOK: true,
		},
		{
			name:   "shell substitution preserved",
			stdout: "claude --dangerously-skip-permissions -n \"$(basename \"$(pwd)\")\"\n",
			err:    nil,
			want:   `claude --dangerously-skip-permissions -n "$(basename "$(pwd)")"`,
			wantOK: true,
		},
		{
			name:   "exec error falls back",
			stdout: "some output",
			err:    errTestFail,
			want:   "",
			wantOK: false,
		},
		{
			name:   "empty stdout falls back",
			stdout: "",
			err:    nil,
			want:   "",
			wantOK: false,
		},
		{
			name:   "whitespace-only stdout falls back",
			stdout: "   \n\t\n",
			err:    nil,
			want:   "",
			wantOK: false,
		},
		{
			name:   "multi-line stdout is malformed and falls back",
			stdout: "claude --flag\nextra noise line\n",
			err:    nil,
			want:   "",
			wantOK: false,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, ok := parseFabAgentOutput(tc.stdout, tc.err)
			if ok != tc.wantOK {
				t.Fatalf("parseFabAgentOutput(%q, %v) ok = %v, want %v", tc.stdout, tc.err, ok, tc.wantOK)
			}
			if got != tc.want {
				t.Errorf("parseFabAgentOutput(%q, %v) = %q, want %q", tc.stdout, tc.err, got, tc.want)
			}
		})
	}
}

// TestResolveLauncher_StubFab exercises resolveLauncher end-to-end by staging a
// stub `fab` executable on a temp-dir PATH (the standard Go technique for
// exec-path coverage). It covers the fab-present success path, the non-zero
// exit fallback, and the fab-absent fallback.
func TestResolveLauncher_StubFab(t *testing.T) {
	t.Run("stub fab prints launcher", func(t *testing.T) {
		want := "stub-launcher --effort xhigh"
		dir := stubFab(t, "#!/bin/sh\nprintf '%s\\n' '"+want+"'\n")
		t.Setenv("PATH", dir)
		if got := resolveLauncher(); got != want {
			t.Errorf("resolveLauncher() = %q, want %q", got, want)
		}
	})

	t.Run("stub fab exits non-zero falls back", func(t *testing.T) {
		dir := stubFab(t, "#!/bin/sh\necho boom >&2\nexit 1\n")
		t.Setenv("PATH", dir)
		if got := resolveLauncher(); got != defaultLauncher {
			t.Errorf("resolveLauncher() = %q, want %q (fallback)", got, defaultLauncher)
		}
	})

	t.Run("fab absent from PATH falls back", func(t *testing.T) {
		// An empty temp dir on PATH — no `fab` executable present.
		t.Setenv("PATH", t.TempDir())
		if got := resolveLauncher(); got != defaultLauncher {
			t.Errorf("resolveLauncher() = %q, want %q (fallback)", got, defaultLauncher)
		}
	})
}

// stubFab writes an executable `fab` script with the given shell body into a
// fresh temp dir and returns that dir (suitable as a PATH override). Fails the
// test on any filesystem error.
func stubFab(t *testing.T, script string) string {
	t.Helper()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "fab"), []byte(script), 0o755); err != nil {
		t.Fatalf("WriteFile stub fab: %v", err)
	}
	return dir
}

// chdir changes into dir and returns a restore function. The restore uses
// the original cwd captured at call time — safe to defer in tests.
func chdir(t *testing.T, dir string) func() {
	t.Helper()
	orig, err := os.Getwd()
	if err != nil {
		t.Fatalf("Getwd: %v", err)
	}
	// Resolve symlinks so macOS /tmp -> /private/tmp doesn't confuse ancestor
	// walks in resolveLauncher.
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
// `--skill VAL` / `--cmd VAL` into equals-form before cobra parses. Bare
// form (next token is a flag or absent) is preserved, and tokens after the
// `--` separator are passed through unchanged.
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

// TestPaneFlagParsing exercises the full argv-rewrite + pflag.Parse round
// trip to assert that interleaved --skill/--cmd occurrences produce the
// correct ordered PaneSpec slice. This is the end-to-end test for the
// pane-array model; the argv rewriter + paneFlag.Set cooperate to produce
// the observed order.
func TestPaneFlagParsing(t *testing.T) {
	cases := []struct {
		name string
		argv []string
		want []PaneSpec
	}{
		{
			name: "single bare skill",
			argv: []string{"--skill"},
			want: []PaneSpec{{Kind: PaneKindSkill, Value: ""}},
		},
		{
			name: "single skill with value",
			argv: []string{"--skill", "/fab-discuss"},
			want: []PaneSpec{{Kind: PaneKindSkill, Value: "/fab-discuss"}},
		},
		{
			name: "single cmd with equals",
			argv: []string{"--cmd=htop"},
			want: []PaneSpec{{Kind: PaneKindCmd, Value: "htop"}},
		},
		{
			name: "bare cmd followed by flag",
			argv: []string{"--cmd", "--skill", "/foo"},
			want: []PaneSpec{
				{Kind: PaneKindCmd, Value: ""},
				{Kind: PaneKindSkill, Value: "/foo"},
			},
		},
		{
			name: "interleaved four-pane",
			argv: []string{"--cmd", "--skill", "/fab-discuss", "--cmd", "htop", "--skill"},
			want: []PaneSpec{
				{Kind: PaneKindCmd, Value: ""},
				{Kind: PaneKindSkill, Value: "/fab-discuss"},
				{Kind: PaneKindCmd, Value: "htop"},
				{Kind: PaneKindSkill, Value: ""},
			},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			// Reset the shared slice + re-create flag instances for isolation.
			got := []PaneSpec{}
			skill := &paneFlag{kind: PaneKindSkill, target: &got}
			cmd := &paneFlag{kind: PaneKindCmd, target: &got}
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

// freshPaneFlagSet is a test helper that sets up a standalone FlagSet with
// the two pane flags registered. Keeps tests from touching the package-level
// riffCmd state.
func freshPaneFlagSet(skill, cmd *paneFlag) *pflag.FlagSet {
	fs := pflag.NewFlagSet("test", pflag.ContinueOnError)
	fs.SetInterspersed(false)
	fs.Var(skill, "skill", "")
	fs.Lookup("skill").NoOptDefVal = paneBareSentinel
	fs.Var(cmd, "cmd", "")
	fs.Lookup("cmd").NoOptDefVal = paneBareSentinel
	return fs
}

// TestResolveLayout covers the canonical-name passthrough, shortform
// resolution, and unknown-value error rules.
func TestResolveLayout(t *testing.T) {
	cases := []struct {
		name      string
		in        string
		want      string
		wantError bool
	}{
		{name: "canonical tiled", in: "tiled", want: "tiled"},
		{name: "canonical even-horizontal", in: "even-horizontal", want: "even-horizontal"},
		{name: "canonical even-vertical", in: "even-vertical", want: "even-vertical"},
		{name: "canonical main-horizontal", in: "main-horizontal", want: "main-horizontal"},
		{name: "canonical main-vertical", in: "main-vertical", want: "main-vertical"},
		{name: "canonical auto", in: "auto", want: "auto"},
		{name: "shortform t", in: "t", want: "tiled"},
		{name: "shortform h", in: "h", want: "even-horizontal"},
		{name: "shortform v", in: "v", want: "even-vertical"},
		{name: "shortform deck-h", in: "deck-h", want: "main-horizontal"},
		{name: "shortform deck-v", in: "deck-v", want: "main-vertical"},
		{name: "shortform a", in: "a", want: "auto"},
		{name: "unknown value errors", in: "diagonal", wantError: true},
		{name: "empty string errors", in: "", wantError: true},
		{name: "uppercase errors", in: "TILED", wantError: true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := resolveLayout(tc.in)
			if tc.wantError {
				if err == nil {
					t.Fatalf("expected error, got nil (got = %q)", got)
				}
				// Error must list all 12 valid names so the user knows what to pick.
				msg := err.Error()
				for _, want := range []string{"auto", "tiled", "even-horizontal", "even-vertical", "main-horizontal", "main-vertical", "a", "t", "h", "v", "deck-h", "deck-v"} {
					if !strings.Contains(msg, want) {
						t.Errorf("error message missing %q (msg = %q)", want, msg)
					}
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != tc.want {
				t.Errorf("resolveLayout(%q) = %q, want %q", tc.in, got, tc.want)
			}
		})
	}
}

// TestAutoLayout covers the pane-count → layout dispatch.
func TestAutoLayout(t *testing.T) {
	cases := []struct {
		count int
		want  string
	}{
		{0, ""},
		{1, ""},
		{2, "even-horizontal"},
		{3, "tiled"},
		{4, "tiled"},
		{10, "tiled"},
	}
	for _, tc := range cases {
		got := autoLayout(tc.count)
		if got != tc.want {
			t.Errorf("autoLayout(%d) = %q, want %q", tc.count, got, tc.want)
		}
	}
}

// TestResolveActivePreset covers the six cases from the spec: positional
// match, positional non-match, --preset flag resolution, conflict between
// positional + --preset, unknown preset, no preset available.
func TestResolveActivePreset(t *testing.T) {
	presets := map[string]fabconfig.Preset{
		"ship":        {Layout: "deck-h"},
		"investigate": {Layout: "v"},
	}
	t.Run("positional match consumes arg", func(t *testing.T) {
		p, rem, err := resolveActivePreset([]string{"ship", "--", "--base", "main"}, "ship", "", presets)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if p == nil || p.Layout != "deck-h" {
			t.Errorf("preset = %#v, want ship", p)
		}
		if !reflect.DeepEqual(rem, []string{"--", "--base", "main"}) {
			t.Errorf("remaining = %v", rem)
		}
	})
	t.Run("positional non-match leaves args untouched", func(t *testing.T) {
		p, rem, err := resolveActivePreset([]string{"nosuch"}, "nosuch", "", presets)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if p != nil {
			t.Errorf("preset = %#v, want nil", p)
		}
		if !reflect.DeepEqual(rem, []string{"nosuch"}) {
			t.Errorf("remaining = %v", rem)
		}
	})
	t.Run("--preset flag resolves", func(t *testing.T) {
		p, _, err := resolveActivePreset(nil, "", "investigate", presets)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if p == nil || p.Layout != "v" {
			t.Errorf("preset = %#v, want investigate", p)
		}
	})
	t.Run("conflict positional + --preset", func(t *testing.T) {
		_, _, err := resolveActivePreset([]string{"ship"}, "ship", "investigate", presets)
		if err == nil {
			t.Fatalf("expected error, got nil")
		}
		if !strings.Contains(err.Error(), "mutually exclusive") {
			t.Errorf("error missing 'mutually exclusive': %v", err)
		}
	})
	t.Run("unknown preset via --preset", func(t *testing.T) {
		_, _, err := resolveActivePreset(nil, "", "nope", presets)
		if err == nil {
			t.Fatalf("expected error, got nil")
		}
		if !strings.Contains(err.Error(), "unknown preset") {
			t.Errorf("error missing 'unknown preset': %v", err)
		}
		if !strings.Contains(err.Error(), "ship") || !strings.Contains(err.Error(), "investigate") {
			t.Errorf("error should list defined presets: %v", err)
		}
	})
	t.Run("no preset available returns nil", func(t *testing.T) {
		p, rem, err := resolveActivePreset([]string{"ship"}, "ship", "", nil)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if p != nil {
			t.Errorf("preset = %#v, want nil", p)
		}
		if !reflect.DeepEqual(rem, []string{"ship"}) {
			t.Errorf("remaining = %v", rem)
		}
	})
}

// TestResolveEffectiveSpec covers pane/layout/wt-args precedence rules.
func TestResolveEffectiveSpec(t *testing.T) {
	t.Run("preset panes used when no CLI panes", func(t *testing.T) {
		preset := &fabconfig.Preset{
			Panes: []fabconfig.PaneSpec{
				{Kind: fabconfig.PaneKindSkill, Skill: "/fab-fff"},
				{Kind: fabconfig.PaneKindCmd, Cmd: "just dev"},
			},
		}
		spec, err := resolveEffectiveSpec(nil, false, "auto", 1, preset, nil)
		if err != nil {
			t.Fatalf("err: %v", err)
		}
		if len(spec.Panes) != 2 {
			t.Errorf("panes = %v, want 2", spec.Panes)
		}
		if spec.Panes[0] != (PaneSpec{Kind: PaneKindSkill, Value: "/fab-fff"}) {
			t.Errorf("pane[0] = %#v", spec.Panes[0])
		}
		if spec.Panes[1] != (PaneSpec{Kind: PaneKindCmd, Value: "just dev"}) {
			t.Errorf("pane[1] = %#v", spec.Panes[1])
		}
	})
	t.Run("CLI panes replace preset panes", func(t *testing.T) {
		preset := &fabconfig.Preset{
			Panes: []fabconfig.PaneSpec{
				{Kind: fabconfig.PaneKindSkill, Skill: "/fab-fff"},
				{Kind: fabconfig.PaneKindCmd, Cmd: "just dev"},
				{Kind: fabconfig.PaneKindCmd, Cmd: "just logs"},
			},
		}
		cli := []PaneSpec{{Kind: PaneKindSkill, Value: "/review"}}
		spec, err := resolveEffectiveSpec(cli, false, "auto", 1, preset, nil)
		if err != nil {
			t.Fatalf("err: %v", err)
		}
		if len(spec.Panes) != 1 || spec.Panes[0].Value != "/review" {
			t.Errorf("panes = %#v, want 1 review pane", spec.Panes)
		}
	})
	t.Run("CLI layout overrides preset layout", func(t *testing.T) {
		preset := &fabconfig.Preset{
			Layout: "deck-h",
			Panes: []fabconfig.PaneSpec{
				{Kind: fabconfig.PaneKindSkill, Skill: "/a"},
				{Kind: fabconfig.PaneKindCmd, Cmd: "x"},
			},
		}
		spec, err := resolveEffectiveSpec(nil, true, "even-vertical", 1, preset, nil)
		if err != nil {
			t.Fatalf("err: %v", err)
		}
		if spec.Layout != "even-vertical" {
			t.Errorf("layout = %q, want even-vertical", spec.Layout)
		}
	})
	t.Run("explicit --layout auto overrides preset layout", func(t *testing.T) {
		preset := &fabconfig.Preset{
			Layout: "deck-h",
			Panes: []fabconfig.PaneSpec{
				{Kind: fabconfig.PaneKindSkill, Skill: "/a"},
				{Kind: fabconfig.PaneKindCmd, Cmd: "x"},
			},
		}
		// layoutExplicit=true + canonical="auto" → auto-by-count wins over preset's deck-h.
		spec, err := resolveEffectiveSpec(nil, true, "auto", 1, preset, nil)
		if err != nil {
			t.Fatalf("err: %v", err)
		}
		if spec.Layout != "even-horizontal" {
			t.Errorf("layout = %q, want even-horizontal (auto for 2 panes)", spec.Layout)
		}
	})
	t.Run("single-pane window suppresses layout regardless of source", func(t *testing.T) {
		cli := []PaneSpec{{Kind: PaneKindSkill, Value: "/fab-fff"}}
		// User explicitly passes --layout main-horizontal on a 1-pane window.
		spec, err := resolveEffectiveSpec(cli, true, "main-horizontal", 1, nil, nil)
		if err != nil {
			t.Fatalf("err: %v", err)
		}
		if spec.Layout != "" {
			t.Errorf("layout = %q, want empty (1-pane suppression)", spec.Layout)
		}
	})
	t.Run("single-pane from preset suppresses preset layout", func(t *testing.T) {
		preset := &fabconfig.Preset{
			Layout: "tiled",
			Panes:  []fabconfig.PaneSpec{{Kind: fabconfig.PaneKindSkill, Skill: "/a"}},
		}
		spec, err := resolveEffectiveSpec(nil, false, "auto", 1, preset, nil)
		if err != nil {
			t.Fatalf("err: %v", err)
		}
		if spec.Layout != "" {
			t.Errorf("layout = %q, want empty (1-pane preset suppression)", spec.Layout)
		}
	})
	t.Run("preset layout used when CLI is auto", func(t *testing.T) {
		preset := &fabconfig.Preset{
			Layout: "deck-h",
			Panes: []fabconfig.PaneSpec{
				{Kind: fabconfig.PaneKindSkill, Skill: "/a"},
				{Kind: fabconfig.PaneKindCmd, Cmd: "x"},
			},
		}
		spec, err := resolveEffectiveSpec(nil, false, "auto", 1, preset, nil)
		if err != nil {
			t.Fatalf("err: %v", err)
		}
		if spec.Layout != "main-horizontal" {
			t.Errorf("layout = %q, want main-horizontal (canonical of deck-h)", spec.Layout)
		}
	})
	t.Run("preset wt_args prepended to passthrough", func(t *testing.T) {
		preset := &fabconfig.Preset{WtArgs: []string{"--base", "main"}}
		spec, err := resolveEffectiveSpec(nil, false, "auto", 1, preset, []string{"--reuse"})
		if err != nil {
			t.Fatalf("err: %v", err)
		}
		want := []string{"--base", "main", "--reuse"}
		if !reflect.DeepEqual(spec.Passthrough, want) {
			t.Errorf("passthrough = %v, want %v", spec.Passthrough, want)
		}
	})
	t.Run("no panes anywhere defaults to single /fab-discuss pane", func(t *testing.T) {
		spec, err := resolveEffectiveSpec(nil, false, "auto", 1, nil, nil)
		if err != nil {
			t.Fatalf("err: %v", err)
		}
		want := []PaneSpec{{Kind: PaneKindSkill, Value: defaultRiffSkill}}
		if !reflect.DeepEqual(spec.Panes, want) {
			t.Errorf("panes = %#v, want %#v", spec.Panes, want)
		}
	})
	t.Run("count respects CLI value", func(t *testing.T) {
		spec, err := resolveEffectiveSpec(nil, false, "auto", 5, nil, nil)
		if err != nil {
			t.Fatalf("err: %v", err)
		}
		if spec.Count != 5 {
			t.Errorf("count = %d, want 5", spec.Count)
		}
	})
}

// TestBuildSpawnArgvs exercises the pure argv-construction helper that
// underpins spawnRiff. Validates that the emitted argv sequence matches
// what the spec demands for common pane shapes.
func TestBuildSpawnArgvs(t *testing.T) {
	worktree := "/tmp/wt/alpha"
	name := "riff-alpha"
	launcher := "claude"

	t.Run("single skill pane (auto layout → no select-layout)", func(t *testing.T) {
		spec := effectiveSpec{
			Panes:    []PaneSpec{{Kind: PaneKindSkill, Value: "/fab-discuss"}},
			Layout:   "",
			Launcher: launcher,
		}
		got := buildSpawnArgvs(worktree, name, spec)
		// `select-pane` is no longer emitted by buildSpawnArgvs — it is
		// constructed at runtime by the orchestrator from the captured pane id.
		if len(got) != 1 {
			t.Fatalf("got %d argvs, want 1 (new-window only)", len(got))
		}
		if got[0][0] != "new-window" {
			t.Errorf("argv[0][0] = %q, want new-window", got[0][0])
		}
		// Defensive: no select-pane row should appear.
		for _, argv := range got {
			if argv[0] == "select-pane" {
				t.Errorf("buildSpawnArgvs unexpectedly returned a select-pane row: %v", argv)
			}
		}
	})

	t.Run("2 panes (skill + cmd) with auto → even-horizontal", func(t *testing.T) {
		spec := effectiveSpec{
			Panes: []PaneSpec{
				{Kind: PaneKindSkill, Value: "/a"},
				{Kind: PaneKindCmd, Value: "just dev"},
			},
			Layout:   "even-horizontal",
			Launcher: launcher,
		}
		got := buildSpawnArgvs(worktree, name, spec)
		// 2 panes → new-window + split-window + select-layout. select-pane is
		// constructed at runtime by the orchestrator using the captured pane id.
		if len(got) != 3 {
			t.Fatalf("got %d argvs, want 3 (new-window + split-window + select-layout)", len(got))
		}
		if got[0][0] != "new-window" {
			t.Errorf("argv[0][0] = %q, want new-window", got[0][0])
		}
		if got[1][0] != "split-window" {
			t.Errorf("argv[1][0] = %q, want split-window", got[1][0])
		}
		if got[2][0] != "select-layout" || got[2][len(got[2])-1] != "even-horizontal" {
			t.Errorf("select-layout argv = %v", got[2])
		}
		// Cmd pane's shell string: shellWrap("just dev") — no interactive
		// launcher wrap.
		cmdShell := got[1][len(got[1])-1]
		if !strings.Contains(cmdShell, "just dev") {
			t.Errorf("split-window shell string missing 'just dev': %q", cmdShell)
		}
		if strings.Contains(cmdShell, "${SHELL:-/bin/sh} -i -c") {
			t.Errorf("split-window cmd pane should NOT have interactive wrap: %q", cmdShell)
		}
	})

	t.Run("4 panes interleaved with tiled", func(t *testing.T) {
		spec := effectiveSpec{
			Panes: []PaneSpec{
				{Kind: PaneKindCmd, Value: ""},
				{Kind: PaneKindSkill, Value: "/fab-discuss"},
				{Kind: PaneKindCmd, Value: "htop"},
				{Kind: PaneKindSkill, Value: ""},
			},
			Layout:   "tiled",
			Launcher: launcher,
		}
		got := buildSpawnArgvs(worktree, name, spec)
		// 4 panes = 1 new-window + 3 split-window + 1 select-layout = 5.
		// select-pane is constructed at runtime, not by buildSpawnArgvs.
		if len(got) != 5 {
			t.Fatalf("got %d argvs, want 5", len(got))
		}
		// Pane 0 is bare cmd → shellWrap("") → just `exec "${SHELL:-/bin/sh}"`
		pane0 := got[0][len(got[0])-1]
		if !strings.Contains(pane0, `exec "${SHELL:-/bin/sh}"`) {
			t.Errorf("pane 0 bare-cmd shell string = %q", pane0)
		}
		// Pane 3 is bare skill → `<launcher>` with no quoted arg, interactive wrap.
		pane3 := got[3][len(got[3])-1]
		if !strings.Contains(pane3, "${SHELL:-/bin/sh} -i -c 'claude'") {
			t.Errorf("pane 3 bare-skill shell missing interactive wrap around bare launcher: %q", pane3)
		}
	})

	t.Run("bare --skill alone", func(t *testing.T) {
		spec := effectiveSpec{
			Panes:    []PaneSpec{{Kind: PaneKindSkill, Value: ""}},
			Layout:   "",
			Launcher: launcher,
		}
		got := buildSpawnArgvs(worktree, name, spec)
		// 1 pane → new-window only (select-pane is runtime).
		if len(got) != 1 {
			t.Fatalf("got %d argvs, want 1", len(got))
		}
		shell := got[0][len(got[0])-1]
		// No single-quoted arg after launcher — just `claude` inside the
		// interactive wrap.
		if strings.Contains(shell, "claude '") {
			t.Errorf("bare --skill should NOT produce claude '<arg>': %q", shell)
		}
	})

	t.Run("bare --cmd alone", func(t *testing.T) {
		spec := effectiveSpec{
			Panes:    []PaneSpec{{Kind: PaneKindCmd, Value: ""}},
			Layout:   "",
			Launcher: launcher,
		}
		got := buildSpawnArgvs(worktree, name, spec)
		if len(got) != 1 {
			t.Fatalf("got %d argvs, want 1", len(got))
		}
		shell := got[0][len(got[0])-1]
		if shell != `exec "${SHELL:-/bin/sh}"` {
			t.Errorf("bare --cmd shell = %q, want the exec-only form", shell)
		}
	})
}

// TestPrintPresets covers the empty-map and multi-preset rendering.
func TestPrintPresets(t *testing.T) {
	t.Run("empty map prints no-presets line", func(t *testing.T) {
		var buf bytes.Buffer
		if err := printPresets(map[string]fabconfig.Preset{}, &buf); err != nil {
			t.Fatalf("err: %v", err)
		}
		if !strings.Contains(buf.String(), "No presets defined in fab/project/config.yaml") {
			t.Errorf("output missing no-presets line: %q", buf.String())
		}
	})

	t.Run("two presets render all fields", func(t *testing.T) {
		// Change into a tempdir with no fab/project/config.yaml so the
		// ordered-read fallback path kicks in (alphabetical order when
		// not from disk).
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
		if err := printPresets(presets, &buf); err != nil {
			t.Fatalf("err: %v", err)
		}
		out := buf.String()
		for _, want := range []string{"ship:", "bare:", "/fab-fff", "just dev", "--base", "main", "layout: deck-h"} {
			if !strings.Contains(out, want) {
				t.Errorf("output missing %q; got: %s", want, out)
			}
		}
		// "bare" should come before "ship" in alphabetical (fallback) order.
		bareIdx := strings.Index(out, "bare:")
		shipIdx := strings.Index(out, "ship:")
		if bareIdx < 0 || shipIdx < 0 || bareIdx > shipIdx {
			t.Errorf("alphabetical order failed: bare=%d ship=%d", bareIdx, shipIdx)
		}
	})
}

// TestPlanFanOutRollback exercises the pure rollback-plan builder. The
// failing goroutine's own artifacts are excluded; successes (fully or
// partially created) are included so rollback can clean them up.
func TestPlanFanOutRollback(t *testing.T) {
	t.Run("all succeeded except index 1", func(t *testing.T) {
		results := []fanOutResult{
			{Index: 0, WorktreePath: "/tmp/wt/a", WindowName: "riff-a", Err: nil},
			{Index: 1, WorktreePath: "", WindowName: "", Err: errTestFail},
			{Index: 2, WorktreePath: "/tmp/wt/c", WindowName: "riff-c", Err: nil},
		}
		plan := planFanOutRollback(results, 1)
		if !reflect.DeepEqual(plan.Worktrees, []string{"a", "c"}) {
			t.Errorf("worktrees = %v, want [a c]", plan.Worktrees)
		}
		if !reflect.DeepEqual(plan.Windows, []string{"riff-a", "riff-c"}) {
			t.Errorf("windows = %v, want [riff-a riff-c]", plan.Windows)
		}
	})
	t.Run("partial success — worktree created but window failed", func(t *testing.T) {
		// Index 1 created a worktree but failed at tmux — its own artifacts
		// are skipped (the failing index is excluded from the plan). Index 0's
		// successful (worktree + window) are included; its window must be
		// killed during rollback.
		results := []fanOutResult{
			{Index: 0, WorktreePath: "/tmp/wt/a", WindowName: "riff-a", Err: nil},
			{Index: 1, WorktreePath: "/tmp/wt/b", WindowName: "", Err: errTestFail},
		}
		plan := planFanOutRollback(results, 1)
		if !reflect.DeepEqual(plan.Worktrees, []string{"a"}) {
			t.Errorf("worktrees = %v, want [a] (index 1's partial worktree excluded)", plan.Worktrees)
		}
		if !reflect.DeepEqual(plan.Windows, []string{"riff-a"}) {
			t.Errorf("windows = %v, want [riff-a]", plan.Windows)
		}
	})
	t.Run("no failures — plan is empty (caller shouldn't invoke)", func(t *testing.T) {
		results := []fanOutResult{
			{Index: 0, WorktreePath: "/tmp/wt/a", WindowName: "riff-a", Err: nil},
		}
		// failureIdx = -1 signals no failure; plan just excludes -1 which
		// matches nothing, so all are included.
		plan := planFanOutRollback(results, -1)
		if len(plan.Worktrees) != 1 || plan.Worktrees[0] != "a" {
			t.Errorf("worktrees = %v", plan.Worktrees)
		}
	})
}

var errTestFail = &exitCodeError{code: 3, msg: "test"}

// TestParsePaneID covers the trimmed-single-line parse rule for the stdout
// of `tmux new-window -P -F '#{pane_id}'`. Pure string equality — no tmux
// invocation. Spec scenario "pane-id capture parses a single trimmed line".
func TestParsePaneID(t *testing.T) {
	cases := []struct {
		name      string
		in        string
		want      string
		wantError bool
	}{
		{name: "typical pane id with newline", in: "%87\n", want: "%87"},
		{name: "leading and trailing whitespace", in: "  %12  \n", want: "%12"},
		{name: "no trailing newline", in: "%3", want: "%3"},
		{name: "tabs trimmed", in: "\t%99\t\n", want: "%99"},
		{name: "empty input errors", in: "", wantError: true},
		{name: "whitespace-only input errors", in: "   \n\t", wantError: true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := parsePaneID(tc.in)
			if tc.wantError {
				if err == nil {
					t.Fatalf("expected error, got %q", got)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != tc.want {
				t.Errorf("parsePaneID(%q) = %q, want %q", tc.in, got, tc.want)
			}
		})
	}
}

// TestBuildNewWindowCaptureArgs asserts the argv shape passed to
// `tmux new-window -P -F '#{pane_id}' …` for the first-pane capture step.
// Pure helper — argv ordering is the security-relevant contract (the
// trailing shell string is the only argv element subject to user input;
// the flags before it MUST be distinct argv elements per constitution §I).
func TestBuildNewWindowCaptureArgs(t *testing.T) {
	spec := effectiveSpec{
		Panes:    []PaneSpec{{Kind: PaneKindSkill, Value: "/fab-discuss"}},
		Layout:   "",
		Launcher: "claude",
	}
	got := buildNewWindowCaptureArgs("/tmp/wt/alpha", "riff-alpha", spec)
	want := []string{
		"new-window",
		"-P",
		"-F", "#{pane_id}",
		"-n", "riff-alpha",
		"-c", "/tmp/wt/alpha",
		`${SHELL:-/bin/sh} -i -c 'claude '\''/fab-discuss'\'''; exec "${SHELL:-/bin/sh}"`,
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("buildNewWindowCaptureArgs =\n  %#v\nwant\n  %#v", got, want)
	}
}

// TestRiffCountShortForm verifies that pflag's `-N` short-form parses into
// the same integer value that `--count` populates. Constructs a fresh
// pflag set mirroring riffCmd's registration so the test does not rely on
// process-wide state. Spec scenario "short-form parse test asserts -N 3
// populates count".
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
// `--fan-out` is no longer a registered flag, and parsing it produces an
// "unknown flag" error referencing the literal `fan-out` token. Constructs
// a fresh pflag set mirroring riffCmd's registration so the test isolates
// the flag-parse step from the cobra DisableFlagParsing wrapper.
//
// Spec scenario "post-rename rejection test fails-fast on --fan-out".
func TestRiffFanOutFlagRejected(t *testing.T) {
	var count int
	fs := pflag.NewFlagSet("test", pflag.ContinueOnError)
	// Suppress pflag's built-in error printing so the test output stays clean.
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

// TestBuildWtDeleteArgs asserts the argv shape produced for the rollback
// path's `wt delete` subprocess. The contract is:
//
//   - `--non-interactive` MUST be present (suppresses wt's interactive
//     prompt; rollback runs without a tty).
//   - The worktree basename MUST be a positional argument.
//   - The deprecated `--worktree-name` flag MUST NOT appear.
//
// Spec scenario "argv assertion catches a regression to --worktree-name".
func TestBuildWtDeleteArgs(t *testing.T) {
	got := buildWtDeleteArgs("pacing-canyon")
	want := []string{"delete", "--non-interactive", "pacing-canyon"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("buildWtDeleteArgs(%q) = %v, want %v", "pacing-canyon", got, want)
	}
	for _, tok := range got {
		if tok == "--worktree-name" {
			t.Errorf("argv must not contain deprecated --worktree-name flag: %v", got)
		}
	}
	hasNonInteractive := false
	for _, tok := range got {
		if tok == "--non-interactive" {
			hasNonInteractive = true
			break
		}
	}
	if !hasNonInteractive {
		t.Errorf("argv must contain --non-interactive: %v", got)
	}
}
