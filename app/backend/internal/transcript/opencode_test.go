package transcript

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

// nativeOpencodeRef is a native-shaped OpenCode session id: literal `ses_`
// prefix, 12-char lowercase-hex timestamp, 14-char MIXED-CASE base62 tail —
// the exact shape the tagged v1.18.25 id generator (packages/opencode/src/
// id/id.ts: prefix + "_" + 12 hex + randomBase62(14)) produces.
const nativeOpencodeRef = "ses_53fe4a1b2c9dAbCdEfGhIjKlMn"

// nativeOpencodeRefAt renders a native-shaped id for index i (digit tail — a
// valid base62 subset).
func nativeOpencodeRefAt(i int) string {
	return fmt.Sprintf("ses_%012x%014d", i, i)
}

// opencodeExportFixture points the export + dir seams at hermetic stubs.
func opencodeExportFixture(t *testing.T, dir string, export func(context.Context, string) ([]byte, error)) {
	t.Helper()
	origExport, origDir := opencodeExportFn, opencodeExportDirFn
	opencodeExportDirFn = func() (string, error) { return dir, nil }
	opencodeExportFn = export
	t.Cleanup(func() { opencodeExportFn, opencodeExportDirFn = origExport, origDir })
}

// TestOpencodeRefGuard: only the native ses_ shape reaches a subprocess — a
// flag-shaped ref ("--pure") is ErrInvalidRef before anything runs, and a
// MIXED-CASE native id is ACCEPTED (the generator's base62 tail is
// mixed-case; rejecting uppercase would reject ~all real sessions).
func TestOpencodeRefGuard(t *testing.T) {
	for _, ref := range []string{"--pure", "--help", "-x", "../x", "has space", "*", "", "a/b", "session_abc", "SES_UPPER", "ses_tooshort", "ses_53fe4a1b2c9dAbCdEfGhIjK!"} {
		if _, err := Path("opencode", ref); err != ErrInvalidRef {
			t.Errorf("Path(opencode, %q) err = %v, want ErrInvalidRef", ref, err)
		}
	}
	// Positive: the native mixed-case shape passes the guard (resolution then
	// fails on the missing session, not the shape).
	dir := t.TempDir()
	opencodeExportFixture(t, dir, func(context.Context, string) ([]byte, error) {
		return nil, &exec.ExitError{}
	})
	if _, err := Path("opencode", nativeOpencodeRef); !errors.Is(err, ErrTranscriptNotFound) {
		t.Errorf("native mixed-case ref err = %v, want ErrTranscriptNotFound (guard must ACCEPT the shape)", err)
	}
}

// TestOpencodeExportArgsSeparator: the ref rides behind an end-of-options
// separator, so even a hypothetical dash-leading value can never read as flags.
func TestOpencodeExportArgsSeparator(t *testing.T) {
	args := opencodeExportArgs(nativeOpencodeRef)
	want := []string{"export", "--sanitize", "--", nativeOpencodeRef}
	if strings.Join(args, " ") != strings.Join(want, " ") {
		t.Errorf("export argv = %v, want %v", args, want)
	}
}

// TestBoundedBufferOverflow: the stdout sink fails the write past the cap, and
// the export seam maps it to errExportTooLarge with no artifact written.
func TestBoundedBufferOverflow(t *testing.T) {
	b := &boundedBuffer{limit: 4}
	if _, err := b.Write([]byte("ok")); err != nil {
		t.Fatal(err)
	}
	if _, err := b.Write([]byte("overflow")); !errors.Is(err, errExportTooLarge) {
		t.Errorf("overflow write err = %v, want errExportTooLarge", err)
	}

	dir := t.TempDir()
	opencodeExportFixture(t, dir, func(context.Context, string) ([]byte, error) {
		return nil, errExportTooLarge
	})
	if _, err := Path("opencode", nativeOpencodeRef); !errors.Is(err, errExportTooLarge) {
		t.Errorf("oversized export err = %v, want errExportTooLarge", err)
	}
	entries, _ := os.ReadDir(dir)
	if len(entries) != 0 {
		t.Errorf("a failed export must leave no artifact, found %d", len(entries))
	}
}

