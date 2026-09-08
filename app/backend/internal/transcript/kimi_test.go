package transcript

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

// writeKimiSession creates the wire.jsonl for a kimi session under root.
func writeKimiSession(t *testing.T, root, wdKey, id string) string {
	t.Helper()
	dir := filepath.Join(root, "sessions", wdKey, id, "agents", "main")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, kimiWireName)
	if err := os.WriteFile(path, []byte("{}\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}

// TestKimiRefGuard: a non-token ref is rejected before any filesystem access.
func TestKimiRefGuard(t *testing.T) {
	for _, ref := range []string{"../x", "has space", "*", "", "session_abc/..", "a/b"} {
		if _, err := Path("kimi", ref); err != ErrInvalidRef {
			t.Errorf("Path(kimi, %q) err = %v, want ErrInvalidRef", ref, err)
		}
	}
}

// TestKimiPathViaIndex: the session_index.jsonl record resolves the ref
// without a directory scan.
func TestKimiPathViaIndex(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("KIMI_CODE_HOME", dir)
	id := "session_551c4391-34fd-4364-9d5a-4a5fccf06d4b"
	sessionDir := filepath.Join(dir, "sessions", "wd_scratchpad_b46bcb2772eb", id)
	want := writeKimiSession(t, dir, "wd_scratchpad_b46bcb2772eb", id)
	index := fmt.Sprintf("{\"sessionId\":%q,\"sessionDir\":%q,\"workDir\":\"/tmp/w\"}\n", id, sessionDir)
	if err := os.WriteFile(filepath.Join(dir, "session_index.jsonl"), []byte(index), 0o644); err != nil {
		t.Fatal(err)
	}
	got, err := Path("kimi", id)
	if err != nil {
		t.Fatalf("Path: %v", err)
	}
	if got != want {
		t.Errorf("Path = %q, want %q", got, want)
	}
}

// TestKimiPathGlobFallback: with no index file the bounded glob still resolves.
func TestKimiPathGlobFallback(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("KIMI_CODE_HOME", dir)
	id := "session_7e92b02c-514a-4b17-b2fa-e3386d6cdadb"
	want := writeKimiSession(t, dir, "wd_other_84e418e3b625", id)
	got, err := Path("kimi", id)
	if err != nil {
		t.Fatalf("Path: %v", err)
	}
	if got != want {
		t.Errorf("Path = %q, want %q", got, want)
	}
}

// TestKimiIndexOutsideRootNotTrusted: an index record pointing outside the
// kimi root is never followed — the lookup degrades to the glob fallback and
// reports not found.
func TestKimiIndexOutsideRootNotTrusted(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("KIMI_CODE_HOME", dir)
	id := "session_evil"
	outside := t.TempDir()
	if err := os.MkdirAll(filepath.Join(outside, "agents", "main"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(outside, "agents", "main", kimiWireName), []byte("{}\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	index := fmt.Sprintf("{\"sessionId\":%q,\"sessionDir\":%q}\n", id, outside)
	if err := os.WriteFile(filepath.Join(dir, "session_index.jsonl"), []byte(index), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := Path("kimi", id); err != ErrTranscriptNotFound {
		t.Errorf("outside-root index record err = %v, want ErrTranscriptNotFound", err)
	}
}
