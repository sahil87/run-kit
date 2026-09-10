package api

import (
	"context"
	"strings"
	"sync"
	"testing"
	"time"

	"rk/internal/gui"
	"rk/internal/settings"
)

// guiProbeStub is a scripted gui.Probe stand-in counting its invocations.
type guiProbeStub struct {
	mu    sync.Mutex
	calls int
	info  gui.Info
	err   error
}

func (s *guiProbeStub) probe(ctx context.Context, network, addr string) (gui.Info, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.calls++
	return s.info, s.err
}

func (s *guiProbeStub) set(info gui.Info, err error) {
	s.mu.Lock()
	s.info, s.err = info, err
	s.mu.Unlock()
}

func (s *guiProbeStub) count() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.calls
}

// stubGuiSeams installs the session-option reader and prober on ONE hub
// (per-hub seams — a stub never leaks into another test's poll loop).
func stubGuiSeams(hub *sseHub, display, backend string, ok bool, prober func(ctx context.Context, network, addr string) (gui.Info, error)) {
	hub.guiSessionOptionsFn = func(ctx context.Context) (string, string, string, bool) {
		return display, backend, "", ok
	}
	hub.guiProbeFn = prober
}

// enableGuiSettings persists gui.enabled=true into the isolated HOME.
func enableGuiSettings(t *testing.T) {
	t.Helper()
	isolateSettings(t)
	st := settings.Load()
	st.GUIEnabled = true
	if err := settings.Save(st); err != nil {
		t.Fatalf("save settings: %v", err)
	}
}

func newGuiTestHub() *sseHub {
	return newSSEHub(&slowSessionFetcher{}, nil, nil, nil)
}

func (h *sseHub) cachedGui(t *testing.T) string {
	t.Helper()
	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.cachedGuiJSON
}

func TestGuiTickDisabledPayloadShape(t *testing.T) {
	isolateSettings(t) // fresh HOME ⇒ gui.enabled false by default
	hub := newGuiTestHub()
	hub.guiTick()
	want := `[{"id":"host","enabled":false,"backend":"","reachable":false,"display":"","width":0,"height":0,"viewers":0,"wm":""}]`
	if got := hub.cachedGui(t); got != want {
		t.Fatalf("disabled payload = %s, want %s", got, want)
	}
}

func TestGuiTickPayloadCarriesWM(t *testing.T) {
	enableGuiSettings(t)
	stub := &guiProbeStub{info: gui.Info{Reachable: true, Width: 1920, Height: 1080}}
	hub := newGuiTestHub()
	hub.guiSessionOptionsFn = func(ctx context.Context) (string, string, string, bool) {
		return ":10", "Xtigervnc", "icewm-session", true
	}
	hub.guiProbeFn = stub.probe

	hub.guiTick()
	if got := hub.cachedGui(t); !strings.Contains(got, `"wm":"icewm-session"`) {
		t.Fatalf("payload = %s, want \"wm\":\"icewm-session\" from the stamp", got)
	}
}

func TestGuiTickProbeTTL(t *testing.T) {
	enableGuiSettings(t)
	stub := &guiProbeStub{info: gui.Info{Reachable: true, Width: 1920, Height: 1080}}
	hub := newGuiTestHub()
	stubGuiSeams(hub, ":10", "Xtigervnc", true, stub.probe)

	// Shrink the TTL (the per-hub override field) so the window is provably
	// wider than the tick loop even under full-suite scheduling load: 20
	// ticks at ~10ms sit well inside one 400ms window and must yield exactly
	// one probe.
	hub.guiProbeTTL = 400 * time.Millisecond

	for i := 0; i < 20; i++ {
		hub.guiTick()
		time.Sleep(10 * time.Millisecond)
	}
	if got := stub.count(); got != 1 {
		t.Fatalf("prober calls = %d, want 1 (one per TTL window)", got)
	}

	// Crossing the window re-probes on the next tick.
	time.Sleep(2 * hub.guiProbeTTL)
	hub.guiTick()
	if got := stub.count(); got != 2 {
		t.Fatalf("prober calls after the TTL = %d, want 2", got)
	}

	cached := hub.cachedGui(t)
	if !strings.Contains(cached, `"reachable":true`) || !strings.Contains(cached, `"width":1920`) ||
		!strings.Contains(cached, `"backend":"Xtigervnc"`) || !strings.Contains(cached, `"display":":10"`) {
		t.Fatalf("payload = %s, want reachable 1920x1080 Xtigervnc :10", cached)
	}
}

