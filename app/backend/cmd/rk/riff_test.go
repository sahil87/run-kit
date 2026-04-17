package main

import (
	"os"
	"path/filepath"
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

// TestResolveLauncher_FromWorktreeCwd exercises resolveLauncher by chdir'ing
// into a staged repo root. The staged repo contains an embedded git marker
// (a .git directory) and fab/project/config.yaml so FindGitRoot + ReadSpawnCommand
// can both succeed.
func TestResolveLauncher(t *testing.T) {
	cases := []struct {
		name       string
		setup      func(t *testing.T, root string)
		withChdir  bool
		want       string
	}{
		{
			name: "config present with spawn_command returns value",
			setup: func(t *testing.T, root string) {
				writeGitDir(t, root)
				writeFabConfig(t, root, "agent:\n    spawn_command: custom-launcher --flag\n")
			},
			withChdir: true,
			want:      "custom-launcher --flag",
		},
		{
			name: "config missing key returns fallback",
			setup: func(t *testing.T, root string) {
				writeGitDir(t, root)
				writeFabConfig(t, root, "agent:\n    other_key: value\n")
			},
			withChdir: true,
			want:      defaultLauncher,
		},
		{
			name: "empty spawn_command returns fallback",
			setup: func(t *testing.T, root string) {
				writeGitDir(t, root)
				writeFabConfig(t, root, "agent:\n    spawn_command: \"\"\n")
			},
			withChdir: true,
			want:      defaultLauncher,
		},
		{
			name: "no git repo returns fallback",
			setup: func(t *testing.T, root string) {
				// Intentionally no .git — walking up from root won't find one.
				writeFabConfig(t, root, "agent:\n    spawn_command: never-read\n")
			},
			withChdir: true,
			want:      defaultLauncher,
		},
		{
			name: "config file missing returns fallback",
			setup: func(t *testing.T, root string) {
				writeGitDir(t, root)
				// no fab/project/config.yaml written
			},
			withChdir: true,
			want:      defaultLauncher,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			root := t.TempDir()
			// When the test case says "no git repo", we need to guarantee the
			// ancestor chain doesn't contain one either — use a subdir of root
			// that the tempdir parent-walk eventually exits without finding .git.
			// TempDir itself is not a git repo on sandbox envs, so using root
			// directly is safe.
			tc.setup(t, root)
			if tc.withChdir {
				restore := chdir(t, root)
				defer restore()
			}
			got := resolveLauncher()
			if got != tc.want {
				t.Errorf("resolveLauncher() = %q, want %q", got, tc.want)
			}
		})
	}
}

// TestResolveLauncher_ReadsFromSubdir verifies that launcher resolution works
// when cwd is a nested subdirectory — FindGitRoot walks up to find the repo.
func TestResolveLauncher_ReadsFromSubdir(t *testing.T) {
	root := t.TempDir()
	writeGitDir(t, root)
	writeFabConfig(t, root, "agent:\n    spawn_command: from-subdir-launcher\n")

	sub := filepath.Join(root, "app", "frontend", "src")
	if err := os.MkdirAll(sub, 0o755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	restore := chdir(t, sub)
	defer restore()

	got := resolveLauncher()
	if got != "from-subdir-launcher" {
		t.Errorf("resolveLauncher() from subdir = %q, want %q", got, "from-subdir-launcher")
	}
}

// TestFabconfigIntegration is a lightweight check that resolveLauncher's
// wiring matches fabconfig.ReadSpawnCommand — if ReadSpawnCommand ever
// changes its behavior, resolveLauncher should inherit that change.
func TestFabconfigIntegration(t *testing.T) {
	root := t.TempDir()
	writeFabConfig(t, root, "agent:\n    spawn_command: integration-test\n")
	if got := fabconfig.ReadSpawnCommand(root); got != "integration-test" {
		t.Fatalf("ReadSpawnCommand() = %q, want %q", got, "integration-test")
	}
}

// writeGitDir creates a minimal .git directory so config.FindGitRoot will
// treat root as the repo root.
func writeGitDir(t *testing.T, root string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Join(root, ".git"), 0o755); err != nil {
		t.Fatalf("MkdirAll .git: %v", err)
	}
}

// writeFabConfig writes YAML content to <root>/fab/project/config.yaml.
func writeFabConfig(t *testing.T, root, content string) {
	t.Helper()
	dir := filepath.Join(root, "fab", "project")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "config.yaml"), []byte(content), 0o644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}
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
