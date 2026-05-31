package tmux

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

// Helper to build a tab-delimited tmux line.
func sessionLine(name, grouped, group string) string {
	return strings.Join([]string{name, grouped, group, "0"}, listDelim)
}

func sessionLineGrouped(name, grouped, group string, groupSize int) string {
	return strings.Join([]string{name, grouped, group, strconv.Itoa(groupSize)}, listDelim)
}

func sessionLineColor(name, grouped, group, color string) string {
	return strings.Join([]string{name, grouped, group, "0", color}, listDelim)
}

func intPtr(n int) *int { return &n }

func windowLine(windowID string, index int, name, path string, activityTs int64, active int, paneCmd string) string {
	return fmt.Sprintf("%s%s%d%s%s%s%s%s%d%s%d%s%s%s",
		windowID, listDelim, index, listDelim, name, listDelim, path, listDelim, activityTs, listDelim, active, listDelim, paneCmd, listDelim)
}

func windowLineColor(windowID string, index int, name, path string, activityTs int64, active int, paneCmd string, color string) string {
	return fmt.Sprintf("%s%s%d%s%s%s%s%s%d%s%d%s%s%s%s",
		windowID, listDelim, index, listDelim, name, listDelim, path, listDelim, activityTs, listDelim, active, listDelim, paneCmd, listDelim, color)
}

// windowLine9 builds a 10-field tab-delimited tmux line including color, rkType and rkUrl.
func windowLine9(windowID string, index int, name, path string, activityTs int64, active int, paneCmd, rkType, rkUrl string) string {
	return fmt.Sprintf("%s%s%d%s%s%s%s%s%d%s%d%s%s%s%s%s%s%s%s",
		windowID, listDelim, index, listDelim, name, listDelim, path, listDelim, activityTs, listDelim, active, listDelim, paneCmd, listDelim, "" /*@color*/, listDelim, rkType, listDelim, rkUrl)
}

