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

// ActiveWindowProvider supplies the event-tracked active window (`@wid`) for a
// (server, group) pair — the authoritative Tier-1 signal derived from tmux
// control-mode `%session-window-changed` events. It is the seam between the
// tmuxctl layer (which owns the tracker) and the fetch path. A nil provider, or
// a (server, group) miss, signals "no tracked value" so FetchSessions falls
// back to the base-session `#{window_active}` pointer (Tier 2) — preserving
// today's behavior when control-mode is unavailable.
type ActiveWindowProvider interface {
	ActiveWindow(server, group string) (wid string, ok bool)
}

// applyActiveWindow enforces the two-tier active-window derivation on one
// session's windows in place. When trackedWid is non-empty (Tier 1) AND a live
// window matches it, exactly that window is marked active and all others are
// cleared — overriding the base-pointer flag parsed by parseWindows. If
// trackedWid is empty (no tracked entry) OR matches no live window (stale —
// e.g. the window closed between the event and this fetch), the base-pointer
// flags are left untouched (Tier 2 fallback). This guarantees the sidebar's
// single-highlight invariant: at most one window is active per session.
//
// Pure function (no I/O) so the derivation is unit-testable directly, mirroring
// the parseWindows/parsePanes split.
func applyActiveWindow(windows []tmux.WindowInfo, trackedWid string) {
	if trackedWid == "" {
		return // Tier 2: keep base-pointer flags.
	}
	matchIdx := -1
	for i := range windows {
		if windows[i].WindowID == trackedWid {
			matchIdx = i
			break
		}
	}
	if matchIdx < 0 {
		// Stale tracked @wid (window gone) — fall back to Tier 2 for this
		// session rather than marking none active.
		return
	}
	for i := range windows {
		windows[i].IsActiveWindow = i == matchIdx
	}
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
	PrURL             *string `json:"pr_url"`
	PrNumber          *int    `json:"pr_number"`
}

// fetchPaneMap runs `fab pane map --json --all-sessions` via the fab router on
// PATH and returns a lookup map keyed by "session:windowIndex". When server is
// non-empty, it is passed as `-L <server>` so the subprocess targets the same
// tmux socket the backend is querying; otherwise fab falls back to $TMUX or
// the default socket. When repoRoot is non-empty, cmd.Dir is set to it so the
// router can resolve the project's fab_version from fab/project/config.yaml;
// otherwise the subprocess inherits the server's CWD. Returns nil map and an
// error on failure.
func fetchPaneMap(server, repoRoot string) (map[string]paneMapEntry, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	args := make([]string, 0, 6)
	if server != "" {
		args = append(args, "-L", server)
	}
	args = append(args, "pane", "map", "--json", "--all-sessions")
	cmd := exec.CommandContext(ctx, "fab", args...)
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

	return dedupEntries(entries), nil
}

// dedupEntries collapses pane-map entries that belong to the same window,
// preferring richer fab state. Priority: Change > AgentState > first-seen.
// The collision key is the window each pane belongs to. The external
// `fab pane map` tool identifies a window only by (session, window_index), so
// that pair is the window-grouping key here; FetchSessions then re-keys the
// result by the window's stable WindowID before joining (see FetchSessions).
func dedupEntries(entries []paneMapEntry) map[string]paneMapEntry {
	m := make(map[string]paneMapEntry, len(entries))
	for _, e := range entries {
		key := fmt.Sprintf("%s:%d", e.Session, e.WindowIndex)
		existing, ok := m[key]
		if !ok {
			m[key] = e
			continue
		}
		// Multiple panes in the same window (splits). Priority: Change > AgentState > first-seen.
		switch {
		case e.Change != nil && existing.Change == nil:
			m[key] = e
		case e.Change == nil && existing.Change == nil && e.AgentState != nil && existing.AgentState == nil:
			m[key] = e
		}
	}
	return m
}

// Pane-map cache: package-level with sync.RWMutex protection, keyed by
// tmux server label so queries against different sockets don't collide.
// Avoids re-running `fab pane map` on every SSE tick (5s TTL).
type paneMapCacheEntry struct {
	data map[string]paneMapEntry
	time time.Time
}

var (
	paneMapCache    = make(map[string]paneMapCacheEntry)
	paneMapCacheMu  sync.RWMutex
	paneMapCacheTTL = 5 * time.Second
)

