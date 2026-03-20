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

	"run-kit/internal/tmux"
)

// ProjectSession is a tmux session with its windows and optional fab enrichment.
type ProjectSession struct {
	Name    string            `json:"name"`
	Windows []tmux.WindowInfo `json:"windows"`
}

// paneMapEntry matches the JSON output of `fab-go pane-map --json`.
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

// fetchPaneMap runs fab-go pane-map --json --all-sessions and returns a lookup
// map keyed by "session:windowIndex". Returns nil map and an error on failure.
func fetchPaneMap(repoRoot string) (map[string]paneMapEntry, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	bin := filepath.Join(repoRoot, "fab/.kit/bin/fab-go")
	cmd := exec.CommandContext(ctx, bin, "pane-map", "--json", "--all-sessions")
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

// findRepoRoot walks up from dir until it finds a directory containing
// fab/.kit/bin/fab-go, returning that directory. Returns "" if not found.
func findRepoRoot(dir string) string {
	for {
		candidate := filepath.Join(dir, "fab/.kit/bin/fab-go")
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

// derefStr dereferences a *string, returning empty string for nil.
func derefStr(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// FetchSessions fetches all sessions from the specified server, derives project roots from tmux, and enriches with fab state.
func FetchSessions(server string) ([]ProjectSession, error) {
	sessionInfos, err := tmux.ListSessions(server)
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
			windows, _ := tmux.ListWindows(si.Name, server)
			if windows == nil {
				windows = []tmux.WindowInfo{}
			}
			data[idx] = sessionData{info: si, windows: windows}
		}(i, info)
	}
	wg.Wait()

	// Derive repoRoot by walking up from the first available window's
	// WorktreePath until we find a directory containing fab/.kit/bin/fab-go.
	// WorktreePath is the pane's cwd which may be a subdirectory of the repo.
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

	// Fetch pane-map once for all sessions. On error, paneMap is nil
	// and all windows get empty fab fields (graceful degradation).
	var paneMap map[string]paneMapEntry
	if repoRoot != "" {
		paneMap, _ = fetchPaneMap(repoRoot)
	}

	// Build result with per-window fab enrichment from pane-map.
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
		}
		result[i] = ProjectSession{Name: sd.info.Name, Windows: sd.windows}
	}

	return result, nil
}

// ProjectRoot derives the project root from a session's target window.
func ProjectRoot(session string, windowIndex int, server string) (string, error) {
	windows, err := tmux.ListWindows(session, server)
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
