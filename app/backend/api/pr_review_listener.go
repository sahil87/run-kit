package api

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"rk/internal/prreview"
	"rk/internal/prstatus"
	"rk/internal/sessions"
	"rk/internal/tmux"
)

// The PR-review comment listener (spec docs/specs/pr-review.md § The Listener).
//
// It is a TRACKER SIBLING of operatorQueueTracker, not a cron entry: cron's
// entries are user-authored, per-server, disk-backed intent files with orphan
// GC, and synthesizing and reaping one per window toggle would be churn against
// machinery built for a different lifecycle. What it DOES borrow from cron is
// the delivery rules — the active|waiting busy predicate read fresh at delivery
// time, a per-window min gap, an entry TTL, requeue-on-re-busy, drop-quietly on
// anything else, an hourly rate cap, and a circuit breaker.
//
// It lives in package api rather than internal/prreview because it needs two
// things that live here: the SSE tick's already-fetched session snapshot (for
// the busy predicate and target resolution) and the daemon's injection adapter.
// operatorQueueTracker sits here for exactly the same reasons.
//
// State is process memory only. A daemon restart forgets in-flight queueing and
// re-derives everything from gh on the next poll (Constitution II) — the 👀
// marker on GitHub is the only durable record of what has been handled.

const (
	// prListenQueueCap bounds one window's pending threads. A review larger
	// than this drains over successive ticks; nothing is lost, because the
	// queue is re-derived from the digest every tick.
	prListenQueueCap = 8
	// prListenTTL expires a queued thread (operatorQueueTTL's value — the
	// borrowed-rules principle extends to the constants).
	prListenTTL = 30 * time.Minute
	// prListenMinGap mirrors operatorQueueMinGap: the rolled-up agent state
	// lags an injection by a hook round-trip, so a second delivery inside this
	// window would be aimed at a pane that only LOOKS idle.
	prListenMinGap = 60 * time.Second
	// prListenRatePerHour is cron's DefaultTargetRatePerHour: a per-window
	// ceiling so a pathological PR cannot storm one agent.
	prListenRatePerHour = 30
	// prListenFailureLimit is the circuit breaker. Three consecutive delivery
	// failures on one window disarm it — enough to ride out a single transient
	// probe failure without spamming a broken pane. Re-arming is one click.
	prListenFailureLimit = 3
	// prListenDeliverTimeout bounds one detached delivery: a detail fetch, an
	// injection, and the reaction write.
	prListenDeliverTimeout = 60 * time.Second
)

// errPRListenBusy is the retryable rejection: the target went busy between the
// tick's snapshot and the fresh read at delivery time. The entry requeues.
var errPRListenBusy = errors.New("target agent is busy")

// errPRListenAbsent is the other retryable rejection: the target window is not
// there right now. v1 HOLDS rather than respawning, and — critically — holds
// WITHOUT marking, so nothing is lost.
var errPRListenAbsent = errors.New("target window is absent")

// errPRListenUnavailable is the third: gh is down or unauthenticated. It holds
// rather than counting toward the circuit breaker, because an outage is not
// evidence that this WINDOW is broken — disarming the user's tab over someone
// else's network is the wrong response.
var errPRListenUnavailable = errors.New("gh is unavailable")

// prListenEntry is one queued thread.
type prListenEntry struct {
	server   string
	windowID string
	prURL    string
	threadID string
	queuedAt time.Time
}

func prListenKey(server, windowID string) string { return server + "\x00" + windowID }

// prListenWindow is one window's listener state.
type prListenWindow struct {
	queue    []prListenEntry
	inFlight *prListenEntry
	lastSent time.Time
	// sends holds the delivery timestamps inside the rate window. It is
	// pruned on read, so the slice stays bounded by the cap.
	sends    []time.Time
	failures int
	// disarmed latches a tripped circuit breaker. The state is KEPT rather
	// than deleted so a failed disarm write cannot let the breaker re-trip in
	// a loop: the option is still set, so `advance` would otherwise rebuild a
	// fresh zero-failure state on the very next tick. The latch clears the
	// only honest way — the window's option going false, which deletes the
	// state entirely.
	disarmed bool
}

