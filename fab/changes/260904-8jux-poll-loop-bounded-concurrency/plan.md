# Plan: Poll Loop Bounded Concurrency

**Change**: 260904-8jux-poll-loop-bounded-concurrency
**Intake**: `intake.md`

## Requirements

### SSE Hub: Poll Loop Fan-Out

#### R1: Bounded per-server fan-out
`poll()` (`app/backend/api/sse.go:1417`) SHALL execute the per-server poll body (today's
sequential loop body at `:1471–1708`: cache check → `FetchSessions` → `attachPRStatus` →
waiting-push/auto-name/operator-queue advance → sessions marshal/dedup/emit → previews →
order bootstrap → disappearance WARN) as an independent per-server **unit of work** run on a
semaphore-bounded set of worker goroutines, with the bound a small named constant. Within one
unit, execution stays serial exactly as today (`capturePreviews`' one exec per expanded window
remains sequential).

- **GIVEN** a poll set of N subscribed servers and a concurrency bound C
- **WHEN** a tick dispatches units
- **THEN** at most C units run concurrently, each unit touches exactly one tmux server, and no
  tmux server ever has concurrent execs issued by more than one unit

#### R2: Per-server single-flight, across ticks and poll restarts
The hub SHALL never run two units for the same server concurrently — including across ticks
(a tick MUST skip dispatching a server whose previous unit is still running) and across poll
goroutine restarts (the `total == 0` exit at `:1434–1450` followed by a later `addClient`
re-spawn MUST NOT double-dispatch a server whose straggler unit from the previous poll
goroutine is still running). Single-flight bookkeeping therefore lives on the hub, not in
`poll()`-local state.

- **GIVEN** a server whose unit is still executing (slow `FetchSessions`)
- **WHEN** the next tick begins (wake, safety timer, or a fresh poll goroutine after restart)
- **THEN** no second unit is dispatched for that server; the tick proceeds for every other
  server; the skipped server's pending cache-invalidation flag (if any) is preserved for its
  next dispatch

#### R3: Per-unit event emission
Each unit SHALL emit its own server's events (`sessions` dedup + fan-out, `preview`,
`session-order` bootstrap) when it completes its fetch — never batched at end of tick. The
per-server ack-ordering invariant MUST hold: `h.previousJSON[server]` is updated before that
server's fan-out (guarded today by `TestStateWS_SubscribeAckNotStaleUnderPollInterleave`).

- **GIVEN** server A (fast) and server B (artificially slow fetch) polled in the same tick
- **WHEN** A's unit completes while B's is still fetching
- **THEN** A's `sessions` event is delivered to A's clients without waiting for B

#### R4: Global broadcasts independent of per-server work
The host-global broadcasts — metrics (today `:1787–1799`), services (`:1803–1815`),
code-server (`:1822–1831`) — SHALL be emitted every tick **before** (or otherwise independent
of) per-server unit dispatch, preserving their existing shape (pre-rendered once, cached-slot
update + `broadcastGlobalLocked` under `h.mu`).

- **GIVEN** one server whose fetch hangs to its exec deadlines
- **WHEN** ticks elapse
- **THEN** every connected client keeps receiving `metrics`/`services`/`code-server` events at
  tick cadence, undelayed by the hung server

#### R5: Join-free result folding; sweep semantics preserved
Units SHALL deliver a per-unit result (server, polled/dead outcome, live waiting-push keys,
live auto-name keys) to a hub-level results channel and signal a coalescing **results wake**;
the poll goroutine SHALL fold all completed results at the top of each tick and run the
end-of-tick consumers over the folded view:

- `waitingPush.retain` / `autoName.retain` / `operatorQueue.retain` keep their observed-server
  scoping exactly: a server counts as observed only when its unit's result was folded
  (successfully polled → `polledServers`; confirmed gone → dead set). A server skipped
  (in-flight) or transiently failed is in neither set and its episodes are untouched.
- The dead-server reap (`gone` frame emission, deletion from `h.clients` and every per-server
  map, wake-channel drop) stays a single block under one write lock, operating on folded dead
  results — never mid-unit.
- Because unit completion signals the results wake, a dead server's `gone` frame and the
  sweeps run promptly (next fold), never parked until the 12s safety timer.

- **GIVEN** a server whose unit is still in flight when a tick folds results
- **WHEN** the retain sweeps run
- **THEN** that server is in neither `polledServers` nor the dead set, and its still-waiting
  episodes survive (no reap, no duplicate push on recovery)

