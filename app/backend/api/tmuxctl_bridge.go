package api

import (
	"context"
	"log/slog"

	"rk/internal/sessions"
	"rk/internal/tmux"
	"rk/internal/tmuxctl"
	"rk/internal/updatecheck"
)

// NewSupervisorSubscriber adapts a tmuxctl.Supervisor to the
// WindowChangeSubscriber interface used by the SSE hub.
func NewSupervisorSubscriber(sup *tmuxctl.Supervisor) WindowChangeSubscriber {
	return newSupervisorSubscriber(sup)
}

// NewHubSinkFactory returns the per-socket SinkFactory the Supervisor uses to
// build one tracker-bound EventSink per Client. Each sink records active-window
// state into the supplied per-socket ActiveWindowTracker (via the
// %session-window-changed payload), refreshes the `$sid`→group map on
// %sessions-changed, and re-seeds Tier 1 on (re)connect. The generation-counter
// path (which actually wakes the SSE poll loop) is preserved — the Client bumps
// it in dispatch after the sink callback returns, so tracking is purely
// additive. Production callers pass this to tmuxctl.NewSupervisor.
func NewHubSinkFactory() tmuxctl.SinkFactory {
	return func(server string, tracker *tmuxctl.ActiveWindowTracker) tmuxctl.EventSink {
		return &hubSink{
			server:            server,
			tracker:           tracker,
			listSessionGroups: tmux.ListSessionGroups,
			listActiveByGroup: tmux.ListActiveWindowsByGroup,
		}
	}
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

// Covers reports whether the Supervisor has a live Client for the server. A
// missing Client (rk-test-* servers the supervisor skips via
// isTmuxSocketCandidate, or PTY-unavailable hosts) means no event-driven
// wake-ups for that server, so the SSE loop must fall back to the fast safety
// cadence rather than the 12s control-mode interval.
func (s *supervisorSubscriber) Covers(server string) bool {
	if s.sup == nil {
		return false
	}
	return s.sup.Get(server) != nil
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

// hubSink is the per-socket EventSink the Supervisor dispatches into. Beyond
// the generation-counter path (which the Client bumps itself, after each sink
// callback returns, to wake the SSE poll loop), this sink records the
// active-window payload into its per-Client ActiveWindowTracker so the fetch
// path can derive isActiveWindow authoritatively (Tier 1).
//
// All callbacks run on the Client's single read-loop goroutine and MUST NOT
// block it (EventSink contract). The %session-window-changed callback performs
// only a bounded, in-memory map operation. The connection/sessions-changed
// re-seed issues read-only tmux queries (list-sessions / list-windows), which
// could block for up to a timeout, so they are offloaded to their own
// goroutine — the read loop returns immediately. The tracker is concurrency-
// safe, so a slightly-delayed refresh racing with an event is harmless (the
// next event/refresh converges).
type hubSink struct {
	server  string
	tracker *tmuxctl.ActiveWindowTracker

	// Injectable read-only tmux query seams (defaults wire to the real
	// helpers in NewHubSinkFactory; tests stub them to avoid spawning tmux).
	listSessionGroups func(ctx context.Context, server string) (map[string]string, error)
	listActiveByGroup func(ctx context.Context, server string) (map[string]string, error)
}

// OnSessionWindowChanged records windowID as the active window for the session
// group that sessionID belongs to, resolved via the tracker's cached
// `$sid`→group map (O(1), no subprocess). An unresolved sessionID (a session
// newer than the last %sessions-changed refresh) is tolerated: the event is
// skipped for tracking and corrected on the next refresh — it MUST NOT error,
// panic, or block (the read loop owns this goroutine). Latest event wins.
func (h *hubSink) OnSessionWindowChanged(sessionID, windowID string) {
	if h.tracker == nil {
		return
	}
	group, ok := h.tracker.ResolveGroup(sessionID)
	if !ok {
		// Unknown sid — drop for tracking; the next %sessions-changed
		// repopulates the map. Generation bump still fires in the Client.
		return
	}
	h.tracker.Set(group, windowID)
}

func (h *hubSink) OnWindowAdd(string)             {}
func (h *hubSink) OnWindowClose(string)           {}
func (h *hubSink) OnWindowRenamed(string, string) {}

// OnSessionsChanged refreshes the tracker's `$sid`→group map so subsequent
// active-window events resolve to the correct group. Offloaded to a goroutine
// so the read-loop is never blocked on the read-only list-sessions query.
func (h *hubSink) OnSessionsChanged() {
	go h.refreshSidGroups()
}

func (h *hubSink) OnLayoutChange(string) {}
func (h *hubSink) OnConnectionLost()     {}

// OnConnectionEstablished re-seeds the tracker on initial attach and every
// reconnect: (1) refresh the `$sid`→group map, and (2) seed Tier 1 from the
// current `#{window_active}` per group. tmux does NOT replay
// %session-window-changed on a fresh `-CC` attach, so without this the tracker
// would be cold (first snapshot blank) or stale (post-reconnect). Offloaded to
// a goroutine so the read-loop is never blocked on the read-only tmux queries.
func (h *hubSink) OnConnectionEstablished() {
	go h.reseed()
}

// reseed performs the synchronous re-seed: refresh the `$sid`→group map, then
// seed Tier 1 from current `#{window_active}` per group. Both queries are
// read-only and context-bounded (Constitution §VI). Exposed (same-package) for
// deterministic testing without goroutine scheduling.
func (h *hubSink) reseed() {
	h.refreshSidGroups()
	if h.tracker == nil || h.listActiveByGroup == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), tmux.TmuxTimeout)
	defer cancel()
	byGroup, err := h.listActiveByGroup(ctx, h.server)
	if err != nil {
		slog.Debug("tmuxctl: re-seed active windows failed", "server", h.server, "err", err)
		return
	}
	if len(byGroup) > 0 {
		h.tracker.SeedGroups(byGroup)
	}
}

