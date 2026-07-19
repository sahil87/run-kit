package tmux

import (
	"bytes"
	"compress/zlib"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
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

func strPtr(s string) *string { return &s }

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

// windowLineMarker builds an 11-field tab-delimited tmux line including the
// trailing @rk_marker field (@color/@rk_type/@rk_url left empty).
func windowLineMarker(windowID string, index int, name, path string, activityTs int64, active int, paneCmd, marker string) string {
	return fmt.Sprintf("%s%s%d%s%s%s%s%s%d%s%d%s%s%s%s%s%s%s%s%s%s",
		windowID, listDelim, index, listDelim, name, listDelim, path, listDelim, activityTs, listDelim, active, listDelim, paneCmd, listDelim, "" /*@color*/, listDelim, "" /*@rk_type*/, listDelim, "" /*@rk_url*/, listDelim, marker)
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
			want: []SessionInfo{{Name: "renamed-sess", Color: strPtr("7")}},
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
			want: []SessionInfo{{Name: "alpha", Color: strPtr("4")}, {Name: "beta"}},
		},
		{
			name: "filters _rk-pin-* board pin-sessions from user-facing list",
			lines: []string{
				sessionLine("agent", "0", "agent"),
				sessionLine("_rk-pin-42", "0", "_rk-pin-42"),
				sessionLine("dev", "0", "dev"),
			},
			want: []SessionInfo{{Name: "agent"}, {Name: "dev"}},
		},
		{
			name: "_rk-pin-* exclusion still allows group leaders to be kept",
			lines: []string{
				sessionLineGrouped("devshell", "1", "devshell", 2),
				sessionLineGrouped("devshell-82", "1", "devshell", 2),
				sessionLine("_rk-pin-7", "0", "_rk-pin-7"),
			},
			want: []SessionInfo{{Name: "devshell"}},
		},
		{
			name: "relay ephemerals are no longer filtered (relay layer removed)",
			lines: []string{
				sessionLine("rk-relay-deadbeef", "0", "rk-relay-deadbeef"),
				sessionLine("dev", "0", "dev"),
			},
			want: []SessionInfo{{Name: "rk-relay-deadbeef"}, {Name: "dev"}},
		},
		{
			name: "only _rk-pin-* sessions present returns nil",
			lines: []string{
				sessionLine("_rk-pin-1", "0", "_rk-pin-1"),
				sessionLine("_rk-pin-2", "0", "_rk-pin-2"),
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

func TestParseWindowsMarker(t *testing.T) {
	const fakeNow int64 = 1700000000

	tests := []struct {
		name       string
		line       string
		wantMarker string
	}{
		{"dotted marker", windowLineMarker("@0", 0, "a", "/p", fakeNow, 1, "zsh", "dotted"), "dotted"},
		{"solid marker", windowLineMarker("@0", 0, "a", "/p", fakeNow, 1, "zsh", "solid"), "solid"},
		{"double marker", windowLineMarker("@0", 0, "a", "/p", fakeNow, 1, "zsh", "double"), "double"},
		{"empty marker", windowLineMarker("@0", 0, "a", "/p", fakeNow, 1, "zsh", ""), ""},
		{"unknown marker dropped to empty", windowLineMarker("@0", 0, "a", "/p", fakeNow, 1, "zsh", "dashed"), ""},
		{"10-field line (no marker field) has empty marker", windowLine9("@0", 0, "a", "/p", fakeNow, 1, "zsh", "", ""), ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := parseWindows([]string{tt.line}, fakeNow)
			if len(got) != 1 {
				t.Fatalf("parseWindows() returned %d windows, want 1", len(got))
			}
			if got[0].Marker != tt.wantMarker {
				t.Errorf("Marker = %q, want %q", got[0].Marker, tt.wantMarker)
			}
		})
	}
}

// paneLine builds an 8-field tab-delimited list-panes line with an empty
// @rk_agent_state and empty @rk_chat (the common case). Use paneLineAgent to
// carry an agent state, or paneLineChat to also carry a chat value.
func paneLine(windowID string, paneID string, paneIndex int, cwd, command string, active int) string {
	return paneLineChat(windowID, paneID, paneIndex, cwd, command, active, "", "")
}

// paneLineAgent builds an 8-field tab-delimited list-panes line including the
// @rk_agent_state field (field 6), with an empty @rk_chat.
func paneLineAgent(windowID string, paneID string, paneIndex int, cwd, command string, active int, agentState string) string {
	return paneLineChat(windowID, paneID, paneIndex, cwd, command, active, agentState, "")
}

// paneLineChat builds an 8-field tab-delimited list-panes line including both the
// @rk_agent_state field (field 6) and the @rk_chat field (field 7).
func paneLineChat(windowID string, paneID string, paneIndex int, cwd, command string, active int, agentState, chat string) string {
	return fmt.Sprintf("%s%s%s%s%d%s%s%s%s%s%d%s%s%s%s",
		windowID, listDelim, paneID, listDelim, paneIndex, listDelim, cwd, listDelim, command, listDelim, active, listDelim, agentState, listDelim, chat)
}

// totalPanes sums the number of panes across all windows in the map.
func totalPanes(byWindow map[string][]PaneInfo) int {
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
			paneLine("@0", "%8", 1, "/home/user/code", "zsh", 0),
		}
		byWindow := parsePanes(lines)
		if totalPanes(byWindow) != 1 {
			t.Fatalf("parsePanes() returned %d total panes, want 1", totalPanes(byWindow))
		}
		if byWindow["@0"] == nil || len(byWindow["@0"]) != 1 {
			t.Errorf("byWindow[@0] = %v, want 1 pane", byWindow["@0"])
		}
		p := byWindow["@0"][0]
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
			paneLine("@0", "%5", 0, "/tmp", "bash", 1),
		}
		byWindow := parsePanes(lines)
		if totalPanes(byWindow) != 1 {
			t.Fatalf("expected 1 total pane, got %d", totalPanes(byWindow))
		}
		if !byWindow["@0"][0].IsActive {
			t.Error("IsActive = false, want true")
		}
	})

	t.Run("malformed line with fewer than 6 fields is skipped", func(t *testing.T) {
		lines := []string{
			"0\t%1\t0\t/tmp", // only 4 fields
			paneLine("@1", "%2", 0, "/home/user", "zsh", 0), // valid
		}
		byWindow := parsePanes(lines)
		if totalPanes(byWindow) != 1 {
			t.Fatalf("parsePanes() returned %d total panes, want 1", totalPanes(byWindow))
		}
		if byWindow["@0"] != nil {
			t.Errorf("byWindow[@0] should be nil (malformed line for window 0), got %v", byWindow["@0"])
		}
		if len(byWindow["@1"]) != 1 {
			t.Errorf("byWindow[@1] = %v, want 1 pane", byWindow["@1"])
		}
		if byWindow["@1"][0].PaneID != "%2" {
			t.Errorf("PaneID = %q, want %%2", byWindow["@1"][0].PaneID)
		}
	})

	t.Run("panes grouped by window index", func(t *testing.T) {
		// Window 0: panes %0, %1; Window 1: pane %2
		lines := []string{
			paneLine("@0", "%0", 0, "/tmp/a", "zsh", 1),
			paneLine("@0", "%1", 1, "/tmp/b", "vim", 0),
			paneLine("@1", "%2", 0, "/tmp/c", "bash", 0),
		}
		byWindow := parsePanes(lines)
		if totalPanes(byWindow) != 3 {
			t.Fatalf("parsePanes() returned %d total panes, want 3", totalPanes(byWindow))
		}
		if len(byWindow["@0"]) != 2 {
			t.Errorf("byWindow[@0] = %d panes, want 2", len(byWindow["@0"]))
		}
		if len(byWindow["@1"]) != 1 {
			t.Errorf("byWindow[@1] = %d panes, want 1", len(byWindow["@1"]))
		}
		if byWindow["@0"][0].PaneID != "%0" {
			t.Errorf("byWindow[@0][0].PaneID = %q, want %%0", byWindow["@0"][0].PaneID)
		}
		if byWindow["@0"][1].PaneID != "%1" {
			t.Errorf("byWindow[@0][1].PaneID = %q, want %%1", byWindow["@0"][1].PaneID)
		}
		if byWindow["@1"][0].PaneID != "%2" {
			t.Errorf("byWindow[@1][0].PaneID = %q, want %%2", byWindow["@1"][0].PaneID)
		}
	})

	t.Run("all malformed lines returns nil", func(t *testing.T) {
		lines := []string{"bad", "also\tbad\tonly\tthree"}
		byWindow := parsePanes(lines)
		if byWindow != nil {
			t.Errorf("parsePanes() byWindow = %v, want nil", byWindow)
		}
	})

	t.Run("line with non-window-id first field is skipped", func(t *testing.T) {
		// A bare index (the pre-window-id format) or garbage in field 0 must be
		// dropped, not grouped under a bogus key.
		lines := []string{
			paneLine("0", "%1", 0, "/tmp", "zsh", 0),   // numeric index, not @N
			paneLine("win", "%2", 0, "/tmp", "zsh", 0), // garbage
			paneLine("@3", "%3", 0, "/tmp", "zsh", 0),  // valid
		}
		byWindow := parsePanes(lines)
		if totalPanes(byWindow) != 1 {
			t.Fatalf("parsePanes() returned %d total panes, want 1", totalPanes(byWindow))
		}
		if byWindow["@3"][0].PaneID != "%3" {
			t.Errorf("byWindow[@3][0].PaneID = %q, want %%3", byWindow["@3"][0].PaneID)
		}
	})

	t.Run("agent state parsed from field 6", func(t *testing.T) {
		cases := []struct {
			raw       string
			wantState string
			wantEpoch int64
		}{
			{"active:1751790000", "active", 1751790000},
			{"waiting:1751790001", "waiting", 1751790001},
			{"idle:1751790002", "idle", 1751790002},
		}
		for _, c := range cases {
			lines := []string{paneLineAgent("@0", "%1", 0, "/tmp", "claude", 1, c.raw)}
			byWindow := parsePanes(lines)
			if totalPanes(byWindow) != 1 {
				t.Fatalf("raw %q: got %d panes, want 1", c.raw, totalPanes(byWindow))
			}
			p := byWindow["@0"][0]
			if p.AgentState != c.wantState || p.AgentStateEpoch != c.wantEpoch {
				t.Errorf("raw %q: AgentState=%q epoch=%d, want %q/%d", c.raw, p.AgentState, p.AgentStateEpoch, c.wantState, c.wantEpoch)
			}
		}
	})

	t.Run("unset agent state yields zero values", func(t *testing.T) {
		lines := []string{paneLineAgent("@0", "%1", 0, "/tmp", "claude", 1, "")}
		p := parsePanes(lines)["@0"][0]
		if p.AgentState != "" || p.AgentStateEpoch != 0 {
			t.Errorf("unset: AgentState=%q epoch=%d, want empty/0", p.AgentState, p.AgentStateEpoch)
		}
	})

	t.Run("malformed agent state degrades to zero", func(t *testing.T) {
		cases := []string{
			"active",            // no colon
			"active:notanumber", // non-integer epoch
			"bogus:1751790000",  // unknown state token
			":1751790000",       // empty state
		}
		for _, raw := range cases {
			lines := []string{paneLineAgent("@0", "%1", 0, "/tmp", "claude", 1, raw)}
			p := parsePanes(lines)["@0"][0]
			if p.AgentState != "" || p.AgentStateEpoch != 0 {
				t.Errorf("raw %q: AgentState=%q epoch=%d, want empty/0", raw, p.AgentState, p.AgentStateEpoch)
			}
		}
	})

	t.Run("legacy shell-command reconciler zeros a two-segment leftover state", func(t *testing.T) {
		for _, shell := range []string{"bash", "zsh", "fish", "sh", "dash"} {
			lines := []string{paneLineAgent("@0", "%1", 0, "/tmp", shell, 1, "active:1751790000")}
			p := parsePanes(lines)["@0"][0]
			if p.AgentState != "" || p.AgentStateEpoch != 0 {
				t.Errorf("shell %q: AgentState=%q epoch=%d, want empty/0 (legacy reconciler)", shell, p.AgentState, p.AgentStateEpoch)
			}
		}
	})

	t.Run("non-shell command keeps a two-segment state", func(t *testing.T) {
		lines := []string{paneLineAgent("@0", "%1", 0, "/tmp", "claude", 1, "active:1751790000")}
		p := parsePanes(lines)["@0"][0]
		if p.AgentState != "active" || p.AgentStateEpoch != 1751790000 {
			t.Errorf("claude: AgentState=%q epoch=%d, want active/1751790000", p.AgentState, p.AgentStateEpoch)
		}
	})

	t.Run("pid-carrying state survives a shell pane command when the process is alive", func(t *testing.T) {
		// The wrapped-launch case: claude started via a non-exec'ing bash
		// wrapper, so pane_current_command reads "bash" while the agent runs.
		// PID liveness must win over the shell-name heuristic.
		restore := agentProcessAlive
		agentProcessAlive = func(pid int) bool { return pid == 4242 }
		defer func() { agentProcessAlive = restore }()

		lines := []string{paneLineAgent("@0", "%1", 0, "/tmp", "bash", 1, "waiting:1751790000:4242")}
		p := parsePanes(lines)["@0"][0]
		if p.AgentState != "waiting" || p.AgentStateEpoch != 1751790000 {
			t.Errorf("alive pid under bash: AgentState=%q epoch=%d, want waiting/1751790000", p.AgentState, p.AgentStateEpoch)
		}
	})

	t.Run("pid-carrying state zeroed when the process is dead", func(t *testing.T) {
		// A crashed/killed agent must clear even when the pane command looks
		// agent-like — liveness is authoritative for pid-carrying values.
		restore := agentProcessAlive
		agentProcessAlive = func(int) bool { return false }
		defer func() { agentProcessAlive = restore }()

		lines := []string{paneLineAgent("@0", "%1", 0, "/tmp", "claude", 1, "active:1751790000:4242")}
		p := parsePanes(lines)["@0"][0]
		if p.AgentState != "" || p.AgentStateEpoch != 0 {
			t.Errorf("dead pid: AgentState=%q epoch=%d, want empty/0", p.AgentState, p.AgentStateEpoch)
		}
	})

	t.Run("chat ref parsed from field 7", func(t *testing.T) {
		const uuid = "6f0d9e2a-1c3b-4f7e-9a2d-8b5c4e1f0a37"
		lines := []string{paneLineChat("@0", "%1", 0, "/tmp", "claude", 1, "active:1751790000", "claude:"+uuid)}
		p := parsePanes(lines)["@0"][0]
		if p.ChatProvider != "claude" || p.ChatSessionRef != uuid {
			t.Errorf("ChatProvider=%q ChatSessionRef=%q, want claude/%s", p.ChatProvider, p.ChatSessionRef, uuid)
		}
	})

	t.Run("unset chat yields empty chat fields", func(t *testing.T) {
		lines := []string{paneLineChat("@0", "%1", 0, "/tmp", "claude", 1, "active:1751790000", "")}
		p := parsePanes(lines)["@0"][0]
		if p.ChatProvider != "" || p.ChatSessionRef != "" {
			t.Errorf("unset chat: ChatProvider=%q ChatSessionRef=%q, want empty", p.ChatProvider, p.ChatSessionRef)
		}
	})

	t.Run("malformed chat degrades to empty", func(t *testing.T) {
		for _, raw := range []string{"claude", "claude:", ":abc", "Claude:abc", "claude:has space"} {
			lines := []string{paneLineChat("@0", "%1", 0, "/tmp", "claude", 1, "active:1751790000", raw)}
			p := parsePanes(lines)["@0"][0]
			if p.ChatProvider != "" || p.ChatSessionRef != "" {
				t.Errorf("raw %q: ChatProvider=%q ChatSessionRef=%q, want empty", raw, p.ChatProvider, p.ChatSessionRef)
			}
		}
	})

	t.Run("back-compat: a 7-field line (no @rk_chat) is skipped by the < 8 guard", func(t *testing.T) {
		// The 8th field is required now; a pane emitted without it is skipped
		// (an option that always resolves — tmux emits an empty field for an
		// unset user option — so a real 7-field line only occurs pre-upgrade).
		sevenField := fmt.Sprintf("0%s%%1%s0%s/tmp%sclaude%s1%sactive:1751790000",
			listDelim, listDelim, listDelim, listDelim, listDelim, listDelim)
		valid := paneLineChat("@1", "%2", 0, "/tmp", "claude", 1, "", "")
		byWindow := parsePanes([]string{sevenField, valid})
		if totalPanes(byWindow) != 1 {
			t.Fatalf("got %d panes, want 1 (7-field line skipped)", totalPanes(byWindow))
		}
		if byWindow["@0"] != nil {
			t.Errorf("byWindow[@0] should be nil (7-field line skipped), got %v", byWindow["@0"])
		}
	})

	t.Run("dead pid zeros BOTH agent-state and chat", func(t *testing.T) {
		restore := agentProcessAlive
		agentProcessAlive = func(int) bool { return false }
		defer func() { agentProcessAlive = restore }()

		lines := []string{paneLineChat("@0", "%1", 0, "/tmp", "claude", 1, "active:1751790000:4242", "claude:abc-123")}
		p := parsePanes(lines)["@0"][0]
		if p.AgentState != "" || p.ChatProvider != "" || p.ChatSessionRef != "" {
			t.Errorf("dead pid: AgentState=%q Chat=%q/%q, want all empty", p.AgentState, p.ChatProvider, p.ChatSessionRef)
		}
	})

	t.Run("shell pane with no live pid-bearing agent-state zeros chat", func(t *testing.T) {
		// Two-segment (legacy / SessionStart-before-first-prompt) agent-state has
		// no pid, so a plain-shell pane falls to the shell heuristic and never
		// surfaces chat.
		lines := []string{paneLineChat("@0", "%1", 0, "/tmp", "bash", 1, "active:1751790000", "claude:abc-123")}
		p := parsePanes(lines)["@0"][0]
		if p.ChatProvider != "" || p.ChatSessionRef != "" {
			t.Errorf("shell pane: Chat=%q/%q, want empty", p.ChatProvider, p.ChatSessionRef)
		}
	})

	t.Run("live wrapped pid keeps chat under a bash command", func(t *testing.T) {
		// The wrapped-launch case: claude under a non-exec'ing bash wrapper, so
		// pane_current_command is "bash" while the agent runs. PID liveness wins
		// over the shell heuristic for chat exactly as it does for agent-state.
		restore := agentProcessAlive
		agentProcessAlive = func(pid int) bool { return pid == 4242 }
		defer func() { agentProcessAlive = restore }()

		lines := []string{paneLineChat("@0", "%1", 0, "/tmp", "bash", 1, "waiting:1751790000:4242", "claude:abc-123")}
		p := parsePanes(lines)["@0"][0]
		if p.ChatProvider != "claude" || p.ChatSessionRef != "abc-123" {
			t.Errorf("live wrapped pid: Chat=%q/%q, want claude/abc-123", p.ChatProvider, p.ChatSessionRef)
		}
	})
}