func TestParseSessions(t *testing.T) {
	tests := []struct {
		name  string
		lines []string
		want  []SessionInfo
	}{
		{
			name: "standard sessions with session_grouped=0",
			lines: []string{
				sessionLine("alpha", "0", "alpha"),
				sessionLine("beta", "0", "beta"),
			},
			want: []SessionInfo{{Name: "alpha"}, {Name: "beta"}},
		},
		{
			name: "filters out session-group copies (grouped=1, name != group, size > 1)",
			lines: []string{
				sessionLineGrouped("devshell", "1", "devshell", 2),
				sessionLineGrouped("devshell-82", "1", "devshell", 2),
			},
			want: []SessionInfo{{Name: "devshell"}},
		},
		{
			name: "keeps group-named session (grouped=1, name == group)",
			lines: []string{
				sessionLineGrouped("mygroup", "1", "mygroup", 1),
			},
			want: []SessionInfo{{Name: "mygroup"}},
		},
		{
			name: "keeps sole group member after rename (grouped=1, name != group, size == 1)",
			lines: []string{
				sessionLine("other", "0", "other"),
				sessionLineGrouped("run-kit-lane", "1", "run-kit-lanes", 1),
			},
			want: []SessionInfo{{Name: "other"}, {Name: "run-kit-lane"}},
		},
		{
			name: "renamed leader in multi-member group — first member kept as representative",
			lines: []string{
				sessionLineGrouped("shell", "1", "devshell", 2),
				sessionLineGrouped("devshell-82", "1", "devshell", 2),
			},
			want: []SessionInfo{{Name: "shell"}},
		},
		{
			name: "renamed leader in 3-member group — only first member kept",
			lines: []string{
				sessionLineGrouped("renamed", "1", "original", 3),
				sessionLineGrouped("original-1", "1", "original", 3),
				sessionLineGrouped("original-2", "1", "original", 3),
			},
			want: []SessionInfo{{Name: "renamed"}},
		},
		{
			name: "two independent groups — one with renamed leader, one normal",
			lines: []string{
				sessionLineGrouped("alpha", "1", "alpha", 2),
				sessionLineGrouped("alpha-copy", "1", "alpha", 2),
				sessionLineGrouped("new-beta", "1", "beta", 2),
				sessionLineGrouped("beta-copy", "1", "beta", 2),
			},
			want: []SessionInfo{{Name: "alpha"}, {Name: "new-beta"}},
		},
		{
			name: "group with leader plus ungrouped sessions — only leader kept from group",
			lines: []string{
				sessionLine("standalone", "0", ""),
				sessionLineGrouped("grp", "1", "grp", 2),
				sessionLineGrouped("grp-copy", "1", "grp", 2),
			},
			want: []SessionInfo{{Name: "standalone"}, {Name: "grp"}},
		},
		{
			name: "sole group member with color preserved after rename",
			lines: []string{
				strings.Join([]string{"renamed-sess", "1", "old-sess", "1", "7"}, listDelim),
			},
			want: []SessionInfo{{Name: "renamed-sess", Color: intPtr(7)}},
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
			name: "malformed line with fewer than 2 fields is skipped",
			lines: []string{
				"onlyname",
				sessionLine("good", "0", "good"),
			},
			want: []SessionInfo{{Name: "good"}},
		},
		{
			name: "ungrouped session with no session_group field (2 fields only)",
			lines: []string{
				"mysession\t0",
			},
			want: []SessionInfo{{Name: "mysession"}},
		},
		{
			name: "multiple session-group copies filtered, original kept",
			lines: []string{
				sessionLineGrouped("proj", "1", "proj", 3),
				sessionLineGrouped("proj-1", "1", "proj", 3),
				sessionLineGrouped("proj-2", "1", "proj", 3),
			},
			want: []SessionInfo{{Name: "proj"}},
		},
		{
			name: "mixed grouped and ungrouped sessions",
			lines: []string{
				sessionLine("alpha", "0", "alpha"),
				sessionLineGrouped("beta", "1", "beta", 2),
				sessionLineGrouped("beta-N", "1", "beta", 2),
				sessionLine("gamma", "0", "gamma"),
			},
			want: []SessionInfo{{Name: "alpha"}, {Name: "beta"}, {Name: "gamma"}},
		},
		{
			name: "session with @color set",
			lines: []string{
				sessionLineColor("alpha", "0", "alpha", "4"),
				sessionLineColor("beta", "0", "beta", ""),
			},
			want: []SessionInfo{{Name: "alpha", Color: intPtr(4)}, {Name: "beta"}},
		},
		{
			name: "filters rk-relay-* ephemerals from user-facing list",
			lines: []string{
				sessionLine("agent", "0", "agent"),
				sessionLine("rk-relay-deadbeef", "0", "rk-relay-deadbeef"),
				sessionLine("dev", "0", "dev"),
			},
			want: []SessionInfo{{Name: "agent"}, {Name: "dev"}},
		},
		{
			name: "rk-relay-* exclusion still allows group leaders to be kept",
			lines: []string{
				sessionLineGrouped("devshell", "1", "devshell", 2),
				sessionLineGrouped("devshell-82", "1", "devshell", 2),
				sessionLine("rk-relay-cafebabe", "0", "rk-relay-cafebabe"),
			},
			want: []SessionInfo{{Name: "devshell"}},
		},
		{
			name: "only rk-relay-* sessions present returns nil",
			lines: []string{
				sessionLine("rk-relay-aaaa1111", "0", "rk-relay-aaaa1111"),
				sessionLine("rk-relay-bbbb2222", "0", "rk-relay-bbbb2222"),
			},
			want: nil,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := parseSessions(tt.lines)
			if !sessionInfoSliceEqual(got, tt.want) {
				t.Errorf("parseSessions() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestParseSessionsMultiServer(t *testing.T) {
	// Simulate merging results from both servers as ListSessions does.
	runkitLines := []string{
		sessionLine("alpha", "0", "alpha"),
		sessionLine("beta", "0", "beta"),
	}
	defaultLines := []string{
		sessionLine("gamma", "0", "gamma"),
	}

	runkitSessions := parseSessions(runkitLines)
	defaultSessions := parseSessions(defaultLines)
	all := append(runkitSessions, defaultSessions...)

	want := []SessionInfo{
		{Name: "alpha"},
		{Name: "beta"},
		{Name: "gamma"},
	}

	if !sessionInfoSliceEqual(all, want) {
		t.Errorf("multi-server merge = %v, want %v", all, want)
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
				windowLine("@0", 0, "dev", "/home/user/project", fakeNow-1, 1, "claude"),
			},
			now: fakeNow,
			want: []WindowInfo{
				{Index: 0, WindowID: "@0", Name: "dev", WorktreePath: "/home/user/project", Activity: "active", IsActiveWindow: true, PaneCommand: "claude", ActivityTimestamp: fakeNow - 1},
			},
		},
		{
			name: "marks window as idle when beyond threshold",
			lines: []string{
				windowLine("@1", 0, "dev", "/home/user/project", fakeNow-ActivityThresholdSeconds-100, 0, "zsh"),
			},
			now: fakeNow,
			want: []WindowInfo{
				{Index: 0, WindowID: "@1", Name: "dev", WorktreePath: "/home/user/project", Activity: "idle", IsActiveWindow: false, PaneCommand: "zsh", ActivityTimestamp: fakeNow - ActivityThresholdSeconds - 100},
			},
		},
		{
			name: "parses all fields correctly including isActiveWindow and paneCommand",
			lines: []string{
				windowLine("@0", 0, "dev", "/home/user/project", fakeNow, 1, "claude"),
				windowLine("@2", 2, "build", "/tmp/build", fakeNow, 0, "make"),
			},
			now: fakeNow,
			want: []WindowInfo{
				{Index: 0, WindowID: "@0", Name: "dev", WorktreePath: "/home/user/project", Activity: "active", IsActiveWindow: true, PaneCommand: "claude", ActivityTimestamp: fakeNow},
				{Index: 2, WindowID: "@2", Name: "build", WorktreePath: "/tmp/build", Activity: "active", IsActiveWindow: false, PaneCommand: "make", ActivityTimestamp: fakeNow},
			},
		},
		{
			name:  "empty input returns nil",
			lines: nil,
			now:   fakeNow,
			want:  nil,
		},
		{
			name: "malformed line with fewer than 8 fields is skipped",
			lines: []string{
				"@0\t0\tdev\t/path\t1700000000\t1\tzsh",
				windowLine("@1", 1, "good", "/home/user", fakeNow, 1, "zsh"),
			},
			now: fakeNow,
			want: []WindowInfo{
				{Index: 1, WindowID: "@1", Name: "good", WorktreePath: "/home/user", Activity: "active", IsActiveWindow: true, PaneCommand: "zsh", ActivityTimestamp: fakeNow},
			},
		},
		{
			name: "activity exactly at threshold boundary is active",
			lines: []string{
				windowLine("@0", 0, "edge", "/path", fakeNow-ActivityThresholdSeconds, 0, "bash"),
			},
			now: fakeNow,
			want: []WindowInfo{
				{Index: 0, WindowID: "@0", Name: "edge", WorktreePath: "/path", Activity: "active", IsActiveWindow: false, PaneCommand: "bash", ActivityTimestamp: fakeNow - ActivityThresholdSeconds},
			},
		},
		{
			name: "activity one second past threshold is idle",
			lines: []string{
				windowLine("@0", 0, "past", "/path", fakeNow-ActivityThresholdSeconds-1, 0, "vim"),
			},
			now: fakeNow,
			want: []WindowInfo{
				{Index: 0, WindowID: "@0", Name: "past", WorktreePath: "/path", Activity: "idle", IsActiveWindow: false, PaneCommand: "vim", ActivityTimestamp: fakeNow - ActivityThresholdSeconds - 1},
			},
		},
		{
			name: "paneCommand populated from 7th field",
			lines: []string{
				windowLine("@0", 0, "work", "/home/user/code", fakeNow, 1, "node"),
			},
			now: fakeNow,
			want: []WindowInfo{
				{Index: 0, WindowID: "@0", Name: "work", WorktreePath: "/home/user/code", Activity: "active", IsActiveWindow: true, PaneCommand: "node", ActivityTimestamp: fakeNow},
			},
		},
		{
			name: "activityTimestamp exposed as raw unix epoch",
			lines: []string{
				windowLine("@0", 0, "ts", "/path", 1710300000, 0, "zsh"),
			},
			now: 1710300100,
			want: []WindowInfo{
				{Index: 0, WindowID: "@0", Name: "ts", WorktreePath: "/path", Activity: "idle", IsActiveWindow: false, PaneCommand: "zsh", ActivityTimestamp: 1710300000},
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
				if got[i].WindowID != tt.want[i].WindowID {
					t.Errorf("window[%d].WindowID = %q, want %q", i, got[i].WindowID, tt.want[i].WindowID)
				}
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
				if got[i].PaneCommand != tt.want[i].PaneCommand {
					t.Errorf("window[%d].PaneCommand = %q, want %q", i, got[i].PaneCommand, tt.want[i].PaneCommand)
				}
				if got[i].ActivityTimestamp != tt.want[i].ActivityTimestamp {
					t.Errorf("window[%d].ActivityTimestamp = %d, want %d", i, got[i].ActivityTimestamp, tt.want[i].ActivityTimestamp)
				}
			}
		})
	}
}

func TestParseWindowsTrailingEmptyFields(t *testing.T) {
	// Regression test: tmux format output ends with empty fields (e.g., @color, @rk_type,
	// @rk_url unset). When the last line's trailing tabs are stripped (as strings.TrimSpace
	// does), the field count drops below 8 and the window is silently lost.
	const fakeNow int64 = 1700000000

	// Simulate the real 10-field tmux format where @color, @rk_type, @rk_url are empty.
	// Each field is tab-separated; empty trailing fields produce trailing tabs.
	fullLine := func(windowID string, index int, name string) string {
		return fmt.Sprintf("%s\t%d\t%s\t/path\t%d\t0\tzsh\t\t\t", windowID, index, name, fakeNow)
	}
	// Damaged line: trailing tabs stripped (simulates old TrimSpace bug on the last line).
	damagedLine := func(windowID string, index int, name string) string {
		return fmt.Sprintf("%s\t%d\t%s\t/path\t%d\t0\tzsh", windowID, index, name, fakeNow)
	}

	t.Run("full trailing tabs parsed correctly", func(t *testing.T) {
		lines := []string{
			fullLine("@0", 0, "first"),
			fullLine("@1", 1, "last"),
		}
		got := parseWindows(lines, fakeNow)
		if len(got) != 2 {
			t.Fatalf("parseWindows() returned %d windows, want 2", len(got))
		}
		if got[1].Name != "last" {
			t.Errorf("window[1].Name = %q, want %q", got[1].Name, "last")
		}
	})

	t.Run("damaged last line drops window", func(t *testing.T) {
		// This demonstrates the bug: the last line has only 7 fields after
		// trailing tabs are stripped, so parseWindows skips it.
		lines := []string{
			fullLine("@0", 0, "first"),
			damagedLine("@1", 1, "last"),
		}
		got := parseWindows(lines, fakeNow)
		if len(got) != 1 {
			t.Fatalf("parseWindows() returned %d windows, want 1 (damaged line dropped)", len(got))
		}
	})
}

func TestParseWindowsWithRkFields(t *testing.T) {
	const fakeNow int64 = 1700000000

	tests := []struct {
		name     string
		lines    []string
		wantType string
		wantUrl  string
	}{
		{
			name: "iframe window with rkType and rkUrl",
			lines: []string{
				windowLine9("@0", 0, "docs", "/home/user", fakeNow, 1, "zsh", "iframe", "http://localhost:8080/docs"),
			},
			wantType: "iframe",
			wantUrl:  "http://localhost:8080/docs",
		},
		{
			name: "terminal window with empty rk fields",
			lines: []string{
				windowLine9("@0", 0, "dev", "/home/user", fakeNow, 1, "zsh", "", ""),
			},
			wantType: "",
			wantUrl:  "",
		},
		{
			name: "7-field line (old format) has empty rk fields",
			lines: []string{
				windowLine("@0", 0, "dev", "/home/user", fakeNow, 1, "zsh"),
			},
			wantType: "",
			wantUrl:  "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := parseWindows(tt.lines, fakeNow)
			if len(got) != 1 {
				t.Fatalf("parseWindows() returned %d windows, want 1", len(got))
			}
			if got[0].RkType != tt.wantType {
				t.Errorf("RkType = %q, want %q", got[0].RkType, tt.wantType)
			}
			if got[0].RkUrl != tt.wantUrl {
				t.Errorf("RkUrl = %q, want %q", got[0].RkUrl, tt.wantUrl)
			}
		})
	}
}

