package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"rk/internal/metrics"
	"rk/internal/sessions"
	"rk/internal/tmux"
	"rk/internal/updatecheck"
)

// String renders a hubEvent as an SSE-style frame. Used ONLY by tests that
// assert on the legacy frame shape; production rendering is renderEnvelope. For
// a gone marker it mirrors the retired `event: server-gone\ndata: {}` frame.
// Defined here (a _test.go file, same package) so this test-only helper — and
// its `fmt` dependency — never ship in the production binary.
func (e hubEvent) String() string {
	if e.raw != nil {
		return string(e.raw)
	}
	if e.gone {
		return "event: server-gone\ndata: {}\n\n"
	}
	return fmt.Sprintf("event: %s\ndata: %s\n\n", e.typ, e.data)
}

// newTestStateConn registers a bare stateConn for hub-level protocol tests (no
// real WebSocket). It mirrors what handleStateWS builds after hello.
func newTestStateConn(h *sseHub, connID string, buf int) *stateConn {
	return &stateConn{ch: make(chan hubEvent, buf), connID: connID, subs: map[string]*sseClient{}}
}

// drainFrames renders every buffered frame on a connection channel to its
// envelope-decoded form for assertion.
func drainFrames(ch chan hubEvent) [][]byte {
	var out [][]byte
	for len(ch) > 0 {
		out = append(out, (<-ch).renderEnvelope())
	}
	return out
}

// decodeEnvelopes parses each frame into a generic map for op/type/kind checks.
func decodeEnvelopes(frames [][]byte) []map[string]json.RawMessage {
	out := make([]map[string]json.RawMessage, 0, len(frames))
	for _, f := range frames {
		var m map[string]json.RawMessage
		if json.Unmarshal(f, &m) == nil {
			out = append(out, m)
		}
	}
	return out
}

func rawStr(m map[string]json.RawMessage, key string) string {
	var s string
	_ = json.Unmarshal(m[key], &s)
	return s
}

// TestStateWS_SubscribeServerAcksWithSnapshot verifies the subscribe → ack path
// carries the current sessions snapshot BYTE-IDENTICAL to what the SSE
// `event: sessions` frame carried (the previousJSON payload).
func TestStateWS_SubscribeServerAcksWithSnapshot(t *testing.T) {
	sf := &slowSessionFetcher{result: []sessions.ProjectSession{
		{Name: "s1", Windows: []tmux.WindowInfo{{Index: 0, Name: "w0", IsActiveWindow: true}}},
	}}
	hub := newSSEHub(sf, nil, nil, nil)
	// Seed the per-server sessions cache the way a poll tick would.
	want, _ := json.Marshal(sf.result)
	hub.mu.Lock()
	hub.previousJSON["default"] = string(want)
	hub.mu.Unlock()

	sc := newTestStateConn(hub, "conn-1", 16)
	hub.stateSubscribe(sc, clientMsg{Op: opSubscribe, Kind: kindServer, Key: "default", Req: 7})
	t.Cleanup(func() { hub.dropStateConn(sc) })

	// The ack frame must be present with req 7 and the byte-identical snapshot.
	var ack map[string]json.RawMessage
	deadline := time.After(time.Second)
	for ack == nil {
		select {
		case ev := <-sc.ch:
			var m map[string]json.RawMessage
			if json.Unmarshal(ev.renderEnvelope(), &m) == nil && rawStr(m, "op") == "ack" {
				ack = m
			}
		case <-deadline:
			t.Fatal("no ack frame received")
		}
	}
	var req int64
	_ = json.Unmarshal(ack["req"], &req)
	if req != 7 {
		t.Errorf("ack req = %d, want 7", req)
	}
	if string(ack["snapshot"]) != string(want) {
		t.Errorf("ack snapshot = %s, want byte-identical %s", ack["snapshot"], want)
	}
}

