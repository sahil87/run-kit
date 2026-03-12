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
	Windows []tmux.WindowInfo `json:"windows"`
}

// hasFabKit checks if a project root contains a fab-kit project.
func hasFabKit(projectRoot string) bool {
	_, err := os.Stat(filepath.Join(projectRoot, "fab/project/config.yaml"))
	return err == nil
}

// enrichSession reads .fab-status.yaml once from the project root (window 0's
// WorktreePath) and applies the fab state to ALL windows in the session.
func enrichSession(windows []tmux.WindowInfo, projectRoot string) {
	state := fab.ReadState(projectRoot)
	if state == nil {
		return
	}
	for i := range windows {
		windows[i].FabChange = state.Change
		windows[i].FabStage = state.Stage
	}
}

// FetchSessions fetches all sessions, derives project roots from tmux, and enriches with fab state.
func FetchSessions() ([]ProjectSession, error) {
	sessionNames, err := tmux.ListSessions()
	if err != nil {
		return nil, err
	}

	if len(sessionNames) == 0 {
		return []ProjectSession{}, nil
	}

	// Fetch windows for all sessions in parallel
	type sessionData struct {
		name    string
		windows []tmux.WindowInfo
	}

	data := make([]sessionData, len(sessionNames))
	var wg sync.WaitGroup

	for i, name := range sessionNames {
		wg.Add(1)
		go func(idx int, sName string) {
			defer wg.Done()
			windows, _ := tmux.ListWindows(sName)
			if windows == nil {
				windows = []tmux.WindowInfo{}
			}
			data[idx] = sessionData{name: sName, windows: windows}
		}(i, name)
	}
	wg.Wait()

	// Enrich all sessions in parallel, preserve tmux ordering via indexed assignment
	result := make([]ProjectSession, len(data))
	var enrichWg sync.WaitGroup

	for i, sd := range data {
		enrichWg.Add(1)
		go func(idx int, sd sessionData) {
			defer enrichWg.Done()

			projectRoot := ""
			if len(sd.windows) > 0 {
				projectRoot = sd.windows[0].WorktreePath
			}

			if projectRoot != "" && hasFabKit(projectRoot) {
				enrichSession(sd.windows, projectRoot)
			}

			result[idx] = ProjectSession{Name: sd.name, Windows: sd.windows}
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