func TestGuiTickProbeFlipAfterTTL(t *testing.T) {
	enableGuiSettings(t)
	stub := &guiProbeStub{info: gui.Info{Reachable: true, Width: 1920, Height: 1080}}
	hub := newGuiTestHub()
	stubGuiSeams(hub, ":10", "Xtigervnc", true, stub.probe)

	hub.guiTick()
	if got := hub.cachedGui(t); !strings.Contains(got, `"reachable":true`) {
		t.Fatalf("initial payload = %s, want reachable:true", got)
	}

	// A flip inside the TTL window is still served from the cache.
	stub.set(gui.Info{Reason: "not running"}, nil)
	hub.guiTick()
	if got := hub.cachedGui(t); !strings.Contains(got, `"reachable":true`) {
		t.Fatalf("in-TTL payload = %s, want the cached reachable:true", got)
	}

	// Expire the cache: the first post-TTL tick re-probes and flips.
	hub.mu.Lock()
	hub.guiProbeAt = time.Now().Add(-2 * guiProbeTTL)
	hub.mu.Unlock()
	hub.guiTick()
	if got := hub.cachedGui(t); !strings.Contains(got, `"reachable":false`) {
		t.Fatalf("post-TTL payload = %s, want reachable:false", got)
	}
	if got := stub.count(); got != 2 {
		t.Fatalf("prober calls = %d, want 2", got)
	}
}

func TestGuiLateJoinerReplay(t *testing.T) {
	enableGuiSettings(t)
	stub := &guiProbeStub{info: gui.Info{Reachable: true, Width: 1920, Height: 1080}}
	hub := newGuiTestHub()
	stubGuiSeams(hub, ":10", "Xtigervnc", true, stub.probe)
	hub.guiTick()

	// A connection attaching after the tick is replayed the cached gui event
	// from replayGlobalSlots — before any further tick runs.
	sc := &stateConn{ch: make(chan hubEvent, 16), subs: map[string]*sseClient{}}
	hub.replayGlobalSlots(sc)
	select {
	case ev := <-sc.ch:
		s := ev.String()
		if !strings.HasPrefix(s, "event: gui") || !strings.Contains(s, `"reachable":true`) {
			t.Fatalf("replayed event = %q, want the cached gui event", s)
		}
	case <-time.After(time.Second):
		t.Fatal("late joiner received no cached gui event")
	}
}

func TestGuiTickViewerSkipsProbe(t *testing.T) {
	enableGuiSettings(t)
	stub := &guiProbeStub{info: gui.Info{Reachable: true, Width: 1920, Height: 1080}}
	hub := newGuiTestHub()
	stubGuiSeams(hub, ":10", "Xtigervnc", true, stub.probe)

	hub.guiTick() // baseline probe: 1 call
	hub.guiViewerAdd("host")

	// With a live relay viewer the dial is skipped even past the TTL —
	// reachable follows from the live relay; the last geometry is retained.
	hub.mu.Lock()
	hub.guiProbeAt = time.Now().Add(-2 * guiProbeTTL)
	hub.mu.Unlock()
	hub.guiTick()
	if got := stub.count(); got != 1 {
		t.Fatalf("prober calls = %d with a live viewer, want 1 (dial skipped)", got)
	}
	cached := hub.cachedGui(t)
	if !strings.Contains(cached, `"reachable":true`) || !strings.Contains(cached, `"viewers":1`) ||
		!strings.Contains(cached, `"width":1920`) {
		t.Fatalf("viewer-live payload = %s, want reachable:true, viewers:1, retained geometry", cached)
	}

	// The viewer counter floors at zero.
	hub.guiViewerRemove("host")
	hub.guiViewerRemove("host")
	if got := hub.guiViewerCount("host"); got != 0 {
		t.Fatalf("viewer count = %d, want 0", got)
	}
}