type prReviewListenerDeliver func(ctx context.Context, entry prListenEntry) error

// prReviewListenerTracker owns queued review threads until an idle observation
// can hand one to the window's own agent.
type prReviewListenerTracker struct {
	mu      sync.Mutex
	windows map[string]*prListenWindow
	now     func() time.Time

	// deliver is the injected fan-out seam. Nil (the test-hub shape) never
	// reserves an entry — draining with no injection would consume the queue
	// while tracking is supposed to keep advancing.
	deliver prReviewListenerDeliver
	// unhandled supplies the eligible thread digests for a PR. Nil (a hub with
	// no collector) means nothing is ever eligible.
	unhandled func(prURL string) []prstatus.ReviewThread
	// enabled is the pr_review_listener settings gate, read at EVERY tick so a
	// flip takes effect without a daemon restart.
	enabled func() bool
	// disarm clears the window's @rk_win_pr_listen option — the circuit
	// breaker's hand on the switch.
	disarm func(server, windowID string)
}

func newPRReviewListenerTracker() *prReviewListenerTracker {
	return &prReviewListenerTracker{
		windows: make(map[string]*prListenWindow),
		now:     time.Now,
	}
}

// advance evaluates the level-triggered drain condition from one already-fetched
// server snapshot: it refreshes each armed window's queue from the digest,
// expires stale entries, and reserves at most ONE thread per window for detached
// delivery — "one thread per idle observation", so a twenty-comment review does
// not arrive as a wall.
func (t *prReviewListenerTracker) advance(server string, snapshot []sessions.ProjectSession) {
	if t.enabled != nil && !t.enabled() {
		return
	}
	now := t.now()

	t.mu.Lock()
	var reserved []prListenEntry
	live := map[string]bool{}
	for si := range snapshot {
		for wi := range snapshot[si].Windows {
			window := &snapshot[si].Windows[wi]
			key := prListenKey(server, window.WindowID)
			if !window.PrListen || window.PrURL == nil || *window.PrURL == "" {
				// Disarming drops the queue: the user said stop, and a
				// re-arm re-derives the backlog from the same predicate.
				delete(t.windows, key)
				continue
			}
			live[key] = true
			state := t.windows[key]
			if state == nil {
				state = &prListenWindow{}
				t.windows[key] = state
			}
			t.refreshQueueLocked(state, server, window, now)
			t.expireLocked(state, server, window.WindowID, now)
			if entry := t.reserveLocked(state, window, now); entry != nil {
				reserved = append(reserved, *entry)
			}
		}
	}
	// A window that vanished from this server's snapshot keeps nothing.
	for key := range t.windows {
		if strings.HasPrefix(key, server+"\x00") && !live[key] {
			delete(t.windows, key)
		}
	}
	t.mu.Unlock()

	for i := range reserved {
		entry := reserved[i]
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), prListenDeliverTimeout)
			defer cancel()
			t.finishDelivery(entry, t.deliver(ctx, entry))
		}()
	}
}

// refreshQueueLocked re-derives the window's pending set from the digest. The
// predicate IS the backlog — no cursor, no seed file, no separate backfill path
// — so arming a window mid-review picks up every thread already written.
func (t *prReviewListenerTracker) refreshQueueLocked(state *prListenWindow, server string, window *tmux.WindowInfo, now time.Time) {
	if t.unhandled == nil || state.disarmed {
		return
	}
	queued := map[string]bool{}
	for _, entry := range state.queue {
		queued[entry.threadID] = true
	}
	if state.inFlight != nil {
		queued[state.inFlight.threadID] = true
	}
	for _, thread := range t.unhandled(*window.PrURL) {
		if queued[thread.ID] || thread.ID == "" {
			continue
		}
		if len(state.queue) >= prListenQueueCap {
			return
		}
		state.queue = append(state.queue, prListenEntry{
			server:   server,
			windowID: window.WindowID,
			prURL:    *window.PrURL,
			threadID: thread.ID,
			queuedAt: now,
		})
		queued[thread.ID] = true
	}
}

