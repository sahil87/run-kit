# Plan: State Socket — mux session-state + host-metrics SSE into one WebSocket

**Change**: 260716-qf3j-state-socket
**Intake**: `intake.md`

## Requirements

### Backend: `/ws/state` endpoint

#### R1: State-socket handler and protocol
The backend SHALL expose a WebSocket endpoint `GET /ws/state` (gorilla/websocket, `serverFromRequest`-agnostic — the socket carries no `?server=`) that speaks the JSON-text envelope protocol: client `hello`/`subscribe`/`unsubscribe`/`preview-scope` ops; server `ack`/`event`/`gone`/`error` frames.

- **GIVEN** a browser opens `/ws/state`
- **WHEN** it sends `{"op":"hello","conn":"<id>"}` as the first frame
- **THEN** the server replays the cached global slots (`version`, `update-available`, `server-order`, `board-order`, `metrics`, `services`) once as `{"op":"event","kind":"global","type":"<name>","data":{...}}` frames
- **AND** the conn id is normalized via the same `normalizeConnID` semantics as the retired SSE `conn=` param

#### R2: Per-server subscribe/ack with snapshot
On `{"op":"subscribe","kind":"server","key":"<server>","req":N}` the server SHALL register the connection for that server's events, ensure the server is in the poll set, and reply `{"op":"ack","req":N,"snapshot":{...}}` carrying the current sessions snapshot (the same payload the SSE `event: sessions` carried), plus replay the per-server cached session-order as a scoped event.

- **GIVEN** an acked `hello`
- **WHEN** the client subscribes to `kind:"server"` for a live server
- **THEN** the server enters the poll set (poll goroutine respawns if idle) and an `ack` with the sessions snapshot returns
- **AND** subsequent `event: sessions`/`session-order`/`preview`/`board-changed` for that server route to this connection as `{"op":"event","kind":"server","key":"<server>","type":"<today's name>","data":<verbatim payload>}`

#### R3: Metrics subscription
On `{"op":"subscribe","kind":"metrics","req":N}` the connection SHALL receive the server-independent `metrics` + `services` broadcasts (and the global slots on connect via hello). This replaces the `?metrics=1` server-neutral SSE stream. The `ack` carries the latest cached metrics snapshot when available.

- **GIVEN** an acked `hello`
- **WHEN** the client subscribes to `kind:"metrics"`
- **THEN** it receives ongoing `kind:"global"` `metrics`/`services` events at the poll cadence with zero attached tmux servers
- **AND** the poll loop keeps ticking at the fast cadence for a metrics-only connection (host-health freshness on `/`)

#### R4: In-band unsubscribe and preview-scope
The server SHALL honor `{"op":"unsubscribe","kind":"...","key":"..."}` (drops the subscription; a server with no remaining subscribers leaves the poll set on the next idle tick) and `{"op":"preview-scope","server":"...","expanded":[...]}` (sets the connection's expanded set, identical to the retired `POST /api/preview-scope` body but addressed by the socket's own conn identity — decision D4 keeps the HTTP endpoint too).

- **GIVEN** a connection subscribed to a server
- **WHEN** it sends `preview-scope` with an expanded set
- **THEN** the backend captures previews only for those windows and emits the cached subset immediately (same behavior as `setPreviewScope`)
- **AND** `POST /api/preview-scope` continues to resolve the same connection by conn id

#### R5: Dead-server `gone` event
When a subscribed server's tmux socket is gone (`tmux.IsServerGone` on `FetchSessions`), the hub SHALL emit `{"op":"gone","kind":"server","key":"<server>","reason":"server-exited"}` to that server's subscribed connections and reap it from the poll set + all per-server maps, replacing the SSE `event: server-gone`.

- **GIVEN** a connection subscribed to a server that then dies
- **WHEN** the poll loop's fetch returns an `IsServerGone` error
- **THEN** subscribed connections receive one `gone` frame and the server is dropped from every per-server map
- **AND** a later re-subscribe re-registers it cleanly

### Backend: hub refactor (`api/sse.go`)

#### R6: Per-connection subscription set replaces single-server client
`sseClient` (single `server`, channel of pre-rendered SSE bytes) SHALL be generalized so the client-facing edge routes events by subscription rather than by a single server key, while every producer (`poll`, metrics/services/ports collectors, PR-status join, preview capture, and all `broadcast*`/`setVersion`/`setPreviewScope` helpers) keeps its exact signature. Event payloads (the JSON `data`) SHALL be byte-identical to today's SSE frame bodies.

