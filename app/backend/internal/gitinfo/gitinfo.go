// Package gitinfo derives a working directory's git branch and worktree
// classification directly from the filesystem — reading .git/HEAD without a
// subprocess, fronted by a TTL cache with a detached-HEAD grace window. It is
// the single source of the branch/worktree semantics shared by the sessions
// sidebar (internal/sessions) and the daemon's pane-border git stamp
// (internal/snapshot), so the two never drift. Stdlib-only by design: both
// importers also import internal/tmux, so gitinfo must pull in no rk/internal
// package.
package gitinfo

import (
	"bytes"
	"context"
	"errors"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// Per-entry git branch cache with separate positive/negative TTLs. lastGood /
// lastGoodAt remember the most recent GENUINE positive resolution independently
// of the served branch: during a detached-HEAD grace serve the entry's branch is
// the remembered one, but lastGoodAt is never re-stamped, so the grace window is
// measured from the last real ref — a deliberate long-term detached checkout
// exhausts it and degrades to the negative cache rather than holding forever.
type gitBranchCacheEntry struct {
	branch     string
	expiresAt  time.Time
	lastGood   string
	lastGoodAt time.Time
}

const (
	gitBranchPositiveTTL  = 30 * time.Second
	gitBranchNegativeTTL  = 15 * time.Second
	gitBranchResolveLimit = 16
	gitBranchCmdTimeout   = 250 * time.Millisecond

	// gitBranchNoRepoTTL is the cache horizon for the authoritative no-repo
	// negative: a clean no-.git-ancestor walk proves git would find nothing
	// either, so re-probing on the short negative cadence buys nothing. The
	// 15s cadence stays for negatives that can heal quickly (unparseable .git
	// shapes, grace expiry).
	gitBranchNoRepoTTL = 5 * time.Minute

	// gitBranchResolveConcurrency bounds the miss-resolution fan-out: stat-walk
	// misses complete near-instantly in parallel, and the residual subprocess
	// worst case is ceil(gitBranchResolveLimit/gitBranchResolveConcurrency) ×
	// gitBranchCmdTimeout instead of a fully serial storm.
	gitBranchResolveConcurrency = 4

	// gitBranchDetachedGraceTTL bounds how long a detached HEAD keeps serving the
	// cwd's last-known branch. A rebase/bisect ends on the branch it started on,
	// so blanking the branch (and with it every PR surface) mid-rebase is pure
	// noise — but the grace MUST expire so a checkout deliberately parked
	// detached eventually reads as branchless. Sized to cover a long interactive
	// rebase; the serve is cached on the NEGATIVE cadence (15s) so the real HEAD
	// is re-read promptly once the rebase finishes.
	gitBranchDetachedGraceTTL = 5 * time.Minute
)

var (
	gitBranchCacheMu sync.RWMutex
	gitBranchCache   = make(map[string]gitBranchCacheEntry)
)

// PathTail returns the last two path segments of cwd, matching the retired
// pane-border shell job `echo <cwd> | rev | cut -d/ -f1-2 | rev`: it keeps the
// final two '/'-separated fields (and the delimiter between them), returning
// cwd unchanged when it has two or fewer fields. So "/home/user/project" →
// "user/project", "/" → "/", "project" → "project", and a trailing slash
// "/a/b/project/" → "project/".
func PathTail(cwd string) string {
	fields := strings.Split(cwd, "/")
	if len(fields) <= 2 {
		return cwd
	}
	return strings.Join(fields[len(fields)-2:], "/")
}

// IsWorktree reports whether cwd sits inside a git worktree checkout — the same
// condition the retired `git rev-parse --show-toplevel | grep worktrees` badge
// job tested: the .git-holding root (the classifyGitRoot walk result, which for
// a worktree is the worktree's own root) has a path containing "worktrees",
// covering both the `worktrees` and `.worktrees` directory conventions.
func IsWorktree(cwd string) bool {
	root, _ := classifyGitRoot(cwd)
	return root != "" && strings.Contains(root, "worktrees")
}

// resolveGitBranchFromHead reads .git/HEAD directly (no subprocess).
// Handles both normal repos and worktrees (where .git is a file pointing to the
// real gitdir). detached reports a READABLE HEAD that is not a ref — the
// mid-rebase/bisect shape — which the caller may bridge with the last-known
// branch (grace); every unreadable/non-repo shape is (ok=false, detached=false)
// and keeps plain negative behavior.
func resolveGitBranchFromHead(cwd string) (branch string, detached, ok bool) {
	if cwd == "" {
		// filepath.Join("", ".git") is a RELATIVE ".git" — it would stat against
		// the server process's own working directory, not any pane's repo.
		return "", false, false
	}
	gitPath := filepath.Join(cwd, ".git")
	info, err := os.Stat(gitPath)
	if err != nil {
		return "", false, false
	}

	headPath := ""
	if info.IsDir() {
		headPath = filepath.Join(gitPath, "HEAD")
	} else {
		// Worktree: .git is a file containing "gitdir: <path>"
		data, err := os.ReadFile(gitPath)
		if err != nil {
			return "", false, false
		}
		data = bytes.TrimSpace(data)
		if !bytes.HasPrefix(data, []byte("gitdir:")) {
			return "", false, false
		}
		gitDir := string(bytes.TrimSpace(data[7:]))
		if !filepath.IsAbs(gitDir) {
			gitDir = filepath.Join(cwd, gitDir)
		}
		headPath = filepath.Join(gitDir, "HEAD")
	}

	head, err := os.ReadFile(headPath)
	if err != nil {
		return "", false, false
	}
	head = bytes.TrimSpace(head)
	if !bytes.HasPrefix(head, []byte("ref:")) {
		return "", true, false // detached HEAD (raw commit SHA)
	}
	ref := string(bytes.TrimSpace(head[4:]))
	// "refs/heads/main" → "main"
	if i := len("refs/heads/"); len(ref) > i {
		return ref[i:], false, true
	}
	return "", false, false
}

// resolveGitBranchWithGit falls back to git rev-parse (for edge cases). detached
// mirrors resolveGitBranchFromHead's signal: rev-parse prints the literal `HEAD`
// on a detached checkout.
func resolveGitBranchWithGit(ctx context.Context, cwd string) (branch string, detached bool) {
	gitCtx, cancel := context.WithTimeout(ctx, gitBranchCmdTimeout)
	defer cancel()
	cmd := exec.CommandContext(gitCtx, "git", "-C", cwd, "rev-parse", "--abbrev-ref", "HEAD")
	out, err := cmd.Output()
	if err != nil {
		return "", false
	}
	b := string(bytes.TrimSpace(out))
	if b == "HEAD" {
		return "", true // detached
	}
	return b, false
}

// classifyGitRoot walks cwd toward the filesystem root looking for a .git
// entry. It deliberately does NOT reuse config.FindGitRoot: that walk treats
// every stat error as a miss, which is fine for a best-effort join key but
// not for the authoritative no-repo classification here — only a walk whose
// every miss is fs.ErrNotExist proves "no repo". Any other stat error
// (permissions, transient I/O) makes the classification ambiguous, and the
// caller must keep the short-cadence subprocess fallback rather than caching
// a long-TTL negative for what may be a real repo.
func classifyGitRoot(cwd string) (root string, ambiguous bool) {
	if cwd == "" {
		return "", false
	}
	dir := cwd
	for {
		_, err := os.Stat(filepath.Join(dir, ".git"))
		switch {
		case err == nil:
			return dir, false
		case !errors.Is(err, fs.ErrNotExist):
			return "", true
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", false
		}
		dir = parent
	}
}

// resolveGitBranch resolves one cache-missed cwd and builds its cache entry.
// Classification runs before parsing: a classifyGitRoot walk finding no
// .git ancestor is an authoritative no-repo negative (git would find nothing
// either) — no subprocess, cached on the long gitBranchNoRepoTTL horizon. A
// found root goes through the direct HEAD read; an unparseable .git
// shape (unreadable HEAD, malformed gitdir: file, unrecognized ref) and an
// ambiguous walk (a non-ErrNotExist stat error) reach the subprocess
// fallback, whose negatives keep the short gitBranchNegativeTTL cadence
// since the shape can heal quickly. Every negative arm carries
// lastGood/lastGoodAt through so a detached cwd that expires and later
// re-attaches restarts its grace from the next real ref, not from stale
// history.
func resolveGitBranch(ctx context.Context, cwd string, now time.Time, p gitBranchCacheEntry) gitBranchCacheEntry {
	root, ambiguous := classifyGitRoot(cwd)
	if root == "" && !ambiguous {
		return gitBranchCacheEntry{expiresAt: now.Add(gitBranchNoRepoTTL), lastGood: p.lastGood, lastGoodAt: p.lastGoodAt}
	}
	var branch string
	var detached, ok bool
	if root != "" {
		branch, detached, ok = resolveGitBranchFromHead(root)
	}
	if !ok && !detached {
		// The HEAD shape is authoritative for detached — the subprocess
		// fallback covers the shapes the direct read couldn't parse and the
		// ambiguous-walk case where no root is known.
		branch, detached = resolveGitBranchWithGit(ctx, cwd)
	}
	switch {
	case branch != "":
		return gitBranchCacheEntry{branch: branch, expiresAt: now.Add(gitBranchPositiveTTL), lastGood: branch, lastGoodAt: now}
	case detached && p.lastGood != "" && now.Sub(p.lastGoodAt) < gitBranchDetachedGraceTTL:
		// Grace serve: bridge the rebase with the last-known branch. lastGoodAt
		// is NOT re-stamped — the grace window is measured from the last real
		// ref, so a checkout parked detached exhausts it.
		return gitBranchCacheEntry{branch: p.lastGood, expiresAt: now.Add(gitBranchNegativeTTL), lastGood: p.lastGood, lastGoodAt: p.lastGoodAt}
	default:
		return gitBranchCacheEntry{expiresAt: now.Add(gitBranchNegativeTTL), lastGood: p.lastGood, lastGoodAt: p.lastGoodAt}
	}
}

// ResolveBranches resolves git branches for a set of cwds using a per-entry TTL
// cache. Each miss is classified by a classifyGitRoot walk before parsing (see
// resolveGitBranch): no-repo cwds never spawn a subprocess and cache on the
// long no-repo horizon; repo cwds resolve via the direct .git/HEAD read; the
// git subprocess fallback is reserved for unparseable .git shapes and
// ambiguous (stat-error) walks. Misses fan
// out under gitBranchResolveConcurrency and land in one batched cache write.
// A detached HEAD within gitBranchDetachedGraceTTL of the cwd's last genuine
// positive resolution serves that last-known branch (a rebase ends on the
// branch it started on — blanking every PR surface mid-rebase is noise),
// cached on the negative cadence so the real HEAD is re-read promptly once it
// re-attaches.
func ResolveBranches(ctx context.Context, cwds []string) map[string]string {
	now := time.Now()
	result := make(map[string]string)
	seen := make(map[string]bool)
	var misses []string
	prior := make(map[string]gitBranchCacheEntry)

	// Check cache for each cwd
	gitBranchCacheMu.RLock()
	for _, cwd := range cwds {
		if cwd == "" || seen[cwd] {
			continue
		}
		seen[cwd] = true
		if entry, ok := gitBranchCache[cwd]; ok {
			if now.Before(entry.expiresAt) {
				if entry.branch != "" {
					result[cwd] = entry.branch
				}
				continue
			}
			// Expired: keep the old entry's last-good record for the grace check.
			prior[cwd] = entry
		}
		misses = append(misses, cwd)
	}
	gitBranchCacheMu.RUnlock()

	if len(misses) == 0 {
		return result
	}
	if len(misses) > gitBranchResolveLimit {
		misses = misses[:gitBranchResolveLimit]
	}

	// Resolve misses with bounded concurrency: workers stop taking new work
	// once ctx is done (in-flight subprocess caps still bound the tail), and
	// entries collect under a local mutex so the cache mutation below stays
	// one batched write-lock section.
	updates := make(map[string]gitBranchCacheEntry, len(misses))
	var updatesMu sync.Mutex
	sem := make(chan struct{}, gitBranchResolveConcurrency)
	var wg sync.WaitGroup
	for _, cwd := range misses {
		if ctx.Err() != nil {
			break
		}
		wg.Add(1)
		go func(cwd string) {
			defer wg.Done()
			select {
			case sem <- struct{}{}:
				defer func() { <-sem }()
			case <-ctx.Done():
				return
			}
			entry := resolveGitBranch(ctx, cwd, now, prior[cwd])
			updatesMu.Lock()
			updates[cwd] = entry
			if entry.branch != "" {
				result[cwd] = entry.branch
			}
			updatesMu.Unlock()
		}(cwd)
	}
	wg.Wait()

	gitBranchCacheMu.Lock()
	for cwd, entry := range updates {
		gitBranchCache[cwd] = entry
	}
	gitBranchCacheMu.Unlock()

	return result
}