func TestParseWindowsMixedTypes(t *testing.T) {
	const fakeNow int64 = 1700000000

	lines := []string{
		windowLine9("@0", 0, "terminal", "/home/user", fakeNow, 1, "zsh", "", ""),
		windowLine9("@1", 1, "docs", "/home/user", fakeNow, 0, "python", "iframe", "http://localhost:8080/docs"),
		windowLine9("@2", 2, "shell", "/tmp", fakeNow, 0, "bash", "", ""),
	}

	got := parseWindows(lines, fakeNow)
	if len(got) != 3 {
		t.Fatalf("parseWindows() returned %d windows, want 3", len(got))
	}
	if got[0].RkType != "" {
		t.Errorf("window 0 RkType = %q, want empty", got[0].RkType)
	}
	if got[1].RkType != "iframe" {
		t.Errorf("window 1 RkType = %q, want %q", got[1].RkType, "iframe")
	}
	if got[1].RkUrl != "http://localhost:8080/docs" {
		t.Errorf("window 1 RkUrl = %q, want %q", got[1].RkUrl, "http://localhost:8080/docs")
	}
	if got[2].RkType != "" {
		t.Errorf("window 2 RkType = %q, want empty", got[2].RkType)
	}
}

// paneLine builds a 6-field tab-delimited list-panes line.
func paneLine(windowIndex int, paneID string, paneIndex int, cwd, command string, active int) string {
	return fmt.Sprintf("%d%s%s%s%d%s%s%s%s%s%d",
		windowIndex, listDelim, paneID, listDelim, paneIndex, listDelim, cwd, listDelim, command, listDelim, active)
}

// totalPanes sums the number of panes across all windows in the map.
func totalPanes(byWindow map[int][]PaneInfo) int {
	n := 0
	for _, panes := range byWindow {
		n += len(panes)
	}
	return n
}

