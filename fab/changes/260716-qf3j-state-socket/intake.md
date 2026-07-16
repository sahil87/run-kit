# Intake: State Socket — mux session-state + host-metrics SSE into one WebSocket

**Change**: 260716-qf3j-state-socket
**Created**: 2026-07-16

## Origin

Conversational (`/fab-discuss` session, 2026-07-16). The user's driving concern:

> Right now, the number of socket connections a non https client connection can make to
> the run-kit server (a max of 6) is a serious limit. I want to discuss unification of
> all streams in a "multiplexed" stream.

The discussion produced a three-change master plan — **read
`fab/plans/sahil/socket-unification.md` first**; this change is its Change 1. Two spikes
were run and verified during the session:

- `docs/findings/socket-pool-accounting.md` — per-engine h1 pool accounting (the evidence
  for this change).
- `docs/findings/relay-mux-hol.md` — HOL blocking on a muxed terminal socket (evidence
  for Change 2, `relay-mux`; not this change).

Key user decisions from the discussion: fixed socket budget with terminals kept on their
own socket ("I just want to keep Terminals separate — as that's the max load"); state +
metrics muxed together; chat may join the state socket later (Change 3). The plan's
Decisions table (D1–D6) records the settled choices — **do not relitigate them**.

## Why

1. **The pain**: every attached tmux server costs one EventSource
   (`session-context.tsx:573`) plus one host-metrics EventSource (`:879`). SSE holds an
   h1 pool slot in **every** browser engine and the pool caps at 6 per origin (spike 1,
   unanimous across Chromium 147 / Firefox 148 / WebKit 26.4). A 5-server host holds all
   6 slots from SSE alone on plaintext origins.
2. **The consequence if unfixed**: on Firefox and WebKit, a saturated pool **blocks new
   WebSocket handshakes entirely** — 6 open SSEs mean no terminal relay can ever connect
   (spike 1, case C). On Chromium, fetches starve instead (case A). The pool is shared
   across tabs (case D), so a second tab makes it worse. This failure mode exists in
   production today for any non-HTTPS access path.
3. **Why this approach**: an established WebSocket holds NO pool slot in any engine
   (spike 1, cases B/E) — moving state streams onto one WS drops steady-state pool usage
   to ~zero and is immune to multi-tab aggregation. A muxed *SSE* would still hold one
   slot and would need out-of-band POSTs for subscription changes — reintroducing the
   POST-races-the-stream class this codebase has hit twice (memory:
   `relay-connect-select-alignment`; the preview-scope `conn=` coupling). In-band
   subscribe messages are totally ordered with the events they gate, which also
   structurally fixes the long-standing `attachServer`→SSE race (memory:
   `multi-server-group-expand-async-race`).

## What Changes

### Backend — new `/ws/state` endpoint (gorilla/websocket, already a dependency)

New handler in `app/backend/api/` implementing the state-socket protocol. JSON text
frames both directions.

Client → server ops:

```jsonc
{"op": "hello", "conn": "<client-generated id>"}          // once, first message
{"op": "subscribe", "kind": "server",  "key": "<tmux server name>", "req": 1}
{"op": "subscribe", "kind": "metrics", "req": 2}          // host metrics + services
{"op": "unsubscribe", "kind": "...", "key": "..."}
```

Server → client:

```jsonc
{"op": "ack", "req": 1, "snapshot": { /* the same payload today's SSE snapshot carries */ }}
{"op": "event", "kind": "server", "key": "<server>", "type": "<today's SSE event name>", "data": { ... }}
{"op": "event", "kind": "global", "type": "version" | "update-available" | "server-order" | "board-order" | "status-refresh" | "metrics" | "services", "data": { ... }}
{"op": "gone", "kind": "server", "key": "<server>", "reason": "server-exited"}
{"op": "error", "req": N, "message": "..."}
```

**Contract-preservation rule (load-bearing)**: today's SSE event names and payloads move
**verbatim** into `type`/`data` — the envelope changes, payloads do not. Frontend
consumers above the `subscribe*` seams must not need changes.

### Backend — `sseHub` refactor (`app/backend/api/sse.go`, 1474 lines)

- `sseClient` (single-server, channel of pre-rendered SSE byte frames) becomes a
  per-connection **subscription set** with per-subscription event routing.
- Producers are unchanged: pollers, metrics collector, ports collector, PR-status join,
  preview capture, and all `broadcast*` helpers keep their signatures — only the
  client-facing edge changes.
- Cached-slot replay maps 1:1: the global cached slots (`cachedVersionJSON`,
  `cachedUpdateAvailableJSON`, `cachedServerOrderJSON`, `cachedBoardOrderJSON`,
  `cachedMetricsJSON`, `cachedServicesJSON` — see `addClient` in `sse.go`) are sent once
  after `hello` as `kind:"global"` events; per-server snapshots ride the subscribe `ack`.
  `status-refresh` stays broadcast-only (no cached slot, no replay).
- Dead-server handling: today a dead server is reaped from the poll set on fetch error
  (memory: `tmux-sessions` § SSE poll-set reap); that reap now also emits the in-band
  `gone` event to subscribed connections.
- **Retire `GET /api/sessions/stream` + `handleSSE` + the SSE route in `router.go:539`
  in this same change** (decision D2 — the frontend is the sole consumer; constitution
  IV minimal surface). `POST /api/preview-scope` **stays**; its `conn=` id maps to the
  WS `hello` conn id via the same `normalizeConnID` semantics (decision D4).

### Frontend — `session-context.tsx` transport swap

- Replace the per-server EventSource pool (`session-context.tsx:538-812`) and the
  host-metrics EventSource effect (`:852+`) with one `StateSocket` client module
  owning: hello, subscribe/ack, resubscribe-on-reconnect, exponential backoff (1s → 15s
  cap).
