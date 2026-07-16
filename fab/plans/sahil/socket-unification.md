# Plan: Socket Unification — a fixed 2-WebSocket budget per tab

**Authored**: 2026-07-16
**Author**: discussion session with Claude (spikes run and verified same day)
**Executor**: change 1 interactively or via operator; changes 2–3 intended for fab-operator execution **from this plan**
**Status**: Plan only — change 1 intake drafted (`state-socket`), changes 2–3 intakes to be drafted from §Change 2 / §Change 3 below

## Goal

Collapse run-kit's per-tab connection usage from `panes + servers + 1 (+ chat)` long-lived
streams down to **two WebSockets per tab**, eliminating:

1. **h1 pool starvation on plaintext origins** — the browser's 6-per-origin HTTP/1.1
   connection pool, which SSE streams saturate today (a 5-server host holds all 6 slots
   from SSE alone: 5 session streams + 1 metrics stream).
2. **The Firefox/WebKit terminal-blocking failure** — on those engines a saturated pool
   blocks new WebSocket *handshakes* entirely, so 6 open SSEs mean no terminal can ever
   connect. This failure mode exists in production today for non-HTTPS access.

## Evidence (read these first)

| Source | What it establishes |
|--------|---------------------|
| `docs/findings/socket-pool-accounting.md` | SSE holds a pool slot in every engine (cap 6, 7th stalls); **established WS holds NO slot in any engine**; WS handshakes BLOCK behind a full pool on Firefox/WebKit; pool is shared across tabs (Chromium/WebKit). Consequence: converting streams to WS clears the pool; multi-tab WS usage is free. |
| `docs/findings/relay-mux-hol.md` | On a muxed terminal socket, a shared FIFO gives 1.66s interactive echo p50 under a co-stream flood at 1 Mbps; per-stream bounded queues + non-FIFO scheduler give 32ms at identical throughput. **Per-stream queues + scheduler are a v1 protocol requirement.** |

### Current stream inventory (verified 2026-07-16)

| Stream | Site | Count |
|--------|------|-------|
| Terminal relay WS `/relay/{windowId}` | `app/frontend/src/components/terminal-client.tsx:813` → `app/backend/api/relay.go` (`handleRelay`) | 1 per live pane |
| Session-state SSE `/api/sessions/stream?server=` | `app/frontend/src/contexts/session-context.tsx:573` → `app/backend/api/sse.go` (`handleSSE`, `sseHub`) | 1 per attached tmux server |
| Host-metrics SSE `/api/sessions/stream?metrics=1` | `session-context.tsx:879` | 1 per tab |
| Chat SSE `/api/windows/{id}/chat/stream` | `app/frontend/src/hooks/use-chat-stream.ts:59` → `app/backend/api/chat.go` | 1 per open chat lens |

## Target architecture

```
Browser tab
 ├── STATE socket    /ws/state      (change 1; chat joins in change 3)
 │     JSON text frames. Session-state per subscribed server, host metrics,
 │     global slots (version, update-available, server-order, board-order,
 │     status-refresh, services), previews, chat incrementals.
 │     In-band subscribe/ack+snapshot protocol.
 └── TERMINAL socket /ws/terminals  (change 2)
       Binary frames [u32 streamId][bytes] + JSON text control frames.
       All pane relays. Per-stream bounded queues + fair scheduler server-side.
```

Everything else stays request/response. Steady-state h1 pool usage ≈ 0 (transient
fetches and proxied-iframe traffic only). Old endpoints are **retired in the same
change that replaces them** — the frontend is the only consumer (personal tool, no API
compatibility contract).

## Protocol specifications

### State socket — `/ws/state`

Transport: WebSocket, JSON text frames both directions.
**Why WS and not one muxed SSE**: established WS exits the h1 pool entirely (spike 1),
and in-band subscribe messages are totally ordered with the event stream — eliminating
the POST-races-the-stream class this codebase has been burned by twice (preview-scope
`conn=` coupling; relay connect-select, see memory `relay-connect-select-alignment`).

Client → server ops:

```jsonc
{"op": "hello", "conn": "<client-generated id>"}          // once, first message
{"op": "subscribe", "kind": "server",  "key": "<tmux server name>", "req": 1}
{"op": "subscribe", "kind": "metrics", "req": 2}          // host metrics + services
{"op": "subscribe", "kind": "chat", "key": "<windowId>", "from": <byteOffset>, "req": 3}  // change 3
{"op": "unsubscribe", "kind": "...", "key": "..."}
{"op": "preview-scope", "server": "...", "expanded": ["<session>", ...]}   // decision D4
```

Server → client:

```jsonc
{"op": "ack", "req": 1, "snapshot": { /* same payload the SSE snapshot carries today */ }}
{"op": "event", "kind": "server", "key": "<server>", "type": "<today's SSE event name>", "data": { ... }}
{"op": "event", "kind": "global", "type": "version" | "update-available" | "server-order" | "board-order" | "status-refresh", "data": { ... }}
{"op": "gone", "kind": "server", "key": "<server>", "reason": "server-exited"}   // replaces stream-death-as-signal
{"op": "error", "req": N, "message": "..."}
```

Contract-preservation rule: **today's SSE event names and payloads move verbatim into
`type`/`data`** — the envelope changes, the payloads do not. The `sseHub` cached-slot
replay semantics map 1:1: cached global slots (`cachedVersionJSON`,
`cachedUpdateAvailableJSON`, `cachedServerOrderJSON`, `cachedBoardOrderJSON`,
`cachedMetricsJSON`, `cachedServicesJSON` — see `sse.go` `addClient`) are sent once
after `hello` as `kind: "global"` events; per-server snapshots ride the subscribe `ack`.
`status-refresh` stays broadcast-only (no replay).

Reconnect: client-side exponential backoff (1s → 15s cap), then `hello` + resubscribe
all active subscriptions; every subscription re-acks with a fresh snapshot. The
version/boot auto-reload guard (`shouldReloadOnVersion`) consumes the replayed
`version` global exactly as it consumes the SSE replay today — first-connect semantics
unchanged.

Connection-dot semantics: page dots derive from (socket connected) AND (relevant
subscription acked). `hostMetricsConnected` (3s disconnect debounce) keys on the
metrics subscription state instead of a dedicated EventSource.

### Terminal socket — `/ws/terminals`

Transport: one WebSocket per tab. Binary data frames `[u32 BE streamId][payload]` both
directions (output server→client, keystrokes client→server). JSON text frames for
control:

```jsonc
// client → server
{"op": "open", "id": 7, "server": "<tmux server>", "windowId": "@42", "cols": 120, "rows": 32}
{"op": "resize", "id": 7, "cols": 100, "rows": 40}
{"op": "close", "id": 7}
// server → client
{"op": "opened", "id": 7}
{"op": "closed", "id": 7, "code": 4004 | 4001 | 1000, "reason": "Window not found" | "Failed to attach to tmux session" | "closed"}
```

Per-stream server behavior preserves `handleRelay` exactly (`relay.go:49-208`): window-ID
validation via the shared decode helper, `ResolveWindowSession`, **session-scoped**
`SelectWindowInSession` (the group-ambiguity comment at `relay.go:88-99` still applies),
`forceTERM`, best-effort config reload, PTY attach at the open frame's initial size,
cleanup (cancel + ptmx close + process kill) on stream close. Today's WS close codes
4004/4001 become `closed` control events — the socket itself never closes for
stream-level failures.

**Write path (v1 requirement, per spike 2)**: per-stream bounded send queue (8 × 4096B)
+ single writer goroutine scheduling round-robin across ready streams, control frames
and short frames never queuing behind another stream's bulk output. A full queue pauses
that stream's PTY reader (backpressure into tmux's per-client buffering) — never drops
bytes (VT-state corruption). The existing relay's read loop (`buf 4096` at
`relay.go:173`) becomes the per-stream producer.

Frontend: a singleton `RelayMux` (one per tab) owning the socket, exposing
`openStream({server, windowId, cols, rows}) → handle {send, resize, close, onData, onClosed}`.
`TerminalClient` keeps its exact external behavior but consumes a stream handle:

- The **confirmation-gated window-switch** (change 260715-38kg) keys "first write" at
  socket `onmessage` today → becomes **first data frame for this stream id**. The gate
  state machine is pure; only the receipt source changes.
- The **connect-select alignment** race fix (epoch-tagged in-flight receipt, memory
  `relay-connect-select-alignment`) now anchors on the `open`→`opened` exchange, which
  is ordered in-band — verify the epoch logic simplifies rather than breaks.
- IntersectionObserver pane suspension = `close`/`open` stream ops (no socket churn) —
  this also fixes the board pane-resize suspension drop's cost (memory
  `board-pane-resize-suspension-drop`).
- Socket-level reconnect: `RelayMux` reconnects with backoff; each live
  `TerminalClient` re-issues `open` through its existing per-pane reconnect path
  (deferred per-connection reset already handles re-init).

## Change breakdown

### Change 1 — `state-socket` (intake drafted)

**Delivers the user-facing fix**: session SSEs are what starve the pool and block
Firefox/WebKit terminals.

Scope — backend:
- New `/ws/state` handler in `app/backend/api/` implementing the state-socket protocol
  above (gorilla/websocket, already a dependency).