// TestOpencodeTranscriptPath: a successful export lands at <private
// dir>/<ref>.json (0600); a non-zero exit (unknown session) is
// ErrTranscriptNotFound.
func TestOpencodeTranscriptPath(t *testing.T) {
	dir := t.TempDir()
	opencodeExportFixture(t, dir, func(_ context.Context, ref string) ([]byte, error) {
		return []byte(`{"session":"` + ref + `"}`), nil
	})
	got, err := Path("opencode", nativeOpencodeRef)
	if err != nil {
		t.Fatalf("Path: %v", err)
	}
	want := filepath.Join(dir, nativeOpencodeRef+".json")
	if got != want {
		t.Errorf("Path = %q, want %q", got, want)
	}
	data, _ := os.ReadFile(want)
	if string(data) != `{"session":"`+nativeOpencodeRef+`"}` {
		t.Errorf("materialized content = %q", data)
	}
	if info, _ := os.Stat(want); info.Mode().Perm() != 0o600 {
		t.Errorf("mode = %o, want 600", info.Mode().Perm())
	}
	// The private dir is 0700.
	if info, _ := os.Stat(dir); info.Mode().Perm() != 0o700 {
		t.Errorf("dir mode = %o, want 700", info.Mode().Perm())
	}

	opencodeExportFixture(t, dir, func(context.Context, string) ([]byte, error) {
		return nil, &exec.ExitError{}
	})
	if _, err := Path("opencode", nativeOpencodeRefAt(9)); !errors.Is(err, ErrTranscriptNotFound) {
		t.Errorf("export failure err = %v, want ErrTranscriptNotFound", err)
	}
}

// TestOpencodeExportDirUnsafePreexisting: a symlink or a foreign-owned /
// non-directory path at the export dir is refused, never followed.
func TestOpencodeExportDirUnsafePreexisting(t *testing.T) {
	root := t.TempDir()
	victim := filepath.Join(root, "victim.json")
	if err := os.WriteFile(victim, []byte("precious"), 0o600); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(root, "linkdir")
	if err := os.Symlink(root, link); err != nil {
		t.Fatal(err)
	}
	opencodeExportFixture(t, link, func(context.Context, string) ([]byte, error) {
		return []byte(`{}`), nil
	})
	if _, err := Path("opencode", nativeOpencodeRef); err == nil {
		t.Error("a symlinked export dir must be refused")
	}
	if data, _ := os.ReadFile(victim); string(data) != "precious" {
		t.Error("the symlink target must never be written through")
	}

	// A regular file at the path is likewise refused.
	filePath := filepath.Join(root, "afile")
	if err := os.WriteFile(filePath, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	opencodeExportFixture(t, filePath, func(context.Context, string) ([]byte, error) {
		return []byte(`{}`), nil
	})
	if _, err := Path("opencode", nativeOpencodeRef); err == nil {
		t.Error("a non-directory export path must be refused")
	}
}

// TestOpencodeExportDirPermTightening: a pre-existing user-owned dir with
// too-open perms is tightened to 0700.
func TestOpencodeExportDirPermTightening(t *testing.T) {
	dir := t.TempDir()
	if err := os.Chmod(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	opencodeExportFixture(t, dir, func(context.Context, string) ([]byte, error) {
		return []byte(`{}`), nil
	})
	if _, err := Path("opencode", nativeOpencodeRef); err != nil {
		t.Fatalf("Path: %v", err)
	}
	if info, _ := os.Stat(dir); info.Mode().Perm() != 0o700 {
		t.Errorf("dir mode = %o, want tightened 700", info.Mode().Perm())
	}
}

// TestOpencodeExportSymlinkTargetReplaced: a preplaced symlink AT the artifact
// path is atomically replaced by rename — its target is never written through.
func TestOpencodeExportSymlinkTargetReplaced(t *testing.T) {
	dir := t.TempDir()
	victim := filepath.Join(t.TempDir(), "victim.txt")
	if err := os.WriteFile(victim, []byte("precious"), 0o600); err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(dir, nativeOpencodeRef+".json")
	if err := os.Symlink(victim, target); err != nil {
		t.Fatal(err)
	}
	opencodeExportFixture(t, dir, func(context.Context, string) ([]byte, error) {
		return []byte(`{"fresh":true}`), nil
	})
	if _, err := Path("opencode", nativeOpencodeRef); err != nil {
		t.Fatalf("Path: %v", err)
	}
	if data, _ := os.ReadFile(victim); string(data) != "precious" {
		t.Error("the preplaced symlink's target must never be written")
	}
	info, err := os.Lstat(target)
	if err != nil || info.Mode()&os.ModeSymlink != 0 {
		t.Fatal("the artifact path must now be a regular file, not the symlink")
	}
	if data, _ := os.ReadFile(target); string(data) != `{"fresh":true}` {
		t.Errorf("artifact content = %q", data)
	}
}

// TestOpencodeExportConcurrent: concurrent resolutions of the same and
// different refs all succeed with correct content (temp+rename is race-safe).
func TestOpencodeExportConcurrent(t *testing.T) {
	dir := t.TempDir()
	opencodeExportFixture(t, dir, func(_ context.Context, ref string) ([]byte, error) {
		return []byte(`{"session":"` + ref + `"}`), nil
	})
	var wg sync.WaitGroup
	errs := make(chan error, 16)
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			ref := nativeOpencodeRefAt(i % 3)
			path, err := Path("opencode", ref)
			if err != nil {
				errs <- err
				return
			}
			data, _ := os.ReadFile(path)
			if string(data) != `{"session":"`+ref+`"}` {
				errs <- fmt.Errorf("%s content = %q", ref, data)
			}
		}(i)
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Error(err)
	}
}

