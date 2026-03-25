package tmux

import (
	"testing"
)

func TestVersionRegex(t *testing.T) {
	tests := []struct {
		input string
		major int
		minor int
	}{
		{"3.6a", 3, 6},
		{"3.3", 3, 3},
		{"3.2a", 3, 2},
		{"next-3.5", 3, 5},
		{"4.0", 4, 0},
	}

	for _, tt := range tests {
		m := versionRe.FindStringSubmatch(tt.input)
		if m == nil {
			t.Errorf("versionRe did not match %q", tt.input)
			continue
		}
		if m[1] != itoa(tt.major) || m[2] != itoa(tt.minor) {
			t.Errorf("versionRe(%q) = %s.%s, want %d.%d", tt.input, m[1], m[2], tt.major, tt.minor)
		}
	}
}

func itoa(n int) string {
	return []string{"0", "1", "2", "3", "4", "5", "6"}[n]
}

func TestVersion(t *testing.T) {
	v, err := Version()
	if err != nil {
		t.Skipf("tmux not available: %v", err)
	}
	if v.Raw == "" {
		t.Error("expected non-empty Raw version string")
	}
	if v.Major < 1 {
		t.Errorf("expected Major >= 1, got %d", v.Major)
	}
}
