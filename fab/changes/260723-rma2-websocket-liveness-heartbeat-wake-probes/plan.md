# Plan: WebSocket Liveness — Heartbeat + Wake Probes for State Socket and Relay Mux

**Change**: 260723-rma2-websocket-liveness-heartbeat-wake-probes
**Intake**: `intake.md`

## Requirements

### Frontend: StateSocket liveness (`app/frontend/src/lib/state-socket.ts`)

#### R1: Client heartbeat on `/ws/state`
While its WebSocket is `OPEN`, `StateSocket` MUST send `{op:"ping"}` every `HEARTBEAT_INTERVAL_MS` (30000). The interval MUST be a named constant; the heartbeat timer MUST start when the socket opens and stop on socket close (both the drop path and permanent `close()`).

- **GIVEN** a connected `StateSocket`
- **WHEN** `HEARTBEAT_INTERVAL_MS` elapses repeatedly with the socket `OPEN`
- **THEN** one `{op:"ping"}` frame is sent per interval
- **AND** no ping is sent after permanent `close()` or while the socket is not `OPEN`

#### R2: Any-frame liveness tracking + silence force-close
`StateSocket` MUST track a `lastInbound` timestamp updated on **every** inbound frame (events, acks, `gone`, `error`, and the new `pong` — pongs are not individually correlated). Death detection MUST judge silence only against pings actually sent (the hidden-tab guard): an **outstanding-ping clock** starts when a ping is sent with no prior ping outstanding, is cleared by ANY inbound frame, and when a ping has been outstanding for `LIVENESS_TIMEOUT_MS` (`2 * HEARTBEAT_INTERVAL_MS`) the socket MUST be presumed half-open dead and force-closed (R3). Browser timer throttling delaying the client's own pings MUST NOT by itself trigger a force-close (the clock starts only on a real send; a live server answers regardless of when the ping went out).

- **GIVEN** a connected `StateSocket` whose ping at T0 receives no inbound frame of any kind
- **WHEN** the liveness check runs with the ping outstanding ≥ `LIVENESS_TIMEOUT_MS`
- **THEN** the socket is force-closed and the existing `onclose` → `scheduleReconnect()` path recovers
- **GIVEN** a connected `StateSocket` receiving server events (but no pongs)
- **WHEN** intervals elapse
- **THEN** no force-close occurs (any frame counts as liveness)

#### R3: Internal force-close path distinct from permanent `close()`
The liveness force-close MUST be a private path (`forceClose()`) that closes the raw WebSocket **without** setting `closed = true` and **without** nulling `ws.onclose`, so the normal `onclose` handler fires (a local `ws.close()` fires `onclose` client-side even when the TCP peer is gone) and drives cleanup + reconnect (backoff 1s→15s, blind resubscribe of `subs`). Public `close()` semantics MUST be unchanged, and `close()` MUST additionally tear down heartbeat/probe timers and wake-probe listeners.

- **GIVEN** a `StateSocket` with active subscriptions
- **WHEN** `forceClose()` fires
- **THEN** `closed` remains `false`, `onclose` runs, a reconnect is scheduled, and on reconnect every subscription in `subs` is re-sent
- **GIVEN** a `StateSocket`
- **WHEN** public `close()` is called
- **THEN** no reconnect, no further pings, and no wake-probe reaction ever occurs

### Frontend: Wake probes (both sockets)

#### R4: Event-driven wake probes
Both `StateSocket` and `RelayMux` MUST register listeners for `document` `visibilitychange` (reacting only when the document becomes visible), `window` `online`, and `window` `pageshow`. On a wake event:

- **(a)** socket claims `OPEN` → send an immediate `{op:"ping"}` and arm a `WAKE_PROBE_TIMEOUT_MS` (3000) deadline; ANY inbound frame before the deadline cancels it; deadline expiry → the same internal force-close as the heartbeat.
- **(b)** a reconnect backoff timer is pending → clear it, reset `backoff` to `RECONNECT_BASE_MS`, and `connect()` immediately.

Listeners MUST be instance-owned (registered when the socket becomes active, removed on permanent `close()`) and environment-guarded so jsdom/unit-test/non-browser contexts (including a stubbed `window` lacking `addEventListener`) don't break.

