package api

import (
	"bufio"
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"rk/internal/sessions"
	"rk/internal/tmux"
)

// slowSessionFetcher returns canned data with a small delay.
type slowSessionFetcher struct {
	result []sessions.ProjectSession
}

func (s *slowSessionFetcher) FetchSessions(ctx context.Context, server string) ([]sessions.ProjectSession, error) {
	return s.result, nil
}

func TestSSEInitialSnapshot(t *testing.T) {
	sf := &slowSessionFetcher{
		result: []sessions.ProjectSession{
			{
				Name: "test-session",
				Windows: []tmux.WindowInfo{
					{Index: 0, Name: "main", WorktreePath: "/home/user", Activity: "active", IsActiveWindow: true},
				},
			},
		},
	}

	router := newTestRouter(sf, &mockTmuxOps{})
	server := httptest.NewServer(router)
	defer server.Close()

	// Create a context with timeout to avoid hanging
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, server.URL+"/api/sessions/stream", nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("request error: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Errorf("status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	ct := resp.Header.Get("Content-Type")
	if ct != "text/event-stream" {
		t.Errorf("Content-Type = %q, want %q", ct, "text/event-stream")
	}

	// Read the first SSE event
	scanner := bufio.NewScanner(resp.Body)
	var eventLines []string
	for scanner.Scan() {
		line := scanner.Text()
		eventLines = append(eventLines, line)
		// SSE events end with an empty line
		if line == "" && len(eventLines) > 1 {
			break
		}
	}

	// Verify we got a sessions event
	foundEvent := false
	foundData := false
	for _, line := range eventLines {
		if strings.HasPrefix(line, "event: sessions") {
			foundEvent = true
		}
		if strings.HasPrefix(line, "data: ") {
			foundData = true
			if !strings.Contains(line, "test-session") {
				t.Errorf("data does not contain session name: %s", line)
			}
		}
	}
	if !foundEvent {
		t.Error("did not receive 'event: sessions' line")
	}
	if !foundData {
		t.Error("did not receive 'data:' line")
	}
}

// goneSessionFetcher returns a tmux.IsServerGone-matching error so the poll
// loop reaps the server. result is returned for any server not in goneServers.
type goneSessionFetcher struct {
	mu          sync.Mutex
	goneServers map[string]bool
	result      []sessions.ProjectSession
}

func (f *goneSessionFetcher) FetchSessions(ctx context.Context, server string) ([]sessions.ProjectSession, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.goneServers[server] {
		return nil, fmt.Errorf("exit status 1: error connecting to /tmp/tmux-1001/%s (No such file or directory)", server)
	}
	return f.result, nil
}

func TestSSEHubReapsDeadServer(t *testing.T) {
	sf := &goneSessionFetcher{goneServers: map[string]bool{"dead": true}}
	hub := newSSEHub(sf, nil, nil)
	// Short safety interval so the poll loop cycles quickly for the test.
	hub.safetyInterval = 50 * time.Millisecond

	client := &sseClient{ch: make(chan []byte, 8), server: "dead"}
	hub.addClient(client) // starts the poll goroutine

	// The poll loop's first tick fetches "dead", gets an IsServerGone error,
	// reaps it, and emits server-gone to the registered client.
	gotGone := false
	deadline := time.After(2 * time.Second)
	for !gotGone {
		select {
		case ev := <-client.ch:
			if strings.HasPrefix(string(ev), "event: server-gone") {
				gotGone = true
			}
		case <-deadline:
			t.Fatal("client did not receive server-gone event")
		}
	}

	// After reaping its last client, the server must be gone from h.clients
	// and the poll goroutine must stop (it observes zero clients).
	stoppedPolling := false
	for i := 0; i < 40; i++ {
		hub.mu.RLock()
		_, present := hub.clients["dead"]
		polling := hub.polling
		hub.mu.RUnlock()
		if !present && !polling {
			stoppedPolling = true
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	if !stoppedPolling {
		hub.mu.RLock()
		_, present := hub.clients["dead"]
		polling := hub.polling
		hub.mu.RUnlock()
		t.Fatalf("server not reaped / poll not stopped: present=%v polling=%v", present, polling)
	}

	// All per-server maps must be cleared for the reaped server.
	hub.mu.RLock()
	defer hub.mu.RUnlock()
	if _, ok := hub.cache["dead"]; ok {
		t.Error("cache not cleared for reaped server")
	}
	if _, ok := hub.previousJSON["dead"]; ok {
		t.Error("previousJSON not cleared for reaped server")
	}
	if _, ok := hub.previousRealSessions["dead"]; ok {
		t.Error("previousRealSessions not cleared for reaped server")
	}
	if _, ok := hub.orderBootstrapAttempts["dead"]; ok {
		t.Error("orderBootstrapAttempts not cleared for reaped server")
	}
	if _, ok := hub.previousOrderJSON["dead"]; ok {
		t.Error("previousOrderJSON not cleared for reaped server")
	}
}

func TestSSEHubDeduplication(t *testing.T) {
	sf := &slowSessionFetcher{
		result: []sessions.ProjectSession{
			{Name: "static", Windows: []tmux.WindowInfo{}},
		},
	}

	hub := newSSEHub(sf, nil, nil)
	client := &sseClient{ch: make(chan []byte, 16), server: "default"}

	hub.addClient(client)
	defer hub.removeClient(client)

	// Wait for initial snapshot delivery
	select {
	case <-client.ch:
		// Got initial snapshot (may be empty or from first poll)
	case <-time.After(4 * time.Second):
		// First poll may take up to legacyPollInterval
	}

	// Drain any pending events from the first poll cycle
	time.Sleep(100 * time.Millisecond)
drainLoop:
	for {
		select {
		case <-client.ch:
		default:
			break drainLoop
		}
	}

	// Wait for another poll cycle — since data hasn't changed, no event should be sent
	time.Sleep(legacyPollInterval + 500*time.Millisecond)

	select {
	case <-client.ch:
		t.Error("received duplicate event when data didn't change")
	default:
		// Expected: no event
	}
}

func TestSSEHubStopsPollingWhenNoClients(t *testing.T) {
	sf := &slowSessionFetcher{
		result: []sessions.ProjectSession{},
	}

	hub := newSSEHub(sf, nil, nil)
	client := &sseClient{ch: make(chan []byte, 8), server: "default"}

	hub.addClient(client)

	// Wait a bit for polling to start
	time.Sleep(100 * time.Millisecond)

	hub.mu.RLock()
	isPolling := hub.polling
	hub.mu.RUnlock()
	if !isPolling {
		t.Error("hub should be polling with a client connected")
	}

	hub.removeClient(client)

	// Wait for poll loop to detect no clients
	time.Sleep(legacyPollInterval + 500*time.Millisecond)

	hub.mu.RLock()
	isPolling = hub.polling
	hub.mu.RUnlock()
	if isPolling {
		t.Error("hub should stop polling when no clients")
	}
}

// countingSessionFetcher returns incrementing data so each poll produces a new event.
type countingSessionFetcher struct {
	mu    sync.Mutex
	count int
}

func (f *countingSessionFetcher) FetchSessions(ctx context.Context, server string) ([]sessions.ProjectSession, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.count++
	return []sessions.ProjectSession{
		{Name: fmt.Sprintf("session-%d", f.count), Windows: []tmux.WindowInfo{}},
	}, nil
}

func TestSSEHubDropLogging(t *testing.T) {
	sf := &countingSessionFetcher{}
	hub := newSSEHub(sf, nil, nil)

	// Use a buffer of 1 so it fills immediately
	client := &sseClient{ch: make(chan []byte, 1), server: "default"}
	hub.addClient(client)
	defer hub.removeClient(client)

	// Wait for at least two poll cycles to fill the tiny buffer and trigger drops
	time.Sleep(legacyPollInterval*3 + 500*time.Millisecond)

	hub.mu.RLock()
	dropped := client.dropped
	hub.mu.RUnlock()

	if !dropped {
		t.Error("expected client.dropped to be true after buffer overflow")
	}

	// Drain the channel to simulate recovery
	for len(client.ch) > 0 {
		<-client.ch
	}

	// Wait for another poll cycle — successful send should reset dropped
	time.Sleep(legacyPollInterval + 500*time.Millisecond)

	hub.mu.RLock()
	dropped = client.dropped
	hub.mu.RUnlock()

	if dropped {
		t.Error("expected client.dropped to be reset to false after successful send")
	}
}

// perServerSessionFetcher returns different data per server so we can verify isolation.
type perServerSessionFetcher struct {
	mu   sync.Mutex
	data map[string][]sessions.ProjectSession
}

func (f *perServerSessionFetcher) FetchSessions(ctx context.Context, server string) ([]sessions.ProjectSession, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.data[server], nil
}

func TestSSEHubMultiServerIsolation(t *testing.T) {
	sf := &perServerSessionFetcher{
		data: map[string][]sessions.ProjectSession{
			"runkit":  {{Name: "rk-session", Windows: []tmux.WindowInfo{}}},
			"default": {{Name: "default-session", Windows: []tmux.WindowInfo{}}},
		},
	}

	hub := newSSEHub(sf, nil, nil)
	rkClient := &sseClient{ch: make(chan []byte, 16), server: "runkit"}
	dfClient := &sseClient{ch: make(chan []byte, 16), server: "default"}

	hub.addClient(rkClient)
	hub.addClient(dfClient)
	defer hub.removeClient(rkClient)
	defer hub.removeClient(dfClient)

	// Wait for at least one poll cycle
	time.Sleep(legacyPollInterval + 500*time.Millisecond)

	// Drain both channels and check content
	var rkEvents, dfEvents []string
	for len(rkClient.ch) > 0 {
		rkEvents = append(rkEvents, string(<-rkClient.ch))
	}
	for len(dfClient.ch) > 0 {
		dfEvents = append(dfEvents, string(<-dfClient.ch))
	}

	if len(rkEvents) == 0 {
		t.Fatal("runkit client received no events")
	}
	if len(dfEvents) == 0 {
		t.Fatal("default client received no events")
	}

	// Verify isolation: runkit client only sees rk-session, default only sees default-session.
	// Scope assertions to "event: sessions" frames; the hub also emits "event: session-order"
	// frames whose payload doesn't carry session names — those are checked separately below.
	rkSessionEvents := filterSSEEvents(rkEvents, "sessions")
	dfSessionEvents := filterSSEEvents(dfEvents, "sessions")
	if len(rkSessionEvents) == 0 {
		t.Fatal("runkit client received no sessions events")
	}
	if len(dfSessionEvents) == 0 {
		t.Fatal("default client received no sessions events")
	}
	for _, ev := range rkSessionEvents {
		if strings.Contains(ev, "default-session") {
			t.Errorf("runkit client received default server data: %s", ev)
		}
		if !strings.Contains(ev, "rk-session") {
			t.Errorf("runkit client event missing rk-session: %s", ev)
		}
	}
	for _, ev := range dfSessionEvents {
		if strings.Contains(ev, "rk-session") {
			t.Errorf("default client received runkit server data: %s", ev)
		}
		if !strings.Contains(ev, "default-session") {
			t.Errorf("default client event missing default-session: %s", ev)
		}
	}

	// Cross-server isolation also holds for session-order events.
	for _, ev := range filterSSEEvents(rkEvents, "session-order") {
		if strings.Contains(ev, `"server":"default"`) {
			t.Errorf("runkit client received default's session-order: %s", ev)
		}
	}
	for _, ev := range filterSSEEvents(dfEvents, "session-order") {
		if strings.Contains(ev, `"server":"runkit"`) {
			t.Errorf("default client received runkit's session-order: %s", ev)
		}
	}
}

// filterSSEEvents returns only the SSE frames whose first line is `event: <name>`.
func filterSSEEvents(events []string, name string) []string {
	var out []string
	prefix := "event: " + name
	for _, ev := range events {
		if strings.HasPrefix(ev, prefix) {
			out = append(out, ev)
		}
	}
	return out
}

func TestSSEHubRemoveClientSwapDelete(t *testing.T) {
	sf := &slowSessionFetcher{result: []sessions.ProjectSession{}}
	hub := newSSEHub(sf, nil, nil)

	c1 := &sseClient{ch: make(chan []byte, 8), server: "runkit"}
	c2 := &sseClient{ch: make(chan []byte, 8), server: "runkit"}
	c3 := &sseClient{ch: make(chan []byte, 8), server: "runkit"}

	hub.addClient(c1)
	hub.addClient(c2)
	hub.addClient(c3)

	hub.mu.RLock()
	if len(hub.clients["runkit"]) != 3 {
		t.Fatalf("expected 3 clients, got %d", len(hub.clients["runkit"]))
	}
	hub.mu.RUnlock()

	// Remove the middle client
	hub.removeClient(c2)

	hub.mu.RLock()
	remaining := hub.clients["runkit"]
	hub.mu.RUnlock()

	if len(remaining) != 2 {
		t.Fatalf("expected 2 clients after remove, got %d", len(remaining))
	}

	// c1 and c3 should still be present (order may differ due to swap-delete)
	found1, found3 := false, false
	for _, c := range remaining {
		if c == c1 {
			found1 = true
		}
		if c == c3 {
			found3 = true
		}
	}
	if !found1 {
		t.Error("c1 should still be in the slice after removing c2")
	}
	if !found3 {
		t.Error("c3 should still be in the slice after removing c2")
	}
}

func TestSSEHubRemoveLastClientDeletesKey(t *testing.T) {
	sf := &slowSessionFetcher{result: []sessions.ProjectSession{}}
	hub := newSSEHub(sf, nil, nil)

	c1 := &sseClient{ch: make(chan []byte, 8), server: "runkit"}
	c2 := &sseClient{ch: make(chan []byte, 8), server: "default"}

	hub.addClient(c1)
	hub.addClient(c2)

	hub.mu.RLock()
	if len(hub.clients) != 2 {
		t.Fatalf("expected 2 server keys, got %d", len(hub.clients))
	}
	hub.mu.RUnlock()

	// Remove the only runkit client
	hub.removeClient(c1)

	hub.mu.RLock()
	_, exists := hub.clients["runkit"]
	defaultLen := len(hub.clients["default"])
	hub.mu.RUnlock()

	if exists {
		t.Error("runkit key should be deleted after removing its last client")
	}
	if defaultLen != 1 {
		t.Errorf("default slice should still have 1 client, got %d", defaultLen)
	}
}

func TestSSEHubConcurrentAddRemove(t *testing.T) {
	sf := &slowSessionFetcher{
		result: []sessions.ProjectSession{
			{Name: "s", Windows: []tmux.WindowInfo{}},
		},
	}

	hub := newSSEHub(sf, nil, nil)

	// Seed one client to start polling
	seed := &sseClient{ch: make(chan []byte, 32), server: "default"}
	hub.addClient(seed)

	var wg sync.WaitGroup
	const n = 20

	// Concurrently add and remove clients while polling is active
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			c := &sseClient{ch: make(chan []byte, 32), server: "default"}
			hub.addClient(c)
			time.Sleep(10 * time.Millisecond)
			hub.removeClient(c)
		}()
	}

	// Also add clients on a different server concurrently
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			c := &sseClient{ch: make(chan []byte, 32), server: "runkit"}
			hub.addClient(c)
			time.Sleep(10 * time.Millisecond)
			hub.removeClient(c)
		}()
	}

	wg.Wait()
	hub.removeClient(seed)

	// Wait for polling to stop
	time.Sleep(legacyPollInterval + 500*time.Millisecond)

	hub.mu.RLock()
	totalClients := 0
	for _, cs := range hub.clients {
		totalClients += len(cs)
	}
	isPolling := hub.polling
	hub.mu.RUnlock()

	if totalClients != 0 {
		t.Errorf("expected 0 clients after all removed, got %d", totalClients)
	}
	if isPolling {
		t.Error("hub should have stopped polling after all clients removed")
	}
}

