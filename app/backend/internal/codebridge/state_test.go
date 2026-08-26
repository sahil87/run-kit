package codebridge

import (
	"os"
	"path/filepath"
	"testing"
)

func TestStateDirXDGOverride(t *testing.T) {
	t.Setenv("XDG_STATE_HOME", "/custom/state")
	dir, err := StateDir()
	if err != nil {
		t.Fatal(err)
	}
	if dir != filepath.Join("/custom/state", "run-kit", "cb") {
		t.Errorf("dir = %s", dir)
	}

	t.Setenv("XDG_STATE_HOME", "")
	dir, err = StateDir()
	if err != nil {
		t.Fatal(err)
	}
	home, _ := os.UserHomeDir()
	if dir != filepath.Join(home, ".local", "state", "run-kit", "cb") {
		t.Errorf("default dir = %s", dir)
	}
}

func TestHostsDir(t *testing.T) {
	t.Setenv("XDG_STATE_HOME", "/custom/state")
	dir, err := HostsDir()
	if err != nil {
		t.Fatal(err)
	}
	if dir != filepath.Join("/custom/state", "run-kit", "cb", "hosts") {
		t.Errorf("hosts dir = %s", dir)
	}
}

func TestReadRecords(t *testing.T) {
	dir := t.TempDir()
	writeRecord(t, dir, HostRecord{HostID: "b2", Folder: "/two", PID: 1})
	writeRecord(t, dir, HostRecord{HostID: "a1", Folder: "/one", PID: 2})
	if err := os.WriteFile(filepath.Join(dir, "broken.json"), []byte("{nope"), 0o600); err != nil {
		t.Fatal(err)
	}

	records, err := ReadRecords(dir)
	if err != nil {
		t.Fatalf("ReadRecords: %v", err)
	}
	// Sorted by host id; the undecodable file is skipped.
	if len(records) != 2 || records[0].HostID != "a1" || records[1].HostID != "b2" {
		t.Errorf("records = %+v", records)
	}
}

func TestReadRecordsMissingDir(t *testing.T) {
	records, err := ReadRecords(filepath.Join(t.TempDir(), "nope"))
	if err != nil || len(records) != 0 {
		t.Errorf("ReadRecords on missing dir = (%v, %v), want empty", records, err)
	}
}
