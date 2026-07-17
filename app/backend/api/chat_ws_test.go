package api

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"rk/internal/chat"
)

// Hub-level tests for the `kind:"chat"` state-socket subscription (260717-vhvz).
// They drive the hub directly (no real WebSocket) via newTestStateConn +
// hub.stateSubscribe, mirroring the state_ws_test.go idiom, and stub
// hub.chatResolver so the producer resolves a fixture transcript on disk.

// stubChatResolver is a race-safe, swappable chatResolver for the hub tests.
type stubChatResolver struct {
	mu       sync.Mutex
	provider string
	ref      string
	ok       bool
	err      error
}

func (s *stubChatResolver) resolve(context.Context, string, string) (string, string, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.provider, s.ref, s.ok, s.err
}

func (s *stubChatResolver) set(provider, ref string, ok bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.provider, s.ref, s.ok, s.err = provider, ref, ok, nil
}

// newChatHub builds a hub whose chatResolver is the given stub. The session
// fetcher is unused by the chat path (the stub replaces it) but newSSEHub needs
// one.
func newChatHub(t *testing.T, r *stubChatResolver) *sseHub {
	t.Helper()
	hub := newSSEHub(&slowSessionFetcher{}, nil, nil, nil)
	hub.chatResolver = r.resolve
	return hub
}

// waitFrame reads envelope-decoded frames off sc.ch until one matches `match` or
// the deadline elapses.
func waitFrame(t *testing.T, sc *stateConn, match func(m map[string]json.RawMessage) bool) map[string]json.RawMessage {
	t.Helper()
	deadline := time.After(3 * time.Second)
	for {
		select {
		case ev := <-sc.ch:
			var m map[string]json.RawMessage
			if json.Unmarshal(ev.renderEnvelope(), &m) == nil && match(m) {
				return m
			}
		case <-deadline:
			t.Fatal("timed out waiting for matching frame")
		}
	}
}

func frameOp(m map[string]json.RawMessage) string  { return rawStr(m, "op") }
func frameKind(m map[string]json.RawMessage) string { return rawStr(m, "kind") }
func frameType(m map[string]json.RawMessage) string { return rawStr(m, "type") }

// TestChatWS_SubscribeAcksWithOffsetNoSnapshot: a chat subscribe returns an ack
// carrying the tail-start `offset` (== the subscribe's `from`) and NO snapshot
// (D5 — the transcript came from the GET backfill).
func TestChatWS_SubscribeAcksWithOffsetNoSnapshot(t *testing.T) {
	stageFixtureTranscript(t, testChatRef)
	r := &stubChatResolver{provider: "claude", ref: testChatRef, ok: true}
	hub := newChatHub(t, r)
	sc := newTestStateConn(hub, "conn-1", 32)
	t.Cleanup(func() { hub.dropStateConn(sc) })

	const from = int64(42)
	hub.stateSubscribe(sc, clientMsg{Op: opSubscribe, Kind: kindChat, Key: "@1", Server: "default", From: from, Req: 5})

	ack := waitFrame(t, sc, func(m map[string]json.RawMessage) bool { return frameOp(m) == "ack" })
	var req, offset int64
	_ = json.Unmarshal(ack["req"], &req)
	_ = json.Unmarshal(ack["offset"], &offset)
	if req != 5 {
		t.Errorf("ack req = %d, want 5", req)
	}
	if offset != from {
		t.Errorf("ack offset = %d, want %d (the subscribe from)", offset, from)
	}
	if _, hasSnapshot := ack["snapshot"]; hasSnapshot {
		t.Errorf("chat ack must carry NO snapshot (D5), got snapshot=%s", ack["snapshot"])
	}
}