// TestStateWS_ServerEventEnvelopeByteEquality verifies a per-server event's
// `data` inside the envelope is byte-identical to the SSE payload, and the
// envelope carries kind=server + key + the verbatim type name.
func TestStateWS_ServerEventEnvelopeByteEquality(t *testing.T) {
	hub := newSSEHub(&slowSessionFetcher{}, nil, nil, nil)
	sc := newTestStateConn(hub, "conn-1", 16)
	hub.stateSubscribe(sc, clientMsg{Op: opSubscribe, Kind: kindServer, Key: "default", Req: 1})
	t.Cleanup(func() { hub.dropStateConn(sc) })
	// Drain the ack.
	drainFrames(sc.ch)

	hub.broadcastSessionOrder("default", []string{"main", "dev"})
	wantData := `{"server":"default","order":["main","dev"]}`

	frames := decodeEnvelopes(drainFrames(sc.ch))
	var found bool
	for _, m := range frames {
		if rawStr(m, "op") == "event" && rawStr(m, "type") == "session-order" {
			found = true
			if rawStr(m, "kind") != kindServer {
				t.Errorf("kind = %q, want %q", rawStr(m, "kind"), kindServer)
			}
			if rawStr(m, "key") != "default" {
				t.Errorf("key = %q, want default", rawStr(m, "key"))
			}
			if string(m["data"]) != wantData {
				t.Errorf("data = %s, want byte-identical %s", m["data"], wantData)
			}
		}
	}
	if !found {
		t.Fatalf("no session-order event frame (frames: %d)", len(frames))
	}
}

// TestStateWS_GlobalEventEnvelope verifies host-global broadcasts reach a
// connection exactly once with kind=global and the verbatim type + byte-equal data.
func TestStateWS_GlobalEventEnvelope(t *testing.T) {
	hub := newSSEHub(&slowSessionFetcher{}, nil, nil, nil)
	sc := newTestStateConn(hub, "conn-1", 16)
	// Subscribe to a server AND metrics on the same connection — a global event
	// must still arrive exactly once (fan-out is per-connection, not per-sub).
	hub.stateSubscribe(sc, clientMsg{Op: opSubscribe, Kind: kindServer, Key: "default", Req: 1})
	hub.stateSubscribe(sc, clientMsg{Op: opSubscribe, Kind: kindMetrics, Req: 2})
	t.Cleanup(func() { hub.dropStateConn(sc) })
	drainFrames(sc.ch)

	hub.broadcastServerOrder([]string{"a", "b"})

	frames := decodeEnvelopes(drainFrames(sc.ch))
	count := 0
	for _, m := range frames {
		if rawStr(m, "op") == "event" && rawStr(m, "type") == "server-order" {
			count++
			if rawStr(m, "kind") != kindGlobal {
				t.Errorf("kind = %q, want %q", rawStr(m, "kind"), kindGlobal)
			}
			if string(m["data"]) != `{"order":["a","b"]}` {
				t.Errorf("data = %s", m["data"])
			}
		}
	}
	if count != 1 {
		t.Errorf("server-order arrived %d times, want exactly 1 (per-connection fan-out)", count)
	}
}

// TestStateWS_HelloReplaysGlobalSlots verifies replayGlobalSlots delivers the
// cached host-global slots once on connect (hello), each byte-identical.
func TestStateWS_HelloReplaysGlobalSlots(t *testing.T) {
	hub := newSSEHub(&slowSessionFetcher{}, nil, nil, nil)
	hub.setVersion("0.5.3", "abc", true)
	hub.broadcastServerOrder([]string{"x"})
	hub.broadcastUpdateAvailable(updatecheck.Result{
		Tools:   []updatecheck.ToolVerdict{{Tool: "run-kit", Installed: "0.5.3", Latest: "0.6.0", UpdateAvailable: true, Notable: true}},
		Matched: []updatecheck.ToolUpdate{{Tool: "run-kit", Installed: "0.5.3", Latest: "0.6.0"}},
		Key:     "run-kit@0.6.0",
		Current: "0.5.3",
		Latest:  "0.6.0",
	})

	sc := newTestStateConn(hub, "conn-1", 32)
	hub.replayGlobalSlots(sc)
	t.Cleanup(func() { hub.dropStateConn(sc) })

	frames := decodeEnvelopes(drainFrames(sc.ch))
	types := map[string]string{}
	for _, m := range frames {
		if rawStr(m, "op") == "event" && rawStr(m, "kind") == kindGlobal {
			types[rawStr(m, "type")] = string(m["data"])
		}
	}
	if !strings.Contains(types["version"], `"version":"0.5.3"`) {
		t.Errorf("version slot missing/incorrect: %q", types["version"])
	}
	if types["server-order"] != `{"order":["x"]}` {
		t.Errorf("server-order slot = %q", types["server-order"])
	}
	if !strings.Contains(types["update-available"], `"key":"run-kit@0.6.0"`) ||
		!strings.Contains(types["update-available"], `"tools":[{"tool":"run-kit","current":"0.5.3","latest":"0.6.0","updateAvailable":true,"notable":true}]`) {
		t.Errorf("update-available slot = %q", types["update-available"])
	}
}

