package sessions

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"time"

	"rk/internal/tmux"
)

// ProjectSession is a tmux session with its windows and optional fab enrichment.
type ProjectSession struct {
	Name         string            `json:"name"`
	SessionColor *int              `json:"sessionColor,omitempty"`
	Windows      []tmux.WindowInfo `json:"windows"`
}

// paneMapEntry matches the JSON output of `fab pane map --json`.
type paneMapEntry struct {
	Session           string  `json:"session"`
	WindowIndex       int     `json:"window_index"`
	Pane              string  `json:"pane"`
	Tab               string  `json:"tab"`
	Worktree          string  `json:"worktree"`
	Change            *string `json:"change"`
	Stage             *string `json:"stage"`
	AgentState        *string `json:"agent_state"`
	AgentIdleDuration *string `json:"agent_idle_duration"`
}

// fetchPaneMap runs `fab pane map --json --all-sessions` via the fab router on
// PATH and returns a lookup map keyed by "session:windowIndex". When repoRoot
// is non-empty, cmd.Dir is set to it so the router can resolve the project's
// fab_version from fab/project/config.yaml; otherwise the subprocess inherits
// the server's CWD, which is fine because --all-sessions output is repo-
// independent and the router tolerates running outside a fab project. Returns
// nil map and an error on failure.
func fetchPaneMap(repoRoot string) (map[string]paneMapEntry, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, "fab", "pane", "map", "--json", "--all-sessions")
	if repoRoot != "" {
		cmd.Dir = repoRoot
	}
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		if stderr.Len() > 0 {
			return nil, fmt.Errorf("%w: %s", err, stderr.String())
		}
		return nil, err
	}

	var entries []paneMapEntry
	if err := json.Unmarshal(out, &entries); err != nil {
		return nil, err
	}

	m := make(map[string]paneMapEntry, len(entries))
	for _, e := range entries {
		key := fmt.Sprintf("%s:%d", e.Session, e.WindowIndex)
		if existing, ok := m[key]; ok {
			// Multiple panes in the same window (splits). Prefer the entry
			// with richer fab state to keep enrichment deterministic.
			if e.Change != nil && existing.Change == nil {
				m[key] = e
			}
			// Otherwise keep the first entry seen.
		} else {
			m[key] = e
		}
	}
	return m, nil
}

// Pane-map cache: package-level with sync.RWMutex protection.
// Avoids re-running `fab pane map` on every SSE tick (5s TTL).
var (
	paneMapCache     map[string]paneMapEntry
	paneMapCacheTime time.Time
	paneMapCacheMu   sync.RWMutex
	paneMapCacheTTL  = 5 * time.Second
)

// fetchPaneMapCached wraps fetchPaneMap with a TTL cache.
// Uses a double-check pattern after write lock acquisition to prevent thundering herd.
// On fetch error, the stale cache entry is preserved (if one exists).
func fetchPaneMapCached(repoRoot string) (map[string]paneMapEntry, error) {
	paneMapCacheMu.RLock()
	if paneMapCache != nil && time.Since(paneMapCacheTime) < paneMapCacheTTL {
		cached := paneMapCache
		paneMapCacheMu.RUnlock()
		return cached, nil
	}
	paneMapCacheMu.RUnlock()

	paneMapCacheMu.Lock()
	defer paneMapCacheMu.Unlock()

	// Double-check: another goroutine may have refreshed while we waited for the write lock.
	if paneMapCache != nil && time.Since(paneMapCacheTime) < paneMapCacheTTL {
		return paneMapCache, nil
	}

	m, err := fetchPaneMap(repoRoot)
	if err != nil {
		// Preserve stale cache entry on error (graceful degradation).
		if paneMapCache != nil {
			return paneMapCache, nil
		}
		return nil, err
	}

	paneMapCache = m
	paneMapCacheTime = time.Now()
	return m, nil
}

