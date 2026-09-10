package gui

import (
	"fmt"
	"sort"
	"strconv"
	"strings"
)

// Pure xdotool argv builders and output parsers for the rk gui agent verbs.
// Nothing here runs a subprocess or touches an X server — every builder
// returns an argv slice and every parser is a pure function, so the whole
// surface is table-testable. xdotool has no display flag; the runner sets
// DISPLAY in the process env (LaunchEnv), so the argv never carries it.

const (
	// XdoSearchAllPattern matches every visible top-level window: xdotool's
	// --name argument is a POSIX regex and the empty regex matches every name,
	// including the empty one (a "." pattern would skip unnamed windows).
	// Verified against xdotool 3.20160805.1 on a bare Xvnc display: the empty
	// pattern lists the root-class window, "." matches nothing.
	XdoSearchAllPattern = ""
)

// Xdo button numbers (the X11 pointer-button convention).
const (
	XdoButtonLeft   = 1
	XdoButtonMiddle = 2
	XdoButtonRight  = 3
)

// XdoTypeDelayMs is the per-keystroke delay for `type` — fast enough for an
// agent loop, slow enough for the focused app to keep up.
const XdoTypeDelayMs = 12

// XdoSearchVisible lists every visible top-level window's X id, one per line.
// display is accepted for signature uniformity with the runner (which targets
// it via env); the argv carries none.
func XdoSearchVisible(display string) []string {
	return []string{"search", "--onlyvisible", "--name", XdoSearchAllPattern}
}

// XdoSearchName lists visible windows whose title matches pattern. --name's
// argument is a regex, so callers regexp.QuoteMeta a literal substring first.
func XdoSearchName(pattern string) []string {
	return []string{"search", "--onlyvisible", "--name", pattern}
}

// XdoWindowName prints a window's title (exit 0 with empty output for an
// unnamed window).
func XdoWindowName(id uint64) []string {
	return []string{"getwindowname", strconv.FormatUint(id, 10)}
}

// XdoWindowGeometry prints a window's geometry as shell assignments
// (WINDOW=/X=/Y=/WIDTH=/HEIGHT=) for ParseWindowGeometry.
func XdoWindowGeometry(id uint64) []string {
	return []string{"getwindowgeometry", "--shell", strconv.FormatUint(id, 10)}
}

// XdoWindowPID prints a window's _NET_WM_PID. It fails when the client sets
// none — callers degrade to pid 0, never an error.
func XdoWindowPID(id uint64) []string {
	return []string{"getwindowpid", strconv.FormatUint(id, 10)}
}

// XdoActiveWindow prints the active window's id. It fails on a bare display
// with no EWMH window manager — callers degrade to "no active row", never an
// error.
func XdoActiveWindow() []string {
	return []string{"getactivewindow"}
}

// XdoActivate raises and focuses a window, waiting for the WM to comply.
func XdoActivate(id uint64) []string {
	return []string{"windowactivate", "--sync", strconv.FormatUint(id, 10)}
}

// XdoMouseMove moves the pointer to display-pixel coordinates.
func XdoMouseMove(x, y int) []string {
	return []string{"mousemove", strconv.Itoa(x), strconv.Itoa(y)}
}

// XdoClick clicks a button; a repeat above 1 rides xdotool's --repeat with the
// double-click delay.
func XdoClick(button, repeat int) []string {
	if repeat > 1 {
		return []string{"click", "--repeat", strconv.Itoa(repeat), "--delay", "100", strconv.Itoa(button)}
	}
	return []string{"click", strconv.Itoa(button)}
}

// XdoScroll clicks a scroll button n times at the scroll cadence.
func XdoScroll(button, n int) []string {
	return []string{"click", "--repeat", strconv.Itoa(n), "--delay", "30", strconv.Itoa(button)}
}

// XdoScrollButton maps a scroll direction word to its X11 button number
// (4 up / 5 down / 6 left / 7 right). ok=false for anything else.
func XdoScrollButton(direction string) (button int, ok bool) {
	switch direction {
	case "up":
		return 4, true
	case "down":
		return 5, true
	case "left":
		return 6, true
	case "right":
		return 7, true
	}
	return 0, false
}

