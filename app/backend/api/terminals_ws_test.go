package api

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"os/exec"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/creack/pty"
	"github.com/gorilla/websocket"

	"rk/internal/testutil"
	"rk/internal/tmux"
)

// payload returns the frame's wire bytes regardless of tier — a test-only
// convenience for the paced writers below, which peek the stream-id prefix.
// Production writeFrame reads f.control / f.data directly.
func (f outFrame) payload() []byte {
	if f.control != nil {
		return f.control
	}
	return f.data
}

// TestScheduler_EchoNotHeadOfLineBlocked is the HOL assertion ported from the
// spike harness (docs/findings/relay-mux-hol.md) as a Go unit test with NO real
// network. Stream A floods bulk frames while stream B enqueues a single short
// "echo" frame; the fair scheduler must write B's echo within a small bounded
// number of A frames (a shared FIFO would write it only after the entire A
// backlog drains). The write path is an injectable PACED writer (sleeps
// proportional to bytes written) so the flood cannot outrun the writer and the
// ordering — not wall-clock — is what the bound asserts.
func TestScheduler_EchoNotHeadOfLineBlocked(t *testing.T) {
	const (
		streamA uint32 = 1
		streamB uint32 = 2
		bulkLen        = streamFrameSize // 4096B — a flooding pane's chunk
	)

	tc := &terminalsConn{
		streams: map[uint32]*stream{},
		wake:    make(chan struct{}, 1),
		done:    make(chan struct{}),
	}

	stA := &stream{id: streamA, queue: make(chan outFrame, streamQueueDepth), closed: make(chan struct{})}
	stB := &stream{id: streamB, queue: make(chan outFrame, streamQueueDepth), closed: make(chan struct{})}
	tc.streams[streamA] = stA
	tc.streams[streamB] = stB

	// The paced writer records the ordered stream ids of everything written and
	// sleeps ∝ bytes (the simulated slow link). A small per-byte pace keeps the
	// test fast while still forcing the writer to be the bottleneck.
	var mu sync.Mutex
	var order []uint32
	const bytesPerSec = 4 * 1024 * 1024 // 4 MB/s simulated link
	tc.writeFrame = func(f outFrame) error {
		b := f.payload()
		if len(b) >= 4 {
			id := binary.BigEndian.Uint32(b[:4])
			mu.Lock()
			order = append(order, id)
			mu.Unlock()
		}
		time.Sleep(time.Duration(float64(len(b)) / bytesPerSec * float64(time.Second)))
		return nil
	}

	// A continuous flood producer on stream A: blocks when A's queue is full
	// (backpressure) — exactly the PTY-reader-pause seam in production.
	floodDone := make(chan struct{})
	go func() {
		defer close(floodDone)
		payload := make([]byte, 4+bulkLen)
		binary.BigEndian.PutUint32(payload[:4], streamA)
		for {
			frame := make([]byte, len(payload))
			copy(frame, payload)
			select {
			case stA.queue <- outFrame{data: frame}:
				tc.signalWake()
			case <-tc.done:
				return
			}
		}
	}()

	// Run the writer (the scheduler under test).
	writerDone := make(chan struct{})
	go func() {
		defer close(writerDone)
		tc.runWriter()
	}()

	// Let the flood saturate A's queue so B's echo genuinely contends with a
	// backlog (the HOL scenario). Record how many frames were already written at
	// the moment we enqueue the echo — the HOL bound is A frames written AFTER
	// the echo is enqueued but BEFORE the echo itself, not the warmup A frames
	// written while only A existed.
	time.Sleep(20 * time.Millisecond)
	mu.Lock()
	writtenAtEnqueue := len(order)
	mu.Unlock()
	echo := make([]byte, 4+12) // 12-byte interactive payload
	binary.BigEndian.PutUint32(echo[:4], streamB)
	stB.queue <- outFrame{data: echo}
	tc.signalWake()

	// Wait until the echo is observed in the write order (fall-through on
	// timeout — the post-stop Fatalf below reports it).
	echoIdx := -1
	aFramesBefore := 0
	testutil.WaitUntil(t, 2*time.Second, func() bool {
		mu.Lock()
		defer mu.Unlock()
		for i := writtenAtEnqueue; i < len(order); i++ {
			if order[i] == streamB {
				echoIdx = i
				break
			}
		}
		if echoIdx >= 0 {
			for i := writtenAtEnqueue; i < echoIdx; i++ {
				if order[i] == streamA {
					aFramesBefore++
				}
			}
		}
		return echoIdx >= 0
	})

	// Stop the flood + writer.
	close(tc.done)
	<-floodDone
	tc.signalWake()
	<-writerDone

	if echoIdx < 0 {
		t.Fatalf("stream B echo was never written — scheduler starved it")
	}
	// Fairness bound: with a two-queue priority scheduler, at most one already-
	// dequeued A bulk frame can precede the echo (the WS-frame-boundary floor
	// from the spike: one accepted 4KB frame is always ahead of an echo). Allow a
	// small slack (≤3) for scheduling-pass timing without admitting FIFO
	// behavior (a shared FIFO would put the entire backlog — dozens of A frames —
	// ahead of the echo).
	const maxAFramesBeforeEcho = 3
	if aFramesBefore > maxAFramesBeforeEcho {
		t.Errorf("echo head-of-line blocked: %d stream-A bulk frames written before the echo (want ≤ %d)",
			aFramesBefore, maxAFramesBeforeEcho)
	}
}

