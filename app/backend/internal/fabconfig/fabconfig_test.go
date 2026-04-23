package fabconfig

import (
	"os"
	"path/filepath"
	"reflect"
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

func TestReadPresets(t *testing.T) {
	cases := []struct {
		name    string
		writeFn func(t *testing.T, root string)
		want    map[string]Preset
	}{
		{
			name:    "file absent returns empty map",
			writeFn: func(t *testing.T, root string) {},
			want:    map[string]Preset{},
		},
		{
			name: "missing riff block returns empty map",
			writeFn: func(t *testing.T, root string) {
				writeFabConfig(t, root, "agent:\n    spawn_command: claude\n")
			},
			want: map[string]Preset{},
		},
		{
			name: "missing riff.presets block returns empty map",
			writeFn: func(t *testing.T, root string) {
				writeFabConfig(t, root, "riff:\n    other_key: value\n")
			},
			want: map[string]Preset{},
		},
		{
			name: "malformed YAML returns empty map",
			writeFn: func(t *testing.T, root string) {
				writeFabConfig(t, root, "riff: presets: [oops\n")
			},
			want: map[string]Preset{},
		},
		{
			name: "valid preset with layout, panes, wt_args",
			writeFn: func(t *testing.T, root string) {
				writeFabConfig(t, root, `riff:
    presets:
        ship:
            layout: deck-h
            panes:
                - skill: "/fab-fff"
                - cmd: "just dev"
            wt_args:
                - "--base"
                - main
`)
			},
			want: map[string]Preset{
				"ship": {
					Layout: "deck-h",
					Panes: []PaneSpec{
						{Kind: PaneKindSkill, Skill: "/fab-fff"},
						{Kind: PaneKindCmd, Cmd: "just dev"},
					},
					WtArgs: []string{"--base", "main"},
				},
			},
		},
		{
			name: "pane entry with both skill and cmd: containing preset omitted",
			writeFn: func(t *testing.T, root string) {
				writeFabConfig(t, root, `riff:
    presets:
        bad:
            panes:
                - skill: "/fab-fff"
                  cmd: "htop"
        good:
            layout: h
`)
			},
			want: map[string]Preset{
				"good": {Layout: "h"},
			},
		},
		{
			name: "preset with unknown extra keys tolerated",
			writeFn: func(t *testing.T, root string) {
				writeFabConfig(t, root, `riff:
    presets:
        ship:
            layout: t
            unknown_key: some_value
            another: 42
`)
			},
			want: map[string]Preset{
				"ship": {Layout: "t"},
			},
		},
		{
			name: "preset with empty panes list returns valid empty slice",
			writeFn: func(t *testing.T, root string) {
				writeFabConfig(t, root, `riff:
    presets:
        bare:
            layout: auto
            panes: []
`)
			},
			want: map[string]Preset{
				"bare": {Layout: "auto", Panes: []PaneSpec{}},
			},
		},
		{
			name: "multiple presets both parse",
			writeFn: func(t *testing.T, root string) {
				writeFabConfig(t, root, `riff:
    presets:
        ship:
            layout: h
        investigate:
            layout: v
            wt_args:
                - "--reuse"
`)
			},
			want: map[string]Preset{
				"ship":        {Layout: "h"},
				"investigate": {Layout: "v", WtArgs: []string{"--reuse"}},
			},
		},
		{
			name: "nested agent.riff.presets NOT recognized",
			writeFn: func(t *testing.T, root string) {
				writeFabConfig(t, root, `agent:
    riff:
        presets:
            ship:
                layout: h
`)
			},
			want: map[string]Preset{},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			root := t.TempDir()
			tc.writeFn(t, root)
			got := ReadPresets(root)
			if !reflect.DeepEqual(got, tc.want) {
				t.Errorf("ReadPresets() = %#v\nwant %#v", got, tc.want)
			}
		})
	}
}

func TestReadPresets_EmptyRoot(t *testing.T) {
	got := ReadPresets("")
	if len(got) != 0 {
		t.Errorf("ReadPresets(\"\") = %#v, want empty map", got)
	}
}

func TestReadPresetsOrdered_PreservesOrder(t *testing.T) {
	root := t.TempDir()
	writeFabConfig(t, root, `riff:
    presets:
        zulu:
            layout: t
        alpha:
            layout: h
        mike:
            layout: v
`)
	got := ReadPresetsOrdered(root)
	wantOrder := []string{"zulu", "alpha", "mike"}
	if len(got) != len(wantOrder) {
		t.Fatalf("ReadPresetsOrdered() len = %d, want %d", len(got), len(wantOrder))
	}
	for i, want := range wantOrder {
		if got[i].Name != want {
			t.Errorf("ReadPresetsOrdered()[%d].Name = %q, want %q", i, got[i].Name, want)
		}
	}
}
