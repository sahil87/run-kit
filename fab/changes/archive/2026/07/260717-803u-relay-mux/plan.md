# Plan: Relay Mux — one terminal WebSocket per tab

**Change**: 260717-803u-relay-mux
**Intake**: `intake.md`

## Requirements

<!-- Requirements/Decisions lifted from fab/plans/sahil/socket-unification.md §Change 2,
     §Terminal socket, D1–D6, and the Risk register. Decisions D1–D6 are MADE — not re-opened. -->

### Backend: `/ws/terminals` mux handler

#### R1: One muxed terminals WebSocket per tab
The backend SHALL expose a new `GET /ws/terminals` WebSocket endpoint (in `app/backend/api/`, sibling of `state_ws.go`) that carries all pane relay streams for a tab over a single connection, registered in `router.go`.

- **GIVEN** a browser tab with N live panes
- **WHEN** the frontend opens its terminals socket and issues N `open` ops
- **THEN** all N pane relays ride the one `/ws/terminals` connection (no per-pane `/relay/` socket)
- **AND** the tab holds exactly one terminals WebSocket regardless of N

#### R2: Wire protocol — binary data frames + JSON control ops
The handler SHALL speak the protocol lifted verbatim from the plan §Terminal socket: binary frames `[u32 BE streamId][payload]` in both directions (server→client output, client→server keystrokes), and JSON text frames for control.

- Client→server control: `{"op":"open","id":<u32>,"server":<str>,"windowId":"@N","cols":<u16>,"rows":<u16>}`, `{"op":"resize","id":<u32>,"cols":<u16>,"rows":<u16>}`, `{"op":"close","id":<u32>}`
- Server→client control: `{"op":"opened","id":<u32>}`, `{"op":"closed","id":<u32>,"code":<4004|4001|1000>,"reason":<str>}`
- **GIVEN** an `open` op naming a valid window with initial `cols`/`rows`
- **WHEN** the stream attaches successfully
- **THEN** the server replies `opened` for that `id` and thereafter emits output as binary frames tagged with that `id`
- **AND** a `resize` op for a live `id` sets the PTY size; a `close` op tears the stream down and replies `closed` code 1000
- **AND** stream IDs are client-allocated u32s unique within the connection

#### R3: Per-stream behavior preserves `handleRelay` semantics exactly
Each stream SHALL reproduce `handleRelay` (`relay.go:49-208`) per-stream: window-ID validation via the shared `validate.ValidateWindowID` validator (the same validator `decodeWindowID` wraps, so REST and mux entry points cannot drift — constitution §I), `ResolveWindowSession` (5s timeout) → session-scoped `SelectWindowInSession`, `forceTERM` (TERM=xterm-256color replaces inherited), best-effort `tmux.ReloadConfig`, and `pty.StartWithSize` at the `open` frame's initial `cols`/`rows` (replacing the wait-for-first-resize dance — the size rides the open op).

- **GIVEN** an `open` op with a malformed or non-existent window ID
- **WHEN** validation fails or `ResolveWindowSession` returns empty/error
- **THEN** the server emits a `closed` control event for that stream `id` with code 4004 / reason "Window not found" — the socket itself does NOT close
- **AND** a failed `pty.StartWithSize` emits `closed` code 4001 / reason "Failed to attach to tmux session"
- **AND** stream close (client `close`, PTY EOF, or socket teardown) cancels the attach context, closes the ptmx, and kills the attach process (`sync.Once`-guarded) — no orphaned attach processes

#### R4: Per-stream bounded send queues + fair scheduler (D3, v1 requirement)
The write path SHALL use per-stream bounded send queues (8 × 4096B) drained by a single writer goroutine that schedules round-robin across ready streams with control frames and short/interactive frames prioritized ahead of bulk output (never FIFO across streams). A full per-stream queue SHALL pause that stream's PTY reader (backpressure), NEVER drop bytes.

- **GIVEN** two streams on one socket, stream A flooding 4096B frames and stream B echoing small interactive frames
- **WHEN** A saturates its queue
- **THEN** B's echo frames are scheduled ahead of A's bulk backlog (bounded interactive latency), A's PTY reader pauses when A's queue is full, and no bytes are dropped on either stream
- **AND** control frames (`opened`/`closed`) are never delayed behind a stream's bulk output