// TestScheduler_RoundRobinNoStarvation asserts the writer does not starve any
// stream: with two streams both holding bulk frames, both get service within a
// bounded window (round-robin), not one fully drained before the other starts.
func TestScheduler_RoundRobinNoStarvation(t *testing.T) {
	const (
		streamA uint32 = 1
		streamB uint32 = 2
	)
	tc := &terminalsConn{
		streams: map[uint32]*stream{},
		wake:    make(chan struct{}, 1),
		done:    make(chan struct{}),
	}
	stA := &stream{id: streamA, queue: make(chan outFrame, streamQueueDepth), closed: make(chan struct{})}
	stB := &stream{id: streamB, queue: make(chan outFrame, streamQueueDepth), closed: make(chan struct{})}
	tc.streams[streamA] = stA
	tc.streams[streamB] = stB

	var mu sync.Mutex
	var order []uint32
	tc.writeFrame = func(f outFrame) error {
		b := f.payload()
		if len(b) >= 4 {
			id := binary.BigEndian.Uint32(b[:4])
			mu.Lock()
			order = append(order, id)
			mu.Unlock()
		}
		return nil
	}

	mkFrame := func(id uint32) outFrame {
		b := make([]byte, 4+streamFrameSize)
		binary.BigEndian.PutUint32(b[:4], id)
		return outFrame{data: b}
	}
	// Fill both queues fully with bulk frames before starting the writer.
	for i := 0; i < streamQueueDepth; i++ {
		stA.queue <- mkFrame(streamA)
		stB.queue <- mkFrame(streamB)
	}

	writerDone := make(chan struct{})
	go func() {
		defer close(writerDone)
		tc.runWriter()
	}()

	// Wait until all frames drain (fall-through on timeout — the post-stop
	// Fatalf below reports it).
	testutil.WaitUntil(t, 2*time.Second, func() bool {
		mu.Lock()
		defer mu.Unlock()
		return len(order) >= 2*streamQueueDepth
	})
	close(tc.done)
	tc.signalWake()
	<-writerDone

	mu.Lock()
	defer mu.Unlock()
	if len(order) < 2*streamQueueDepth {
		t.Fatalf("not all frames drained: got %d, want %d", len(order), 2*streamQueueDepth)
	}
	// Round-robin: within the first 2 written frames, both streams appear (B is
	// not fully drained after A, nor vice versa). A shared FIFO or a
	// drain-one-stream-completely scheduler would write streamQueueDepth A frames
	// before any B frame.
	seenA, seenB := false, false
	for _, id := range order[:2] {
		if id == streamA {
			seenA = true
		}
		if id == streamB {
			seenB = true
		}
	}
	if !(seenA && seenB) {
		t.Errorf("expected round-robin interleave in the first 2 frames, got %v", order[:2])
	}
}