// XdoType types text read from stdin (--file -) — argv never carries user
// text, so no quoting hazard and full unicode range (Constitution I).
func XdoType() []string {
	return []string{"type", "--delay", strconv.Itoa(XdoTypeDelayMs), "--file", "-"}
}

// XdoKey presses chords verbatim in xdotool keysym spelling
// (ctrl+l, Return, alt+F4), clearing held modifiers first.
func XdoKey(chords ...string) []string {
	return append([]string{"key", "--clearmodifiers"}, chords...)
}

// TypeSegments splits text on newlines; the verb sends `key Return` between
// segments, so a trailing newline yields a trailing Return.
func TypeSegments(text string) []string {
	return strings.Split(text, "\n")
}

// Window is one row of the `rk gui windows` inventory.
type Window struct {
	ID     uint64 `json:"id"`
	PID    int    `json:"pid"`
	X      int    `json:"x"`
	Y      int    `json:"y"`
	Width  int    `json:"width"`
	Height int    `json:"height"`
	Title  string `json:"title"`
	Active bool   `json:"active"`
	App    string `json:"app"`
}

// WindowRaw is one window's collected xdotool output — the inputs
// ParseWindows assembles into a Window row.
type WindowRaw struct {
	ID       uint64
	Title    string
	Geometry string // getwindowgeometry --shell output
	PID      string // getwindowpid output, "" when the client sets no _NET_WM_PID
}

// ParseWindowIDs parses xdotool search output (decimal X ids, one per line)
// into sorted ascending order. Blank lines are skipped; garbage fails.
func ParseWindowIDs(out string) ([]uint64, error) {
	var ids []uint64
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		id, err := strconv.ParseUint(line, 10, 64)
		if err != nil {
			return nil, fmt.Errorf("parsing window id %q: %w", line, err)
		}
		ids = append(ids, id)
	}
	sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
	return ids, nil
}

// ParseWindowGeometry parses getwindowgeometry --shell output
// (WINDOW=/X=/Y=/WIDTH=/HEIGHT= lines; SCREEN= is ignored).
func ParseWindowGeometry(out string) (x, y, width, height int, err error) {
	vals := map[string]*int{"X": &x, "Y": &y, "WIDTH": &width, "HEIGHT": &height}
	seen := map[string]bool{}
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		key, val, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		slot, want := vals[key]
		if !want {
			continue
		}
		n, cerr := strconv.Atoi(strings.TrimSpace(val))
		if cerr != nil {
			return 0, 0, 0, 0, fmt.Errorf("parsing %s from %q: %w", key, val, cerr)
		}
		*slot = n
		seen[key] = true
	}
	for key := range vals {
		if !seen[key] {
			return 0, 0, 0, 0, fmt.Errorf("geometry output lacks %s", key)
		}
	}
	return x, y, width, height, nil
}

// ParseWindows assembles sorted inventory rows from per-window xdotool
// outputs. appOf resolves /proc/<pid>/comm (the RunningApps idiom) and is
// consulted only for a resolved pid; activeID marks one row (0 = none, the
// bare-display posture). A row whose geometry no longer parses is dropped —
// the window vanished mid-scan.
func ParseWindows(raw []WindowRaw, activeID uint64, appOf func(pid int) string) []Window {
	windows := make([]Window, 0, len(raw))
	for _, r := range raw {
		x, y, w, h, err := ParseWindowGeometry(r.Geometry)
		if err != nil {
			continue
		}
		win := Window{ID: r.ID, Title: r.Title, X: x, Y: y, Width: w, Height: h, Active: r.ID == activeID}
		if pid, err := strconv.Atoi(strings.TrimSpace(r.PID)); err == nil {
			win.PID = pid
			if appOf != nil {
				win.App = appOf(pid)
			}
		}
		windows = append(windows, win)
	}
	sort.Slice(windows, func(i, j int) bool { return windows[i].ID < windows[j].ID })
	return windows
}
