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

func TestHasTopLevelKey(t *testing.T) {
	t.Run("key present → true", func(t *testing.T) {
		root := t.TempDir()
		writeFabConfig(t, root, "riff:\n    presets: {}\n")
		if !HasTopLevelKey(root, "riff") {
			t.Error("HasTopLevelKey(riff) = false, want true")
		}
	})
	t.Run("key absent → false", func(t *testing.T) {
		root := t.TempDir()
		writeFabConfig(t, root, "agent:\n    tiers:\n        custom: {model: b}\n")
		if HasTopLevelKey(root, "riff") {
			t.Error("HasTopLevelKey(riff) = true, want false")
		}
	})
	t.Run("nested key does not count", func(t *testing.T) {
		root := t.TempDir()
		writeFabConfig(t, root, "agent:\n    riff:\n        presets: {}\n")
		if HasTopLevelKey(root, "riff") {
			t.Error("HasTopLevelKey(riff) = true for a nested agent.riff, want false")
		}
	})
	t.Run("malformed yaml → false", func(t *testing.T) {
		root := t.TempDir()
		writeFabConfig(t, root, "this: is: not: valid: yaml: [\n")
		if HasTopLevelKey(root, "riff") {
			t.Error("HasTopLevelKey on malformed yaml = true, want false")
		}
	})
	t.Run("missing file → false", func(t *testing.T) {
		if HasTopLevelKey(t.TempDir(), "riff") {
			t.Error("HasTopLevelKey with no config = true, want false")
		}
	})
	t.Run("empty root → false", func(t *testing.T) {
		if HasTopLevelKey("", "riff") {
			t.Error("HasTopLevelKey(\"\") = true, want false")
		}
	})
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