func TestParsePanes(t *testing.T) {
	t.Run("empty input returns nil", func(t *testing.T) {
		byWindow := parsePanes(nil)
		if byWindow != nil {
			t.Errorf("parsePanes(nil) byWindow = %v, want nil", byWindow)
		}
	})

	t.Run("empty slice returns nil", func(t *testing.T) {
		byWindow := parsePanes([]string{})
		if byWindow != nil {
			t.Errorf("parsePanes([]) byWindow = %v, want nil", byWindow)
		}
	})

	t.Run("standard parse: single pane", func(t *testing.T) {
		lines := []string{
			paneLine(0, "%8", 1, "/home/user/code", "zsh", 0),
		}
		byWindow := parsePanes(lines)
		if totalPanes(byWindow) != 1 {
			t.Fatalf("parsePanes() returned %d total panes, want 1", totalPanes(byWindow))
		}
		if byWindow[0] == nil || len(byWindow[0]) != 1 {
			t.Errorf("byWindow[0] = %v, want 1 pane", byWindow[0])
		}
		p := byWindow[0][0]
		if p.PaneID != "%8" {
			t.Errorf("PaneID = %q, want %%8", p.PaneID)
		}
		if p.PaneIndex != 1 {
			t.Errorf("PaneIndex = %d, want 1", p.PaneIndex)
		}
		if p.Cwd != "/home/user/code" {
			t.Errorf("Cwd = %q, want /home/user/code", p.Cwd)
		}
		if p.Command != "zsh" {
			t.Errorf("Command = %q, want zsh", p.Command)
		}
		if p.IsActive {
			t.Errorf("IsActive = true, want false")
		}
	})

	t.Run("active pane flag parsed correctly", func(t *testing.T) {
		lines := []string{
			paneLine(0, "%5", 0, "/tmp", "bash", 1),
		}
		byWindow := parsePanes(lines)
		if totalPanes(byWindow) != 1 {
			t.Fatalf("expected 1 total pane, got %d", totalPanes(byWindow))
		}
		if !byWindow[0][0].IsActive {
			t.Error("IsActive = false, want true")
		}
	})

	t.Run("malformed line with fewer than 6 fields is skipped", func(t *testing.T) {
		lines := []string{
			"0\t%1\t0\t/tmp",                              // only 4 fields
			paneLine(1, "%2", 0, "/home/user", "zsh", 0), // valid
		}
		byWindow := parsePanes(lines)
		if totalPanes(byWindow) != 1 {
			t.Fatalf("parsePanes() returned %d total panes, want 1", totalPanes(byWindow))
		}
		if byWindow[0] != nil {
			t.Errorf("byWindow[0] should be nil (malformed line for window 0), got %v", byWindow[0])
		}
		if len(byWindow[1]) != 1 {
			t.Errorf("byWindow[1] = %v, want 1 pane", byWindow[1])
		}
		if byWindow[1][0].PaneID != "%2" {
			t.Errorf("PaneID = %q, want %%2", byWindow[1][0].PaneID)
		}
	})

	t.Run("panes grouped by window index", func(t *testing.T) {
		// Window 0: panes %0, %1; Window 1: pane %2
		lines := []string{
			paneLine(0, "%0", 0, "/tmp/a", "zsh", 1),
			paneLine(0, "%1", 1, "/tmp/b", "vim", 0),
			paneLine(1, "%2", 0, "/tmp/c", "bash", 0),
		}
		byWindow := parsePanes(lines)
		if totalPanes(byWindow) != 3 {
			t.Fatalf("parsePanes() returned %d total panes, want 3", totalPanes(byWindow))
		}
		if len(byWindow[0]) != 2 {
			t.Errorf("byWindow[0] = %d panes, want 2", len(byWindow[0]))
		}
		if len(byWindow[1]) != 1 {
			t.Errorf("byWindow[1] = %d panes, want 1", len(byWindow[1]))
		}
		if byWindow[0][0].PaneID != "%0" {
			t.Errorf("byWindow[0][0].PaneID = %q, want %%0", byWindow[0][0].PaneID)
		}
		if byWindow[0][1].PaneID != "%1" {
			t.Errorf("byWindow[0][1].PaneID = %q, want %%1", byWindow[0][1].PaneID)
		}
		if byWindow[1][0].PaneID != "%2" {
			t.Errorf("byWindow[1][0].PaneID = %q, want %%2", byWindow[1][0].PaneID)
		}
	})

	t.Run("all malformed lines returns nil", func(t *testing.T) {
		lines := []string{"bad", "also\tbad\tonly\tthree"}
		byWindow := parsePanes(lines)
		if byWindow != nil {
			t.Errorf("parsePanes() byWindow = %v, want nil", byWindow)
		}
	})
}

func TestSanitizeEnv(t *testing.T) {
	tests := []struct {
		name    string
		input   []string
		wantHas []string // entries that must be present
		wantNot []string // prefixes that must be absent
	}{
		{
			name:    "replaces PATH and strips DIRENV vars",
			input:   []string{"HOME=/home/user", "PATH=/dirty/path:/usr/bin", "DIRENV_DIFF=abc", "DIRENV_DIR=/foo", "SHELL=/bin/zsh"},
			wantHas: []string{"HOME=/home/user", "PATH=" + cleanPATH, "SHELL=/bin/zsh"},
			wantNot: []string{"DIRENV_", "/dirty/path"},
		},
		{
			name:    "adds PATH when missing",
			input:   []string{"HOME=/home/user", "SHELL=/bin/zsh"},
			wantHas: []string{"HOME=/home/user", "PATH=" + cleanPATH, "SHELL=/bin/zsh"},
			wantNot: nil,
		},
		{
			name:    "deduplicates multiple PATH entries",
			input:   []string{"PATH=/first", "PATH=/second"},
			wantHas: []string{"PATH=" + cleanPATH},
			wantNot: []string{"/first", "/second"},
		},
		{
			name:    "empty input still has PATH",
			input:   nil,
			wantHas: []string{"PATH=" + cleanPATH},
			wantNot: nil,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := sanitizeEnv(tt.input)

			for _, want := range tt.wantHas {
				found := false
				for _, e := range got {
					if e == want {
						found = true
						break
					}
				}
				if !found {
					t.Errorf("missing expected entry %q in %v", want, got)
				}
			}

			for _, prefix := range tt.wantNot {
				for _, e := range got {
					if strings.Contains(e, prefix) {
						t.Errorf("unexpected entry %q containing %q", e, prefix)
					}
				}
			}

			// PATH should appear exactly once.
			pathCount := 0
			for _, e := range got {
				if strings.HasPrefix(e, "PATH=") {
					pathCount++
				}
			}
			if pathCount != 1 {
				t.Errorf("PATH appears %d times, want 1", pathCount)
			}
		})
	}
}

