package api

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"sync"
	"testing"
	"time"
)

// newRefreshTestServer builds an in-package *Server wired with recorder kick
// seams and a controllable clock, then returns it alongside its router. Building
// the Server directly (rather than via NewTestRouter) lets a test set the
// unexported refreshCollectorFn / refreshBranchFn / nowFn seams before the router
// is built — asserting both kicks fire, and driving the throttle clock, without
// any gh subprocess.
func newRefreshTestServer(t *testing.T) (*Server, *refreshRecorder, http.Handler) {
	t.Helper()
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))
	rec := &refreshRecorder{done: make(chan struct{}, 16)}
	s := &Server{
		logger:   logger,
		sessions: &mockSessionFetcher{},
		tmux:     &mockTmuxOps{},
		hostname: "test-host",
	}
	s.refreshCollectorFn = func(context.Context) { rec.markCollector() }
	s.refreshBranchFn = func(context.Context) {
		rec.markBranch()
		// Signal completion so tests can wait deterministically for the detached
		// goroutine (the branch kick is the last one the handler runs).
		rec.done <- struct{}{}
	}
	return s, rec, s.buildRouter()
}

// refreshRecorder counts kick invocations under a lock and signals goroutine
// completion via done. Concurrency-safe: the detached refresh runs on its own
// goroutine.
type refreshRecorder struct {
	mu        sync.Mutex
	collector int
	branch    int
	done      chan struct{}
}

func (r *refreshRecorder) markCollector() {
	r.mu.Lock()
	r.collector++
	r.mu.Unlock()
}

func (r *refreshRecorder) markBranch() {
	r.mu.Lock()
	r.branch++
	r.mu.Unlock()
}

func (r *refreshRecorder) counts() (int, int) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.collector, r.branch
}

// waitDone blocks until the detached refresh signals completion, or fails the
// test after a short deadline (no real sleeps in the success path — this only
// waits on the goroutine's own completion signal).
func (r *refreshRecorder) waitDone(t *testing.T) {
	t.Helper()
	select {
	case <-r.done:
	case <-time.After(2 * time.Second):
		t.Fatal("detached refresh did not complete within 2s")
	}
}

func postStatusRefresh(t *testing.T, router http.Handler) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/status/refresh", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

// refreshBodyStatus parses the `status` field out of a 202 response body.
func refreshBodyStatus(t *testing.T, resp *httptest.ResponseRecorder) string {
	t.Helper()
	var body map[string]string
	if err := json.Unmarshal(resp.Body.Bytes(), &body); err != nil {
		t.Fatalf("bad JSON: %v (%s)", err, resp.Body.String())
	}
	return body["status"]
}

// TestHandleStatusRefresh_Returns202AndKicksBoth: a POST returns 202 immediately
// and the detached goroutine kicks BOTH pollers.
func TestHandleStatusRefresh_Returns202AndKicksBoth(t *testing.T) {
	_, rec, router := newRefreshTestServer(t)

	resp := postStatusRefresh(t, router)
	if resp.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want 202; body=%s", resp.Code, resp.Body.String())
	}
	var body map[string]string
	if err := json.Unmarshal(resp.Body.Bytes(), &body); err != nil {
		t.Fatalf("bad JSON: %v (%s)", err, resp.Body.String())
	}
	if body["status"] != "started" {
		t.Errorf("body = %v, want {status:started}", body)
	}

	rec.waitDone(t)
	collector, branch := rec.counts()
	if collector != 1 || branch != 1 {
		t.Errorf("kicks: collector=%d branch=%d, want 1 and 1", collector, branch)
	}
}

// TestHandleStatusRefresh_NoCollectorNoPanic: with no collector wired the handler
// (using the production nil-guarding refreshCollectorFn) must still 202 and kick
// the branch refresher, never panicking.
func TestHandleStatusRefresh_NoCollectorNoPanic(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))
	rec := &refreshRecorder{done: make(chan struct{}, 1)}
	s := &Server{logger: logger, sessions: &mockSessionFetcher{}, tmux: &mockTmuxOps{}, hostname: "h"}
	// Production-shaped collector kick: nil-guards s.prStatus (which is nil here).
	s.refreshCollectorFn = func(ctx context.Context) {
		if s.prStatus != nil {
			s.prStatus.RefreshNow(ctx)
		}
	}
	s.refreshBranchFn = func(context.Context) { rec.markBranch(); rec.done <- struct{}{} }
	router := s.buildRouter()

	resp := postStatusRefresh(t, router)
	if resp.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want 202; body=%s", resp.Code, resp.Body.String())
	}
	rec.waitDone(t)
	if _, branch := rec.counts(); branch != 1 {
		t.Errorf("branch kick = %d, want 1 (fires even with no collector)", branch)
	}
}