// stubOrderFetcher returns a canned order per server.
type stubOrderFetcher struct {
	mu     sync.Mutex
	orders map[string][]string
	calls  int
	err    error
}

func (s *stubOrderFetcher) GetSessionOrder(ctx context.Context, server string) ([]string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.calls++
	if s.err != nil {
		return nil, s.err
	}
	return s.orders[server], nil
}

func TestSSE_BroadcastSessionOrderReachesMatchingClients(t *testing.T) {
	hub := newSSEHub(&slowSessionFetcher{}, nil, nil)
	hub.orderFetcher = &stubOrderFetcher{orders: map[string][]string{}}

	cDefault := &sseClient{ch: make(chan []byte, 32), server: "default"}
	cStaging := &sseClient{ch: make(chan []byte, 32), server: "staging"}
	hub.mu.Lock()
	hub.clients["default"] = append(hub.clients["default"], cDefault)
	hub.clients["staging"] = append(hub.clients["staging"], cStaging)
	hub.mu.Unlock()

	hub.broadcastSessionOrder("default", []string{"main", "dev"})

	// The default client must receive a session-order event
	select {
	case ev := <-cDefault.ch:
		if !strings.Contains(string(ev), "event: session-order") {
			t.Errorf("default client got %q, want session-order event", string(ev))
		}
		if !strings.Contains(string(ev), `"order":["main","dev"]`) {
			t.Errorf("default client payload missing order: %s", string(ev))
		}
	case <-time.After(500 * time.Millisecond):
		t.Fatal("default client did not receive event")
	}

	// The staging client must NOT receive anything
	select {
	case ev := <-cStaging.ch:
		t.Errorf("staging client unexpectedly got: %s", string(ev))
	case <-time.After(100 * time.Millisecond):
		// expected — no event
	}
}