- `sseHub` (`api/sse.go`) refactor: `sseClient` (single-server, channel of pre-rendered
  SSE bytes) → per-connection **subscription set** with per-subscription event routing.
  Producers (pollers, metrics collector, ports collector, PR-status join, preview
  capture, broadcast helpers) are unchanged — only the client-facing edge changes.
- Retire `GET /api/sessions/stream` + `handleSSE` in the same change (frontend is sole
  consumer). `POST /api/preview-scope` stays (D4).
- Dead-server reap becomes an in-band `gone` event (today: poll-set reap on fetch error,
  memory: SSE poll-set reap in `tmux-sessions`).

Scope — frontend:
- `session-context.tsx` (1258 lines): the per-server EventSource pool (`:538-812`) and
  the metrics EventSource effect (`:852+`) are replaced by one `StateSocket` client
  module (hello/subscribe/ack/resubscribe/backoff). The `attachServer` lazy-attach API
  and every `subscribe*` helper signature stay identical — consumers (`use-boards`,
  `use-window-pins`, etc.) already go through these seams and must not change.
- Connection-dot wiring per §Protocol.

Acceptance:
1. Board / terminal / server / host routes hold **zero EventSources and exactly one
   `/ws/state` WS** (plus relay WSs unchanged) — new e2e guard counting connections
   via Playwright's `page.on('websocket')` + a request-count assertion for
   `text/event-stream` (must be 0).
2. All existing SSE-event consumers work unmodified above the `subscribe*` seams;
   event payloads byte-identical inside the new envelope (hub unit tests assert this).
3. `multi-server-sidebar:70` passes deterministically under `just test-e2e` isolation —
   the attachServer→SSE race (memory `multi-server-group-expand-async-race`) is
   structurally fixed by subscribe/ack. **This long-standing flake is an explicit
   acceptance test.**
4. Version-bump auto-reload, update chip, server/board order live re-sort, previews,
   status-refresh spinner: covered by existing e2e; must stay green.
5. Full-page RefreshButton recovery affordance still recovers after `rk daemon restart`
   (socket reconnect + resubscribe path).

Non-goals: terminal relays (untouched), chat SSE (untouched until change 3),
SharedWorker, `/api/sessions/stream` deprecation shims.

### Change 2 — `relay-mux`

Scope — backend:
- New `/ws/terminals` handler: connection registry + per-stream `startStream` extracted
  from `handleRelay`'s guts (resolve → select → attach → pump), per-stream queues +
  scheduler per §Protocol (spike 2 requirement).
- Port the HOL harness assertion into a Go test: with stream A flooding through a paced
  writer, a stream B echo frame is written within a bounded number of frames (unit test
  on the scheduler, no real network needed).
- Retire `/relay/{windowId}` + `handleRelay` in the same change.

Scope — frontend:
- `RelayMux` singleton module + `TerminalClient` port per §Protocol (the four delicate
  seams: confirmation gate receipt source, select-alignment epoch, suspension
  open/close, per-stream reset). `terminal-client.tsx:813` is the only socket-creation
  site to replace.

Acceptance:
1. A board with N panes holds exactly **2 WebSockets total** (state + terminals) — e2e
   connection guard updated.
2. Full window-switch-transition e2e suite green (confirmation gate, bounce-back,
   grace mask). Note: `window-heading` history-arrows flake is pre-existing on main
   (memory `window-heading-history-arrows-flaky-main`) — do not attribute.
3. Scheduler Go test (above) green; relay behaviors (4004 on bad window, initial-size
   attach, TERM forcing) re-asserted in `relay_test.go` equivalents.