// refreshSidGroups reloads the tracker's `$sid`→group resolution map from a
// read-only list-sessions query. Shared by OnSessionsChanged and reseed.
// Synchronous; callers that run on the read loop wrap it in a goroutine.
func (h *hubSink) refreshSidGroups() {
	if h.tracker == nil || h.listSessionGroups == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), tmux.TmuxTimeout)
	defer cancel()
	m, err := h.listSessionGroups(ctx, h.server)
	if err != nil {
		slog.Debug("tmuxctl: refresh sid→group map failed", "server", h.server, "err", err)
		return
	}
	h.tracker.ReplaceSidGroups(m)
}

// SetWindowChangeSubscriber wires a WindowChangeSubscriber into the lazy-
// initialised SSE hub. Called from `rk serve` after the Supervisor is up.
// Safe to call before any SSE client connects — initSSEHub is invoked here
// to materialise the hub.
func (s *Server) SetWindowChangeSubscriber(sub WindowChangeSubscriber) {
	s.initSSEHub()
	s.sseHub.subscriber = sub
}

// SetActiveWindowProvider injects the Tier-1 active-window provider (the
// tmuxctl Supervisor) into the production session fetcher so FetchSessions can
// derive isActiveWindow from control-mode events. Called from `rk serve` after
// the Supervisor starts, alongside SetWindowChangeSubscriber. A no-op if the
// fetcher is not the production fetcher (e.g. a test-injected fake), which keeps
// the seam optional. The SSE hub holds the same SessionFetcher reference (set in
// NewRouterAndServer before this call), so mutating the provider field is
// observed by both the REST and SSE paths.
func (s *Server) SetActiveWindowProvider(provider sessions.ActiveWindowProvider) {
	if pf, ok := s.sessions.(*prodSessionFetcher); ok {
		pf.provider = provider
	}
}

// SetVersion seeds the SSE hub's server-global `event: version` cached slot with
// the running daemon version (ldflags-injected `main.version`). Called from
// `rk serve` after NewRouterAndServer. Safe to call before any SSE client
// connects — initSSEHub materialises the hub. The version cannot change for the
// process lifetime, so the slot is delivered on connect only (no broadcast).
func (s *Server) SetVersion(version string) {
	s.initSSEHub()
	s.sseHub.setVersion(version)
}

// SetUpdateChecker injects the running update checker so the /api/update handler
// can read its cached verdict (whether a qualifying newer version is pending).
// Called from `rk serve` after constructing + starting the checker (the checker
// needs the ldflags version, only known in cmd/rk). A nil checker leaves the
// handler to report "no update available" (409) for every request.
func (s *Server) SetUpdateChecker(c *updatecheck.Checker) {
	s.updateChecker = c
}

// WireUpdateAvailableBroadcast returns the callback that the update checker
// invokes when it finds a qualifying newer version. It publishes the
// server-global `event: update-available` via the SSE hub. Called from `rk serve`
// to bridge the checker's OnQualify hook into the hub (initSSEHub is invoked so
// the hub exists even before the first client connects).
func (s *Server) WireUpdateAvailableBroadcast() func(current, latest string) {
	s.initSSEHub()
	return func(current, latest string) {
		s.sseHub.broadcastUpdateAvailable(current, latest)
	}
}
