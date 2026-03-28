package tmux

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Helper to build a tab-delimited tmux line.
func sessionLine(name, grouped, group string) string {
	return strings.Join([]string{name, grouped, group}, listDelim)
}

func windowLine(index int, name, path string, activityTs int64, active int, paneCmd string) string {
	return fmt.Sprintf("%d%s%s%s%s%s%d%s%d%s%s",
		index, listDelim, name, listDelim, path, listDelim, activityTs, listDelim, active, listDelim, paneCmd)
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
			name: "filters out session-group copies (grouped=1, name != group)",
			lines: []string{
				sessionLine("devshell", "0", "devshell"),
				sessionLine("devshell-82", "1", "devshell"),
			},
			want: []SessionInfo{{Name: "devshell"}},
		},
		{
			name: "keeps group-named session (grouped=1, name == group)",
			lines: []string{
				sessionLine("mygroup", "1", "mygroup"),
			},
			want: []SessionInfo{{Name: "mygroup"}},
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
				sessionLine("proj", "0", "proj"),
				sessionLine("proj-1", "1", "proj"),
				sessionLine("proj-2", "1", "proj"),
			},
			want: []SessionInfo{{Name: "proj"}},
		},
		{
			name: "mixed grouped and ungrouped sessions",
			lines: []string{
				sessionLine("alpha", "0", "alpha"),
				sessionLine("beta", "1", "beta"),
				sessionLine("beta-N", "1", "beta"),
				sessionLine("gamma", "0", "gamma"),
			},
			want: []SessionInfo{{Name: "alpha"}, {Name: "beta"}, {Name: "gamma"}},
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
				windowLine(0, "dev", "/home/user/project", fakeNow-1, 1, "claude"),
			},
			now: fakeNow,
			want: []WindowInfo{
				{Index: 0, Name: "dev", WorktreePath: "/home/user/project", Activity: "active", IsActiveWindow: true, PaneCommand: "claude", ActivityTimestamp: fakeNow - 1},
			},
		},
		{
			name: "marks window as idle when beyond threshold",
			lines: []string{
				windowLine(0, "dev", "/home/user/project", fakeNow-ActivityThresholdSeconds-100, 0, "zsh"),
			},
			now: fakeNow,
			want: []WindowInfo{
				{Index: 0, Name: "dev", WorktreePath: "/home/user/project", Activity: "idle", IsActiveWindow: false, PaneCommand: "zsh", ActivityTimestamp: fakeNow - ActivityThresholdSeconds - 100},
			},
		},
		{
			name: "parses all fields correctly including isActiveWindow and paneCommand",
			lines: []string{
				windowLine(0, "dev", "/home/user/project", fakeNow, 1, "claude"),
				windowLine(2, "build", "/tmp/build", fakeNow, 0, "make"),
			},
			now: fakeNow,
			want: []WindowInfo{
				{Index: 0, Name: "dev", WorktreePath: "/home/user/project", Activity: "active", IsActiveWindow: true, PaneCommand: "claude", ActivityTimestamp: fakeNow},
				{Index: 2, Name: "build", WorktreePath: "/tmp/build", Activity: "active", IsActiveWindow: false, PaneCommand: "make", ActivityTimestamp: fakeNow},
			},
		},
		{
			name:  "empty input returns nil",
			lines: nil,
			now:   fakeNow,
			want:  nil,
		},
		{
			name: "malformed line with fewer than 6 fields is skipped",
			lines: []string{
				"0\tdev\t/path\t1700000000\t1",
				windowLine(1, "good", "/home/user", fakeNow, 1, "zsh"),
			},
			now: fakeNow,
			want: []WindowInfo{
				{Index: 1, Name: "good", WorktreePath: "/home/user", Activity: "active", IsActiveWindow: true, PaneCommand: "zsh", ActivityTimestamp: fakeNow},
			},
		},
		{
			name: "activity exactly at threshold boundary is active",
			lines: []string{
				windowLine(0, "edge", "/path", fakeNow-ActivityThresholdSeconds, 0, "bash"),
			},
			now: fakeNow,
			want: []WindowInfo{
				{Index: 0, Name: "edge", WorktreePath: "/path", Activity: "active", IsActiveWindow: false, PaneCommand: "bash", ActivityTimestamp: fakeNow - ActivityThresholdSeconds},
			},
		},
		{
			name: "activity one second past threshold is idle",
			lines: []string{
				windowLine(0, "past", "/path", fakeNow-ActivityThresholdSeconds-1, 0, "vim"),
			},
			now: fakeNow,
			want: []WindowInfo{
				{Index: 0, Name: "past", WorktreePath: "/path", Activity: "idle", IsActiveWindow: false, PaneCommand: "vim", ActivityTimestamp: fakeNow - ActivityThresholdSeconds - 1},
			},
		},
		{
			name: "paneCommand populated from 6th field",
			lines: []string{
				windowLine(0, "work", "/home/user/code", fakeNow, 1, "node"),
			},
			now: fakeNow,
			want: []WindowInfo{
				{Index: 0, Name: "work", WorktreePath: "/home/user/code", Activity: "active", IsActiveWindow: true, PaneCommand: "node", ActivityTimestamp: fakeNow},
			},
		},
		{
			name: "activityTimestamp exposed as raw unix epoch",
			lines: []string{
				windowLine(0, "ts", "/path", 1710300000, 0, "zsh"),
			},
			now: 1710300100,
			want: []WindowInfo{
				{Index: 0, Name: "ts", WorktreePath: "/path", Activity: "idle", IsActiveWindow: false, PaneCommand: "zsh", ActivityTimestamp: 1710300000},
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
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