func TestParseChatRef(t *testing.T) {
	cases := []struct {
		raw          string
		wantProvider string
		wantRef      string
	}{
		{"claude:6f0d9e2a-1c3b-4f7e-9a2d-8b5c4e1f0a37", "claude", "6f0d9e2a-1c3b-4f7e-9a2d-8b5c4e1f0a37"},
		{"codex:thread-abc", "codex", "thread-abc"}, // unknown-but-well-formed provider tolerated
		{"claude:seg1:seg2", "claude", "seg1:seg2"}, // first-colon split; a colon-bearing ref is preserved
		{" claude:abc ", "claude", "abc"},           // surrounding whitespace trimmed
		{"gpt-4o_mini:x", "gpt-4o_mini", "x"},       // provider with digits/_/-
		{"", "", ""},                                // empty
		{"claude", "", ""},                          // no colon
		{"claude:", "", ""},                         // empty ref
		{":abc", "", ""},                            // empty provider
		{"Claude:abc", "", ""},                      // uppercase provider rejected
		{"9claude:abc", "", ""},                     // provider must start with a-z
		{"cla ude:abc", "", ""},                     // space in provider
		{"claude:has space", "", ""},                // whitespace in ref
		{"claude:tab\there", "", ""},                // control char in ref
	}
	for _, c := range cases {
		provider, ref := parseChatRef(c.raw)
		if provider != c.wantProvider || ref != c.wantRef {
			t.Errorf("parseChatRef(%q) = (%q, %q), want (%q, %q)", c.raw, provider, ref, c.wantProvider, c.wantRef)
		}
	}
}

