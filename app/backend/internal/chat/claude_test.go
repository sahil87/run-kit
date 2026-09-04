package chat

import (
	"os"
	"path/filepath"
	"testing"
)

// TestStrictUUIDGuard: a non-UUID ref is rejected before any filesystem access.
func TestStrictUUIDGuard(t *testing.T) {
	bad := []string{
		"../../etc/passwd",
		"not-a-uuid",
		"5d80479e-8f25-46cd-a0d4-e51435508a", // too short
		"5d80479e_8f25_46cd_a0d4_e51435508a7g",
		"*",
		"",
		"5d80479e-8f25-46cd-a0d4-e51435508a37/..",
	}
	for _, ref := range bad {
		if _, err := locateTranscript(ref); err != ErrInvalidRef {
			t.Errorf("locateTranscript(%q) err = %v, want ErrInvalidRef", ref, err)
		}
	}
}

// TestLookupUnregistered: a well-formed but unregistered provider returns
// ErrNoAdapter; claude is registered.
func TestLookupUnregistered(t *testing.T) {
	if _, err := Lookup("codex"); err != ErrNoAdapter {
		t.Errorf("Lookup(codex) err = %v, want ErrNoAdapter", err)
	}
	if _, err := Lookup(""); err != ErrNoAdapter {
		t.Errorf("Lookup(\"\") err = %v, want ErrNoAdapter", err)
	}
	a, err := Lookup(providerClaude)
	if err != nil || a == nil {
		t.Errorf("Lookup(claude) = %v, %v; want a registered adapter", a, err)
	}
}

// TestTranscriptPathSeam: the package-level TranscriptPath routes through the
// registry to the claude adapter's TranscriptLocator, preserving the strict
// UUID guard in front of every resolution (ErrInvalidRef before ANY filesystem
// access); an unregistered provider yields ErrNoAdapter.
func TestTranscriptPathSeam(t *testing.T) {
	bad := []string{
		"../../etc/passwd",
		"not-a-uuid",
		"/abs/path",
		"*",
		"",
	}
	for _, ref := range bad {
		if _, err := TranscriptPath("claude", ref); err != ErrInvalidRef {
			t.Errorf("TranscriptPath(claude, %q) err = %v, want ErrInvalidRef", ref, err)
		}
	}
	if _, err := TranscriptPath("codex", "5d80479e-8f25-46cd-a0d4-e51435508a37"); err != ErrNoAdapter {
		t.Errorf("TranscriptPath(codex, valid-uuid) err = %v, want ErrNoAdapter", err)
	}
}

// TestTranscriptPathFromDisk: a valid-UUID ref resolves to the absolute path
// of an existing transcript; a valid UUID with no file is
// ErrTranscriptNotFound.
func TestTranscriptPathFromDisk(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("CLAUDE_CONFIG_DIR", dir)
	ref := "5d80479e-8f25-46cd-a0d4-e51435508a37"
	projDir := filepath.Join(dir, "projects", "someproj")
	if err := os.MkdirAll(projDir, 0o755); err != nil {
		t.Fatal(err)
	}

	if _, err := TranscriptPath("claude", ref); err != ErrTranscriptNotFound {
		t.Errorf("missing transcript err = %v, want ErrTranscriptNotFound", err)
	}

	want := filepath.Join(projDir, ref+".jsonl")
	if err := os.WriteFile(want, []byte("{}\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	got, err := TranscriptPath("claude", ref)
	if err != nil {
		t.Fatalf("TranscriptPath: %v", err)
	}
	if got != want {
		t.Errorf("TranscriptPath = %q, want %q", got, want)
	}
}
