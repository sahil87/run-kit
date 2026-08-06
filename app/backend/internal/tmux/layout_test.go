package tmux

import (
	"reflect"
	"testing"
)

func TestParseLayoutSessions(t *testing.T) {
	tests := []struct {
		name  string
		lines []string
		want  []LayoutSession
	}{
		{
			name: "basic sessions with and without color",
			lines: []string{
				"kit\t1750000000\t4",
				"utils\t1750000100\t",
			},
			want: []LayoutSession{
				{Name: "kit", Created: 1750000000, Color: "4"},
				{Name: "utils", Created: 1750000100, Color: ""},
			},
		},
		{
			name: "pin-sessions and control anchor filtered",
			lines: []string{
				"_rk-pin-42\t1750000000\t",
				"_rk-ctl\t1750000001\t",
				"real\t1750000002\t1+3",
			},
			want: []LayoutSession{
				{Name: "real", Created: 1750000002, Color: "1+3"},
			},
		},
		{
			name: "malformed lines skipped",
			lines: []string{
				"short\t123",           // too few fields
				"bad\tnot-a-ts\t",      // non-integer created
				"\t1750000000\t",       // empty name
				"ok\t1750000003\tblue", // valid
			},
			want: []LayoutSession{
				{Name: "ok", Created: 1750000003, Color: "blue"},
			},
		},
		{
			name:  "empty input",
			lines: nil,
			want:  nil,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := parseLayoutSessions(tt.lines)
			if !reflect.DeepEqual(got, tt.want) {
				t.Errorf("parseLayoutSessions() = %+v, want %+v", got, tt.want)
			}
		})
	}
}

func TestParseLayoutWindows(t *testing.T) {
	tests := []struct {
		name  string
		lines []string
		want  []LayoutWindow
	}{
		{
			name: "windows with options and active flag",
			lines: []string{
				"kit\t@1\t1\tserve\t1\td5d2,204x48,0,0,1\t4\tweb\thttp://x\tsolid",
				"kit\t@2\t2\tshell\t0\tabcd,204x48,0,0,2\t\t\t\t",
			},
			want: []LayoutWindow{
				{Session: "kit", WindowID: "@1", Index: 1, Name: "serve", Active: true,
					Layout: "d5d2,204x48,0,0,1", Color: "4", RkType: "web", RkURL: "http://x", Marker: "solid"},
				{Session: "kit", WindowID: "@2", Index: 2, Name: "shell", Active: false,
					Layout: "abcd,204x48,0,0,2"},
			},
		},
		{
			name: "pin-session link rows skipped, home row kept once",
			lines: []string{
				"_rk-pin-7\t@7\t0\tpinned\t1\tllll,1x1,0,0,7\t\t\t\t",
				"home\t@7\t3\tpinned\t0\tllll,1x1,0,0,7\t\t\t\t",
				"home\t@7\t3\tpinned\t0\tllll,1x1,0,0,7\t\t\t\t", // duplicate id
			},
			want: []LayoutWindow{
				{Session: "home", WindowID: "@7", Index: 3, Name: "pinned",
					Layout: "llll,1x1,0,0,7"},
			},
		},
		{
			name: "malformed lines skipped",
			lines: []string{
				"kit\t@9\tnot-an-index\tx\t0\tl\t\t\t\t",
				"kit\tnot-a-window-id\t1\tx\t0\tl\t\t\t\t",
				"kit\t@9\t1\tx\t0", // too few fields
			},
			want: nil,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := parseLayoutWindows(tt.lines)
			if !reflect.DeepEqual(got, tt.want) {
				t.Errorf("parseLayoutWindows() = %+v, want %+v", got, tt.want)
			}
		})
	}
}

