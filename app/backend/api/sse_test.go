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

func TestSSEHubDeduplication(t *testing.T) {
	sf := &slowSessionFetcher{
		result: []sessions.ProjectSession{
			{Name: "static", Windows: []tmux.WindowInfo{}},
		},
	}

	hub := newSSEHub(sf, nil)
	client := &sseClient{ch: make(chan []byte, 16), server: "default"}

	hub.addClient(client)
	defer hub.removeClient(client)

	// Wait for initial snapshot delivery
	select {
	case <-client.ch:
		// Got initial snapshot (may be empty or from first poll)
	case <-time.After(4 * time.Second):
		// First poll may take up to ssePollInterval
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
	time.Sleep(ssePollInterval + 500*time.Millisecond)

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

	hub := newSSEHub(sf, nil)
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
	time.Sleep(ssePollInterval + 500*time.Millisecond)

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
	hub := newSSEHub(sf, nil)

	// Use a buffer of 1 so it fills immediately
	client := &sseClient{ch: make(chan []byte, 1), server: "default"}
	hub.addClient(client)
	defer hub.removeClient(client)

	// Wait for at least two poll cycles to fill the tiny buffer and trigger drops
	time.Sleep(ssePollInterval*3 + 500*time.Millisecond)

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
	time.Sleep(ssePollInterval + 500*time.Millisecond)

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

	hub := newSSEHub(sf, nil)
	rkClient := &sseClient{ch: make(chan []byte, 16), server: "runkit"}
	dfClient := &sseClient{ch: make(chan []byte, 16), server: "default"}

	hub.addClient(rkClient)
	hub.addClient(dfClient)
	defer hub.removeClient(rkClient)
	defer hub.removeClient(dfClient)

	// Wait for at least one poll cycle
	time.Sleep(ssePollInterval + 500*time.Millisecond)

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

	// Verify isolation: runkit client only sees rk-session, default only sees default-session
	for _, ev := range rkEvents {
		if strings.Contains(ev, "default-session") {
			t.Errorf("runkit client received default server data: %s", ev)
		}
		if !strings.Contains(ev, "rk-session") {
			t.Errorf("runkit client event missing rk-session: %s", ev)
		}
	}
	for _, ev := range dfEvents {
		if strings.Contains(ev, "rk-session") {
			t.Errorf("default client received runkit server data: %s", ev)
		}
		if !strings.Contains(ev, "default-session") {
			t.Errorf("default client event missing default-session: %s", ev)
		}
	}
}

func TestSSEHubRemoveClientSwapDelete(t *testing.T) {
	sf := &slowSessionFetcher{result: []sessions.ProjectSession{}}
	hub := newSSEHub(sf, nil)

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
	hub := newSSEHub(sf, nil)

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

	hub := newSSEHub(sf, nil)

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
	time.Sleep(ssePollInterval + 500*time.Millisecond)

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
