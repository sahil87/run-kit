package gui

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

func TestFreeDisplay(t *testing.T) {
	root := t.TempDir()
	defer func(saved string) { tmpRoot = saved }(tmpRoot)
	tmpRoot = root

	if err := os.WriteFile(filepath.Join(root, ".X10-lock"), nil, 0o644); err != nil {
		t.Fatalf("WriteFile lock: %v", err)
	}
	if err := os.MkdirAll(filepath.Join(root, ".X11-unix"), 0o755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	if err := os.WriteFile(filepath.Join(root, ".X11-unix", "X11"), nil, 0o644); err != nil {
		t.Fatalf("WriteFile socket: %v", err)
	}

	n, err := FreeDisplay(10)
	if err != nil {
		t.Fatalf("FreeDisplay: %v", err)
	}
	if n != 12 {
		t.Errorf("FreeDisplay(10) = %d, want 12 (:10 locked, :11 socketed)", n)
	}

	t.Run("past :99 errors", func(t *testing.T) {
		if _, err := FreeDisplay(maxDisplay + 1); err == nil {
			t.Error("FreeDisplay(100) succeeded, want range-exhausted error")
		}
	})

	t.Run("exhausted range errors", func(t *testing.T) {
		for i := 10; i <= maxDisplay; i++ {
			if err := os.WriteFile(filepath.Join(root, fmt.Sprintf(".X%d-lock", i)), nil, 0o644); err != nil {
				t.Fatalf("WriteFile lock %d: %v", i, err)
			}
		}
		if _, err := FreeDisplay(10); err == nil {
			t.Error("FreeDisplay(10) succeeded with every display locked, want error")
		}
	})
}

func TestParseDisplay(t *testing.T) {
	valid := map[string]int{":0": 0, ":10": 10, ":99": 99}
	for s, want := range valid {
		got, err := ParseDisplay(s)
		if err != nil {
			t.Errorf("ParseDisplay(%q): %v", s, err)
		} else if got != want {
			t.Errorf("ParseDisplay(%q) = %d, want %d", s, got, want)
		}
	}
	for _, s := range []string{"", "10", ":", ":x", ":1x", "::1", ":1 ", " :1"} {
		if _, err := ParseDisplay(s); err == nil {
			t.Errorf("ParseDisplay(%q) succeeded, want error", s)
		}
	}
}