// TestChatWS_EventPayloadByteEquality: an appended transcript line surfaces as a
// kind:"chat" `chat` event whose `data` is byte-identical to the marshalled
// ChatEvent slice, followed by a `chat-state` event.
func TestChatWS_EventPayloadByteEquality(t *testing.T) {
	fastRefResolve(t, 40*time.Millisecond)
	projDir := stageEmptyConfigDir(t)
	// Seed an initial line so `from` is its byte length; the appended line below is
	// the only event the tail emits.
	path := filepath.Join(projDir, testChatRef+".jsonl")
	initial := `{"type":"user","uuid":"u1","timestamp":"t","message":{"role":"user","content":"first"}}` + "\n"
	if err := os.WriteFile(path, []byte(initial), 0o644); err != nil {
		t.Fatal(err)
	}

	r := &stubChatResolver{provider: "claude", ref: testChatRef, ok: true}
	hub := newChatHub(t, r)
	sc := newTestStateConn(hub, "conn-1", 64)
	t.Cleanup(func() { hub.dropStateConn(sc) })

	hub.stateSubscribe(sc, clientMsg{Op: opSubscribe, Kind: kindChat, Key: "@1", Server: "default", From: int64(len(initial)), Req: 1})
	// Drain the ack.
	waitFrame(t, sc, func(m map[string]json.RawMessage) bool { return frameOp(m) == "ack" })

	// Append one assistant line — the ONLY event the tail should emit.
	f, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		t.Fatal(err)
	}
	appended := `{"type":"assistant","uuid":"a1","timestamp":"t","message":{"role":"assistant","content":[{"type":"text","text":"reply"}]}}` + "\n"
	if _, err := f.WriteString(appended); err != nil {
		t.Fatal(err)
	}
	f.Close()

	chatFrame := waitFrame(t, sc, func(m map[string]json.RawMessage) bool {
		return frameOp(m) == "event" && frameKind(m) == kindChat && frameType(m) == "chat"
	})
	if rawStr(chatFrame, "key") != "@1" {
		t.Errorf("chat event key = %q, want @1", rawStr(chatFrame, "key"))
	}
	// Byte-equality: `data` marshals the same ChatEvent slice the adapter produced.
	var events []chat.Event
	if err := json.Unmarshal(chatFrame["data"], &events); err != nil {
		t.Fatalf("chat data not a ChatEvent[]: %v; data=%s", err, chatFrame["data"])
	}
	if len(events) != 1 || events[0].Text != "reply" {
		t.Errorf("chat events = %+v, want one 'reply' event", events)
	}
	want, _ := json.Marshal(events)
	if string(chatFrame["data"]) != string(want) {
		t.Errorf("chat data not byte-identical to the marshalled events:\n got %s\nwant %s", chatFrame["data"], want)
	}

	// A chat-state event follows (the pending transition, always emitted).
	stateFrame := waitFrame(t, sc, func(m map[string]json.RawMessage) bool {
		return frameOp(m) == "event" && frameKind(m) == kindChat && frameType(m) == "chat-state"
	})
	var state struct {
		Pending *chat.Pending `json:"pending"`
	}
	if err := json.Unmarshal(stateFrame["data"], &state); err != nil {
		t.Errorf("chat-state data not {pending}: %v; data=%s", err, stateFrame["data"])
	}
}

// assertNoFrameOfType drains the connection channel for `window`, failing if any
// frame of a forbidden `kindChat` type arrives before the deadline. Used to prove
// the DORMANT phase ships NO transcript content (`chat`) — only `chat-reset`.
func assertNoFrameOfType(t *testing.T, sc *stateConn, forbidden string, window time.Duration) {
	t.Helper()
	deadline := time.After(window)
	for {
		select {
		case ev := <-sc.ch:
			var m map[string]json.RawMessage
			if json.Unmarshal(ev.renderEnvelope(), &m) == nil && frameType(m) == forbidden {
				t.Fatalf("unexpected %q frame: %s", forbidden, ev.renderEnvelope())
			}
		case <-deadline:
			return
		}
	}
}