func TestSSE_SessionOrderCachedOnConnect(t *testing.T) {
	hub := newSSEHub(&slowSessionFetcher{}, nil, nil)
	hub.orderFetcher = &stubOrderFetcher{orders: map[string][]string{}}

	// Broadcast before any client connects — the payload should be cached.
	hub.broadcastSessionOrder("default", []string{"main", "dev"})

	c := &sseClient{ch: make(chan []byte, 32), server: "default"}
	hub.addClient(c)
	defer hub.removeClient(c)

	// addClient should have queued the cached session-order event in the channel.
	// First event may be sessions snapshot if previousJSON is set, then session-order.
	deadline := time.After(500 * time.Millisecond)
	gotOrder := false
	for !gotOrder {
		select {
		case ev := <-c.ch:
			if strings.Contains(string(ev), "event: session-order") {
				if !strings.Contains(string(ev), `"order":["main","dev"]`) {
					t.Errorf("cached event payload missing order: %s", string(ev))
				}
				gotOrder = true
			}
		case <-deadline:
			t.Fatal("client did not receive cached session-order event on connect")
		}
	}
}

func TestSSE_HubBootstrapReadsOrderOnFirstPoll(t *testing.T) {
	stub := &stubOrderFetcher{orders: map[string][]string{
		"default": {"alpha", "beta"},
	}}
	hub := newSSEHub(&slowSessionFetcher{}, nil, nil)
	hub.orderFetcher = stub

	c := &sseClient{ch: make(chan []byte, 32), server: "default"}
	hub.addClient(c)
	defer hub.removeClient(c)

	// Poll loop should bootstrap the order on first iteration. Wait up to
	// legacyPollInterval + slack for the broadcast to land.
	deadline := time.After(legacyPollInterval + 1*time.Second)
	gotOrder := false
	for !gotOrder {
		select {
		case ev := <-c.ch:
			if strings.Contains(string(ev), "event: session-order") &&
				strings.Contains(string(ev), `"order":["alpha","beta"]`) {
				gotOrder = true
			}
		case <-deadline:
			t.Fatal("client did not receive bootstrapped session-order event")
		}
	}

	stub.mu.Lock()
	calls := stub.calls
	stub.mu.Unlock()
	if calls < 1 {
		t.Errorf("orderFetcher calls = %d, want >= 1", calls)
	}
}