// findRepoRoot walks up from dir until it finds a directory containing
// fab/project/config.yaml (the fab-project identity marker), returning that
// directory. Returns "" if not found.
func findRepoRoot(dir string) string {
	for {
		candidate := filepath.Join(dir, "fab/project/config.yaml")
		if _, err := os.Stat(candidate); err == nil {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return ""
		}
		dir = parent
	}
}

// Per-entry git branch cache with separate positive/negative TTLs.
type gitBranchCacheEntry struct {
	branch    string
	expiresAt time.Time
}

const (
	gitBranchPositiveTTL  = 30 * time.Second
	gitBranchNegativeTTL  = 15 * time.Second
	gitBranchResolveLimit = 16
	gitBranchCmdTimeout   = 250 * time.Millisecond
)

var (
	gitBranchCacheMu sync.RWMutex
	gitBranchCache   = make(map[string]gitBranchCacheEntry)
)

// resolveGitBranchFromHead reads .git/HEAD directly (no subprocess).
// Handles both normal repos and worktrees (where .git is a file pointing to the real gitdir).
func resolveGitBranchFromHead(cwd string) (string, bool) {
	gitPath := filepath.Join(cwd, ".git")
	info, err := os.Stat(gitPath)
	if err != nil {
		return "", false
	}

	headPath := ""
	if info.IsDir() {
		headPath = filepath.Join(gitPath, "HEAD")
	} else {
		// Worktree: .git is a file containing "gitdir: <path>"
		data, err := os.ReadFile(gitPath)
		if err != nil {
			return "", false
		}
		data = bytes.TrimSpace(data)
		if !bytes.HasPrefix(data, []byte("gitdir:")) {
			return "", false
		}
		gitDir := string(bytes.TrimSpace(data[7:]))
		if !filepath.IsAbs(gitDir) {
			gitDir = filepath.Join(cwd, gitDir)
		}
		headPath = filepath.Join(gitDir, "HEAD")
	}

	head, err := os.ReadFile(headPath)
	if err != nil {
		return "", false
	}
	head = bytes.TrimSpace(head)
	if !bytes.HasPrefix(head, []byte("ref:")) {
		return "", false // detached HEAD
	}
	ref := string(bytes.TrimSpace(head[4:]))
	// "refs/heads/main" → "main"
	if i := len("refs/heads/"); len(ref) > i {
		return ref[i:], true
	}
	return "", false
}

// resolveGitBranchWithGit falls back to git rev-parse (for edge cases).
func resolveGitBranchWithGit(ctx context.Context, cwd string) string {
	gitCtx, cancel := context.WithTimeout(ctx, gitBranchCmdTimeout)
	defer cancel()
	cmd := exec.CommandContext(gitCtx, "git", "-C", cwd, "rev-parse", "--abbrev-ref", "HEAD")
	out, err := cmd.Output()
	if err != nil {
		return ""
	}
	branch := string(bytes.TrimSpace(out))
	if branch == "HEAD" {
		return "" // detached
	}
	return branch
}

