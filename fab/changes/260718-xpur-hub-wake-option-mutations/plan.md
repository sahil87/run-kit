# Plan: Hub Wake Seam for Option Mutations

**Change**: 260718-xpur-hub-wake-option-mutations
**Intake**: `intake.md`

## Requirements

### SSE Hub: Per-Server Wake Seam

#### R1: Non-blocking coalescing `wake(server)` method
The SSE hub SHALL expose a `wake(server string)` method that marks a server for an immediate snapshot pass. It MUST be non-blocking (never wait on the poll loop), safe to call from any goroutine, and coalescing (N wakes before consumption trigger 1..N passes — never lost, never a busy-loop). It MUST use close-based per-server signal channels (a closed channel = a wake is pending), guarded by a dedicated `wakeMu` mutex, independent of `h.subscriber`.

- **GIVEN** a running hub
- **WHEN** `wake("kits")` is called from an HTTP handler goroutine
- **THEN** the call returns immediately without blocking on the poll loop
- **AND** the server's per-server wake channel is closed (signal pending)
- **AND** a second `wake("kits")` before consumption is a coalescing no-op (channel already closed) — no panic, no double-close

#### R2: `waitForNext` honors wakes alongside subscriber cases, independent of `h.subscriber`
`waitForNext` SHALL build a wake wait-case for every polled server, in addition to (and independent of) the subscriber wait cases, so a wake wakes the loop even when `subscriber == nil` (unit-test hubs, PTY-unavailable hosts) where the code today short-circuits to a timer-only wait. Wake cases MUST be distinguished from subscriber cases so wake wins do NOT enter subscriber bookkeeping (`perServerGen` / `Generation()`), and MUST NOT nil-panic when `subscriber == nil`.

- **GIVEN** a hub with `subscriber == nil` and a client on server `kits`
- **WHEN** `wake("kits")` is called
- **THEN** `waitForNext` returns promptly (well before the safety interval), driven by the wake case
- **AND** no `h.subscriber` method is invoked for the wake case
- **GIVEN** a hub with a live subscriber
- **WHEN** a subscriber notification fires (not a wake)
- **THEN** the subscriber win still updates `perServerGen[winner]` exactly as before (behavior preserved byte-for-byte)

#### R3: Consuming a wake replaces the channel and invalidates the fetch cache
When a wake case is observed fired — as the winner OR in the non-blocking peek loop over non-winning cases — `waitForNext` MUST, under `wakeMu`, (a) replace the server's closed channel with a fresh open one BEFORE the next fetch pass runs (at-least-once semantics: a wake landing between observation and fetch closes the fresh channel and triggers one more pass; the closed channel is retired the moment it is observed, so no busy-loop), and (b) mark `eventDrivenServers[server] = true` so `poll()` invalidates that server's 500ms fetch cache (`sseCacheTTL`).

- **GIVEN** a woken server whose 500ms fetch cache holds a pre-mutation snapshot
- **WHEN** the poll loop runs the woken pass
- **THEN** `eventDrivenServers[server]` is true, so the cache is deleted and the post-mutation state is fetched and broadcast
- **GIVEN** a wake observed and consumed
- **WHEN** no further wake arrives
- **THEN** the fresh replacement channel stays open and the loop does not spin (bounded fetch count)

