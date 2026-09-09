# Plan: Relay Liveness Deadline

**Change**: 260909-4mhg-relay-liveness-deadline
**Intake**: `intake.md`

## Requirements

### Terminal Relay: Server-side liveness deadline

#### R1: Inbound-silence deadline on `/ws/terminals`
The terminals mux MUST arm a read deadline of `terminalsLivenessTimeout` (90 s) on the WebSocket immediately after the upgrade and MUST re-arm it after every successful `ReadMessage()`, before dispatching the frame. Any inbound frame — binary data, `open`/`resize`/`close` control ops, or `ping` — counts as liveness. Deadline expiry MUST surface as a `ReadMessage` error that exits the read loop into the existing `tc.teardown()` path, so every stream's attach client and PTY is killed and reaped by the unchanged `killAndReapAttach` chain.

- **GIVEN** a terminals socket with one open stream whose peer stops sending any frame
- **WHEN** 90 s elapse since the last inbound frame
- **THEN** the server closes the socket, `tc.teardown()` runs, and the stream's `tmux attach-session` client disappears from `list-clients`

- **GIVEN** a terminals socket whose client sends `{op:"ping"}` every 30 s
- **WHEN** far more than 90 s elapse
- **THEN** the socket stays open and pongs keep arriving

- **GIVEN** a terminals socket whose client sends only binary data frames (no pings)
- **WHEN** frames arrive more often than every 90 s
- **THEN** the socket stays open — data refreshes the deadline exactly as pings do

#### R2: The writer's cleanup deadline is unchanged and still wins
`runWriter`'s dead-socket branch MUST continue to set the 100 ms `terminalsCleanupWait` read deadline after a write failure. Because a later `SetReadDeadline` replaces the earlier one, a write failure MUST still tear the socket down promptly regardless of the longer liveness deadline.

- **GIVEN** a terminals socket whose writer hits a write error
- **WHEN** `runWriter` sets `terminalsCleanupWait`
- **THEN** the read loop exits within that short window, not after 90 s

#### R3: Liveness expiry is logged once, and only for liveness
On read-loop exit the handler MUST emit one `slog.Info` naming the liveness expiry — with the live stream count and the peer address (`r.RemoteAddr`, verbatim) — when and only when the read error is a network timeout AND the writer did not trigger the cleanup deadline. A client-initiated close or a write-failure teardown MUST NOT produce the liveness log line. `runWriter` records that it triggered cleanup via an `atomic.Bool` on `terminalsConn`, set immediately before its `SetReadDeadline`.

- **GIVEN** a socket torn down by the liveness deadline
- **WHEN** the read loop exits
- **THEN** exactly one Info log `terminals: liveness deadline expired; tearing down` is emitted with `streams` and `peer` attributes

- **GIVEN** a socket the client closes normally
- **WHEN** the read loop exits
- **THEN** no liveness log line is emitted

#### R4: Deadline is test-overridable without production seams
`terminalsLivenessTimeout` MUST be a package-level `var` (not `const`) so in-package tests can shorten it with a `t.Cleanup` restore. Tests that override it MUST NOT run in parallel with each other.

- **GIVEN** a test that sets `terminalsLivenessTimeout` to 300 ms
- **WHEN** it dials `/ws/terminals` and stays silent
- **THEN** the socket closes within ~2× that value

### Frontend Relay Mux: Documented invariant

#### R5: The heartbeat ladder is documented and testable in `relay-mux.ts`
`relay-mux.ts` MUST export `SERVER_LIVENESS_TIMEOUT_MS = 90000` beside `HEARTBEAT_INTERVAL_MS` / `LIVENESS_TIMEOUT_MS`, with a comment stating the server-side counterpart, the ordering invariant `HEARTBEAT_INTERVAL_MS < LIVENESS_TIMEOUT_MS < SERVER_LIVENESS_TIMEOUT_MS`, and that a fully suspended tab's socket is closed by the server deadline and reconnects on `visible` via `resumeSuspended()`. There MUST be no runtime behavior change in the mux.

- **GIVEN** the exported constants
- **WHEN** a unit test asserts `HEARTBEAT_INTERVAL_MS < LIVENESS_TIMEOUT_MS && LIVENESS_TIMEOUT_MS < SERVER_LIVENESS_TIMEOUT_MS`
- **THEN** it passes, and a future edit that breaks the ladder fails it

