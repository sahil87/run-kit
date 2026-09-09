package gui

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"testing"
)

// writeFakeStat plants one fixture /proc/<pid>/stat line with the given comm
// and ppid. Fields after comm are state, ppid, then filler.
func writeFakeStat(t *testing.T, procRoot string, pid int, comm string, ppid int) {
	t.Helper()
	dir := filepath.Join(procRoot, strconv.Itoa(pid))
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	line := fmt.Sprintf("%d (%s) S %d 0 0 0 -1 4194304 100 0 0 0\n", pid, comm, ppid)
	if err := os.WriteFile(filepath.Join(dir, "stat"), []byte(line), 0o644); err != nil {
		t.Fatalf("WriteFile stat: %v", err)
	}
}

func TestProcessTreePids(t *testing.T) {
	procRoot := t.TempDir()
	// Pane tree: 200 (rk gui supervise) → 201 (Xtigervnc), 202 (openbox) →
	// 203 (openbox child). 300 is an unrelated user process.
	writeFakeStat(t, procRoot, 200, "rk", 1)
	writeFakeStat(t, procRoot, 201, "Xtigervnc", 200)
	writeFakeStat(t, procRoot, 202, "openbox", 200)
	writeFakeStat(t, procRoot, 203, "obconf", 202)
	writeFakeStat(t, procRoot, 300, "chromium", 1)

	got := ProcessTreePids(procRoot, 200)
	for _, pid := range []int{200, 201, 202, 203} {
		if !got[pid] {
			t.Errorf("pid %d missing from the tree set %v", pid, got)
		}
	}
	if got[300] {
		t.Errorf("unrelated pid 300 landed in the tree set %v", got)
	}

	t.Run("comm with spaces and parens parses the ppid after the last close-paren", func(t *testing.T) {
		writeFakeStat(t, procRoot, 204, "weird (name) here", 200)
		got := ProcessTreePids(procRoot, 200)
		if !got[204] {
			t.Errorf("pid 204 (comm with parens) missing from the tree set %v", got)
		}
	})

	t.Run("a pid with no readable stat is skipped", func(t *testing.T) {
		if err := os.MkdirAll(filepath.Join(procRoot, "205"), 0o755); err != nil {
			t.Fatal(err)
		}
		got := ProcessTreePids(procRoot, 200)
		if got[205] {
			t.Errorf("pid 205 (no stat) landed in the tree set %v", got)
		}
	})

	t.Run("unreadable procRoot still yields the root", func(t *testing.T) {
		got := ProcessTreePids(filepath.Join(procRoot, "gone"), 200)
		if len(got) != 1 || !got[200] {
			t.Errorf("got %v, want just the root", got)
		}
	})
}
