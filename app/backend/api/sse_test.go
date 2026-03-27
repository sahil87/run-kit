package api

import (
	"bufio"
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
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

	hub := newSSEHub(sf)
	client := &sseClient{ch: make(chan []byte, 16)}

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

	hub := newSSEHub(sf)
	client := &sseClient{ch: make(chan []byte, 8)}

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