// fetchPaneMapCached wraps fetchPaneMap with a per-server TTL cache.
// Uses a double-check pattern after write lock acquisition to prevent thundering herd.
// On fetch error, the stale cache entry for that server is preserved (if one exists).
func fetchPaneMapCached(server, repoRoot string) (map[string]paneMapEntry, error) {
	paneMapCacheMu.RLock()
	if entry, ok := paneMapCache[server]; ok && time.Since(entry.time) < paneMapCacheTTL {
		cached := entry.data
		paneMapCacheMu.RUnlock()
		return cached, nil
	}
	paneMapCacheMu.RUnlock()

	paneMapCacheMu.Lock()
	defer paneMapCacheMu.Unlock()

	// Double-check: another goroutine may have refreshed while we waited for the write lock.
	if entry, ok := paneMapCache[server]; ok && time.Since(entry.time) < paneMapCacheTTL {
		return entry.data, nil
	}

	m, err := fetchPaneMap(server, repoRoot)
	if err != nil {
		// Preserve stale cache entry on error (graceful degradation).
		if entry, ok := paneMapCache[server]; ok {
			return entry.data, nil
		}
		return nil, err
	}

	paneMapCache[server] = paneMapCacheEntry{data: m, time: time.Now()}
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

// FetchSessions fetches all sessions from the specified server, derives project
// roots from tmux, enriches with fab state, and applies the two-tier
// active-window derivation. The provider supplies the event-tracked active
// window per group (Tier 1); when it is nil or has no entry for a session's
// group, the base-session `#{window_active}` pointer parsed from tmux (Tier 2)
// stands. A nil provider therefore degrades to exactly today's behavior.
func FetchSessions(ctx context.Context, server string, provider ActiveWindowProvider) ([]ProjectSession, error) {
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
	paneMap, _ := fetchPaneMapCached(server, repoRoot)

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

	// Re-key the pane-map enrichment by stable window ID. The external
	// `fab pane map` tool (wrapped, not reimplemented — constitution §III) emits
	// only (session, window_index), so we translate each entry to the window ID of
	// the live window currently at that (session, index) within this same snapshot.
	// Joining windows by their stable WindowID (rather than by the mutable index)
	// means a reorder can never misattribute one window's fab/agent state to
	// another.
	enrichByWindowID := make(map[string]paneMapEntry, len(paneMap))
	for _, sd := range data {
		for j := range sd.windows {
			indexKey := fmt.Sprintf("%s:%d", sd.info.Name, sd.windows[j].Index)
			if entry, ok := paneMap[indexKey]; ok {
				enrichByWindowID[sd.windows[j].WindowID] = entry
			}
		}
	}

	// Build result with per-window fab enrichment from pane-map and git branches.
	result := make([]ProjectSession, len(data))
	for i, sd := range data {
		for j := range sd.windows {
			if entry, ok := enrichByWindowID[sd.windows[j].WindowID]; ok {
				sd.windows[j].FabChange = derefStr(entry.Change)
				sd.windows[j].FabStage = derefStr(entry.Stage)
				sd.windows[j].AgentState = derefStr(entry.AgentState)
				sd.windows[j].AgentIdleDuration = derefStr(entry.AgentIdleDuration)
				sd.windows[j].PrURL = entry.PrURL
				sd.windows[j].PrNumber = entry.PrNumber
			}
			for k := range sd.windows[j].Panes {
				if branch, ok := gitBranches[sd.windows[j].Panes[k].Cwd]; ok {
					sd.windows[j].Panes[k].GitBranch = branch
				}
			}
		}

		// Two-tier active-window derivation. The user-facing session name IS
		// the session-group key (parseSessions keeps the leader whose name ==
		// #{session_group}, or an ungrouped session keyed by its own name —
		// matching parseSessionGroups/parseActiveWindowsByGroup). Tier 1: if
		// the provider reports a tracked @wid for this group, it overrides the
		// base-pointer flag (authoritative). Tier 2: otherwise the parsed
		// #{window_active} flag stands. A nil provider is a no-op (Tier 2).
		if provider != nil {
			if trackedWid, ok := provider.ActiveWindow(server, sd.info.Name); ok {
				applyActiveWindow(sd.windows, trackedWid)
			}
		}

		result[i] = ProjectSession{Name: sd.info.Name, SessionColor: sd.info.Color, Windows: sd.windows}
	}

	return result, nil
}

// ProjectRoot derives the project root from the target window identified by its
// stable window ID. It resolves the owning session from the window ID, then
// returns that window's worktree path. Falls back to the session's first window
// when the ID is not found among the enumerated windows.
func ProjectRoot(ctx context.Context, windowID, server string) (string, error) {
	session, err := tmux.ResolveWindowSession(ctx, server, windowID)
	if err != nil {
		return "", err
	}

	windows, err := tmux.ListWindows(ctx, session, server)
	if err != nil {
		return "", err
	}
	if len(windows) == 0 {
		return "", nil
	}

	for _, w := range windows {
		if w.WindowID == windowID {
			return w.WorktreePath, nil
		}
	}
	// Fall back to first window
	return windows[0].WorktreePath, nil
}
