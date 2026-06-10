# Plan: Defer Terminal Reset to First Write (Window-Switch Flicker Fix)

**Change**: 260610-qf25-defer-terminal-reset-flicker
**Status**: In Progress
**Intake**: `intake.md`

## Requirements

### Frontend: Deferred terminal reset

#### R1: Reset runs at first-write time, not receipt time
`terminal.reset()` SHALL NOT run at message-receipt time in `ws.onmessage`. Instead, it MUST execute immediately before the first chunk of a connection is written to xterm, in BOTH write paths of the adaptive flush: (a) the immediate synchronous path (`canWriteImmediately` — reset, then `terminal.write(chunk)` in the same tick) and (b) the rAF-coalesced path (reset at the top of `flushToTerminal`, in the same rAF callback — same frame — as the buffered content paint). Both string and binary (`ArrayBuffer` → `Uint8Array`) first chunks MUST trigger the deferred reset, whichever path they take. File: `app/frontend/src/components/terminal-client.tsx`.

- **GIVEN** a new relay WebSocket connection whose first chunk is large (>64 UTF-8 bytes, taking the rAF-coalesced path)
- **WHEN** the chunk arrives in `ws.onmessage`
- **THEN** `terminal.reset()` is NOT called at receipt time
- **AND** when the scheduled `flushToTerminal` runs, `terminal.reset()` executes first, followed by the buffered write — clear + repaint within one presented frame, no fully-cleared frame

- **GIVEN** a new connection whose first chunk is small (≤64 bytes, idle, first this frame — the immediate path)
- **WHEN** the chunk arrives
- **THEN** `terminal.reset()` runs synchronously immediately before `terminal.write(chunk)` in the same tick

#### R2: Per-connection arming, exactly once per connection
Every `connect()` call MUST re-arm the reset (preserving the current per-connection semantic of `needsReset = true`), and the reset MUST run exactly once per connection — after the first chunk of a connection is written (via either path), subsequent chunks and flushes of that connection perform no reset. Arming MUST happen inside `connect()` and not earlier (e.g., not in the reconnect timer), preserving the verified sequencing property that an old connection's close-time flush runs before the next connection re-arms. All reconnect paths get a reset before their first write: same-session redundant reconnects, cross-session switches, and transient-drop reconnects (`reconnectTimer` → `connect()` in `ws.onclose`).

- **GIVEN** a connection that has already written its first chunk (reset consumed)
- **WHEN** subsequent chunks arrive and flush on that same connection
- **THEN** no further `terminal.reset()` occurs

- **GIVEN** a connection that drops (non-4004 close) and the reconnect timer fires `connect()` again
- **WHEN** the new connection's first chunk is written
- **THEN** `terminal.reset()` runs again (re-armed for the new connection)

