# Plan: Pre-render Broadcast Envelopes Once Per Event

**Change**: 260811-sqe7-prerender-broadcast-envelopes
**Intake**: `intake.md`

## Requirements

### Backend: Pre-rendered Fan-out Envelopes

#### R1: Fan-out events are rendered once at the broadcast site
Every state-socket fan-out site in `app/backend/api/sse.go` (one event delivered to N recipients) MUST render the envelope exactly once and enqueue the pre-rendered raw form (`hubEvent{raw: <rendered>, typ: <name>}`) on each recipient's channel, instead of enqueueing a structured `hubEvent` that each connection's writer pump marshals independently. The nine sites (all verified at HEAD in the intake):

- `broadcastSessionOrder` (`sse.go:734`) — `session-order`, per-server loop
- `broadcastServerOrder` (`sse.go:765`) — `server-order`, global via `broadcastGlobalLocked`
- `broadcastBoardOrder` (`sse.go:795`) — `board-order`, global
- `broadcastUpdateAvailable` (`sse.go:912`) — `update-available`, global
- `broadcastStatusRefresh` (`sse.go:940`) — `status-refresh`, global
- `broadcastBoardChanged` (`sse.go:967`) — `board-changed`, per-server loop
- poll sessions delta loop (`sse.go:1339`) — `sessions`, per-server loop
- metrics tick (`sse.go:1516`) — `metrics`, global
- services tick (`sse.go:1530`) — `services`, global

For the per-server loops the render MUST happen once *before* the loop, not per iteration.

- **GIVEN** a hub with C connected state-socket clients
- **WHEN** any of the nine fan-out events fires
- **THEN** the envelope JSON is marshalled exactly once per event (not C times)
- **AND** every recipient receives the same pre-rendered bytes verbatim through the existing `raw` bypass in `renderEnvelope`

#### R2: Wire frames stay byte-identical; drop-logging stays informative
The conversion MUST NOT change the bytes delivered to any client — `renderEnvelope` returns `e.raw` verbatim when non-nil, so a pre-rendered event produces exactly the frame the per-recipient marshal produced before. `renderEnvelope` itself MUST NOT be modified. Pre-rendered broadcast events MUST keep `typ` populated so the channel-full drop logs in `sendLocked` / `sendConnLockedOK` (`"event", ev.typ`) remain informative.

- **GIVEN** a converted fan-out event
- **WHEN** a connection's writer pump renders it via `renderEnvelope()`
- **THEN** the emitted frame is byte-identical to the pre-change structured-event render
- **AND** a channel-full drop logs the event's `typ`, not an empty string

#### R3: Explicit exclusions stay structured
The following MUST remain structured (per-recipient) events, untouched by the conversion:

- `preview` events (`sse.go:1023`, `sse.go:1366`) — per-subscriber filtered subsets; payloads genuinely differ per recipient
- Single-recipient sends — `replayGlobalSlots` (`sse.go:506–521`), subscribe-time cached replay in `addClient` (`sse.go:434`, `sse.go:439`), and the `version` slot (no broadcast site exists at HEAD)
- `gone` reap markers (`sse.go:1476`) — rare, tiny, and riding the dedicated `gone: true` render path
- Chat events — per-subscription via `sendConnLockedOK` with its own reset-on-drop contract

- **GIVEN** the excluded paths above
- **WHEN** the conversion is complete
- **THEN** each still enqueues a structured `hubEvent` exactly as before (no `raw` field populated by this change)

#### R4: `hubEvent.raw` doc comment reflects the new primary use
The `raw` field's doc comment in `app/backend/api/state_ws.go` (`state_ws.go:144–148`) MUST be updated to describe pre-rendered broadcast fan-out as the primary use (alongside the subscribe `ack` / error frames it already carries), and MUST record the convention that raw broadcast events keep `typ` populated for drop-logging.

- **GIVEN** the `hubEvent` struct in `state_ws.go`
- **WHEN** a reader inspects the `raw` field comment
- **THEN** it describes the pre-rendered broadcast fan-out use and the `typ`-retention convention, not only the subscribe `ack`

### Backend Tests: Raw-frame-aware Helpers