#### R5: HOL scheduler Go unit test with an injectable paced writer
A Go unit test SHALL assert the scheduler bound with no real network: with stream A flooding through an injectable paced writer (a pacing seam), a stream B echo frame is written within a bounded number of frames.

- **GIVEN** the scheduler wired to a paced writer that sleeps proportional to bytes written
- **WHEN** stream A floods and a stream B echo frame is enqueued
- **THEN** the B frame is written within a small bounded number of A frames (asserting non-FIFO fairness; the test pins the observable bound, not the exact RR variant)

#### R6: Retire `/relay/{windowId}` + `handleRelay` (D2)
`handleRelay` and its `GET /relay/{windowId}` route SHALL be removed in this same change, with no deprecation shim (the frontend is the sole consumer — constitution IV). Relay-behavior tests (`relay_test.go`) SHALL be ported to per-stream `/ws/terminals` equivalents (4004-on-bad-window, initial-size attach, TERM forcing, no ephemeral session leak); `socketsweep_test.go` and any other test asserting the old route SHALL be updated in the same commit.

- **GIVEN** the change is applied
- **WHEN** the router is built
- **THEN** no `/relay/{windowId}` route exists and `handleRelay` is gone
- **AND** the ported `relay_test.go` equivalents assert the same behaviors against `/ws/terminals`

### Frontend: `RelayMux` singleton + `TerminalClient` port

#### R7: `RelayMux` singleton owning the one terminals socket
A new frontend module SHALL provide a `RelayMux` singleton (near the `src/lib` layer, mirroring `state-socket.ts`) that owns one `/ws/terminals` WebSocket per tab and exposes `openStream({server, windowId, cols, rows}) → { send, resize, close, onData, onClosed }`. It SHALL reconnect socket-level drops with exponential backoff; on reconnect each live stream re-issues its `open` (the per-pane reconnect path re-inits).

- **GIVEN** multiple panes calling `openStream`
- **WHEN** each opens a stream
- **THEN** all streams share the one socket; each handle's `send` emits a binary data frame tagged with the stream's id, `resize` emits a `resize` control op, `close` emits a `close` control op, `onData` fires on inbound binary frames for that id, and `onClosed` fires on the `closed` control event for that id
- **AND** on a socket drop the mux reconnects with backoff and re-`open`s every still-live stream

#### R8: `TerminalClient` port — four delicate seams preserved
`TerminalClient` SHALL consume a `RelayMux` stream handle in place of its own `new WebSocket` at `terminal-client.tsx:813` (the ONLY socket-creation site replaced), preserving its exact external behavior across four seams: (1) confirmation-gated window-switch receipt = first data frame per stream (was socket `onmessage`); (2) connect-select alignment epoch anchors on the `open`→`opened` exchange; (3) IntersectionObserver pane suspension = stream `close`/`open` (no socket churn); (4) the deferred per-connection reset becomes per-stream. The shared `wsRef` seam (consumed by `BottomBar`, `ComposeBuffer`, touch-scroll, `fitAndSync`) SHALL keep its `{ readyState, send, close }` shape via a WebSocket-shaped adapter over the stream handle.

- **GIVEN** the terminal-client test suite (deferred reset, connection identity, font-resize) and the window-switch-transition e2e suite
- **WHEN** the port is applied
- **THEN** all those behaviors hold: same-session windowId switch rides the stream without close/reset, cross-session switch closes+reopens exactly one stream with the deferred reset before the first write, transient drop reconnects to the latest windowId, 4004 fires `onSessionNotFound`, and font change sends one `resize`
- **AND** `BottomBar`/`ComposeBuffer` keystroke + paste sends still reach the pane via `wsRef.current.send(...)`

### Tests & e2e