- **The `attachServer` lazy-attach API and every `subscribe*` helper keep their exact
  signatures** — consumers (`use-boards.ts`, `use-window-pins.ts`, board/host pages,
  update-notification, etc.) already route through these seams and must not change.
- Version/boot auto-reload guard (`shouldReloadOnVersion`) consumes the replayed
  `version` global event exactly as it consumes the SSE replay today; first-connect
  semantics unchanged (never reload on first connect; boot-reload suppressed on dev).
- Connection-dot semantics: page dots = (socket connected) AND (relevant subscription
  acked). `hostMetricsConnected` (3s disconnect debounce, per-server fan-out fallback)
  keys on the metrics subscription state instead of a dedicated EventSource.

### Tests

- Hub unit tests asserting payload byte-equality between the old SSE rendering and the
  new envelope's `data` for each event type.
- New e2e connection-budget guard: board / terminal / server / host routes hold **zero
  EventSources and exactly one `/ws/state` WS** (relay WSs unchanged in this change).
  Count via Playwright `page.on('websocket')` + assert zero `text/event-stream`
  responses. Guard counts only rk endpoints (Vite HMR WS excluded).
- `multi-server-sidebar:70` must pass deterministically under `just test-e2e` isolation —
  the subscribe/ack protocol structurally fixes the attachServer→SSE race. **This
  long-standing flake is an explicit acceptance test for this change.**
- Playwright specs asserting EventSource internals are updated with their `.spec.md`
  companions in the same commit (constitution: Test Companion Docs).

## Affected Memory

- `run-kit/architecture`: (modify) SSE hub → state-socket protocol; endpoint inventory
  (retire `/api/sessions/stream`, add `/ws/state`); cached-slot replay → hello/global +
  ack/snapshot semantics
- `run-kit/ui-patterns`: (modify) connection-dot semantics (socket + subscription state);
  SSE-reconnect reload guard now fed by the state socket
- `run-kit/tmux-sessions`: (modify) SSE poll-set reap on dead-server fetch error now also
  emits the in-band `gone` event

## Impact

- `app/backend/api/sse.go` (major refactor), `app/backend/api/router.go` (route swap),
  new `app/backend/api/state_ws.go` (or similar), `sse_test.go` reworked.
- `app/frontend/src/contexts/session-context.tsx` (1258 lines — the EventSource pool and
  metrics effect are the change's frontend core), new `src/lib/state-socket.ts` (or
  similar).
- Consumers above `subscribe*` seams: no changes expected (acceptance criterion).
- Chat SSE (`use-chat-stream.ts`, `GET /api/windows/{id}/chat/stream`) and terminal
  relays (`/relay/{windowId}`): **untouched** (Changes 3 and 2 respectively).
- e2e: new connection-guard spec + updates to any spec touching stream internals.

## Open Questions

None — the design was settled in the discussion session and the master plan (D1–D6);
spike evidence closed the empirical unknowns.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Two-socket architecture with terminals on their own socket; this change touches only state+metrics streams | User stated explicitly in discussion ("keep Terminals separate — that's the max load"); phasing is the user's own | S:95 R:90 A:90 D:95 |
| 2 | Certain | State socket transport is WebSocket, not a muxed SSE (plan D1) | Spike 1: established WS exits the h1 pool in every engine; in-band subscribe kills the POST-vs-stream race class; discussed and ratified | S:90 R:60 A:90 D:90 |
| 3 | Certain | SSE event names/payloads move verbatim into the envelope; `subscribe*`/`attachServer` seams keep exact signatures | Codebase gives a clear answer (consumers already isolated behind seams); minimizes regression surface | S:80 R:85 A:90 D:90 |
| 4 | Certain | `multi-server-sidebar:70` deterministic pass is an acceptance criterion | Known UNFIXED race (memory), root cause is exactly the implicit-subscription gap this protocol closes | S:85 R:90 A:85 D:85 |
| 5 | Certain | Reconnect: client backoff 1s→15s cap, hello + resubscribe-all, fresh snapshot per ack | Obvious default, trivially tunable later; snapshot-on-ack is the protocol's own idiom | S:60 R:95 A:85 D:80 |
| 6 | Certain | Route path `/ws/state`; global-slot replay once after `hello` | Naming/mechanics with one obvious shape, trivially changed pre-merge | S:60 R:95 A:90 D:85 |
| 7 | Confident | Retire `GET /api/sessions/stream` + `handleSSE` in this same change, no deprecation shim (plan D2) | Constitution IV (minimal surface); frontend is sole consumer; handler is one `git revert` away if an external consumer surfaces | S:70 R:85 A:80 D:75 |
| 8 | Confident | `POST /api/preview-scope` stays; `conn=` maps to WS hello conn id (plan D4) | Keeps change focused; preview-scope race is not an observed pain; in-band migration remains open as follow-up | S:70 R:90 A:75 D:70 |
| 9 | Confident | Connection dots = socket-connected AND subscription-acked; `hostMetricsConnected` keys on metrics subscription with existing 3s debounce | Follows the dot-everywhere vocabulary (memory: ui-patterns); exact mapping is implementation detail, easily adjusted | S:75 R:85 A:80 D:75 |
| 10 | Confident | Change type = refactor (transport swap preserving event contracts) | Primary motivation fixes a failure mode, but contract-wise this restructures plumbing; pinned explicitly to survive refresh re-inference (memory: `fab-change-type-refresh-flip`) | S:50 R:95 A:70 D:60 |

10 assumptions (6 certain, 4 confident, 0 tentative, 0 unresolved).