// TestChatWS_RotationEmitsChatResetNotTranscript: when the resolved ref rotates
// (a /clear re-stamp) to a DIFFERENT existing session, the producer emits a
// `chat-reset` (no transcript payload — D5) and does NOT re-tail the rotated-to
// session from 0 (which would ship its whole file as a `chat` append). The client
// re-composes on the reset.
func TestChatWS_RotationEmitsChatResetNotTranscript(t *testing.T) {
	const refB = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
	fastRefResolve(t, 40*time.Millisecond)
	projDir := stageEmptyConfigDir(t)
	// A: an initial line (the client "subscribed from" its end). B: a full fixture
	// whose contents must NEVER ride the socket.
	pathA := filepath.Join(projDir, testChatRef+".jsonl")
	initialA := `{"type":"user","uuid":"a1","timestamp":"t","message":{"role":"user","content":"first"}}` + "\n"
	if err := os.WriteFile(pathA, []byte(initialA), 0o644); err != nil {
		t.Fatal(err)
	}
	writeFixtureAt(t, projDir, refB) // session B exists with many events

	r := &stubChatResolver{provider: "claude", ref: testChatRef, ok: true}
	hub := newChatHub(t, r)
	sc := newTestStateConn(hub, "conn-1", 64)
	t.Cleanup(func() { hub.dropStateConn(sc) })

	hub.stateSubscribe(sc, clientMsg{Op: opSubscribe, Kind: kindChat, Key: "@1", Server: "default", From: int64(len(initialA)), Req: 1})
	waitFrame(t, sc, func(m map[string]json.RawMessage) bool { return frameOp(m) == "ack" })

	// Rotate the resolved ref → the re-resolve tick observes B and, once B's file
	// exists (it does), emits a chat-reset. The rotated-to transcript must NOT be
	// re-streamed as a `chat` frame.
	r.set("claude", refB, true)

	reset := waitFrame(t, sc, func(m map[string]json.RawMessage) bool {
		return frameOp(m) == "event" && frameKind(m) == kindChat && frameType(m) == "chat-reset"
	})
	if string(reset["data"]) != "{}" {
		t.Errorf("chat-reset data = %s, want {} (no transcript payload, D5)", reset["data"])
	}
	// No `chat` (transcript) frame ever rides the socket for the rotation.
	assertNoFrameOfType(t, sc, "chat", 200*time.Millisecond)
}

// TestChatWS_InitialNotYetEmitsResetWhenFileAppears: a subscribe whose transcript
// does not exist yet (a rotation raced the subscribe) does NOT emit a chat-error
// and does NOT append a from-0 whole-file — it stays DORMANT and, once the file
// appears, emits a single `chat-reset` so the client re-composes.
func TestChatWS_InitialNotYetEmitsResetWhenFileAppears(t *testing.T) {
	fastRefResolve(t, 40*time.Millisecond)
	projDir := stageEmptyConfigDir(t) // no transcript yet
	r := &stubChatResolver{provider: "claude", ref: testChatRef, ok: true}
	hub := newChatHub(t, r)
	sc := newTestStateConn(hub, "conn-1", 64)
	t.Cleanup(func() { hub.dropStateConn(sc) })

	hub.stateSubscribe(sc, clientMsg{Op: opSubscribe, Kind: kindChat, Key: "@1", Server: "default", From: 0, Req: 1})
	waitFrame(t, sc, func(m map[string]json.RawMessage) bool { return frameOp(m) == "ack" })

	// A few retry ticks with NO file: neither a chat-error NOR a chat frame appears.
	assertNoFrameOfType(t, sc, "chat-error", 200*time.Millisecond)

	// The transcript now appears (first prompt lands): the producer emits a
	// `chat-reset` (NOT a `chat` append of the whole file) — the client's GET is
	// what carries the transcript.
	writeFixtureAt(t, projDir, testChatRef)
	reset := waitFrame(t, sc, func(m map[string]json.RawMessage) bool {
		return frameOp(m) == "event" && frameKind(m) == kindChat && frameType(m) == "chat-reset"
	})
	if string(reset["data"]) != "{}" {
		t.Errorf("chat-reset data = %s, want {}", reset["data"])
	}
}

