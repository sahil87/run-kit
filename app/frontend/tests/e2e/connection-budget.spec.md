# connection-budget.spec.ts

Connection-budget guard for the state-socket migration (change
260716-qf3j-state-socket, acceptance A-014). The migration collapsed the
per-server + metrics-only Server-Sent-Event fan-out onto ONE `/ws/state`
WebSocket. This spec asserts the user-facing budget invariant across the four
route types: each route holds **exactly one** `/ws/state` WebSocket and **zero**
`text/event-stream` responses from rk endpoints. An established WebSocket holds
no HTTP/1.1 connection-pool slot, so this is what clears the pool starvation that
blocked terminal-relay handshakes on Firefox/WebKit for plaintext origins.

## Shared setup

- Runs against the live isolated e2e backend (real tmux + `just test-e2e` on
  port 3020). `beforeAll` creates one tmux session on `E2E_TMUX_SERVER`
  (default `rk-test-e2e`); `afterAll` kills it.
- Each test installs two counters on the page before navigating:
  - `page.on("websocket")` — classifies each WS URL as a state socket
    (`/ws/state`), a terminal relay (`/relay/`), or ignored (Vite HMR), and
    counts **live** sockets as (opened − closed) via each WS's `close` event —
    NOT a URL-keyed Set, which would dedupe two concurrent same-URL `/ws/state`
    sockets to 1 and silently pass the budget (the exact shape a StrictMode
    double-mount leak would produce). Only state sockets are counted for the
    budget assertion; the Vite HMR WS is excluded by URL.
  - `page.on("response")` — records any response whose `content-type` includes
    `text/event-stream` (the retired SSE surface). The budget requires this list
    to be empty.

## Tests

### `the Host home (/) holds exactly one /ws/state WS and zero SSE`

**What it proves:** The bare Host home — which attaches zero tmux servers and
subscribes only to metrics — opens exactly one `/ws/state` WebSocket and no SSE.

**Steps:**
1. Install the counters, `goto('/')`.
2. Wait for the **Host health** region (readiness = the metrics subscription is
   live).
3. Poll until the state-socket count is `1`; assert the `text/event-stream`
   response list is empty.

### `a tmux Server route (/$server) holds exactly one /ws/state WS and zero SSE`

**What it proves:** A single-server route subscribes to one server over the one
socket — no SSE, no second socket.

**Steps:**
1. Install the counters, `goto('/${TMUX_SERVER}')`.
2. Wait for the **Connected** dot (the server subscription acked).
3. Poll state-socket count `=== 1`; assert no `text/event-stream` responses.

### `a Terminal route (/$server/$window) holds exactly one /ws/state WS and zero SSE`

**What it proves:** The terminal route keeps state on the one state socket while
its terminal I/O rides a separate relay WS (unchanged by this change) — the
state-socket count stays exactly `1` and no SSE is opened.

**Steps:**
1. Resolve the session's first window id via `tmux list-windows`.
2. Install the counters, `goto('/${TMUX_SERVER}/${windowId}')`.
3. Wait for the **Connected** dot; poll state-socket count `=== 1`; assert no
   `text/event-stream` responses.

### `a Board route (/board/$name) holds exactly one /ws/state WS and zero SSE`

**What it proves:** The board route — historically the pool-starvation hotspot,
because it attaches every contributing tmux server — now subscribes to all of
them over the SINGLE state socket, so the state-socket count is still exactly `1`
with zero SSE.

**Steps:**
1. Pin the session's first window to a fresh board via `POST /api/boards/{name}/pin`.
2. Install the counters, `goto('/board/${board}')`.
3. Wait for the **Connected** dot; poll state-socket count `=== 1`; assert no
   `text/event-stream` responses.
4. Unpin the window (cleanup), in a `finally`.