// TestStateWS_GoneFrameOnReap verifies a subscribed server that goes away emits
// a `gone` frame and detaches the subscription so a re-subscribe is clean.
func TestStateWS_GoneFrameOnReap(t *testing.T) {
	sf := &goneSessionFetcher{goneServers: map[string]bool{"dead": true}}
	hub := newSSEHub(sf, nil, nil, nil)
	hub.safetyInterval = 50 * time.Millisecond

	sc := newTestStateConn(hub, "conn-1", 16)
	hub.stateSubscribe(sc, clientMsg{Op: opSubscribe, Kind: kindServer, Key: "dead", Req: 1})
	t.Cleanup(func() { hub.dropStateConn(sc) })

	gotGone := false
	deadline := time.After(2 * time.Second)
	for !gotGone {
		select {
		case ev := <-sc.ch:
			var m map[string]json.RawMessage
			if json.Unmarshal(ev.renderEnvelope(), &m) == nil && rawStr(m, "op") == "gone" {
				if rawStr(m, "key") != "dead" || rawStr(m, "reason") != "server-exited" {
					t.Errorf("gone frame = %v", m)
				}
				gotGone = true
			}
		case <-deadline:
			t.Fatal("no gone frame received")
		}
	}

	// The subscription must be detached from the connection so a re-subscribe is
	// a clean re-registration.
	hub.mu.RLock()
	_, stillSubbed := sc.subs["dead"]
	hub.mu.RUnlock()
	if stillSubbed {
		t.Error("subscription not detached after gone reap")
	}
}

// TestStateWS_UnsubscribeLeavesPollSet verifies unsubscribe drops the routing
// record so the server leaves the poll set when subscriber-less.
func TestStateWS_UnsubscribeLeavesPollSet(t *testing.T) {
	hub := newSSEHub(&slowSessionFetcher{}, nil, nil, nil)
	sc := newTestStateConn(hub, "conn-1", 16)
	hub.stateSubscribe(sc, clientMsg{Op: opSubscribe, Kind: kindServer, Key: "srv", Req: 1})
	t.Cleanup(func() { hub.dropStateConn(sc) })

	hub.mu.RLock()
	_, present := hub.clients["srv"]
	hub.mu.RUnlock()
	if !present {
		t.Fatal("server not in poll set after subscribe")
	}

	hub.stateUnsubscribe(sc, clientMsg{Op: opUnsubscribe, Kind: kindServer, Key: "srv"})
	hub.mu.RLock()
	_, stillPresent := hub.clients["srv"]
	_, stillSubbed := sc.subs["srv"]
	hub.mu.RUnlock()
	if stillPresent {
		t.Error("server still in poll set after unsubscribe")
	}
	if stillSubbed {
		t.Error("subscription record still present after unsubscribe")
	}
}

// TestStateWS_PreviewScopeInBand verifies the in-band preview-scope op sets the
// connection's expanded set (addressed by the connection's own conn id).
func TestStateWS_PreviewScopeInBand(t *testing.T) {
	hub := newSSEHub(&slowSessionFetcher{}, nil, nil, nil)
	sc := newTestStateConn(hub, "conn-xyz", 16)
	hub.stateSubscribe(sc, clientMsg{Op: opSubscribe, Kind: kindServer, Key: "srv", Req: 1})
	t.Cleanup(func() { hub.dropStateConn(sc) })

	hub.setPreviewScope("srv", "conn-xyz", []string{"a", "b"})

	hub.mu.RLock()
	rec := sc.subs["srv"]
	got := len(rec.expanded)
	hub.mu.RUnlock()
	if got != 2 || !rec.expanded["a"] || !rec.expanded["b"] {
		t.Errorf("expanded = %v, want {a,b}", rec.expanded)
	}
}