func TestEnsureConfigCreatesDropInDir(t *testing.T) {
	tmpDir := t.TempDir()
	origDefault := DefaultConfigPath
	defer func() { DefaultConfigPath = origDefault }()
	DefaultConfigPath = filepath.Join(tmpDir, ".rk", "tmux.conf")

	// Fresh install — both config and tmux.d/ should be created.
	if err := EnsureConfig(); err != nil {
		t.Fatalf("EnsureConfig() error: %v", err)
	}
	dropInDir := filepath.Join(tmpDir, ".rk", "tmux.d")
	fi, err := os.Stat(dropInDir)
	if os.IsNotExist(err) {
		t.Error("tmux.d/ not created on fresh install")
	} else if err != nil {
		t.Fatalf("stat tmux.d/: %v", err)
	} else if !fi.IsDir() {
		t.Error("tmux.d/ exists but is not a directory")
	}
	if _, err := os.Stat(DefaultConfigPath); os.IsNotExist(err) {
		t.Error("tmux.conf not created on fresh install")
	}

	// Remove tmux.d/ but keep config — EnsureConfig should recreate tmux.d/.
	if err := os.RemoveAll(dropInDir); err != nil {
		t.Fatalf("failed to remove tmux.d/: %v", err)
	}
	if err := EnsureConfig(); err != nil {
		t.Fatalf("EnsureConfig() second call error: %v", err)
	}
	fi, err = os.Stat(dropInDir)
	if os.IsNotExist(err) {
		t.Error("tmux.d/ not recreated when config exists but dir missing")
	} else if err != nil {
		t.Fatalf("stat tmux.d/: %v", err)
	} else if !fi.IsDir() {
		t.Error("tmux.d/ exists but is not a directory after recreation")
	}
}

func TestForceWriteConfigCreatesDropInDir(t *testing.T) {
	tmpDir := t.TempDir()
	origDefault := DefaultConfigPath
	defer func() { DefaultConfigPath = origDefault }()
	DefaultConfigPath = filepath.Join(tmpDir, ".rk", "tmux.conf")

	if err := ForceWriteConfig(); err != nil {
		t.Fatalf("ForceWriteConfig() error: %v", err)
	}
	dropInDir := filepath.Join(tmpDir, ".rk", "tmux.d")
	fi, err := os.Stat(dropInDir)
	if os.IsNotExist(err) {
		t.Error("tmux.d/ not created by ForceWriteConfig")
	} else if err != nil {
		t.Fatalf("stat tmux.d/: %v", err)
	} else if !fi.IsDir() {
		t.Error("tmux.d/ exists but is not a directory")
	}
}

func TestDefaultConfigContainsSourceDirective(t *testing.T) {
	content := string(DefaultConfigBytes())
	if !strings.Contains(content, "source-file -q ~/.rk/tmux.d/*.conf") {
		t.Error("embedded default config missing source-file directive for tmux.d/")
	}
}

func TestEnsureDropInDirNoHomeDir(t *testing.T) {
	origDefault := DefaultConfigPath
	defer func() { DefaultConfigPath = origDefault }()
	DefaultConfigPath = ""

	// Should be a no-op, not panic.
	ensureDropInDir()
}

// windowID reads the stable tmux window id (@N) for session:index on the
// isolated test server. Fails the test if it cannot be resolved.
func windowID(t *testing.T, server, target string) string {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "tmux", "-L", server, "display-message", "-t", target, "-p", "#{window_id}").CombinedOutput()
	if err != nil {
		t.Fatalf("resolve window id for %q: %v\n%s", target, err, string(out))
	}
	id := strings.TrimSpace(string(out))
	if id == "" {
		t.Fatalf("empty window id for %q", target)
	}
	return id
}

func TestMoveWindow_reordersAndPreservesID(t *testing.T) {
	server := withSessionOrderTmux(t)

	// boot session exists with window 0; add two more so we have 0,1,2.
	for _, name := range []string{"one", "two"} {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		out, err := exec.CommandContext(ctx, "tmux", "-L", server, "new-window", "-t", "boot", "-n", name).CombinedOutput()
		cancel()
		if err != nil {
			t.Fatalf("new-window %q: %v\n%s", name, err, string(out))
		}
	}

	// Capture the stable id of the window currently at index 2, then move it to
	// index 0. The reorder is positional (bubble-swap), but tmux preserves the
	// window id across the move — the contract this migration relies on.
	id := windowID(t, server, "boot:2")

	if err := MoveWindow(id, 0, server); err != nil {
		t.Fatalf("MoveWindow(%q -> 0): %v", id, err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	gotSession, gotIndex, err := resolveWindowSessionIndex(ctx, server, id)
	if err != nil {
		t.Fatalf("resolve after move: %v", err)
	}
	if gotIndex != 0 {
		t.Errorf("after MoveWindow: index = %d, want 0", gotIndex)
	}
	if gotSession != "boot" {
		t.Errorf("after MoveWindow: session = %q, want %q", gotSession, "boot")
	}
}

// windowOption reads a user-defined window option for target via show-options,
// returning ("", false) when the option is unset.
func windowOption(t *testing.T, server, target, option string) (string, bool) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "tmux", "-L", server, "show-options", "-wqv", "-t", target, option).CombinedOutput()
	if err != nil {
		t.Fatalf("show-options %q for %q: %v\n%s", option, target, err, string(out))
	}
	v := strings.TrimSpace(string(out))
	return v, v != ""
}