- **GIVEN** the existing producers
- **WHEN** they broadcast an event
- **THEN** the JSON payload delivered inside the new envelope's `data` is byte-for-byte the same as the SSE frame's `data:` body
- **AND** no producer signature changes

#### R7: Contract-preservation — event names verbatim
Every SSE event name in use today (`sessions`, `session-order`, `metrics`, `services`, `server-order`, `board-order`, `version`, `update-available`, `status-refresh`, `preview`, `board-changed`) SHALL move verbatim into the envelope's `type`. Per-server events carry `kind:"server"` + `key`; host-global events carry `kind:"global"`.

- **GIVEN** the frontend's event handlers
- **WHEN** an event of each type arrives over the socket
- **THEN** the `type` string matches today's SSE event name exactly

### Backend: route retirement (`api/router.go`)

#### R8: Retire `GET /api/sessions/stream` + `handleSSE`
The SSE route, the `handleSSE` handler, and the `handleSSE`-only helpers (the metrics-only-sentinel routing branch inside the HTTP handler) SHALL be removed in this same change (decision D2). `POST /api/preview-scope` SHALL remain. `/ws/state` SHALL be registered next to `/relay/{windowId}`.

- **GIVEN** the router
- **WHEN** it is built
- **THEN** there is no `/api/sessions/stream` route and there is a `/ws/state` route
- **AND** `POST /api/preview-scope` is still registered

### Frontend: `StateSocket` client module

#### R9: Single state socket per tab
A new `src/lib/state-socket.ts` module SHALL own one WebSocket to `/ws/state`, sending `hello` on open (with a client-generated conn id), tracking subscriptions, resubscribing all active subscriptions on reconnect, and exponential backoff (1s → 15s cap). It exposes subscribe/unsubscribe for `server` and `metrics` kinds, an event dispatch by (kind, type, key), and a preview-scope send.

- **GIVEN** a tab
- **WHEN** the provider mounts and attaches servers
- **THEN** exactly one `/ws/state` WebSocket is open regardless of how many servers are attached
- **AND** on socket drop it reconnects with backoff and re-sends hello + all active subscribes, each re-acked with a fresh snapshot

#### R10: `session-context.tsx` transport swap preserving seams
`session-context.tsx` SHALL replace the per-server EventSource pool (`:538-831`) and the dedicated host-metrics EventSource effect (`:852+`) with the `StateSocket` client. `attachServer` and every `subscribe*` helper (`subscribeBoardChange`, `subscribeBoardOrder`, `subscribeStatusRefresh`) SHALL keep their exact signatures. The version/boot reload guard (`shouldReloadOnVersion`), update-available/dismiss, server-order/board-order re-sort, previews, and `setPreviewScope` SHALL behave identically. `hostMetricsConnected` SHALL derive from (socket connected AND metrics subscription acked) with the existing 3s disconnect debounce.

- **GIVEN** existing consumers above the seams (`use-boards`, `use-window-pins`, board/host pages, update-notification)
- **WHEN** the transport swaps to the socket
- **THEN** none of them require changes
- **AND** `attachServer(name)` subscribes to that server (a metrics subscription is opened when no server is attached — the `/` host case)

#### R11: Connection-dot semantics
Page connection dots SHALL derive from (socket connected) AND (relevant subscription acked): the current server's `isConnected` becomes true when its server subscription has acked; `hostMetricsConnected` keys on the metrics subscription (dedicated when no server is attached, or per-server metrics fan-out when a server subscription is present) with the 3s debounce.

- **GIVEN** the top-bar connection dot on a server route
- **WHEN** the socket is connected and the current server's subscription has acked
- **THEN** the dot reads Connected

### Tests

#### R12: Hub payload byte-equality unit tests
The hub tests SHALL assert that each event type's `data` payload delivered over the new envelope is byte-identical to the payload the old SSE rendering produced, for `sessions`, `session-order`, `metrics`, `services`, `server-order`, `board-order`, `version`, `update-available`, `status-refresh`, `preview`, `board-changed`, plus the `ack` snapshot and `gone` frame.

- **GIVEN** the hub with stub producers
- **WHEN** an event of each type is broadcast to a subscribed state-socket connection
- **THEN** the JSON `data` matches the expected payload exactly

#### R13: Connection-budget e2e guard
A new e2e spec SHALL assert that board / terminal / server / host routes hold zero EventSources and exactly one `/ws/state` WebSocket (relay WSs unchanged), counting via `page.on('websocket')` and asserting zero `text/event-stream` responses (rk endpoints only; Vite HMR WS excluded). A sibling `.spec.md` companion SHALL be authored.