func TestSetGUIEnabledSynchronousBroadcast(t *testing.T) {
	isolateSettings(t) // disabled
	hub := newGuiTestHub()
	sc := &stateConn{ch: make(chan hubEvent, 16), subs: map[string]*sseClient{}}
	hub.mu.Lock()
	hub.stateConns[sc] = true
	hub.mu.Unlock()

	hub.setGUIEnabled(true)

	// The broadcast must already be queued when setGUIEnabled returns — the
	// settings POST flips enabled within one state event, no tick wait.
	select {
	case ev := <-sc.ch:
		s := ev.String()
		if !strings.HasPrefix(s, "event: gui") || !strings.Contains(s, `"enabled":true`) {
			t.Fatalf("broadcast = %q, want event: gui with enabled:true", s)
		}
	default:
		t.Fatal("setGUIEnabled did not broadcast synchronously")
	}
	hub.mu.RLock()
	probeAtZero := hub.guiProbeAt.IsZero()
	hub.mu.RUnlock()
	if !probeAtZero {
		t.Fatal("setGUIEnabled did not zero the probe age")
	}
}

func TestSetGUIEnabledDropsStaleProbeState(t *testing.T) {
	enableGuiSettings(t)
	hub := newGuiTestHub()
	// Seed a previously-reachable probe result, then flip the switch: the
	// flip must not rebroadcast the stale reachable/backend/display until the
	// next tick re-probes.
	hub.mu.Lock()
	hub.guiEnabled = true
	hub.guiInfo = gui.Info{Reachable: true, Width: 1920, Height: 1080}
	hub.guiBackend = "Xtigervnc"
	hub.guiDisplay = ":10"
	hub.guiProbeAt = time.Now()
	hub.mu.Unlock()
	sc := &stateConn{ch: make(chan hubEvent, 16), subs: map[string]*sseClient{}}
	hub.mu.Lock()
	hub.stateConns[sc] = true
	hub.mu.Unlock()

	hub.setGUIEnabled(true)

	select {
	case ev := <-sc.ch:
		s := ev.String()
		for _, stale := range []string{`"reachable":true`, `"backend":"Xtigervnc"`, `"display":":10"`, `"width":1920`} {
			if strings.Contains(s, stale) {
				t.Errorf("broadcast %q carries stale %s after the flip", s, stale)
			}
		}
	default:
		t.Fatal("setGUIEnabled did not broadcast synchronously")
	}
	hub.mu.RLock()
	defer hub.mu.RUnlock()
	if hub.guiInfo != (gui.Info{}) || hub.guiBackend != "" || hub.guiDisplay != "" {
		t.Errorf("stale probe state survived the flip: info=%+v backend=%q display=%q", hub.guiInfo, hub.guiBackend, hub.guiDisplay)
	}
}

func TestGuiTickSessionAbsent(t *testing.T) {
	enableGuiSettings(t)
	stub := &guiProbeStub{info: gui.Info{Reachable: true}}

	// Two shapes of "not running": no rk-gui session at all, and a stamped
	// display that does not parse.
	for name, opts := range map[string][3]any{
		"absent session":     {"", "", false},
		"unparsable display": {"garbage", "Xtigervnc", true},
	} {
		t.Run(name, func(t *testing.T) {
			hub := newGuiTestHub()
			stubGuiSeams(hub, opts[0].(string), opts[1].(string), opts[2].(bool), stub.probe)
			hub.guiTick()
			if got := stub.count(); got != 0 {
				t.Fatalf("prober calls = %d without a usable session, want 0", got)
			}
			hub.mu.RLock()
			reason := hub.guiInfo.Reason
			hub.mu.RUnlock()
			if reason != "session absent" {
				t.Fatalf("reason = %q, want %q", reason, "session absent")
			}
			if got := hub.cachedGui(t); !strings.Contains(got, `"reachable":false`) {
				t.Fatalf("payload = %s, want reachable:false", got)
			}
		})
	}
}
