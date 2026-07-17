# connection-budget.spec.ts

Connection-budget guard — **final any-route form** for the socket-unification
effort (state socket 260716-qf3j + terminals mux 260717-803u +
chat-on-state-socket 260717-vhvz). The effort collapsed EVERY long-lived stream
onto one of two muxed WebSockets: session-state + host-metrics + **chat** ride
`/ws/state` (change 1 + change 3), and ALL terminal pane relays ride
`/ws/terminals` (change 2). The chat lens was the last remaining EventSource;
change 3 moved it onto the state socket as a `kind:"chat"` subscription, so **no**
route holds an SSE anymore. This spec asserts the user-facing budget invariant
across every route type (Host, tmux Server, Terminal, Board, and the **chat
lens**): a tab holds **at most two** rk WebSockets total — **exactly one**
`/ws/state` plus (only on routes with live panes) **exactly one** `/ws/terminals`
— and **zero** `text/event-stream` responses from rk endpoints. An established
WebSocket holds no HTTP/1.1 connection-pool slot, so this is what clears the pool
starvation that blocked terminal-relay handshakes on Firefox/WebKit for
plaintext origins.

## Shared setup

- Runs against the live isolated e2e backend (real tmux + `just test-e2e` on
  port 3020). `beforeAll` creates one tmux session on `E2E_TMUX_SERVER`
  (default `rk-test-e2e`); `afterAll` kills it.
- Each test installs two counters on the page before navigating:
  - `page.on("websocket")` — classifies each WS URL as a state socket
    (`/ws/state`), a terminals mux socket (`/ws/terminals`), or ignored (Vite
    HMR), and counts **live** sockets as (opened − closed) via each WS's `close`
    event — NOT a URL-keyed Set, which would dedupe two concurrent same-URL
    sockets to 1 and silently pass the budget (the exact shape a StrictMode
    double-mount leak or a reconnect-without-close bug would produce). Both the
    state-socket and terminals-socket counts feed the budget assertion.
  - `page.on("response")` — records any response whose `content-type` includes
    `text/event-stream` (the retired SSE surface). The budget requires this list
    to be empty.

## Tests

### `the Host home (/) holds one /ws/state WS, no terminals WS, and zero SSE`

**What it proves:** The bare Host home — which attaches zero tmux servers,
subscribes only to metrics, and renders no live pane — opens exactly one
`/ws/state` WebSocket, no `/ws/terminals` socket, and no SSE.

**Steps:**
1. Install the counters, `goto('/')`.
2. Wait for the **Host health** region (readiness = the metrics subscription is
   live).
3. Poll until the state-socket count is `1`; assert the terminals-socket count
   is `0` and the `text/event-stream` response list is empty.

### `a tmux Server route (/$server) holds one /ws/state WS, no terminals WS, and zero SSE`

**What it proves:** A single-server route subscribes to one server over the one
state socket and renders static session-tile previews (not live terminals), so
it opens no `/ws/terminals` socket and no SSE.

**Steps:**
1. Install the counters, `goto('/${TMUX_SERVER}')`.
2. Wait for the **Connected** dot (the server subscription acked).
3. Poll state-socket count `=== 1`; assert terminals-socket count `=== 0` and no
   `text/event-stream` responses.

### `a Terminal route (/$server/$window) holds exactly 2 WS (state + terminals) and zero SSE`

**What it proves:** The terminal route keeps state on the one state socket while
its terminal I/O rides the one terminals mux socket — exactly two rk WebSockets
total, and no SSE.

**Steps:**
1. Resolve the session's first window id via `tmux list-windows`.
2. Install the counters, `goto('/${TMUX_SERVER}/${windowId}')`.
3. Wait for the **Connected** dot; poll state-socket count `=== 1` AND
   terminals-socket count `=== 1`; assert no `text/event-stream` responses.

### `a chat-lens route (/$server/$window?view=chat) holds AT MOST 2 WS and zero SSE`

**What it proves:** the chat lens — the last EventSource in the app before change
3 — now rides the state socket as a `kind:"chat"` subscription, so a `?view=chat`
route introduces **no** third WebSocket and **no** `text/event-stream`. The
guarded invariant is that the chat lens contributes neither an SSE nor a WS beyond
the fixed budget. (The plain e2e test window carries no `@rk_chat`, so
`resolveView` falls back to tty and the terminals socket stays; the guarded fact —
no SSE, at most 2 WS — holds either way, which is why the terminals count is
asserted `<= 1` rather than exactly 1.)

**Steps:**
1. Resolve the session's first window id via `tmux list-windows`.
2. Install the counters, `goto('/${TMUX_SERVER}/${windowId}?view=chat')`.
3. Wait for the **Connected** dot; poll state-socket count `=== 1`, assert
   terminals-socket count `<= 1`, and assert no `text/event-stream` responses.

### `a Board route (/board/$name) holds exactly 2 WS (state + terminals) and zero SSE`

**What it proves:** The board route — historically the pool-starvation hotspot,
because it attaches every contributing tmux server AND held one relay socket per
pane — now subscribes to all servers over the SINGLE state socket AND muxes
every pane's terminal I/O over the SINGLE terminals socket, so the total is
still exactly two rk WebSockets regardless of pane count, with zero SSE.

**Steps:**
1. Pin the session's first window to a fresh board via `POST /api/boards/{name}/pin`.
2. Install the counters, `goto('/board/${board}')`.
3. Wait for the **Connected** dot; poll state-socket count `=== 1` AND
   terminals-socket count `=== 1`; assert no `text/event-stream` responses.
4. Unpin the window (cleanup), in a `finally`.