- **GIVEN** a fully suspended tab whose socket the server closed
- **WHEN** the page becomes `visible`
- **THEN** the mux opens a fresh socket and re-issues `open` for the resumed streams (the existing test at `relay-mux.test.ts` "a drop while fully suspended stays closed until visible" is the guard; its description is extended to name the server deadline as the drop cause)

### Non-Goals
- Per-connection identity (`peer`/`userAgent`/`connectedAt`), the attach registry, widened `list-clients` format, `Viewer` enrichment — Phase 2 of the plan file
- Any kick endpoint, `closeKicked = 4005`, or no-reopen client handling — Phase 3
- `X-Forwarded-For` parsing — Phase 2; the log uses `r.RemoteAddr` as-is
- A liveness deadline on `/ws/state` — it holds no attach clients

### Design Decisions

#### Server-side app-level read deadline over WebSocket protocol pings
**Decision**: The daemon detects a dead browser client by an inbound-frame read deadline (90 s, refreshed by any frame) on `/ws/terminals`, reusing the client's existing 30 s heartbeat as the liveness source.
**Why**: Browsers answer WebSocket protocol-level pings in the network stack, invisibly to JS, so a server ping proves the browser process is alive, not that the tab's JS is. A frozen phone tab would keep passing. The app-level heartbeat only flows while JS runs, so its absence is the exact signal for "this tab cannot release its attach clients itself". 90 s is three missed heartbeats and strictly longer than the client's own 60 s give-up, so a live client always disconnects first and the server deadline fires only on a peer that has stopped running JS.
**Rejected**: Server-initiated WS pings (frozen tab passes); shortening proxy idle timeouts (not under the daemon's control); tmux-side `detach-client` sweeps (undone within seconds by the mux's reconnect).
*Introduced by*: 260909-4mhg-relay-liveness-deadline

## Tasks

### Phase 2: Core Implementation

