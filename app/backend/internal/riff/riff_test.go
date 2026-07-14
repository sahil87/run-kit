package riff

import (
	"context"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

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

// TestBuildSkillShellString asserts the three-layer skill-pane shell string
// composition (the task-injection seam the HTTP endpoint reuses). Pure — no
// tmux/exec. Replaces the old cmd/rk TestBuildNewWindowArgs, which asserted the
// same shell string wrapped in a new-window argv (buildNewWindowArgs was a
// back-compat argv seam not carried into the engine; buildSpawnArgvs /
// buildNewWindowCaptureArgs are the live argv builders and have their own tests).
func TestBuildSkillShellString(t *testing.T) {
	cases := []struct {
		name     string
		launcher string
		cmdArg   string
		want     string
	}{
		{
			name:     "launcher with skill arg",
			launcher: "claude --dangerously-skip-permissions",
			cmdArg:   "/fab-discuss",
			want:     `${SHELL:-/bin/sh} -i -c 'claude --dangerously-skip-permissions '\''/fab-discuss'\'''; exec "${SHELL:-/bin/sh}"`,
		},
		{
			name:     "cmdArg with single quote",
			launcher: "claude",
			cmdArg:   "it's a test",
			want:     `${SHELL:-/bin/sh} -i -c 'claude '\''it'\''\'\'''\''s a test'\'''; exec "${SHELL:-/bin/sh}"`,
		},
		{
			name:     "empty launcher tolerated",
			launcher: "",
			cmdArg:   "/x",
			want:     `${SHELL:-/bin/sh} -i -c ' '\''/x'\'''; exec "${SHELL:-/bin/sh}"`,
		},
		{
			name:     "bare skill (empty cmdArg) — no quoted positional",
			launcher: "claude",
			cmdArg:   "",
			want:     `${SHELL:-/bin/sh} -i -c 'claude'; exec "${SHELL:-/bin/sh}"`,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := buildSkillShellString(tc.launcher, tc.cmdArg)
			if got != tc.want {
				t.Errorf("buildSkillShellString(%q, %q) =\n  %q\nwant\n  %q", tc.launcher, tc.cmdArg, got, tc.want)
			}
		})
	}
}

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
// ResolveLauncher's `fab agent --print` call. Pure — no subprocess. A trimmed
// multi-line result is malformed (a valid session command is one line).
func TestParseFabAgentOutput(t *testing.T) {
	cases := []struct {
		name   string
		stdout string
		err    error
		want   string
		wantOK bool
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

// TestFabAgentArgs covers the pure argv seam: an empty tier drops the positional
// (today's default-tier path), a named tier inserts it before --print.
func TestFabAgentArgs(t *testing.T) {
	cases := []struct {
		name string
		tier string
		want []string
	}{
		{name: "empty tier → no positional", tier: "", want: []string{"agent", "--print"}},
		{name: "named tier → positional", tier: "doing", want: []string{"agent", "doing", "--print"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := fabAgentArgs(tc.tier); !reflect.DeepEqual(got, tc.want) {
				t.Errorf("fabAgentArgs(%q) = %#v, want %#v", tc.tier, got, tc.want)
			}
		})
	}
}

// TestResolveLauncher_StubFab exercises ResolveLauncher end-to-end by staging a
// stub `fab` executable on a temp-dir PATH. Covers the fab-present success path
// (default AND named tier), the non-zero exit fallback, and the fab-absent
// fallback. repoRoot is passed as "" so no Dir is set (the stub ignores cwd).
func TestResolveLauncher_StubFab(t *testing.T) {
	t.Run("stub fab prints launcher (default tier)", func(t *testing.T) {
		want := "stub-launcher --effort xhigh"
		dir := stubFab(t, "#!/bin/sh\nprintf '%s\\n' '"+want+"'\n")
		t.Setenv("PATH", dir)
		if got := ResolveLauncher(context.Background(), "", ""); got != want {
			t.Errorf("ResolveLauncher() = %q, want %q", got, want)
		}
	})

	t.Run("named tier passes the positional to fab", func(t *testing.T) {
		// The stub echoes its args so we can assert the tier positional reaches
		// fab as `agent <tier> --print`.
		dir := stubFab(t, "#!/bin/sh\nprintf 'args: %s\\n' \"$*\"\n")
		t.Setenv("PATH", dir)
		got := ResolveLauncher(context.Background(), "", "doing")
		if want := "args: agent doing --print"; got != want {
			t.Errorf("ResolveLauncher(tier=doing) = %q, want %q", got, want)
		}
	})

	t.Run("stub fab exits non-zero falls back", func(t *testing.T) {
		dir := stubFab(t, "#!/bin/sh\necho boom >&2\nexit 1\n")
		t.Setenv("PATH", dir)
		if got := ResolveLauncher(context.Background(), "", ""); got != DefaultLauncher {
			t.Errorf("ResolveLauncher() = %q, want %q (fallback)", got, DefaultLauncher)
		}
	})

	t.Run("fab absent from PATH falls back", func(t *testing.T) {
		t.Setenv("PATH", t.TempDir())
		if got := ResolveLauncher(context.Background(), "", "doing"); got != DefaultLauncher {
			t.Errorf("ResolveLauncher() = %q, want %q (fallback)", got, DefaultLauncher)
		}
	})
}

// TestBuildWtCreateArgs covers the mockup-v2 --worktree-name passthrough: an
// empty name is byte-identical to the pre-feature argv; a name in worktree mode
// prepends `--worktree-name <name>`; a name in checkout mode is defensively
// ignored (checkout never reaches wt, and the name is rejected at the API).
func TestBuildWtCreateArgs(t *testing.T) {
	cases := []struct {
		name        string
		where       string
		wtName      string
		passthrough []string
		want        []string
	}{
		{
			name: "no name → byte-identical pre-feature argv",
			want: []string{"create", "--non-interactive", "--worktree-open", "skip"},
		},
		{
			name:   "worktree mode with name",
			where:  "worktree",
			wtName: "my-agent",
			want:   []string{"create", "--worktree-name", "my-agent", "--non-interactive", "--worktree-open", "skip"},
		},
		{
			name:        "name + passthrough",
			where:       "worktree",
			wtName:      "my-agent",
			passthrough: []string{"--base", "main"},
			want:        []string{"create", "--worktree-name", "my-agent", "--non-interactive", "--worktree-open", "skip", "--base", "main"},
		},
		{
			name:   "checkout mode ignores name",
			where:  "checkout",
			wtName: "ignored",
			want:   []string{"create", "--non-interactive", "--worktree-open", "skip"},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			spec := EffectiveSpec{Where: tc.where, WorktreeName: tc.wtName}
			got := buildWtCreateArgs(spec, tc.passthrough)
			if !reflect.DeepEqual(got, tc.want) {
				t.Errorf("buildWtCreateArgs() = %#v\nwant %#v", got, tc.want)
			}
		})
	}
}

// stubFab writes an executable `fab` script into a fresh temp dir and returns
// that dir (suitable as a PATH override).
func stubFab(t *testing.T, script string) string {
	t.Helper()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "fab"), []byte(script), 0o755); err != nil {
		t.Fatalf("WriteFile stub fab: %v", err)
	}
	return dir
}

