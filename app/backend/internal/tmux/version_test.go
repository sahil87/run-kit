package tmux

import (
	"context"
	"testing"
)

func TestParseVersion(t *testing.T) {
	cases := []struct {
		output    string
		wantOK    bool
		wantMajor int
		wantMinor int
		wantRaw   string
		wantBelow bool
	}{
		{"tmux 3.2a", true, 3, 2, "3.2a", true},
		{"tmux 3.3a", true, 3, 3, "3.3a", true},
		// Exactly 3.4 is NOT below the floor — the >= comparison is
		// load-bearing (Ubuntu 24.04 ships exactly 3.4).
		{"tmux 3.4", true, 3, 4, "3.4", false},
		{"tmux 3.6a", true, 3, 6, "3.6a", false},
		{"tmux 4.0", true, 4, 0, "4.0", false},
		{"tmux 2.9a", true, 2, 9, "2.9a", true},
		{"tmux 3.0", true, 3, 0, "3.0", true},
		{"tmux 3.4\n", true, 3, 4, "3.4", false},
		// Non-release shapes parse as unknown — never a warning, never a block.
		{"tmux next-3.7", false, 0, 0, "", false},
		{"tmux 3.2a-3ubuntu1", false, 0, 0, "", false},
		{"tmux master", false, 0, 0, "", false},
		{"", false, 0, 0, "", false},
		{"garbage", false, 0, 0, "", false},
	}
	for _, tc := range cases {
		t.Run(tc.output, func(t *testing.T) {
			v, ok := ParseVersion(tc.output)
			if ok != tc.wantOK {
				t.Fatalf("ParseVersion(%q) ok = %v, want %v", tc.output, ok, tc.wantOK)
			}
			if !ok {
				return
			}
			if v.Major != tc.wantMajor || v.Minor != tc.wantMinor || v.Raw != tc.wantRaw {
				t.Errorf("ParseVersion(%q) = %+v, want %d.%d raw %q", tc.output, v, tc.wantMajor, tc.wantMinor, tc.wantRaw)
			}
			if v.BelowFloor() != tc.wantBelow {
				t.Errorf("ParseVersion(%q).BelowFloor() = %v, want %v", tc.output, v.BelowFloor(), tc.wantBelow)
			}
		})
	}
}

// TestCurrentVersion_ProbeFailureIsUnknown proves a failed probe (tmux
// present but `-V` errors/times out) yields unknown rather than propagating
// an error — unknown never warns and never blocks. A pre-canceled context
// fails the exec immediately, so no real tmux is required.
func TestCurrentVersion_ProbeFailureIsUnknown(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, ok := CurrentVersion(ctx); ok {
		t.Error("CurrentVersion with a canceled ctx must report unknown")
	}
}