#### R6: Poll-goroutine ownership of wait bookkeeping
`perServerGen` and `eventDrivenServers` SHALL remain owned by the poll goroutine. The
cache-invalidation decision for a server (its `eventDrivenServers` flag) is consumed at
dispatch time in the poll goroutine and passed into the unit as an immutable value; workers
never touch the two maps. `h.waitForNext` remains a single call by the poll goroutine per
tick, extended with the results-wake case (no per-server bookkeeping for a results win,
mirroring the membership wake).

- **GIVEN** the poll goroutine parked in `waitForNext`
- **WHEN** a straggler unit completes
- **THEN** the results wake unparks the loop, the result folds, and no worker goroutine has
  read or written `perServerGen`/`eventDrivenServers`

#### R7: No event-contract change
The change SHALL NOT alter any event type, envelope, payload shape, dedup behavior, cadence
contract, or reap semantics observable by clients. The existing test suite passes unchanged
(tests pin the event contract, not the loop shape).

- **GIVEN** the current `api` package test suite
- **WHEN** run against the reworked poll loop
- **THEN** all existing tests pass without modification

#### R8: Race-clean under load
The fan-out SHALL be race-clean: the touched package tests pass under `go test -race`,
including the new concurrency tests.

- **GIVEN** `go test -race ./api/...` (from `app/backend`)
- **WHEN** the suite runs
- **THEN** zero data races are reported

### Non-Goals

- No change to `FetchSessions` internals or `capturePreviews` (Change F owns the git-fallback
  storm inside FetchSessions; per-window capture stays serial by design).
- No change to `/api/servers` (Change D, merged) or socket hygiene (Change E).
- No per-tick time budget knob — superseded by the join-free design (see Design Decisions).
- No settings-registry exposure of the concurrency bound.

### Design Decisions

#### Join-free tick: async units + fold-at-tick-top + results wake
**Decision**: The poll goroutine dispatches units and immediately proceeds to `waitForNext`
without joining; unit results arrive on a buffered hub-level channel, are folded at the top of
the next tick, and unit completion signals a coalescing results wake (the membership-wake
close/replace idiom) so folding is prompt.
**Why**: A full `WaitGroup` join would re-introduce head-of-line blocking at the tick boundary
— one slow unit (worst case tens of seconds of inner exec deadlines) would park the loop, so a
woken fast server's next snapshot and the dead-server `gone` frames would wait on the
straggler. Join-free, nothing ever waits on a slow server: fast servers re-poll on their own
wakes while the straggler runs, and its skipped ticks are guarded by single-flight.
**Rejected**: (a) Full per-tick join — simplest, but the tick re-arm waits on the slowest
unit, materially weakening the fix for exactly the incident scenario. (b) Budgeted join
(per-tick time budget) — bounds the wait but still delays sweeps/`gone` frames up to the
budget every straggler tick, and adds a tuning knob the join-free shape doesn't need.
(c) Per-server poll goroutines with per-server waits — strongest isolation but a much larger
rework of `waitForNext`/`selectFirst` and the safety-timer model; not needed to meet R3/R4.
*Introduced by*: 260904-8jux-poll-loop-bounded-concurrency

#### Concurrency bound: named constant, order 6
**Decision**: `ssePollConcurrency = 6` as a package constant beside `safetyPollInterval`
(`sse.go:80`), with a doc comment stating the fork-storm bound rationale.
**Why**: Bounds daemon fork pressure during server storms (the incident: >1 test server/s);
6 covers the realistic live-server count while keeping worst-case concurrent tmux execs low.
Constitution VII (convention over configuration): no settings key.
**Rejected**: settings-registry exposure (no demonstrated need; trivially tunable as a
constant); `GOMAXPROCS`-derived bound (workload is subprocess-bound, not CPU-bound).
*Introduced by*: 260904-8jux-poll-loop-bounded-concurrency

#### Behavior-preserving extraction before concurrency
**Decision**: First extract the loop body into a `pollServerUnit` method and land it still
serial (pure refactor), then introduce dispatch/fold in a separate task.
**Why**: Separates the mechanical extraction (large diff, zero behavior change, existing tests
prove it) from the semantic change (concurrency, small diff, new tests prove it) — the review
can attribute any regression to the right task.
**Rejected**: one-shot rewrite of `poll()` — conflates refactor and behavior change in the
hottest path of the daemon.
*Introduced by*: 260904-8jux-poll-loop-bounded-concurrency

## Tasks

### Phase 1: Setup