- **GIVEN** each of the four route types against the real backend
- **WHEN** the page loads and settles
- **THEN** exactly one `/ws/state` WS is observed and zero `text/event-stream` responses are seen

#### R14: `multi-server-sidebar:70` deterministic pass
`multi-server-sidebar` (the second test, expanding a non-current server group and navigating) SHALL pass deterministically under `just test-e2e` isolation — the subscribe/ack protocol structurally fixes the attachServer→SSE race.

- **GIVEN** two real tmux servers under `just test-e2e`
- **WHEN** the second server's group is expanded and its session clicked
- **THEN** the row surfaces and navigation succeeds without flake

#### R15: Existing stream-mocking specs migrated to the WS protocol
Every e2e spec that mocks `GET /api/sessions/stream` via `page.route(...text/event-stream...)` and its unit test that stubs `EventSource` SHALL be migrated to mock `/ws/state` (a shared Playwright `routeWebSocket` helper answering hello→global-replay and subscribe→ack, and a `MockWebSocket` in the unit test). Each touched `.spec.ts` SHALL update its `.spec.md` companion in the same commit (constitution: Test Companion Docs).

- **GIVEN** the migrated specs
- **WHEN** the suite runs
- **THEN** they exercise the socket protocol and remain green
- **AND** every touched `.spec.ts` has an updated `.spec.md`

### Non-Goals

- Terminal relays (`/relay/{windowId}`, `handleRelay`) — untouched (change 2, `relay-mux`).
- Chat SSE (`use-chat-stream.ts`, `GET /api/windows/{id}/chat/stream`) — untouched (change 3).
- SharedWorker socket ownership; `/api/sessions/stream` deprecation shims; ws-over-h2/HTTPS changes.
- In-band migration of `POST /api/preview-scope` — the HTTP endpoint stays (D4).

### Design Decisions

1. **State socket is a WebSocket, not a muxed SSE** (plan D1) — *Why*: an established WS exits the browser's h1 pool in every engine (spike 1), and in-band subscribe messages are totally ordered with the event stream, structurally killing the POST-vs-stream race class and the attachServer→SSE race. *Rejected*: muxed SSE (still holds one pool slot, needs out-of-band subscribe POSTs).
2. **Generalize the client edge, keep producers frozen** — *Why*: R1's contract-preservation rule minimizes regression surface; the entire producer/collector/broadcast machinery is proven, so only `sseClient` and the client-facing send/route path change. *Rejected*: rewriting the hub wholesale.
3. **Envelope-only payloads (byte-identical `data`)** — *Why*: frontend consumers above the `subscribe*` seams must not change; byte-equality is unit-testable. *Rejected*: reshaping payloads while moving them.
4. **Retire the SSE route in the same change** (plan D2) — *Why*: constitution IV (minimal surface); the frontend is the sole consumer; one `git revert` recovers it. *Rejected*: a deprecation shim.
5. **Preview-scope stays HTTP + gains an in-band twin** (plan D4) — *Why*: keeps the change focused; the socket's own `preview-scope` op maps the conn id via the same `normalizeConnID`, and the HTTP endpoint remains for zero-regression. *Rejected*: retiring the HTTP endpoint now.
6. **Metrics-only connection = a `metrics` subscription at the protocol edge; the `metricsOnlyServer` sentinel survives as the hub's internal registry key** — *Why*: the wire protocol exposes `subscribe kind:"metrics"`, but routing it under the existing sentinel key internally leaves `safetyIntervalEffective` and all poll logic untouched (minimal-diff; behavior verified by A-003). Only the sentinel's HTTP-routing branch (`?metrics=1`) was retired. *Rejected*: reworking `safetyIntervalEffective` onto a subscription flag (equivalent behavior, larger diff). <!-- amended in rework cycle 1 to record the implemented shape -->


## Tasks

### Phase 1: Backend protocol + hub edge

- [x] T001 Add the state-socket envelope types and protocol constants in a new `app/backend/api/state_ws.go` — client ops (`hello`/`subscribe`/`unsubscribe`/`preview-scope`), server frames (`ack`/`event`/`gone`/`error`), `kind` constants (`server`/`metrics`/`global`), and the verbatim event-type name constants reused from today's SSE names. <!-- R1 R7 -->
- [x] T002 Generalize `sseClient` in `app/backend/api/sse.go` into a per-connection subscription-set client (subscriptions: set of server keys + a metrics flag; keep `connID`/`expanded`; keep the `ch chan []byte` send channel but carry envelope-JSON frames), preserving every producer/broadcast signature. Add a subscription registry to `sseHub` keyed for both per-server routing and global fan-out. <!-- R6 -->
- [x] T003 Route producer output through the envelope: per-server events (`sessions`/`session-order`/`preview`/`board-changed`) render as `{"op":"event","kind":"server","key":...,"type":...,"data":...}`; host-global events (`metrics`/`services`/`server-order`/`board-order`/`version`/`update-available`/`status-refresh`) as `{"op":"event","kind":"global",...}`. Keep the SSE-frame renderers only where still needed; add envelope renderers with byte-identical `data`. <!-- R6 R7 -->

