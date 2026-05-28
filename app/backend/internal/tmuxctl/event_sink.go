package tmuxctl

// EventSink is the consumer interface a Client dispatches notifications into.
//
// Callbacks are all invoked from a single goroutine — the Client's read loop.
// Sink implementations MUST NOT block. Handlers SHALL complete quickly (e.g.,
// atomic counter increment + channel close) and offload any non-trivial work
// to their own goroutine. Callback ordering reflects the order of
// notifications received from tmux.
type EventSink interface {
	// OnSessionWindowChanged fires when tmux reports a different window is
	// active in a session (`%session-window-changed`).
	OnSessionWindowChanged(sessionID, windowID string)

	// OnWindowAdd fires when a window is added (`%window-add`).
	OnWindowAdd(windowID string)

	// OnWindowClose fires when a window is closed (`%window-close`).
	OnWindowClose(windowID string)

	// OnWindowRenamed fires when a window is renamed (`%window-renamed`).
	OnWindowRenamed(windowID, name string)

	// OnSessionsChanged fires when the session list changes
	// (`%sessions-changed`).
	OnSessionsChanged()

	// OnLayoutChange fires on pane layout change (`%layout-change`).
	OnLayoutChange(windowID string)

	// OnConnectionLost fires once when the PTY read loop observes EOF or
	// any error other than a Close()-driven context cancellation. The
	// reconnect FSM is engaged after this callback returns.
	OnConnectionLost()

	// OnConnectionEstablished fires when a fresh `%begin` line completes
	// (initial open or reconnect). Backoff state is reset upon the first
	// non-`%begin` event arriving after this — see Client.handleEvent.
	OnConnectionEstablished()
}

// NoOpSink is a zero-cost EventSink for tests and PTY-unavailable scenarios.
type NoOpSink struct{}

func (NoOpSink) OnSessionWindowChanged(string, string) {}
func (NoOpSink) OnWindowAdd(string)                    {}
func (NoOpSink) OnWindowClose(string)                  {}
func (NoOpSink) OnWindowRenamed(string, string)        {}
func (NoOpSink) OnSessionsChanged()                    {}
func (NoOpSink) OnLayoutChange(string)                 {}
func (NoOpSink) OnConnectionLost()                     {}
func (NoOpSink) OnConnectionEstablished()              {}
