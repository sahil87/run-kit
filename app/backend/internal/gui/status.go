package gui

// Status is the shared GUI status document served by `rk gui status --json`
// and GET /api/gui/{id}. Field order is the stream-payload order first, then
// the document-only fields.
type Status struct {
	ID            string `json:"id"`
	Enabled       bool   `json:"enabled"`
	Backend       string `json:"backend"`
	Reachable     bool   `json:"reachable"`
	Display       string `json:"display"`
	Width         int    `json:"width"`
	Height        int    `json:"height"`
	Viewers       int    `json:"viewers"`
	Socket        string `json:"socket"`
	Session       bool   `json:"session"`
	Reason        string `json:"reason"`
	Apps          []App  `json:"apps"`
	UptimeSeconds int64  `json:"uptime_seconds"`
}

// App is one running application on the GUI display, grouped by process comm.
type App struct {
	Name  string `json:"name"`
	Count int    `json:"count"`
}

// StreamEntry is the per-id element of the host-global `event: gui` state
// payload — the first eight fields of Status.
type StreamEntry struct {
	ID        string `json:"id"`
	Enabled   bool   `json:"enabled"`
	Backend   string `json:"backend"`
	Reachable bool   `json:"reachable"`
	Display   string `json:"display"`
	Width     int    `json:"width"`
	Height    int    `json:"height"`
	Viewers   int    `json:"viewers"`
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
	// NoBackendReason: enabled, but Linux has no VNC backend on PATH.
	NoBackendReason = "no VNC backend: sudo apt install tigervnc-standalone-server openbox"
	// ScreenSharingOffReason: macOS Screen Sharing is not answering on
	// 127.0.0.1:5900.
	ScreenSharingOffReason = "Screen Sharing is off: System Settings › General › Sharing › Screen Sharing"
)

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
		return NoBackendReason
	}
	bin := stampedBackend
	if bin == "" {
		bin = resolved
	}
	return BackendExitedReason(bin)
}
