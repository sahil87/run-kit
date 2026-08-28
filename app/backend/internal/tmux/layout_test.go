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

func TestParseLayoutWindows(t *testing.T) {
	tests := []struct {
		name  string
		lines []string
		want  []LayoutWindow
	}{
		{
			name: "windows with options and active flag",
			lines: []string{
				"kit\t@1\t1\tserve\t1\td5d2,204x48,0,0,1\t4\tweb\thttp://x\tsolid\toperator",
				"kit\t@2\t2\tshell\t0\tabcd,204x48,0,0,2\t\t\t\t",
			},
			want: []LayoutWindow{
				{Session: "kit", WindowID: "@1", Index: 1, Name: "serve", Active: true,
					Layout: "d5d2,204x48,0,0,1", Color: "4", RkType: "web", RkURL: "http://x", Marker: "solid", Role: "operator"},
				{Session: "kit", WindowID: "@2", Index: 2, Name: "shell", Active: false,
					Layout: "abcd,204x48,0,0,2"},
			},
		},
		{
			name: "10-field line (no role field) leaves Role empty",
			lines: []string{
				"kit\t@1\t1\tserve\t1\td5d2,204x48,0,0,1\t4\tweb\thttp://x\tsolid",
			},
			want: []LayoutWindow{
				{Session: "kit", WindowID: "@1", Index: 1, Name: "serve", Active: true,
					Layout: "d5d2,204x48,0,0,1", Color: "4", RkType: "web", RkURL: "http://x", Marker: "solid"},
			},
		},
		{
			name: "new note in its strict single field (idx 14), verbatim",
			lines: []string{
				"kit\t@1\t1\tserve\t1\td5d2,204x48,0,0,1\t\t\t\t\t\t\t\t\t1756036800:blocked on flaky e2e",
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

// layoutLineDualRead builds a layout line with both halves of each dual-read
// pair placed explicitly: the NEW lens/URL at idx 7/8, the legacy lens/URL at
// idx 12/13, the NEW note as a strict single field at idx 14, and the legacy
// note appended LAST (idx 15+ — tail-rejoined, so tabs in its text survive).
// Mirrors windowLineDualRead (tmux_test.go).
func layoutLineDualRead(newLens, newURL, legacyLens, legacyURL, newNote, legacyNote string) string {
	fields := []string{
		"kit", "@1", "1", "serve", "1", "d5d2,204x48,0,0,1",
		"",         // color
		newLens,    // @rk_win_lens (new)
		newURL,     // @rk_win_url (new)
		"",         // marker
		"",         // role
		"",         // flair
		legacyLens, // @rk_type (legacy)
		legacyURL,  // @rk_url (legacy)
		newNote,    // @rk_win_note (new — strict single field)
	}
	return strings.Join(fields, listDelim) + listDelim + legacyNote
}

// TestParseLayoutWindowsDualRead pins the prefer-new fallback for the three
// dual-read keys (@rk_win_lens↔@rk_type, @rk_win_url↔@rk_url,
// @rk_win_note↔@rk_note) in parseLayoutWindows — same rule as parseWindows:
// legacy-only values report, new-only values report, and when BOTH fields
// carry a value the NEW name wins. The legacy note tail rejoin survives tabs.
func TestParseLayoutWindowsDualRead(t *testing.T) {
	tests := []struct {
		name                                   string
		newLens, newURL, legacyLens, legacyURL string
		newNote, legacyNote                    string
		wantLens, wantURL, wantNote            string
	}{
		{
			name:       "legacy-only (pre-rename writer)",
			legacyLens: "iframe", legacyURL: "http://legacy", legacyNote: "123:old",
			wantLens: "iframe", wantURL: "http://legacy", wantNote: "123:old",
		},
		{
			name:    "new-only",
			newLens: "iframe", newURL: "http://new", newNote: "456:new",
			wantLens: "iframe", wantURL: "http://new", wantNote: "456:new",
		},
		{
			name:    "both — new wins",
			newLens: "web", newURL: "http://new", newNote: "456:new",
			legacyLens: "iframe", legacyURL: "http://legacy", legacyNote: "123:old",
			wantLens: "web", wantURL: "http://new", wantNote: "456:new",
		},
		{
			name:       "legacy note with tabs rejoins the tail",
			legacyNote: "123:two\tpart\tnote",
			wantNote:   "123:two\tpart\tnote",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			line := layoutLineDualRead(tt.newLens, tt.newURL, tt.legacyLens, tt.legacyURL, tt.newNote, tt.legacyNote)
			got := parseLayoutWindows([]string{line})
			if len(got) != 1 {
				t.Fatalf("parseLayoutWindows() returned %d windows, want 1", len(got))
			}
			if got[0].RkType != tt.wantLens {
				t.Errorf("RkType = %q, want %q", got[0].RkType, tt.wantLens)
			}
			if got[0].RkURL != tt.wantURL {
				t.Errorf("RkURL = %q, want %q", got[0].RkURL, tt.wantURL)
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