// TestMoveWindow_multiStepReorder exercises a reorder that needs ≥2 swaps
// (window at index 4 → index 1 across 6 windows) and asserts the final layout
// plus preserved @N after the single chained invocation.
func TestMoveWindow_multiStepReorder(t *testing.T) {
	server := withSessionOrderTmux(t)

	// boot has window 0; add five more so indices are 0..5.
	for _, name := range []string{"one", "two", "three", "four", "five"} {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		out, err := exec.CommandContext(ctx, "tmux", "-L", server, "new-window", "-t", "boot", "-n", name).CombinedOutput()
		cancel()
		if err != nil {
			t.Fatalf("new-window %q: %v\n%s", name, err, string(out))
		}
	}

	// Move the window at index 4 to index 1 (insert-before). Requires 3 swaps
	// (4↔3, 3↔2, 2↔1) emitted as one chained invocation.
	id := windowID(t, server, "boot:4")
	if err := MoveWindow(id, 1, server); err != nil {
		t.Fatalf("MoveWindow(%q -> 1): %v", id, err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	gotSession, gotIndex, err := resolveWindowSessionIndex(ctx, server, id)
	if err != nil {
		t.Fatalf("resolve after multi-step move: %v", err)
	}
	if gotSession != "boot" {
		t.Errorf("session = %q, want %q", gotSession, "boot")
	}
	// Insert-before semantics: moving index 4 to before index 1 lands it at index 1.
	if gotIndex != 1 {
		t.Errorf("after multi-step MoveWindow: index = %d, want 1", gotIndex)
	}
}

// TestSetWindowOptions_chainedSetAndUnset verifies the chained set-option
// primitive applies a mixed set+unset batch in one invocation against a real
// tmux server.
func TestSetWindowOptions_chainedSetAndUnset(t *testing.T) {
	server := withSessionOrderTmux(t)
	id := windowID(t, server, "boot:0")

	// Pre-set @rk_type so the batch can unset it while setting @color/@rk_url.
	setupCtx, setupCancel := context.WithTimeout(context.Background(), 5*time.Second)
	if out, err := exec.CommandContext(setupCtx, "tmux", "-L", server, "set-option", "-w", "-t", id, "@rk_type", "iframe").CombinedOutput(); err != nil {
		setupCancel()
		t.Fatalf("pre-set @rk_type: %v\n%s", err, string(out))
	}
	setupCancel()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	color := "5"
	url := "https://example.test"
	ops := []WindowOptionOp{
		{Key: "@color", Value: &color},
		{Key: "@rk_url", Value: &url},
		{Key: "@rk_type", Value: nil}, // unset
	}
	if err := SetWindowOptions(ctx, id, server, ops); err != nil {
		t.Fatalf("SetWindowOptions: %v", err)
	}

	if v, ok := windowOption(t, server, id, "@color"); !ok || v != "5" {
		t.Errorf("@color = %q (set=%v), want \"5\"", v, ok)
	}
	if v, ok := windowOption(t, server, id, "@rk_url"); !ok || v != url {
		t.Errorf("@rk_url = %q (set=%v), want %q", v, ok, url)
	}
	if v, ok := windowOption(t, server, id, "@rk_type"); ok {
		t.Errorf("@rk_type = %q, want unset", v)
	}
}

func TestMoveWindowToSession_movesAndPreservesID(t *testing.T) {
	server := withSessionOrderTmux(t)

	// Create the destination session and a source window in the boot session.
	for _, args := range [][]string{
		{"new-session", "-d", "-s", "dst"},
		{"new-window", "-t", "boot", "-n", "mover"},
	} {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		full := append([]string{"-L", server}, args...)
		out, err := exec.CommandContext(ctx, "tmux", full...).CombinedOutput()
		cancel()
		if err != nil {
			t.Fatalf("setup %v: %v\n%s", args, err, string(out))
		}
	}

	id := windowID(t, server, "boot:mover")

	if err := MoveWindowToSession(id, "dst", server); err != nil {
		t.Fatalf("MoveWindowToSession(%q -> dst): %v", id, err)
	}

	// tmux's move-window preserves the window id; only its owning session
	// changes. Verify the same id now resolves to the dst session.
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	gotSession, err := ResolveWindowSession(ctx, server, id)
	if err != nil {
		t.Fatalf("resolve after move-to-session: %v", err)
	}
	if gotSession != "dst" {
		t.Errorf("after MoveWindowToSession: session = %q, want %q", gotSession, "dst")
	}
}

// withSessionOrderTmux starts an isolated tmux server for session-order
// integration tests, runs fn, and cleans up. Skips the test if tmux is
// unavailable. Returns the server name fn should pass to tmux helpers.
func withSessionOrderTmux(t *testing.T) string {
	t.Helper()
	if _, err := exec.LookPath("tmux"); err != nil {
		t.Skip("tmux not available — skipping integration test")
	}
	server := testSocketName("unit")

	// Bootstrap: start a session so the server exists. Server-scoped options
	// require a running server.
	bootCtx, cancelBoot := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelBoot()
	cmd := exec.CommandContext(bootCtx, "tmux", "-L", server, "new-session", "-d", "-s", "boot")
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Skipf("could not start isolated tmux server %q: %v\n%s", server, err, string(out))
	}

	t.Cleanup(func() {
		killCtx, cancelKill := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancelKill()
		_ = exec.CommandContext(killCtx, "tmux", "-L", server, "kill-server").Run()
	})
	return server
}

func TestGetSessionOrder_unsetReturnsEmpty(t *testing.T) {
	server := withSessionOrderTmux(t)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	got, err := GetSessionOrder(ctx, server)
	if err != nil {
		t.Fatalf("GetSessionOrder unset: %v", err)
	}
	if len(got) != 0 {
		t.Errorf("got %v, want empty", got)
	}
}

func TestSetSessionOrder_roundTrip(t *testing.T) {
	server := withSessionOrderTmux(t)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	want := []string{"main", "dev", "scratch"}
	if err := SetSessionOrder(ctx, server, want); err != nil {
		t.Fatalf("SetSessionOrder: %v", err)
	}
	got, err := GetSessionOrder(ctx, server)
	if err != nil {
		t.Fatalf("GetSessionOrder: %v", err)
	}
	if len(got) != len(want) {
		t.Fatalf("len got=%d want=%d (got=%v want=%v)", len(got), len(want), got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("idx %d: got %q want %q", i, got[i], want[i])
		}
	}
}

func TestSetSessionOrder_specialCharacters(t *testing.T) {
	server := withSessionOrderTmux(t)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// JSON-significant characters and non-ASCII. tmux session names cannot
	// contain colons or periods (per validate.ValidateName) and the forbidden
	// shell metacharacter set, so we exercise commas, quotes, backslashes
	// (encoded as \\ in JSON), and unicode — all of which JSON escapes safely.
	want := []string{`foo,bar`, `x"y`, `back\slash`, "café", "α-β"}
	if err := SetSessionOrder(ctx, server, want); err != nil {
		t.Fatalf("SetSessionOrder: %v", err)
	}
	got, err := GetSessionOrder(ctx, server)
	if err != nil {
		t.Fatalf("GetSessionOrder: %v", err)
	}
	if len(got) != len(want) {
		t.Fatalf("len got=%d want=%d", len(got), len(want))
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("idx %d: got %q want %q", i, got[i], want[i])
		}
	}
}

