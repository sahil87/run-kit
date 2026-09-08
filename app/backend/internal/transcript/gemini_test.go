package transcript

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

// setGeminiRoot points the gemini root seam at a hermetic dir.
func setGeminiRoot(t *testing.T, dir string) {
	t.Helper()
	orig := geminiRootFn
	geminiRootFn = func() string { return dir }
	t.Cleanup(func() { geminiRootFn = orig })
}

// writeGeminiChat creates a gemini chat file whose first record carries id.
func writeGeminiChat(t *testing.T, root, slug, id string) string {
	t.Helper()
	dir := filepath.Join(root, "tmp", slug, "chats")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, fmt.Sprintf("session-2026-09-09T10-00-%s.jsonl", id[:8]))
	body := fmt.Sprintf("{\"sessionId\":%q,\"kind\":\"main\"}\n{\"$set\":{}}\n", id)
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}

// TestGeminiRefGuard: a non-UUID ref is rejected before any filesystem access.
func TestGeminiRefGuard(t *testing.T) {
	for _, ref := range []string{"../x", "short", "*", "", "ca00a809-c515-436e-8e9b-6dcff500d131/.."} {
		if _, err := Path("gemini", ref); err != ErrInvalidRef {
			t.Errorf("Path(gemini, %q) err = %v, want ErrInvalidRef", ref, err)
		}
	}
}

// TestGeminiPathFromDisk: the prefix glob finds the file and the first-record
// sessionId verification confirms the full id.
func TestGeminiPathFromDisk(t *testing.T) {
	dir := t.TempDir()
	setGeminiRoot(t, dir)
	ref := "ca00a809-c515-436e-8e9b-6dcff500d131"

	if _, err := Path("gemini", ref); err != ErrTranscriptNotFound {
		t.Errorf("missing transcript err = %v, want ErrTranscriptNotFound", err)
	}

	want := writeGeminiChat(t, dir, "surging-thrush", ref)
	got, err := Path("gemini", ref)
	if err != nil {
		t.Fatalf("Path: %v", err)
	}
	if got != want {
		t.Errorf("Path = %q, want %q", got, want)
	}
}

// TestGeminiPrefixCollisionNotTrusted: a file whose name shares the ref's
// 8-char prefix but whose first record carries a DIFFERENT full id is not a
// match — the transcript is reported not found, never misresolved.
func TestGeminiPrefixCollisionNotTrusted(t *testing.T) {
	dir := t.TempDir()
	setGeminiRoot(t, dir)
	ref := "ca00a809-c515-436e-8e9b-6dcff500d131"
	// Collision: same first 8 hex chars, different full id.
	writeGeminiChat(t, dir, "dawning-serval", "ca00a809-0000-0000-0000-000000000000")
	if _, err := Path("gemini", ref); err != ErrTranscriptNotFound {
		t.Errorf("prefix collision err = %v, want ErrTranscriptNotFound", err)
	}
}