// writeStub writes an executable script named `name` into `dir`.
func writeStub(t *testing.T, dir, name, script string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, name), []byte(script), 0o755); err != nil {
		t.Fatalf("WriteFile stub %s: %v", name, err)
	}
}

// TestSpawn_WhereModes exercises the Spawn isolation branch end-to-end against
// stub `wt`/`tmux`/`fab` executables on a temp-dir PATH. It asserts the two facts
// the checkout branch (T003/T010) is responsible for:
//
//   - checkout mode issues NO `wt` call (the stub wt fails the test if invoked)
//     and roots the window at opts.RepoRoot with base `riff-<repoRoot-basename>`;
//   - worktree mode DOES invoke `wt create` and roots the window at the
//     wt-reported Path with base `riff-<worktree-basename>`.
//
// The stub tmux logs its `new-window` argv so the test reads back the `-n <name>`
// (base) and `-c <root>` (working dir) the engine chose. Server is "" so tmux
// argv carries no `-L` prefix; a single bare skill pane means only new-window +
// select-pane + display-message run (no split/select-layout).
func TestSpawn_WhereModes(t *testing.T) {
	t.Run("checkout mode skips wt and roots at repoRoot", func(t *testing.T) {
		dir := t.TempDir()
		repoRoot := filepath.Join(t.TempDir(), "my-checkout")
		if err := os.MkdirAll(repoRoot, 0o755); err != nil {
			t.Fatalf("mkdir repoRoot: %v", err)
		}
		newWindowLog := filepath.Join(dir, "new-window.log")

		// wt MUST NOT be invoked in checkout mode — if it is, mark a sentinel the
		// test asserts against (a non-zero exit alone would surface as a spawn
		// error, but the explicit marker names the violation clearly). The marker
		// is written via shell redirection, not `touch` — PATH is restricted to
		// the stub dir, so external commands are unavailable inside the stubs.
		wtCalled := filepath.Join(dir, "wt-called")
		writeStub(t, dir, "wt", "#!/bin/sh\n: > "+wtCalled+"\necho 'wt should not be called in checkout mode' >&2\nexit 1\n")
		writeStub(t, dir, "tmux", stubTmuxScript(newWindowLog))
		// fab resolves the launcher; a plain single-line print keeps ResolveLauncher happy.
		writeStub(t, dir, "fab", "#!/bin/sh\necho 'claude'\n")
		t.Setenv("PATH", dir)

		res, err := Spawn(context.Background(), Options{
			Server:   "", // CLI-style targeting so tmux argv has no -L prefix
			Session:  "",
			RepoRoot: repoRoot,
			Where:    "checkout",
		})
		if err != nil {
			t.Fatalf("Spawn(checkout) error: %v", err)
		}
		if _, statErr := os.Stat(wtCalled); statErr == nil {
			t.Error("checkout mode invoked wt create; it must skip wt entirely")
		}
		gotName, gotRoot := readNewWindowArgs(t, newWindowLog)
		if want := "riff-my-checkout"; gotName != want {
			t.Errorf("checkout window name (base) = %q, want %q", gotName, want)
		}
		if gotRoot != repoRoot {
			t.Errorf("checkout window root (-c) = %q, want repoRoot %q", gotRoot, repoRoot)
		}
		if res.WindowName != "riff-my-checkout" {
			t.Errorf("Result.WindowName = %q, want riff-my-checkout", res.WindowName)
		}
	})

	t.Run("worktree mode invokes wt and roots at the wt path", func(t *testing.T) {
		dir := t.TempDir()
		repoRoot := t.TempDir()
		worktree := filepath.Join(t.TempDir(), "swift-fox")
		if err := os.MkdirAll(worktree, 0o755); err != nil {
			t.Fatalf("mkdir worktree: %v", err)
		}
		newWindowLog := filepath.Join(dir, "new-window.log")
		wtCalled := filepath.Join(dir, "wt-called")

		// wt create prints the `Path:` line the engine parses for the window root.
		// The marker uses shell redirection (not `touch`) — PATH is stub-only.
		writeStub(t, dir, "wt", "#!/bin/sh\n: > "+wtCalled+"\nprintf 'Path: %s\\n' '"+worktree+"'\n")
		writeStub(t, dir, "tmux", stubTmuxScript(newWindowLog))
		writeStub(t, dir, "fab", "#!/bin/sh\necho 'claude'\n")
		t.Setenv("PATH", dir)

		res, err := Spawn(context.Background(), Options{
			RepoRoot: repoRoot,
			Where:    "worktree",
		})
		if err != nil {
			t.Fatalf("Spawn(worktree) error: %v", err)
		}
		if _, statErr := os.Stat(wtCalled); statErr != nil {
			t.Error("worktree mode did not invoke wt create")
		}
		gotName, gotRoot := readNewWindowArgs(t, newWindowLog)
		if want := "riff-swift-fox"; gotName != want {
			t.Errorf("worktree window name (base) = %q, want %q", gotName, want)
		}
		if gotRoot != worktree {
			t.Errorf("worktree window root (-c) = %q, want the wt path %q", gotRoot, worktree)
		}
		if res.WindowName != "riff-swift-fox" {
			t.Errorf("Result.WindowName = %q, want riff-swift-fox", res.WindowName)
		}
	})
}

