package codebridge

import (
	"os"
	"testing"
)

// allAlive is the alive probe for tests that don't exercise liveness.
func allAlive(int) bool { return true }

func TestTabStartedAtNewestWins(t *testing.T) {
	older := HostRecord{HostID: "a", Tab: "@7", Server: "s", PID: 1, StartedAt: "2026-09-10T02:45:39.941Z"}
	newer := HostRecord{HostID: "b", Tab: "@7", Server: "s", PID: 1, StartedAt: "2026-09-10T02:45:41.100Z"}
	for _, records := range [][]HostRecord{{older, newer}, {newer, older}} {
		if got := TabStartedAt(records, "s", "@7", allAlive); got != newer.StartedAt {
			t.Errorf("TabStartedAt = %q, want %q", got, newer.StartedAt)
		}
	}
}

func TestTabStartedAtDeadPidExcluded(t *testing.T) {
	rec := HostRecord{HostID: "a", Tab: "@7", Server: "s", PID: 424242, StartedAt: "2026-09-10T02:45:39.941Z"}
	if got := TabStartedAt([]HostRecord{rec}, "s", "@7", func(int) bool { return false }); got != "" {
		t.Errorf("TabStartedAt = %q, want \"\" for a dead pid", got)
	}
}

func TestTabStartedAtFolderOnlyAndWrongServerNeverMatch(t *testing.T) {
	stamp := "2026-09-10T02:45:39.941Z"
	records := []HostRecord{
		{HostID: "folder-only", Folder: "/repo", PID: 1, StartedAt: stamp},
		{HostID: "other-server", Tab: "@7", Server: "other", PID: 1, StartedAt: stamp},
		{HostID: "other-tab", Tab: "@9", Server: "s", PID: 1, StartedAt: stamp},
	}
	if got := TabStartedAt(records, "s", "@7", allAlive); got != "" {
		t.Errorf("TabStartedAt = %q, want \"\"", got)
	}
}

func TestTabStartedAtUnparseableSkipped(t *testing.T) {
	valid := HostRecord{HostID: "ok", Tab: "@7", Server: "s", PID: 1, StartedAt: "2026-09-10T02:45:39.941Z"}
	bad := HostRecord{HostID: "bad", Tab: "@7", Server: "s", PID: 1, StartedAt: "not-a-time"}
	if got := TabStartedAt([]HostRecord{bad, valid}, "s", "@7", allAlive); got != valid.StartedAt {
		t.Errorf("TabStartedAt = %q, want %q", got, valid.StartedAt)
	}
	if got := TabStartedAt([]HostRecord{bad}, "s", "@7", allAlive); got != "" {
		t.Errorf("TabStartedAt with only an unparseable stamp = %q, want \"\"", got)
	}
}

func TestTabStartedAtEmptyInput(t *testing.T) {
	if got := TabStartedAt(nil, "s", "@7", allAlive); got != "" {
		t.Errorf("TabStartedAt(nil) = %q, want \"\"", got)
	}
}

func TestTabStartedAtRealPidProbe(t *testing.T) {
	rec := HostRecord{HostID: "a", Tab: "@7", Server: "s", PID: os.Getpid(), StartedAt: "2026-09-10T02:45:39.941Z"}
	if got := TabStartedAt([]HostRecord{rec}, "s", "@7", PIDAlive); got != rec.StartedAt {
		t.Errorf("TabStartedAt with PIDAlive(own pid) = %q, want %q", got, rec.StartedAt)
	}
}

func TestTabEmptyBootAtNewestWins(t *testing.T) {
	older := BootMarker{HostID: "a", Tab: "@7", Server: "s", PID: 1, StartedAt: "2026-09-10T02:45:39.941Z"}
	newer := BootMarker{HostID: "b", Tab: "@7", Server: "s", PID: 1, StartedAt: "2026-09-10T02:45:41.100Z"}
	for _, markers := range [][]BootMarker{{older, newer}, {newer, older}} {
		if got := TabEmptyBootAt(markers, "s", "@7", allAlive); got != newer.StartedAt {
			t.Errorf("TabEmptyBootAt = %q, want %q", got, newer.StartedAt)
		}
	}
}

func TestTabEmptyBootAtDeadPidExcluded(t *testing.T) {
	m := BootMarker{HostID: "a", Tab: "@7", Server: "s", PID: 424242, StartedAt: "2026-09-10T02:45:39.941Z"}
	if got := TabEmptyBootAt([]BootMarker{m}, "s", "@7", func(int) bool { return false }); got != "" {
		t.Errorf("TabEmptyBootAt = %q, want \"\" for a dead pid", got)
	}
}

func TestTabEmptyBootAtWrongServerOrTabNeverMatch(t *testing.T) {
	stamp := "2026-09-10T02:45:39.941Z"
	markers := []BootMarker{
		{HostID: "other-server", Tab: "@7", Server: "other", PID: 1, StartedAt: stamp},
		{HostID: "other-tab", Tab: "@9", Server: "s", PID: 1, StartedAt: stamp},
	}
	if got := TabEmptyBootAt(markers, "s", "@7", allAlive); got != "" {
		t.Errorf("TabEmptyBootAt = %q, want \"\"", got)
	}
}

func TestTabEmptyBootAtUnparseableSkipped(t *testing.T) {
	valid := BootMarker{HostID: "ok", Tab: "@7", Server: "s", PID: 1, StartedAt: "2026-09-10T02:45:39.941Z"}
	bad := BootMarker{HostID: "bad", Tab: "@7", Server: "s", PID: 1, StartedAt: "not-a-time"}
	if got := TabEmptyBootAt([]BootMarker{bad, valid}, "s", "@7", allAlive); got != valid.StartedAt {
		t.Errorf("TabEmptyBootAt = %q, want %q", got, valid.StartedAt)
	}
	if got := TabEmptyBootAt([]BootMarker{bad}, "s", "@7", allAlive); got != "" {
		t.Errorf("TabEmptyBootAt with only an unparseable stamp = %q, want \"\"", got)
	}
}

func TestTabEmptyBootAtEmptyInput(t *testing.T) {
	if got := TabEmptyBootAt(nil, "s", "@7", allAlive); got != "" {
		t.Errorf("TabEmptyBootAt(nil) = %q, want \"\"", got)
	}
}

func TestTabEmptyBootAtRealPidProbe(t *testing.T) {
	m := BootMarker{HostID: "a", Tab: "@7", Server: "s", PID: os.Getpid(), StartedAt: "2026-09-10T02:45:39.941Z"}
	if got := TabEmptyBootAt([]BootMarker{m}, "s", "@7", PIDAlive); got != m.StartedAt {
		t.Errorf("TabEmptyBootAt with PIDAlive(own pid) = %q, want %q", got, m.StartedAt)
	}
}