// TestStateWS_SubscribeRejectsInvalidServerKey verifies a subscribe carrying a
// server name that fails validate.ValidateServerName is rejected with an error
// frame (echoing req) and never enters the poll set or creates a routing record.
// This is the security barrier the retired SSE edge had via serverFromRequest
// (Constitution §I) — an unvalidated key would reach tmux -L <key> subprocesses.
func TestStateWS_SubscribeRejectsInvalidServerKey(t *testing.T) {
	hub := newSSEHub(&slowSessionFetcher{}, nil, nil, nil)
	sc := newTestStateConn(hub, "conn-1", 16)
	t.Cleanup(func() { hub.dropStateConn(sc) })

	// A shell-injection-shaped key: fails the alphanumeric/hyphen/underscore
	// pattern, so it must be rejected before it reaches any hub state.
	bad := "foo; rm -rf /"
	hub.stateSubscribe(sc, clientMsg{Op: opSubscribe, Kind: kindServer, Key: bad, Req: 9})

	frames := decodeEnvelopes(drainFrames(sc.ch))
	if len(frames) != 1 {
		t.Fatalf("expected exactly one error frame, got %d frames: %v", len(frames), frames)
	}
	m := frames[0]
	if rawStr(m, "op") != "error" {
		t.Errorf("op = %q, want error", rawStr(m, "op"))
	}
	var req int64
	_ = json.Unmarshal(m["req"], &req)
	if req != 9 {
		t.Errorf("error req = %d, want 9 (echoes the offending subscribe)", req)
	}

	hub.mu.RLock()
	_, inPollSet := hub.clients[bad]
	_, subbed := sc.subs[bad]
	hub.mu.RUnlock()
	if inPollSet {
		t.Error("invalid key entered the poll set")
	}
	if subbed {
		t.Error("invalid key created a subscription record")
	}
}

// TestStateWS_UnsubscribeRejectsInvalidServerKey verifies an unsubscribe with an
// invalid server name is rejected with an error frame rather than performing a
// map lookup on unvalidated input (barrier kept uniform with subscribe).
func TestStateWS_UnsubscribeRejectsInvalidServerKey(t *testing.T) {
	hub := newSSEHub(&slowSessionFetcher{}, nil, nil, nil)
	sc := newTestStateConn(hub, "conn-1", 16)
	t.Cleanup(func() { hub.dropStateConn(sc) })

	hub.stateUnsubscribe(sc, clientMsg{Op: opUnsubscribe, Kind: kindServer, Key: "../etc", Req: 3})

	frames := decodeEnvelopes(drainFrames(sc.ch))
	if len(frames) != 1 || rawStr(frames[0], "op") != "error" {
		t.Fatalf("expected one error frame, got %v", frames)
	}
	var req int64
	_ = json.Unmarshal(frames[0]["req"], &req)
	if req != 3 {
		t.Errorf("error req = %d, want 3", req)
	}
}

// TestStateWS_SubscribeRejectsUnknownKind verifies an unknown subscribe kind is
// rejected with an error frame (previously a silent drop).
func TestStateWS_SubscribeRejectsUnknownKind(t *testing.T) {
	hub := newSSEHub(&slowSessionFetcher{}, nil, nil, nil)
	sc := newTestStateConn(hub, "conn-1", 16)
	t.Cleanup(func() { hub.dropStateConn(sc) })

	hub.stateSubscribe(sc, clientMsg{Op: opSubscribe, Kind: "bogus", Req: 5})
	frames := decodeEnvelopes(drainFrames(sc.ch))
	if len(frames) != 1 || rawStr(frames[0], "op") != "error" {
		t.Fatalf("expected one error frame for unknown kind, got %v", frames)
	}
}

