# Plan: Fix SSE hub lost-wakeup: pending event-driven dispatch swallowed by results-only tick

**Change**: 260908-whnu-sse-lost-wakeup-results-tick
**Intake**: `intake.md`

## Requirements

### SSE Hub: Fold-only gate honors pending event-driven flags

#### R1: Pending event-driven flags keep a results tick dispatch-worthy
`waitForNext`'s `resultsOnly` return SHALL be true only when the wait ended solely on unit completions AND no event-driven dispatch is pending: `resultsOnly = results && !bumped && !woke && !timerFired && len(eventDrivenServers) == 0` (`app/backend/api/sse.go`, the computation currently at ~line 2344). The dispatch pass itself is unchanged — entries remain consumed at dispatch (`delete(eventDrivenServers, server)` before `go h.runPollUnit(...)`) and re-set only by real generation bumps/wakes.

- **GIVEN** a poll unit for server S is in flight (single-flight `pollInFlight[S]`, or the `pollSem` bound deferred S's dispatch)
- **WHEN** a control-mode generation bump for S is consumed by `waitForNext`'s peek (marking `eventDrivenServers[S]`) and the in-flight unit then completes (results wake)
- **THEN** the next tick is a FULL tick (not fold-only) that dispatches S with its pending cache invalidation, so the fresh snapshot broadcasts promptly after unit completion — never deferred to the safety timer

- **GIVEN** no `eventDrivenServers` entries are pending
- **WHEN** a poll unit completes and its results wake is the only signal
- **THEN** the tick remains fold-only exactly as today — no dispatch, no self-perpetuation (dispatch → complete → results wake → dispatch …)

#### R2: Fold-only contract doc comments state the amended condition
The doc comments in `app/backend/api/sse.go` that assert the fold-only contract SHALL be updated to state the pending-flag exception: the `waitForNext` `resultsOnly` return doc (~lines 2227–2232), the peek's `isResults` case comment (~lines 2299–2304), and the pre-computation comment above the `resultsOnly` assignment (~lines 2340–2343). No comment may still claim that a wait ended solely by unit completions is unconditionally fold-only.

- **GIVEN** the amended condition in R1 is in place
- **WHEN** a reader consults any of the three fold-only contract comments
- **THEN** each states that a results-only tick folds without dispatching *only when no event-driven flags are pending*, and the self-perpetuation rationale is preserved (an empty pending map keeps the fold-only path)

#### R3: Race regression test covers the bump-lands-mid-unit stall
`app/backend/api/sse_race_test.go` SHALL gain a regression test that simulates a generation bump landing while the server's poll unit is in flight and asserts the follow-up broadcast arrives promptly after the unit completes — bounded well below the safety interval, so the pre-fix code (which defers to the safety timer) fails the test.

- **GIVEN** a hub with a long safety interval (so the safety timer cannot mask the fix), a wired stub subscriber, and a scripted fetcher whose second `FetchSessions` call blocks until released (the in-flight unit) and whose subsequent call returns changed session data
- **WHEN** a bump dispatches the blocking fetch, a second bump lands while it blocks, and the block is then released
- **THEN** the client receives a `sessions` payload carrying the changed data within a bound far below the safety interval (e.g. 2s vs a 10s+ safety interval)

### Non-Goals

- No change to `app/frontend/src/app.tsx` URL-writeback or `internal/tmuxctl` — both exonerated by the diagnosis with measured evidence.
- No change to dispatch mechanics, single-flight, `pollSem` bound, debounce, cache TTL, or safety-timer cadence.

### Design Decisions

#### Pending-flag exception at the fold-only gate (not a re-dispatch elsewhere)
**Decision**: Amend only the `resultsOnly` computation to include `len(eventDrivenServers) == 0`; do not add a separate re-dispatch path or a retained-wake mechanism.
**Why**: The unit-completion results wake fires at exactly the moment the in-flight/sem-full skip clears, so letting that tick be a full tick dispatches the retained flag with its cache invalidation through the existing, tested dispatch pass. Self-perpetuation stays impossible: entries are consumed at dispatch and re-set only by real bumps/wakes.
**Rejected**: Re-arming a per-server wake when the dispatch pass skips an event-driven server (equivalent effect, but duplicates wake-channel machinery and adds a second signalling path to reason about); shortening the safety interval (papers over the hole, keeps worst-case latency).
*Introduced by*: 260908-whnu-sse-lost-wakeup-results-tick

## Tasks

### Phase 2: Core Implementation

- [x] T001 Amend the `resultsOnly` computation in `waitForNext` (`app/backend/api/sse.go` ~line 2344) to `results && !bumped && !woke && !timerFired && len(eventDrivenServers) == 0` <!-- R1 -->
- [x] T002 Update the three fold-only contract doc comments in `app/backend/api/sse.go` (the `waitForNext` `resultsOnly` return doc ~2227–2232, the peek `isResults` case comment ~2299–2304, the pre-computation comment ~2340–2343) to state the pending-flag exception while preserving the self-perpetuation rationale <!-- R2 -->

### Phase 3: Integration & Edge Cases

- [x] T003 Add the bump-lands-mid-unit regression test to `app/backend/api/sse_race_test.go`: scripted fetcher (call 1 returns baseline, call 2 blocks on a release channel and returns baseline, call 3+ returns changed data), long safety interval, stub subscriber; bump → wait for the blocked call, bump again, release, assert the changed-data `sessions` payload arrives within a bound far below the safety interval. Verify the test FAILS against the unamended condition before T001's change is counted done (TDD red/green on the one-line fix) <!-- R3 -->
- [x] T004 Run scoped tests, then the backend suite: `go test -race ./api/ -run 'TestSSE'` and `go test ./...` in `app/backend/` <!-- R1 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: With a bump consumed mid-unit-flight, the post-completion tick dispatches the pending server and the fresh snapshot broadcasts promptly (new regression test passes)
- [x] A-002 R2: All three fold-only contract comments state the amended condition; `rg -n "solely" app/backend/api/sse.go` (and the surrounding comment text) shows no remaining claim that unit-completion-only waits are unconditionally fold-only

### Behavioral Correctness

- [x] A-003 R1: With no pending event-driven flags, a results-only tick still folds without dispatching — the anti-self-perpetuation property holds (existing suite passes; the new test's baseline phase exercises normal fold behavior)

### Scenario Coverage

- [x] A-004 R3: The new test fails when the `len(eventDrivenServers) == 0` term is removed (verified red during apply) and passes with it

### Edge Cases & Error Handling

- [x] A-005 R1: `go test -race ./api/` passes — the amended read of `eventDrivenServers` in `waitForNext` introduces no data race (the map is poll-goroutine-owned; `waitForNext` runs on that goroutine)

### Code Quality

- [x] A-006 Pattern consistency: New code follows naming and structural patterns of surrounding code (test mirrors the existing `TestSSE_Race*` harness style: `fetchTracker`/scripted fetcher, `stubSubscriber`, drain goroutine, `t.Cleanup`)
- [x] A-007 No unnecessary duplication: Existing test helpers (`fetchTracker`, `newStubSubscriber`, `sseClient` construction) reused where applicable
- [x] A-008 Comment discipline: Updated comments state constraints the code can't show (the contract and its rationale), no narration, no change-ID citations in code comments

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

None — this change adds new functionality (a pending-flag term in the fold-only gate plus a regression test) without making existing code redundant.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Test mechanics: a scripted fetcher (per-call script with a block/release channel) + a short ordering sleep after the mid-flight bump, matching the sleep-based style of the existing race tests | The intake fixed the assertion contract and left simulation plumbing to apply; the scripted-fetcher shape is the minimal deterministic way to hold a unit in flight, and the file's existing tests already use sleeps for interleaving | S:65 R:90 A:80 D:70 |
| 2 | Confident | The new test pins promptness via a receive deadline (~2s) against a deliberately long safety interval (≥10s) rather than asserting exact tick counts | Bounding wall-clock against a widened safety margin is robust to scheduler jitter; exact tick-count assertions would couple the test to loop internals | S:60 R:90 A:85 D:75 |

2 assumptions (0 certain, 2 confident, 0 tentative).