### Phase 2: Backend handler + wiring

- [x] T004 Implement `handleStateWS` in `app/backend/api/state_ws.go`: upgrade via the shared `upgrader`, read the first `hello` (normalize conn id), replay cached global slots, then a read loop dispatching `subscribe`/`unsubscribe`/`preview-scope`; a per-connection writer pump drains `client.ch` to the socket (JSON text frames); on subscribe register + poll-set join + `ack` with the fresh snapshot; on server subscribe also replay the per-server cached session-order. <!-- R1 R2 R3 R4 --> <!-- rework DONE (cycle 1): (1) MUST-FIX security — stateSubscribe/stateUnsubscribe (sse.go) now call validate.ValidateServerName on msg.Key for kindServer, and the in-band preview-scope op (state_ws.go) validates msg.Server; invalid names are rejected via a new hub.emitError() sending an `error` frame carrying req (routed through the send channel so only the writer pump writes). Unknown kinds now also error rather than silently drop. Tests: TestStateWS_SubscribeRejectsInvalidServerKey / _UnsubscribeRejectsInvalidServerKey / _SubscribeRejectsUnknownKind / _PreviewScopeRejectsInvalidServer. (2) SHOULD-FIX — writer pump's WriteMessage-error path now sets a short read deadline (stateWSCleanupWait=100ms) after cancel(), mirroring relay.go, so the read loop's conn.ReadMessage() returns promptly and runs dropStateConn cleanup instead of leaking until TCP teardown. --> <!-- rework (cycle 2): SHOULD-FIX — ack-snapshot staleness race in stateSubscribe (sse.go:509-577): the snapshot is read under an EARLIER h.mu acquisition than the ack enqueue (read → unlock → addClient → re-lock → enqueue ack); a poll tick interleaving in either gap can enqueue a NEWER `sessions` event BEFORE the stale-snapshot ack, and the client applies the ack unconditionally last, then previousJSON dedup suppresses re-emission — stale sessions UI persists indefinitely on a quiet server. Fix: read the snapshot inside the same critical section that enqueues the ack, guaranteeing ack ≥ every previously enqueued event. Add a test if feasible (interleave a broadcast between subscribe registration and ack). --> <!-- rework DONE (cycle 2): SHOULD-FIX FIXED — stateSubscribe (sse.go) now reads the snapshot (previousJSON[key] / cachedMetricsJSON) INSIDE the same h.mu critical section that enqueues the ack, after addClient has registered the routing record. The ack's snapshot is now ≥ every sessions/metrics frame already on the channel (a concurrent poll tick either ran before this lock — read sees its value — or after the ack, where the client's newest-wins apply is correct). New deterministic test TestStateWS_SubscribeAckNotStaleUnderPollInterleave (state_ws_test.go): disables the real poll goroutine (h.polling=true) so a writer goroutine is the sole monotonic previousJSON mutator, races it against stateSubscribe over 400 iterations, and asserts the ack's snapshot tick is never < any preceding sessions-frame tick. Proven to FAIL against the pre-fix earlier-read shape (STALE ack: snapshot tick 2 < sessions tick 3) and PASS with the fix (also clean under -race). -->
- [x] T005 Implement the poll-set membership + metrics-only cadence on the new subscription model: a server enters the poll set on first server-subscription and leaves when it has no subscribers; the fast-cadence metrics behavior (`safetyIntervalEffective`) keeps keying on the `metricsOnlyServer` sentinel, under which metrics subscriptions are registered internally (Design Decision 6, amended). Emit the `gone` frame + full per-server-map reap on `IsServerGone`. <!-- R2 R3 R5 -->
- [x] T006 Register `GET /ws/state` in `app/backend/api/router.go` next to `/relay/{windowId}`; remove `r.Get("/api/sessions/stream", s.handleSSE)`, delete `handleSSE` and the `metricsOnlyServer`-routing branch it owned; keep `POST /api/preview-scope`. Keep `initSSEHub`/hub wiring (`SetVersion`, subscriber, broadcasts) intact. <!-- R8 -->
- [x] T007 Wire `preview-scope` in-band op to the existing `setPreviewScope(server, connID, expanded)` using the connection's own conn id, and keep `POST /api/preview-scope` (`api/preview.go`) resolving the same connection. <!-- R4 -->