#### R9: Connection guard tightens to exactly 2 WS + 0 SSE
`app/frontend/tests/e2e/connection-budget.spec.ts` SHALL assert each route holds exactly **2 WebSockets total** (`/ws/state` + `/ws/terminals`) and zero `text/event-stream` responses; the per-pane `/relay/` classifier is replaced by a `/ws/terminals` classifier. The `.spec.md` companion SHALL be updated in the same commit-unit (constitution: Test Companion Docs).

- **GIVEN** any of the four route types (Host `/`, tmux Server `/$server`, Terminal `/$server/$window`, Board `/board/$name`)
- **WHEN** the page loads and connects
- **THEN** the live-socket count is exactly 1 `/ws/state` + (0 or 1) `/ws/terminals` — the Host and bare-server routes hold only state; the Terminal and Board routes add exactly one `/ws/terminals` — and the `text/event-stream` response list is empty
- **AND** the `.spec.md` documents the tightened budget

### Non-Goals

- Chat SSE (change 3, `chat-on-state-socket`) — not this change.
- Merging the two WebSockets into one (D6 — decided against; bulk binary must not share a send buffer/scheduler with state events).
- SharedWorker socket ownership; ws-over-h2 (RFC 8441); TLS/HTTPS changes; proxied-iframe pool consumption (documented residual).
- Any change to `/ws/state`, the chat send path, or Web Push.

### Design Decisions

1. **`wsRef` adapter over the stream handle** (R8): the stream handle is surfaced through the existing `wsRef: MutableRefObject<WebSocket | null>` as a minimal WebSocket-shaped object (`readyState`, `send`, `close`). — *Why*: `BottomBar`, `ComposeBuffer`, touch-scroll, and `fitAndSync` all consume `wsRef.current.{send,readyState,close}`; adapting at this seam keeps them untouched and localizes the port to `terminal-client.tsx`. The adapter's `send(data)` routes a `{type:"resize"}` JSON string to the stream's `resize` op and everything else (keystrokes, SGR, paste) to a binary data frame. — *Rejected*: rewiring every `wsRef` consumer to a new handle type (larger blast radius, no behavioral gain).
2. **Two-queue priority scheduler** (R4): per-stream bounded queue + a control/short-frame priority tier ahead of bulk, drained round-robin across ready streams. — *Why*: spike-2 proved a two-queue priority shape bounds interactive RTT at zero goodput cost; the exact RR variant (plain vs deficit) is unobservable to the pinned test bound. — *Rejected*: shared FIFO (spike measured 1.66s echo p50 under flood).
3. **Window-ID validation via `validate.ValidateWindowID`** (R3): the mux validates the `open` op's already-decoded `windowId` with the same underlying validator `decodeWindowID` wraps. — *Why*: the window ID arrives decoded in JSON (no path-percent-encoding), so the raw-string validator is the correct shared seam; entry points still cannot drift (same validator). — *Rejected*: a new bespoke validator (would reintroduce the drift bug #205 risk).

## Tasks

### Phase 1: Backend scheduler + handler core

- [x] T001 Add the per-stream scheduler primitive in a new `app/backend/api/terminals_ws.go`: a `streamQueue` (bounded 8×4096B), a control/short-frame priority path, and a single-writer scheduling loop draining round-robin across ready streams with an injectable paced-writer seam (a `writeFrame func([]byte) error` field defaulting to the real `conn.WriteMessage`). <!-- R4 -->
- [x] T002 Add the HOL scheduler Go unit test `app/backend/api/terminals_ws_test.go`: wire the scheduler to a paced writer (sleeps ∝ bytes), flood stream A, enqueue a stream-B echo, assert B is written within a small bounded number of A frames. <!-- R5 -->

### Phase 2: Backend mux handler + per-stream lifecycle

