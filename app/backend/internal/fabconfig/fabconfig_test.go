package fabconfig

import (
	"os"
	"path/filepath"
	"testing"
)

func TestReadSpawnCommand(t *testing.T) {
	cases := []struct {
		name    string
		writeFn func(t *testing.T, root string)
		want    string
	}{
		{
			name: "key present returns value verbatim",
			writeFn: func(t *testing.T, root string) {
				writeFabConfig(t, root, "agent:\n    spawn_command: claude --dangerously-skip-permissions --effort max\n")
			},
			want: "claude --dangerously-skip-permissions --effort max",
		},
		{
			name: "key missing under agent returns empty",
			writeFn: func(t *testing.T, root string) {
				writeFabConfig(t, root, "agent:\n    other_key: value\n")
			},
			want: "",
		},
		{
			name: "agent block absent returns empty",
			writeFn: func(t *testing.T, root string) {
				writeFabConfig(t, root, "fab_version: 1.3.7\nproject:\n    name: demo\n")
			},
			want: "",
		},
		{
			name:    "file absent returns empty",
			writeFn: func(t *testing.T, root string) {},
			want:    "",
		},
		{
			name: "empty string value returns empty",
			writeFn: func(t *testing.T, root string) {
				writeFabConfig(t, root, "agent:\n    spawn_command: \"\"\n")
			},
			want: "",
		},
		{
			name: "whitespace-only value trimmed to empty",
			writeFn: func(t *testing.T, root string) {
				writeFabConfig(t, root, "agent:\n    spawn_command: \"   \"\n")
			},
			want: "",
		},
		{
			name: "malformed YAML returns empty",
			writeFn: func(t *testing.T, root string) {
				writeFabConfig(t, root, "agent: spawn_command: [oops\n")
			},
			want: "",
		},
		{
			name: "complex value with shell substitutions preserved",
			writeFn: func(t *testing.T, root string) {
				writeFabConfig(t, root, "agent:\n    spawn_command: claude --dangerously-skip-permissions --effort max -n \"$(basename \"$(pwd)\")\"\n")
			},
			want: `claude --dangerously-skip-permissions --effort max -n "$(basename "$(pwd)")"`,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			root := t.TempDir()
			tc.writeFn(t, root)
			got := ReadSpawnCommand(root)
			if got != tc.want {
				t.Errorf("ReadSpawnCommand() = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestReadSpawnCommand_EmptyRoot(t *testing.T) {
	if got := ReadSpawnCommand(""); got != "" {
		t.Errorf("ReadSpawnCommand(\"\") = %q, want empty", got)
	}
}

// writeFabConfig writes content to <root>/fab/project/config.yaml, creating
// parent directories as needed. Fails the test on any filesystem error.
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