### Phase 3: Frontend transport

- [x] T008 Create `app/frontend/src/lib/state-socket.ts`: a `StateSocket` class owning one `/ws/state` WebSocket — open→hello (conn id via `crypto.randomUUID()`), `subscribeServer(name)`/`subscribeMetrics()`/`unsubscribe(...)` (idempotent, ref-counted), an `onEvent((kind,type,key,data)=>void)` dispatch, `onAck`/`onGone`/`onConnState` callbacks, `sendPreviewScope(server, expanded)`, resubscribe-all on reconnect, exponential backoff 1s→15s cap. Pure/testable (injectable WebSocket factory). <!-- R9 -->
- [x] T009 Swap `session-context.tsx` onto `StateSocket`: replace the EventSource pool effect and the dedicated host-metrics effect with a single socket owned in a ref; drive `attachedSet` → `subscribeServer`/`unsubscribe`; open a `metrics` subscription when `attachedSet` is empty (the `/` host case) and drop it when a server is attached (per-server metrics fan-out). Route acked snapshots + events into the existing slice-update paths. Preserve `attachServer` and every `subscribe*` signature; preserve version/update/order/preview/setPreviewScope behavior. <!-- R10 --> <!-- rework DONE (cycle 1): (1) SHOULD-FIX — onGone now also deletes the server from subscribedServersRef and calls socketRef.current.unsubscribeServer(key), releasing the StateSocket ref-count so the diff effect re-subscribes cleanly when attachedSet recomputes (via the onGone fetchServers) and the server is still desired — no more permanently-dead UI for a still-attached server. New unit test: "gone on a still-attached server releases the subscription so the diff effect re-subscribes" (proven to fail without the fix). (2) SHOULD-FIX docs — stale transport doc-comments throughout the file updated to the state-socket reality (type/context docs at the flagged lines plus the metrics/services/order dedup + hostMetricsConnected + helper-hook docs); intentional "replaces the old ?metrics=1 stream" / "parity with SSE" lineage notes kept. --> <!-- rework (cycle 2): MUST-FIX — StrictMode double-mount (the real dev/e2e runtime: main.tsx wraps in <StrictMode>) permanently loses the metrics subscription on the `/` host route (session-context.tsx:814-827). The socket-construction effect destroys+recreates the StateSocket across the remount, but metricsSubscribedRef and subscribedServersRef survive in refs, so the re-run sees the guard already true and never subscribes on the NEW socket → Host connection dot disconnected forever; when this tab is the hub's only client the poll loop never starts. Violates R10's `/` clause; the old EventSource code was explicitly StrictMode-safe. Fix: reset the guard refs (metricsSubscribedRef, subscribedServersRef, ackedServersRef) in the socket effect's cleanup — or give the metrics/diff effects symmetric cleanups — so the remount re-subscribes on the new socket. Add a StrictMode-wrapped unit test proving metrics re-subscribe on remount. ALSO (low-effort while here): two residual stale transport comments at session-context.tsx:401-402 ('the SSE listener (set up inside the pool effect)') and :282 ('after an SSE reconnect'). OPTIONAL nice-to-haves if trivial: connection-budget.spec.ts counts sockets via a URL-keyed Set which dedupes N same-URL sockets to 1 — count open-at-settle (subtract closed) so duplicate state sockets are detectable; state-socket.ts:66 reqToKey entry leaks when a subscribe gets an `error` frame instead of an ack. --> <!-- rework DONE (cycle 2): MUST-FIX FIXED — the socket-construction effect's cleanup now resets the three guard refs (metricsSubscribedRef=false, subscribedServersRef.clear(), ackedServersRef.clear()) so a StrictMode remount re-subscribes metrics + servers on the FRESH socket. Two StrictMode-wrapped unit tests added to session-context.test.tsx (using render(<StrictMode>…) with a context-capturing probe — renderHook's wrapper does NOT simulate the mount→unmount→remount, verified): the metrics `/` test is proven to FAIL without the fix (live socket's `active` set never gains "metrics" → hostMetricsConnected stuck false) and PASS with it; a companion server-route test confirms server re-subscription. End-to-end confirmation: the connection-budget `/` e2e (which runs under real <StrictMode>) goes green — pre-fix the Host health region would never appear. Low-effort extras all DONE: stale transport comments at :282 and :401-402 updated; state-socket.ts `error`-frame handler now drops the pending reqToKey entry for the offending req (no leak on a rejected subscribe); connection-budget.spec.ts now counts LIVE sockets (opened − closed via each ws close event) instead of a URL-keyed Set, so a duplicate same-URL /ws/state is detectable (its .spec.md Shared-setup bullet updated to match). -->
- [x] T010 Re-derive connection-dot state: per-server `isConnected` true on that server's subscription `ack` (mirrors "first sessions event" today); `hostMetricsConnected` = (socket connected AND metrics subscription acked when no server attached) OR (any attached server subscription acked) with the existing 3s disconnect debounce driven by socket-level connection-state changes. <!-- R11 -->