// resolveGitBranches resolves git branches for a set of cwds using a per-entry TTL cache.
// Prefers reading .git/HEAD directly; falls back to git subprocess.
func resolveGitBranches(ctx context.Context, cwds []string) map[string]string {
	now := time.Now()
	result := make(map[string]string)
	seen := make(map[string]bool)
	var misses []string

	// Check cache for each cwd
	gitBranchCacheMu.RLock()
	for _, cwd := range cwds {
		if cwd == "" || seen[cwd] {
			continue
		}
		seen[cwd] = true
		if entry, ok := gitBranchCache[cwd]; ok && now.Before(entry.expiresAt) {
			if entry.branch != "" {
				result[cwd] = entry.branch
			}
			continue
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

	// Resolve misses
	updates := make(map[string]gitBranchCacheEntry, len(misses))
	for _, cwd := range misses {
		if ctx.Err() != nil {
			break
		}
		branch, ok := resolveGitBranchFromHead(cwd)
		if !ok {
			branch = resolveGitBranchWithGit(ctx, cwd)
		}
		ttl := gitBranchNegativeTTL
		if branch != "" {
			ttl = gitBranchPositiveTTL
			result[cwd] = branch
		}
		updates[cwd] = gitBranchCacheEntry{branch: branch, expiresAt: now.Add(ttl)}
	}

	gitBranchCacheMu.Lock()
	for cwd, entry := range updates {
		gitBranchCache[cwd] = entry
	}
	gitBranchCacheMu.Unlock()

	return result
}

// derefStr dereferences a *string, returning empty string for nil.
func derefStr(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// FetchSessions fetches all sessions from the specified server, derives project roots from tmux, and enriches with fab state.
func FetchSessions(ctx context.Context, server string) ([]ProjectSession, error) {
	sessionInfos, err := tmux.ListSessions(ctx, server)
	if err != nil {
		return nil, err
	}

	if len(sessionInfos) == 0 {
		return []ProjectSession{}, nil
	}

	// Fetch windows for all sessions in parallel
	type sessionData struct {
		info    tmux.SessionInfo
		windows []tmux.WindowInfo
	}

	data := make([]sessionData, len(sessionInfos))
	var wg sync.WaitGroup

	for i, info := range sessionInfos {
		wg.Add(1)
		go func(idx int, si tmux.SessionInfo) {
			defer wg.Done()
			windows, _ := tmux.ListWindows(ctx, si.Name, server)
			if windows == nil {
				windows = []tmux.WindowInfo{}
			}
			data[idx] = sessionData{info: si, windows: windows}
		}(i, info)
	}
	wg.Wait()

	// Derive repoRoot by walking up from the first available window's
	// WorktreePath until we find a directory containing fab/project/config.yaml
	// (the fab-project identity marker). WorktreePath is the pane's cwd which
	// may be a subdirectory of the repo.
	repoRoot := ""
	for _, sd := range data {
		for _, w := range sd.windows {
			if w.WorktreePath != "" {
				repoRoot = findRepoRoot(w.WorktreePath)
				if repoRoot != "" {
					break
				}
			}
		}
		if repoRoot != "" {
			break
		}
	}

	// Fetch pane-map once for all sessions. If refreshing the cache fails,
	// fetchPaneMapCached may return a stale cached paneMap; if no data is
	// available, windows keep empty fab fields (graceful degradation).
	paneMap, _ := fetchPaneMapCached(repoRoot)

	// Collect all pane cwds for git branch resolution.
	var allCwds []string
	for _, sd := range data {
		for _, w := range sd.windows {
			for _, p := range w.Panes {
				allCwds = append(allCwds, p.Cwd)
			}
		}
	}
	gitBranches := resolveGitBranches(ctx, allCwds)

	// Build result with per-window fab enrichment from pane-map and git branches.
	result := make([]ProjectSession, len(data))
	for i, sd := range data {
		for j := range sd.windows {
			key := fmt.Sprintf("%s:%d", sd.info.Name, sd.windows[j].Index)
			if entry, ok := paneMap[key]; ok {
				sd.windows[j].FabChange = derefStr(entry.Change)
				sd.windows[j].FabStage = derefStr(entry.Stage)
				sd.windows[j].AgentState = derefStr(entry.AgentState)
				sd.windows[j].AgentIdleDuration = derefStr(entry.AgentIdleDuration)
			}
			for k := range sd.windows[j].Panes {
				if branch, ok := gitBranches[sd.windows[j].Panes[k].Cwd]; ok {
					sd.windows[j].Panes[k].GitBranch = branch
				}
			}
		}

		result[i] = ProjectSession{Name: sd.info.Name, SessionColor: sd.info.Color, Windows: sd.windows}
	}

	return result, nil
}

// ProjectRoot derives the project root from a session's target window.
func ProjectRoot(ctx context.Context, session string, windowIndex int, server string) (string, error) {
	windows, err := tmux.ListWindows(ctx, session, server)
	if err != nil {
		return "", err
	}
	if len(windows) == 0 {
		return "", nil
	}

	for _, w := range windows {
		if w.Index == windowIndex {
			return w.WorktreePath, nil
		}
	}
	// Fall back to first window
	return windows[0].WorktreePath, nil
}
