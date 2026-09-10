package gui

import (
	"strconv"
	"strings"
	"testing"
)

func TestXdoArgvBuilders(t *testing.T) {
	cases := []struct {
		name string
		got  []string
		want []string
	}{
		// The empty-regex all-windows pattern: --name takes a POSIX regex and
		// "" matches every window including unnamed ones (verified against
		// xdotool 3.20160805.1 on a bare Xvnc display — "." matched nothing
		// there because the root-class window has no name).
		{"search visible", XdoSearchVisible(":10"), []string{"search", "--onlyvisible", "--name", ""}},
		{"search name", XdoSearchName("xterm"), []string{"search", "--onlyvisible", "--name", "xterm"}},
		{"window name", XdoWindowName(1305), []string{"getwindowname", "1305"}},
		{"window geometry", XdoWindowGeometry(1305), []string{"getwindowgeometry", "--shell", "1305"}},
		{"window pid", XdoWindowPID(1305), []string{"getwindowpid", "1305"}},
		{"active window", XdoActiveWindow(), []string{"getactivewindow"}},
		{"activate", XdoActivate(1305), []string{"windowactivate", "--sync", "1305"}},
		{"mouse move", XdoMouseMove(10, 20), []string{"mousemove", "10", "20"}},
		{"click", XdoClick(XdoButtonLeft, 1), []string{"click", "1"}},
		{"double click", XdoClick(XdoButtonLeft, 2), []string{"click", "--repeat", "2", "--delay", "100", "1"}},
		{"right click", XdoClick(XdoButtonRight, 1), []string{"click", "3"}},
		{"scroll", XdoScroll(4, 3), []string{"click", "--repeat", "3", "--delay", "30", "4"}},
		{"type reads stdin", XdoType(), []string{"type", "--delay", "12", "--file", "-"}},
		{"key single", XdoKey("Return"), []string{"key", "--clearmodifiers", "Return"}},
		{"key chords", XdoKey("ctrl+l", "alt+F4"), []string{"key", "--clearmodifiers", "ctrl+l", "alt+F4"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if strings.Join(tc.got, "\x00") != strings.Join(tc.want, "\x00") {
				t.Errorf("argv = %q, want %q", tc.got, tc.want)
			}
		})
	}
}

func TestXdoScrollButton(t *testing.T) {
	for dir, want := range map[string]int{"up": 4, "down": 5, "left": 6, "right": 7} {
		got, ok := XdoScrollButton(dir)
		if !ok || got != want {
			t.Errorf("XdoScrollButton(%q) = (%d, %v), want (%d, true)", dir, got, ok, want)
		}
	}
	if _, ok := XdoScrollButton("sideways"); ok {
		t.Error("XdoScrollButton(sideways) = ok, want !ok")
	}
}

func TestTypeSegments(t *testing.T) {
	cases := map[string][]string{
		"a\nb\n":  {"a", "b", ""},
		"a\nb":    {"a", "b"},
		"plain":   {"plain"},
		"\n":      {"", ""},
		"":        {""},
		"a\n\nb":  {"a", "", "b"},
		"héllo\n": {"héllo", ""},
	}
	for in, want := range cases {
		got := TypeSegments(in)
		if strings.Join(got, "\x00") != strings.Join(want, "\x00") {
			t.Errorf("TypeSegments(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestParseWindowIDs(t *testing.T) {
	ids, err := ParseWindowIDs("1305\n42\n9001\n")
	if err != nil {
		t.Fatal(err)
	}
	if len(ids) != 3 || ids[0] != 42 || ids[1] != 1305 || ids[2] != 9001 {
		t.Errorf("ids = %v, want sorted [42 1305 9001]", ids)
	}
	ids, err = ParseWindowIDs("")
	if err != nil || len(ids) != 0 {
		t.Errorf("empty search = (%v, %v), want no ids and no error (an empty display lists nothing)", ids, err)
	}
	if _, err := ParseWindowIDs("notanid\n"); err == nil {
		t.Error("garbage line parsed without error")
	}
}

func TestParseWindowGeometry(t *testing.T) {
	x, y, w, h, err := ParseWindowGeometry("WINDOW=1305\nX=10\nY=20\nWIDTH=800\nHEIGHT=600\nSCREEN=0\n")
	if err != nil {
		t.Fatal(err)
	}
	if x != 10 || y != 20 || w != 800 || h != 600 {
		t.Errorf("geometry = %d,%d %dx%d, want 10,20 800x600", x, y, w, h)
	}
	if _, _, _, _, err := ParseWindowGeometry("X=10\nY=20\nWIDTH=800\n"); err == nil {
		t.Error("missing HEIGHT parsed without error")
	}
	if _, _, _, _, err := ParseWindowGeometry("X=10\nY=20\nWIDTH=wide\nHEIGHT=600\n"); err == nil {
		t.Error("non-numeric WIDTH parsed without error")
	}
}

func TestParseWindows(t *testing.T) {
	geom := func(x, y, w, h int) string {
		return "WINDOW=1\nX=" + itoa(x) + "\nY=" + itoa(y) + "\nWIDTH=" + itoa(w) + "\nHEIGHT=" + itoa(h) + "\nSCREEN=0\n"
	}
	raw := []WindowRaw{
		{ID: 9001, Title: "xterm", Geometry: geom(0, 0, 800, 600), PID: "4242"},
		{ID: 42, Title: "root", Geometry: geom(0, 0, 1920, 1080), PID: ""},     // no _NET_WM_PID
		{ID: 77, Title: "gone", Geometry: "window vanished mid-scan", PID: ""}, // dropped
	}
	got := ParseWindows(raw, 9001, func(pid int) string {
		if pid == 4242 {
			return "xterm"
		}
		return ""
	})
	if len(got) != 2 {
		t.Fatalf("rows = %+v, want 2 (the vanished window dropped)", got)
	}
	if got[0].ID != 42 {
		t.Errorf("first row id = %d, want 42 (sorted by X id)", got[0].ID)
	}
	if got[0].PID != 0 || got[0].App != "" {
		t.Errorf("no-pid row = pid %d app %q, want 0 and empty — never an error", got[0].PID, got[0].App)
	}
	win := got[1]
	if win.ID != 9001 || !win.Active || win.PID != 4242 || win.App != "xterm" || win.Title != "xterm" {
		t.Errorf("row = %+v, want id 9001 active pid 4242 app xterm", win)
	}
	if win.Width != 800 || win.Height != 600 || win.X != 0 || win.Y != 0 {
		t.Errorf("geometry = %+v, want 0,0 800x600", win)
	}

	// A bare display: getactivewindow failed (activeID 0) — no row marked.
	rows := ParseWindows(raw[:1], 0, nil)
	if rows[0].Active {
		t.Error("activeID 0 marked a row active — a failing getactivewindow must yield no active mark")
	}
}

func itoa(n int) string {
	return strconv.Itoa(n)
}