### Phase 4: Tests + docs

- [x] T011 Rework hub tests: add `app/backend/api/state_ws_test.go` asserting hello→global-replay, subscribe→ack-with-snapshot, per-server + global event routing, unsubscribe, preview-scope, and `gone`; assert `data` byte-equality against the prior SSE payloads for every event type. Update/trim `sse_test.go`/`sse_subscriber_test.go` to the new client model (keep producer/poll coverage). <!-- R12 -->
- [x] T012 Add a shared Playwright WS-mock helper (e.g. `app/frontend/tests/e2e/_state-socket-mock.ts`) that `routeWebSocket`s `/ws/state`, answers `hello` with the global-slot replay and `subscribe` with an `ack` snapshot (parameterized sessions/metrics/etc.), and migrate every e2e spec currently mocking `**/api/sessions/stream*` to it (`pr-status-sidebar`, `status-dot-tip`, `top-bar-refresh`, `top-bar-persistence`, `row-minimalism`, `agent-next-waiting`, `spawn-agent`, `pane-register-panel`, `chat-view`, `server-reorder`, `board-reorder`, `board-list-reorder`), updating each `.spec.md` companion in the same commit. <!-- R15 -->
- [x] T013 Migrate `session-context.test.tsx` from `MockEventSource` to a `MockWebSocket` driving the state-socket protocol (hello/subscribe/ack/event/gone); keep the behavioral assertions (per-server isolation, server-order re-sort, server-gone teardown, host-metrics dedup, hostMetricsConnected debounce, serversLoaded, pendingServer, `shouldReloadOnVersion`). <!-- R15 -->
- [x] T014 Add `app/frontend/tests/e2e/connection-budget.spec.ts` + `.spec.md`: for board / terminal / server / host routes, count WS via `page.on('websocket')` (exactly one `/ws/state`, plus any relay WSs on terminal/board), assert zero `text/event-stream` responses (rk endpoints only, Vite HMR WS excluded). <!-- R13 -->
- [x] T015 Run the full gate: `just test-backend`, frontend type-check + `just test-frontend`, and the targeted e2e (`multi-server-sidebar:70`, `connection-budget`, and each migrated spec) via `just test-e2e "<spec>"`; fix failures to green. <!-- R12 R13 R14 R15 -->

## Execution Order

- Phase 1 (T001–T003) blocks Phase 2 (T004–T007).
- T006 depends on T004 (handler must exist before the route swap).
- Phase 3 (T008–T010) depends on the backend protocol being defined (T001) but the frontend can be built in parallel with backend handler work once the wire shape is fixed; integration verification needs the backend live.
- Phase 4 tests depend on their targets: T011 after Phase 2, T012–T014 after Phase 3, T015 last.

## Acceptance

### Functional Completeness

- [x] A-001 R1: `GET /ws/state` exists, upgrades, accepts `hello` (conn id normalized), and replays the six cached global slots once as `kind:"global"` events.
- [x] A-002 R2: `subscribe kind:"server"` enters the poll set, returns an `ack` with the current sessions snapshot, replays the per-server session-order, and routes per-server events with `kind:"server"`+`key`.
- [x] A-003 R3: `subscribe kind:"metrics"` yields ongoing `metrics`/`services` global events with zero attached servers, at the fast poll cadence.
- [x] A-004 R4: `unsubscribe` drops the subscription (server leaves the poll set when subscriber-less) and the in-band `preview-scope` op sets the expanded set and emits the cached subset immediately.
- [x] A-005 R5: an `IsServerGone` fetch emits `gone` to subscribers and reaps the server from every per-server map.
- [x] A-006 R8: the router has no `/api/sessions/stream` route, has `/ws/state`, and retains `POST /api/preview-scope`.
- [x] A-007 R9: a single `/ws/state` WS carries all state; reconnect re-sends hello + all subscribes with fresh acks (backoff 1s→15s).
- [x] A-008 R10: `attachServer` and every `subscribe*` helper keep their signatures; no consumer above the seams changed; version/update/order/preview/setPreviewScope behavior preserved.

