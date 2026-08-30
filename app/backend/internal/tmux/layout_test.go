package tmux

import (
	"context"
	"os/exec"
	"reflect"
	"strings"
	"testing"
	"time"
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

// layoutLine builds a layout-capture line with every field placed explicitly:
// rk_layout at idx 7, the web slots at idx 8..15, their roots at 16..23,
// web_active at 24, code_root at 25, marker 26, role 27, flair 28, the note at
// 29 (strict single field), and the legacy note appended LAST (30+).
func layoutLine(session, id, index, name, active, layout, color, rkLayout, webActive, codeRoot, marker, role, flair, note, legacyNote string, tabs, roots []string) string {
	fields := []string{session, id, index, name, active, layout, color, rkLayout}
	var slots, slotRoots [MaxWebTabs]string
	copy(slots[:], tabs)
	copy(slotRoots[:], roots)
	for _, s := range slots {
		fields = append(fields, s)
	}
	for _, r := range slotRoots {
		fields = append(fields, r)
	}
	fields = append(fields, webActive, codeRoot, marker, role, flair, note)
	return strings.Join(fields, listDelim) + listDelim + legacyNote
}

func TestParseLayoutWindows(t *testing.T) {
	// lineThroughMarker builds a line that stops at the marker field (idx 26) —
	// role/flair/note absent, exercising the optional trailing fields.
	lineThroughMarker := func(marker string) string {
		fields := make([]string, 27)
		copy(fields, []string{"kit", "@1", "1", "serve", "1", "d5d2,204x48,0,0,1", "4"})
		fields[26] = marker
		return strings.Join(fields, listDelim)
	}
	// lineThroughNote builds a line that stops at the note field (idx 29).
	lineThroughNote := func(note string) string {
		fields := make([]string, 30)
		copy(fields, []string{"kit", "@1", "1", "serve", "1", "d5d2,204x48,0,0,1"})
		fields[29] = note
		return strings.Join(fields, listDelim)
	}

	tests := []struct {
		name  string
		lines []string
		want  []LayoutWindow
	}{
		{
			name: "windows with options and active flag",
			lines: []string{
				layoutLine("kit", "@1", "1", "serve", "1", "d5d2,204x48,0,0,1", "4", "split-h:tty,web", "1", "", "solid", "operator", "", "", "",
					[]string{"http://x"}, nil),
				"kit\t@2\t2\tshell\t0\tabcd,204x48,0,0,2\t\t\t\t",
			},
			want: []LayoutWindow{
				{Session: "kit", WindowID: "@1", Index: 1, Name: "serve", Active: true,
					Layout: "d5d2,204x48,0,0,1", Color: "4", RkLayout: "split-h:tty,web",
					WebTabs: []string{"http://x"}, WebRoots: []string{""}, WebActive: 1,
					Marker: "manual:1", Role: "operator"},
				{Session: "kit", WindowID: "@2", Index: 2, Name: "shell", Active: false,
					Layout: "abcd,204x48,0,0,2"},
			},
		},
		{
			name: "web family with roots and active index",
			lines: []string{
				layoutLine("kit", "@1", "1", "serve", "1", "d5d2,204x48,0,0,1", "", "", "2", "", "", "", "", "", "",
					[]string{"/proxy/3000/", "/present/@1/2/a.html?server=s&v=1", "https://x/"},
					[]string{"/r1", "", "/r3"}),
			},
			want: []LayoutWindow{
				{Session: "kit", WindowID: "@1", Index: 1, Name: "serve", Active: true,
					Layout:   "d5d2,204x48,0,0,1",
					WebTabs:  []string{"/proxy/3000/", "/present/@1/2/a.html?server=s&v=1", "https://x/"},
					WebRoots: []string{"/r1", "", "/r3"}, WebActive: 2},
			},
		},
		{
			name: "gap truncates to the dense prefix, active clamps",
			lines: []string{
				layoutLine("kit", "@1", "1", "serve", "1", "d5d2,204x48,0,0,1", "", "", "3", "", "", "", "", "", "",
					[]string{"/proxy/3000/", "", "https://x/"}, nil),
			},
			want: []LayoutWindow{
				{Session: "kit", WindowID: "@1", Index: 1, Name: "serve", Active: true,
					Layout:  "d5d2,204x48,0,0,1",
					WebTabs: []string{"/proxy/3000/"}, WebRoots: []string{""}, WebActive: 1},
			},
		},
		{
			name: "line without a role field leaves Role empty",
			lines: []string{
				lineThroughMarker("solid"),
			},
			want: []LayoutWindow{
				{Session: "kit", WindowID: "@1", Index: 1, Name: "serve", Active: true,
					Layout: "d5d2,204x48,0,0,1", Color: "4", Marker: "manual:1"},
			},
		},
		{
			name: "new note in its strict single field (idx 29), verbatim",
			lines: []string{
				lineThroughNote("1756036800:blocked on flaky e2e"),
			},
			want: []LayoutWindow{
				{Session: "kit", WindowID: "@1", Index: 1, Name: "serve", Active: true,
					Layout: "d5d2,204x48,0,0,1", Note: "1756036800:blocked on flaky e2e"},
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

// TestParseLayoutWindowsNoteDualRead pins the prefer-new fallback for the note
// dual-read pair (@rk_win_note↔@rk_note) in parseLayoutWindows — same rule as
// parseWindows: legacy-only values report, new-only values report, and when
// BOTH fields carry a value the NEW name wins. The legacy note tail rejoin
// survives tabs.
func TestParseLayoutWindowsNoteDualRead(t *testing.T) {
	tests := []struct {
		name                string
		newNote, legacyNote string
		wantNote            string
	}{
		{
			name:       "legacy-only (pre-rename writer)",
			legacyNote: "123:old",
			wantNote:   "123:old",
		},
		{
			name:     "new-only",
			newNote:  "456:new",
			wantNote: "456:new",
		},
		{
			name:       "both — new wins",
			newNote:    "456:new",
			legacyNote: "123:old",
			wantNote:   "456:new",
		},
		{
			name:       "legacy note with tabs rejoins the tail",
			legacyNote: "123:two\tpart\tnote",
			wantNote:   "123:two\tpart\tnote",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			line := layoutLine("kit", "@1", "1", "serve", "1", "d5d2,204x48,0,0,1",
				"", "", "", "", "", "", "", tt.newNote, tt.legacyNote, nil, nil)
			got := parseLayoutWindows([]string{line})
			if len(got) != 1 {
				t.Fatalf("parseLayoutWindows() returned %d windows, want 1", len(got))
			}
			if got[0].Note != tt.wantNote {
				t.Errorf("Note = %q, want %q", got[0].Note, tt.wantNote)
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

// TestCreateSessionForRestore_BirthStampsManaged proves the birth branch of
// the provenance stamp: the first restore invocation on a fresh socket births
// the server (and applies the managed conf via -f), so the newborn must read
// managed.
func TestCreateSessionForRestore_BirthStampsManaged(t *testing.T) {
	if _, err := exec.LookPath("tmux"); err != nil {
		t.Skip("tmux not available — skipping integration test")
	}
	server := testSocketName("unit")
	t.Cleanup(func() {
		killCtx, cancelKill := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancelKill()
		_ = exec.CommandContext(killCtx, "tmux", "-L", server, "kill-server").Run()
	})

	if _, _, err := CreateSessionForRestore("restored", "", "", server); err != nil {
		t.Fatalf("CreateSessionForRestore: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	got, err := IsManagedServer(ctx, server)
	if err != nil {
		t.Fatalf("IsManagedServer after restore birth: %v", err)
	}
	if !got {
		t.Error("got false, want true (a server this restore birthed must be stamped managed)")
	}
}

// TestCreateSessionForRestore_ExistingServerNotStamped proves the non-birth
// branch: restoring into an already-live (unmarked) server writes no stamp.
func TestCreateSessionForRestore_ExistingServerNotStamped(t *testing.T) {
	// Boot the server WITHOUT going through CreateSessionForRestore, so it is
	// live but carries no ManagedOption mark.
	server := withSessionOrderTmux(t)

	if _, _, err := CreateSessionForRestore("restored", "", "", server); err != nil {
		t.Fatalf("CreateSessionForRestore on live server: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	got, err := IsManagedServer(ctx, server)
	if err != nil {
		t.Fatalf("IsManagedServer on unmarked live server: %v", err)
	}
	if got {
		t.Error("got true, want false (restore into an existing server writes no stamp)")
	}
}