- **GIVEN** a socket whose TCP peer died during machine sleep (`readyState` still `OPEN`)
- **WHEN** the tab becomes visible and no inbound frame arrives within 3s of the probe ping
- **THEN** the socket is force-closed and the existing reconnect machinery recovers
- **GIVEN** a socket mid-backoff (e.g. a 15s/30s cap timer pending)
- **WHEN** an `online`/`pageshow`/visible event fires
- **THEN** the pending timer is cleared and a reconnect starts immediately with backoff reset to base

### Frontend: RelayMux liveness (`app/frontend/src/lib/relay-mux.ts`)

#### R5: Stream-gated mux heartbeat
`RelayMux` MUST run the same client heartbeat with `{op:"ping"}` / `{op:"pong"}` as JSON control ops **carrying no stream id**. `lastInbound` MUST update on every inbound frame — binary data frames AND text control frames both count (a busy terminal never needs a pong to prove liveness). The heartbeat MUST run only while the socket is `OPEN` AND `streams.size > 0`, MUST stop when the last stream closes, and MUST never connect a closed socket.

- **GIVEN** a mux with ≥1 live stream and an open socket
- **WHEN** intervals elapse with a genuinely dead (half-open) socket
- **THEN** the outstanding ping ages past `LIVENESS_TIMEOUT_MS`, the socket is force-closed, and the existing reconnect re-issues `open` for every live stream
- **GIVEN** a mux whose streams all closed (idle, socket possibly still open)
- **WHEN** intervals elapse
- **THEN** no pings are sent

#### R6: `pong` handled before the id guard
Client `handleControl()` currently early-returns unless `typeof msg.id === "number"`. The id-less `{op:"pong"}` MUST be handled (swallowed — liveness bookkeeping already happened on frame receipt) **before** that guard.

- **GIVEN** an inbound `{"op":"pong"}` text frame (no `id`)
- **WHEN** `handleControl` processes it
- **THEN** it is not dropped by the id guard and produces no stream callback