### Behavioral Correctness

- [x] A-009 R6: every producer/broadcast signature is unchanged and events route by subscription.
- [x] A-010 R7: every event `type` string equals today's SSE event name; per-server events carry `kind:"server"`+`key`, global events `kind:"global"`.
- [x] A-011 R11: page dots read Connected only when the socket is connected AND the relevant subscription has acked; `hostMetricsConnected` keeps the 3s debounce. *(Reconnect nuance: on socket re-open, previously-acked servers flip Connected before the fresh re-ack lands — ms-scale window, noted as nice-to-have in review.)*

### Removal Verification

- [x] A-012 R8: `handleSSE` and the `metricsOnlyServer` HTTP-routing branch it owned are gone with no dead references; the frontend opens no EventSource. *(Chat-lens SSE remains by design — Change 3 scope.)*

### Scenario Coverage

- [x] A-013 R12: hub tests assert `data` byte-equality against prior SSE payloads for every event type plus the `ack` snapshot and `gone` frame. *(Strict envelope byte-equality asserted for ack snapshot, session-order, server-order, update-available, gone; remaining types are content-asserted via the shared `hubEvent.String()` rendering and preserved by the single `json.RawMessage` passthrough path — see review nice-to-have.)*
- [x] A-014 R13: the connection-budget e2e asserts exactly one `/ws/state` WS and zero `text/event-stream` on all four route types. *(Verified in review: 4/4 green under `just test-e2e`.)*
- [x] A-015 R14: `multi-server-sidebar:70` passes deterministically under `just test-e2e` isolation. *(Verified in review: 1 pass + `--repeat-each=3` all green.)*
- [x] A-016 R15: migrated specs exercise the WS protocol and pass; every touched `.spec.ts` has an updated `.spec.md`. *(All 12 migrated specs, 46/46 tests green in review.)*

### Edge Cases & Error Handling

- [x] A-017 R1: a malformed/oversized conn id falls back to empty (capture-nothing) exactly as `normalizeConnID` does today.
- [x] A-018 R9: a mid-session socket drop reconnects and every active subscription re-acks with a fresh snapshot (RefreshButton recovery after `rk daemon restart` still works).
- [x] A-019 R5: a re-subscribe after a `gone` re-registers the server cleanly (no stale per-server state). *(Hub-side verified; the client-side edge — `onGone` releasing `subscribedServersRef` + the StateSocket ref-count so a still-attached server re-subscribes — fixed in rework cycle 1, covered by the new "gone on a still-attached server releases the subscription…" unit test.)*

### Code Quality

