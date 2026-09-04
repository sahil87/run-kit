# Plan: sseHub Race Fixes + Wake on Cold Subscribe

**Change**: 260904-jjda-ssehub-races-cold-subscribe-wake
**Intake**: `intake.md`

## Requirements

> Line numbers verified at HEAD `b53e0cad` (plan-of-record `fd16e6b4` + docs/chore commits; all cited structures confirmed). Re-verify with grep before each edit — subsequent tasks shift lines.

### SSE Hub: Cache Synchronization (B.1)

#### R1: Every `h.cache` access is under `h.mu`
`poll()` MUST NOT access `h.cache` without holding `h.mu`. The three unsynchronized poll-side sites — the event-driven invalidation `delete(h.cache, server)` (`sse.go:1416`), the TTL read (`sse.go:1420`), and the post-fetch write (`sse.go:1438`) — SHALL be brought under `h.mu`, consistent with the existing locked accesses (`sendCachedPreviewLocked` `sse.go:1157`, dead-server reap `sse.go:1676`). `h.mu` MUST NOT be held across `FetchSessions` (a subprocess exec with up to 10s of inner execs) or `capturePreviews` — lock only around the map/value operations (the code-review rule "API routes must not block on tmux operations" extends to lock hold times here).

- **GIVEN** the poll goroutine ticking a server and a concurrent handler goroutine running subscribe/preview-scope (which reads `h.cache` under `h.mu`)
- **WHEN** both execute concurrently under the race detector
- **THEN** no data race is reported and the daemon cannot die from a concurrent-map-access runtime throw

#### R2: The cached snapshot's in-place mutation is under `h.mu`
`attachPRStatus(result)` (`sse.go:1459`, func at `sse.go:1282`) mutates cached `WindowInfo` values in place (`result` and `h.cache[server].data` are the same slice — comment at `sse.go:1447`). This mutation SHALL run under `h.mu` so handler-side readers of the same slice (`sendCachedPreviewLocked` → `windowsBySession(cached.data)`) cannot observe torn writes. `attachPRStatus` is pure in-memory (collector snapshot read, no I/O), so holding `h.mu` across it is bounded. Poll-goroutine-local reads of `result` after the mutation (marshal, trackers, previews) need no lock — the poll goroutine is the only mutator.

- **GIVEN** a cache-hit tick re-running `attachPRStatus` on the cached slice
- **WHEN** a subscribe/preview-scope handler concurrently reads that slice under `h.mu`
- **THEN** the race detector reports no value-level race

### SSE Hub: Subscriber Field (B.2)

#### R3: `subscriber` reads/writes are synchronized
The plain write `s.sseHub.subscriber = sub` (`tmuxctl_bridge.go:209`) races `poll()`-side plain reads (`safetyIntervalEffective` `sse.go:384,393`; `waitForNext` `sse.go:1869,1871`; peek closure `sse.go:1901`). The field SHALL be guarded: `SetWindowChangeSubscriber` writes under `h.mu`, and the poll path takes ONE snapshot of the field per `waitForNext` invocation under `h.mu.RLock` (a small accessor), using the local snapshot everywhere within the call — including inside the peek closure and `safetyIntervalEffective` (passed in or read via the same accessor at its single call site `sse.go:1860`). Ordering alone is NOT sufficient: the hub can be materialized and polling before `rk serve` wires the supervisor (`serve.go:232`), so the guard is mandatory. Per-call snapshot semantics (not per-read) keep one consistent subscriber view across a single wait.

- **GIVEN** a hub whose poll loop is running (a client subscribed early)
- **WHEN** `SetWindowChangeSubscriber` is called concurrently from the serve goroutine
- **THEN** the race detector reports no race, and the loop picks up the subscriber on a subsequent iteration
- **AND** a nil subscriber preserves today's timer-only behavior (unit-test hubs, PTY-unavailable hosts)

### SSE Hub: Cold-Subscribe Freshness (B.3)

#### R4: A cold subscribe gets its first snapshot without waiting out the safety interval
Two cold shapes exist, and BOTH shall be covered:

1. **Server already in the poll set but no snapshot yet** (`h.previousJSON[key]` absent — e.g. first fetch failed or hasn't completed): the subscribe-ack path (`stateSubscribe`, ack critical section `sse.go:723-745`) SHALL call `h.wake(key)` when the `kindServer` ack finds no `previousJSON[key]`. The wake MUST be issued AFTER `h.mu.Unlock()` — `wake()` takes `h.mu.RLock` (`sse.go:1786`) and Go's `sync.RWMutex` is not reentrant; calling it under the held write lock deadlocks. `wake()`'s allocation gate passes because `addClient` (`sse.go:707`) registered the subscription before the ack section.
2. **Server new to the poll set entirely** (the incident's headline case): a per-server wake CANNOT unpark the loop — `waitForNext` builds wait cases only for the server list snapshot taken at the top of the current iteration (`sse.go:1383-1387`, cases at `sse.go:1867-1874`), so a brand-new server's wake channel is watched by nobody. `addClient` SHALL therefore signal a hub-level **membership wake** when it registers a server key not previously in `h.clients` while the loop is already polling (`h.polling == true`), and `waitForNext` SHALL always include the membership-wake channel as an additional wait case. On firing, the loop re-derives its server list (which now includes the new server) and the tick fetches it — no per-server bookkeeping needed. The membership wake follows the existing close-based, consume-and-replace channel idiom (`wake`/`wakeChannel`/`consumeWake`, guarded by `wakeMu`); it does NOT enter `eventDrivenServers` (a brand-new server has no cache to invalidate) and does NOT touch subscriber generation bookkeeping.

**Storm guard**: a warm resubscribe (snapshot present) SHALL NOT wake; an already-registered key in `addClient` SHALL NOT fire the membership wake. `removeClientLocked` deletes an emptied key (`sse.go:521-522`), so unsubscribe→resubscribe of a genuinely-left server correctly re-fires membership.

- **GIVEN** the poll loop parked in `waitForNext` on server list `[A]` with the long safety interval in effect
- **WHEN** a client subscribes to server B (not in the list)
- **THEN** the loop unparks promptly (well before the safety interval), the next pass fetches B, and B's clients receive their first `sessions` snapshot
- **AND GIVEN** a second client subscribing to already-polled server A with `previousJSON[A]` populated
- **WHEN** the subscribe ack carries the snapshot
- **THEN** no wake fires (dedup and cadence unchanged — no waking storms)

### Verification: Race Detector Coverage (B.5)

#### R5: The touched package runs under `-race` in CI scope
No `-race` exists today (justfile `test-backend` → `go test ./...`; CI runs `just test-backend`). CI SHALL run the api package under the race detector: add a `test-backend-race` justfile recipe (one-liner per Constitution VIII) running `go test -race ./api/...` in `app/backend`, and a CI step invoking it in the backend job (`.github/workflows/ci.yml`). The new concurrency tests MUST fail under `-race` against the pre-fix code (verified during development) and pass post-fix.

- **GIVEN** the CI backend job
- **WHEN** it runs
- **THEN** `go test -race` covers `app/backend/api` and gates the merge

### Non-Goals

- Restructuring `poll()` (bounded concurrency, per-server fan-out, moving global broadcasts) — that is plan Change C, which rebases on this change.
- Moving `h.cache` ownership into the poll goroutine / copy-out semantics — the structural alternative deliberately deferred to C.
- Whole-repo `-race` (`go test -race ./...` everywhere) — only the touched package is mandated; broadening is a separate decision (tmux-heavy packages have runtime cost).

### Design Decisions

#### Membership wake companion to the prescribed per-server wake
**Decision**: B.3 lands as TWO triggers — `h.wake(key)` from the cold subscribe-ack path (plan-prescribed) plus a hub-level membership wake from `addClient` for keys new to `h.clients`, always waited on by `waitForNext`.
**Why**: code inspection shows `waitForNext` selects only over wake channels for servers in the list snapshot taken before parking (`sse.go:1867-1874`) — the prescribed per-server wake alone cannot unpark the loop for a server absent from that list, which is exactly the incident's cold-navigation case. The membership wake is the minimal mechanism that reaches it.
**Rejected**: rebuilding wait cases dynamically mid-wait (structural — Change C territory); waking ALL existing keys on any subscribe (wake storm, defeats coalescing); shortening the safety interval (papers over the hole, keeps worst-case latency).
*Introduced by*: 260904-jjda-ssehub-races-cold-subscribe-wake

#### Consistent locking over cache-ownership move
**Decision**: fix B.1 by extending `h.mu` coverage to the poll-side accesses and the `attachPRStatus` mutation, keeping the cache map shared.
**Why**: surgical (B's mandate) and keeps Change C's rebase clean; the alternative (poll-goroutine ownership + copies) reshapes the same code C will restructure anyway.
**Rejected**: cache ownership move with copy-out — a deep copy per tick or COW discipline is structural work with no incremental safety over consistent locking here.
*Introduced by*: 260904-jjda-ssehub-races-cold-subscribe-wake

#### Subscriber guarded via `h.mu` snapshot-per-wait, not atomics
**Decision**: `SetWindowChangeSubscriber` writes under `h.mu`; `waitForNext` reads one snapshot per invocation via an accessor under `h.mu.RLock` and threads it through (incl. `safetyIntervalEffective` and the peek closure).
**Why**: `h.mu` is already the hub's field guard; the read is once per wait (cold path), so contention is nil; an `atomic.Value`/`atomic.Pointer` adds a second synchronization vocabulary for no measurable gain.
**Rejected**: set-before-start ordering (fragile — an early client connect starts polling before `serve.go:232` wires the supervisor); atomics (needless second idiom).
*Introduced by*: 260904-jjda-ssehub-races-cold-subscribe-wake

## Tasks

### Phase 1: Setup

- [x] T001 Re-verify all cited line anchors at working HEAD with grep (`h.cache` sites, `subscriber` sites, `stateSubscribe` ack section, `addClient`, `waitForNext`) in `app/backend/api/sse.go` and `app/backend/api/tmuxctl_bridge.go`; adjust subsequent task targets if drifted <!-- R1 -->

### Phase 2: Core Implementation

- [x] T002 Bring poll-side `h.cache` accesses under `h.mu` in `app/backend/api/sse.go` `poll()`: locked section for the event-driven invalidate + TTL read (yielding `result` or a fetch decision), fetch outside the lock, locked write-back; `h.mu` never held across `FetchSessions` <!-- R1 -->
- [x] T003 Run the `attachPRStatus(result)` call site under `h.mu` in `app/backend/api/sse.go` <!-- R2 -->
- [x] T004 Guard the subscriber field in `app/backend/api/sse.go` + `app/backend/api/tmuxctl_bridge.go`: write under `h.mu` in `SetWindowChangeSubscriber`; add an accessor reading under `h.mu.RLock`; `waitForNext` takes one snapshot per call and threads it through `safetyIntervalEffective` and the peek closure (nil-subscriber behavior unchanged) <!-- R3 -->
- [x] T005 Cold-subscribe per-server wake in `app/backend/api/sse.go` `stateSubscribe`: record cold (kindServer ∧ empty `previousJSON[key]`) inside the ack critical section, call `h.wake(key)` after unlock (never under `h.mu` — RWMutex non-reentrant) <!-- R4 -->
- [x] T006 Membership wake in `app/backend/api/sse.go`: `wakeMu`-guarded hub-level channel with the close/consume-replace idiom; `addClient` fires it for a key new to `h.clients` when `h.polling`; `waitForNext` always includes it as a wait case (no `eventDrivenServers`, no generation bookkeeping) <!-- R4 -->

### Phase 3: Integration & Edge Cases

- [x] T007 [P] Race regression tests in `app/backend/api/sse_test.go` (or a new `sse_race_test.go`): concurrent poll ticks vs subscribe/preview-scope handler traffic (R1/R2), and concurrent `SetWindowChangeSubscriber` vs running loop (R3) — verified to FAIL under `-race` pre-fix, pass post-fix <!-- R1 -->
- [x] T008 [P] Cold-subscribe promptness tests in `app/backend/api/sse_subscriber_test.go`: parked loop (long `safetyInterval` override) + subscribe to a NEW server → first snapshot promptly (membership wake); cold subscribe to an in-set server → wake fires; warm resubscribe → no wake (storm guard) <!-- R4 -->
- [x] T009 Add `test-backend-race` recipe to `justfile` (one-liner: `cd app/backend && go test -race ./api/...`) and a CI step invoking it in the backend job of `.github/workflows/ci.yml` <!-- R5 -->

### Phase 4: Polish

- [x] T010 Full verification gates: `cd app/backend && go test ./...`, `just test-backend-race`, frontend `npx tsc --noEmit` (should be untouched), `just build` <!-- R5 -->

## Execution Order

- T001 first (anchor verification), then T002 → T003 (same poll-loop region, sequential), T004–T006 next (T005/T006 touch `stateSubscribe`/`addClient`/`waitForNext` — after T004's `waitForNext` snapshot change to avoid churn)
- T007/T008 parallel after Phase 2; T009 independent after tests exist; T010 last

## Acceptance

### Functional Completeness

- [x] A-001 R1: All `h.cache` accesses (poll-side invalidate/read/write and handler-side reads) execute under `h.mu`; no unsynchronized access remains in `sse.go`
- [x] A-002 R2: The `attachPRStatus` in-place mutation of the cached slice runs under `h.mu`
- [x] A-003 R3: `subscriber` has no unsynchronized read or write; `SetWindowChangeSubscriber` is safe against a running poll loop
- [x] A-004 R4: Cold subscribe (both shapes — new-to-poll-set server and in-set server without a snapshot) produces the first `sessions` snapshot without waiting out the safety interval
- [x] A-005 R5: CI runs `go test -race` over `app/backend/api` via a justfile recipe

### Behavioral Correctness

- [x] A-006 R1: `h.mu` is never held across `FetchSessions` or `capturePreviews` — lock hold times bounded to in-memory operations
- [x] A-007 R3: With `subscriber == nil` the hub behaves exactly as before (timer-only wait, legacy interval selection)
- [x] A-008 R4: Warm resubscribe fires no wake; repeat subscribe to a registered key fires no membership wake; wake coalescing and `previousJSON` dedup semantics unchanged

### Scenario Coverage

- [x] A-009 R1: A race test exercising concurrent poll/handler cache access exists and passes under `-race` (and demonstrably failed pre-fix)
- [x] A-010 R3: A race test exercising concurrent subscriber wiring exists and passes under `-race`
- [x] A-011 R4: A promptness test proves a parked loop unparks for a brand-new server subscription well before the safety interval

### Edge Cases & Error Handling

- [x] A-012 R4: `h.wake` is never invoked while `h.mu` is held (no RWMutex re-entrancy deadlock); the membership wake respects the `h.mu → wakeMu` lock order documented at `sse.go:1687-1690`
- [x] A-013 R4: Unsubscribe-then-resubscribe of the last client on a server (key deleted by `removeClientLocked`) re-fires the membership wake and recovers freshness

### Code Quality

- [x] A-014 Pattern consistency: new synchronization follows the hub's existing idioms (close-based wake channels, `wakeMu` separation rationale at `sse.go:318-321`, locked-suffix helper naming)
- [x] A-015 No unnecessary duplication: the membership wake reuses the existing consume/replace channel idiom rather than a parallel mechanism
- [x] A-016 Comments state constraints (lock-order, non-reentrancy, single-writer invariants) — no narration, no change-ID citations in code
- [x] A-017 No new caches, no database, no polling from the client — Constitution II/anti-patterns untouched

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

None — this change adds synchronization and wake paths without making existing code redundant.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Membership wake added beyond the plan's literal `h.wake(key)` prescription | Code inspection: `waitForNext` cases cover only the parked iteration's server list (`sse.go:1867-1874`), so the prescribed fix alone cannot unpark for a new server — the incident's headline case; minimal mechanism chosen | S:75 R:75 A:85 D:70 |
| 2 | Confident | `attachPRStatus` held under `h.mu` (bounded in-memory work) rather than deep-copying the snapshot | Function is pure in-memory (`sse.go:1282-1315`); a copy per tick is the rejected structural path | S:70 R:80 A:85 D:75 |
| 3 | Confident | Subscriber snapshot taken once per `waitForNext` call, not per read | One consistent view per wait; the field is set once in production, so staleness is bounded to one iteration | S:70 R:85 A:85 D:75 |
| 4 | Confident | `-race` lands as a separate `test-backend-race` justfile recipe + CI step scoped to `./api/...` | Plan says "CI scope for this package"; whole-tree `-race` slows tmux-heavy integration packages — out of mandate | S:70 R:85 A:80 D:70 |
| 5 | Certain | Cold wake fires only when the ack finds no `previousJSON[key]`; membership wake only for keys new to `h.clients` | The storm guard both the plan's review question and existing wake-gating semantics require | S:85 R:85 A:90 D:85 |

5 assumptions (1 certain, 4 confident, 0 tentative).