func (t *prReviewListenerTracker) expireLocked(state *prListenWindow, server, windowID string, now time.Time) {
	if len(state.queue) == 0 {
		return
	}
	kept := state.queue[:0]
	for _, entry := range state.queue {
		if now.Sub(entry.queuedAt) > prListenTTL {
			slog.Debug("pr review listener entry expired", "server", server, "window", windowID, "thread", entry.threadID)
			continue
		}
		kept = append(kept, entry)
	}
	state.queue = kept
}

// reserveLocked applies the gates — a free slot, an idle agent, the min gap and
// the hourly cap — and pops one entry.
func (t *prReviewListenerTracker) reserveLocked(state *prListenWindow, window *tmux.WindowInfo, now time.Time) *prListenEntry {
	if t.deliver == nil || state.disarmed || state.inFlight != nil || len(state.queue) == 0 {
		return nil
	}
	if agentBusy(window.AgentState) {
		return nil
	}
	if !state.lastSent.IsZero() && now.Sub(state.lastSent) < prListenMinGap {
		return nil
	}
	state.sends = pruneSends(state.sends, now)
	if len(state.sends) >= prListenRatePerHour {
		slog.Warn("pr review listener rate-capped", "window", window.WindowID, "cap", prListenRatePerHour)
		return nil
	}
	entry := state.queue[0]
	state.queue = state.queue[1:]
	state.inFlight = &entry
	state.lastSent = now
	state.sends = append(state.sends, now)
	return &entry
}

// agentBusy is cron's when-idle predicate: active OR waiting is busy. Waiting
// counts because a pane blocked on a human question would swallow the injection
// into its prompt.
func agentBusy(state string) bool {
	return state == tmux.AgentStateActive || state == tmux.AgentStateWaiting
}

func pruneSends(sends []time.Time, now time.Time) []time.Time {
	kept := sends[:0]
	for _, at := range sends {
		if now.Sub(at) < time.Hour {
			kept = append(kept, at)
		}
	}
	return kept
}

// finishDelivery applies the failure taxonomy. Busy and absent requeue (both
// are "not now", and the absent case must leave the thread unmarked so nothing
// is lost); every other error is dropped quietly and counts toward the circuit
// breaker; success clears it.
func (t *prReviewListenerTracker) finishDelivery(entry prListenEntry, err error) {
	key := prListenKey(entry.server, entry.windowID)

	t.mu.Lock()
	state := t.windows[key]
	if state == nil || state.inFlight == nil || state.inFlight.threadID != entry.threadID {
		t.mu.Unlock()
		return
	}
	state.inFlight = nil
	tripped := false
	switch {
	case errors.Is(err, errPRListenBusy), errors.Is(err, errPRListenAbsent),
		errors.Is(err, errPRListenUnavailable):
		state.queue = append([]prListenEntry{entry}, state.queue...)
	case err != nil:
		state.failures++
		tripped = state.failures >= prListenFailureLimit
	default:
		state.failures = 0
	}
	if tripped {
		state.disarmed = true
		state.queue = nil
	}
	t.mu.Unlock()

	if err != nil {
		slog.Debug("pr review listener delivery failed", "err", err, "server", entry.server, "window", entry.windowID, "thread", entry.threadID)
	}
	if tripped && t.disarm != nil {
		slog.Warn("pr review listener disarmed after repeated failures",
			"server", entry.server, "window", entry.windowID, "failures", prListenFailureLimit)
		t.disarm(entry.server, entry.windowID)
	}
}

// retain reaps state only for servers whose tick was observed and whose socket
// is confirmed gone — the operatorQueueTracker rule, so a transient fetch
// failure never drops a queue.
func (t *prReviewListenerTracker) retain(live, observed map[string]bool) {
	t.mu.Lock()
	defer t.mu.Unlock()
	for key := range t.windows {
		server, _, ok := strings.Cut(key, "\x00")
		if !ok {
			continue
		}
		if observed[server] && !live[server] {
			delete(t.windows, key)
		}
	}
}