#### R7: Idle-stays-closed preserved
With zero live streams the mux deliberately lets the socket stay closed (`scheduleReconnect`'s `streams.size === 0` branch). Heartbeat and wake probes MUST NOT change that: the mux wake probe MUST no-op when `streams.size === 0` and MUST never resurrect an idle socket.

- **GIVEN** an idle mux (zero streams, no socket)
- **WHEN** visibilitychange/online/pageshow fire
- **THEN** no socket is created and no timer is armed

### Backend: server-side ping handling (`app/backend/api/`)

#### R8: `ping` op on `/ws/state`
`state_ws.go` MUST add a `ping` client op (named constant alongside `hello`/`subscribe`/…) to the read-loop dispatch, replying `{op:"pong"}`. The reply MUST be enqueued through the connection's existing single-writer pump (`sc.ch`, the buffered channel the writer goroutine drains) — never written directly from the read loop (gorilla permits one concurrent writer). After this change `ping` is a known op (no `error` frame); other unknown ops still get the `error` frame.

- **GIVEN** a connected state-socket client past `hello`
- **WHEN** it sends `{"op":"ping"}`
- **THEN** it receives `{"op":"pong"}` via the writer pump, and the connection stays live

#### R9: `ping` control op on `/ws/terminals`
`terminals_ws.go` MUST add a `ping` case to the JSON control-op dispatch (alongside `open`/`resize`/`close`), replying `{op:"pong"}` (no `id`) enqueued through the existing writer path (the reserved control pseudo-stream drained by `runWriter`). Unknown ops other than `ping` remain ignored (forward-compat).

- **GIVEN** a connected terminals-mux client
- **WHEN** it sends `{"op":"ping"}`
- **THEN** it receives the text frame `{"op":"pong"}` via the single writer, and the socket stays live

### Tests

#### R10: Frontend fake-timer coverage
The existing colocated Vitest suites `state-socket.test.ts` and `relay-mux.test.ts` MUST be extended (existing tests keep passing) with fake-timer coverage of: ping cadence, any-frame liveness refresh, silence → force-close → reconnect (with `closed` still `false`), wake-probe ping + 3s-deadline force-close, wake-probe immediate-reconnect + backoff reset, mux idle socket untouched by heartbeat/wake probes, and `close()` tearing down timers/listeners.

- **GIVEN** the extended suites
- **WHEN** `just test-frontend` runs
- **THEN** all tests (existing + new) pass

#### R11: Backend ping→pong coverage
Go tests alongside both handlers MUST cover ping → pong on each endpoint (`state_ws_test.go`, `terminals_ws_test.go` conventions; no tmux dependency needed for the ping paths).

- **GIVEN** the extended Go tests
- **WHEN** `just test-backend` runs
- **THEN** all tests pass

### Non-Goals

- Server-initiated protocol-level WS pings alone — rejected (browsers auto-answer them in the network stack, invisibly to JS; cannot drive client-side death detection).
- Server-side idle read deadline + reaping of silent connections, and the stale `sse.go:105` comment fix (intake item 4 — deferred).
- Suppressing the 5s window-switch bounce timer while disconnected (intake item 5 — skipped; with heartbeat + wake probes the socket recovers within the confirmation window).
- Playwright e2e — machine sleep / half-open TCP is not reproducible in the e2e harness.

### Design Decisions

#### Outstanding-ping liveness clock (hidden-tab guard shape)
**Decision**: Liveness is judged by an outstanding-ping clock: the clock starts when a ping is actually sent with no prior ping outstanding; ANY inbound frame clears it; force-close fires when a ping has been outstanding ≥ `LIVENESS_TIMEOUT_MS`. The check runs at the top of each heartbeat tick (no separate check timer).
**Why**: Immune to background-tab timer throttling by construction — the clock never starts without a real send, and a live server answers a sent ping regardless of when throttling let it out, so delayed *self* pings can never force-close a healthy socket. One timer instead of two keeps the lifecycle small.
**Rejected**: Deferring enforcement while `document.hidden` — weaker (a hidden tab with a genuinely dead socket would never be reaped until visible) and needs extra visibility state; plain `now - lastInbound > timeout` — false-positives when throttling delays our own pings on a quiet-but-healthy socket.
*Introduced by*: 260723-rma2-websocket-liveness-heartbeat-wake-probes

#### Server pong rides the existing writer paths, best-effort
**Decision**: `/ws/state` enqueues the pong on `sc.ch` non-blocking (drop on full channel, mirroring the existing unknown-op error-frame path); `/ws/terminals` enqueues via `enqueueControl` (the reserved control pseudo-stream, short-frame priority).
**Why**: gorilla/websocket permits one concurrent writer — all frames must funnel through each connection's single writer goroutine. A dropped pong under channel pressure is harmless: pressure means event frames are flowing, and any frame counts as liveness client-side.
**Rejected**: Direct `conn.WriteMessage` from the read loop — violates the one-writer invariant and races the pump.
*Introduced by*: 260723-rma2-websocket-liveness-heartbeat-wake-probes

## Tasks

### Phase 1: Backend ping ops

- [x] T001 [P] `app/backend/api/state_ws.go`: add `opPing` constant + `pongFrame` type (`{"op":"pong"}`); add a `ping` case to the read-loop `switch msg.Op` that enqueues the marshalled pong on `sc.ch` non-blocking (mirroring the unknown-op error path) <!-- R8 -->
- [x] T002 [P] `app/backend/api/terminals_ws.go`: add a `ping` case to the control-op `switch ctl.Op` that replies `{"op":"pong"}` via `tc.enqueueControl` <!-- R9 -->
- [x] T003 [P] `app/backend/api/state_ws_test.go`: e2e test — dial `/ws/state`, `hello`, send `{"op":"ping"}`, read until `{"op":"pong"}`; assert the connection stays live <!-- R11 -->
- [x] T004 [P] `app/backend/api/terminals_ws_test.go`: test — dial `/ws/terminals` (mock tmux router, no real tmux), send `{"op":"ping"}`, read until the `{"op":"pong"}` text frame <!-- R11 -->

### Phase 2: StateSocket heartbeat + wake probes

- [x] T005 `app/frontend/src/lib/state-socket.ts`: add `HEARTBEAT_INTERVAL_MS`/`LIVENESS_TIMEOUT_MS`/`WAKE_PROBE_TIMEOUT_MS` constants; `lastInbound` + outstanding-ping bookkeeping updated on every inbound frame in `onmessage` (before parse); heartbeat interval started in `onopen`, cleared on `onclose`/`close()`; tick = liveness check (outstanding ≥ timeout → `forceClose()`) then send `{op:"ping"}`; private `forceClose()` that closes the raw ws without touching `closed`/`ws.onclose` <!-- R1, R2, R3 -->
- [x] T006 `app/frontend/src/lib/state-socket.ts`: wake probes — instance-owned, environment-guarded listeners for visibilitychange(→visible)/online/pageshow registered on `connect()`, removed on `close()`; handler: pending reconnect timer → clear + backoff reset to `RECONNECT_BASE_MS` + immediate `connect()`; else socket OPEN → probe ping + `WAKE_PROBE_TIMEOUT_MS` deadline force-close, cancelled by any inbound frame; `close()` also clears heartbeat/deadline timers <!-- R3, R4 -->
- [x] T007 `app/frontend/src/lib/state-socket.test.ts`: fake-timer tests — ping cadence; any-frame liveness refresh (events keep it alive without pongs); silence → force-close → reconnect with `closed` still false + resubscribe; wake-probe ping + 3s deadline force-close; wake-probe inbound-frame cancel; wake-probe immediate reconnect + backoff reset; `close()` teardown (no pings, no probe reaction after) <!-- R10 -->

### Phase 3: RelayMux heartbeat + wake probes

- [x] T008 `app/frontend/src/lib/relay-mux.ts`: same heartbeat constants + `lastInbound`/outstanding-ping bookkeeping on every inbound frame (binary AND text) in `onmessage`; `{op:"pong"}` handled in `handleControl` BEFORE the `typeof msg.id !== "number"` guard; heartbeat gated on socket OPEN AND `streams.size > 0` (reconciled from `onopen`/`openStream`/`closeStream`/stream-`closed`/`onclose`/`close()`); private `forceClose()` into the existing `onclose` → `scheduleReconnect` path <!-- R5, R6 -->
- [x] T009 `app/frontend/src/lib/relay-mux.ts`: wake probes — instance-owned, environment-guarded listeners (registered on first `connect()`, removed on `close()`); handler no-ops when `streams.size === 0` (idle stays closed); else pending-timer → immediate reconnect + backoff reset, or OPEN → probe ping + deadline <!-- R4, R7 -->
- [x] T010 `app/frontend/src/lib/relay-mux.test.ts`: fake-timer tests — ping cadence while streams live; binary data frames refresh liveness (no force-close under data flow); heartbeat stops when last stream closes; idle mux untouched by wake probes (no socket created); silence → force-close → reconnect re-issues `open` with backoff reset on wake; pong-before-id-guard (an id-less pong is swallowed, no stream callback); `close()` teardown; existing tests (minimal `window` stub without `addEventListener`) keep passing <!-- R10 -->

### Phase 4: Verification

- [x] T011 Run `just test-frontend` and `just test-backend`; fix any failures (never direct `go test`/`pnpm`/`playwright`) <!-- R10, R11 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: `StateSocket` sends `{op:"ping"}` every `HEARTBEAT_INTERVAL_MS` (30000, named constant) while OPEN, and stops on close
- [x] A-002 R2: every inbound frame refreshes liveness; a force-close fires only for a ping actually sent and unanswered ≥ `LIVENESS_TIMEOUT_MS` (2 × interval)
- [x] A-003 R3: `forceClose()` leaves `closed === false` and `ws.onclose` intact so the existing reconnect + blind-resubscribe machinery recovers; public `close()` semantics unchanged and it tears down timers/listeners
- [x] A-004 R4: wake events (visibilitychange→visible, online, pageshow) ping an OPEN socket with a 3s deadline (any inbound frame cancels; expiry force-closes) and fire a pending reconnect timer immediately with backoff reset to `RECONNECT_BASE_MS`, on both sockets
- [x] A-005 R5: mux heartbeat runs only while socket OPEN AND `streams.size > 0`, stops when the last stream closes, never connects a closed socket; binary and text frames both refresh `lastInbound`
- [x] A-006 R6: `{op:"pong"}` (no stream id) is handled before `handleControl`'s id guard
- [x] A-007 R7: an idle mux (zero streams) is untouched by heartbeat and wake probes — no socket resurrection
- [x] A-008 R8: `/ws/state` answers `{"op":"ping"}` with `{"op":"pong"}` enqueued through the writer pump (never a direct write from the read loop); `ping` no longer draws an `error` frame
- [x] A-009 R9: `/ws/terminals` answers `{"op":"ping"}` with the id-less `{"op":"pong"}` text frame via the single-writer control path

### Behavioral Correctness

- [x] A-010 R2: background-tab timer throttling delaying the client's own pings cannot by itself force-close a healthy socket (outstanding-ping clock starts only on a real send and is cleared by any inbound frame)

### Scenario Coverage

- [x] A-011 R10: Vitest fake-timer tests cover ping cadence, any-frame refresh, silence→force-close→reconnect (`closed` still false), wake-probe deadline force-close + cancel, wake-probe immediate reconnect + backoff reset, mux idle no-op, and `close()` teardown; all pre-existing tests in both suites still pass
- [x] A-012 R11: Go tests prove ping→pong on both `/ws/state` and `/ws/terminals`

### Edge Cases & Error Handling

- [x] A-013 R4: listener registration is environment-guarded — a stubbed `window` lacking `addEventListener` (existing relay-mux tests) and non-browser contexts do not throw
- [x] A-014 R8: wire protocol stays additive — unknown ops other than `ping` still draw an `error` frame on `/ws/state` and are still ignored on `/ws/terminals`; no existing op or frame shape changed

### Code Quality

- [x] A-015 Pattern consistency: new code follows the naming/structure of the surrounding socket classes and Go handlers
- [x] A-016 No unnecessary duplication: shared pong shape/type in the `api` package; existing reconnect/backoff machinery reused unchanged
- [x] A-017 No magic numbers: all intervals/timeouts are named constants
- [x] A-018 No client polling anti-pattern: the heartbeat is socket-level liveness, not `setInterval` + fetch data polling
- [x] A-019: all test runs go through `just` recipes (`just test-frontend`, `just test-backend`)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- `app/backend/api/sse.go:100-105` — the retired-constants comment asserts "/ws/state and /ws/terminals handle keepalive + liveness at the WebSocket layer." Before this change that claim was false (the intake's own diagnosis); it is now *partially* true (client-side liveness exists) but still overstates it (no server-side idle read deadline / reaping). Correcting or scoping this comment was explicitly deferred as intake out-of-scope item 4 — surfaced here for the human reviewer / the future item-4 change, not for action in this change.

_No production code was made redundant by this change — it is purely additive (new `opPing`/`pongFrame` on the server, new heartbeat/wake-probe members on the two socket classes). The pre-existing reconnect/backoff machinery is reused unchanged, not replaced._

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Hidden-tab guard shape (intake #8 delegated to apply): outstanding-ping clock — starts on an actual ping send when none is outstanding, cleared by any inbound frame, force-close at outstanding ≥ `LIVENESS_TIMEOUT_MS`; liveness checked at the top of each heartbeat tick (no separate check timer) | False-positive-free under throttling by construction; matches intake's "silence is judged only when a ping actually went out"; fewer timers | S:70 R:80 A:80 D:70 |
| 2 | Certain | State-socket server pong enqueued on `sc.ch` non-blocking (drop when full), mirroring the existing unknown-op error-frame path | Channel pressure means event frames are flowing — any frame counts as liveness client-side, so a dropped pong is harmless; pattern already established in the read loop | S:80 R:85 A:90 D:85 |
| 3 | Confident | Mux wake probe returns early when `streams.size === 0` (covers intake's "zero live streams and no socket" case and the zero-streams-with-open-socket case uniformly) | An idle socket's liveness is irrelevant and `scheduleReconnect` already leaves idle sockets closed; a single gate keeps the handler simple | S:70 R:85 A:80 D:75 |
| 4 | Confident | Environment guards check both `typeof window/document !== "undefined"` AND `typeof …addEventListener === "function"` | Existing relay-mux tests stub `window` as `{location}` only — a bare typeof guard would still throw on `window.addEventListener(...)`; existing tests must keep passing | S:75 R:90 A:90 D:80 |
| 5 | Confident | Mux heartbeat lifecycle via a single reconciler (`syncHeartbeat()`) called from `onopen`, `openStream`, `closeStream`, the stream-`closed` control case, `onclose`, and `close()` — starts iff OPEN ∧ `streams.size > 0`, else stops | The gate has multiple entry/exit points (first stream on an already-open socket, last stream closing, socket drop); one idempotent reconciler is simpler than per-site start/stop bookkeeping | S:65 R:85 A:80 D:70 |
| 6 | Certain | One shared `pongFrame` Go type (`{"op":"pong"}`) in package `api`, used by both handlers | Identical wire shape on both endpoints; both files are in the same package; code-quality bans duplication | S:80 R:90 A:90 D:90 |

6 assumptions (2 certain, 4 confident, 0 tentative).
