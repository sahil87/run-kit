package codebridge

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// writeMarker plants one marker file under dir, named <hostId>.json.
func writeMarker(t *testing.T, dir string, m BootMarker) {
	t.Helper()
	data, err := json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, m.HostID+".json"), data, 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestReadBootMarkers(t *testing.T) {
	dir := t.TempDir()
	writeMarker(t, dir, BootMarker{HostID: "b2", Tab: "@9", Server: "s", PID: 1})
	writeMarker(t, dir, BootMarker{HostID: "a1", Tab: "@7", Server: "s", PID: 2})
	if err := os.WriteFile(filepath.Join(dir, "broken.json"), []byte("{nope"), 0o600); err != nil {
		t.Fatal(err)
	}

	markers, err := ReadBootMarkers(dir)
	if err != nil {
		t.Fatalf("ReadBootMarkers: %v", err)
	}
	// Sorted by host id; the undecodable file is skipped.
	if len(markers) != 2 || markers[0].HostID != "a1" || markers[1].HostID != "b2" {
		t.Errorf("markers = %+v", markers)
	}
}

func TestReadBootMarkersMissingDir(t *testing.T) {
	markers, err := ReadBootMarkers(filepath.Join(t.TempDir(), "nope"))
	if err != nil || len(markers) != 0 {
		t.Errorf("ReadBootMarkers on missing dir = (%v, %v), want empty", markers, err)
	}
}