// stubTmuxScript returns a `tmux` stub that satisfies the single-bare-skill-pane
// spawn sequence (list-windows → new-window -P → select-pane → display-message)
// and appends the `new-window` invocation's args to newWindowLog so the test can
// read back the chosen -n/-c values. Any unhandled subcommand exits 0 (a no-op)
// so a future extra tmux call never wedges the test on this stub.
func stubTmuxScript(newWindowLog string) string {
	return "#!/bin/sh\n" +
		"case \"$1\" in\n" +
		"  list-windows) exit 0 ;;\n" + // no existing windows → base is free
		"  new-window) printf '%s\\n' \"$*\" >> " + newWindowLog + "; echo '%1' ;;\n" +
		"  select-pane) exit 0 ;;\n" +
		"  display-message) echo '@7' ;;\n" +
		"  *) exit 0 ;;\n" +
		"esac\n"
}

// readNewWindowArgs parses the stub tmux new-window log and returns the value
// following `-n` (the window name/base) and the value following `-c` (the working
// dir). The logged line is the space-joined `$*` of the new-window invocation.
func readNewWindowArgs(t *testing.T, logPath string) (name, root string) {
	t.Helper()
	data, err := os.ReadFile(logPath)
	if err != nil {
		t.Fatalf("read new-window log: %v", err)
	}
	fields := strings.Fields(strings.TrimSpace(string(data)))
	// Take the FIRST occurrence of each flag: the engine emits `-n <base>` and
	// `-c <root>` BEFORE the trailing shell-string positional, which itself
	// contains a `-c` (`… -i -c 'claude' …`) that a last-wins scan would pick up.
	for i := 0; i < len(fields)-1; i++ {
		if fields[i] == "-n" && name == "" {
			name = fields[i+1]
		}
		if fields[i] == "-c" && root == "" {
			root = fields[i+1]
		}
	}
	if name == "" || root == "" {
		t.Fatalf("new-window log missing -n/-c: %q", string(data))
	}
	return name, root
}