func TestSetSessionOrder_emptySliceRoundTrip(t *testing.T) {
	server := withSessionOrderTmux(t)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := SetSessionOrder(ctx, server, []string{}); err != nil {
		t.Fatalf("SetSessionOrder empty: %v", err)
	}
	got, err := GetSessionOrder(ctx, server)
	if err != nil {
		t.Fatalf("GetSessionOrder: %v", err)
	}
	if len(got) != 0 {
		t.Errorf("got %v, want empty", got)
	}
}

func TestSetSessionOrder_nilTreatedAsEmpty(t *testing.T) {
	server := withSessionOrderTmux(t)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := SetSessionOrder(ctx, server, nil); err != nil {
		t.Fatalf("SetSessionOrder nil: %v", err)
	}
	got, err := GetSessionOrder(ctx, server)
	if err != nil {
		t.Fatalf("GetSessionOrder: %v", err)
	}
	if len(got) != 0 {
		t.Errorf("got %v, want empty", got)
	}
}

func TestGetSessionOrder_invalidJSONReturnsSyntaxError(t *testing.T) {
	server := withSessionOrderTmux(t)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// Plant invalid JSON via raw set-option (bypasses our SetSessionOrder
	// encoder).
	args := append(serverArgs(server), "set-option", "-s", SessionOrderOption, "not-json")
	cmd := exec.CommandContext(ctx, "tmux", args...)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("plant invalid JSON: %v\n%s", err, string(out))
	}

	_, err := GetSessionOrder(ctx, server)
	if err == nil {
		t.Fatal("expected JSON decode error, got nil")
	}
	var syntaxErr *json.SyntaxError
	if !errors.As(err, &syntaxErr) {
		t.Errorf("expected wrapped *json.SyntaxError, got %v", err)
	}
}

// withGroupedSessionTmux starts an isolated tmux server with a "real" session
// containing two windows for the NewGroupedSession integration tests. Skips
// the test if tmux is unavailable. Returns (server, realSession).
func withGroupedSessionTmux(t *testing.T) (string, string) {
	t.Helper()
	if _, err := exec.LookPath("tmux"); err != nil {
		t.Skip("tmux not available — skipping integration test")
	}
	server := testSocketName("unit")
	real := "real"

	bootCtx, cancelBoot := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelBoot()
	cmd := exec.CommandContext(bootCtx, "tmux", "-L", server, "new-session", "-d", "-s", real, "-n", "win0")
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Skipf("could not start isolated tmux server %q: %v\n%s", server, err, string(out))
	}
	// Add a second window so we can verify group window membership is shared.
	addCtx, cancelAdd := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelAdd()
	if out, err := exec.CommandContext(addCtx, "tmux", "-L", server, "new-window", "-t", real, "-n", "win1").CombinedOutput(); err != nil {
		t.Fatalf("create second window: %v\n%s", err, string(out))
	}

	t.Cleanup(func() {
		killCtx, cancelKill := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancelKill()
		_ = exec.CommandContext(killCtx, "tmux", "-L", server, "kill-server").Run()
	})
	return server, real
}

