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
	"rk/internal/riff"
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
		if err := printPresets(map[string]fabconfig.Preset{}, &buf); err != nil {
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
		if err := printPresets(presets, &buf); err != nil {
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