// TestStateWS_PreviewScopeRejectsInvalidServer drives the real handler over a
// WebSocket and verifies the in-band preview-scope op rejects an invalid server
// key with an error frame (the same barrier as subscribe) instead of indexing
// hub state with unvalidated input.
func TestStateWS_PreviewScopeRejectsInvalidServer(t *testing.T) {
	router := newTestRouter(&slowSessionFetcher{}, &mockTmuxOps{})
	srv := httptest.NewServer(router)
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws/state"
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	conn, _, err := websocket.DefaultDialer.DialContext(ctx, wsURL, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer conn.Close()

	if err := conn.WriteJSON(clientMsg{Op: opHello, Conn: "conn-ps"}); err != nil {
		t.Fatalf("write hello: %v", err)
	}
	if err := conn.WriteJSON(clientMsg{Op: opPreviewScope, Server: "bad name!", Expanded: []string{"s"}}); err != nil {
		t.Fatalf("write preview-scope: %v", err)
	}

	conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	gotError := false
	for !gotError {
		_, raw, err := conn.ReadMessage()
		if err != nil {
			t.Fatalf("read (expected error frame): %v", err)
		}
		var m map[string]json.RawMessage
		if json.Unmarshal(raw, &m) != nil {
			continue
		}
		if rawStr(m, "op") == "error" {
			gotError = true
		}
	}
}

// TestStateWS_MetricsSubscriptionReceivesBroadcast verifies a metrics-kind
// subscription (the ?metrics=1 replacement) receives the server-global metrics
// broadcast with zero attached servers.
func TestStateWS_MetricsSubscriptionReceivesBroadcast(t *testing.T) {
	sf := &slowSessionFetcher{result: []sessions.ProjectSession{}}
	mc := metrics.NewCollector(2500 * time.Millisecond)
	hub := newSSEHub(sf, mc, nil, nil)
	hub.safetyInterval = 50 * time.Millisecond

	sc := newTestStateConn(hub, "conn-1", 32)
	hub.stateSubscribe(sc, clientMsg{Op: opSubscribe, Kind: kindMetrics, Req: 1})
	t.Cleanup(func() { hub.dropStateConn(sc) })

	gotMetrics := false
	deadline := time.After(2 * time.Second)
	for !gotMetrics {
		select {
		case ev := <-sc.ch:
			var m map[string]json.RawMessage
			if json.Unmarshal(ev.renderEnvelope(), &m) == nil &&
				rawStr(m, "op") == "event" && rawStr(m, "type") == "metrics" && rawStr(m, "kind") == kindGlobal {
				gotMetrics = true
			}
		case <-deadline:
			t.Fatal("metrics subscription received no metrics event")
		}
	}
}

// TestStateWS_EndToEndHelloSubscribe drives the real handler over an httptest
// WebSocket: hello → global replay, subscribe → ack with snapshot.
func TestStateWS_EndToEndHelloSubscribe(t *testing.T) {
	sf := &slowSessionFetcher{result: []sessions.ProjectSession{
		{Name: "s1", Windows: []tmux.WindowInfo{{Index: 0, Name: "w0"}}},
	}}
	router := newTestRouter(sf, &mockTmuxOps{})
	srv := httptest.NewServer(router)
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws/state"
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	conn, _, err := websocket.DefaultDialer.DialContext(ctx, wsURL, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer conn.Close()

	if err := conn.WriteJSON(clientMsg{Op: opHello, Conn: "conn-e2e"}); err != nil {
		t.Fatalf("write hello: %v", err)
	}
	if err := conn.WriteJSON(clientMsg{Op: opSubscribe, Kind: kindServer, Key: "default", Req: 42}); err != nil {
		t.Fatalf("write subscribe: %v", err)
	}

	// Read frames until we see the ack for req 42 (global replays may arrive first).
	conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	gotAck := false
	for !gotAck {
		_, raw, err := conn.ReadMessage()
		if err != nil {
			t.Fatalf("read: %v", err)
		}
		var m map[string]json.RawMessage
		if json.Unmarshal(raw, &m) != nil {
			continue
		}
		if rawStr(m, "op") == "ack" {
			var req int64
			_ = json.Unmarshal(m["req"], &req)
			if req == 42 {
				gotAck = true
			}
		}
	}
}

// TestStateWS_FirstFrameMustBeHello verifies a non-hello first frame is
// rejected with an error frame.
func TestStateWS_FirstFrameMustBeHello(t *testing.T) {
	router := newTestRouter(&slowSessionFetcher{}, &mockTmuxOps{})
	srv := httptest.NewServer(router)
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws/state"
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer conn.Close()

	if err := conn.WriteJSON(clientMsg{Op: opSubscribe, Kind: kindServer, Key: "default"}); err != nil {
		t.Fatalf("write: %v", err)
	}
	conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	_, raw, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	var m map[string]json.RawMessage
	if json.Unmarshal(raw, &m) != nil || rawStr(m, "op") != "error" {
		t.Errorf("expected error frame, got %s", raw)
	}
}

// TestStateWS_ConcurrentGlobalBroadcast is a race-detector smoke test: global
// broadcasts and connection churn run concurrently without deadlock/races.
func TestStateWS_ConcurrentGlobalBroadcast(t *testing.T) {
	hub := newSSEHub(&slowSessionFetcher{}, nil, nil, nil)
	var wg sync.WaitGroup
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			sc := newTestStateConn(hub, "c", 8)
			hub.replayGlobalSlots(sc)
			hub.stateSubscribe(sc, clientMsg{Op: opSubscribe, Kind: kindServer, Key: "srv", Req: 1})
			time.Sleep(2 * time.Millisecond)
			hub.dropStateConn(sc)
		}()
	}
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			hub.broadcastServerOrder([]string{"a"})
		}()
	}
	wg.Wait()
}