// TestTerminals_PingRepliesPong proves the client's application-level liveness
// probe on the terminals mux (260723-rma2): a {"op":"ping"} control frame (no
// stream id) is answered with the id-less {"op":"pong"} text frame through the
// single writer's control pseudo-stream. No tmux server is needed — the ping
// path never touches tmux — so this runs against the mock-tmux test router.
func TestTerminals_PingRepliesPong(t *testing.T) {
	router := newTestRouter(&slowSessionFetcher{}, &mockTmuxOps{})
	srv := httptest.NewServer(router)
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws/terminals"
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer conn.Close()

	if err := conn.WriteMessage(websocket.TextMessage, []byte(`{"op":"ping"}`)); err != nil {
		t.Fatalf("write ping: %v", err)
	}

	conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	for {
		msgType, raw, err := conn.ReadMessage()
		if err != nil {
			t.Fatalf("read (no pong seen): %v", err)
		}
		if msgType != websocket.TextMessage {
			continue
		}
		var m map[string]json.RawMessage
		if json.Unmarshal(raw, &m) != nil {
			continue
		}
		var op string
		_ = json.Unmarshal(m["op"], &op)
		if op != "pong" {
			continue
		}
		// The pong carries no stream id (the client handles it before its
		// per-stream id guard).
		if _, hasID := m["id"]; hasID {
			t.Errorf("pong carries an id field: %s", raw)
		}
		return
	}
}