// TestResolveLayout covers canonical-name passthrough, shortform resolution, and
// unknown-value error rules.
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
			got, err := ResolveLayout(tc.in)
			if tc.wantError {
				if err == nil {
					t.Fatalf("expected error, got nil (got = %q)", got)
				}
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
				t.Errorf("ResolveLayout(%q) = %q, want %q", tc.in, got, tc.want)
			}
		})
	}
}

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

// TestResolveActivePreset covers positional match, positional non-match,
// --preset resolution, conflict, unknown preset, and no-preset-available.
func TestResolveActivePreset(t *testing.T) {
	presets := map[string]fabconfig.Preset{
		"ship":        {Layout: "deck-h"},
		"investigate": {Layout: "v"},
	}
	t.Run("positional match consumes arg", func(t *testing.T) {
		p, rem, err := ResolveActivePreset([]string{"ship", "--", "--base", "main"}, "ship", "", presets)
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
		p, rem, err := ResolveActivePreset([]string{"nosuch"}, "nosuch", "", presets)
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
		p, _, err := ResolveActivePreset(nil, "", "investigate", presets)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if p == nil || p.Layout != "v" {
			t.Errorf("preset = %#v, want investigate", p)
		}
	})
	t.Run("conflict positional + --preset", func(t *testing.T) {
		_, _, err := ResolveActivePreset([]string{"ship"}, "ship", "investigate", presets)
		if err == nil {
			t.Fatalf("expected error, got nil")
		}
		if !strings.Contains(err.Error(), "mutually exclusive") {
			t.Errorf("error missing 'mutually exclusive': %v", err)
		}
	})
	t.Run("unknown preset via --preset", func(t *testing.T) {
		_, _, err := ResolveActivePreset(nil, "", "nope", presets)
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
		p, rem, err := ResolveActivePreset([]string{"ship"}, "ship", "", nil)
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
		spec, err := ResolveEffectiveSpec(nil, false, "auto", 1, preset, nil)
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
		spec, err := ResolveEffectiveSpec(cli, false, "auto", 1, preset, nil)
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
		spec, err := ResolveEffectiveSpec(nil, true, "even-vertical", 1, preset, nil)
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
		spec, err := ResolveEffectiveSpec(nil, true, "auto", 1, preset, nil)
		if err != nil {
			t.Fatalf("err: %v", err)
		}
		if spec.Layout != "even-horizontal" {
			t.Errorf("layout = %q, want even-horizontal (auto for 2 panes)", spec.Layout)
		}
	})
	t.Run("single-pane window suppresses layout regardless of source", func(t *testing.T) {
		cli := []PaneSpec{{Kind: PaneKindSkill, Value: "/fab-fff"}}
		spec, err := ResolveEffectiveSpec(cli, true, "main-horizontal", 1, nil, nil)
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
		spec, err := ResolveEffectiveSpec(nil, false, "auto", 1, preset, nil)
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
		spec, err := ResolveEffectiveSpec(nil, false, "auto", 1, preset, nil)
		if err != nil {
			t.Fatalf("err: %v", err)
		}
		if spec.Layout != "main-horizontal" {
			t.Errorf("layout = %q, want main-horizontal (canonical of deck-h)", spec.Layout)
		}
	})
	t.Run("preset wt_args prepended to passthrough", func(t *testing.T) {
		preset := &fabconfig.Preset{WtArgs: []string{"--base", "main"}}
		spec, err := ResolveEffectiveSpec(nil, false, "auto", 1, preset, []string{"--reuse"})
		if err != nil {
			t.Fatalf("err: %v", err)
		}
		want := []string{"--base", "main", "--reuse"}
		if !reflect.DeepEqual(spec.Passthrough, want) {
			t.Errorf("passthrough = %v, want %v", spec.Passthrough, want)
		}
	})
	t.Run("no panes anywhere defaults to single /fab-discuss pane", func(t *testing.T) {
		spec, err := ResolveEffectiveSpec(nil, false, "auto", 1, nil, nil)
		if err != nil {
			t.Fatalf("err: %v", err)
		}
		want := []PaneSpec{{Kind: PaneKindSkill, Value: DefaultRiffSkill}}
		if !reflect.DeepEqual(spec.Panes, want) {
			t.Errorf("panes = %#v, want %#v", spec.Panes, want)
		}
	})
	t.Run("count respects CLI value", func(t *testing.T) {
		spec, err := ResolveEffectiveSpec(nil, false, "auto", 5, nil, nil)
		if err != nil {
			t.Fatalf("err: %v", err)
		}
		if spec.Count != 5 {
			t.Errorf("count = %d, want 5", spec.Count)
		}
	})
}