#### R5: Test helpers assert decoded semantics regardless of structured/raw
`app/backend/api/state_ws_test.go`'s test helpers and assertions MUST be audited and updated so every existing test asserts the same *decoded* semantics (op/kind/type/data) whether an event rode the structured or the raw path. Concretely: `hubEvent.String()` (`state_ws_test.go:28`) MUST decode a raw `event`-envelope frame and render the same SSE-style debug string (`event: <type>\ndata: <data>\n\n`) it produces for a structured event, so the SSE-shape assertions in `sse_test.go`, `boards_test.go`, and `preview_test.go` keep asserting decoded content. Non-`event` raw frames (ack/error/pong) keep passing through verbatim. `drainFrames` → `decodeEnvelopes` already survives unchanged (raw passes through `renderEnvelope` verbatim).

- **GIVEN** a converted (raw) fan-out event on a test channel
- **WHEN** a test renders it with `hubEvent.String()` or drains it with `drainFrames`/`decodeEnvelopes`
- **THEN** the observable assertion surface (SSE-style string or decoded envelope map) is identical to what the structured event produced before the change
- **AND** the full `go test ./api/...` suite passes with no assertion weakening

### Frontend: relay-mux sendData Rider

#### R6: `sendData` writes the stream id without a per-frame DataView
`app/frontend/src/lib/relay-mux.ts` `sendData` (`relay-mux.ts:410`) MUST replace the per-outbound-frame `new DataView(frame.buffer).setUint32(0, id, false)` with four direct byte stores (`frame[0] = (id >>> 24) & 0xff` etc.), producing the identical big-endian u32 header. Outbound path only; the inbound hot path is already alloc-clean and untouched.

- **GIVEN** an outbound data frame for stream id `N`
- **WHEN** `sendData` encodes it
- **THEN** the first four bytes are `N` in big-endian order — byte-identical to the DataView encoding — with no `DataView` allocation

### Non-Goals

- Converting `preview`, single-recipient replays, `gone` markers, or chat events — directed exclusions (payloads differ per recipient, already render once, or ride dedicated paths)
- Modifying `renderEnvelope` — the raw passthrough already exists and is untouched
- Any wire/protocol change — frames are byte-identical; no client-side consumer changes
- Caching rendered envelopes in the hub slots — caches keep storing payload strings, not rendered envelopes
- The `version` event — no broadcast site exists at HEAD; delivered only via `replayGlobalSlots`

### Design Decisions

#### Shared `preRendered` helper over inline render-at-site
**Decision**: Introduce a tiny helper `preRendered(ev hubEvent) hubEvent` (next to `renderEnvelope` in `state_ws.go`) that returns `hubEvent{raw: ev.renderEnvelope(), typ: ev.typ}`, and call it at each of the nine fan-out sites.
**Why**: Nine identical two-line conversions invite drift and copy errors; a named helper states the idiom once and keeps every call site one line.
**Rejected**: Inline `hubEvent{raw: ev.renderEnvelope(), typ: ev.typ}` at each site (the intake left this as a plan-stage choice) — functionally identical but nine repetitions of a subtle "keep typ" convention.
*Introduced by*: 260811-sqe7-prerender-broadcast-envelopes

## Tasks

### Phase 1: Core Conversion

- [x] T001 Add the `preRendered` helper in `app/backend/api/state_ws.go` (next to `renderEnvelope`) <!-- R1 -->
- [x] T002 Convert the four global `broadcastGlobalLocked` sites in `app/backend/api/sse.go` (`broadcastServerOrder`, `broadcastBoardOrder`, `broadcastUpdateAvailable`, `broadcastStatusRefresh`) to pre-rendered raw events <!-- R1 -->
- [x] T003 Convert the metrics + services tick sites in `app/backend/api/sse.go` `poll()` to pre-rendered raw events <!-- R1 -->
- [x] T004 Convert the three per-server loop sites in `app/backend/api/sse.go` (`broadcastSessionOrder`, `broadcastBoardChanged`, poll sessions delta) — render once before the loop <!-- R1 -->
- [x] T005 Update the `hubEvent.raw` doc comment in `app/backend/api/state_ws.go` for the pre-rendered broadcast fan-out use + `typ` convention <!-- R4 -->
- [x] T006 [P] `relay-mux.ts` rider: replace the per-frame DataView in `sendData` with four direct byte stores in `app/frontend/src/lib/relay-mux.ts` <!-- R6 -->

### Phase 2: Test Helpers & Verification

