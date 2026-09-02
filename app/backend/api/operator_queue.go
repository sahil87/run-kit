package api

import (
	"context"
	"crypto/sha256"
	"errors"
	"log/slog"
	"sync"
	"time"

	"rk/internal/sessions"
	"rk/internal/tmux"
)

const (
	operatorQueueCap    = 8
	operatorQueueTTL    = 30 * time.Minute
	operatorQueueMinGap = 60 * time.Second
)

var errOperatorQueueFull = errors.New("operator queue is full")
var errOperatorQueueFetch = errors.New("operator queue session fetch failed")

type queuedOperatorRequest struct {
	template   string
	windowID   string
	text       string
	session    string
	enqueuedAt time.Time
}

type operatorQueueKey struct {
	template string
	scope    string
	textHash [sha256.Size]byte
}

func (r queuedOperatorRequest) key() operatorQueueKey {
	scope := "session:" + r.session
	if r.windowID != "" {
		scope = "window:" + r.windowID
	}
	return operatorQueueKey{
		template: r.template,
		scope:    scope,
		textHash: sha256.Sum256([]byte(r.text)),
	}
}

type operatorQueueDeliver func(
	ctx context.Context,
	server string,
	request queuedOperatorRequest,
) error

// operatorQueueTracker owns pending user requests until an idle observation
// can hand one to the operator. State is process-memory only.
type operatorQueueTracker struct {
	mu       sync.Mutex
	queues   map[string][]queuedOperatorRequest
	inFlight map[string]*queuedOperatorRequest
	lastSent map[string]time.Time
	now      func() time.Time
	deliver  operatorQueueDeliver
}

func newOperatorQueueTracker() *operatorQueueTracker {
	return &operatorQueueTracker{
		queues:   make(map[string][]queuedOperatorRequest),
		inFlight: make(map[string]*queuedOperatorRequest),
		lastSent: make(map[string]time.Time),
		now:      time.Now,
	}
}

// enqueue coalesces repeated requests without refreshing their age. An
// in-flight request still counts toward the per-server bound and dedup set so
// a busy race cannot briefly admit a ninth pending intent.
func (t *operatorQueueTracker) enqueue(server string, request queuedOperatorRequest) error {
	request.enqueuedAt = t.now()
	key := request.key()

	t.mu.Lock()
	defer t.mu.Unlock()
	if current := t.inFlight[server]; current != nil && current.key() == key {
		return nil
	}
	for _, queued := range t.queues[server] {
		if queued.key() == key {
			return nil
		}
	}
	pending := len(t.queues[server])
	if t.inFlight[server] != nil {
		pending++
	}
	if pending >= operatorQueueCap {
		return errOperatorQueueFull
	}
	t.queues[server] = append(t.queues[server], request)
	return nil
}

// advance evaluates the level-triggered drain condition from one already-
// fetched server snapshot. It removes expired entries regardless of operator
// state, then reserves at most one FIFO entry for detached delivery.
func (t *operatorQueueTracker) advance(server string, snapshot []sessions.ProjectSession) {
	now := t.now()
	operator := findOperatorWindow(snapshot)

	t.mu.Lock()
	expired := t.expireLocked(server, now)
	var request *queuedOperatorRequest
	if t.inFlight[server] == nil && operator != nil && operator.AgentState == tmux.AgentStateIdle && len(t.queues[server]) > 0 {
		last, sent := t.lastSent[server]
		if !sent || now.Sub(last) >= operatorQueueMinGap {
			entry := t.queues[server][0]
			t.queues[server] = t.queues[server][1:]
			if len(t.queues[server]) == 0 {
				delete(t.queues, server)
			}
			request = &entry
			t.inFlight[server] = request
			t.lastSent[server] = now
		}
	}
	t.mu.Unlock()

	for _, entry := range expired {
		slog.Debug("operator queue request expired", "server", server, "template", entry.template, "window", entry.windowID, "session", entry.session)
	}
	if request != nil {
		if t.deliver == nil {
			t.finishDelivery(server, request, nil)
		} else {
			go func(entry *queuedOperatorRequest) {
				err := t.deliver(context.Background(), server, *entry)
				t.finishDelivery(server, entry, err)
			}(request)
		}
	}
}

func (t *operatorQueueTracker) expireLocked(server string, now time.Time) []queuedOperatorRequest {
	queue := t.queues[server]
	if len(queue) == 0 {
		return nil
	}
	kept := queue[:0]
	var expired []queuedOperatorRequest
	for _, entry := range queue {
		if now.Sub(entry.enqueuedAt) > operatorQueueTTL {
			expired = append(expired, entry)
			continue
		}
		kept = append(kept, entry)
	}
	if len(kept) == 0 {
		delete(t.queues, server)
	} else {
		t.queues[server] = kept
	}
	return expired
}

// finishDelivery retries only failures known to happen before injection: a
// fresh-fetch failure or a busy rejection. Every other result consumes the
// entry. Pointer identity prevents a late completion from resurrecting state
// that retain already reaped for a dead server.
func (t *operatorQueueTracker) finishDelivery(server string, request *queuedOperatorRequest, err error) {
	if isBusyOperatorReject(err) || errors.Is(err, errOperatorQueueFetch) {
		slog.Debug("operator queue delivery deferred", "err", err, "server", server, "template", request.template, "window", request.windowID, "session", request.session)
		t.requeueFront(server, request)
		return
	}
	if err != nil {
		slog.Debug("operator queue delivery dropped", "err", err, "server", server, "template", request.template, "window", request.windowID, "session", request.session)
	}
	t.mu.Lock()
	if t.inFlight[server] != request {
		t.mu.Unlock()
		return
	}
	delete(t.inFlight, server)
	t.mu.Unlock()
}

// retain reaps state only for servers whose tick was successfully observed or
// whose socket was confirmed gone. Transient fetch failures preserve queues.
func (t *operatorQueueTracker) retain(live, observed map[string]bool) {
	t.mu.Lock()
	defer t.mu.Unlock()
	servers := make(map[string]bool, len(t.queues)+len(t.lastSent)+len(t.inFlight))
	for server := range t.queues {
		servers[server] = true
	}
	for server := range t.lastSent {
		servers[server] = true
	}
	for server := range t.inFlight {
		servers[server] = true
	}
	for server := range servers {
		if observed[server] && !live[server] {
			delete(t.queues, server)
			delete(t.inFlight, server)
			delete(t.lastSent, server)
		}
	}
}

func (t *operatorQueueTracker) requeueFront(server string, request *queuedOperatorRequest) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.inFlight[server] != request {
		return
	}
	delete(t.inFlight, server)
	key := request.key()
	queue := t.queues[server]
	filtered := queue[:0]
	for _, entry := range queue {
		if entry.key() != key {
			filtered = append(filtered, entry)
		}
	}
	t.queues[server] = append([]queuedOperatorRequest{*request}, filtered...)
}