4. Manual/e2e: two panes on one board, one running `yes`, typing latency in the other
   stays interactive (the spike's scenario, in vivo).

Dependency: none hard on change 1 (different seams, can run in a parallel worktree),
but sequence it after — change 1 carries the urgent fix and merging order keeps the
e2e connection-guard evolution linear (guard tightens 1→2).

### Change 3 — `chat-on-state-socket`

Scope:
- Chat incremental events become `kind: "chat"` subscriptions on the state socket
  (subscribe on chat-lens enter, unsubscribe on leave). The per-view SSE
  (`GET /api/windows/{id}/chat/stream`, `use-chat-stream.ts`) is retired.
- **Backfill demoted to the existing `GET /api/windows/{id}/chat`** (fetch on lens
  enter), so big transcripts never head-of-line-block state events. The subscribe op
  carries `from: <byteOffset>` (the JSONL adapter is already byte-offset-tailed — see
  memory `chat` § read side); the ack returns the current offset so fetch+subscribe
  compose without gaps or duplicates.
- The stream's provider-rotation re-resolve (~2s) and lazy-transcript not-yet tolerance
  move into the chat subscription's server-side producer unchanged.
- Chat-mode connection dot = chat subscription state (socket + acked).

Acceptance:
1. Chat lens holds zero EventSources; **any route holds ≤ 2 WS + 0 SSE** (final
   connection-guard form).
2. Chat e2e specs green: backfill renders, incremental events append, pending bubble,
   send path (POST, untouched), provider rotation tolerance.
3. No gap/duplicate at the fetch→subscribe seam (unit test the offset composition).

Dependency: **requires change 1** (protocol + hub subscription machinery). Small
enough for one review pass.

## Execution model (operator handoff for changes 2–3)

1. Change 1 (`state-socket`): intake exists (drafted via `/fab-draft` alongside this
   plan). Execute via `/fab-switch state-socket && /fab-proceed`, interactively or
   operator-dispatched.
2. After change 1 reaches review-pr DONE: draft intakes for `relay-mux` and
   `chat-on-state-socket` **from this plan** — each intake's Requirements/Decisions
   sections should be lifted from §Change 2 / §Change 3 plus §Protocol specifications
   (they are written to be liftable). Evidence links: both findings docs + this plan.
3. Operator queue: `fab operator autopilot start relay-mux chat-on-state-socket` —
   implicit chaining gives `chat-on-state-socket.depends_on = [relay-mux]`, which is
   stricter than required (chat needs only change 1) but keeps the e2e
   connection-guard evolution conflict-free, since both changes edit the same guard
   spec.
4. Auto-answer policy: standard (Confident → default; Tentative/Unresolved → halt).
   Decisions D1–D6 below are **made** — agents should not re-open them.

## Decisions (made in this plan; do not relitigate in intakes)

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | State socket is a **WebSocket**, not a muxed SSE | Exits the h1 pool (spike 1); in-band subscribe kills the POST-vs-stream race class |
| D2 | Old endpoints retired in the same change that replaces them | Sole consumer is our frontend; constitution IV (minimal surface) |
| D3 | Terminal mux ships with per-stream queues + fair scheduler in v1 | Spike 2: shared FIFO = 1.66s typing latency under flood; fairness costs zero throughput |
| D4 | `POST /api/preview-scope` stays in change 1 (conn-id maps to the WS `hello` conn); optional in-band migration later | Keeps change 1 focused; preview-scope race is not an observed pain today |
| D5 | Chat backfill via GET + offset-composed subscribe (not snapshot-in-ack) | Bounded event sizes on the shared socket; adapter is already byte-offset-tailed |
| D6 | 2 sockets (terminals separate from state), not 1 | Bulk binary output must not share a send buffer/scheduler with state events (user requirement + spike 2) |

## Risk register

| # | Risk | Mitigation |
|---|------|------------|
| 1 | Hub refactor regresses an SSE contract consumed by one of the many frontend surfaces | Envelope-only rule (payloads byte-identical) + hub unit tests asserting payload equality + existing e2e breadth |
| 2 | Confirmation-gate port breaks window-switch UX subtly | Gate module is pure — swap only the receipt source; window-switch-transition e2e suite is the guard |
| 3 | tmux behavior when a stream's PTY reader pauses (backpressure) differs from a stalled TCP socket | It is the same mechanism (unread PTY), tmux buffers per client; verify manually with a flooding pane (change 2 acceptance 4) |
| 4 | Reconnect storms: one socket drop now drops everything | Backoff + resubscribe-all is simpler than today's N independent reconnect paths; RefreshButton remains the manual recovery affordance |
| 5 | e2e specs asserting transport internals (EventSource counts, relay URLs) churn | Each change updates specs + `.spec.md` companions in the same commit (constitution: Test Companion Docs) |
| 6 | Vite dev origin quirks (HMR WS shares origin) confuse the connection guard | Guard counts only rk endpoints (`/ws/state`, `/ws/terminals`, `text/event-stream` responses) |
| 7 | Playwright's bundled engines mask a real-Safari difference in pool behavior | Findings doc carries the caveat; the design doesn't depend on engine specifics (fewer connections is strictly better everywhere) |

## Out of scope (explicit)

- SharedWorker socket ownership (unnecessary for pool reasons — established WS are
  pool-exempt in every engine; revisit only if server-side per-tab attach cost hurts).
- ws-over-h2 (RFC 8441), TLS termination, HTTPS setup changes.
- Proxied-iframe (`/proxy/{port}/`) pool consumption — inherent, documented residual.
- Merging the two WebSockets into one (D6).
- Any change to the chat send path (`POST .../chat/send`) or Web Push.