// TestStateWS_SubscribeAckNotStaleUnderPollInterleave guards the ack-ordering
// invariant fixed in cycle 2: the subscribe ack's snapshot must be ≥ every
// `sessions` frame already enqueued on the connection's channel. The former bug
// read the snapshot under an EARLIER h.mu acquisition than the ack enqueue, so a
// poll tick interleaving in between could enqueue a NEWER sessions event ahead of
// the stale-snapshot ack; the client applies the ack last, then previousJSON
// dedup suppresses re-emission → stale UI on a quiet server.
//
// The test models the poll loop's exact critical section (update previousJSON +
// fan out a `sessions` frame to h.clients[key], under h.mu — sse.go poll loop)
// with a monotonically increasing tick value, racing it against stateSubscribe
// over many iterations. It disables the real poll goroutine (h.polling=true so
// addClient does not spawn it) so the writer goroutine is the sole previousJSON
// mutator, keeping the tick sequence monotonic. For each iteration it scans the
// channel and asserts the ack's snapshot tick is not older than any sessions
// frame that precedes the ack.
func TestStateWS_SubscribeAckNotStaleUnderPollInterleave(t *testing.T) {
	tickJSON := func(n int) string {
		b, _ := json.Marshal(struct {
			Tick int `json:"tick"`
		}{Tick: n})
		return string(b)
	}
	tickOf := func(raw json.RawMessage) (int, bool) {
		var d struct {
			Tick int `json:"tick"`
		}
		if json.Unmarshal(raw, &d) != nil {
			return 0, false
		}
		return d.Tick, true
	}

	const iterations = 400
	for iter := 0; iter < iterations; iter++ {
		hub := newSSEHub(&slowSessionFetcher{}, nil, nil, nil)
		// Prevent the real poll goroutine from starting inside addClient, so the
		// writer goroutine below is the ONLY mutator of previousJSON["srv"] and its
		// tick sequence stays monotonic.
		hub.mu.Lock()
		hub.polling = true
		hub.previousJSON["srv"] = tickJSON(0)
		hub.mu.Unlock()

		sc := newTestStateConn(hub, "conn-1", 4096)

		// Writer goroutine: continuously advance previousJSON and fan out a
		// `sessions` frame to the server's clients (the poll loop's exact critical
		// section), until the subscribe has completed. Spinning (rather than a
		// fixed count) keeps the interleaving window open across the whole
		// subscribe call — including the gap between the earlier snapshot read and
		// addClient's registration that the pre-fix shape left exposed.
		var done int32
		started := make(chan struct{})
		var wg sync.WaitGroup
		wg.Add(1)
		go func() {
			defer wg.Done()
			close(started)
			n := 1
			for atomic.LoadInt32(&done) == 0 {
				js := tickJSON(n)
				n++
				hub.mu.Lock()
				hub.previousJSON["srv"] = js
				for _, c := range hub.clients["srv"] {
					hub.sendLocked(c, hubEvent{kind: kindServer, typ: "sessions", key: "srv", data: js})
				}
				hub.mu.Unlock()
				runtime.Gosched()
			}
		}()

		<-started
		runtime.Gosched()
		// Race the subscribe against the interleaving writer.
		hub.stateSubscribe(sc, clientMsg{Op: opSubscribe, Kind: kindServer, Key: "srv", Req: 1})
		atomic.StoreInt32(&done, 1)
		wg.Wait()

		// Scan the channel in order: track the max sessions tick seen so far; when
		// the ack appears, its snapshot tick must be ≥ that max (never stale).
		maxSessionsTick := 0
		sawAck := false
		for _, m := range decodeEnvelopes(drainFrames(sc.ch)) {
			switch rawStr(m, "op") {
			case "event":
				if rawStr(m, "type") != "sessions" {
					continue
				}
				if tk, ok := tickOf(m["data"]); ok && tk > maxSessionsTick {
					maxSessionsTick = tk
				}
			case "ack":
				sawAck = true
				tk, ok := tickOf(m["snapshot"])
				if !ok {
					t.Fatalf("iter %d: ack snapshot not a tick payload: %s", iter, m["snapshot"])
				}
				if tk < maxSessionsTick {
					t.Fatalf("iter %d: STALE ack — snapshot tick %d < preceding sessions tick %d "+
						"(ack enqueued a snapshot older than an event already on the channel)",
						iter, tk, maxSessionsTick)
				}
			}
		}
		if !sawAck {
			t.Fatalf("iter %d: no ack frame observed", iter)
		}
		hub.dropStateConn(sc)
	}
}