// TestReloadConfigForAttach pins the managed-only pre-attach reload gate in
// its off-critical-path shape: the reload runs asynchronously (never a
// subprocess on the attach goroutine) and at most once per server per Server
// lifetime; an external server is skipped, a managed-check read failure fails
// closed AND releases the once-guard so a later attach retries, and a reload
// error only logs.
func TestReloadConfigForAttach(t *testing.T) {
	stub := func(t *testing.T, isManaged func(context.Context, string) (bool, error), reloadErr error) chan string {
		t.Helper()
		reloaded := make(chan string, 8)
		origManaged, origReload, origMigrate := attachIsManaged, attachReloadConfig, attachMigrateLegacy
		attachIsManaged = isManaged
		attachReloadConfig = func(server string) error {
			reloaded <- server
			return reloadErr
		}
		attachMigrateLegacy = func(context.Context, string) (bool, error) { return false, nil }
		t.Cleanup(func() {
			attachIsManaged, attachReloadConfig, attachMigrateLegacy = origManaged, origReload, origMigrate
			tmux.ResetLegacyMigrationForTest()
		})
		return reloaded
	}
	managedYes := func(context.Context, string) (bool, error) { return true, nil }
	managedNo := func(context.Context, string) (bool, error) { return false, nil }

	t.Run("managed server reloads asynchronously, off the attach path", func(t *testing.T) {
		// UNBUFFERED observation channel: were the reload synchronous, the send
		// would deadlock the attach goroutine and reloadConfigForAttach would
		// never return — so returning-then-receiving is the async proof.
		reloaded := make(chan string)
		origManaged, origReload, origMigrate := attachIsManaged, attachReloadConfig, attachMigrateLegacy
		attachIsManaged = managedYes
		attachReloadConfig = func(server string) error {
			reloaded <- server
			return nil
		}
		attachMigrateLegacy = func(context.Context, string) (bool, error) { return false, nil }
		t.Cleanup(func() {
			attachIsManaged, attachReloadConfig, attachMigrateLegacy = origManaged, origReload, origMigrate
			tmux.ResetLegacyMigrationForTest()
		})

		(&Server{}).reloadConfigForAttach("srv")
		select {
		case got := <-reloaded:
			if got != "srv" {
				t.Errorf("reloaded = %q, want srv", got)
			}
		case <-time.After(2 * time.Second):
			t.Error("reload never ran — the async reload must fire for a managed server")
		}
	})

	t.Run("external server is skipped", func(t *testing.T) {
		reloaded := stub(t, managedNo, nil)
		(&Server{}).reloadConfigForAttach("srv")
		select {
		case got := <-reloaded:
			t.Errorf("reloaded %q — an external server must never receive rk's conf", got)
		case <-time.After(100 * time.Millisecond):
		}
	})

	t.Run("managed-check failure fails closed and retries on a later attach", func(t *testing.T) {
		var calls atomic.Int32
		reloaded := stub(t, func(context.Context, string) (bool, error) {
			if calls.Add(1) == 1 {
				return false, fmt.Errorf("tmux read wobble")
			}
			return true, nil
		}, nil)
		s := &Server{}
		s.reloadConfigForAttach("srv")
		select {
		case got := <-reloaded:
			t.Fatalf("reloaded %q — a read failure must skip the reload", got)
		case <-time.After(100 * time.Millisecond):
		}
		// The guard release happens inside the async goroutine, so keep
		// re-attaching until the retry lands.
		deadline := time.After(2 * time.Second)
		for {
			s.reloadConfigForAttach("srv")
			select {
			case <-reloaded:
				return
			case <-deadline:
				t.Fatal("guard never released — a transient managed-check failure must retry")
			case <-time.After(10 * time.Millisecond):
			}
		}
	})

	t.Run("reload error does not propagate", func(t *testing.T) {
		reloaded := stub(t, managedYes, fmt.Errorf("boom"))
		(&Server{}).reloadConfigForAttach("srv") // must not panic
		select {
		case <-reloaded:
		case <-time.After(2 * time.Second):
			t.Error("reload never attempted — the error is logged, not gating")
		}
	})

	t.Run("reload runs at most once per server", func(t *testing.T) {
		reloaded := stub(t, managedYes, nil)
		s := &Server{}
		s.reloadConfigForAttach("srv")
		s.reloadConfigForAttach("srv")
		select {
		case <-reloaded:
		case <-time.After(2 * time.Second):
			t.Fatal("reload never ran")
		}
		select {
		case got := <-reloaded:
			t.Errorf("reload ran twice (%q) — the per-server once-guard must hold", got)
		case <-time.After(100 * time.Millisecond):
		}
	})

	t.Run("distinct servers each reload", func(t *testing.T) {
		reloaded := stub(t, managedYes, nil)
		s := &Server{}
		s.reloadConfigForAttach("srv-a")
		s.reloadConfigForAttach("srv-b")
		got := map[string]bool{}
		for range 2 {
			select {
			case name := <-reloaded:
				got[name] = true
			case <-time.After(2 * time.Second):
				t.Fatalf("only %v reloaded — the guard is per server, not per Server", got)
			}
		}
		if !got["srv-a"] || !got["srv-b"] {
			t.Errorf("reloaded set = %v, want srv-a and srv-b", got)
		}
	})
}

// TestStreamTeardownReapsAttachChild is the zombie regression test: teardown
// must kill AND reap (Wait) the forked attach child — without the Wait every
// closed stream leaves a <defunct> PID plus a parked os/exec watcher
// goroutine. ProcessState is populated only by a returned Wait, so its
// presence after teardown IS the reap proof. A pty child stands in for the
// real `tmux attach-session` fork (same pty.StartWithSize shape).
func TestStreamTeardownReapsAttachChild(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cmd := exec.CommandContext(ctx, "sh", "-c", "sleep 30")
	ptmx, err := pty.StartWithSize(cmd, &pty.Winsize{Cols: 80, Rows: 24})
	if err != nil {
		cancel()
		t.Skipf("pty start unavailable: %v", err)
	}
	st := &stream{
		id:     1,
		queue:  make(chan outFrame, streamQueueDepth),
		closed: make(chan struct{}),
		ptmx:   ptmx,
		cancel: cancel,
		cmd:    cmd,
	}
	st.teardown()
	if cmd.ProcessState == nil {
		t.Fatal("child not reaped — teardown must Wait after Kill")
	}
	// Idempotent: closeStream and socket teardown can both reach it; the
	// sync.Once must prevent a second (panicking) Wait.
	st.teardown()
}

