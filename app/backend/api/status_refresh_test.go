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
	if body["status"] != "refreshing" {
		t.Errorf("body = %v, want {status:refreshing}", body)
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
	}
	<-entered // the first refresh is now provably in flight

	// Second POST while in flight: 202 but coalesced (no second refresh started).
	if resp := postStatusRefresh(t, router); resp.Code != http.StatusAccepted {
		t.Fatalf("second POST status = %d, want 202", resp.Code)
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
	router := s.buildRouter()

	// First POST at t=base: starts a refresh.
	if resp := postStatusRefresh(t, router); resp.Code != http.StatusAccepted {
		t.Fatalf("first POST status = %d, want 202", resp.Code)
	}
	rec.waitDone(t) // let the first refresh finish (clears in-flight)

	// Second POST still at t=base (< min-interval since last): throttled.
	if resp := postStatusRefresh(t, router); resp.Code != http.StatusAccepted {
		t.Fatalf("throttled POST status = %d, want 202", resp.Code)
	}
	// No new completion should arrive — assert the count did not advance.
	if collector, branch := rec.counts(); collector != 1 || branch != 1 {
		t.Errorf("throttled POST started a refresh: collector=%d branch=%d, want 1 each", collector, branch)
	}

	// Advance past the min-interval: the next POST starts a fresh refresh.
	base = base.Add(statusRefreshMinInterval + time.Second)
	if resp := postStatusRefresh(t, router); resp.Code != http.StatusAccepted {
		t.Fatalf("post-interval POST status = %d, want 202", resp.Code)
	}
	rec.waitDone(t)
	if collector, branch := rec.counts(); collector != 2 || branch != 2 {
		t.Errorf("post-interval kicks: collector=%d branch=%d, want 2 each", collector, branch)
	}
}
