package archive

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestFlattenSingleRootDir(t *testing.T) {
	t.Run("collapses the wrapper, siblings stay together", func(t *testing.T) {
		dest := t.TempDir()
		inner := filepath.Join(dest, "whisper-bin-ubuntu-x64")
		if err := os.MkdirAll(inner, 0o755); err != nil {
			t.Fatal(err)
		}
		for _, name := range []string{"whisper-cli", "libggml.so"} {
			if err := os.WriteFile(filepath.Join(inner, name), []byte("x"), 0o644); err != nil {
				t.Fatal(err)
			}
		}
		if err := FlattenSingleRootDir(dest); err != nil {
			t.Fatal(err)
		}
		for _, name := range []string{"whisper-cli", "libggml.so"} {
			if _, err := os.Stat(filepath.Join(dest, name)); err != nil {
				t.Errorf("%s missing after flatten: %v", name, err)
			}
		}
	})

	t.Run("flattens exactly one level", func(t *testing.T) {
		dest := t.TempDir()
		inner := filepath.Join(dest, "top", "node_modules")
		if err := os.MkdirAll(inner, 0o755); err != nil {
			t.Fatal(err)
		}
		if err := FlattenSingleRootDir(dest); err != nil {
			t.Fatal(err)
		}
		// node_modules is payload, not wrapping: it must survive as a level.
		if _, err := os.Stat(filepath.Join(dest, "node_modules")); err != nil {
			t.Errorf("node_modules over-flattened: %v", err)
		}
	})

	t.Run("multi-entry roots are left alone", func(t *testing.T) {
		dest := t.TempDir()
		if err := os.WriteFile(filepath.Join(dest, "a"), []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
		if err := os.Mkdir(filepath.Join(dest, "dir"), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := FlattenSingleRootDir(dest); err != nil {
			t.Fatal(err)
		}
		if _, err := os.Stat(filepath.Join(dest, "dir")); err != nil {
			t.Errorf("multi-entry root was flattened: %v", err)
		}
	})

	t.Run("a wrapper-root .. symlink escapes after the move and fails", func(t *testing.T) {
		parent := t.TempDir()
		dest := filepath.Join(parent, "dest")
		inner := filepath.Join(dest, "top")
		if err := os.MkdirAll(inner, 0o755); err != nil {
			t.Fatal(err)
		}
		// Contained while inside the wrapper (top/.. = dest); after the move it
		// resolves to dest's parent — the flatten must refuse.
		if err := os.Symlink("..", filepath.Join(inner, "link")); err != nil {
			t.Fatal(err)
		}
		err := FlattenSingleRootDir(dest)
		if err == nil || !strings.Contains(err.Error(), "refusing symlink") {
			t.Fatalf("err = %v, want the post-flatten symlink refusal", err)
		}
	})

	t.Run("intra-tree relative symlinks survive the move", func(t *testing.T) {
		dest := t.TempDir()
		binDir := filepath.Join(dest, "top", "node_modules", ".bin")
		if err := os.MkdirAll(filepath.Join(dest, "top", "node_modules", "pkg", "bin"), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.MkdirAll(binDir, 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dest, "top", "node_modules", "pkg", "bin", "x.js"), []byte("x"), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.Symlink("../pkg/bin/x.js", filepath.Join(binDir, "x")); err != nil {
			t.Fatal(err)
		}
		if err := FlattenSingleRootDir(dest); err != nil {
			t.Fatalf("intra-tree link must survive: %v", err)
		}
		if _, err := os.Stat(filepath.Join(dest, "node_modules", ".bin", "x")); err != nil {
			t.Errorf("link missing after flatten: %v", err)
		}
	})
}