// TestComposePanes covers the endpoint's (task, preset) → CLI-pane mapping — in
// particular the blank-agent-vs-/fab-discuss distinction the CLI default does
// NOT share. A nil result means "defer to preset/default"; a non-nil result
// means "these panes replace the preset's".
func TestComposePanes(t *testing.T) {
	presetWithPanes := &fabconfig.Preset{
		Panes: []fabconfig.PaneSpec{
			{Kind: fabconfig.PaneKindSkill, Skill: "/fab-fff"},
			{Kind: fabconfig.PaneKindCmd, Cmd: "just dev"},
		},
	}
	emptyPreset := &fabconfig.Preset{}

	cases := []struct {
		name   string
		task   string
		preset *fabconfig.Preset
		want   []PaneSpec
	}{
		{
			name: "task only → single task skill pane",
			task: "fix the bug",
			want: []PaneSpec{{Kind: PaneKindSkill, Value: "fix the bug"}},
		},
		{
			name:   "task + preset → task pane replaces preset panes",
			task:   "ship it",
			preset: presetWithPanes,
			want:   []PaneSpec{{Kind: PaneKindSkill, Value: "ship it"}},
		},
		{
			name:   "empty task + preset with panes → nil (defer to preset panes)",
			task:   "",
			preset: presetWithPanes,
			want:   nil,
		},
		{
			name: "empty task + no preset → single BARE skill pane (blank agent, NOT /fab-discuss)",
			task: "",
			want: []PaneSpec{{Kind: PaneKindSkill, Value: ""}},
		},
		{
			name:   "empty task + preset with no panes → single BARE skill pane",
			task:   "",
			preset: emptyPreset,
			want:   []PaneSpec{{Kind: PaneKindSkill, Value: ""}},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := composePanes(tc.task, tc.preset)
			if !reflect.DeepEqual(got, tc.want) {
				t.Errorf("composePanes(%q, %v) = %#v, want %#v", tc.task, tc.preset, got, tc.want)
			}
			// Guard the blank-agent invariant explicitly: the endpoint's default
			// pane must never be the CLI's /fab-discuss fallback.
			for _, p := range got {
				if p.Value == DefaultRiffSkill {
					t.Errorf("composePanes must not emit the CLI /fab-discuss default; got %#v", got)
				}
			}
		})
	}
}

