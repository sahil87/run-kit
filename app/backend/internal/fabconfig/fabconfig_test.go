package fabconfig

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

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
				writeFabConfig(t, root, "agent:\n    tiers:\n        default:\n            model: claude\n")
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

func TestReadTiers(t *testing.T) {
	builtins := []string{"default", "doing", "fast", "operator", "review"}

	cases := []struct {
		name    string
		writeFn func(t *testing.T, root string)
		want    []string
	}{
		{
			name:    "no config → built-ins only",
			writeFn: func(t *testing.T, root string) {},
			want:    builtins,
		},
		{
			name: "no agent block → built-ins only",
			writeFn: func(t *testing.T, root string) {
				writeFabConfig(t, root, "project:\n    name: x\n")
			},
			want: builtins,
		},
		{
			name: "no agent.tiers block → built-ins only",
			writeFn: func(t *testing.T, root string) {
				writeFabConfig(t, root, "agent:\n    something: else\n")
			},
			want: builtins,
		},
		{
			name: "malformed yaml → built-ins only",
			writeFn: func(t *testing.T, root string) {
				writeFabConfig(t, root, "agent:\n  tiers:\n    - not a map\n  : broken\n")
			},
			want: builtins,
		},
		{
			name: "config-only names appended in source order, deduped",
			writeFn: func(t *testing.T, root string) {
				// default+doing overlap the built-ins (deduped); custom+extra are new
				// and appended in YAML source order after the built-ins.
				writeFabConfig(t, root, `agent:
    tiers:
        default: {model: a}
        custom: {model: b}
        doing: {model: c}
        extra: {model: d}
`)
			},
			want: []string{"default", "doing", "fast", "operator", "review", "custom", "extra"},
		},
		{
			name: "only overlapping names → built-ins unchanged",
			writeFn: func(t *testing.T, root string) {
				writeFabConfig(t, root, `agent:
    tiers:
        doing: {model: a}
        review: {model: b}
`)
			},
			want: builtins,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			root := t.TempDir()
			tc.writeFn(t, root)
			got := ReadTiers(root)
			if !reflect.DeepEqual(got, tc.want) {
				t.Errorf("ReadTiers() = %#v\nwant %#v", got, tc.want)
			}
		})
	}
}

func TestReadTiers_EmptyRoot(t *testing.T) {
	got := ReadTiers("")
	want := []string{"default", "doing", "fast", "operator", "review"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("ReadTiers(\"\") = %#v, want %#v (built-ins)", got, want)
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

func TestIsFabProject(t *testing.T) {
	t.Run("present config → true", func(t *testing.T) {
		root := t.TempDir()
		writeFabConfig(t, root, "project:\n    name: x\n")
		if !IsFabProject(root) {
			t.Error("IsFabProject with a present config.yaml = false, want true")
		}
	})
	t.Run("even a malformed-but-present config → true", func(t *testing.T) {
		root := t.TempDir()
		writeFabConfig(t, root, "this: is: not: valid: yaml: [\n")
		// Presence, not validity, is the question — a fab project with a broken
		// config still resolves tiers via ReadTiers's built-ins fallback.
		if !IsFabProject(root) {
			t.Error("IsFabProject with a malformed-but-present config.yaml = false, want true")
		}
	})
	t.Run("absent config → false", func(t *testing.T) {
		root := t.TempDir() // no fab/project/config.yaml
		if IsFabProject(root) {
			t.Error("IsFabProject with no config.yaml = true, want false")
		}
	})
	t.Run("empty root → false", func(t *testing.T) {
		if IsFabProject("") {
			t.Error("IsFabProject(\"\") = true, want false")
		}
	})
}