- [x] A-020 Pattern consistency: new Go code follows the `api/` handler + injection patterns; the WS handler uses the shared `upgrader`; no shell strings, `exec.CommandContext` with timeouts unchanged. *(Rework cycle 1: the WS `subscribe`/`unsubscribe` paths and the in-band `preview-scope` op now validate the client-supplied server key via `validate.ValidateServerName` — restoring the barrier the retired SSE edge had via `serverFromRequest` (Constitution §I) — rejecting invalid names with an `error` frame; sse.go:67's "validated by ValidateServerName" comment is now truthful again.)*
- [x] A-021 No unnecessary duplication: envelope renderers reuse the existing payload marshalling; the frontend reuses `shouldReloadOnVersion` and existing slice-update/apply helpers; no new EventSource pool logic left behind. *(One dead leftover: `api/client.ts setPreviewScope` — see Deletion Candidates.)*
- [x] A-022 No client polling: the frontend uses the socket, not `setInterval` + fetch.
- [x] A-023 WebSocket cleanup: the state socket closes on unmount/teardown without orphaning; SSE-endpoint removal leaves no half-wired hub path. *(Normal teardown clean; the writer-pump-death/half-open-client read-loop leak fixed in rework cycle 1 — the pump sets a short read deadline (`stateWSCleanupWait`) on WriteMessage failure so the read loop unblocks and runs `dropStateConn`, mirroring relay.go.)*

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

<!-- replaced in place by the cycle-2 re-review (fresh full review) — all entries re-verified against the working tree -->

- `app/frontend/src/api/client.ts:70` (`setPreviewScope`) — the provider now sends preview-scope in-band over the state socket; no importer remains (re-verified with a NUL-safe sweep — `session-tiles.tsx` consumes the *context's* `setPreviewScope`, not this client helper; D4 keeps only the server-side `POST /api/preview-scope` endpoint).
- `app/backend/api/state_ws.go:123` (`hubEvent.String()`) — production method whose only call sites are test files (`drainConnEvents`/`drainFrames` in `sse_test.go`, `status_refresh_test.go`, `preview_test.go`, `sse_subscriber_test.go`); relocate to a `_test.go` helper so production code carries no test-only rendering path.
- `app/frontend/tests/e2e/_state-socket-mock.ts:52-137` (the control-handle surface: exported `StateSocketControl` type, `routeStateSocketWithControl`'s returned `emitServer`/`emitGone`, and the `pending` pre-connect buffer they feed) — zero call sites in the diff or repo: all 12 migrated specs use `mockStateSocket` only, and the live-event specs (server-reorder / board-reorder / board-list-reorder) drive the REAL backend with in-page WS clients instead. Collapse to `mockStateSocket` until a consumer exists (also filed as a should-fix parsimony finding, cycle-2 re-review).
- Stale transport doc-comments (not code; flagged for hydrate/next-touch cleanup): `session-context.tsx` is now fully cleaned — the cycle-1 bulk pass plus the cycle-2 residuals at `:282` ("after an SSE reconnect" → "after a state-socket reconnect") and `:401-402` ("the SSE listener (set up inside the pool effect)" → "the state socket's per-server event handler") — both verified. Remaining consumer-side references still describing an "EventSource pool" live in `use-boards.ts:35/46/63`, `use-window-pins.ts:87`, `app.tsx:120`; spec-side residue in `top-bar-refresh.spec.ts:3` ("we inject the SSE `sessions` payload") and the `// SSE stream:` line above its `mockStateSocket` call; backend lineage comments still describing the retired `?metrics=1` stream as live in `boards.go:346`, `servers.go:155`. (`chat-view.tsx` / `app.tsx` chat-stream `EventSource` references are accurate — the chat SSE remains until Change 3.)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | State socket is a WebSocket via gorilla/websocket using the existing shared `upgrader`; JSON text frames both directions | Plan D1 + spike 1 evidence, ratified; gorilla is already a dependency and the relay uses the same upgrader | S:95 R:75 A:95 D:90 |
| 2 | Certain | Event names + payloads move verbatim into `type`/`data`; `attachServer`/`subscribe*` signatures unchanged | Intake load-bearing contract-preservation rule; consumers already isolated behind seams | S:90 R:80 A:95 D:90 |
| 3 | Certain | Retire `GET /api/sessions/stream` + `handleSSE` in this change; keep `POST /api/preview-scope` | Plan D2/D4, settled; constitution IV | S:85 R:80 A:90 D:90 |
| 4 | Confident | Generalize `sseClient` in place (per-connection subscription set) rather than rewriting the hub; producers frozen | Minimizes regression surface per the intake; the producer machinery is proven and untouched | S:75 R:70 A:80 D:75 |
| 5 | Confident | Metrics-only connection modeled as a `metrics` subscription at the protocol edge; internally registered under the retained `metricsOnlyServer` sentinel so `safetyIntervalEffective` and poll logic stay untouched (amended in rework cycle 1 to the implemented shape) | The sentinel's HTTP-routing branch was the hack; keeping it as the internal registry key preserves the fast-cadence-on-`/` behavior with the smallest diff | S:70 R:75 A:80 D:70 |
| 6 | Confident | The connection's own conn id serves both the in-band `preview-scope` op and the retained `POST /api/preview-scope`; `normalizeConnID` semantics reused | Plan D4; keeps preview-scope zero-regression while adding the in-band twin | S:75 R:85 A:85 D:80 |
| 7 | Confident | E2e specs mocking `**/api/sessions/stream*` migrate to a shared `routeWebSocket('/ws/state')` helper answering hello→global-replay + subscribe→ack; unit test swaps `MockEventSource`→`MockWebSocket` | The frontend stops opening the SSE, so the SSE `page.route` mocks go dead; Playwright `routeWebSocket` is the sanctioned WS-mock seam (already used for relay) | S:70 R:70 A:75 D:70 |
| 8 | Confident | Reconnect uses client-side exponential backoff 1s→15s; hello + resubscribe-all; fresh snapshot per ack | Intake assumption 5; obvious default, snapshot-on-ack is the protocol's own idiom | S:75 R:90 A:85 D:80 |
| 9 | Confident | `hostMetricsConnected` derives from (socket connected AND metrics-subscription acked when no server attached) OR (any attached server subscription acked), keeping the 3s debounce driven by socket connection-state | Follows the dot-everywhere vocabulary; the exact mapping is an implementation detail easily adjusted | S:70 R:80 A:80 D:70 |

9 assumptions (3 certain, 6 confident, 0 tentative).
