package transcript

import (
	"os"
	"path/filepath"
	"testing"
)

// setAgyBrainRoot points the agy brain-root seam at a hermetic dir.
func setAgyBrainRoot(t *testing.T, dir string) {
	t.Helper()
	orig := agyBrainRootFn
	agyBrainRootFn = func() string { return dir }
	t.Cleanup(func() { agyBrainRootFn = orig })
}

// TestAgyRefGuard: a non-UUID ref is rejected before any filesystem access.
func TestAgyRefGuard(t *testing.T) {
	for _, ref := range []string{"../x", "not-a-uuid", "*", "", "ec33ebf9-0cba-4100-8142-c61503f6c587/.."} {
		if _, err := Path("agy", ref); err != ErrInvalidRef {
			t.Errorf("Path(agy, %q) err = %v, want ErrInvalidRef", ref, err)
		}
	}
}

// TestAgyPathFromDisk: the deterministic brain/<id>/ layout resolves; a
// missing transcript is ErrTranscriptNotFound; an uppercased ref folds to the
// lowercase directory name.
func TestAgyPathFromDisk(t *testing.T) {
	dir := t.TempDir()
	setAgyBrainRoot(t, dir)
	ref := "ec33ebf9-0cba-4100-8142-c61503f6c587"

	if _, err := Path("agy", ref); err != ErrTranscriptNotFound {
		t.Errorf("missing transcript err = %v, want ErrTranscriptNotFound", err)
	}

	logDir := filepath.Join(dir, ref, ".system_generated", "logs")
	if err := os.MkdirAll(logDir, 0o755); err != nil {
		t.Fatal(err)
	}
	want := filepath.Join(logDir, "transcript.jsonl")
	if err := os.WriteFile(want, []byte("{}\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	got, err := Path("agy", ref)
	if err != nil {
		t.Fatalf("Path: %v", err)
	}
	if got != want {
		t.Errorf("Path = %q, want %q", got, want)
	}
}
