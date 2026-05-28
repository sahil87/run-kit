package api

import (
	"rk/internal/tmuxctl"
)

// NewSupervisorSubscriber adapts a tmuxctl.Supervisor to the
// WindowChangeSubscriber interface used by the SSE hub.
func NewSupervisorSubscriber(sup *tmuxctl.Supervisor) WindowChangeSubscriber {
	return newSupervisorSubscriber(sup)
}

// NewHubSink returns a tmuxctl.EventSink suitable for wiring into a
// tmuxctl.Supervisor when the consumer is the SSE hub. The sink is a no-op
// because the hub observes change via the per-server generation counter on
// the Client, not via Sink callbacks. See client.go's dispatch + Wait.
func NewHubSink() tmuxctl.EventSink {
	return hubSink{}
}

// supervisorSubscriber adapts a *tmuxctl.Supervisor to WindowChangeSubscriber.
// Per-server Generation and Wait calls are forwarded to the Supervisor's
// Client for the named socket. Servers without a Client return generation 0
// and an immediately-closed Wait channel (so the safety-net ticker becomes
// the freshness driver for that server).
type supervisorSubscriber struct {
	sup *tmuxctl.Supervisor
}

func newSupervisorSubscriber(sup *tmuxctl.Supervisor) *supervisorSubscriber {
	return &supervisorSubscriber{sup: sup}
}

func (s *supervisorSubscriber) Generation(server string) int64 {
	if s.sup == nil {
		return 0
	}
	c := s.sup.Get(server)
	if c == nil {
		return 0
	}
	return c.Generation()
}

func (s *supervisorSubscriber) Wait(server string, after int64) <-chan struct{} {
	if s.sup == nil {
		return neverChan()
	}
	c := s.sup.Get(server)
	if c == nil {
		// No Client for this server (PTY-unavailable case, or socket
		// not yet allocated). Return a never-closing channel so the
		// safety-net timer drives wake-ups for this server — closing
		// the channel would cause selectFirst to return immediately
		// and busy-loop FetchSessions instead of honoring the 12s
		// safety cadence.
		return neverChan()
	}
	return c.Wait(after)
}

// neverChan returns a channel that is never closed. Used by
// supervisorSubscriber.Wait when no Client is registered for a server, so the
// SSE select falls through to the safety-net timer instead of spinning.
func neverChan() <-chan struct{} {
	return make(chan struct{})
}

// hubSink is a thin EventSink that the Supervisor dispatches into. Each
// callback is a fire-and-forget signal that "the world changed for this
// server" — the actual snapshot rebuild + broadcast lives in the SSE poll
// loop, which is woken via the Client's per-server generation counter +
// Wait channel.
//
// The Supervisor wires this Sink into every Client. Because Client already
// bumps its own generation counter on each handled notification, the Sink
// callbacks here are intentionally no-ops. They exist so future code can
// hook in per-event side effects (e.g., metrics) without disrupting the
// generation-counter path.
type hubSink struct{}

func (hubSink) OnSessionWindowChanged(string, string) {}
func (hubSink) OnWindowAdd(string)                    {}
func (hubSink) OnWindowClose(string)                  {}
func (hubSink) OnWindowRenamed(string, string)        {}
func (hubSink) OnSessionsChanged()                    {}
func (hubSink) OnLayoutChange(string)                 {}
func (hubSink) OnConnectionLost()                     {}
func (hubSink) OnConnectionEstablished()              {}

// SetWindowChangeSubscriber wires a WindowChangeSubscriber into the lazy-
// initialised SSE hub. Called from `rk serve` after the Supervisor is up.
// Safe to call before any SSE client connects — initSSEHub is invoked here
// to materialise the hub.
func (s *Server) SetWindowChangeSubscriber(sub WindowChangeSubscriber) {
	s.initSSEHub()
	s.sseHub.subscriber = sub
}