// TestKillAndReapAttach pins the shared reap helper both kill sites call —
// stream.teardown for a published cmd and attachStream's publish-race branch
// for a never-published one — plus its nil-safety on every placeholder shape
// teardown can see (control pseudo-stream, failed start).
func TestKillAndReapAttach(t *testing.T) {
	killAndReapAttach(nil)
	killAndReapAttach(&exec.Cmd{}) // failed start: no Process to reap

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	cmd := exec.CommandContext(ctx, "sh", "-c", "sleep 30")
	ptmx, err := pty.StartWithSize(cmd, &pty.Winsize{Cols: 80, Rows: 24})
	if err != nil {
		t.Skipf("pty start unavailable: %v", err)
	}
	defer ptmx.Close()
	killAndReapAttach(cmd)
	if cmd.ProcessState == nil {
		t.Fatal("child not reaped — the helper must Wait after Kill")
	}
	if cmd.ProcessState.Success() {
		t.Errorf("child exited cleanly (%v) — expected a kill", cmd.ProcessState)
	}
}

// TestReloadConfigForAttachLegacySweep pins the sweep half of the pre-attach
// seam: the sweep runs for managed servers only, behind the same gate, off
// the attach goroutine (the once-guard taken synchronously up front), and at
// most once per server. Each subtest uses its own server name: the sweep runs
// in a goroutine, so a shared name would let the previous subtest's in-flight
// sweep fire into the next subtest's fresh stub.
func TestReloadConfigForAttachLegacySweep(t *testing.T) {
	stub := func(t *testing.T, managed bool) chan string {
		t.Helper()
		swept := make(chan string, 8)
		origManaged, origReload, origMigrate := attachIsManaged, attachReloadConfig, attachMigrateLegacy
		attachIsManaged = func(context.Context, string) (bool, error) { return managed, nil }
		attachReloadConfig = func(string) error { return nil }
		attachMigrateLegacy = func(_ context.Context, server string) (bool, error) {
			// Ignore leaked sends from earlier tests' in-flight sweep
			// goroutines — only this test's own names count.
			if strings.HasPrefix(server, "sweep-") {
				swept <- server
			}
			return false, nil
		}
		tmux.ResetLegacyMigrationForTest()
		t.Cleanup(func() {
			attachIsManaged, attachReloadConfig, attachMigrateLegacy = origManaged, origReload, origMigrate
			tmux.ResetLegacyMigrationForTest()
		})
		return swept
	}

	t.Run("managed server is swept off the attach path", func(t *testing.T) {
		swept := stub(t, true)
		(&Server{}).reloadConfigForAttach("sweep-managed")
		select {
		case got := <-swept:
			if got != "sweep-managed" {
				t.Errorf("swept = %q, want sweep-managed", got)
			}
		case <-time.After(2 * time.Second):
			t.Error("sweep never ran — the async sweep must fire for a managed server")
		}
	})

	t.Run("external server is not swept", func(t *testing.T) {
		swept := stub(t, false)
		(&Server{}).reloadConfigForAttach("sweep-external")
		select {
		case got := <-swept:
			t.Errorf("swept %q — an external server must never be swept", got)
		case <-time.After(100 * time.Millisecond):
		}
	})

	t.Run("the once-guard runs the sweep at most once per server", func(t *testing.T) {
		swept := stub(t, true)
		(&Server{}).reloadConfigForAttach("sweep-once")
		(&Server{}).reloadConfigForAttach("sweep-once")
		select {
		case got := <-swept:
			if got != "sweep-once" {
				t.Errorf("swept = %q, want sweep-once", got)
			}
		case <-time.After(2 * time.Second):
			t.Fatal("sweep never ran")
		}
		select {
		case got := <-swept:
			t.Errorf("sweep ran twice (%q) — the once-guard must be taken synchronously", got)
		case <-time.After(100 * time.Millisecond):
		}
	})
}