#### R3: Close-time and empty flushes never misfire the reset
The close-time `flushToTerminal()` in `ws.onclose` (which runs BEFORE the `cancelled` check, so it also drains at effect teardown) MUST NOT fire a reset armed for a *different* connection when draining a previous connection's buffered tail data. An empty flush (no text buffered, no binary buffered) MUST NOT consume or execute a pending reset — resetting on no data would wipe the screen with nothing to repaint, recreating the flicker. A zero-message connection (reset armed, never fired) MUST NOT corrupt the next connection's state: its empty close-time flush leaves the pending reset unconsumed and unexecuted, and the next `connect()` re-arms idempotently. (A close-time flush that drains the *same* connection's never-written first data MAY fire that connection's own reset — that is the connection's first write.)

- **GIVEN** a connection that received zero messages (reset armed but never fired)
- **WHEN** it closes and `ws.onclose` runs `flushToTerminal()` with empty buffers
- **THEN** no `terminal.reset()` occurs

- **GIVEN** a connection that consumed its reset (first chunk written) and then buffered additional tail data with the flush rAF still pending
- **WHEN** the connection closes and the close-time `flushToTerminal()` drains the tail
- **THEN** the tail data is written with NO reset

The WebSocket effect's cleanup MUST additionally neutralize the closure's pending write state (`pendingReset = false; textBuffer = ""; binaryBuffers = [];`) so a dead connection's asynchronously-delivered `onclose` drain — which runs before the `cancelled` check — is a no-op against the shared terminal. The drain itself MUST NOT be guarded on `cancelled` (the same-effect transient-drop drain must keep working). *(Review fold-in: cross-effect late-drain hazard.)*

- **GIVEN** a `windowId` change while a connection's first (>64-byte) chunk is still buffered (rAF pending, reset unconsumed)
- **WHEN** the effect cleanup runs and the old socket's `onclose` is delivered afterwards
- **THEN** the orphaned drain neither resets the terminal nor writes the stale chunk

#### R4: Adaptive-flush invariants unchanged
The deferral SHALL compose with the adaptive flush without modifying it: `IMMEDIATE_WRITE_MAX_BYTES` (64), the UTF-8 byte-length measurement (`textByteLength`), the one-immediate-write-per-frame guard (`wroteImmediatelyThisFrame` / `markImmediateWrite`), and the ordering guarantee (once anything is buffered, subsequent chunks buffer until drain; an immediate write only happens when the buffer is empty AND no flush is pending) MUST all remain unchanged.

- **GIVEN** the implemented change
- **WHEN** the adaptive-flush machinery is diffed against the pre-change code
- **THEN** thresholds, byte measurement, frame guard, and buffering/ordering logic are byte-equivalent except for the reset-consumption hook and the empty-flush guard

### Frontend: Comment accuracy

#### R5: Rewrite the stale WebSocket-effect comment block
The comment block above the WebSocket effect (currently ~lines 479-492, describing the deleted 260508-hdjr per-WebSocket ephemeral grouped-session relay) MUST be replaced with an accurate description of the current move-based pin-session backend design: `app/backend/api/relay.go` resolves the window's real owning session via `ResolveWindowSession` (a window lives in exactly ONE session — its home session or its `_rk-pin-*` board pin-session), runs a session-scoped `SelectWindowInSession` (`tmux select-window -t <session>:@N`), and attaches the PTY directly to that real session — no ephemeral, no defer-kill. The comment MUST note that same-session reconnects are now redundant (the REST selectWindow already redraws the attached PTY in place) and that a follow-up change will eliminate them by keying the WS effect teardown on the resolved owning session instead of windowId — explicitly NOT part of this change.

- **GIVEN** the rewritten comment
- **WHEN** compared against `app/backend/api/relay.go` (ResolveWindowSession at ~79, SelectWindowInSession at ~100, direct attach at ~140-143)
- **THEN** every claim in the comment matches the current backend behavior, and no reference to the ephemeral grouped-session design remains

### Tests: Reset-ordering coverage

#### R6: Unit tests prove the deferred-reset ordering
Unit tests in `app/frontend/src/components/terminal-client.test.tsx` (existing harness: mocked `@xterm/xterm` with `reset`/`write` spies, mocked WebSocket) MUST cover: (a) no reset before the first chunk write of a connection — no receipt-time reset; (b) reset runs exactly once per connection; (c) reset fires for both string and binary first chunks (covering both the immediate and rAF-coalesced paths); (d) reset is re-armed on reconnect — a new connection's first write resets again. Tests SHOULD also cover the R3 handoff edges (zero-message close, post-consumption tail drain). Existing tests MUST still pass. Tests run via `just test-frontend` ONLY (never `pnpm test`/`vitest` directly). No new Playwright e2e spec.

- **GIVEN** the extended test file
- **WHEN** `just test-frontend` runs
- **THEN** the new ordering tests pass, asserting reset/write call order via the spies, and all pre-existing tests pass unchanged

### Non-Goals

- Skipping the redundant same-session reconnect (keying WS teardown on resolved owning session instead of windowId) — explicitly agreed follow-up change.
- Any backend change (`app/backend/**` untouched).
- Any change to adaptive-flush thresholds, measurement, or ordering guarantees.
- New Playwright e2e specs — the flicker is a sub-frame rendering artifact, not e2e-observable; unit-level call-ordering assertions are the reliable proof.

### Design Decisions

1. **Reset-flag mechanism — effect-scoped `pendingReset` boolean, armed in `connect()`, consumed at first data write**: the flag lives at effect scope (next to the flush buffers, visible to `flushToTerminal`) and is set `true` at the top of each `connect()` call; a small helper consumes it (check + clear + `terminal.reset()`) in both write paths. — *Why*: connections within one effect are strictly sequential and the buffers only ever hold the current connection's data, so an effect-scoped flag faithfully implements per-connection semantics while remaining visible to the effect-scoped flush function; effect re-runs create fresh closures, so cross-effect leakage is impossible. — *Rejected*: a per-connection ownership token threaded into the flush — more moving parts for no additional guarantee given the sequential-connection property.

## Tasks

### Phase 1: Core Implementation

- [x] T001 Implement the deferred reset in `app/frontend/src/components/terminal-client.tsx`: replace the receipt-time `needsReset` consumption in `ws.onmessage` with an effect-scoped `pendingReset` flag armed at the top of `connect()`; add a consume helper (check + clear + `terminal.reset()`); call it immediately before `terminal.write` in both immediate paths (string and binary) <!-- R1, R2 -->
- [x] T002 Wire the deferred reset into the coalesced path in the same file: `flushToTerminal` early-returns when both buffers are empty (empty flush neither consumes nor executes the pending reset), otherwise consumes the pending reset before writing buffered data; document the handoff semantics (per-connection arming, close-time flush, zero-message connections) in a comment at the flag declaration; leave all adaptive-flush machinery (`IMMEDIATE_WRITE_MAX_BYTES`, `textByteLength`, `wroteImmediatelyThisFrame`/`markImmediateWrite`, buffering/ordering) untouched <!-- R3, R4 -->
- [x] T003 [P] Rewrite the stale comment block above the WebSocket effect (~479-492) in `app/frontend/src/components/terminal-client.tsx` to describe the current move-based pin-session relay design (ResolveWindowSession → session-scoped SelectWindowInSession → direct attach, no ephemeral/defer-kill), noting same-session reconnects are now redundant and naming the keying follow-up as out of scope <!-- R5 -->

### Phase 2: Tests & Verification

- [x] T004 Extend `app/frontend/src/components/terminal-client.test.tsx` with reset-ordering tests using the existing xterm mock (`reset`/`write` spies), a controllable mock WebSocket (captured instances, fireable `onopen`/`onmessage`/`onclose`), and a stubbed `requestAnimationFrame` to drive flushes deterministically: (a) large first chunk → no reset at receipt, reset-then-write inside the flush; (b) small string first chunk → reset synchronously before write; (c) small binary first chunk → reset before write; (d) two chunks on one connection → exactly one reset; (e) reconnect after close → reset re-armed, fires again on new connection's first write; (f) zero-message connection close → no reset; (g) tail drain after reset consumed → write without reset <!-- R6, R1, R2, R3 -->
- [x] T005 Run verification gates in order: `cd app/frontend && npx tsc --noEmit`, then `just test-frontend`; confirm all new and pre-existing tests pass <!-- R6, R4 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: `ws.onmessage` contains no receipt-time `terminal.reset()`; the reset executes immediately before the first chunk write in the immediate path and at the top of a data-bearing `flushToTerminal`, for both string and binary chunks
- [x] A-002 R2: the reset is armed inside `connect()` (not earlier), runs exactly once per connection, and covers same-session, cross-session, and transient-drop reconnect paths
- [x] A-003 R5: the comment block above the WebSocket effect describes the current move-based pin-session relay (ResolveWindowSession, session-scoped SelectWindowInSession, direct attach — no ephemeral/defer-kill) and names the same-session-reconnect follow-up; no stale ephemeral-grouped-session description remains

### Behavioral Correctness

- [x] A-004 R1: with the rAF-coalesced first chunk, clear + repaint happen in the same rAF callback (reset is called inside `flushToTerminal`, ordered before the buffered write) — no path exists where a presented frame shows a reset-but-unpainted terminal
- [x] A-005 R3: an empty `flushToTerminal()` (e.g., a zero-message connection's close-time drain) neither consumes nor executes the pending reset; a close-time drain of a connection whose reset was already consumed writes tail data without resetting

### Scenario Coverage

- [x] A-006 R6: unit tests in `terminal-client.test.tsx` cover all four intake behaviors — (a) no reset before first write, (b) exactly once per connection, (c) string and binary first chunks, (d) re-armed on reconnect — plus the R3 handoff edges (zero-message close, post-consumption tail drain), and all pass via `just test-frontend`

### Edge Cases & Error Handling

- [x] A-007 R3: the effect-teardown drain path (onclose flush runs before the `cancelled` check) cannot fire a reset belonging to a different connection — flag state is effect-scoped, arming happens only in `connect()`, and the effect cleanup neutralizes pending write state (`pendingReset`/buffers) so a dead connection's late onclose drain neither resets nor writes the stale chunk (review fold-in, covered by unit test)

### Code Quality

- [x] A-008 R4: adaptive-flush machinery is unchanged — `IMMEDIATE_WRITE_MAX_BYTES` (64), `textByteLength`, `wroteImmediatelyThisFrame`/`markImmediateWrite`, and the once-buffering-always-buffer-until-drain ordering are not modified by the diff
- [x] A-009 Pattern consistency: new code follows the surrounding effect's naming and comment conventions; type narrowing over assertions (no new `as` casts in production code)
- [x] A-010 No unnecessary duplication: the reset-consume logic exists in one helper, reused by both write paths; no existing utility reimplemented
- [x] A-011 Frontend-only scope: `app/backend/**` untouched; no new routes, dependencies, or polling introduced; tests were run via `just` recipes only

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

None — this change replaces the per-connection `needsReset` local (deleted in the same diff) with the effect-scoped `pendingReset` flag and makes no other code redundant; the inner `if (textBuffer)` guard in `flushToTerminal` remains necessary after the new empty-flush early return (a binary-only flush still has an empty `textBuffer`).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Mechanism: effect-scoped `pendingReset` boolean armed at the top of `connect()`, consumed (check + clear + reset) by a helper called from both write paths; `flushToTerminal` gains an empty-buffer early return before the consume | Intake assumption #4 leaves the mechanism to the implementor provided the handoff semantics hold; the effect-scoped flag satisfies all of them because connections within an effect are strictly sequential and effect re-runs get fresh closures | S:80 R:85 A:85 D:75 |
| 2 | Confident | Test harness details: a class-based mock WebSocket with captured instances and static readyState constants, plus stubbed `requestAnimationFrame`/`cancelAnimationFrame` capturing callbacks for deterministic flush driving; fake timers only for the reconnect-timer test | Intake specifies the harness file and the spies but not the WS/rAF control mechanics; this is the minimal extension of the existing `vi.stubGlobal("WebSocket", ...)` pattern already present in the file | S:70 R:90 A:85 D:75 |
| 3 | Confident | Two extra tests beyond the intake's four behaviors: zero-message close fires no reset, and post-consumption tail drain writes without reset | Intake §1 lists these handoff semantics as decided requirements ("must be reasoned through explicitly"); testing them directly is the natural proof and the constitution requires tests to conform to the spec | S:80 R:90 A:90 D:85 |

3 assumptions (0 certain, 3 confident, 0 tentative).
