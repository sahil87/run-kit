package api

import (
	"log/slog"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"rk/internal/prstatus"
	"rk/internal/sessions"
	"rk/internal/tmux"
)

// TestSSE_RacePollVsHandlerCacheAccess is the race-detector regression test for
// the sseHub cache synchronization: the poll goroutine's h.cache map operations
// (event-driven invalidate, TTL read, post-fetch write) and the attachPRStatus
// in-place mutation of the cached session slice run concurrently with
// handler-side readers of the same map and slice (setPreviewScope →
// sendCachedPreviewLocked, under h.mu). Under `go test -race` this fails on the
// pre-fix code (poll-side accesses were unsynchronized) and passes once every
// h.cache access is under h.mu.
func TestSSE_RacePollVsHandlerCacheAccess(t *testing.T) {
	tracker := &fetchTracker{
		result: map[string][]sessions.ProjectSession{
			"kits": {{
				Name: "s1",
				Windows: []tmux.WindowInfo{
					{Index: 0, Name: "w0", WindowID: "@1", IsActiveWindow: true, PrURL: strp("u1")},
				},
			}},
		},
	}
	hub := newSSEHub(tracker, nil, nil, stubSnapshotter{snap: map[string]prstatus.PRStatus{
		"u1": {Number: 1, URL: "u1", State: "open", Checks: "pass"},
	}})
	// Fast ticks so cache writes (TTL expiry) and cache-hit attachPRStatus
	// re-runs interleave densely with the handler traffic below.
	hub.safetyInterval = 20 * time.Millisecond
	// No real tmux execs: the expanded-session union would otherwise drive
	// capturePreviewForWindow subprocesses for a nonexistent server. The stub
	// returns text so previousPreviewJSON is non-empty — sendCachedPreviewLocked
	// returns early on an empty preview cache and would never reach the h.cache
	// read this test exists to race.
	hub.captureFn = func(tmux.WindowInfo, string) (string, bool) { return "preview", true }

	client := &sseClient{ch: make(chan hubEvent, 512), server: "kits", connID: "c1", expanded: map[string]bool{"s1": true}}
	hub.addClient(client)
	t.Cleanup(func() { hub.removeClient(client) })

	stop := make(chan struct{})
	var wg sync.WaitGroup

	// Handler-side traffic: preview-scope declarations re-read h.cache and the
	// cached session slice under h.mu.
	for range 4 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for {
				select {
				case <-stop:
					return
				default:
					hub.setPreviewScope("kits", "c1", []string{"s1"})
				}
			}
		}()
	}

	// Wake traffic: each consumed wake marks the server event-driven, forcing
	// the next pass's cache invalidate + re-fetch + write-back.
	wg.Add(1)
	go func() {
		defer wg.Done()
		for {
			select {
			case <-stop:
				return
			case <-time.After(5 * time.Millisecond):
				hub.wake("kits")
			}
		}
	}()

	// Drain so the client channel never fills (a full channel would wedge the
	// loop and shrink the interleaving window).
	wg.Add(1)
	go func() {
		defer wg.Done()
		for {
			select {
			case <-stop:
				return
			case <-client.ch:
			}
		}
	}()

	time.Sleep(800 * time.Millisecond)
	close(stop)
	wg.Wait()
}

// TestSSE_RaceSetWindowChangeSubscriberVsPollLoop is the race-detector
// regression test for the subscriber field guard: wiring (and re-wiring) the
// WindowChangeSubscriber from another goroutine while the poll loop runs must
// not race the loop's per-wait subscriber reads, and the loop must pick the
// subscriber up on a subsequent iteration. Under `go test -race` this fails on
// the pre-fix code (a plain field write racing plain poll-path reads).
func TestSSE_RaceSetWindowChangeSubscriberVsPollLoop(t *testing.T) {
	tracker := &fetchTracker{
		result: map[string][]sessions.ProjectSession{
			"kits": {{Name: "s1"}},
		},
	}
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))
	server := &Server{logger: logger, sessions: tracker, hostname: "test"}
	server.initSSEHub()
	hub := server.sseHub
	hub.safetyInterval = 20 * time.Millisecond

	client := &sseClient{ch: make(chan hubEvent, 256), server: "kits"}
	hub.addClient(client)
	t.Cleanup(func() { hub.removeClient(client) })

	stop := make(chan struct{})
	var wg sync.WaitGroup

	// The serve-time seam, racing the running loop (an early client connect
	// materialises and starts the hub before rk serve wires the Supervisor).
	sub := newStubSubscriber()
	wg.Add(1)
	go func() {
		defer wg.Done()
		for {
			select {
			case <-stop:
				return
			default:
				server.SetWindowChangeSubscriber(sub)
				server.SetWindowChangeSubscriber(nil)
			}
		}
	}()

	// Drain so the client channel never fills.
	wg.Add(1)
	go func() {
		defer wg.Done()
		for {
			select {
			case <-stop:
				return
			case <-client.ch:
			}
		}
	}()

	time.Sleep(500 * time.Millisecond)
	close(stop)
	wg.Wait()

	// Final wiring: the loop picks the subscriber up on a subsequent iteration
	// and stays healthy (fetches keep flowing).
	server.SetWindowChangeSubscriber(sub)
	tracker.mu.Lock()
	tracker.result["kits"] = []sessions.ProjectSession{{Name: "s1"}, {Name: "s2"}}
	tracker.mu.Unlock()
	sub.Bump("kits")

	deadline := time.After(2 * time.Second)
	for {
		select {
		case b := <-client.ch:
			if got := b.String(); b.typ == "sessions" && strings.Contains(got, "s2") {
				return
			}
		case <-deadline:
			t.Fatal("loop did not deliver a snapshot after SetWindowChangeSubscriber + bump")
		}
	}
}