- [x] T003 Implement `handleTerminalsWS` in `terminals_ws.go`: upgrade, per-connection stream registry (map[u32]*stream guarded by a mutex), read loop dispatching binary data frames (route payload to the stream's ptmx) and JSON control ops (`open`/`resize`/`close`), and the writer pump from T001. Mirror `state_ws.go`'s Background-rooted lifecycle context, writer-pump-on-send-channel, and cleanup-deadline pattern. <!-- R1 R2 --> <!-- rework: S2 — startStream runs synchronously in the socket read loop (resolve ≤5s + select + ReloadConfig + pty attach serialize behind every other pane's keystrokes/opens); dispatch to a goroutine, registering a placeholder under tc.mu first so duplicate-id checks and racing resize/close ops stay deterministic -->
- [x] T004 Implement `startStream` (extracted from `handleRelay`'s guts) in `terminals_ws.go`: validate windowId via `validate.ValidateWindowID` → `ResolveWindowSession` (5s ctx) → `SelectWindowInSession` → `forceTERM` + best-effort `ReloadConfig` → `pty.StartWithSize` at the open op's cols/rows; on any failure emit a `closed` control event (4004 resolve/select, 4001 attach) WITHOUT closing the socket; on success emit `opened` and start the per-stream PTY reader as the queue producer (pauses when the queue is full — backpressure, no drop). <!-- R2 R3 R4 --> <!-- rework: M2 — opened rides the reserved control pseudo-stream while data rides the stream's own queue, so under a busy writer the first data frame can precede opened (client arms the deferred reset at onOpened → stale repaint / late reset wipe); enqueue opened into the stream's OWN queue before starting pumpPTY (failed opens keep the control stream — they emit no data) -->
- [x] T005 Implement per-stream cleanup (client `close` op, PTY EOF, socket teardown): `sync.Once`-guarded cancel + ptmx close + process kill, remove from the registry, emit `closed` code 1000 on graceful client close. On socket teardown, tear down all streams. <!-- R3 -->
- [x] T006 Register `GET /ws/terminals` in `router.go` and remove the `GET /relay/{windowId}` route; delete `handleRelay` and now-unused helpers from `relay.go` (keep `forceTERM`/`resizeMsg`/`upgrader` if still shared, else relocate into `terminals_ws.go`). <!-- R1 R6 --> <!-- rework: S3+S4 retirement aftermath — docs/specs/api.md:331,436 still specifies WS /relay/:session/:window as the live surface (edit to /ws/terminals); windows.go:112-117 decodeWindowID doc still cites the deleted handleRelay as its second entry point (rewrite the two-entry-point rationale) -->

### Phase 3: Backend tests port

- [x] T007 Port `relay_test.go` to `/ws/terminals` per-stream equivalents: dial `/ws/terminals`, send `open`, assert `opened` + rendered window bytes (direct-attach, no ephemeral session leak); bad-window `open` → `closed` 4004 with the socket still open; initial-size attach via the open op's cols/rows; TERM forcing. Update `socketsweep_test.go` and any other test referencing `/relay/`. <!-- R6 R3 --> <!-- rework: M3 — the port never asserts the opened reply, initial-size attach via the open op's cols/rows, TERM forcing, resize, or client-close→closed 1000, all SHALL-listed by R6/T007; add these assertions (they also pin M2's opened-before-data ordering) -->

### Phase 4: Frontend RelayMux + TerminalClient port

- [x] T008 Add `app/frontend/src/lib/relay-mux.ts`: the `RelayMux` singleton owning one `/ws/terminals` WebSocket (URL built like `stateSocketURL()`), client-allocated u32 stream ids, `openStream({server,windowId,cols,rows}) → {send,resize,close,onData,onClosed}`, binary `[u32 BE streamId][payload]` framing + JSON control ops, backoff reconnect (1s→cap), and re-`open` of every live stream on reconnect. <!-- R7 --> <!-- rework: M1 — reconnect re-issues open from opts captured at openStream time (only cols/rows refreshed), so after a same-session windowId ride a transient drop re-attaches to the OLD window and SelectWindowInSession yanks the pane back; keep the stream's target fresh (handle method updating opts.windowId on rides, or RelayMux pulls current opts via callback at re-open time) -->
- [x] T009 Add `app/frontend/src/lib/relay-mux.test.ts`: unit-test framing (open/resize/close ops, binary data in/out demuxed by id, `opened`/`closed` dispatch to the right handle) and reconnect re-open, against a stubbed WebSocket. <!-- R7 --> <!-- rework: M1 — extend the reconnect re-open test to assert the re-issued open carries the stream's LATEST windowId (post-ride), not the openStream-time one -->
- [x] T010 Port `terminal-client.tsx`: replace the `new WebSocket(...)` at :813 with `RelayMux.openStream(...)`; wrap the handle in a WebSocket-shaped adapter assigned to `wsRef.current` (`readyState`, `send` routing resize-JSON→`resize` op / else→binary `send`, `close`); route `onData` into the existing write/coalesce+deferred-reset path (seam 1: `notifyFirstWrite` on first data frame per stream) and `onClosed` into the existing close handler (4004→`onSessionNotFound`, else backoff via the mux/per-pane path); anchor the connect-select epoch on `open`→`opened` (seam 2); keep IntersectionObserver suspension as stream close/open (seam 3) and the deferred reset per-stream (seam 4). <!-- R8 --> <!-- rework: M1 — wire the same-session windowId ride (windowIdRef, :647-654) to the stream handle's fresh-target mechanism so reconnect targets the CURRENT window; S1 — non-4004 closed (1000/4001) is a silent dead-end (old client printed "[reconnecting…]" and self-healed): print feedback + probe one re-open (a gone window then 4004s → redirect); S4 — the :509-513 comment claims reconnect targets "the window the user is looking at NOW" (false until M1 lands; fix comment with the code) -->
- [x] T011 Update `terminal-client.test.tsx`: the existing deferred-reset / connection-identity / font-resize suites must pass against the ported client — replace the `MockWebSocket`-URL assertions (`/relay/...`) with the mux-stream equivalent (mock `RelayMux`/`openStream` or assert the w-shaped adapter's `send`/`resize`/`close` + driven `onData`/`onClosed`), preserving every behavioral assertion (same-session ride, cross-session close+reopen, transient-drop latest-windowId, resolved→"" probe, 4004 redirect, font resize once). <!-- R8 --> <!-- rework: M1 — the transient-drop-LATEST-windowId assertion (T011's explicit list) was replaced with a weaker cross-session-reopen one; restore it against the mux (drop the socket after a same-session ride, assert the re-open carries the ridden-to windowId); also cover S1's non-4004 closed feedback+probe path -->

### Phase 5: e2e guard + companion

- [x] T012 Tighten `app/frontend/tests/e2e/connection-budget.spec.ts`: replace the `/relay/` classifier with a `/ws/terminals` classifier and assert each route's live-socket budget = 1 `/ws/state` + the expected `/ws/terminals` count (0 on Host/bare-server, 1 on Terminal/Board) with zero `text/event-stream`. Update `connection-budget.spec.md` in the same commit. <!-- R9 -->

## Execution Order

- T001 blocks T002, T003, T004 (scheduler primitive underlies the handler + test).
- T003 blocks T004, T005 (registry + read loop underlie stream lifecycle).
- T004, T005 block T006 (handler must exist before the route swap removes the old one).
- T006 blocks T007 (tests target the new route).
- T008 blocks T009, T010 (module underlies its test + the client port).
- T010 blocks T011 (client port before its test update).
- Backend phases (1-3) and frontend phases (4-5) are independent and may proceed in parallel; the e2e guard (T012) needs both the backend route and the frontend mux live to pass.

## Acceptance

### Functional Completeness

- [x] A-001 R1: A tab with N panes holds exactly one `/ws/terminals` WebSocket carrying all N pane streams; `GET /ws/terminals` is registered in `router.go`. <!-- review 803u: router.go:578; connection-budget e2e 4/4 green -->
- [x] A-002 R2: The handler speaks binary `[u32 BE streamId][payload]` + JSON `open`/`opened`/`resize`/`close`/`closed`; `open` with initial cols/rows attaches and replies `opened`; `resize` sets PTY size; `close` tears down and replies `closed` 1000. <!-- review 803u cycle 2: M2 fixed (opened enqueued on the stream's OWN queue before pumpPTY — FIFO + short-priority guarantees opened→data) and M3 closed (TestTerminals_OpenedPrecedesData / _InitialSizeAndTERM / _ResizeSetsClientSize / _ClientCloseYields1000 all green, -race) -->
- [x] A-003 R3: Each stream reproduces `handleRelay` (validate → resolve → session-scoped select → forceTERM → ReloadConfig → StartWithSize at open cols/rows) with `sync.Once`-guarded cleanup; no orphaned attach processes. <!-- review 803u: verified by inspection + ported tests (4004 malformed/missing, no-ephemeral, direct-attach) -->
- [x] A-004 R4: Per-stream bounded queues (8×4096B) + a control/short-priority round-robin scheduler; a full queue pauses that stream's PTY reader and never drops bytes. <!-- review 803u: terminals_ws.go scheduler + HOL/no-starvation unit tests green -->
- [x] A-005 R5: The HOL Go unit test asserts a stream-B echo is written within a bounded number of frames while stream A floods through a paced writer. <!-- review 803u: TestScheduler_EchoNotHeadOfLineBlocked green -->
- [x] A-006 R7: `RelayMux` is a singleton owning one socket; `openStream` returns `{send,resize,close,onData,onClosed}` and re-opens live streams on reconnect. <!-- review 803u: relay-mux.test.ts green; apply added onOpened beyond the listed shape — judged justified (seam 2/4 needs the re-open signal) -->
- [x] A-007 R8: `terminal-client.tsx:813` is the only replaced socket-creation site; the four seams (first-data-frame receipt, open→opened epoch, suspension=close/open, per-stream deferred reset) are preserved. <!-- review 803u cycle 2: MET — M2 fixed server-side (opened strictly precedes first data, pinned by TestTerminals_OpenedPrecedesData) so seam 2/4's onOpened re-arm is sound; M1 fixed (stream.setWindowId pushed from the windowId-keyed effect keeps the re-open target fresh; cross-session switches still close+reopen via the epoch bump — both pinned by unit tests) -->
- [x] A-008 R9: `connection-budget.spec.ts` asserts exactly 2 WS (`/ws/state` + `/ws/terminals`) + 0 SSE across the four routes; `.spec.md` updated in the same commit. <!-- review 803u: 4/4 green; companion updated -->


### Behavioral Correctness

- [x] A-009 R3: A bad-window `open` yields a `closed` 4004 control event and the socket stays open (verified by the ported `relay_test.go` equivalent). <!-- review 803u: TestTerminals_MissingWindowClosed4004 + TestTerminals_BadWindowIDClosed4004 green -->
- [x] A-010 R6: No `/relay/{windowId}` route and no `handleRelay` remain; ported tests target `/ws/terminals`; `socketsweep_test.go` no longer references the old route. <!-- review 803u: repo sweep clean (comments only); socketsweep's rk-relay-* row is a name-parser case, not the route -->
- [x] A-011 R8: The terminal-client test suite passes — same-session ride (no close/reset), cross-session close+reopen with deferred reset before first write, transient-drop reconnect to latest windowId, resolved→"" probe, 4004 redirect, one resize on font change. <!-- review 803u cycle 2: MET — suite green (1364 frontend tests); the transient-drop-latest-windowId assertion is restored split across the seam: terminal-client.test.tsx:680 pins the ride pushing setWindowId("@5") into the live stream, relay-mux.test.ts:225 pins the reconnect re-issuing open with the ridden-to windowId; S1's non-4004 feedback+one-probe path covered (three tests, :770/:800/:821) -->
- [x] A-012 R8: The window-switch-transition e2e suite is green (confirmation gate, bounce-back, grace mask) — the gate receipt source change (socket onmessage → first data frame per stream) preserves behavior. <!-- review 803u: e2e green; gate unit tests green -->


### Removal Verification

- [x] A-013 R6: `relay.go`'s `handleRelay` and the route registration are deleted; any residual shared helpers are relocated or removed with no dead code. <!-- review 803u: relay.go retains only the shared upgrader + forceTERM (deliberate); resizeMsg deleted; see Deletion Candidates for the fold-into-terminals_ws option -->

### Scenario Coverage

- [x] A-014 R4: Manual/e2e — two panes on one board, one running `yes`; typing latency in the other stays interactive (spike scenario in vivo; also exercises PTY-reader-pause backpressure). <!-- review 803u: verified in vivo via a throwaway e2e probe (deleted after the run): echo ~421ms under a sustained ~10MB/s co-pane seq flood, flood stream kept flowing (11.5→45MB across snapshots), zero closed events / socket churn -->

### Edge Cases & Error Handling

- [x] A-015 R3: A failed `pty.StartWithSize` emits `closed` 4001 for that stream without closing the socket; socket teardown tears down all streams. <!-- review 803u cycle 2: verified by inspection (attachStream 4001 failClosed path + teardown loop); the 4001 path itself still has no dedicated test (forcing StartWithSize to fail needs a seam that doesn't exist — accepted; the M3 finding never required it) -->
- [x] A-016 R7: A socket-level drop reconnects with backoff and each live pane re-issues `open` (fresh ids); RefreshButton remains the manual recovery affordance. <!-- review 803u cycle 2: reconnect + re-open verified (unit tests); DEVIATION stands: implementation reuses the SAME stream id on the new connection (valid — ids are per-connection) rather than "fresh ids"; reconcile wording at hydrate. The M1 stale-windowId defect on that re-open is FIXED (re-open now reads s.opts kept fresh by setWindowId/resize) -->

### Code Quality

- [x] A-017 Pattern consistency: `terminals_ws.go` follows `state_ws.go`'s conventions (Background-rooted ctx, writer pump, cleanup deadline); `relay-mux.ts` follows `state-socket.ts`'s conventions (backoff, URL builder, singleton lifecycle). <!-- review 803u -->
- [x] A-018 No unnecessary duplication: window-ID validation reuses `validate.ValidateWindowID`; the mux reuses `ResolveWindowSession`/`SelectWindowInSession`/`forceTERM`/`ReloadConfig` rather than reimplementing. <!-- review 803u -->
- [x] A-019 Security: all tmux subprocess calls stay on `exec.CommandContext` with timeouts (resolve 5s); no shell strings; per-stream cleanup kills the attach process on disconnect (no session leak). <!-- review 803u: attach uses CommandContext with cancel (long-lived, matches old design); resolve 5s; sync.Once cleanup -->
- [x] A-020 Frontend type narrowing: the stream-handle/`wsRef` adapter uses discriminated types / guards over `as` casts where practical. <!-- review 803u: control/data narrowing is guard-based; the `adapter as unknown as WebSocket` double-cast is the documented Design Decision 1 tradeoff — nice-to-have: a structural wsRef type would remove it -->


## Notes

- Check items as you review: `- [x]`
- Known pre-existing e2e issues NOT attributable to this change: `window-heading` history-arrows flake; "Maximum update depth exceeded" console errors.
- Testing via `just` recipes only (`just test-backend`, `just test-frontend`, `just test-e2e "<spec>"`); `cd app/backend && go test ./...` acceptable for Go. `just pw` unreliable here — use `just test-e2e "<spec>:<line>"`.

## Deletion Candidates

<!-- review 803u cycle 2: replaced in place — the windows.go decodeWindowID-comment and relay-mux.ts StreamState.opened rows were resolved by the rework (S4 rewrote the comment; the write-only field was removed). -->

- `app/backend/api/relay.go` — the file now holds only the shared `upgrader` and `forceTERM`; both could move into `terminals_ws.go` and the file be deleted (its name no longer matches any endpoint).
- `app/frontend/vite.config.ts:33-36` (the `/relay` dev-proxy block) — proxies a retired endpoint; no backend route answers it. The `/ws` block covers `/ws/terminals`. Dead config, delete.
- `app/backend/api/terminals_ws.go` (`outFrame.payload()`) — no production call sites; used only by the scheduler unit tests' paced writer.
- `app/frontend/src/lib/relay-mux.ts` (`RelayMux.close()`) — no production call site (nothing wires tab-unload); exercised only by relay-mux.test.ts for inter-test cleanup.
- `app/backend/api/relay_test.go` helper names (`withRelayTmux`, `relayServerWithProdTmux`, "relay" prose) — naming outlived the retired endpoint; cosmetic rename opportunity.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | New handler lives in `app/backend/api/terminals_ws.go` (+`_test.go`), frontend module in `app/frontend/src/lib/relay-mux.ts` (+`.test.ts`) | Intake assumption 7 (Confident) + change-1 precedent (`state_ws.go`, `state-socket.ts`); trivially renameable | S:70 R:95 A:85 D:80 |
| 2 | Certain | The stream handle is surfaced through the existing `wsRef` seam via a WebSocket-shaped adapter (`readyState`/`send`/`close`); `send` routes resize-JSON→`resize` op, else→binary data frame | `BottomBar`/`ComposeBuffer`/touch-scroll/`fitAndSync` all consume `wsRef.current.{send,readyState,close}`; adapting localizes the port to `terminal-client.tsx` (intake: ":813 is the only creation site replaced") | S:85 R:80 A:85 D:80 |
| 3 | Certain | Window-ID validation uses `validate.ValidateWindowID` directly (the `open` op's windowId is already JSON-decoded, no path-percent-encoding) | Same underlying validator `decodeWindowID` wraps; entry points cannot drift (intake R3 intent) | S:85 R:85 A:90 D:85 |
| 4 | Confident | Scheduler is a two-queue priority shape (control/short frames ahead of bulk) drained round-robin, with an injectable `writeFrame`/paced-writer seam; exact RR variant (plain vs deficit) left to apply within the pinned test bound | Intake assumption 8 (Confident); spike-2 proved the two-queue shape; the Go test pins the observable bound, not the algorithm | S:75 R:90 A:80 D:70 |
| 5 | Confident | The terminal-client test suite is updated to mock `RelayMux`/`openStream` (or assert the adapter's `send`/`resize`/`close` + driven `onData`/`onClosed`) rather than a raw `MockWebSocket` URL, preserving every behavioral assertion | Intake assumption 10 (Confident) — equivalence is empirical; the tests assert behavior (reset ordering, identity, resize) that the port must reproduce, not the transport internals | S:75 R:70 A:75 D:70 |
| 6 | Certain | (rework M1) The stream's reconnect target is kept fresh via a `setWindowId(windowId)` handle method the client calls on same-session rides (over the alternative "RelayMux pulls opts via callback at re-open"); cols/rows already stay fresh via `resize()`, so `s.opts` is the single current source RelayMux re-issues `open` from | Review offered both; the setter mirrors the old `windowIdRef.current` read at connect() exactly and keeps `s.opts` the one fresh source; no wire op on a ride (the live PTY already tracks the active window) | S:90 R:85 A:90 D:85 |
| 7 | Certain | (rework M2) `opened` is enqueued onto the stream's OWN bounded queue before `pumpPTY` starts (channel FIFO + short-frame priority ⇒ opened precedes data); a failed open keeps `closed` on the reserved control pseudo-stream (it emits no data, so no ordering concern) | Review's explicit fix direction; pinned by `TestTerminals_OpenedPrecedesData` | S:90 R:85 A:90 D:90 |
| 8 | Confident | (rework S1) A non-4004 stream `closed` (1000/4001) probes exactly ONE fresh re-open of the current window (bounded via a `probedReopen` flag), printing `[reconnecting…]`; a gone window then 4004s the probe → `onSessionNotFound`; a second non-4004 close prints `[disconnected]` and stops | Restores the old per-pane self-heal without a per-pane reconnect loop; RelayMux only re-opens on a SOCKET drop, not a stream-level close, so the client owns this probe; bounding to one avoids a hard-failing-window spin | S:75 R:80 A:80 D:75 |
| 9 | Confident | (rework S2) `startStream` registers a placeholder stream synchronously under `tc.mu` (queue + closed chan, nil ptmx) then dispatches resolve→select→ReloadConfig→attach to a goroutine (`attachStream`); data/resize for a placeholder (nil ptmx) are dropped; a close/teardown racing the attach is handled by the stillLive/publish-under-lock guards | Review's explicit fix direction (placeholder-first keeps duplicate-id / racing resize+close deterministic); `-race` clean across the terminals+scheduler suite | S:75 R:80 A:80 D:75 |

9 assumptions (5 certain, 4 confident, 0 tentative).