// TestRealSessionNameSet verifies the snapshot→real-session-name extraction
// excludes board pin-sessions and the control anchor (which are not sessions a
// user would notice losing and must not trip the disappearance log) while
// keeping user-facing sessions.
func TestRealSessionNameSet(t *testing.T) {
	in := []sessions.ProjectSession{
		{Name: "shll", Windows: []tmux.WindowInfo{}},
		{Name: "wt", Windows: []tmux.WindowInfo{}},
		{Name: tmux.PinSessionPrefix + "42", Windows: []tmux.WindowInfo{}},
		{Name: tmux.ControlAnchorSessionName, Windows: []tmux.WindowInfo{}},
		{Name: "", Windows: []tmux.WindowInfo{}}, // defensive: empty name ignored
	}
	got := realSessionNameSet(in)
	want := map[string]bool{"shll": true, "wt": true}
	if len(got) != len(want) {
		t.Fatalf("realSessionNameSet size = %d, want %d (got %v)", len(got), len(want), got)
	}
	for name := range want {
		if !got[name] {
			t.Errorf("realSessionNameSet missing real session %q", name)
		}
	}
	if got[tmux.PinSessionPrefix+"42"] {
		t.Error("realSessionNameSet must exclude board pin-sessions")
	}
	if got[tmux.ControlAnchorSessionName] {
		t.Error("realSessionNameSet must exclude the control anchor")
	}
}

