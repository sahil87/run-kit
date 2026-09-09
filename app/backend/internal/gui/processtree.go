package gui

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// ProcessTreePids returns the pid set of root plus every descendant, derived
// from <procRoot>/<pid>/stat ppids (production callers pass "/proc"). The
// rk-gui pane pid is the root: the set covers the supervise process, the VNC
// backend, and the WM — the supervisor's own tree that RunningApps must not
// count as user apps (the WM carries DISPLAY in its environ). An unreadable
// procRoot yields just the root; vanished pids are skipped silently.
func ProcessTreePids(procRoot string, root int) map[int]bool {
	set := map[int]bool{root: true}
	entries, err := os.ReadDir(procRoot)
	if err != nil {
		return set
	}
	children := make(map[int][]int)
	for _, e := range entries {
		pid, err := strconv.Atoi(e.Name())
		if err != nil {
			continue
		}
		ppid, err := statPPID(filepath.Join(procRoot, e.Name(), "stat"))
		if err != nil {
			continue
		}
		children[ppid] = append(children[ppid], pid)
	}
	// Breadth-first from the root; the tree is shallow (pane → supervise →
	// backend/WM) so the work queue stays tiny.
	queue := []int{root}
	for len(queue) > 0 {
		pid := queue[0]
		queue = queue[1:]
		for _, child := range children[pid] {
			if set[child] {
				continue
			}
			set[child] = true
			queue = append(queue, child)
		}
	}
	return set
}

// statPPID reads the parent pid from a /proc/<pid>/stat line. The comm field
// (field 2) may contain spaces and parens, so the parse splits after the LAST
// ')' — the ppid is then the second space-separated field of the remainder
// (state, then ppid).
func statPPID(path string) (int, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return 0, err
	}
	line := string(data)
	close := strings.LastIndex(line, ")")
	if close < 0 {
		return 0, strconv.ErrSyntax
	}
	fields := strings.Fields(line[close+1:])
	if len(fields) < 2 {
		return 0, strconv.ErrSyntax
	}
	return strconv.Atoi(fields[1])
}
