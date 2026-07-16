# Muxed terminal socket — head-of-line blocking measurements (spike)

**Date**: 2026-07-16
**Context**: Protocol-shaping evidence for the terminal relay mux (one WebSocket carrying
all pane streams — see `docs/findings/socket-pool-accounting.md` for why the mux exists).
Question: when N pane streams share one TCP connection, does one pane's flood destroy
another pane's interactive latency — and does the v1 protocol therefore need per-stream
flow control, or can it ship with a simple shared FIFO?

## Method

Go harness (gorilla/websocket v1.5.3, appendix): one WS connection, two streams framed
as `[u32 streamId][payload]`. Stream 1 floods 4096-byte frames continuously (a pane
running `yes`). Stream 2 echoes 12-byte client probes sent every 100ms (an interactive
pane's keystroke→echo). The server's single writer is paced to a simulated link
bandwidth (sleep proportional to bytes written). Two server architectures compared:

- **naive** — one shared FIFO queue (depth 64 ≈ 262KB), single writer drains in order.
- **fair** — per-stream bounded queues (depth 8) + interactive-priority scheduler
  (echo queue drained first; a full queue blocks only that stream's producer —
  the backpressure seam that would stop reading that pane's PTY).

80 probes per 8s scenario, loopback, Go 1.26.

## Results

| Scenario | echo p50 | p95 | max | flood goodput |
|----------|---------|-----|-----|---------------|
| baseline, no flood, 1 Mbps | ~0ms | ~0ms | ~0ms | — |
| **naive**, flood, 1 Mbps | **1.66s** | 2.09s | 2.19s | 0.98 Mbps |
| **fair**, flood, 1 Mbps | **32ms** | 33ms | 33ms | 0.98 Mbps |
| **naive**, flood, 10 Mbps | **265ms** | 268ms | 273ms | 7.87 Mbps |
| **fair**, flood, 10 Mbps | **2ms** | 4ms | 4ms | 7.86 Mbps |

## Findings

1. **A shared FIFO makes typing unusable under any co-stream flood on slow links.**
   Echo RTT ≈ queue-depth × frame-size ÷ bandwidth (observed 1.66s at 1 Mbps with a
   modest 262KB buffer — matches theory). It scales linearly with whatever buffering
   exists, so "tune the buffer" is not a fix.
2. **Per-stream queues + a non-FIFO scheduler bound interactive RTT to ~1–2 in-flight
   frames** (32ms at 1 Mbps, 4ms at 10 Mbps) — a 50–65× improvement.
3. **Fairness costs zero throughput.** Flood goodput is identical in both modes
   (0.98/0.98 and 7.87/7.86 Mbps) — the scheduler only reorders, never idles the link.
4. Backpressure semantics fall out naturally: a full per-stream queue blocks that
   stream's PTY reader only, pushing the stall into tmux's per-client buffering —
   exactly what N independent sockets give today via N TCP send buffers.

## Protocol implications (v1 requirements, not optimizations)

- The terminal mux server MUST use per-stream bounded send queues with a scheduler
  that does not FIFO across streams. Two-stream priority generalizes to N panes as
  round-robin (or deficit round-robin) across ready streams; small
  control/interactive frames should never queue behind bulk output.
- A stream whose queue is full has its PTY read paused (backpressure), never dropped —
  dropping bytes mid-stream corrupts VT state.
- The kernel TCP send buffer is a shared tail *after* the scheduler that cannot be
  reordered; keep it from growing unbounded (default autotuning is acceptable — the
  scheduler bounds everything above it, and today's per-pane sockets have the same
  kernel tail per pane).

**Caveats**: loopback + simulated pacing (real links add jitter but not ordering
differences); continuous flood is the worst case (real tmux output is bursty);
scheduling below the WS frame boundary is not possible, so one already-accepted 4KB
frame is always ahead of an echo (~33ms at 1 Mbps — the observed fair-mode floor).

## Reproduction

<details>
<summary>main.go (go mod init && go mod tidy && go run . — gorilla/websocket v1.5.3)</summary>

```go
// Spike: head-of-line blocking on a muxed terminal WebSocket.
// One WS, two streams: stream 1 floods 4096B frames (a pane running `yes`),
// stream 2 echoes client probes (an interactive pane's keystroke->echo).
// The server's write path is paced to simulate a slow link.
package main

import (
	"encoding/binary"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
)

const (
	frameSize   = 4096
	naiveQCap   = 64 // shared queue depth (262KB backlog potential)
	fairQCap    = 8  // per-stream queue depth
	probeEvery  = 100 * time.Millisecond
	runDuration = 8 * time.Second
	drainWindow = 3 * time.Second
	port        = "39872"
)

var upgrader = websocket.Upgrader{CheckOrigin: func(r *http.Request) bool { return true }}

type frame struct {
	stream uint32
	data   []byte
}

func pack(f frame) []byte {
	b := make([]byte, 4+len(f.data))
	binary.BigEndian.PutUint32(b, f.stream)
	copy(b[4:], f.data)
	return b
}

func handleWS(w http.ResponseWriter, r *http.Request) {
	mode := r.URL.Query().Get("mode")
	bps, _ := strconv.ParseFloat(r.URL.Query().Get("bps"), 64)
	flood := r.URL.Query().Get("flood") == "on"

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	done := make(chan struct{})
	var closeOnce sync.Once
	stop := func() { closeOnce.Do(func() { close(done) }) }
	defer stop()

	var floodQ, echoQ chan frame
	if mode == "naive" {
		shared := make(chan frame, naiveQCap)
		floodQ, echoQ = shared, shared
	} else {
		floodQ = make(chan frame, fairQCap)
		echoQ = make(chan frame, fairQCap)
	}

	if flood {
		go func() { // flood producer: blocks when its queue is full (backpressure seam)
			payload := make([]byte, frameSize)
			for {
				select {
				case <-done:
					return
				case floodQ <- frame{1, payload}:
				}
			}
		}()
	}

	go func() { // reader: echo client probes back on stream 2
		defer stop()
		for {
			_, msg, err := conn.ReadMessage()
			if err != nil {
				return
			}
			if len(msg) < 4 {
				continue
			}
			data := make([]byte, len(msg)-4)
			copy(data, msg[4:])
			select {
			case <-done:
				return
			case echoQ <- frame{2, data}:
			}
		}
	}()

	// single paced writer — the simulated slow link
	write := func(f frame) bool {
		b := pack(f)
		if err := conn.WriteMessage(websocket.BinaryMessage, b); err != nil {
			return false
		}
		time.Sleep(time.Duration(float64(len(b)) / bps * float64(time.Second)))
		return true
	}
	if mode == "naive" {
		for {
			select {
			case <-done:
				return
			case f := <-floodQ: // floodQ == echoQ (shared FIFO)
				if !write(f) {
					return
				}
			}
		}
	}
	for { // fair: interactive-priority — drain echo queue first if ready
		select {
		case <-done:
			return
		case f := <-echoQ:
			if !write(f) {
				return
			}
			continue
		default:
		}
		select {
		case <-done:
			return
		case f := <-echoQ:
			if !write(f) {
				return
			}
		case f := <-floodQ:
			if !write(f) {
				return
			}
		}
	}
}

type result struct {
	name           string
	probesSent     int
	probesReturned int
	p50, p95, max  time.Duration
	floodMbps      float64
}

func runScenario(name, mode string, bps float64, flood bool) result {
	floodStr := "off"
	if flood {
		floodStr = "on"
	}
	url := fmt.Sprintf("ws://127.0.0.1:%s/ws?mode=%s&bps=%d&flood=%s", port, mode, int64(bps), floodStr)
	c, _, err := websocket.DefaultDialer.Dial(url, nil)
	if err != nil {
		panic(err)
	}
	var floodBytes int64
	var mu sync.Mutex
	rtts := []time.Duration{}
	go func() {
		for {
			_, msg, err := c.ReadMessage()
			if err != nil {
				return
			}
			if len(msg) < 4 {
				continue
			}
			switch binary.BigEndian.Uint32(msg) {
			case 1:
				atomic.AddInt64(&floodBytes, int64(len(msg)))
			case 2:
				if len(msg) >= 12 {
					sent := int64(binary.BigEndian.Uint64(msg[4:12]))
					rtt := time.Duration(time.Now().UnixNano() - sent)
					mu.Lock()
					rtts = append(rtts, rtt)
					mu.Unlock()
				}
			}
		}
	}()

	t0 := time.Now()
	sent := 0
	for time.Now().Before(t0.Add(runDuration)) {
		buf := make([]byte, 12)
		binary.BigEndian.PutUint32(buf, 2)
		binary.BigEndian.PutUint64(buf[4:], uint64(time.Now().UnixNano()))
		if err := c.WriteMessage(websocket.BinaryMessage, buf); err != nil {
			break
		}
		sent++
		time.Sleep(probeEvery)
	}
	time.Sleep(drainWindow) // let late echoes arrive
	elapsed := time.Since(t0)
	c.Close()

	mu.Lock()
	defer mu.Unlock()
	r := result{name: name, probesSent: sent, probesReturned: len(rtts)}
	r.floodMbps = float64(atomic.LoadInt64(&floodBytes)) * 8 / elapsed.Seconds() / 1e6
	if len(rtts) > 0 {
		sort.Slice(rtts, func(i, j int) bool { return rtts[i] < rtts[j] })
		r.p50 = rtts[len(rtts)/2]
		r.p95 = rtts[len(rtts)*95/100]
		r.max = rtts[len(rtts)-1]
	}
	return r
}

func main() {
	http.HandleFunc("/ws", handleWS)
	go http.ListenAndServe("127.0.0.1:"+port, nil)
	time.Sleep(300 * time.Millisecond)

	const mbps1, mbps10 = 125_000, 1_250_000
	scenarios := []struct {
		name  string
		mode  string
		bps   float64
		flood bool
	}{
		{"baseline  fair  1Mbps  no-flood", "fair", mbps1, false},
		{"naive  1Mbps  flood", "naive", mbps1, true},
		{"fair   1Mbps  flood", "fair", mbps1, true},
		{"naive 10Mbps  flood", "naive", mbps10, true},
		{"fair  10Mbps  flood", "fair", mbps10, true},
	}
	fmt.Printf("%-34s %8s %8s %10s %10s %10s %10s\n",
		"scenario", "sent", "returned", "p50", "p95", "max", "floodMbps")
	for _, s := range scenarios {
		r := runScenario(s.name, s.mode, s.bps, s.flood)
		fmt.Printf("%-34s %8d %8d %10s %10s %10s %10.2f\n",
			r.name, r.probesSent, r.probesReturned,
			r.p50.Round(time.Millisecond), r.p95.Round(time.Millisecond),
			r.max.Round(time.Millisecond), r.floodMbps)
	}
}
```

</details>