// TestDetectDisappearedSessions verifies the pure prev→current diff: only names
// present before and absent now are reported, and a grown/equal set yields none.
func TestDetectDisappearedSessions(t *testing.T) {
	cases := []struct {
		name          string
		prev, current map[string]bool
		want          []string
	}{
		{
			name:    "one disappeared",
			prev:    map[string]bool{"shll": true, "wt": true},
			current: map[string]bool{"wt": true},
			want:    []string{"shll"},
		},
		{
			name:    "none disappeared (stable)",
			prev:    map[string]bool{"shll": true},
			current: map[string]bool{"shll": true},
			want:    nil,
		},
		{
			name:    "session added, none gone",
			prev:    map[string]bool{"shll": true},
			current: map[string]bool{"shll": true, "new": true},
			want:    nil,
		},
		{
			name:    "all gone (server emptied)",
			prev:    map[string]bool{"shll": true, "wt": true},
			current: map[string]bool{},
			want:    []string{"shll", "wt"},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := detectDisappearedSessions(tc.prev, tc.current)
			gotSet := map[string]bool{}
			for _, g := range got {
				gotSet[g] = true
			}
			if len(got) != len(tc.want) {
				t.Fatalf("detectDisappearedSessions = %v, want %v", got, tc.want)
			}
			for _, w := range tc.want {
				if !gotSet[w] {
					t.Errorf("detectDisappearedSessions missing %q (got %v)", w, got)
				}
			}
		})
	}
}