- [x] T001 Add scaffolding in `app/backend/api/sse.go`: constant `ssePollConcurrency` (6, doc
  comment: fork-pressure bound, parallelism across servers never within one) beside the
  existing poll constants (`:75–105`); a `pollUnitResult` struct (server string, dead bool,
  polled bool, waitingKeys/autoNameKeys map[string]bool); hub fields for the fan-out —
  in-flight server set, semaphore, buffered results channel (capacity ≥ bound), and results
  wake channel — initialized wherever the hub's other maps are initialized (locate the hub
  constructor / lazy-init site and match its pattern). Add results-wake helpers
  `signalResultsWake`/`resultsWakeChannel`/`consumeResultsWake` mirroring the membership-wake
  trio (`sse.go:1941–1988`), guarded by `wakeMu`. <!-- R1, R5 -->

### Phase 2: Core Implementation

- [x] T002 Extract the per-server loop body (`sse.go:1471–1708`) into a method
  `pollServerUnit(server string, invalidateCache bool) pollUnitResult` — behavior-preserving:
  the `eventDrivenServers` consumption moves to the caller (passed as `invalidateCache`); the
  loop-local accumulators (`deadServers`, `liveWaitingKeys`, `liveAutoNameKeys`,
  `polledServers`) become fields of the returned `pollUnitResult`; every existing lock
  boundary, comment, and ordering inside the body is preserved verbatim. `poll()` still calls
  it **serially** in this task. Run `cd app/backend && go test ./api/...` — all existing tests
  green with zero test edits. <!-- R1 -->
- [x] T003 Move the three global broadcast blocks (metrics `:1787–1799`, services
  `:1803–1815`, code-server `:1822–1831`) ahead of the per-server work in `poll()`, unchanged
  in shape. Update the comments that describe tick ordering. <!-- R4 -->
- [x] T004 Introduce the fan-out in `poll()`: at tick top, fold any completed
  `pollUnitResult`s (drain the results channel non-blocking) into the tick's
  `polledServers`/dead set/live-key maps and run the retain sweeps + dead-server reap over the
  folded view (preserving the observed-server scoping comments at `:1710–1735` and the
  single-write-lock reap block at `:1747–1783`); then dispatch: for each server (skipping
  `metricsOnlyServer` and any in-flight server), consume its `eventDrivenServers` flag,
  acquire the semaphore, mark in-flight, and run `pollServerUnit` on a worker goroutine that
  on completion delivers its result to the results channel, clears in-flight, releases the
  semaphore, and calls `signalResultsWake`. In-flight/semaphore state is hub-level so
  single-flight holds across poll-goroutine restarts (R2); a skipped in-flight server's
  pending invalidation flag is left un-consumed. Update `poll()`'s architecture comments to
  describe the new tick shape (fold → global broadcasts → dispatch → wait). <!-- R1, R2, R5, R6 -->
- [x] T005 Extend `waitForNext` (`sse.go:2015`) with the results-wake wait case: build it into
  `cases` alongside the membership case, route it in `peek()` via `consumeResultsWake` (sets
  `woke`, no per-server bookkeeping), and include it in the debounce-window `wakeCases`
  filter. Update the function comment. <!-- R5, R6 -->
- [x] T006 Dead/reaped-server bookkeeping under fan-out: ensure the dead-server reap and the
  `total == 0` poll exit leave no stale in-flight entries or leaked semaphore slots (a
  straggler for a just-reaped server completes harmlessly: its late result folds and its
  server, absent from `h.clients`, no-ops through the sweeps), and that a fresh poll goroutine
  starting while stragglers run neither double-dispatches (R2) nor mis-folds their results.
  Document the ownership in comments where the reap deletes per-server maps. <!-- R2, R5 -->

### Phase 3: Integration & Edge Cases (tests)

