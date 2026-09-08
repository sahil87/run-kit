package gitinfo

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestPathTail(t *testing.T) {
	cases := []struct {
		cwd  string
		want string
	}{
		// Matches `echo <cwd> | rev | cut -d/ -f1-2 | rev`.
		{"/home/user/project", "user/project"},
		{"/a/b/c/d", "c/d"},
		{"/", "/"},
		{"project", "project"},
		{"/project", "/project"},
		{"user/project", "user/project"},
		{"/home/user/project/", "project/"},
		{"", ""},
	}
	for _, c := range cases {
		if got := PathTail(c.cwd); got != c.want {
			t.Errorf("PathTail(%q) = %q, want %q", c.cwd, got, c.want)
		}
	}
}

func TestIsWorktree(t *testing.T) {
	t.Run("git root path containing worktrees is a worktree", func(t *testing.T) {
		base := t.TempDir()
		wt := filepath.Join(base, "run-kit.worktrees", "witty-mayfly")
		if err := os.MkdirAll(filepath.Join(wt, ".git"), 0o755); err != nil {
			t.Fatal(err)
		}
		if !IsWorktree(wt) {
			t.Errorf("IsWorktree(%q) = false, want true", wt)
		}
		// The dotted convention (.worktrees) is covered by the same substring.
		dotted := filepath.Join(base, ".worktrees", "feat")
		if err := os.MkdirAll(filepath.Join(dotted, ".git"), 0o755); err != nil {
			t.Fatal(err)
		}
		if !IsWorktree(dotted) {
			t.Errorf("IsWorktree(%q) = false, want true", dotted)
		}
	})

	t.Run("a plain repo root is not a worktree", func(t *testing.T) {
		repo := t.TempDir()
		if err := os.MkdirAll(filepath.Join(repo, ".git"), 0o755); err != nil {
			t.Fatal(err)
		}
		if r, _ := classifyGitRoot(repo); r != repo {
			t.Skipf("temp dir %q classifies to %q (host layout); cannot assert", repo, r)
		}
		if IsWorktree(repo) {
			t.Errorf("IsWorktree(%q) = true, want false", repo)
		}
	})

	t.Run("a non-repo cwd is not a worktree", func(t *testing.T) {
		plain := t.TempDir()
		if r, _ := classifyGitRoot(plain); r != "" {
			t.Skip("temp dir lives inside a git repo; cannot exercise the no-repo case")
		}
		if IsWorktree(plain) {
			t.Errorf("IsWorktree(%q) = true, want false", plain)
		}
	})
}

// --- branch resolution: two-tier cache, detached-HEAD grace ---