func TestParseLayoutPanes(t *testing.T) {
	lines := []string{
		"@1\t%0\t0\t/home/u/proj\tzsh\t1",
		"@1\t%1\t1\t/home/u/proj/sub\tclaude\t0",
		"@2\t%2\t0\t/tmp\tbash\t1",
		"@2\t%2\t0\t/tmp\tbash\t1",        // duplicate pane id collapses
		"@3\t%3\tnot-an-index\t/x\tsh\t0", // malformed index skipped
		"bad\t%4\t0\t/x\tsh\t0",           // invalid window id skipped
		"@3\t\t0\t/x\tsh\t0",              // empty pane id skipped
		"@3\t%5\t0",                       // too few fields
	}
	got := parseLayoutPanes(lines)
	want := map[string][]LayoutPane{
		"@1": {
			{WindowID: "@1", PaneID: "%0", Index: 0, Cwd: "/home/u/proj", Command: "zsh", Active: true},
			{WindowID: "@1", PaneID: "%1", Index: 1, Cwd: "/home/u/proj/sub", Command: "claude", Active: false},
		},
		"@2": {
			{WindowID: "@2", PaneID: "%2", Index: 0, Cwd: "/tmp", Command: "bash", Active: true},
		},
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("parseLayoutPanes() = %+v, want %+v", got, want)
	}

	if parseLayoutPanes(nil) != nil {
		t.Error("parseLayoutPanes(nil) should return nil")
	}
}

func TestListLayoutSessionsDeadServerErrors(t *testing.T) {
	// A never-started socket name: the layout read MUST return an error (a
	// capture racing server death must never read as "empty server"). Unlike
	// ListSessions, the dead-server case is NOT mapped to (nil, nil).
	ctx := t.Context()
	if _, err := ListLayoutSessions(ctx, "rk-test-layout-dead-sock"); err == nil {
		t.Fatal("ListLayoutSessions on a dead socket: want error, got nil")
	} else if !IsServerGone(err) {
		t.Fatalf("ListLayoutSessions dead-socket error not classified by IsServerGone: %v", err)
	}
	if _, err := ListLayoutWindows(ctx, "rk-test-layout-dead-sock"); err == nil {
		t.Fatal("ListLayoutWindows on a dead socket: want error, got nil")
	}
	if _, err := ListLayoutPanes(ctx, "rk-test-layout-dead-sock"); err == nil {
		t.Fatal("ListLayoutPanes on a dead socket: want error, got nil")
	}
}

func TestBuildRestoreSessionArgs(t *testing.T) {
	got := buildRestoreSessionArgs("kit", "serve", "/home/u/proj")
	// configArgs() may prepend ["-f", path]; assert on the tail.
	tail := got[len(got)-11:]
	want := []string{"new-session", "-d", "-P", "-F", "#{window_id}\t#{window_index}", "-s", "kit", "-n", "serve", "-c", "/home/u/proj"}
	if !reflect.DeepEqual(tail, want) {
		t.Errorf("buildRestoreSessionArgs tail = %v, want %v", tail, want)
	}

	// Empty windowName and cwd omit -n / -c entirely.
	got = buildRestoreSessionArgs("kit", "", "")
	tail = got[len(got)-7:]
	want = []string{"new-session", "-d", "-P", "-F", "#{window_id}\t#{window_index}", "-s", "kit"}
	if !reflect.DeepEqual(tail, want) {
		t.Errorf("buildRestoreSessionArgs(no name/cwd) tail = %v, want %v", tail, want)
	}
}

func TestBuildRestoreWindowArgs(t *testing.T) {
	got := buildRestoreWindowArgs("kit", 3, "agent", "/tmp/w")
	want := []string{"new-window", "-d", "-P", "-F", "#{window_id}", "-t", "=kit:3", "-n", "agent", "-c", "/tmp/w"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("buildRestoreWindowArgs = %v, want %v", got, want)
	}

	// Missing cwd (deleted worktree fallback) omits -c; empty name omits -n.
	got = buildRestoreWindowArgs("kit", 5, "", "")
	want = []string{"new-window", "-d", "-P", "-F", "#{window_id}", "-t", "=kit:5"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("buildRestoreWindowArgs(no name/cwd) = %v, want %v", got, want)
	}
}
