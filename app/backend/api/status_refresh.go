package api

import (
	"context"
	"net/http"
)

// handleStatusRefresh triggers an on-demand refresh of BOTH PR pollers — the
// viewer-wide collector (prstatus.Collector, which supplies the merged state via
// its URL-keyed join) AND the branch refresher (which covers the sibling case: a
// just-opened PR appearing on a window). It is the SINGLE frequency-control choke
// point for forced refreshes, so any trigger (button-mashing, multiple tabs,
// future auto-triggers) is safe to over-fire.
//
// Behavior:
//   - Non-blocking: the two refreshes run in a DETACHED goroutine (context
//     derived from context.Background() so it outlives the handler, bounded by
//     statusRefreshTimeout — NOT r.Context(), which is cancelled the moment the
//     handler returns). The branch pass is one `gh pr list` per registered pair
//     and can exceed the 5s handler-blocking cap (code-review.md); the 202-then-
//     detach shape keeps the handler well under that cap. The exact detached
//     pattern mirrors api/waiting_push.go.
//   - Coalescing: if a forced refresh is already in flight, no second refresh is
//     started.
//   - Min-interval throttle: a call arriving within statusRefreshMinInterval of
//     the last forced refresh starts nothing.
//   - Tri-state body: started, coalesced, and throttled calls ALL return 202,
//     but the body reports which fate applied so the client can give honest
//     per-status feedback (started/coalesced spin-until-event; throttled shows an
//     "already fresh" flash — see refreshOutcome below). The start is still
//     fire-and-forget: the body is NOT the completion signal (the POST 202s in
//     ~ms while the detached gh work runs). The completion signal — and the fresh
//     data itself — reaches clients via the SSE `status-refresh` event.
//
// refreshOutcome distinguishes the three fates of a POST /api/status/refresh
// call. All three still return 202 (fire-and-forget), but the body reports the
// distinction so the client can give honest per-status feedback: `started` and
// `coalesced` will see a completion event (spin-until-event); `throttled` will
// NOT (nothing was started), so the client shows an "already fresh" flash
// instead of spinning until the fallback timeout.
type refreshOutcome string

const (
	refreshStarted   refreshOutcome = "started"
	refreshCoalesced refreshOutcome = "coalesced"
	refreshThrottled refreshOutcome = "throttled"
)

// POST per Constitution §IX (all mutating endpoints use POST).
//
// POST /api/status/refresh → 202 {"status":"started"|"coalesced"|"throttled"}
func (s *Server) handleStatusRefresh(w http.ResponseWriter, r *http.Request) {
	outcome := s.startStatusRefresh()
	if outcome == refreshStarted {
		// Detach the two refreshes from the request lifecycle: context.Background
		// (not r.Context, which dies on handler return) with its own timeout, so a
		// slow branch pass over many windows can't stall or be cancelled. Clears
		// the in-flight flag + broadcasts the completion event when done so the
		// next post-min-interval POST can start a fresh pass and connected clients
		// can clear their refresh spinners.
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), statusRefreshTimeout)
			defer cancel()
			if s.refreshCollectorFn != nil {
				s.refreshCollectorFn(ctx)
			}
			if s.refreshBranchFn != nil {
				s.refreshBranchFn(ctx)
			}
			s.finishStatusRefresh()
		}()
	}
	// Started, coalesced, or throttled — all fire-and-forget, all 202. The body
	// distinguishes them so the client gives honest per-status feedback.
	writeJSON(w, http.StatusAccepted, map[string]string{"status": string(outcome)})
}

// startStatusRefresh decides the fate of a forced refresh under the coalesce +
// min-interval throttle, and returns which of the three outcomes applied.
// Returns refreshStarted (and marks the refresh in-flight + stamps the start
// time) only when nothing is in flight AND at least statusRefreshMinInterval has
// elapsed since the last forced refresh. Returns refreshCoalesced (a pass is
// already in flight) or refreshThrottled (too soon) otherwise — the caller
// starts no goroutine but still 202s. The started/coalesced/throttled distinction
// was already computed here; it is now surfaced rather than collapsed to a bool.
func (s *Server) startStatusRefresh() refreshOutcome {
	s.refreshStatusMu.Lock()
	defer s.refreshStatusMu.Unlock()
	if s.refreshStatusInFlight {
		return refreshCoalesced // coalesce onto the in-flight refresh
	}
	now := s.now()
	if !s.refreshStatusLast.IsZero() && now.Sub(s.refreshStatusLast) < statusRefreshMinInterval {
		return refreshThrottled // too soon since the last refresh
	}
	s.refreshStatusInFlight = true
	s.refreshStatusLast = now
	return refreshStarted
}

// finishStatusRefresh clears the in-flight flag once the detached refresh
// completes, allowing the next post-min-interval POST to start a new pass, and
// broadcasts the server-global `status-refresh` completion event so clients can
// clear their refresh spinners (the button spins click→event, not click→POST).
// The hub is lazy-initialized on the first SSE connection and is absent in the
// direct-*Server handler tests, so the broadcast nil-guards s.sseHub.
func (s *Server) finishStatusRefresh() {
	s.refreshStatusMu.Lock()
	s.refreshStatusInFlight = false
	s.refreshStatusMu.Unlock()
	if s.sseHub != nil {
		s.sseHub.broadcastStatusRefresh(s.now())
	}
}