// writeGitHead writes a repo's .git/HEAD content, creating the .git dir.
func writeGitHead(t *testing.T, repo, content string) {
	t.Helper()
	gitDir := filepath.Join(repo, ".git")
	if err := os.MkdirAll(gitDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(gitDir, "HEAD"), []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

// resetGitBranchCache empties the package-global branch cache for a test and
// restores the previous map on cleanup, so tests never leak entries.
func resetGitBranchCache(t *testing.T) {
	t.Helper()
	gitBranchCacheMu.Lock()
	prev := gitBranchCache
	gitBranchCache = make(map[string]gitBranchCacheEntry)
	gitBranchCacheMu.Unlock()
	t.Cleanup(func() {
		gitBranchCacheMu.Lock()
		gitBranchCache = prev
		gitBranchCacheMu.Unlock()
	})
}

// ageGitBranchEntry expires a cache entry (forcing re-resolution on the next
// pass) and optionally backdates its last-good stamp by lastGoodAge.
func ageGitBranchEntry(t *testing.T, cwd string, lastGoodAge time.Duration) {
	t.Helper()
	gitBranchCacheMu.Lock()
	defer gitBranchCacheMu.Unlock()
	e, ok := gitBranchCache[cwd]
	if !ok {
		t.Fatalf("no cache entry for %q", cwd)
	}
	e.expiresAt = time.Now().Add(-time.Second)
	if lastGoodAge > 0 {
		e.lastGoodAt = time.Now().Add(-lastGoodAge)
	}
	gitBranchCache[cwd] = e
}

func TestResolveGitBranchesDetachedGrace(t *testing.T) {
	ctx := context.Background()

	t.Run("detached HEAD within grace serves the last-known branch", func(t *testing.T) {
		resetGitBranchCache(t)
		repo := t.TempDir()
		writeGitHead(t, repo, "ref: refs/heads/feat-x\n")
		if got := ResolveBranches(ctx, []string{repo}); got[repo] != "feat-x" {
			t.Fatalf("positive resolve: got %q, want feat-x", got[repo])
		}

		// Rebase starts: HEAD detaches to a raw SHA. Expire the cached positive
		// so the next call re-resolves.
		writeGitHead(t, repo, "0123456789abcdef0123456789abcdef01234567\n")
		ageGitBranchEntry(t, repo, 0)
		if got := ResolveBranches(ctx, []string{repo}); got[repo] != "feat-x" {
			t.Errorf("grace serve: got %q, want feat-x", got[repo])
		}

		// The grace serve is cached on the short cadence and keeps serving from
		// cache within it.
		if got := ResolveBranches(ctx, []string{repo}); got[repo] != "feat-x" {
			t.Errorf("cached grace serve: got %q, want feat-x", got[repo])
		}
	})

	t.Run("grace expiry blanks the branch", func(t *testing.T) {
		resetGitBranchCache(t)
		repo := t.TempDir()
		writeGitHead(t, repo, "ref: refs/heads/feat-x\n")
		ResolveBranches(ctx, []string{repo})

		writeGitHead(t, repo, "0123456789abcdef0123456789abcdef01234567\n")
		ageGitBranchEntry(t, repo, gitBranchDetachedGraceTTL+time.Minute)
		if got := ResolveBranches(ctx, []string{repo}); got[repo] != "" {
			t.Errorf("expired grace: got %q, want empty", got[repo])
		}
	})

	t.Run("re-attached HEAD resolves live and re-stamps the grace window", func(t *testing.T) {
		resetGitBranchCache(t)
		repo := t.TempDir()
		writeGitHead(t, repo, "ref: refs/heads/feat-x\n")
		ResolveBranches(ctx, []string{repo})

		writeGitHead(t, repo, "0123456789abcdef0123456789abcdef01234567\n")
		ageGitBranchEntry(t, repo, 0)
		ResolveBranches(ctx, []string{repo}) // grace serve

		// Rebase ends on a (possibly different) branch; the next expiry re-read
		// picks up the live ref.
		writeGitHead(t, repo, "ref: refs/heads/feat-y\n")
		ageGitBranchEntry(t, repo, 0)
		if got := ResolveBranches(ctx, []string{repo}); got[repo] != "feat-y" {
			t.Errorf("re-attached: got %q, want feat-y", got[repo])
		}
		gitBranchCacheMu.RLock()
		lastGood := gitBranchCache[repo].lastGood
		gitBranchCacheMu.RUnlock()
		if lastGood != "feat-y" {
			t.Errorf("lastGood = %q, want feat-y (re-stamped on genuine positive)", lastGood)
		}
	})

	t.Run("first-sight detached HEAD has no grace and resolves empty", func(t *testing.T) {
		resetGitBranchCache(t)
		repo := t.TempDir()
		writeGitHead(t, repo, "0123456789abcdef0123456789abcdef01234567\n")
		if got := ResolveBranches(ctx, []string{repo}); got[repo] != "" {
			t.Errorf("first-sight detached: got %q, want empty", got[repo])
		}
	})

	t.Run("non-repo cwd caches an authoritative no-repo negative on the long TTL", func(t *testing.T) {
		resetGitBranchCache(t)
		plain := t.TempDir()
		if root, _ := classifyGitRoot(plain); root != "" {
			t.Skip("temp dir lives inside a git repo; cannot exercise the no-repo walk")
		}
		if got := ResolveBranches(ctx, []string{plain}); got[plain] != "" {
			t.Errorf("non-repo: got %q, want empty", got[plain])
		}
		gitBranchCacheMu.RLock()
		e := gitBranchCache[plain]
		gitBranchCacheMu.RUnlock()
		if e.branch != "" || e.lastGood != "" {
			t.Errorf("non-repo entry = %+v, want plain negative", e)
		}
		if remaining := time.Until(e.expiresAt); remaining <= gitBranchNegativeTTL || remaining > gitBranchNoRepoTTL {
			t.Errorf("no-repo expiresAt remaining = %v, want on the %v horizon", remaining, gitBranchNoRepoTTL)
		}
	})
}

func TestResolveGitBranchFromHeadDetachedSignal(t *testing.T) {
	repo := t.TempDir()
	writeGitHead(t, repo, "0123456789abcdef0123456789abcdef01234567\n")
	branch, detached, ok := resolveGitBranchFromHead(repo)
	if branch != "" || !detached || ok {
		t.Errorf("detached HEAD: got (%q, %v, %v), want (\"\", true, false)", branch, detached, ok)
	}

	writeGitHead(t, repo, "ref: refs/heads/main\n")
	branch, detached, ok = resolveGitBranchFromHead(repo)
	if branch != "main" || detached || !ok {
		t.Errorf("ref HEAD: got (%q, %v, %v), want (main, false, true)", branch, detached, ok)
	}

	plain := t.TempDir()
	branch, detached, ok = resolveGitBranchFromHead(plain)
	if branch != "" || detached || ok {
		t.Errorf("non-repo: got (%q, %v, %v), want (\"\", false, false)", branch, detached, ok)
	}
}

// withoutExec clears PATH for a test so any subprocess spawn fails — a
// successful resolution under it proves the direct-read path ran with no exec.
func withoutExec(t *testing.T) {
	t.Helper()
	t.Setenv("PATH", t.TempDir())
}

// cacheEntry returns the branch cache entry for cwd, failing on absence.
func cacheEntry(t *testing.T, cwd string) gitBranchCacheEntry {
	t.Helper()
	gitBranchCacheMu.RLock()
	defer gitBranchCacheMu.RUnlock()
	e, ok := gitBranchCache[cwd]
	if !ok {
		t.Fatalf("no cache entry for %q", cwd)
	}
	return e
}

func TestResolveGitBranchesSubdirectoryDirectRead(t *testing.T) {
	withoutExec(t)
	ctx := context.Background()

	t.Run("repo-subdirectory cwd resolves via direct read at the walk-found root", func(t *testing.T) {
		resetGitBranchCache(t)
		repo := t.TempDir()
		writeGitHead(t, repo, "ref: refs/heads/main\n")
		sub := filepath.Join(repo, "sub", "dir")
		if err := os.MkdirAll(sub, 0o755); err != nil {
			t.Fatal(err)
		}
		// exec is impossible (empty PATH): a branch here came from file reads
		// alone, never the subprocess fallback.
		if got := ResolveBranches(ctx, []string{sub}); got[sub] != "main" {
			t.Errorf("subdirectory resolve: got %q, want main", got[sub])
		}
	})

	t.Run("worktree gitdir indirection resolves from a subdirectory", func(t *testing.T) {
		resetGitBranchCache(t)
		gitDir := t.TempDir() // the worktree's real gitdir
		if err := os.WriteFile(filepath.Join(gitDir, "HEAD"), []byte("ref: refs/heads/feat-wt\n"), 0o644); err != nil {
			t.Fatal(err)
		}
		worktree := t.TempDir()
		if err := os.WriteFile(filepath.Join(worktree, ".git"), []byte("gitdir: "+gitDir+"\n"), 0o644); err != nil {
			t.Fatal(err)
		}
		sub := filepath.Join(worktree, "nested")
		if err := os.MkdirAll(sub, 0o755); err != nil {
			t.Fatal(err)
		}
		if got := ResolveBranches(ctx, []string{sub}); got[sub] != "feat-wt" {
			t.Errorf("worktree subdirectory resolve: got %q, want feat-wt", got[sub])
		}
	})
}

func TestResolveGitBranchesTwoTierNegatives(t *testing.T) {
	withoutExec(t)
	ctx := context.Background()

	t.Run("no-repo cwd caches on the long TTL with no subprocess", func(t *testing.T) {
		resetGitBranchCache(t)
		plain := t.TempDir()
		if root, _ := classifyGitRoot(plain); root != "" {
			t.Skip("temp dir lives inside a git repo; cannot exercise the no-repo walk")
		}
		if got := ResolveBranches(ctx, []string{plain}); got[plain] != "" {
			t.Errorf("no-repo resolve: got %q, want empty", got[plain])
		}
		e := cacheEntry(t, plain)
		if remaining := time.Until(e.expiresAt); remaining <= gitBranchNegativeTTL || remaining > gitBranchNoRepoTTL {
			t.Errorf("no-repo expiresAt remaining = %v, want on the %v horizon", remaining, gitBranchNoRepoTTL)
		}
		// Within the TTL the second call is a pure cache hit: delete the dir so
		// any re-walk would misbehave, then confirm the result is unchanged.
		if err := os.RemoveAll(plain); err != nil {
			t.Fatal(err)
		}
		if got := ResolveBranches(ctx, []string{plain}); got[plain] != "" {
			t.Errorf("cached no-repo resolve: got %q, want empty", got[plain])
		}
	})

	t.Run("unparseable .git still takes the fallback and caches on the short cadence", func(t *testing.T) {
		resetGitBranchCache(t)
		broken := t.TempDir()
		// A .git FILE whose content is not a gitdir: pointer — the walk finds it
		// (so this is never a no-repo negative) but the direct read can't parse
		// it, so the subprocess fallback runs and fails (exec impossible here).
		if err := os.WriteFile(filepath.Join(broken, ".git"), []byte("garbage\n"), 0o644); err != nil {
			t.Fatal(err)
		}
		if got := ResolveBranches(ctx, []string{broken}); got[broken] != "" {
			t.Errorf("unparseable resolve: got %q, want empty", got[broken])
		}
		e := cacheEntry(t, broken)
		if remaining := time.Until(e.expiresAt); remaining <= 0 || remaining > gitBranchNegativeTTL {
			t.Errorf("unparseable expiresAt remaining = %v, want on the %v cadence", remaining, gitBranchNegativeTTL)
		}
	})

	t.Run("ambiguous stat error keeps the short cadence, never the no-repo TTL", func(t *testing.T) {
		if os.Geteuid() == 0 {
			t.Skip("running as root; permission errors cannot be provoked")
		}
		resetGitBranchCache(t)
		base := t.TempDir()
		repo := filepath.Join(base, "repo")
		if err := os.MkdirAll(filepath.Join(repo, ".git"), 0o755); err != nil {
			t.Fatal(err)
		}
		writeGitHead(t, repo, "ref: refs/heads/main\n")
		cwd := filepath.Join(repo, "sub")
		if err := os.MkdirAll(cwd, 0o755); err != nil {
			t.Fatal(err)
		}
		// Revoking search permission on base makes every stat under it fail
		// with EACCES — a REAL repo whose walk errors, the misclassification
		// case: it must not become an authoritative 5m no-repo negative.
		if err := os.Chmod(base, 0o000); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = os.Chmod(base, 0o755) })
		if got := ResolveBranches(ctx, []string{cwd}); got[cwd] != "" {
			t.Errorf("ambiguous resolve: got %q, want empty (fallback exec impossible here)", got[cwd])
		}
		e := cacheEntry(t, cwd)
		if remaining := time.Until(e.expiresAt); remaining <= 0 || remaining > gitBranchNegativeTTL {
			t.Errorf("ambiguous expiresAt remaining = %v, want on the %v cadence", remaining, gitBranchNegativeTTL)
		}

		// Once the error clears, the short cadence re-probe resolves the real
		// branch directly.
		if err := os.Chmod(base, 0o755); err != nil {
			t.Fatal(err)
		}
		ageGitBranchEntry(t, cwd, 0)
		if got := ResolveBranches(ctx, []string{cwd}); got[cwd] != "main" {
			t.Errorf("healed resolve: got %q, want main", got[cwd])
		}
	})
}

