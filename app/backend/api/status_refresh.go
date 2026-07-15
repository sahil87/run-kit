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
//   - Fire-and-forget: started, coalesced, and throttled calls ALL return 202 —
//     the client never distinguishes them. The response body is never what the UI
//     waits on; fresh data reaches clients via the existing SSE stream.
//
// POST per Constitution §IX (all mutating endpoints use POST).
//
// POST /api/status/refresh → 202 {"status":"refreshing"}
func (s *Server) handleStatusRefresh(w http.ResponseWriter, r *http.Request) {
	if s.startStatusRefresh() {
		// Detach the two refreshes from the request lifecycle: context.Background
		// (not r.Context, which dies on handler return) with its own timeout, so a
		// slow branch pass over many windows can't stall or be cancelled. Clears
		// the in-flight flag when done so the next post-min-interval POST can start
		// a fresh pass.
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
	// Started, coalesced, or throttled — all fire-and-forget, all 202.
	writeJSON(w, http.StatusAccepted, map[string]string{"status": "refreshing"})
}

// startStatusRefresh decides whether a new forced refresh may begin, under the
// coalesce + min-interval throttle. Returns true (and marks the refresh
// in-flight + stamps the start time) only when nothing is in flight AND at least
// statusRefreshMinInterval has elapsed since the last forced refresh. Returns
// false to coalesce/throttle — the caller starts no goroutine but still 202s.
func (s *Server) startStatusRefresh() bool {
	s.refreshStatusMu.Lock()
	defer s.refreshStatusMu.Unlock()
	if s.refreshStatusInFlight {
		return false // coalesce onto the in-flight refresh
	}
	now := s.now()
	if !s.refreshStatusLast.IsZero() && now.Sub(s.refreshStatusLast) < statusRefreshMinInterval {
		return false // throttled — too soon since the last refresh
	}
	s.refreshStatusInFlight = true
	s.refreshStatusLast = now
	return true
}

// finishStatusRefresh clears the in-flight flag once the detached refresh
// completes, allowing the next post-min-interval POST to start a new pass.
func (s *Server) finishStatusRefresh() {
	s.refreshStatusMu.Lock()
	s.refreshStatusInFlight = false
	s.refreshStatusMu.Unlock()
}
