//go:build linux

package gui

import (
	"bytes"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

// wmHelperComms are window-manager processes excluded from RunningApps by
// comm name (on top of the pid-tree exclude). By name, not ancestry: apps
// launched from the IceWM toolbar are children of icewm and must stay listed.
var wmHelperComms = map[string]bool{
	"icewm-session": true, "icewm": true, "icewmbg": true, "icewmtray": true,
	"icesound": true, "icewmhint": true, "openbox": true, "xfwm4": true,
	"i3": true, "kwin_x11": true, "xsetroot": true,
}

// RunningApps lists the applications running on the given display (":N") by
// scanning <procRoot>/[0-9]*/environ for an exact DISPLAY=:N entry, grouped
// by process comm and sorted by count desc then name asc. Pids in exclude
// (the supervisor's own backend/WM/supervise pids) are skipped; WM helper
// processes (wmHelperComms) are skipped by comm name; unreadable or vanished
// pids are skipped silently. Production callers pass "/proc".
func RunningApps(procRoot, display string, exclude map[int]bool) ([]App, error) {
	entries, err := os.ReadDir(procRoot)
	if err != nil {
		return nil, err
	}
	want := []byte("DISPLAY=" + display)
	counts := make(map[string]int)
	for _, e := range entries {
		pid, err := strconv.Atoi(e.Name())
		if err != nil || exclude[pid] {
			continue
		}
		env, err := os.ReadFile(filepath.Join(procRoot, e.Name(), "environ"))
		if err != nil || !environHasDisplay(env, want) {
			continue
		}
		comm, err := os.ReadFile(filepath.Join(procRoot, e.Name(), "comm"))
		if err != nil {
			continue
		}
		if name := strings.TrimSpace(string(comm)); name != "" && !wmHelperComms[name] {
			counts[name]++
		}
	}
	apps := make([]App, 0, len(counts))
	for name, count := range counts {
		apps = append(apps, App{Name: name, Count: count})
	}
	sort.Slice(apps, func(i, j int) bool {
		if apps[i].Count != apps[j].Count {
			return apps[i].Count > apps[j].Count
		}
		return apps[i].Name < apps[j].Name
	})
	return apps, nil
}

// environHasDisplay reports whether the NUL-separated environ blob carries
// DISPLAY=<display> as an exact entry (":1" must not match "DISPLAY=:10").
func environHasDisplay(env, want []byte) bool {
	for _, entry := range bytes.Split(env, []byte{0}) {
		if bytes.Equal(entry, want) {
			return true
		}
	}
	return false
}
