package gui

import "time"

// Status is the shared GUI status document served by `rk gui status --json`
// and GET /api/gui/{id}. Field order is the stream-payload order first, then
// the document-only fields.
type Status struct {
	ID        string `json:"id"`
	Enabled   bool   `json:"enabled"`
	Backend   string `json:"backend"`
	Reachable bool   `json:"reachable"`
	Display   string `json:"display"`
	Width     int    `json:"width"`
	Height    int    `json:"height"`
	Viewers   int    `json:"viewers"`
	WM        string `json:"wm"`
	// Locked is the host resolution pin (`rk gui lock` — @rk_gui_lock on the
	// rk-gui session), always present like wm.
	Locked bool `json:"locked"`
	// HumanInputAgoMS is the age of the last relayed human input in
	// milliseconds (the daemon's in-memory relay timestamp), clamped ≥ 1 so
	// "absent" and "just now" stay distinguishable; omitted when no viewer has
	// driven the display since the daemon started.
	HumanInputAgoMS int64  `json:"human_input_ago_ms,omitempty"`
	Socket          string `json:"socket"`
	Session         bool   `json:"session"`
	Reason          string `json:"reason"`
	Apps            []App  `json:"apps"`
	UptimeSeconds   int64  `json:"uptime_seconds"`
	// WMHint is the install line for the window manager, present only on a
	// reachable display running bare (the unreachable reason already carries
	// the backend hint).
	WMHint string `json:"wm_hint,omitempty"`
}

// App is one running application on the GUI display, grouped by process comm.
type App struct {
	Name  string `json:"name"`
	Count int    `json:"count"`
}

// StreamEntry is the per-id element of the host-global `event: gui` state
// payload — the first eleven fields of Status.
type StreamEntry struct {
	ID        string `json:"id"`
	Enabled   bool   `json:"enabled"`
	Backend   string `json:"backend"`
	Reachable bool   `json:"reachable"`
	Display   string `json:"display"`
	Width     int    `json:"width"`
	Height    int    `json:"height"`
	Viewers   int    `json:"viewers"`
	WM        string `json:"wm"`
	Locked    bool   `json:"locked"`
	// HumanInputAgoMS mirrors Status: the clamped age of the last relayed
	// human input, omitted when none was seen.
	HumanInputAgoMS int64 `json:"human_input_ago_ms,omitempty"`
}

// HumanInputAgoMS renders the age of the last relayed human input in
// milliseconds, clamped to ≥ 1 so a just-seen event never reads as absent
// (the field is omitempty — 0 would vanish from the document).
func HumanInputAgoMS(at, now time.Time) int64 {
	ms := now.Sub(at).Milliseconds()
	if ms < 1 {
		return 1
	}
	return ms
}

// Info is the result of an RFB probe (Probe): reachability plus the geometry
// learned from ServerInit (zero on a tcp probe, which stops at the banner),
// with Reason classifying a failure.
type Info struct {
	Reachable bool
	Width     int
	Height    int
	Reason    string
}

// The fixed not-running reason set shared by `rk gui status`, the doctor gui
// row, and GET /api/gui/{id} — the strings are user-facing copy, so every
// surface renders the identical sentence for the same state.
const (
	// SessionAbsentReason: enabled, but no rk-gui session exists (the daemon
	// spawns it on start).
	SessionAbsentReason = "rk-gui session absent; the daemon starts it on 'rk daemon start'"
	// ScreenSharingOffReason: macOS Screen Sharing is not answering on
	// 127.0.0.1:5900.
	ScreenSharingOffReason = "Screen Sharing is off: System Settings › General › Sharing › Screen Sharing"
)

// NoBackendReason: enabled, but Linux has no VNC backend on PATH — the
// package-manager-aware install line.
func NoBackendReason(lookPath func(string) (string, error)) string {
	return "no VNC backend: " + InstallHint(lookPath)
}

// BackendExitedReason: the session exists and the backend was running (or the
// binary still resolves) but the socket no longer answers — the supervisor is
// parked idle with the exit line in its pane.
func BackendExitedReason(bin string) string {
	return bin + " exited — see the rk-gui pane; 'rk gui restart'"
}

// NotRunningReason classifies why an enabled-but-unreachable GUI is down. The
// precedence is fixed: an absent session outranks everything (nothing was ever
// spawned); macOS only has the Screen Sharing switch; a Linux host with no
// VNC backend on PATH reports the install hint; otherwise the session's
// backend exited (the stamp names the binary; an unstamped session falls back
// to the PATH-resolved name).
func NotRunningReason(session bool, stampedBackend string, lookPath func(string) (string, error)) string {
	if !session {
		return SessionAbsentReason
	}
	if goos == "darwin" || stampedBackend == MacBackend {
		return ScreenSharingOffReason
	}
	resolved, _ := ResolveBackend(lookPath)
	if resolved == "" {
		return NoBackendReason(lookPath)
	}
	bin := stampedBackend
	if bin == "" {
		bin = resolved
	}
	return BackendExitedReason(bin)
}