// TestBuildSpawnArgvs exercises the pure argv-construction helper. select-pane
// is no longer emitted by buildSpawnArgvs — it is constructed at runtime by the
// orchestrator from the captured pane id. The server prefix is NOT included
// here either (tmuxArgv adds it at exec time).
func TestBuildSpawnArgvs(t *testing.T) {
	worktree := "/tmp/wt/alpha"
	name := "riff-alpha"
	launcher := "claude"

	t.Run("single skill pane (auto layout → no select-layout)", func(t *testing.T) {
		spec := EffectiveSpec{
			Panes:    []PaneSpec{{Kind: PaneKindSkill, Value: "/fab-discuss"}},
			Layout:   "",
			Launcher: launcher,
		}
		got := buildSpawnArgvs(worktree, name, spec)
		if len(got) != 1 {
			t.Fatalf("got %d argvs, want 1 (new-window only)", len(got))
		}
		if got[0][0] != "new-window" {
			t.Errorf("argv[0][0] = %q, want new-window", got[0][0])
		}
		for _, argv := range got {
			if argv[0] == "select-pane" {
				t.Errorf("buildSpawnArgvs unexpectedly returned a select-pane row: %v", argv)
			}
		}
	})

	t.Run("2 panes (skill + cmd) with auto → even-horizontal", func(t *testing.T) {
		spec := EffectiveSpec{
			Panes: []PaneSpec{
				{Kind: PaneKindSkill, Value: "/a"},
				{Kind: PaneKindCmd, Value: "just dev"},
			},
			Layout:   "even-horizontal",
			Launcher: launcher,
		}
		got := buildSpawnArgvs(worktree, name, spec)
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
		cmdShell := got[1][len(got[1])-1]
		if !strings.Contains(cmdShell, "just dev") {
			t.Errorf("split-window shell string missing 'just dev': %q", cmdShell)
		}
		if strings.Contains(cmdShell, "${SHELL:-/bin/sh} -i -c") {
			t.Errorf("split-window cmd pane should NOT have interactive wrap: %q", cmdShell)
		}
	})

	t.Run("4 panes interleaved with tiled", func(t *testing.T) {
		spec := EffectiveSpec{
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
		if len(got) != 5 {
			t.Fatalf("got %d argvs, want 5", len(got))
		}
		pane0 := got[0][len(got[0])-1]
		if !strings.Contains(pane0, `exec "${SHELL:-/bin/sh}"`) {
			t.Errorf("pane 0 bare-cmd shell string = %q", pane0)
		}
		pane3 := got[3][len(got[3])-1]
		if !strings.Contains(pane3, "${SHELL:-/bin/sh} -i -c 'claude'") {
			t.Errorf("pane 3 bare-skill shell missing interactive wrap around bare launcher: %q", pane3)
		}
	})

	t.Run("bare --skill alone", func(t *testing.T) {
		spec := EffectiveSpec{
			Panes:    []PaneSpec{{Kind: PaneKindSkill, Value: ""}},
			Layout:   "",
			Launcher: launcher,
		}
		got := buildSpawnArgvs(worktree, name, spec)
		if len(got) != 1 {
			t.Fatalf("got %d argvs, want 1", len(got))
		}
		shell := got[0][len(got[0])-1]
		if strings.Contains(shell, "claude '") {
			t.Errorf("bare --skill should NOT produce claude '<arg>': %q", shell)
		}
	})

	t.Run("bare --cmd alone", func(t *testing.T) {
		spec := EffectiveSpec{
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

	t.Run("daemon path (session → -t <session> on new-window, <session>:<name> on split/layout)", func(t *testing.T) {
		spec := EffectiveSpec{
			Panes: []PaneSpec{
				{Kind: PaneKindSkill, Value: "/a"},
				{Kind: PaneKindCmd, Value: "just dev"},
			},
			Layout:   "even-horizontal",
			Launcher: launcher,
			Session:  "work",
		}
		got := buildSpawnArgvs(worktree, name, spec)
		if len(got) != 3 {
			t.Fatalf("got %d argvs, want 3 (new-window + split-window + select-layout)", len(got))
		}
		// new-window carries `-t work` so the window lands in the requested session.
		wantNewWindow := []string{
			"new-window",
			"-t", "work",
			"-n", name,
			"-c", worktree,
			paneShellString(launcher, spec.Panes[0]),
		}
		if !reflect.DeepEqual(got[0], wantNewWindow) {
			t.Errorf("new-window argv =\n  %#v\nwant\n  %#v", got[0], wantNewWindow)
		}
		// split-window + select-layout target the session-scoped window `work:<name>`.
		wantSplit := []string{
			"split-window",
			"-h",
			"-t", "work:" + name,
			"-c", worktree,
			paneShellString(launcher, spec.Panes[1]),
		}
		if !reflect.DeepEqual(got[1], wantSplit) {
			t.Errorf("split-window argv =\n  %#v\nwant\n  %#v", got[1], wantSplit)
		}
		wantLayout := []string{"select-layout", "-t", "work:" + name, "even-horizontal"}
		if !reflect.DeepEqual(got[2], wantLayout) {
			t.Errorf("select-layout argv =\n  %#v\nwant\n  %#v", got[2], wantLayout)
		}
	})
}

// TestPlanFanOutRollback exercises the pure rollback-plan builder.
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
	t.Run("no failures — plan includes all (caller shouldn't invoke)", func(t *testing.T) {
		results := []fanOutResult{
			{Index: 0, WorktreePath: "/tmp/wt/a", WindowName: "riff-a", Err: nil},
		}
		plan := planFanOutRollback(results, -1)
		if len(plan.Worktrees) != 1 || plan.Worktrees[0] != "a" {
			t.Errorf("worktrees = %v", plan.Worktrees)
		}
	})
}

var errTestFail = &ExitCodeError{Code: ExitSubprocess, Msg: "test"}

// TestParsePaneID covers the trimmed-single-line parse rule for the stdout of
// `tmux new-window -P -F '#{pane_id}'`. Pure.
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
// `tmux new-window -P -F '#{pane_id}' …` for the first-pane capture step. Pure.
func TestBuildNewWindowCaptureArgs(t *testing.T) {
	shell := `${SHELL:-/bin/sh} -i -c 'claude '\''/fab-discuss'\'''; exec "${SHELL:-/bin/sh}"`

	t.Run("CLI path (empty session → no -t target)", func(t *testing.T) {
		spec := EffectiveSpec{
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
			shell,
		}
		if !reflect.DeepEqual(got, want) {
			t.Errorf("buildNewWindowCaptureArgs =\n  %#v\nwant\n  %#v", got, want)
		}
	})

	t.Run("daemon path (session → -t <session> creates window in it)", func(t *testing.T) {
		spec := EffectiveSpec{
			Panes:    []PaneSpec{{Kind: PaneKindSkill, Value: "/fab-discuss"}},
			Layout:   "",
			Launcher: "claude",
			Session:  "work",
		}
		got := buildNewWindowCaptureArgs("/tmp/wt/alpha", "riff-alpha", spec)
		want := []string{
			"new-window",
			"-P",
			"-F", "#{pane_id}",
			"-t", "work",
			"-n", "riff-alpha",
			"-c", "/tmp/wt/alpha",
			shell,
		}
		if !reflect.DeepEqual(got, want) {
			t.Errorf("buildNewWindowCaptureArgs =\n  %#v\nwant\n  %#v", got, want)
		}
	})
}

// TestBuildWtDeleteArgs asserts the argv shape for the rollback `wt delete`
// subprocess: `--non-interactive` present, name positional, no deprecated
// `--worktree-name`.
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

// TestTmuxArgv asserts the server-prefix seam: an empty server label adds no
// `-L` prefix (CLI path, targeting via restored $TMUX), a non-empty label
// prepends `-L <server>` (daemon path).
func TestTmuxArgv(t *testing.T) {
	t.Run("empty server → no prefix", func(t *testing.T) {
		got := tmuxArgv(EffectiveSpec{Server: ""}, "list-windows", "-F", "#W")
		want := []string{"list-windows", "-F", "#W"}
		if !reflect.DeepEqual(got, want) {
			t.Errorf("tmuxArgv(empty) = %v, want %v", got, want)
		}
	})
	t.Run("non-empty server → -L prefix", func(t *testing.T) {
		got := tmuxArgv(EffectiveSpec{Server: "myserver"}, "list-windows")
		want := []string{"-L", "myserver", "list-windows"}
		if !reflect.DeepEqual(got, want) {
			t.Errorf("tmuxArgv(myserver) = %v, want %v", got, want)
		}
	})
}