// TestChatWS_RotationNotYetHoldsThenResets restores the coverage the deleted
// TestChatStreamRotationTranscriptNotYet provided: a live tail on session A, then
// a rotation to session B whose transcript does NOT exist yet. The producer must
// go dormant (no chat-error, no from-0 append) through the no-file window, and
// emit a single `chat-reset` once B's transcript appears.
func TestChatWS_RotationNotYetHoldsThenResets(t *testing.T) {
	const refB = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
	fastRefResolve(t, 40*time.Millisecond)
	projDir := stageEmptyConfigDir(t)
	pathA := filepath.Join(projDir, testChatRef+".jsonl")
	initialA := `{"type":"user","uuid":"a1","timestamp":"t","message":{"role":"user","content":"first"}}` + "\n"
	if err := os.WriteFile(pathA, []byte(initialA), 0o644); err != nil {
		t.Fatal(err)
	}

	r := &stubChatResolver{provider: "claude", ref: testChatRef, ok: true}
	hub := newChatHub(t, r)
	sc := newTestStateConn(hub, "conn-1", 64)
	t.Cleanup(func() { hub.dropStateConn(sc) })

	hub.stateSubscribe(sc, clientMsg{Op: opSubscribe, Kind: kindChat, Key: "@1", Server: "default", From: int64(len(initialA)), Req: 1})
	waitFrame(t, sc, func(m map[string]json.RawMessage) bool { return frameOp(m) == "ack" })

	// Rotate to B, whose transcript does NOT exist yet (a real /clear).
	r.set("claude", refB, true)

	// Through the no-file window: no chat-error, and no from-0 `chat` append.
	assertNoFrameOfType(t, sc, "chat-error", 200*time.Millisecond)

	// B's transcript now appears → a single chat-reset (no transcript over the wire).
	writeFixtureAt(t, projDir, refB)
	reset := waitFrame(t, sc, func(m map[string]json.RawMessage) bool {
		return frameOp(m) == "event" && frameKind(m) == kindChat && frameType(m) == "chat-reset"
	})
	if string(reset["data"]) != "{}" {
		t.Errorf("chat-reset data = %s, want {}", reset["data"])
	}
	assertNoFrameOfType(t, sc, "chat", 200*time.Millisecond)
}

// TestChatWS_InvalidKeyRejected: a chat subscribe whose window key fails
// ValidateWindowID is rejected with an error frame carrying req — no producer.
func TestChatWS_InvalidKeyRejected(t *testing.T) {
	r := &stubChatResolver{provider: "claude", ref: testChatRef, ok: true}
	hub := newChatHub(t, r)
	sc := newTestStateConn(hub, "conn-1", 16)
	t.Cleanup(func() { hub.dropStateConn(sc) })

	hub.stateSubscribe(sc, clientMsg{Op: opSubscribe, Kind: kindChat, Key: "not-a-window", Server: "default", Req: 9})

	frames := decodeEnvelopes(drainFrames(sc.ch))
	if len(frames) != 1 || frameOp(frames[0]) != "error" {
		t.Fatalf("expected one error frame, got %v", frames)
	}
	var req int64
	_ = json.Unmarshal(frames[0]["req"], &req)
	if req != 9 {
		t.Errorf("error req = %d, want 9", req)
	}
	if len(sc.chatProducers) != 0 {
		t.Error("invalid key created a chat producer")
	}
}

// TestChatWS_InvalidServerRejected: a chat subscribe whose server fails
// ValidateServerName is rejected with an error frame — no producer.
func TestChatWS_InvalidServerRejected(t *testing.T) {
	r := &stubChatResolver{provider: "claude", ref: testChatRef, ok: true}
	hub := newChatHub(t, r)
	sc := newTestStateConn(hub, "conn-1", 16)
	t.Cleanup(func() { hub.dropStateConn(sc) })

	hub.stateSubscribe(sc, clientMsg{Op: opSubscribe, Kind: kindChat, Key: "@1", Server: "bad; rm -rf /", Req: 3})

	frames := decodeEnvelopes(drainFrames(sc.ch))
	if len(frames) != 1 || frameOp(frames[0]) != "error" {
		t.Fatalf("expected one error frame, got %v", frames)
	}
	if len(sc.chatProducers) != 0 {
		t.Error("invalid server created a chat producer")
	}
}