// recvStatusRefresh block-receives exactly one `status-refresh` frame from the
// client channel (or fails after a deadline). The broadcast is emitted by
// finishStatusRefresh() AFTER it clears the in-flight flag, so a successful
// receive establishes BOTH orderings at once: the detached pass ran to
// completion AND the flag is cleared — a follow-up POST will now see the
// throttle, not a stale in-flight coalesce. This is the completion signal the
// test waits on (not rec.done, which fires inside the branch kick, before the
// flag clear + broadcast).
func recvStatusRefresh(t *testing.T, ch <-chan []byte) {
	t.Helper()
	deadline := time.After(2 * time.Second)
	for {
		select {
		case frame := <-ch:
			if len(filterSSEEvents([]string{string(frame)}, "status-refresh")) == 1 {
				return
			}
			// Ignore any other frame (e.g. a cached snapshot) and keep waiting.
		case <-deadline:
			t.Fatal("did not receive a status-refresh frame within 2s")
		}
	}
}

// drainStatusRefreshCount non-blockingly drains the channel and returns how many
// status-refresh frames were buffered. Used to assert that a coalesced/throttled
// POST (which starts no pass) broadcast NO additional frame.
func drainStatusRefreshCount(ch <-chan []byte) int {
	var events []string
	for len(ch) > 0 {
		events = append(events, string(<-ch))
	}
	return len(filterSSEEvents(events, "status-refresh"))
}

// TestHandleStatusRefresh_BroadcastsOnCompletion: a completed refresh pass emits
// exactly ONE server-global `status-refresh` frame from finishStatusRefresh(),
// and neither a coalesced POST (while in flight) nor a throttled POST (after the
// pass, within min-interval) — both of which start nothing — emits an extra
// frame. A real hub is wired onto the Server so the broadcast reaches a
// subscribed client — the handler tests otherwise build a hub-less *Server.
func TestHandleStatusRefresh_BroadcastsOnCompletion(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))
	rec := &refreshRecorder{done: make(chan struct{}, 4)}
	release := make(chan struct{})
	entered := make(chan struct{}, 1)
	s := &Server{logger: logger, sessions: &mockSessionFetcher{}, tmux: &mockTmuxOps{}, hostname: "h"}
	base := time.Unix(2_000_000, 0)
	s.nowFn = func() time.Time { return base }
	s.refreshCollectorFn = func(context.Context) { rec.markCollector() }
	s.refreshBranchFn = func(context.Context) {
		entered <- struct{}{} // signal the goroutine reached the kick
		<-release             // hold the refresh in-flight so a coalesced POST can race it
		rec.markBranch()
		rec.done <- struct{}{}
	}
	// Wire a real hub + a subscribed client so broadcastStatusRefresh is observable.
	hub := newSSEHub(s.sessions, nil, nil, nil)
	s.sseHub = hub
	client := &sseClient{ch: make(chan []byte, 16), server: "default"}
	hub.addClient(client)
	defer hub.removeClient(client)
	router := s.buildRouter()

	// First POST starts a refresh that blocks in the branch kick (in flight).
	if resp := postStatusRefresh(t, router); resp.Code != http.StatusAccepted {
		t.Fatalf("first POST status = %d, want 202", resp.Code)
	}
	<-entered // the first refresh is now provably in flight

	// A coalesced POST (while in flight) starts nothing, so no frame is emitted.
	if resp := postStatusRefresh(t, router); resp.Code != http.StatusAccepted {
		t.Fatalf("coalesced POST status = %d, want 202", resp.Code)
	} else if st := refreshBodyStatus(t, resp); st != "coalesced" {
		t.Fatalf("in-flight POST body status = %q, want coalesced", st)
	}
	if n := drainStatusRefreshCount(client.ch); n != 0 {
		t.Errorf("coalesced POST broadcast %d status-refresh frames, want 0 (no pass started)", n)
	}

	// Release the pass and block-receive its single completion frame. The receive
	// is the completion signal — it also proves the in-flight flag is now clear.
	close(release)
	recvStatusRefresh(t, client.ch)
	if n := drainStatusRefreshCount(client.ch); n != 0 {
		t.Errorf("extra status-refresh frames after one completed pass = %d, want 0", n)
	}

	// A throttled POST (still within min-interval, clock frozen) starts nothing,
	// so no additional completion event should be broadcast.
	if resp := postStatusRefresh(t, router); resp.Code != http.StatusAccepted {
		t.Fatalf("throttled POST status = %d, want 202", resp.Code)
	} else if st := refreshBodyStatus(t, resp); st != "throttled" {
		t.Fatalf("throttled POST body status = %q, want throttled", st)
	}
	if n := drainStatusRefreshCount(client.ch); n != 0 {
		t.Errorf("throttled POST broadcast %d status-refresh frames, want 0 (no pass started)", n)
	}
}

