package tmuxctl

import (
	"log/slog"
	"strings"
	"sync"
)

// Event is the sealed-interface root for parsed control-mode lines.
// Concrete event types implement this with a zero-cost marker method.
type Event interface {
	isEvent()
}

// BeginEvent marks the start of a command reply block (`%begin epoch cmd flags`).
type BeginEvent struct {
	Epoch string
	Cmd   string
	Flags string
}

// EndEvent marks the end of a command reply block (`%end epoch cmd flags`).
type EndEvent struct {
	Epoch string
	Cmd   string
	Flags string
}

// ErrorEvent marks an errored command reply block (`%error epoch cmd flags`).
type ErrorEvent struct {
	Epoch string
	Cmd   string
	Flags string
}

// SessionWindowChangedEvent is emitted when the active window changes for a
// session (`%session-window-changed $sid @wid`).
type SessionWindowChangedEvent struct {
	SessionID string
	WindowID  string
}

// WindowAddEvent is emitted when a new window is added (`%window-add @wid`).
type WindowAddEvent struct {
	WindowID string
}

// WindowCloseEvent is emitted when a window is closed (`%window-close @wid`).
type WindowCloseEvent struct {
	WindowID string
}

// WindowRenamedEvent is emitted on window rename (`%window-renamed @wid name with spaces`).
type WindowRenamedEvent struct {
	WindowID string
	Name     string
}

// SessionsChangedEvent is emitted when the session list changes (`%sessions-changed`).
type SessionsChangedEvent struct{}

// UnlinkedWindowEvent is emitted for window add/close/rename in a session the
// control client is NOT attached to (`%unlinked-window-add @wid`,
// `%unlinked-window-close @wid`, `%unlinked-window-renamed @wid name`). tmux
// sends the `%window-*` (linked) variants only for the attached session, and
// the `%unlinked-window-*` variants for every OTHER session on the server.
//
// run-kit's control client attaches to one bootstrap/anchor session per server
// but renders ALL sessions, so an external change (e.g. a window created by
// `rk riff`, a CLI, or another tool) in any non-attached session arrives ONLY
// as an unlinked event. We don't need the per-session active-window detail from
// these (that's tracked from the linked %session-window-changed for the
// attached session) — we only need to know the window set changed so the SSE
// hub rebuilds its snapshot. So this carries no payload; dispatch bumps the
// generation counter, same as the linked window events.
type UnlinkedWindowEvent struct{}

// LayoutChangeEvent is emitted on pane layout change. Only WindowID is retained
// in v1 — the other fields (window-layout / visible-layout / window-flags) are
// parsed off but not surfaced (`%layout-change @wid layout vis flags`).
type LayoutChangeEvent struct {
	WindowID string
}

// UnknownEvent is the typed fallback for any `%`-prefixed notification not
// recognised by ParseLine. The raw line is preserved for diagnostic logging.
type UnknownEvent struct {
	Raw string
}

// MalformedEvent is returned when a recognised notification name is present
// but the expected arguments are missing or invalid.
type MalformedEvent struct {
	Raw string
}

// IgnoredEvent is returned for explicitly-dropped notifications (`%output`,
// `%unlinked-window-*`, content lines inside %begin/%end blocks). Callers may
// distinguish these from UnknownEvent if they need to differentiate silent
// drops from unrecognised lines.
type IgnoredEvent struct{}

func (BeginEvent) isEvent()                 {}
func (EndEvent) isEvent()                   {}
func (ErrorEvent) isEvent()                 {}
func (SessionWindowChangedEvent) isEvent()  {}
func (WindowAddEvent) isEvent()             {}
func (WindowCloseEvent) isEvent()           {}
func (WindowRenamedEvent) isEvent()         {}
func (SessionsChangedEvent) isEvent()       {}
func (UnlinkedWindowEvent) isEvent()        {}
func (LayoutChangeEvent) isEvent()          {}
func (UnknownEvent) isEvent()               {}
func (MalformedEvent) isEvent()             {}
func (IgnoredEvent) isEvent()               {}

// loggedUnknowns tracks notification names already logged once at slog.Debug.
// Keyed by the bare notification name (e.g., "future-feature" — not the raw
// line) so repeated occurrences of the same unknown don't spam logs.
var (
	loggedUnknownsMu sync.Mutex
	loggedUnknowns   = map[string]struct{}{}
)

// resetLoggedUnknowns clears the once-per-process unknown-notification log
// dedupe table. Exposed for tests only.
func resetLoggedUnknowns() {
	loggedUnknownsMu.Lock()
	defer loggedUnknownsMu.Unlock()
	loggedUnknowns = map[string]struct{}{}
}