- [x] T007 Update `hubEvent.String()` in `app/backend/api/state_ws_test.go` to decode raw `event` envelopes into the SSE-style debug frame; audit for direct `ev.typ`/`ev.data` channel reads <!-- R5 -->
- [x] T008 Run backend tests (`cd app/backend && go test ./api/...`) and fix any residual assertion breakage without weakening assertions <!-- R2 -->
- [x] T009 Run frontend type check (`cd app/frontend && npx tsc --noEmit`) and Vitest relay-mux unit tests (`just test-frontend`) <!-- R6 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: All nine enumerated fan-out sites in `sse.go` enqueue pre-rendered raw events; no converted site leaves a structured `hubEvent{kind, typ, key, data}` fan-out behind
- [x] A-002 R1: For the per-server loops (`sessions`, `session-order`, `board-changed`), the envelope render happens once before the loop, not per iteration
- [x] A-003 R4: The `hubEvent.raw` doc comment describes pre-rendered broadcast fan-out as a primary use and records the `typ`-for-drop-logging convention
- [x] A-004 R5: `hubEvent.String()` decodes raw `event` envelopes to the same SSE-style debug frame shape; non-`event` raw frames pass through verbatim
- [x] A-005 R6: `sendData` in `relay-mux.ts` writes the big-endian u32 stream id via four direct byte stores with no `DataView` allocation

### Behavioral Correctness

- [x] A-006 R2: Delivered frames are byte-identical to pre-change — every existing envelope-decoding test (`TestStateWS_ServerEventEnvelopeByteEquality`, `TestStateWS_GlobalEventEnvelope`, `TestStateWS_HelloReplaysGlobalSlots`, broadcast fan-out tests) passes unmodified in its assertions
- [x] A-007 R2: Pre-rendered broadcast events keep `typ` populated (channel-full drop logs still name the event)
- [x] A-008 R3: `preview` events, single-recipient replays (`replayGlobalSlots`, `addClient` cached sends), `gone` reap markers, and chat sends remain structured events — unchanged by this change

### Scenario Coverage

- [x] A-009 R1: A global broadcast (e.g. `server-order`) reaches every connection exactly once with the same bytes (covered by `TestStateWS_GlobalEventEnvelope` / `TestBroadcastServerOrderFansOutToAllClients`)
- [x] A-010 R5: The full `cd app/backend && go test ./api/...` suite passes, including the SSE-shape string assertions in `sse_test.go` / `boards_test.go` / `preview_test.go` over now-raw events
- [x] A-011 R6: Relay-mux unit tests decode the same header bytes (`just test-frontend` green) and `npx tsc --noEmit` is clean

### Edge Cases & Error Handling

- [x] A-012 R2: `TestSSEHubDropLogging` (buffer-fill → drop → recover) still passes against converted per-server fan-out events
- [x] A-013 R5: The subscribe-ack staleness race test (`TestStateWS_SubscribeAckNotStaleUnderPollInterleave`) still passes — ack ordering is unaffected by render location

### Code Quality

- [x] A-014 Pattern consistency: the conversion reuses the existing `raw` bypass idiom (as `emitError`/ack already do) via one shared helper instead of nine inlined copies
- [x] A-015 No unnecessary duplication: no new render/marshal path is introduced; `renderEnvelope` is the single renderer and is unmodified
- [x] A-016 Test integrity: no implementation code was shaped to fit test fixtures; tests adapt to the spec'd byte-identical behavior, never the reverse

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Shared `preRendered` helper in `state_ws.go` rather than nine inline conversions | Intake explicitly leaves inline-vs-helper as a plan-stage choice; one helper prevents drift on the "keep typ" convention | S:70 R:85 A:85 D:70 |
| 2 | Confident | `hubEvent.String()` decodes raw `event` envelopes back to the SSE-style debug frame, leaving all `sse_test.go`/`boards_test.go` string assertions untouched | The intake's audit directs updating `String()` and/or direct-field reads to assert decoded semantics; decoding in `String()` satisfies every existing assertion with the smallest diff and zero assertion weakening | S:75 R:85 A:85 D:70 |
| 3 | Confident | `TestStateWS_SubscribeAckNotStaleUnderPollInterleave`'s writer goroutine keeps constructing a structured `sessions` event | It deliberately models a producer critical section, and structured events remain a supported shape (preview/replay/chat still use it); its assertions are envelope-decoded and unaffected by render location | S:60 R:90 A:80 D:65 |

3 assumptions (0 certain, 3 confident, 0 tentative).

## Deletion Candidates

- None — this change re-renders the same events through the existing `raw` bypass; no existing file, function, branch, or config becomes redundant or unused. `kind`/`key`/`data` on `hubEvent` remain load-bearing for the structured paths that stay (preview, cached replays, `gone` markers, chat), and `renderEnvelope` is untouched.