// TestStateWS_PingRepliesPong proves the client's application-level liveness
// probe (260723-rma2): after hello, a {"op":"ping"} frame is answered with
// {"op":"pong"} through the writer pump, and the connection stays live (a
// subsequent subscribe still acks).
func TestStateWS_PingRepliesPong(t *testing.T) {
	router := newTestRouter(&slowSessionFetcher{}, &mockTmuxOps{})
	srv := httptest.NewServer(router)
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws/state"
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	conn, _, err := websocket.DefaultDialer.DialContext(ctx, wsURL, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer conn.Close()

	if err := conn.WriteJSON(clientMsg{Op: opHello, Conn: "conn-ping"}); err != nil {
		t.Fatalf("write hello: %v", err)
	}
	if err := conn.WriteJSON(clientMsg{Op: opPing}); err != nil {
		t.Fatalf("write ping: %v", err)
	}

	// Read frames until the pong arrives (global slot replays may arrive first).
	// A ping must NOT draw an `error` frame — it is a known op now.
	conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	gotPong := false
	for !gotPong {
		_, raw, err := conn.ReadMessage()
		if err != nil {
			t.Fatalf("read (no pong seen): %v", err)
		}
		var m map[string]json.RawMessage
		if json.Unmarshal(raw, &m) != nil {
			continue
		}
		switch rawStr(m, "op") {
		case "pong":
			gotPong = true
		case "error":
			t.Fatalf("ping drew an error frame: %s", raw)
		}
	}

	// The connection stays live: a subscribe after the ping still acks.
	if err := conn.WriteJSON(clientMsg{Op: opSubscribe, Kind: kindServer, Key: "default", Req: 7}); err != nil {
		t.Fatalf("write subscribe: %v", err)
	}
	gotAck := false
	for !gotAck {
		_, raw, err := conn.ReadMessage()
		if err != nil {
			t.Fatalf("read (no ack seen): %v", err)
		}
		var m map[string]json.RawMessage
		if json.Unmarshal(raw, &m) != nil {
			continue
		}
		if rawStr(m, "op") == "ack" {
			var req int64
			_ = json.Unmarshal(m["req"], &req)
			if req == 7 {
				gotAck = true
			}
		}
	}
}