#### R4: Preserve all existing wait/select semantics
The change MUST NOT alter subscriber-win bookkeeping, the timer path, `safetyIntervalEffective`/`Covers`, or the tmuxctl bridge. `internal/tmuxctl` and `app/backend/api/tmuxctl_bridge.go` (incl. `supervisorSubscriber.Wait`'s never-closing `neverChan()` contract for uncovered servers) SHALL NOT be modified.

- **GIVEN** the existing subscriber/timer/coverage test suite (`sse_subscriber_test.go`)
- **WHEN** the wake seam is added
- **THEN** all existing SSE hub tests continue to pass unchanged

### Option-Mutation Handlers: Wake Call Sites

#### R5: `handleWindowOptions` wakes the request's server after a successful write
After a successful `s.tmux.SetWindowOptions(...)` and before `writeJSON`, `handleWindowOptions` (`app/backend/api/windows.go`) SHALL call `s.initSSEHub(); s.sseHub.wake(server)`, mirroring the `handleSessionOrderPost` pattern. No wake fires on validation failure or tmux error (the handler returns early). The response body is unchanged (`{"ok": true}`).

- **GIVEN** a connected SSE client on the request's server
- **WHEN** `POST /api/windows/{windowId}/options` succeeds (e.g. `@color`)
- **THEN** the hub is woken for that server and the client sees a fresh `sessions` snapshot promptly
- **GIVEN** an invalid option key or value
- **WHEN** the request is rejected (400) with zero tmux calls
- **THEN** no wake fires

#### R6: `handleSessionColor` wakes the request's server after a successful write
After a successful `SetSessionColor`/`UnsetSessionColor` and before `writeJSON`, `handleSessionColor` (`app/backend/api/sessions.go`) SHALL call `s.initSSEHub(); s.sseHub.wake(server)`. No wake fires on validation failure or tmux error. Response body unchanged (`{"ok": true}`).

- **GIVEN** a connected SSE client on the request's server
- **WHEN** `POST /api/sessions/{session}/color` succeeds
- **THEN** the hub is woken for that server
- **GIVEN** a malformed color value
- **WHEN** the request is rejected (400)
- **THEN** no wake fires

### Non-Goals

- No frontend changes — the optimistic update was explicitly rejected by the user.
- No new tmux polling, no change to the 12s/2.5s cadences, no tmuxctl parser or `supervisorSubscriber` changes.
- No new endpoints; request/response contracts unchanged.

### Design Decisions

1. **Close-based signal channels, not buffered-token sends**: `wake` closes a per-server channel; the consumer replaces it on observation — *Why*: `selectFirst`'s fan-in goroutines and `waitForNext`'s non-blocking peek loop both re-read the same channel and rely on fired-channels-stay-readable (subscriber `Wait` fires by close). A send token can be consumed by a non-winning fan-in goroutine and silently lost — *Rejected*: buffered-token channel (`chan struct{}` with `select { case ch<-struct{}{}: default: }`).
2. **Wake cases built independent of `h.subscriber`**: the wake path runs even when `subscriber == nil` — *Why*: unit-test hubs and PTY-unavailable hosts must still honor wakes; today the nil-subscriber path is timer-only — *Rejected*: gating wake on subscriber presence (would drop the fix on exactly the hosts that need it and break the nil-subscriber unit test).
3. **Consumed wake marks `eventDrivenServers[server] = true`**: reuses the existing subscriber-win cache-invalidation seam at `poll()` (`sse.go:1181`) — *Why*: without it the woken pass can serve a <500ms-old pre-mutation cached fetch and the fix degrades to the safety tick — *Rejected*: unconditional cache bypass (would defeat the 500ms cache for unrelated ticks).

## Tasks

### Phase 1: Core Implementation

- [x] T001 Add hub state to `sseHub` in `app/backend/api/sse.go`: `wakeMu sync.Mutex` and `wakes map[string]chan struct{}` (per-server wake signal; closed = wake pending), documented; initialize `wakes` in `newSSEHub`. <!-- R1 -->
- [x] T002 Add the `wake(server string)` method in `app/backend/api/sse.go`: under `wakeMu`, lazily create the server's channel, then `select { case <-ch: default: close(ch) }` to coalesce (close only if not already closed). Non-blocking, safe from any goroutine. <!-- R1 -->
- [x] T003 Add two internal `wakeMu`-guarded helpers in `app/backend/api/sse.go` used by `waitForNext`: one returning the current (lazily-created) wake channel for a server so it can be added as a wait case, and one that, given a server, if its channel is currently closed replaces it with a fresh open channel and reports that it was consumed (used to drive `eventDrivenServers`). Keep the locking discipline identical to `wake`. <!-- R2 R3 -->

### Phase 2: Integration into the wait loop

- [x] T004 Integrate wake cases into `waitForNext` (`app/backend/api/sse.go`): build the subscriber cases as today (guarded by `h.subscriber != nil`), AND — independent of `h.subscriber` — append a wake wait-case per polled server tagged as a wake case (e.g. a `kind`/`isWake` field on `waitCase`, or a parallel wake-case list) so wake and subscriber cases are distinguished. Remove the early `subscriber == nil` timer-only return so the wake path is reached when `subscriber == nil`; when there are neither subscriber nor wake cases, `selectFirst` still falls through to the timer (its `len(cases)==0` branch). <!-- R2 -->
- [x] T005 Wake-consumption handling in `waitForNext` (`app/backend/api/sse.go`): when the winner is a wake case, do NOT touch `perServerGen`/`Generation()`; instead consume the wake (replace the channel via the T003 helper) and set `eventDrivenServers[server] = true`. In the non-blocking peek loop over non-winning cases, handle fired wake cases the same way (consume + mark event-driven, skip subscriber bookkeeping) and continue to handle fired subscriber cases exactly as today. Guard every `h.subscriber` deref so a wake-only path with `subscriber == nil` never nil-panics. <!-- R2 R3 -->
- [x] T006 Verify no changes leak into `safetyIntervalEffective`, the timer path, `Covers`, `app/backend/api/tmuxctl_bridge.go`, or `internal/tmuxctl` — the wake seam is additive within `sseHub`/`waitForNext`/`selectFirst` only. <!-- R4 -->

### Phase 3: Call sites

- [x] T007 In `handleWindowOptions` (`app/backend/api/windows.go`), after the successful `s.tmux.SetWindowOptions(ctx, windowID, server, ops)` and before `writeJSON`, add `s.initSSEHub(); s.sseHub.wake(server)`. The early `len(ops) == 0` return path issues no tmux write and needs no wake (nothing changed). <!-- R5 -->
- [x] T008 In `handleSessionColor` (`app/backend/api/sessions.go`), after the successful `SetSessionColor`/`UnsetSessionColor` and before `writeJSON`, add `s.initSSEHub(); s.sseHub.wake(server)`. <!-- R6 -->

### Phase 4: Tests

- [x] T009 Add hub-level wake tests to `app/backend/api/sse_subscriber_test.go` (reuse the short-`safetyInterval` + `fetchTracker` + `stubSubscriber` harness): (a) `wake(server)` triggers a snapshot rebuild well before the safety interval; (b) wake works with `subscriber == nil` (timer-only path today); (c) wake for a server with no clients / unknown server is a safe no-op (no panic); (d) coalescing/no-busy-loop — multiple wakes before a pass produce bounded fetches (fetch count does not spin after the wake is served); (e) wake invalidates the fetch cache — a mutation is visible in the woken pass despite a <500ms-old cached fetch. <!-- R1 R2 R3 -->
- [x] T010 Add handler-seam tests (mirror `TestSessionOrder_POST_triggersBroadcast`): the `POST .../options` seam test in `app/backend/api/windows_test.go` (alongside the existing Window Options tests) and the `POST .../color` seam test in `app/backend/api/sessions_test.go`. Each: construct `&Server{}`, `initSSEHub()`, `addClient`, drain bootstrap, then via `buildRouter()` assert that a successful POST (e.g. `{"options":{"@color":"5"}}` on window `@2`, or `{"color":"6"}`) wakes the request's server (the client receives a fresh `sessions` snapshot), while a failed-validation POST does NOT (no snapshot within a short window). <!-- R5 R6 -->

### Phase 5: Verification

- [x] T011 Run `just test-backend` (or `cd app/backend && go test ./...` per code-quality.md) and confirm green; fix any failures at root cause (up to 3 attempts per issue). <!-- R1 R2 R3 R4 R5 R6 -->

## Execution Order

- T001 blocks T002, T003 (state must exist first).
- T002, T003 block T004, T005 (the wait loop consumes the method/helpers).
- T004 blocks T005 (case construction before consumption handling).
- T007, T008 are independent of each other and of the hub changes' internals, but depend on T002 (the `wake` method must exist).
- T009 depends on T001–T005; T010 depends on T002, T007, T008.
- T011 runs last.

## Acceptance

### Functional Completeness

- [x] A-001 R1: `sseHub.wake(server)` exists, is non-blocking, coalescing, close-channel-based under `wakeMu`, and works independent of `h.subscriber`.
- [x] A-002 R2: `waitForNext` builds wake wait-cases for every polled server independent of `h.subscriber`, distinguished from subscriber cases; the nil-subscriber path reaches the wake cases (no early timer-only return that skips them).
- [x] A-003 R3: a consumed wake replaces its channel with a fresh open one under `wakeMu` and sets `eventDrivenServers[server] = true`.
- [x] A-004 R5: `handleWindowOptions` calls `s.initSSEHub(); s.sseHub.wake(server)` after a successful write, before the response.
- [x] A-005 R6: `handleSessionColor` calls `s.initSSEHub(); s.sseHub.wake(server)` after a successful write, before the response.

### Behavioral Correctness

- [x] A-006 R3: a woken pass observes post-mutation tmux state despite a <500ms-old cached fetch (cache invalidated via `eventDrivenServers`).
- [x] A-007 R2: a subscriber-driven win still updates `perServerGen`/`Generation()` exactly as before — wake cases never enter subscriber bookkeeping.
- [x] A-008 R5/R6: no wake fires on validation failure or tmux error; response bodies remain `{"ok": true}` (no API contract change).

### Scenario Coverage

- [x] A-009 R1/R2/R3: `sse_subscriber_test.go` covers wake-triggers-rebuild, wake-with-nil-subscriber, no-clients/unknown-server no-op, coalescing/no-busy-loop, and cache invalidation.
- [x] A-010 R5/R6: handler-seam tests cover successful `POST .../options` and `POST .../color` waking the server, and failed validation not waking.

### Edge Cases & Error Handling

- [x] A-011 R1: a double `wake` before consumption does not double-close (no panic); a wake for an unknown server / no clients is a harmless no-op.
- [x] A-012 R2: a wake-only path with `subscriber == nil` never nil-panics on a `h.subscriber` deref.
- [x] A-013 R3: after a wake is consumed and no further wake arrives, the loop does not busy-spin (bounded fetch count).

### Code Quality

- [x] A-014 Pattern consistency: new hub state/method/helpers follow the surrounding `sseHub` locking and doc-comment conventions; call sites mirror `handleSessionOrderPost` verbatim in shape.
- [x] A-015 No unnecessary duplication: reuses the existing `eventDrivenServers` cache-invalidation seam and the `sse_subscriber_test.go` harness rather than adding parallel machinery.
- [x] A-016 Go concurrency safety: all `wakes`-map access is guarded by `wakeMu`; no data race — verified `go test -race -count=2` green on the wake/SSE/seam tests. (The full-package `-race` run trips `TestChatWS_EventPayloadByteEquality`, a PRE-EXISTING chat-subsystem race reproduced on clean `main` in files untouched by this change.)
- [x] A-017 Security First (Constitution I): no new subprocess execution introduced; the change is pure in-process channel signalling (no `exec` surface touched).
- [x] A-018 No database / derive-from-source (Constitution II): no new persistent state or cache beyond the transient per-server wake channel, which is a signal, not derived state.

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- `selectFirst`'s `string` return value (`app/backend/api/sse.go:1608`) — the rewritten `waitForNext` (its only caller, `sse.go:1570`) now discards the winner name in favor of the unified peek over all cases, so the return value (and the doc sentence "Returns the server name whose channel fired") is dead weight; the function could return nothing.
- Cleanup drain goroutine in `newWakeSeamServer` (`app/backend/api/sessions_test.go`, the `go func() { for range client.ch {} }()` in `t.Cleanup`) — its stated purpose cannot occur: all hub sends to `client.ch` are non-blocking (`sendLocked` `sse.go:481` and the reap-gone send both use `select`/`default`), and the goroutine never terminates because the channel is never closed.
- Inline bootstrap-drain sequences in the pre-existing SSE tests (e.g. `sse_subscriber_test.go:107`–`121` in `TestSSE_EventDrivenWakesOnSubscriberBump` and siblings) — now duplicate the new `drainBootstrap` helper; consolidation opportunity, not required by this change.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Wake helpers are two small `wakeMu`-guarded methods (`wakeChannel(server)` + `consumeWake(server)`) rather than inlining the locking into `waitForNext` | Keeps `waitForNext`'s lock discipline identical to `wake` and avoids holding `wakeMu` across the select; mirrors the hub's existing helper-method decomposition. Reversible refactor, one file | S:65 R:85 A:85 D:70 |
| 2 | Confident | Wake vs subscriber cases distinguished by an `isWake bool` field on the existing `waitCase` struct (single case list) rather than a parallel wake-case slice | Intake allows either ("tag the wait cases OR keep wake cases in a parallel list"); a tag field keeps `selectFirst` fan-in unchanged (still one `[]waitCase`) and is the smaller diff | S:70 R:85 A:80 D:70 |
| 3 | Confident | Handler-seam tests are colocated with each endpoint's existing tests: the options seam in `windows_test.go` (alongside the Window Options suite), the color seam in `sessions_test.go` (alongside the Session Color suite) | `windows_test.go` already houses the `POST .../options` tests and `sessions_test.go` the `POST .../color` tests; colocating matches the established file-per-endpoint layout and reuses each file's mocks/helpers (`postOptions`, `mockTmuxOps`). (Corrected from an initial draft that assumed no `windows_test.go` existed.) | S:75 R:90 A:85 D:80 |
| 4 | Confident | "No wake on failure" is asserted via the validation-failure path (400 before any tmux call), not a tmux-error injection | Validation rejects before the tmux write and before the wake, so it is the cleanest no-wake case and needs no error-injection field on the shared `mockTmuxOps.err`; a tmux-error path would also not wake but is redundant to assert | S:70 R:90 A:85 D:75 |

4 assumptions (0 certain, 4 confident, 0 tentative).