// pending reports one window's queue depth — the tracker's only read seam, used
// by tests.
func (t *prReviewListenerTracker) pending(server, windowID string) int {
	t.mu.Lock()
	defer t.mu.Unlock()
	state := t.windows[prListenKey(server, windowID)]
	if state == nil {
		return 0
	}
	return len(state.queue)
}

// ── the payload ────────────────────────────────────────────────────────────

// The `pr-review-thread` payload is a SIBLING of the operator template
// registry (operator.go's operatorTemplates), deliberately not a row in it, and
// it therefore has no registry id: every entry in that map is an
// operator-addressed, CLIENT-SELECTABLE id exposed through
// OperatorTemplateList() / `rk operator request --list`, while this payload is
// server-initiated and addressed to the SUBJECT window's own agent. A row here
// would publish a template no client may request and would force an exclusion
// flag onto every other entry.
//
// prReviewThreadFacts are the inputs the payload renders from. All of them are
// DERIVED (Constitution X): the PR from the branch, the thread from gh, the
// hunk from the patch. Nothing is pushed by an agent.
type prReviewThreadFacts struct {
	PRNumber int
	PRURL    string
	Repo     string
	Path     string
	Side     string
	Line     int
	Hunk     string
	Comments []prreview.Comment
	// ThreadURL is the web address of the thread itself — the agent is asked to
	// resolve the thread, so it needs a way to open it. GitHub has no
	// thread-level permalink; the first comment's url IS the thread anchor
	// (`…/pull/N#discussion_rNNN`).
	ThreadURL string
}

// renderPRReviewThread composes the work item. Plain string composition, no
// text/template — the operator registry's rule, for the same reason: a template
// engine would let a fact silently become a directive.
//
// Every comment body rides a DYNAMIC bare fence (fenceUserText): reviewer prose
// is data the agent must read, and a fixed fence is escapable by a body that
// contains one.
func renderPRReviewThread(f prReviewThreadFacts) string {
	var b strings.Builder
	anchor := f.Path
	if f.Line > 0 {
		anchor = fmt.Sprintf("%s:%d (%s side)", f.Path, f.Line, sideWord(f.Side))
	}
	fmt.Fprintf(&b, "[review → you] A review thread on %s#%d is waiting on a fix.\n\n",
		f.Repo, f.PRNumber)
	fmt.Fprintf(&b, "  pull request: %s\n", f.PRURL)
	fmt.Fprintf(&b, "  file:         %s\n", anchor)
	if f.ThreadURL != "" {
		fmt.Fprintf(&b, "  thread:       %s\n", f.ThreadURL)
	}
	if f.Hunk != "" {
		fmt.Fprintf(&b, "\nThe hunk the thread is anchored to:\n\n%s\n", fenceUserText(f.Hunk))
	}
	b.WriteString("\nThe thread, oldest comment first:\n")
	for _, comment := range f.Comments {
		fmt.Fprintf(&b, "\n%s wrote:\n%s\n", commentAuthor(comment), fenceUserText(comment.Body))
	}
	b.WriteString("\nFix what the thread asks for, push the fix, and resolve the thread when it is done." +
		" If the thread is asking a question rather than requesting a change, reply on it instead.\n")
	return b.String()
}

func commentAuthor(comment prreview.Comment) string {
	if comment.Author == "" {
		return "A reviewer"
	}
	return "@" + comment.Author
}

func sideWord(side string) string {
	if side == prreview.SideLeft {
		return "left/old"
	}
	return "right/new"
}

// ── delivery ───────────────────────────────────────────────────────────────

