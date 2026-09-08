package transcript

import (
	"os"
	"path/filepath"
	"testing"
)

// TestCodexRefGuard: a non-UUID ref is rejected before any filesystem access.
func TestCodexRefGuard(t *testing.T) {
	bad := []string{
		"../../etc/passwd",
		"not-a-uuid",
		"1a06319-6a63-7791-84df-86736cd58e2", // too short
		"*",
		"",
		"01a06319-6a63-7791-84df-86736cd58e2e/..",
	}
	for _, ref := range bad {
		if _, err := Path("codex", ref); err != ErrInvalidRef {
			t.Errorf("Path(codex, %q) err = %v, want ErrInvalidRef", ref, err)
		}
	}
}

// TestCodexPathFromDisk: a valid ref resolves through the fixed-depth
// sessions/YYYY/MM/DD layout under an isolated $CODEX_HOME (the ref is folded
// to lowercase — Codex writes lowercase-UUID filenames).
func TestCodexPathFromDisk(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("CODEX_HOME", dir)
	ref := "01a06319-6a63-7791-84df-86736cd58e2e"

	if _, err := Path("codex", ref); err != ErrTranscriptNotFound {
		t.Errorf("missing transcript err = %v, want ErrTranscriptNotFound", err)
	}

	dayDir := filepath.Join(dir, "sessions", "2026", "09", "09")
	if err := os.MkdirAll(dayDir, 0o755); err != nil {
		t.Fatal(err)
	}
	want := filepath.Join(dayDir, "rollout-2026-09-09T10-00-00-"+ref+".jsonl")
	if err := os.WriteFile(want, []byte("{}\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	got, err := Path("codex", ref)
	if err != nil {
		t.Fatalf("Path: %v", err)
	}
	if got != want {
		t.Errorf("Path = %q, want %q", got, want)
	}

	// A rollout for a DIFFERENT session must never resolve for this ref.
	other := filepath.Join(dayDir, "rollout-2026-09-09T11-00-00-02b17420-7c74-8892-95e0-97847de69f3f.jsonl")
	if err := os.WriteFile(other, []byte("{}\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := Path("codex", "03c28531-8d85-9903-a6f1-a7958ef80a04"); err != ErrTranscriptNotFound {
		t.Errorf("unrelated rollout err = %v, want ErrTranscriptNotFound", err)
	}
}