// TestChatWS_ResolveFailureRejected: a subscribe for a window with no reconciled
// chat becomes an error frame carrying req — no producer left behind. The resolve
// runs in the producer goroutine (T006 S2 pattern), so the error frame arrives
// asynchronously and the placeholder is removed once it fails.
func TestChatWS_ResolveFailureRejected(t *testing.T) {
	r := &stubChatResolver{ok: false} // window resolves to no chat
	hub := newChatHub(t, r)
	sc := newTestStateConn(hub, "conn-1", 16)
	t.Cleanup(func() { hub.dropStateConn(sc) })

	hub.stateSubscribe(sc, clientMsg{Op: opSubscribe, Kind: kindChat, Key: "@1", Server: "default", Req: 7})

	errFrame := waitFrame(t, sc, func(m map[string]json.RawMessage) bool { return frameOp(m) == "error" })
	var req int64
	_ = json.Unmarshal(errFrame["req"], &req)
	if req != 7 {
		t.Errorf("error req = %d, want 7", req)
	}
	// The placeholder producer is removed once the resolve fails (no zombie).
	deadline := time.After(time.Second)
	for {
		hub.mu.Lock()
		n := len(sc.chatProducers)
		hub.mu.Unlock()
		if n == 0 {
			break
		}
		select {
		case <-deadline:
			t.Fatal("resolve-failure placeholder producer was not removed")
		default:
			time.Sleep(5 * time.Millisecond)
		}
	}
}

// TestChatWS_UnsubscribeCancelsProducer: an unsubscribe drops the producer from
// the connection registry (the goroutine's ctx is cancelled).
func TestChatWS_UnsubscribeCancelsProducer(t *testing.T) {
	stageFixtureTranscript(t, testChatRef)
	r := &stubChatResolver{provider: "claude", ref: testChatRef, ok: true}
	hub := newChatHub(t, r)
	sc := newTestStateConn(hub, "conn-1", 32)
	t.Cleanup(func() { hub.dropStateConn(sc) })

	hub.stateSubscribe(sc, clientMsg{Op: opSubscribe, Kind: kindChat, Key: "@1", Server: "default", From: 0, Req: 1})
	waitFrame(t, sc, func(m map[string]json.RawMessage) bool { return frameOp(m) == "ack" })

	hub.mu.Lock()
	n := len(sc.chatProducers)
	hub.mu.Unlock()
	if n != 1 {
		t.Fatalf("chat producers after subscribe = %d, want 1", n)
	}

	hub.stateUnsubscribe(sc, clientMsg{Op: opUnsubscribe, Kind: kindChat, Key: "@1", Server: "default"})
	hub.mu.Lock()
	n = len(sc.chatProducers)
	hub.mu.Unlock()
	if n != 0 {
		t.Errorf("chat producers after unsubscribe = %d, want 0", n)
	}
}

// TestChatWS_RepeatSubscribeRestartsProducer: a repeat subscribe for the same key
// (new `from`) cancels the prior producer and installs exactly one replacement
// (no goroutine leak, no second registry entry).
func TestChatWS_RepeatSubscribeRestartsProducer(t *testing.T) {
	stageFixtureTranscript(t, testChatRef)
	r := &stubChatResolver{provider: "claude", ref: testChatRef, ok: true}
	hub := newChatHub(t, r)
	sc := newTestStateConn(hub, "conn-1", 64)
	t.Cleanup(func() { hub.dropStateConn(sc) })

	hub.stateSubscribe(sc, clientMsg{Op: opSubscribe, Kind: kindChat, Key: "@1", Server: "default", From: 0, Req: 1})
	waitFrame(t, sc, func(m map[string]json.RawMessage) bool { return frameOp(m) == "ack" })

	hub.mu.Lock()
	first := sc.chatProducers[chatSubKey("default", "@1")]
	hub.mu.Unlock()

	hub.stateSubscribe(sc, clientMsg{Op: opSubscribe, Kind: kindChat, Key: "@1", Server: "default", From: 10, Req: 2})
	waitFrame(t, sc, func(m map[string]json.RawMessage) bool {
		if frameOp(m) != "ack" {
			return false
		}
		var req int64
		_ = json.Unmarshal(m["req"], &req)
		return req == 2
	})

	hub.mu.Lock()
	defer hub.mu.Unlock()
	if len(sc.chatProducers) != 1 {
		t.Errorf("chat producers after repeat subscribe = %d, want 1 (the prior was replaced)", len(sc.chatProducers))
	}
	second := sc.chatProducers[chatSubKey("default", "@1")]
	if second == first {
		t.Error("repeat subscribe did not replace the producer")
	}
	// The prior producer's ctx must be cancelled (teardown).
	select {
	case <-first.ctx.Done():
	default:
		t.Error("prior producer ctx not cancelled on repeat subscribe")
	}
}