- [x] T007 [P] Test in `app/backend/api/sse_test.go` (or the file where hub poll tests live):
  with a stub fetcher where server B blocks until released and server A returns instantly,
  subscribe clients to both; assert A's `sessions` event arrives while B is still blocked
  (the plan's review question, half 1). <!-- R3 -->
- [x] T008 [P] Test: with server B blocked, assert the global `metrics` broadcast is still
  emitted (arrives at a subscribed client) while B is blocked (review question, half 2). <!-- R4 -->
- [x] T009 [P] Test single-flight: a fetcher stub that counts concurrent in-flight calls per
  server; drive multiple wakes/ticks while one server's fetch is blocked; assert the per-server
  concurrent count never exceeds 1 (across ticks), while other servers proceed. <!-- R2 -->
- [x] T010 [P] Test retain scoping under fan-out: with server B's unit in flight across a
  fold, assert B's waiting-push episodes are NOT reaped (tracker state preserved), and a
  server whose unit reported dead IS swept. <!-- R5 -->
- [x] T011 Run the verification gates: `cd app/backend && go test -race ./api/...` (new tests
  included), then `go test ./...`; confirm zero existing-test edits were needed (R7). <!-- R7, R8 -->

## Execution Order

- T001 → T002 → T003/T004 → T005 → T006 (T003 may land with T004; T005 depends on T004's
  results channel; T006 hardens T004)
- T007–T010 are parallel after T006; T011 last

## Acceptance

### Functional Completeness

- [x] A-001 R1: The per-server poll body runs as bounded-concurrent units (named-constant
  bound); within a unit execution is serial; no code path issues concurrent execs against one
  tmux server from two units
- [x] A-002 R4: metrics/services/code-server broadcasts are emitted ahead of / independent of
  per-server units, every tick, unchanged in shape (preRendered + cached slot + broadcastGlobalLocked)
- [x] A-003 R5: Unit results fold at tick top; retain sweeps and the dead-server reap consume
  only folded results, in one post-fold block (reap under a single write lock)
- [x] A-004 R6: `perServerGen`/`eventDrivenServers` are touched only by the poll goroutine;
  invalidation is consumed at dispatch; `waitForNext` carries the results-wake case

### Behavioral Correctness

- [x] A-005 R3: A slow server does not delay another server's `sessions` emission (test from
  T007 proves it)
- [x] A-006 R4: A slow server does not delay the global metrics broadcast (test from T008)
- [x] A-007 R2: No two units for one server ever run concurrently, including across ticks and
  poll-goroutine restarts (test from T009)

### Scenario Coverage

- [x] A-008 R5: A server with an in-flight unit at fold time is treated as not-observed — its
  waiting-push/auto-name episodes survive the sweep (test from T010)
- [x] A-009 R5: A dead server's `gone` frame and map cleanup occur promptly after its unit
  completes (results wake unparks the loop), not only on the 12s safety timer

### Edge Cases & Error Handling

- [x] A-010 R2: A straggler unit outliving its poll goroutine (total==0 exit, then re-spawn)
  neither double-dispatches its server nor corrupts fold state
- [x] A-011 R7: Transient (non-IsServerGone) fetch failure keeps today's semantics: WARN log,
  server stays in the poll set, not in polledServers for that tick

### Code Quality

- [x] A-012 Pattern consistency: results-wake helpers mirror the membership-wake trio's
  idiom (close/replace, wakeMu guard, at-least-once comments); lock order h.mu → wakeMu
  preserved everywhere
- [x] A-013 No unnecessary duplication: the unit body is extracted once (pollServerUnit), not
  copied; existing helpers (preRendered, expandedUnionLocked, windowsBySession) reused
- [x] A-014 Comment discipline: comments state invariants and ownership (single-flight,
  fold scoping, lock boundaries), never narrate the diff or cite the change ID
- [x] A-015 exec discipline: no new subprocess calls; all existing exec.CommandContext
  timeout usage untouched (Constitution I)
- [x] A-016 Tests conform to spec (Test Integrity): new tests assert the R-requirements, no
  implementation change made solely to accommodate test fixtures

### Security

- [x] A-017 R1: No user-controlled input reaches goroutine dispatch decisions beyond the
  already-validated server names in h.clients; the semaphore bounds subprocess fan-out

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

None — this change adds new functionality without making existing code redundant. The
sequential per-server loop body was replaced in place by the `pollServerUnit` extraction
(no dead copy left behind), and all pre-existing helpers (`preRendered`,
`expandedUnionLocked`, `windowsBySession`, the membership-wake trio) remain in use.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Join-free tick (async units + fold + results wake) over full/budgeted join | Intake left join topology open (assumption 7); join-free is the only shape where nothing waits on a straggler — directly answers the review question | S:70 R:60 A:80 D:70 |
| 2 | Confident | `ssePollConcurrency = 6` | Intake said "order 4–8, named constant"; 6 covers realistic live-server counts, trivially tunable | S:60 R:90 A:75 D:70 |
| 3 | Confident | Hub-level in-flight/semaphore/results state (not poll-local) | Required by R2's across-restart single-flight; matches existing hub-field pattern (wakes, membershipWake) | S:75 R:70 A:85 D:80 |
| 4 | Certain | Extraction-first task split (T002 serial, T004 concurrent) | Pure sequencing choice inside apply; existing tests gate the extraction step | S:80 R:95 A:95 D:90 |
| 5 | Confident | Results channel buffered ≥ bound; unit completion never blocks on delivery | In-flight count ≤ semaphore bound by construction, so capacity ≥ bound guarantees non-blocking sends | S:65 R:75 A:85 D:80 |

5 assumptions (1 certain, 4 confident, 0 tentative).