// deliverPRReviewThread is the production fan-out: re-resolve the target from a
// FRESH session fetch, re-check the busy predicate, render, inject, and — only
// on a VERIFIED submit — post the 👀 marker.
//
// The ordering is load-bearing. internal/inject distinguishes a verified submit
// from ProbeFailure / SubmitUnverified (its taxonomy splits on the Enter
// boundary), and marking before delivery would strand a comment silently: the
// thread would read as claimed while nothing had been said to any agent.
func (s *Server) deliverPRReviewThread(ctx context.Context, entry prListenEntry) error {
	window, ok, err := s.resolvePRListenTarget(ctx, entry)
	if err != nil {
		return fmt.Errorf("%w: %v", errPRListenAbsent, err)
	}
	if !ok {
		return errPRListenAbsent
	}
	// Fresh read, not the tick's snapshot: the rolled-up state the reservation
	// saw is up to one tick old.
	if agentBusy(window.AgentState) {
		return errPRListenBusy
	}
	paneID, found, err := s.resolveWindowAgentPane(ctx, entry.server, entry.windowID)
	if err != nil {
		return fmt.Errorf("%w: %v", errPRListenAbsent, err)
	}
	if !found {
		return errPRListenAbsent
	}

	fetcher := s.reviewFetcher()
	review, err := fetcher.Get(ctx, entry.prURL, false)
	if err != nil {
		if errors.Is(err, prreview.ErrUnavailable) {
			return errPRListenUnavailable
		}
		return err
	}
	thread := findReviewThread(review, entry.threadID)
	if thread == nil {
		// The thread was resolved or deleted between the digest and now:
		// nothing to do, and nothing to mark.
		return nil
	}
	// Re-check the state gates against the DETAIL document — the digest can lag
	// a resolve by up to one collector tick, and an outdated thread must never
	// dispatch (the agent would be handed a line number that no longer names
	// the code the comment is about).
	if thread.IsResolved || thread.IsOutdated || thread.SuggestionOnly() {
		return nil
	}
	first := thread.FirstComment()
	if first == nil {
		return nil
	}

	payload := renderPRReviewThread(prReviewThreadFacts{
		PRNumber:  review.Number,
		PRURL:     review.URL,
		Repo:      review.Repo,
		Path:      thread.Path,
		Side:      thread.Side,
		Line:      thread.Line,
		Hunk:      review.HunkAround(thread.Path, thread.Side, thread.Line),
		Comments:  thread.Comments,
		ThreadURL: first.URL,
	})
	if err := s.injectIntoPane(ctx, entry.server, paneID, payload, true); err != nil {
		return err
	}
	// Verified submit — only now is the thread claimed.
	return fetcher.MarkEyes(ctx, review, first.DatabaseID)
}

func findReviewThread(review *prreview.Review, threadID string) *prreview.Thread {
	for i := range review.Threads {
		if review.Threads[i].ID == threadID {
			return &review.Threads[i]
		}
	}
	return nil
}

func (s *Server) resolvePRListenTarget(ctx context.Context, entry prListenEntry) (*tmux.WindowInfo, bool, error) {
	snapshot, err := s.sessions.FetchSessions(ctx, entry.server)
	if err != nil {
		return nil, false, err
	}
	for si := range snapshot {
		for wi := range snapshot[si].Windows {
			window := &snapshot[si].Windows[wi]
			if window.WindowID == entry.windowID {
				return window, true, nil
			}
		}
	}
	return nil, false, nil
}

// disarmPRReviewListener clears a window's arm option — the circuit breaker's
// effect. Best-effort: a failure leaves the option set, and the next failing
// delivery trips the breaker again.
func (s *Server) disarmPRReviewListener(server, windowID string) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := s.tmux.UnsetWindowOption(ctx, windowID, server, tmux.PrListenOption); err != nil {
		slog.Debug("pr review listener disarm failed", "err", err, "server", server, "window", windowID)
	}
}

// prReviewUnhandled is the tracker's digest seam: the eligible threads for a PR,
// straight from the collector that already polls them. A nil collector (a
// partially-wired server) yields nothing eligible rather than an error.
func (s *Server) prReviewUnhandled(prURL string) []prstatus.ReviewThread {
	if s.prStatus == nil {
		return nil
	}
	return s.prStatus.UnhandledThreads(prURL)
}