// TestOpencodeExportGraceProtectsCorpus: the consumer-shaped scenario — a
// server-scoped operator request resolving MORE identified opencode windows
// than the in-grace cap, in one loop. Every SUCCESSFULLY returned path stays
// readable (in-grace artifacts are never evicted); resolutions past capacity
// fail cleanly with errExportCapacity, so a rendered prompt can never embed a
// dangling path — the facts builder degrades an unresolved row by omission,
// as it does for any resolution failure.
func TestOpencodeExportGraceProtectsCorpus(t *testing.T) {
	dir := t.TempDir()
	opencodeExportFixture(t, dir, func(_ context.Context, ref string) ([]byte, error) {
		return []byte(`{"session":"` + ref + `"}`), nil
	})
	const windows = 24 // deliberately beyond the in-grace cap
	var handed []string
	refused := 0
	for i := 0; i < windows; i++ {
		path, err := Path("opencode", nativeOpencodeRefAt(i))
		if errors.Is(err, errExportCapacity) {
			refused++
			continue
		}
		if err != nil {
			t.Fatalf("resolution %d: %v", i, err)
		}
		handed = append(handed, path)
	}
	if len(handed) != opencodeExportCap || refused != windows-opencodeExportCap {
		t.Errorf("handed = %d, refused = %d; want %d handed and %d refused", len(handed), refused, opencodeExportCap, windows-opencodeExportCap)
	}
	// Every path embedded in the (simulated) corpus is still readable.
	for i, path := range handed {
		if _, err := os.ReadFile(path); err != nil {
			t.Errorf("corpus row %d dangles: %v", i, err)
		}
	}
}

// TestOpencodeExportPastGracePruned: artifacts older than the grace window are
// pruned on the next write; in-grace artifacts stay.
func TestOpencodeExportPastGracePruned(t *testing.T) {
	dir := t.TempDir()
	opencodeExportFixture(t, dir, func(_ context.Context, ref string) ([]byte, error) {
		return []byte(`{"session":"` + ref + `"}`), nil
	})
	old, err := Path("opencode", nativeOpencodeRefAt(0))
	if err != nil {
		t.Fatal(err)
	}
	past := time.Now().Add(-2 * opencodeExportGrace)
	if err := os.Chtimes(old, past, past); err != nil {
		t.Fatal(err)
	}
	fresh, err := Path("opencode", nativeOpencodeRefAt(1))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(old); !os.IsNotExist(err) {
		t.Error("past-grace artifact should have been pruned")
	}
	if _, err := os.Stat(fresh); err != nil {
		t.Error("in-grace artifact must stay")
	}
}

// TestOpencodeExportCapacityRefusal: with the in-grace cap reached, a new
// materialization is REFUSED (errExportCapacity) and no handed-out path is
// evicted — protecting paths already embedded in rendered prompts.
func TestOpencodeExportCapacityRefusal(t *testing.T) {
	dir := t.TempDir()
	opencodeExportFixture(t, dir, func(_ context.Context, ref string) ([]byte, error) {
		return []byte(`{"session":"` + ref + `"}`), nil
	})
	handed := make([]string, 0, opencodeExportCap)
	for i := 0; i < opencodeExportCap; i++ {
		path, err := Path("opencode", nativeOpencodeRefAt(i))
		if err != nil {
			t.Fatalf("resolution %d: %v", i, err)
		}
		handed = append(handed, path)
	}
	if _, err := Path("opencode", nativeOpencodeRefAt(opencodeExportCap+1)); !errors.Is(err, errExportCapacity) {
		t.Fatalf("over-capacity err = %v, want errExportCapacity", err)
	}
	for i, path := range handed {
		if _, err := os.Stat(path); err != nil {
			t.Errorf("handed-out path %d was evicted: %v", i, err)
		}
	}
}

// TestOpencodeConversationAvailable: the derive-tick probe is cheap — a
// well-formed NATIVE ref (mixed-case accepted) plus the binary on PATH, never
// an export.
func TestOpencodeConversationAvailable(t *testing.T) {
	orig := opencodeOnPathFn
	t.Cleanup(func() { opencodeOnPathFn = orig })
	opencodeOnPathFn = func() bool { return true }
	a, err := Lookup("opencode")
	if err != nil {
		t.Fatal(err)
	}
	checker, ok := a.(ConversationChecker)
	if !ok {
		t.Fatal("opencode adapter must implement ConversationChecker")
	}
	if !checker.ConversationAvailable(nativeOpencodeRef) {
		t.Error("native mixed-case ref + binary on PATH must be available")
	}
	if checker.ConversationAvailable("../bad") || checker.ConversationAvailable("--pure") {
		t.Error("invalid/flag-shaped ref must be unavailable")
	}
	opencodeOnPathFn = func() bool { return false }
	if checker.ConversationAvailable(nativeOpencodeRef) {
		t.Error("binary off PATH must be unavailable")
	}
}
