package api

import (
	"encoding/binary"
	"sync"
	"testing"
	"time"
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

	// Wait until the echo is observed in the write order (or fail on timeout).
	deadline := time.Now().Add(2 * time.Second)
	echoIdx := -1
	aFramesBefore := 0
	for time.Now().Before(deadline) {
		mu.Lock()
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
		mu.Unlock()
		if echoIdx >= 0 {
			break
		}
		time.Sleep(2 * time.Millisecond)
	}

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

	// Wait until all frames drain.
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		mu.Lock()
		n := len(order)
		mu.Unlock()
		if n >= 2*streamQueueDepth {
			break
		}
		time.Sleep(2 * time.Millisecond)
	}
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