// ParseLine parses one control-mode protocol line into a typed Event.
//
// Pure function: no I/O, no time dependence, no panics. Unknown `%`-prefixed
// notifications are returned as UnknownEvent (and the bare name is logged once
// at slog.Debug via the process-wide dedupe table). Non-`%` lines (content
// inside %begin/%end blocks) are silently dropped as IgnoredEvent.
func ParseLine(line string) Event {
	// tmux -CC wraps its first %begin line in a DCS (Device Control String)
	// envelope: ESC P 1000 p ... [ESC \]. Strip that envelope before
	// parsing so the rest of the parser can stay protocol-pure.
	line = stripDCSEnvelope(line)
	if line == "" {
		return IgnoredEvent{}
	}
	if !strings.HasPrefix(line, "%") {
		// Content lines inside %begin/%end blocks are dropped silently —
		// callers that need command-reply payloads track them around the
		// %begin/%end markers themselves.
		return IgnoredEvent{}
	}

	// Split into [name, rest] on the first space.
	rest := ""
	name := line[1:]
	if i := strings.IndexByte(name, ' '); i >= 0 {
		rest = name[i+1:]
		name = name[:i]
	}

	switch name {
	case "begin":
		epoch, cmd, flags, ok := splitThree(rest)
		if !ok {
			return MalformedEvent{Raw: line}
		}
		return BeginEvent{Epoch: epoch, Cmd: cmd, Flags: flags}
	case "end":
		epoch, cmd, flags, ok := splitThree(rest)
		if !ok {
			return MalformedEvent{Raw: line}
		}
		return EndEvent{Epoch: epoch, Cmd: cmd, Flags: flags}
	case "error":
		epoch, cmd, flags, ok := splitThree(rest)
		if !ok {
			return MalformedEvent{Raw: line}
		}
		return ErrorEvent{Epoch: epoch, Cmd: cmd, Flags: flags}
	case "session-window-changed":
		sid, wid, ok := splitTwo(rest)
		if !ok {
			return MalformedEvent{Raw: line}
		}
		return SessionWindowChangedEvent{SessionID: sid, WindowID: wid}
	case "window-add":
		if rest == "" {
			return MalformedEvent{Raw: line}
		}
		return WindowAddEvent{WindowID: rest}
	case "window-close":
		if rest == "" {
			return MalformedEvent{Raw: line}
		}
		return WindowCloseEvent{WindowID: rest}
	case "window-renamed":
		// Name may contain spaces — only split on the first.
		wid, n, ok := splitTwo(rest)
		if !ok {
			return MalformedEvent{Raw: line}
		}
		return WindowRenamedEvent{WindowID: wid, Name: n}
	case "unlinked-window-add", "unlinked-window-close", "unlinked-window-renamed":
		// Window add/close/rename in a NON-attached session on this server. We
		// don't parse the payload (we only need "something changed" to trigger a
		// snapshot rebuild — see UnlinkedWindowEvent). Tolerate any/empty rest:
		// unlike the linked variants we never index the window id, so a missing
		// argument is not malformed for our purposes.
		return UnlinkedWindowEvent{}
	case "sessions-changed":
		return SessionsChangedEvent{}
	case "layout-change":
		// Format: @wid layout vis flags. Only @wid is needed in v1; the
		// remaining fields are tolerated when present but absence of them
		// is also accepted (some tmux versions emit a shorter form).
		if rest == "" {
			return MalformedEvent{Raw: line}
		}
		wid := rest
		if i := strings.IndexByte(rest, ' '); i >= 0 {
			wid = rest[:i]
		}
		return LayoutChangeEvent{WindowID: wid}
	case "output":
		// `%output <pane-id> <value>` is the normal pane-output stream in
		// control mode and is not relevant for subscription. Drop silently.
		return IgnoredEvent{}
	case "session-changed":
		// `%session-changed $sid name` fires when the client attaches to
		// a new session. Distinct from `%sessions-changed` (no `s`) and
		// not relevant to per-session active-window tracking — drop.
		return IgnoredEvent{}
	case "exit":
		// `%exit [reason]` — control mode is exiting. Treat as ignored
		// here; the read loop will observe EOF and trigger reconnect via
		// its normal path.
		return IgnoredEvent{}
	case "client-detached", "client-session-changed", "continue", "extended-output", "pause", "subscription-changed", "config-error":
		// Other tmux 3.x notifications that don't affect the SSE
		// snapshot — drop silently to avoid polluting the
		// "unknown" log channel.
		return IgnoredEvent{}
	default:
		if strings.HasPrefix(name, "unlinked-window-") {
			return IgnoredEvent{}
		}
		// Unknown — log once per name to surface tmux protocol additions
		// without spamming production logs.
		logUnknownOnce(name)
		return UnknownEvent{Raw: line}
	}
}

// splitTwo splits s on the first space and returns (a, b, true). Returns
// ("", "", false) if the input has no space or either side is empty.
func splitTwo(s string) (string, string, bool) {
	i := strings.IndexByte(s, ' ')
	if i <= 0 || i >= len(s)-1 {
		return "", "", false
	}
	return s[:i], s[i+1:], true
}

// splitThree splits s into exactly three space-separated tokens.
func splitThree(s string) (string, string, string, bool) {
	parts := strings.SplitN(s, " ", 3)
	if len(parts) != 3 || parts[0] == "" || parts[1] == "" || parts[2] == "" {
		return "", "", "", false
	}
	return parts[0], parts[1], parts[2], true
}

// stripDCSEnvelope removes a leading DCS (Device Control String) envelope and
// optional trailing ST (String Terminator) terminator. Tmux's first %begin
// reply line is wrapped as `\x1bP1000p%begin ... \x1b\\` — the envelope is
// safe to strip uniformly because no real tmux notification carries an ESC P
// inside its payload.
func stripDCSEnvelope(s string) string {
	const dcsPrefix = "\x1bP1000p"
	const st = "\x1b\\"
	if strings.HasPrefix(s, dcsPrefix) {
		s = s[len(dcsPrefix):]
	}
	s = strings.TrimSuffix(s, st)
	return s
}

func logUnknownOnce(name string) {
	loggedUnknownsMu.Lock()
	_, already := loggedUnknowns[name]
	if !already {
		loggedUnknowns[name] = struct{}{}
	}
	loggedUnknownsMu.Unlock()
	if !already {
		slog.Debug("tmuxctl: unknown notification", "name", name)
	}
}