func TestParseAgentState(t *testing.T) {
	cases := []struct {
		raw       string
		wantState string
		wantEpoch int64
		wantPID   int
	}{
		{"active:100", "active", 100, 0},
		{"waiting:200", "waiting", 200, 0},
		{"idle:300", "idle", 300, 0},
		{"active:100:4242", "active", 100, 4242}, // pid-carrying form
		{"waiting:200:1", "waiting", 200, 1},
		{"", "", 0, 0},
		{"active", "", 0, 0},
		{"active:", "", 0, 0},
		{"active:x", "", 0, 0},
		{"bogus:100", "", 0, 0},
		{"active:100:x", "", 0, 0},      // malformed pid → wholly unknown
		{"active:100:0", "", 0, 0},      // non-positive pid → wholly unknown
		{"active:100:-7", "", 0, 0},     // negative pid → wholly unknown
		{"active:100:4242:9", "", 0, 0}, // too many segments
		{" idle:400 ", "idle", 400, 0},  // surrounding whitespace trimmed
	}
	for _, c := range cases {
		state, epoch, pid := parseAgentState(c.raw)
		if state != c.wantState || epoch != c.wantEpoch || pid != c.wantPID {
			t.Errorf("parseAgentState(%q) = (%q, %d, %d), want (%q, %d, %d)", c.raw, state, epoch, pid, c.wantState, c.wantEpoch, c.wantPID)
		}
	}
}

