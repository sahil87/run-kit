package tmux

import (
	"fmt"
	"strings"
	"testing"
)

// Helper to build a tab-delimited tmux line.
func sessionLine(name, grouped, group string) string {
	return strings.Join([]string{name, grouped, group}, listDelim)
}

func windowLine(index int, name, path string, activityTs int64, active int) string {
	return fmt.Sprintf("%d%s%s%s%s%s%d%s%d",
		index, listDelim, name, listDelim, path, listDelim, activityTs, listDelim, active)
}

func TestParseSessions(t *testing.T) {
	tests := []struct {
		name  string
		lines []string
		want  []string
	}{
		{
			name: "standard sessions with session_grouped=0",
			lines: []string{
				sessionLine("alpha", "0", "alpha"),
				sessionLine("beta", "0", "beta"),
			},
			want: []string{"alpha", "beta"},
		},
		{
			name: "filters out session-group copies (grouped=1, name != group)",
			lines: []string{
				sessionLine("devshell", "0", "devshell"),
				sessionLine("devshell-82", "1", "devshell"),
			},
			want: []string{"devshell"},
		},
		{
			name: "keeps group-named session (grouped=1, name == group)",
			lines: []string{
				sessionLine("mygroup", "1", "mygroup"),
			},
			want: []string{"mygroup"},
		},
		{
			name:  "empty input returns nil",
			lines: nil,
			want:  nil,
		},
		{
			name:  "empty slice returns nil",
			lines: []string{},
			want:  nil,
		},
		{
			name: "malformed line with fewer than 3 fields is skipped",
			lines: []string{
				"onlyname",
				sessionLine("good", "0", "good"),
			},
			want: []string{"good"},
		},
		{
			name: "multiple session-group copies filtered, original kept",
			lines: []string{
				sessionLine("proj", "0", "proj"),
				sessionLine("proj-1", "1", "proj"),
				sessionLine("proj-2", "1", "proj"),
			},
			want: []string{"proj"},
		},
		{
			name: "mixed grouped and ungrouped sessions",
			lines: []string{
				sessionLine("alpha", "0", "alpha"),
				sessionLine("beta", "1", "beta"),
				sessionLine("beta-N", "1", "beta"),
				sessionLine("gamma", "0", "gamma"),
			},
			want: []string{"alpha", "beta", "gamma"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := parseSessions(tt.lines)
			if !stringSliceEqual(got, tt.want) {
				t.Errorf("parseSessions() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestParseWindows(t *testing.T) {
	const fakeNow int64 = 1700000000

	tests := []struct {
		name  string
		lines []string
		now   int64
		want  []WindowInfo
	}{
		{
			name: "marks window as active when within threshold",
			lines: []string{
				windowLine(0, "dev", "/home/user/project", fakeNow-1, 1),
			},
			now: fakeNow,
			want: []WindowInfo{
				{Index: 0, Name: "dev", WorktreePath: "/home/user/project", Activity: "active", IsActiveWindow: true},
			},
		},
		{
			name: "marks window as idle when beyond threshold",
			lines: []string{
				windowLine(0, "dev", "/home/user/project", fakeNow-ActivityThresholdSeconds-100, 0),
			},
			now: fakeNow,
			want: []WindowInfo{
				{Index: 0, Name: "dev", WorktreePath: "/home/user/project", Activity: "idle", IsActiveWindow: false},
			},
		},
		{
			name: "parses all fields correctly including isActiveWindow",
			lines: []string{
				windowLine(0, "dev", "/home/user/project", fakeNow, 1),
				windowLine(2, "build", "/tmp/build", fakeNow, 0),
			},
			now: fakeNow,
			want: []WindowInfo{
				{Index: 0, Name: "dev", WorktreePath: "/home/user/project", Activity: "active", IsActiveWindow: true},
				{Index: 2, Name: "build", WorktreePath: "/tmp/build", Activity: "active", IsActiveWindow: false},
			},
		},
		{
			name:  "empty input returns nil",
			lines: nil,
			now:   fakeNow,
			want:  nil,
		},
		{
			name: "malformed line with fewer than 5 fields is skipped",
			lines: []string{
				"0\tdev\t/path",
				windowLine(1, "good", "/home/user", fakeNow, 1),
			},
			now: fakeNow,
			want: []WindowInfo{
				{Index: 1, Name: "good", WorktreePath: "/home/user", Activity: "active", IsActiveWindow: true},
			},
		},
		{
			name: "activity exactly at threshold boundary is active",
			lines: []string{
				windowLine(0, "edge", "/path", fakeNow-ActivityThresholdSeconds, 0),
			},
			now: fakeNow,
			want: []WindowInfo{
				{Index: 0, Name: "edge", WorktreePath: "/path", Activity: "active", IsActiveWindow: false},
			},
		},
		{
			name: "activity one second past threshold is idle",
			lines: []string{
				windowLine(0, "past", "/path", fakeNow-ActivityThresholdSeconds-1, 0),
			},
			now: fakeNow,
			want: []WindowInfo{
				{Index: 0, Name: "past", WorktreePath: "/path", Activity: "idle", IsActiveWindow: false},
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := parseWindows(tt.lines, tt.now)
			if tt.want == nil {
				if got != nil {
					t.Errorf("parseWindows() = %v, want nil", got)
				}
				return
			}
			if len(got) != len(tt.want) {
				t.Fatalf("parseWindows() returned %d windows, want %d", len(got), len(tt.want))
			}
			for i := range got {
				if got[i].Index != tt.want[i].Index {
					t.Errorf("window[%d].Index = %d, want %d", i, got[i].Index, tt.want[i].Index)
				}
				if got[i].Name != tt.want[i].Name {
					t.Errorf("window[%d].Name = %q, want %q", i, got[i].Name, tt.want[i].Name)
				}
				if got[i].WorktreePath != tt.want[i].WorktreePath {
					t.Errorf("window[%d].WorktreePath = %q, want %q", i, got[i].WorktreePath, tt.want[i].WorktreePath)
				}
				if got[i].Activity != tt.want[i].Activity {
					t.Errorf("window[%d].Activity = %q, want %q", i, got[i].Activity, tt.want[i].Activity)
				}
				if got[i].IsActiveWindow != tt.want[i].IsActiveWindow {
					t.Errorf("window[%d].IsActiveWindow = %v, want %v", i, got[i].IsActiveWindow, tt.want[i].IsActiveWindow)
				}
			}
		})
	}
}

// stringSliceEqual compares two string slices, treating nil and empty as equivalent.
func stringSliceEqual(a, b []string) bool {
	if len(a) == 0 && len(b) == 0 {
		// Both nil or empty
		if a == nil && b == nil {
			return true
		}
		if a == nil && len(b) == 0 {
			return true
		}
		if b == nil && len(a) == 0 {
			return true
		}
		return len(a) == len(b)
	}
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