func TestResolveGitBranchesConcurrentMisses(t *testing.T) {
	withoutExec(t)
	ctx := context.Background()

	t.Run("a full miss batch resolves correctly", func(t *testing.T) {
		resetGitBranchCache(t)
		var cwds []string
		wantBranch := make(map[string]string)
		for _, branch := range []string{"main", "feat-a", "feat-b", "feat-c"} {
			repo := t.TempDir()
			writeGitHead(t, repo, "ref: refs/heads/"+branch+"\n")
			sub := filepath.Join(repo, "sub")
			if err := os.MkdirAll(sub, 0o755); err != nil {
				t.Fatal(err)
			}
			cwds = append(cwds, repo, sub)
			wantBranch[repo], wantBranch[sub] = branch, branch
		}
		for range 8 {
			cwds = append(cwds, t.TempDir()) // no-repo misses
		}
		got := ResolveBranches(ctx, cwds)
		for _, cwd := range cwds {
			if got[cwd] != wantBranch[cwd] {
				t.Errorf("resolve %q: got %q, want %q", cwd, got[cwd], wantBranch[cwd])
			}
		}
		gitBranchCacheMu.RLock()
		n := len(gitBranchCache)
		gitBranchCacheMu.RUnlock()
		if n != len(cwds) {
			t.Errorf("cache entries = %d, want %d (every miss written by the batched update)", n, len(cwds))
		}
	})

	t.Run("a canceled ctx issues no new work", func(t *testing.T) {
		resetGitBranchCache(t)
		repo := t.TempDir()
		writeGitHead(t, repo, "ref: refs/heads/main\n")
		canceled, cancel := context.WithCancel(ctx)
		cancel()
		if got := ResolveBranches(canceled, []string{repo}); len(got) != 0 {
			t.Errorf("canceled ctx: got %v, want no resolutions", got)
		}
		gitBranchCacheMu.RLock()
		n := len(gitBranchCache)
		gitBranchCacheMu.RUnlock()
		if n != 0 {
			t.Errorf("canceled ctx: %d cache entries written, want 0", n)
		}
	})

	t.Run("the resolve limit truncates the miss batch", func(t *testing.T) {
		resetGitBranchCache(t)
		var cwds []string
		for range gitBranchResolveLimit + 4 {
			cwds = append(cwds, t.TempDir())
		}
		ResolveBranches(ctx, cwds)
		gitBranchCacheMu.RLock()
		n := len(gitBranchCache)
		gitBranchCacheMu.RUnlock()
		if n != gitBranchResolveLimit {
			t.Errorf("cache entries = %d, want %d (gitBranchResolveLimit)", n, gitBranchResolveLimit)
		}
	})
}