// TestHandleStatusRefresh_Coalesces: while a refresh is in flight, a second POST
// returns 202 but starts NO second refresh (coalescing). A blocking branch kick
// holds the goroutine in-flight across the second POST.
func TestHandleStatusRefresh_Coalesces(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))
	rec := &refreshRecorder{done: make(chan struct{}, 1)}
	release := make(chan struct{})
	entered := make(chan struct{}, 1)
	s := &Server{logger: logger, sessions: &mockSessionFetcher{}, tmux: &mockTmuxOps{}, hostname: "h"}
	s.refreshCollectorFn = func(context.Context) { rec.markCollector() }
	s.refreshBranchFn = func(context.Context) {
		entered <- struct{}{} // signal the goroutine reached the kick
		<-release             // hold the refresh in-flight until the test releases it
		rec.markBranch()
		rec.done <- struct{}{}
	}
	router := s.buildRouter()

	// First POST starts a refresh that blocks in the branch kick.
	if resp := postStatusRefresh(t, router); resp.Code != http.StatusAccepted {
		t.Fatalf("first POST status = %d, want 202", resp.Code)
	} else if s := refreshBodyStatus(t, resp); s != "started" {
		t.Errorf("first POST body status = %q, want started", s)
	}
	<-entered // the first refresh is now provably in flight

	// Second POST while in flight: 202 but coalesced (no second refresh started).
	if resp := postStatusRefresh(t, router); resp.Code != http.StatusAccepted {
		t.Fatalf("second POST status = %d, want 202", resp.Code)
	} else if s := refreshBodyStatus(t, resp); s != "coalesced" {
		t.Errorf("in-flight POST body status = %q, want coalesced", s)
	}

	close(release) // let the first (only) refresh finish
	rec.waitDone(t)
	collector, branch := rec.counts()
	if collector != 1 || branch != 1 {
		t.Errorf("coalesced kicks: collector=%d branch=%d, want exactly 1 each (no second refresh)", collector, branch)
	}
}

// TestHandleStatusRefresh_ThrottlesWithinMinInterval: a POST arriving within
// statusRefreshMinInterval of the previous refresh returns 202 but starts no
// refresh; a POST past the interval starts one. The clock seam drives this
// deterministically — no real sleeps.
func TestHandleStatusRefresh_ThrottlesWithinMinInterval(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))
	rec := &refreshRecorder{done: make(chan struct{}, 4)}
	s := &Server{logger: logger, sessions: &mockSessionFetcher{}, tmux: &mockTmuxOps{}, hostname: "h"}
	base := time.Unix(1_000_000, 0)
	s.nowFn = func() time.Time { return base }
	s.refreshCollectorFn = func(context.Context) { rec.markCollector() }
	s.refreshBranchFn = func(context.Context) { rec.markBranch(); rec.done <- struct{}{} }
	// Wire a real hub + subscribed client so the completion broadcast is the pass
	// signal. Block-receiving it (not rec.done) guarantees finishStatusRefresh()
	// cleared the in-flight flag before the throttled POST — rec.done fires inside
	// the branch kick, BEFORE the flag clear, so a POST racing it could coalesce.
	hub := newSSEHub(s.sessions, nil, nil, nil)
	s.sseHub = hub
	client := &sseClient{ch: make(chan []byte, 16), server: "default"}
	hub.addClient(client)
	defer hub.removeClient(client)
	router := s.buildRouter()

	// First POST at t=base: starts a refresh.
	if resp := postStatusRefresh(t, router); resp.Code != http.StatusAccepted {
		t.Fatalf("first POST status = %d, want 202", resp.Code)
	} else if s := refreshBodyStatus(t, resp); s != "started" {
		t.Errorf("first POST body status = %q, want started", s)
	}
	recvStatusRefresh(t, client.ch) // pass complete AND in-flight flag cleared

	// Second POST still at t=base (< min-interval since last): throttled.
	if resp := postStatusRefresh(t, router); resp.Code != http.StatusAccepted {
		t.Fatalf("throttled POST status = %d, want 202", resp.Code)
	} else if s := refreshBodyStatus(t, resp); s != "throttled" {
		t.Errorf("within-interval POST body status = %q, want throttled", s)
	}
	// No new completion should arrive — assert the count did not advance.
	if collector, branch := rec.counts(); collector != 1 || branch != 1 {
		t.Errorf("throttled POST started a refresh: collector=%d branch=%d, want 1 each", collector, branch)
	}

	// Advance past the min-interval: the next POST starts a fresh refresh.
	base = base.Add(statusRefreshMinInterval + time.Second)
	if resp := postStatusRefresh(t, router); resp.Code != http.StatusAccepted {
		t.Fatalf("post-interval POST status = %d, want 202", resp.Code)
	} else if s := refreshBodyStatus(t, resp); s != "started" {
		t.Errorf("post-interval POST body status = %q, want started", s)
	}
	recvStatusRefresh(t, client.ch)
	if collector, branch := rec.counts(); collector != 2 || branch != 2 {
		t.Errorf("post-interval kicks: collector=%d branch=%d, want 2 each", collector, branch)
	}
}