// TestChatWS_DisconnectCancelsProducers: dropStateConn cancels every chat
// producer on the connection (no goroutine outlives the socket).
func TestChatWS_DisconnectCancelsProducers(t *testing.T) {
	stageFixtureTranscript(t, testChatRef)
	r := &stubChatResolver{provider: "claude", ref: testChatRef, ok: true}
	hub := newChatHub(t, r)
	sc := newTestStateConn(hub, "conn-1", 32)

	hub.stateSubscribe(sc, clientMsg{Op: opSubscribe, Kind: kindChat, Key: "@1", Server: "default", From: 0, Req: 1})
	waitFrame(t, sc, func(m map[string]json.RawMessage) bool { return frameOp(m) == "ack" })

	hub.mu.Lock()
	p := sc.chatProducers[chatSubKey("default", "@1")]
	hub.mu.Unlock()

	hub.dropStateConn(sc)

	select {
	case <-p.ctx.Done():
	case <-time.After(time.Second):
		t.Error("producer ctx not cancelled on dropStateConn")
	}
	hub.mu.Lock()
	n := len(sc.chatProducers)
	hub.mu.Unlock()
	if n != 0 {
		t.Errorf("chat producers after dropStateConn = %d, want 0", n)
	}
}

// TestChatWS_DroppedEventRecoversWithReset: a dropped incremental `chat` /
// `chat-state` frame (the connection channel was full) is not silently lost — the
// producer marks a recovery `chat-reset` pending and delivers it once the channel
// drains, so the client re-composes from a fresh GET rather than diverging.
func TestChatWS_DroppedEventRecoversWithReset(t *testing.T) {
	hub := newSSEHub(&slowSessionFetcher{}, nil, nil, nil)
	// A tiny channel we can force full. The producer is constructed directly (no
	// real tail) so we drive emitUpdate deterministically.
	sc := newTestStateConn(hub, "conn-1", 1)
	pctx, pcancel := context.WithCancel(context.Background())
	defer pcancel()
	p := &chatProducer{hub: hub, sc: sc, server: "default", windowID: "@1", ctx: pctx, cancel: pcancel}

	// Fill the single channel slot so the next emit(s) DROP.
	sc.ch <- hubEvent{raw: []byte(`{"op":"filler"}`)}

	// An incremental update now can't enqueue — both `chat` and `chat-state` drop,
	// so a recovery reset is marked pending (and its immediate attempt also drops).
	p.emitUpdate(chat.Update{Events: []chat.Event{{Type: chat.EventMessage, Turn: 1, Text: "hi"}}})
	if !p.pendingReset {
		t.Fatal("a dropped incremental frame did not mark a pending recovery reset")
	}

	// Drain the channel (the filler + whatever squeezed in) so there is room again.
	for len(sc.ch) > 0 {
		<-sc.ch
	}

	// A re-resolve tick (or any emit opportunity) flushes the pending reset.
	p.flushPendingReset()
	if p.pendingReset {
		t.Fatal("pending reset not cleared after the channel drained")
	}
	// The delivered frame is a chat-reset (no transcript payload).
	select {
	case ev := <-sc.ch:
		var m map[string]json.RawMessage
		if json.Unmarshal(ev.renderEnvelope(), &m) != nil ||
			frameOp(m) != "event" || frameType(m) != "chat-reset" {
			t.Fatalf("recovery frame = %s, want a chat-reset event", ev.renderEnvelope())
		}
		if string(m["data"]) != "{}" {
			t.Errorf("recovery chat-reset data = %s, want {}", m["data"])
		}
	default:
		t.Fatal("no recovery chat-reset delivered after drain")
	}
}