func TestNewGroupedSession_success(t *testing.T) {
	server, real := withGroupedSessionTmux(t)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	ephemeral := "rk-relay-test1234"
	if err := NewGroupedSession(ctx, server, real, ephemeral); err != nil {
		t.Fatalf("NewGroupedSession: %v", err)
	}

	// Ephemeral appears in the raw session list (the user-facing ListSessions
	// filters rk-relay-*, so we use the raw helper).
	names, err := ListRawSessionNames(ctx, server)
	if err != nil {
		t.Fatalf("ListRawSessionNames: %v", err)
	}
	found := false
	for _, n := range names {
		if n == ephemeral {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("ephemeral %q not in raw session list: %v", ephemeral, names)
	}

	// Window membership is shared with the real session.
	winLines, err := tmuxExecServer(ctx, server, "list-windows", "-t", ephemeral, "-F", "#{window_index}")
	if err != nil {
		t.Fatalf("list-windows for ephemeral: %v", err)
	}
	realWinLines, err := tmuxExecServer(ctx, server, "list-windows", "-t", real, "-F", "#{window_index}")
	if err != nil {
		t.Fatalf("list-windows for real: %v", err)
	}
	if len(winLines) != len(realWinLines) {
		t.Errorf("ephemeral has %d windows, real has %d (should be equal in a session group)", len(winLines), len(realWinLines))
	}
	if len(winLines) < 2 {
		t.Errorf("ephemeral has %d windows, expected ≥2 from real session", len(winLines))
	}
}

// Regression: when a relay's ephemeral session is grouped with the real
// session, every window appears under both sessions. ResolveWindowSession
// must return the real (user-facing) session, not the ephemeral — otherwise
// a fresh relay groups itself against a dying ephemeral and tears down with
// it.
func TestResolveWindowSession_skipsEphemeralGroupMember(t *testing.T) {
	server, real := withGroupedSessionTmux(t)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	ephemeral := "rk-relay-resolve-test"
	if err := NewGroupedSession(ctx, server, real, ephemeral); err != nil {
		t.Fatalf("NewGroupedSession: %v", err)
	}

	// Pick a window ID that exists in both group members.
	lines, err := tmuxExecServer(ctx, server, "list-windows", "-t", real, "-F", "#{window_id}")
	if err != nil || len(lines) == 0 {
		t.Fatalf("list-windows on real session: lines=%v err=%v", lines, err)
	}
	id := strings.TrimSpace(lines[0])

	got, err := ResolveWindowSession(ctx, server, id)
	if err != nil {
		t.Fatalf("ResolveWindowSession: %v", err)
	}
	if got != real {
		t.Errorf("ResolveWindowSession(%q) = %q, want %q (ephemeral group member must be skipped)", id, got, real)
	}
}

func TestNewGroupedSession_missingRealSessionFails(t *testing.T) {
	server, _ := withGroupedSessionTmux(t)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	ephemeral := "rk-relay-test5678"
	if err := NewGroupedSession(ctx, server, "ghost", ephemeral); err == nil {
		t.Fatal("expected error when real session does not exist, got nil")
	}

	// Ephemeral must NOT have been created on failure.
	names, err := ListRawSessionNames(ctx, server)
	if err != nil {
		t.Fatalf("ListRawSessionNames: %v", err)
	}
	for _, n := range names {
		if n == ephemeral {
			t.Errorf("ephemeral %q should not exist after failed NewGroupedSession", ephemeral)
		}
	}
}

func TestKillSessionCtx_killsEphemeral(t *testing.T) {
	server, real := withGroupedSessionTmux(t)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	ephemeral := "rk-relay-deadbeef"
	if err := NewGroupedSession(ctx, server, real, ephemeral); err != nil {
		t.Fatalf("NewGroupedSession: %v", err)
	}
	if err := KillSessionCtx(ctx, server, ephemeral); err != nil {
		t.Fatalf("KillSessionCtx: %v", err)
	}
	names, err := ListRawSessionNames(ctx, server)
	if err != nil {
		t.Fatalf("ListRawSessionNames: %v", err)
	}
	for _, n := range names {
		if n == ephemeral {
			t.Errorf("ephemeral %q still present after KillSessionCtx", ephemeral)
		}
	}
}

func TestListSessions_filtersRkRelay(t *testing.T) {
	server, real := withGroupedSessionTmux(t)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	ephemeral := "rk-relay-feedface"
	if err := NewGroupedSession(ctx, server, real, ephemeral); err != nil {
		t.Fatalf("NewGroupedSession: %v", err)
	}

	got, err := ListSessions(ctx, server)
	if err != nil {
		t.Fatalf("ListSessions: %v", err)
	}
	for _, s := range got {
		if strings.HasPrefix(s.Name, RelaySessionPrefix) {
			t.Errorf("ListSessions returned ephemeral %q — should be filtered", s.Name)
		}
	}
	// Real session should still be present.
	foundReal := false
	for _, s := range got {
		if s.Name == real {
			foundReal = true
		}
	}
	if !foundReal {
		t.Errorf("real session %q missing from ListSessions: %v", real, got)
	}
}

// sessionInfoSliceEqual compares two SessionInfo slices, treating nil and empty as equivalent.
func sessionInfoSliceEqual(a, b []SessionInfo) bool {
	if len(a) == 0 && len(b) == 0 {
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
		if a[i].Name != b[i].Name {
			return false
		}
		if (a[i].Color == nil) != (b[i].Color == nil) {
			return false
		}
		if a[i].Color != nil && *a[i].Color != *b[i].Color {
			return false
		}
	}
	return true
}

func TestIsTestServerName(t *testing.T) {
	cases := []struct {
		name string
		want bool
	}{
		// Unified test umbrella — every test socket starts with rk-test-,
		// including the formerly-distinct relay/tmuxctl/daemon roles and the
		// PID-stamped e2e secondaries.
		{"rk-test-unit-48213-1780032043508597000", true},
		{"rk-test-relay-48213-1780031796792405000", true},
		{"rk-test-tmuxctl-48213-1", true},
		{"rk-test-daemon-48213-1", true},
		{"rk-test-e2e", true},
		{"rk-test-e2e-multi-48213-1", true},
		{"rk-test-e2e-coupling-48213-1", true},

		// User-facing / production servers — NOT test artifacts.
		{"default", false},
		{"Some", false},
		{"rk-daemon", false},
		{"production", false},
		{"runkit", false},
		// Legacy prefixes are gone — they no longer match the single umbrella.
		{"rk-relay-test-20089-1", false},
		{"rk-verify-89115", false},
		{"rk-e2e-coupling-654810", false},
	}
	for _, tc := range cases {
		if got := IsTestServerName(tc.name); got != tc.want {
			t.Errorf("IsTestServerName(%q) = %v, want %v", tc.name, got, tc.want)
		}
	}
}

func TestMatchesServerAllowlist(t *testing.T) {
	cases := []struct {
		name      string
		allowlist string
		server    string
		want      bool
	}{
		// Unset / empty / whitespace-only allowlist is treated as UNSET and
		// admits every server — an empty value never means "match nothing".
		{"unset admits any", "", "kit", true},
		{"unset admits test server", "", "rk-test-e2e", true},
		{"whitespace-only admits any", "   ", "runWork", true},

		// Exact match is the prefix-of-itself case.
		{"exact match", "rk-test-e2e", "rk-test-e2e", true},

		// Prefix admits this-run secondaries (rk-test-e2e-<role>-<pid>-<epoch>).
		{"prefix admits multi secondary", "rk-test-e2e", "rk-test-e2e-multi-4821-318204", true},
		{"prefix admits coupling secondary", "rk-test-e2e", "rk-test-e2e-coupling-4821-318211", true},

		// Comma-separated multi-token list, with surrounding whitespace trimmed.
		{"multi-token admits first prefix", "rk-test-e2e, rk-test-foo", "rk-test-e2e-multi-1-2", true},
		{"multi-token admits second prefix", "rk-test-e2e, rk-test-foo", "rk-test-foo", true},
		{"multi-token excludes non-member", "rk-test-e2e, rk-test-foo", "runWork", false},

		// Empty tokens (leading/trailing/double commas) are ignored, not
		// treated as a wildcard empty prefix. A value that is non-empty but
		// yields ONLY empty tokens has zero non-empty prefixes, so it matches
		// nothing (distinct from the "" / whitespace-only "unset" case above —
		// those short-circuit before tokenizing).
		{"empty tokens ignored still matches", ",rk-test-e2e,,", "rk-test-e2e", true},
		{"all-empty tokens match nothing", ",,", "kit", false},

		// Non-match: rk-test-e2e does NOT admit other rk-test-* roles, even
		// though they share the broader umbrella IsTestServerName matches.
		{"non-match operator server", "rk-test-e2e", "kit", false},
		{"non-match other rk-test role", "rk-test-e2e", "rk-test-relay-9001-1717", false},

		// The broader rk-test- umbrella token admits any rk-test-* role.
		{"umbrella admits e2e", "rk-test-", "rk-test-e2e", true},
		{"umbrella admits relay", "rk-test-", "rk-test-relay-9001-1717", true},
		{"umbrella excludes operator", "rk-test-", "runWork", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := matchesServerAllowlist(tc.server, tc.allowlist); got != tc.want {
				t.Errorf("matchesServerAllowlist(%q, %q) = %v, want %v", tc.server, tc.allowlist, got, tc.want)
			}
		})
	}
}