- [x] T001 `app/backend/api/terminals_ws.go`: add `var terminalsLivenessTimeout = 90 * time.Second` with its doc comment beside the existing tunables; add `writerDead atomic.Bool` to `terminalsConn` and set it in `runWriter` immediately before the cleanup `SetReadDeadline`; add a mutex-guarded `streamCount()` helper; arm the deadline after `SetReadLimit` and re-arm after every successful `ReadMessage()`; on read-loop exit emit the `slog.Info("terminals: liveness deadline expired; tearing down", "streams", …, "peer", r.RemoteAddr)` only when the error is a `net.Error` timeout and `writerDead` is false <!-- R1 R2 R3 R4 -->
- [x] T002 `app/backend/api/terminals_ws_test.go`: add `TestTerminals_LivenessDeadlineTearsDownSilentSocket` (real tmux via `withTerminalsTmux` + `terminalsServerWithProdTmux`; open a stream, go silent with `terminalsLivenessTimeout` shortened to ~300 ms; assert the client's `ReadMessage` errors within ~1.5 s and `listClients` returns zero clients), `TestTerminals_LivenessDeadlinePingsKeepSocketAlive` (mock tmux, `newTestRouter`; ping every quarter-deadline for ≥3× deadline, socket stays open and pongs arrive), and `TestTerminals_LivenessDeadlineDataFramesRefresh` (mock tmux; binary frames instead of pings, socket stays open). Override the var with `t.Cleanup` restore; no `t.Parallel()` <!-- R1 R4 -->
- [x] T003 [P] `app/frontend/src/lib/relay-mux.ts`: export `SERVER_LIVENESS_TIMEOUT_MS = 90000` beside the heartbeat constants with the invariant comment (server counterpart, `HEARTBEAT < LIVENESS < SERVER`, suspended-all socket closes and resumes on `visible`) <!-- R5 -->
- [x] T004 [P] `app/frontend/src/lib/relay-mux.test.ts`: import `SERVER_LIVENESS_TIMEOUT_MS`; add an `it` asserting the ordering invariant; extend the description of the existing "a drop while fully suspended stays closed until visible" test to name the server liveness deadline as the drop cause <!-- R5 -->

### Phase 3: Integration & Edge Cases

- [x] T005 Run the gates scoped first: `just test-backend` (or the scoped `go test ./api -run 'TestTerminals'` through the recipe's env), then `just test-frontend`, then `cd app/frontend && npx tsc --noEmit`; fix any failure <!-- R1 R5 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: `handleTerminalsWS` sets `conn.SetReadDeadline(time.Now().Add(terminalsLivenessTimeout))` after `SetReadLimit` and again after every successful `ReadMessage()`, before dispatch
- [x] A-002 R2: `runWriter`'s dead-socket branch still sets `terminalsCleanupWait`; the constant and its comment are unchanged
- [x] A-003 R3: the liveness `slog.Info` fires only on a `net.Error` timeout with `writerDead` false; it carries `streams` and `peer`
- [x] A-004 R4: `terminalsLivenessTimeout` is a `var`; tests overriding it restore via `t.Cleanup` and do not call `t.Parallel()`
- [x] A-005 R5: `SERVER_LIVENESS_TIMEOUT_MS` is exported with the invariant comment; no runtime code path in `relay-mux.ts` changed

### Behavioral Correctness

- [x] A-006 R1: a silent socket with a real attach client is torn down at the shortened deadline and `list-clients` shows zero clients afterwards
- [x] A-007 R1: a pinging socket survives ≥3× the deadline with pongs still arriving
- [x] A-008 R1: a data-only socket survives ≥3× the deadline

### Scenario Coverage

- [x] A-009 R5: a Vitest case asserts `HEARTBEAT_INTERVAL_MS < LIVENESS_TIMEOUT_MS < SERVER_LIVENESS_TIMEOUT_MS`
- [x] A-010 R5: the suspended-all → drop → `visible` reconnect test still passes and its description names the server deadline

### Edge Cases & Error Handling

- [x] A-011 R3: a client-initiated close emits no liveness log line
- [x] A-012 R2: a write failure still tears down within the cleanup window (existing behavior; verified by reading the code path, no new test required)

### Code Quality

- [x] A-013 Pattern consistency: the new var/comment sits in the existing tunables block; the deadline call mirrors `state_ws.go`'s `SetReadDeadline` usage; tests reuse `withTerminalsTmux`, `dialTerminals`, `openStream`, `listClients`, `newTestRouter`
- [x] A-014 No unnecessary duplication: no new tmux helpers, no new teardown path, `killAndReapAttach` untouched
- [x] A-015 Named constants: no magic numbers — 90 s and 90000 ms are named on both sides
- [x] A-016 Comments state constraints only: the doc comment explains the 30/60/90 ladder and why; no narration, no change IDs in code comments
- [x] A-017 Tests cover the changed behavior (three Go cases + one Vitest invariant)

### Security

- [x] A-018 R3: the peer address logged is `r.RemoteAddr` only; no header-derived value is trusted or logged

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

None — this change adds new functionality (a server-side read deadline) without making existing code redundant. The writer's `terminalsCleanupWait` path stays load-bearing (it still handles the write-failure case the liveness deadline deliberately does not disambiguate away), and `gui_ws.go`'s cleanup deadlines belong to a separate handler outside this change's scope.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | `SERVER_LIVENESS_TIMEOUT_MS` is exported (the intake left it optional) so the ordering invariant is a real test, not a comment | Cheapest way to make the invariant fail loudly; no runtime use | S:80 R:95 A:90 D:85 |
| 2 | Confident | The silent-socket test uses the real-tmux harness from `terminals_relay_test.go` and asserts via `listClients`, not via `cmd.ProcessState` | The attach `cmd` lives inside the server conn and is unreachable from an `httptest` client; `list-clients` is the user-facing truth the plan's manual check uses | S:75 R:90 A:90 D:85 |
| 3 | Confident | Liveness-timeout detection uses `errors.As(err, &net.Error)` + `Timeout()` | gorilla surfaces the `net.Conn` deadline error unwrapped; `awaitClosed` in the existing tests already uses the same `net.Error` timeout check | S:70 R:95 A:85 D:85 |
| 4 | Confident | No slog-capture assertion for the log line; A-003/A-011 are verified by reading the guard condition | The log is operator telemetry, the gate is two booleans; a capture handler would add test infra for little signal | S:65 R:95 A:80 D:75 |

4 assumptions (1 certain, 3 confident, 0 tentative).