// makeDirenvDiff builds a real DIRENV_DIFF value the way direnv does — JSON
// {"p":{...},"n":{...}} → zlib deflate → base64url (padded) — so reversal tests
// exercise genuine decode/inflate/parse paths rather than a hand-mocked shortcut.
// p holds prior values (changed/removed vars), n holds new values (changed/added).
func makeDirenvDiff(t *testing.T, p, n map[string]string) string {
	t.Helper()
	payload, err := json.Marshal(struct {
		P map[string]string `json:"p"`
		N map[string]string `json:"n"`
	}{P: p, N: n})
	if err != nil {
		t.Fatalf("marshal diff: %v", err)
	}
	var buf bytes.Buffer
	w := zlib.NewWriter(&buf)
	if _, err := w.Write(payload); err != nil {
		t.Fatalf("zlib write: %v", err)
	}
	if err := w.Close(); err != nil {
		t.Fatalf("zlib close: %v", err)
	}
	return base64.URLEncoding.EncodeToString(buf.Bytes())
}

func TestSanitizeEnv(t *testing.T) {
	tests := []struct {
		name    string
		input   []string
		wantHas []string // exact entries that must be present
		wantNot []string // substrings that must be absent from every entry
	}{
		{
			// direnv added WORKTREE_INIT_SCRIPT + IDEAS_FILE, changed PATH,
			// removed EDITOR. Reversal must undo all four.
			name: "reverses direnv diff (add removed, changed+removed restored)",
			input: []string{
				"HOME=/home/user",
				"PATH=/run-kit/bin:/usr/bin",
				"WORKTREE_INIT_SCRIPT=fab sync",
				"IDEAS_FILE=fab/backlog.md",
				"DIRENV_DIFF=" + makeDirenvDiff(t,
					map[string]string{"PATH": "/home/user/.local/bin:/usr/bin", "EDITOR": "vim"},
					map[string]string{"PATH": "/run-kit/bin:/usr/bin", "WORKTREE_INIT_SCRIPT": "fab sync", "IDEAS_FILE": "fab/backlog.md"},
				),
				"SHELL=/bin/zsh",
			},
			wantHas: []string{
				"HOME=/home/user",
				"PATH=/home/user/.local/bin:/usr/bin", // restored to prior (true from-home PATH)
				"EDITOR=vim",                          // direnv-removed var restored
				"SHELL=/bin/zsh",
			},
			wantNot: []string{"WORKTREE_INIT_SCRIPT", "IDEAS_FILE", "/run-kit/bin", "DIRENV_"},
		},
		{
			name: "strips all RK_* and DIRENV_* vars",
			input: []string{
				"HOME=/home/user",
				"PATH=/usr/bin",
				"RK_DAEMON_LOG=/tmp/daemon.log",
				"RK_PORT=3000",
				"RK_HOST=0.0.0.0",
				"DIRENV_DIR=/run-kit",
				"DIRENV_FILE=/run-kit/.envrc",
			},
			wantHas: []string{"HOME=/home/user", "PATH=/usr/bin"},
			wantNot: []string{"RK_", "DIRENV_"},
		},
		{
			// No DIRENV_DIFF: pass through unchanged except RK_*/DIRENV_* strips.
			// The real PATH MUST survive — NOT reset to the POSIX default.
			name: "no diff: passes PATH through, does not POSIX-reset",
			input: []string{
				"HOME=/home/user",
				"PATH=/home/user/.local/bin:/usr/bin",
				"RK_PORT=3000",
				"SHELL=/bin/zsh",
			},
			wantHas: []string{
				"HOME=/home/user",
				"PATH=/home/user/.local/bin:/usr/bin",
				"SHELL=/bin/zsh",
			},
			wantNot: []string{"RK_", cleanPATH},
		},
		{
			// Malformed DIRENV_DIFF: fail-soft to pass-through + strips.
			name: "malformed diff: fail-soft pass-through with strips",
			input: []string{
				"HOME=/home/user",
				"PATH=/home/user/.local/bin:/usr/bin",
				"RK_DAEMON_LOG=/tmp/x",
				"DIRENV_DIFF=not-valid-base64!!!",
			},
			wantHas: []string{"HOME=/home/user", "PATH=/home/user/.local/bin:/usr/bin"},
			wantNot: []string{"RK_", "DIRENV_", cleanPATH},
		},
		{
			// Last-resort PATH guard: env with no PATH gets cleanPATH injected.
			name:    "PATH-missing guard injects cleanPATH",
			input:   []string{"HOME=/home/user", "SHELL=/bin/zsh"},
			wantHas: []string{"HOME=/home/user", "PATH=" + cleanPATH, "SHELL=/bin/zsh"},
			wantNot: nil,
		},
		{
			name:    "empty input still gets PATH guard",
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

			for _, sub := range tt.wantNot {
				for _, e := range got {
					if strings.Contains(e, sub) {
						t.Errorf("unexpected entry %q containing %q", e, sub)
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

func TestReverseDirenvDiff_absentPassesThrough(t *testing.T) {
	in := []string{"HOME=/home/user", "PATH=/usr/bin"}
	got, err := reverseDirenvDiff(in)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != len(in) {
		t.Fatalf("expected unchanged env, got %v", got)
	}
	for i := range in {
		if got[i] != in[i] {
			t.Errorf("entry %d changed: got %q want %q", i, got[i], in[i])
		}
	}
}

func TestReverseDirenvDiff_valid(t *testing.T) {
	diff := makeDirenvDiff(t,
		map[string]string{"PATH": "/usr/bin", "EDITOR": "vim"},  // prior
		map[string]string{"PATH": "/run-kit/bin", "ADDED": "x"}, // new (PATH changed, ADDED added, EDITOR removed by direnv)
	)
	in := []string{
		"HOME=/home/user",
		"PATH=/run-kit/bin",
		"ADDED=x",
		"DIRENV_DIFF=" + diff,
	}
	got, err := reverseDirenvDiff(in)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	m := envToMap(got)
	if m["PATH"] != "/usr/bin" {
		t.Errorf("PATH not restored: got %q want /usr/bin", m["PATH"])
	}
	if v, ok := m["ADDED"]; ok {
		t.Errorf("ADDED should be removed, got %q", v)
	}
	if m["EDITOR"] != "vim" {
		t.Errorf("EDITOR (direnv-removed) not restored: got %q want vim", m["EDITOR"])
	}
	// DIRENV_DIFF is left for the caller's DIRENV_* strip, not removed here.
	if _, ok := m["DIRENV_DIFF"]; !ok {
		t.Errorf("DIRENV_DIFF should remain for the caller to strip")
	}
}

func TestReverseDirenvDiff_malformedReturnsError(t *testing.T) {
	in := []string{"HOME=/home/user", "DIRENV_DIFF=not-base64!!!"}
	got, err := reverseDirenvDiff(in)
	if err == nil {
		t.Fatalf("expected error for malformed diff, got nil")
	}
	// On error the original env is returned so the caller can fall through.
	if len(got) != len(in) {
		t.Errorf("expected original env returned on error, got %v", got)
	}
}

// TestReverseDirenvDiff_oversizedPayloadFailsSoft proves that a DIRENV_DIFF
// whose inflated payload exceeds the size cap is rejected with an error (so the
// caller falls through fail-soft) rather than being decoded into memory. It
// builds a valid zlib stream — highly compressible so the encoded env value
// stays tiny — that inflates well past maxDirenvDiffInflated.
func TestReverseDirenvDiff_oversizedPayloadFailsSoft(t *testing.T) {
	// A large, highly-compressible payload: JSON is irrelevant here because the
	// size cap trips before the unmarshal ever runs.
	big := strings.Repeat("A", maxDirenvDiffInflated+1024)
	var buf bytes.Buffer
	w := zlib.NewWriter(&buf)
	if _, err := w.Write([]byte(big)); err != nil {
		t.Fatalf("zlib write: %v", err)
	}
	if err := w.Close(); err != nil {
		t.Fatalf("zlib close: %v", err)
	}
	encoded := base64.URLEncoding.EncodeToString(buf.Bytes())

	in := []string{"HOME=/home/user", "DIRENV_DIFF=" + encoded}
	got, err := reverseDirenvDiff(in)
	if !errors.Is(err, errDirenvDiffTooLarge) {
		t.Fatalf("expected errDirenvDiffTooLarge, got %v", err)
	}
	// On error the original env is returned so the caller can fall through.
	if len(got) != len(in) {
		t.Errorf("expected original env returned on oversized diff, got %v", got)
	}
}

func envToMap(environ []string) map[string]string {
	m := make(map[string]string, len(environ))
	for _, e := range environ {
		if i := strings.IndexByte(e, '='); i >= 0 {
			m[e[:i]] = e[i+1:]
		}
	}
	return m
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

// The embedded default config sets automatic-rename-format to the pane's
// current-path basename, so unnamed windows display their folder rather than
// the running command (change 260707-j66b).
func TestDefaultConfigSetsAutomaticRenameFormat(t *testing.T) {
	content := string(DefaultConfigBytes())
	if !strings.Contains(content, "automatic-rename-format '#{b:pane_current_path}'") {
		t.Error("embedded default config missing automatic-rename-format '#{b:pane_current_path}'")
	}
}

func TestEnsureDropInDirNoHomeDir(t *testing.T) {
	origDefault := DefaultConfigPath
	defer func() { DefaultConfigPath = origDefault }()
	DefaultConfigPath = ""

	// Should be a no-op, not panic.
	ensureDropInDir()
}

// windowID reads the stable tmux window id (@N) for a display-message target on
// the isolated test server. A "session:index" target resolves that specific
// window; a bare "session" target resolves the session's ACTIVE window. Fails the
// test if it cannot be resolved.
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

// selectWindowCLI makes target the session's active window via a bare
// select-window (test setup only — bypasses MoveWindow).
func selectWindowCLI(t *testing.T, server, target string) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if out, err := exec.CommandContext(ctx, "tmux", "-L", server, "select-window", "-t", target).CombinedOutput(); err != nil {
		t.Fatalf("select-window -t %q: %v\n%s", target, err, string(out))
	}
}

// TestMoveWindow_preservesActiveWindow proves the fix: reordering a window the
// user is NOT viewing must not drift the session's active window. tmux otherwise
// pins the active window to its index slot during swap-window, so a different
// window would occupy the active slot after the shuffle. With [0,1*,2,3] (1
// active), moving window 3 to index 0 must leave window 1 active — not the
// index-pinned window that lands in slot 1.
func TestMoveWindow_preservesActiveWindow(t *testing.T) {
	server := withSessionOrderTmux(t)

	// boot has window 0; add three more so indices are 0..3.
	for _, name := range []string{"one", "two", "three"} {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		out, err := exec.CommandContext(ctx, "tmux", "-L", server, "new-window", "-t", "boot", "-n", name).CombinedOutput()
		cancel()
		if err != nil {
			t.Fatalf("new-window %q: %v\n%s", name, err, string(out))
		}
	}

	// Make the window at index 1 active (the "viewed" window) and record its id.
	selectWindowCLI(t, server, "boot:1")
	wantActive := windowID(t, server, "boot:1")

	// Move the window at index 3 to index 0 — the reorder the user did NOT intend
	// to change their focus.
	dragged := windowID(t, server, "boot:3")
	if err := MoveWindow(dragged, 0, server); err != nil {
		t.Fatalf("MoveWindow(%q -> 0): %v", dragged, err)
	}

	// windowID with a bare session target resolves that session's ACTIVE window
	// (display-message -t boot), so it reads back the post-move active window.
	if gotActive := windowID(t, server, "boot"); gotActive != wantActive {
		t.Errorf("after MoveWindow: active window = %q, want %q (active window drifted)", gotActive, wantActive)
	}
}

// TestMoveWindow_preservesActiveWindowWhenDragged covers the edge where the moved
// window IS the active one. Restoring by stable window id (not index) must follow
// the dragged window to its new slot: with [0,1,2,3*] (3 active), moving window 3
// to index 0 must leave that same window active AND now at index 0.
func TestMoveWindow_preservesActiveWindowWhenDragged(t *testing.T) {
	server := withSessionOrderTmux(t)

	for _, name := range []string{"one", "two", "three"} {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		out, err := exec.CommandContext(ctx, "tmux", "-L", server, "new-window", "-t", "boot", "-n", name).CombinedOutput()
		cancel()
		if err != nil {
			t.Fatalf("new-window %q: %v\n%s", name, err, string(out))
		}
	}

	// The dragged window is the active one.
	selectWindowCLI(t, server, "boot:3")
	dragged := windowID(t, server, "boot:3")

	if err := MoveWindow(dragged, 0, server); err != nil {
		t.Fatalf("MoveWindow(%q -> 0): %v", dragged, err)
	}

	if gotActive := windowID(t, server, "boot"); gotActive != dragged {
		t.Errorf("after MoveWindow: active window = %q, want %q (dragged+active window lost focus)", gotActive, dragged)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, gotIndex, err := resolveWindowSessionIndex(ctx, server, dragged)
	if err != nil {
		t.Fatalf("resolve after move: %v", err)
	}
	if gotIndex != 0 {
		t.Errorf("after MoveWindow: dragged window index = %d, want 0", gotIndex)
	}
}

// TestMoveWindow_preservesActiveWindowInSessionGroup exercises the reorder inside a
// tmux session GROUP. Members created with `new-session -t <base>` share window
// membership but keep INDEPENDENT active-window pointers. MoveWindow resolves the
// dragged window to a single owning session (via resolveWindowSessionIndex) and
// runs its swaps + the active-window restore scoped to THAT session; the restore
// target is session-qualified (`select-window -t <session>:@N`) rather than a bare
// `@N`, which is ambiguous across group members (see SelectWindowInSession). This
// pins that the qualified restore keeps the reordered session's active window
// invariant even while a mirror member exists with a different active pointer.
func TestMoveWindow_preservesActiveWindowInSessionGroup(t *testing.T) {
	server := withSessionOrderTmux(t)

	// boot has window 0; add three more so indices are 0..3.
	for _, name := range []string{"one", "two", "three"} {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		out, err := exec.CommandContext(ctx, "tmux", "-L", server, "new-window", "-t", "boot", "-n", name).CombinedOutput()
		cancel()
		if err != nil {
			t.Fatalf("new-window %q: %v\n%s", name, err, string(out))
		}
	}

	// Create a grouped mirror member sharing boot's windows (independent active
	// pointer). This is the condition under which a bare @N restore is ambiguous.
	mirrorCtx, mirrorCancel := context.WithTimeout(context.Background(), 5*time.Second)
	if out, err := exec.CommandContext(mirrorCtx, "tmux", "-L", server, "new-session", "-d", "-t", "boot", "-s", "mirror").CombinedOutput(); err != nil {
		mirrorCancel()
		t.Fatalf("new-session -t boot -s mirror: %v\n%s", err, string(out))
	}
	mirrorCancel()

	// The dragged window (index 3). Resolve the session MoveWindow will operate on
	// exactly as MoveWindow does — a bare @N can resolve to either group member, so
	// the assertion below targets whichever session it picks rather than assuming a
	// name.
	dragged := windowID(t, server, "boot:3")
	resolveCtx, resolveCancel := context.WithTimeout(context.Background(), 5*time.Second)
	ownSession, _, err := resolveWindowSessionIndex(resolveCtx, server, dragged)
	resolveCancel()
	if err != nil {
		t.Fatalf("resolve owning session for %q: %v", dragged, err)
	}

	// Make the owning session's active window a NON-dragged window (index 1), and
	// point the other member at a different window so the two members' active
	// pointers diverge — the state under which a bare restore is unsafe.
	otherSession := "mirror"
	if ownSession == "mirror" {
		otherSession = "boot"
	}
	selectWindowCLI(t, server, otherSession+":0")
	selectWindowCLI(t, server, ownSession+":1")
	wantActive := windowID(t, server, ownSession)

	// Move a window the owning session is NOT viewing (index 3 -> index 0).
	if err := MoveWindow(dragged, 0, server); err != nil {
		t.Fatalf("MoveWindow(%q -> 0): %v", dragged, err)
	}

	// The reordered session's active window must be unchanged. The session-qualified
	// restore keeps the select scoped to the same member the swaps ran on, rather
	// than letting a bare @N leak the active-window change to another group member.
	if gotActive := windowID(t, server, ownSession); gotActive != wantActive {
		t.Errorf("after MoveWindow in session group: %s active window = %q, want %q (active window drifted)", ownSession, gotActive, wantActive)
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

func TestLinkWindowToSession_linksAndPreservesID(t *testing.T) {
	server := withSessionOrderTmux(t)

	// Create the destination session and a source window in the boot session.
	for _, args := range [][]string{
		{"new-session", "-d", "-s", "dst"},
		{"new-window", "-t", "boot", "-n", "linker"},
	} {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		full := append([]string{"-L", server}, args...)
		out, err := exec.CommandContext(ctx, "tmux", full...).CombinedOutput()
		cancel()
		if err != nil {
			t.Fatalf("setup %v: %v\n%s", args, err, string(out))
		}
	}

	id := windowID(t, server, "boot:linker")

	if err := LinkWindowToSession(id, "dst", server); err != nil {
		t.Fatalf("LinkWindowToSession(%q -> dst): %v", id, err)
	}

	// link-window makes the window a member of BOTH sessions (unlike move-window),
	// preserving its id. Verify the same id now appears in dst AND still in boot.
	windowsIn := func(session string) []string {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		lines, err := tmuxExecServer(ctx, server, "list-windows", "-t", ExactSessionTarget(session), "-F", "#{window_id}")
		if err != nil {
			t.Fatalf("list-windows %q: %v", session, err)
		}
		out := make([]string, 0, len(lines))
		for _, l := range lines {
			out = append(out, strings.TrimSpace(l))
		}
		return out
	}
	inSession := func(session string) bool {
		for _, w := range windowsIn(session) {
			if w == id {
				return true
			}
		}
		return false
	}
	if !inSession("dst") {
		t.Errorf("after LinkWindowToSession: window %q not present in dst", id)
	}
	if !inSession("boot") {
		t.Errorf("after LinkWindowToSession: window %q left boot (link must keep it a member of the source too)", id)
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

func TestGetServerRank_unsetReturnsNil(t *testing.T) {
	server := withSessionOrderTmux(t)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	got, err := GetServerRank(ctx, server)
	if err != nil {
		t.Fatalf("GetServerRank unset: %v", err)
	}
	if got != nil {
		t.Errorf("got %v, want nil (unset)", *got)
	}
}

func TestGetServerRank_noServerReturnsNil(t *testing.T) {
	if _, err := exec.LookPath("tmux"); err != nil {
		t.Skip("tmux not available — skipping integration test")
	}
	// A socket name with no running server: the read must degrade to nil, not
	// bubble a "no server running" / "failed to connect" error.
	server := testSocketName("unit")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	got, err := GetServerRank(ctx, server)
	if err != nil {
		t.Fatalf("GetServerRank on dead server: %v", err)
	}
	if got != nil {
		t.Errorf("got %v, want nil (no server)", *got)
	}
}

func TestSetServerRank_roundTrip(t *testing.T) {
	server := withSessionOrderTmux(t)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := SetServerRank(ctx, server, 3); err != nil {
		t.Fatalf("SetServerRank: %v", err)
	}
	got, err := GetServerRank(ctx, server)
	if err != nil {
		t.Fatalf("GetServerRank: %v", err)
	}
	if got == nil || *got != 3 {
		t.Fatalf("got %v, want 3", got)
	}

	// Overwrite replaces (0 is a valid rank — the first server).
	if err := SetServerRank(ctx, server, 0); err != nil {
		t.Fatalf("SetServerRank overwrite: %v", err)
	}
	got, err = GetServerRank(ctx, server)
	if err != nil {
		t.Fatalf("GetServerRank after overwrite: %v", err)
	}
	if got == nil || *got != 0 {
		t.Fatalf("got %v, want 0 after overwrite", got)
	}
}

func TestGetServerRank_malformedValueReturnsError(t *testing.T) {
	server := withSessionOrderTmux(t)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// Plant a non-integer value via raw set-option (bypasses SetServerRank).
	args := append(serverArgs(server), "set-option", "-s", ServerRankOption, "not-an-int")
	if out, err := exec.CommandContext(ctx, "tmux", args...).CombinedOutput(); err != nil {
		t.Fatalf("plant malformed rank: %v\n%s", err, string(out))
	}

	_, err := GetServerRank(ctx, server)
	if err == nil {
		t.Fatal("expected decode error for malformed rank, got nil")
	}
}

// withRealSessionTmux starts an isolated tmux server with a "real" session
// containing two windows. Skips the test if tmux is unavailable. Returns
// (server, realSession).
func withRealSessionTmux(t *testing.T) (string, string) {
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

// ResolveWindowSession returns the window's home (non-pin) session. An unpinned
// window has exactly one link, so it resolves to that session directly.
func TestResolveWindowSession_findsOwningSession(t *testing.T) {
	server, real := withRealSessionTmux(t)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

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
		t.Errorf("ResolveWindowSession(%q) = %q, want %q", id, got, real)
	}
}

// ResolveWindowSession returns an error when the window ID does not exist on the
// server. The relay relies on this not-found contract to close the socket with
// code 4004 "Window not found".
func TestResolveWindowSession_notFound(t *testing.T) {
	server, _ := withRealSessionTmux(t)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	got, err := ResolveWindowSession(ctx, server, "@999999")
	if err == nil {
		t.Fatalf("ResolveWindowSession(@999999) = %q, want non-nil error", got)
	}
	// Assert the contract message, not just any error — guards against a raw
	// tmux stderr/exit-status error leaking through instead of the documented
	// `window %q not found` contract the relay (code 4004) depends on.
	if !strings.Contains(err.Error(), "not found") {
		t.Errorf("ResolveWindowSession(@999999) error = %q, want it to contain \"not found\"", err)
	}
}

func TestKillSessionCtx_killsSession(t *testing.T) {
	server, _ := withRealSessionTmux(t)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// Create a throwaway session, then kill it via KillSessionCtx.
	if _, err := tmuxExecServer(ctx, server, "new-session", "-d", "-s", "victim"); err != nil {
		t.Fatalf("create victim session: %v", err)
	}
	if err := KillSessionCtx(ctx, server, "victim"); err != nil {
		t.Fatalf("KillSessionCtx: %v", err)
	}
	if _, err := tmuxExecRawServer(ctx, server, "has-session", "-t", "victim"); err == nil {
		t.Errorf("session 'victim' still present after KillSessionCtx")
	}
}

func TestListSessions_filtersPinSessions(t *testing.T) {
	server, real := withRealSessionTmux(t)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// A `_rk-pin-*` session must be filtered out of the user-facing list.
	if _, err := tmuxExecServer(ctx, server, "new-session", "-d", "-s", PinSessionPrefix+"42"); err != nil {
		t.Fatalf("create pin session: %v", err)
	}

	got, err := ListSessions(ctx, server)
	if err != nil {
		t.Fatalf("ListSessions: %v", err)
	}
	for _, s := range got {
		if strings.HasPrefix(s.Name, PinSessionPrefix) {
			t.Errorf("ListSessions returned pin-session %q — should be filtered", s.Name)
		}
	}
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

// TestSetExitEmptyOff sets the server-scoped exit-empty option to off and reads
// it back via `show-options -g`, asserting the imperative backstop reaches a
// live tmux server (the one path the embedded `-f` config never covers for
// hand-created/foreign servers). Change:
// 260602-a1wo-prevent-exit-empty-server-death.
func TestSetExitEmptyOff(t *testing.T) {
	server := withSessionOrderTmux(t)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// The isolated server is created WITHOUT our `-f` config, so it starts at
	// tmux's default exit-empty=on — the exact gap that let `kit` inherit `on`.
	before, err := tmuxExecRawServer(ctx, server, "show-options", "-g", "-v", "exit-empty")
	if err != nil {
		t.Fatalf("read exit-empty before: %v", err)
	}
	if got := strings.TrimSpace(before); got != "on" {
		t.Logf("note: default exit-empty was %q (expected \"on\") — proceeding", got)
	}

	if err := SetExitEmptyOff(ctx, server); err != nil {
		t.Fatalf("SetExitEmptyOff: %v", err)
	}

	after, err := tmuxExecRawServer(ctx, server, "show-options", "-g", "-v", "exit-empty")
	if err != nil {
		t.Fatalf("read exit-empty after: %v", err)
	}
	if got := strings.TrimSpace(after); got != "off" {
		t.Errorf("exit-empty after SetExitEmptyOff = %q, want \"off\"", got)
	}

	// Idempotent — a second call is a no-op success.
	if err := SetExitEmptyOff(ctx, server); err != nil {
		t.Fatalf("SetExitEmptyOff (second call): %v", err)
	}
}

func TestIsServerGone(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want bool
	}{
		{name: "nil error", err: nil, want: false},
		{name: "no server running", err: errors.New("exit status 1: no server running on /tmp/tmux-1001/utils"), want: true},
		{name: "failed to connect", err: errors.New("exit status 1: failed to connect to server"), want: true},
		{name: "No such file or directory", err: errors.New("exit status 1: error connecting to /tmp/tmux-1001/utils (No such file or directory)"), want: true},
		{name: "non-matching error", err: errors.New("exit status 1: some other tmux failure"), want: false},
		{name: "empty error message", err: errors.New(""), want: false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := IsServerGone(tc.err); got != tc.want {
				t.Errorf("IsServerGone(%v) = %v, want %v", tc.err, got, tc.want)
			}
		})
	}
}

// TestBuildCreateWindowArgs asserts the argv slice produced by
// buildCreateWindowArgs: an empty name omits the -n token entirely (so tmux's
// automatic-rename-format names the window to its folder basename), while a
// non-empty name pins it with -n <name>. The -t target is the exact-match
// session form `=<session>:` — new-window's -t is a window target, so a bare
// session name would first match a window of that name in the attached
// session and create the window there (the ext misroute, 2026-07-17).
func TestBuildCreateWindowArgs(t *testing.T) {
	cases := []struct {
		name    string
		session string
		winName string
		cwd     string
		want    []string
	}{
		{
			name:    "empty name omits -n",
			session: "dev",
			winName: "",
			cwd:     "/home/user/run-kit",
			want:    []string{"new-window", "-a", "-t", "=dev:", "-c", "/home/user/run-kit"},
		},
		{
			name:    "non-empty name pins with -n",
			session: "dev",
			winName: "feature",
			cwd:     "/home/user/run-kit",
			want:    []string{"new-window", "-a", "-t", "=dev:", "-n", "feature", "-c", "/home/user/run-kit"},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := buildCreateWindowArgs(tc.session, tc.winName, tc.cwd)
			if !reflect.DeepEqual(got, tc.want) {
				t.Errorf("buildCreateWindowArgs(%q, %q, %q) =\n  %#v\nwant\n  %#v", tc.session, tc.winName, tc.cwd, got, tc.want)
			}
		})
	}
}

// TestSessionWindowNameCollision reproduces the 2026-07-17 "ext" misroute
// against a real tmux server: a session named X coexisting with a WINDOW named
// X in another session. CreateWindow and ListWindows pass session names into
// commands whose -t is a *window* target (new-window; list-panes, even under
// -s), where tmux matches a bare name against the current session's window
// names before trying it as a session name — creating the window in the wrong
// session and gluing the wrong session's panes onto the right session's
// windows. The exact-match target form (ExactSessionTarget) plus the window-id
// pane join must keep both operations pinned to the named session.
func TestSessionWindowNameCollision(t *testing.T) {
	server := withSessionOrderTmux(t) // provides session "boot"
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	// In session "boot", create a window whose NAME collides with the session
	// created next.
	createHomeWindow(t, server, "boot", "victim")
	if err := CreateSession("victim", "/tmp", server); err != nil {
		t.Fatalf("create session victim: %v", err)
	}

	// CreateWindow targeting SESSION "victim" must land there — not next to
	// WINDOW "victim" inside boot (the misroute).
	if err := CreateWindow("victim", "newwin", "/tmp", server); err != nil {
		t.Fatalf("CreateWindow: %v", err)
	}
	victimWindows, err := ListWindows(ctx, "victim", server)
	if err != nil {
		t.Fatalf("ListWindows(victim): %v", err)
	}
	foundInVictim := false
	for _, w := range victimWindows {
		if w.Name == "newwin" {
			foundInVictim = true
		}
	}
	if !foundInVictim {
		t.Errorf("window %q not found in session victim — misrouted create; victim windows: %+v", "newwin", victimWindows)
	}
	bootWindows, err := ListWindows(ctx, "boot", server)
	if err != nil {
		t.Fatalf("ListWindows(boot): %v", err)
	}
	for _, w := range bootWindows {
		if w.Name == "newwin" {
			t.Errorf("window %q landed in session boot — the bare-name window-target misroute", "newwin")
		}
	}

	// Pane join: session victim's windows must carry their OWN panes, never
	// boot's (the index-join symptom was boot's pane IDs on victim's windows).
	bootPaneIDs := make(map[string]bool)
	for _, w := range bootWindows {
		for _, p := range w.Panes {
			bootPaneIDs[p.PaneID] = true
		}
	}
	for _, w := range victimWindows {
		if len(w.Panes) == 0 {
			t.Errorf("victim window %s (%s) has no panes — pane join failed", w.WindowID, w.Name)
		}
		for _, p := range w.Panes {
			if bootPaneIDs[p.PaneID] {
				t.Errorf("victim window %s carries boot's pane %s — cross-session pane misjoin", w.WindowID, p.PaneID)
			}
		}
	}
}

// TestExactSessionTarget pins the exact-match session target form: `=name:`.
// The `=` disables prefix/fnmatch matching; the trailing `:` forces session
// parsing on commands whose -t is a window target (new-window, list-panes),
// where a bare name is matched against the attached session's window names
// first — the session/window name-collision misroute.
func TestExactSessionTarget(t *testing.T) {
	cases := []struct{ session, want string }{
		{"planner", "=planner:"},
		{"0", "=0:"},                   // numeric session names must not parse as an index
		{"_rk-pin-42", "=_rk-pin-42:"}, // pin-sessions ride the same helper
	}
	for _, tc := range cases {
		if got := ExactSessionTarget(tc.session); got != tc.want {
			t.Errorf("ExactSessionTarget(%q) = %q, want %q", tc.session, got, tc.want)
		}
	}
	if got := exactWindowInSession("planner", "@4"); got != "=planner:@4" {
		t.Errorf("exactWindowInSession(planner, @4) = %q, want =planner:@4", got)
	}
}

// TestSetChatSendBuffer_LeadingDash is the live regression test for the `--`
// option terminator in SetChatSendBufferCtx. Without `--`, a message that starts
// with a dash (e.g. "--force is broken") is parsed by tmux set-buffer as flags
// and the command hard-fails; with `--`, the text is stored verbatim as the
// positional buffer data. It stores such text through SetChatSendBufferCtx, then
// reads the named buffer back with `show-buffer -b` and asserts the round-trip
// is byte-for-byte the original. Skips when tmux is unavailable.
func TestSetChatSendBuffer_LeadingDash(t *testing.T) {
	server := withSessionOrderTmux(t)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	cases := []string{
		"--force is broken",
		"-t is not a flag here",
		"-",
		"normal text no dash",
	}
	for _, text := range cases {
		t.Run(text, func(t *testing.T) {
			if err := SetChatSendBufferCtx(ctx, text, server); err != nil {
				t.Fatalf("SetChatSendBufferCtx(%q): %v", text, err)
			}
			got, err := tmuxExecRawServer(ctx, server, "show-buffer", "-b", ChatSendBuffer)
			if err != nil {
				t.Fatalf("show-buffer: %v", err)
			}
			// tmux show-buffer appends a trailing newline the stored value did
			// not carry; the buffer content is everything before it.
			got = strings.TrimSuffix(got, "\n")
			if got != text {
				t.Errorf("buffer round-trip = %q, want verbatim %q", got, text)
			}
		})
	}
}
