package sessions

import (
	"os"
	"path/filepath"
	"sync"

	"run-kit/internal/fab"
	"run-kit/internal/tmux"
)

// ProjectSession is a tmux session with its windows and optional fab enrichment.
type ProjectSession struct {
	Name    string            `json:"name"`
	Byobu   bool              `json:"byobu"`
	Windows []tmux.WindowInfo `json:"windows"`
}

// hasFabKit checks if a project root contains a fab-kit project.
func hasFabKit(projectRoot string) bool {
	_, err := os.Stat(filepath.Join(projectRoot, "fab/project/config.yaml"))
	return err == nil
}

// enrichSession reads .fab-status.yaml and .fab-runtime.yaml from the project
// root and applies the fab state and agent runtime state to ALL windows.
// runtimeCache is a shared map for caching runtime state per project root
// across concurrent enrichment goroutines. Pass nil to skip caching.
func enrichSession(windows []tmux.WindowInfo, projectRoot string, runtimeCache *sync.Map) {
	state := fab.ReadState(projectRoot)
	if state == nil {
		return
	}
	for i := range windows {
		windows[i].FabChange = state.Change
		windows[i].FabStage = state.Stage
	}

	// Read runtime state with per-project-root caching
	var runtime *fab.RuntimeState
	if runtimeCache != nil {
		if cached, ok := runtimeCache.Load(projectRoot); ok {
			runtime, _ = cached.(*fab.RuntimeState)
		} else {
			runtime = fab.ReadRuntime(projectRoot, state.Change)
			runtimeCache.Store(projectRoot, runtime)
		}
	} else {
		runtime = fab.ReadRuntime(projectRoot, state.Change)
	}

	if runtime == nil {
		return
	}
	for i := range windows {
		windows[i].AgentState = runtime.AgentState
		windows[i].AgentIdleDuration = runtime.AgentIdleDuration
	}
}

// FetchSessions fetches all sessions, derives project roots from tmux, and enriches with fab state.
func FetchSessions() ([]ProjectSession, error) {
	sessionInfos, err := tmux.ListSessions()
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
			windows, _ := tmux.ListWindows(si.Name)
			if windows == nil {
				windows = []tmux.WindowInfo{}
			}
			data[idx] = sessionData{info: si, windows: windows}
		}(i, info)
	}
	wg.Wait()

	// Enrich all sessions in parallel, preserve tmux ordering via indexed assignment.
	// runtimeCache ensures .fab-runtime.yaml is read at most once per project root.
	result := make([]ProjectSession, len(data))
	var enrichWg sync.WaitGroup
	var runtimeCache sync.Map

	for i, sd := range data {
		enrichWg.Add(1)
		go func(idx int, sd sessionData) {
			defer enrichWg.Done()

			projectRoot := ""
			if len(sd.windows) > 0 {
				projectRoot = sd.windows[0].WorktreePath
			}

			if projectRoot != "" && hasFabKit(projectRoot) {
				enrichSession(sd.windows, projectRoot, &runtimeCache)
			}

			result[idx] = ProjectSession{Name: sd.info.Name, Byobu: sd.info.Byobu, Windows: sd.windows}
		}(i, sd)
	}
	enrichWg.Wait()

	return result, nil
}

// ProjectRoot derives the project root from a session's target window.
func ProjectRoot(session string, windowIndex int) (string, error) {
	windows, err := tmux.ListWindows(session)
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
