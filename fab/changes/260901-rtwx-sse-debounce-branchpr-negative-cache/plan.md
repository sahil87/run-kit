# Plan: SSE Derive Debounce + Branch-PR Negative Caching

**Change**: 260901-rtwx-sse-debounce-branchpr-negative-cache
**Intake**: `intake.md`

## Requirements

### SSE Hub: Event-Driven Derive Coalescing

#### R1: Subscriber generation bumps are coalesced for a fixed debounce window
When `waitForNext` (`app/backend/api/sse.go`) observes a **control-mode subscriber generation bump** (a non-wake `waitCase` fired), the hub MUST wait a fixed coalescing window — a new unexported constant `sseEventDebounce = 300 * time.Millisecond` in the existing `const` block — before returning to `poll()`, absorbing every further subscriber bump that lands during the window into the same single pass (trailing-edge coalescing). The window MUST NOT extend on further bumps (fixed, not sliding), so a steady event stream derives at most once per window rather than once per event.

- **GIVEN** a hub with a wired `WindowChangeSubscriber` and one subscribed server
- **WHEN** N generation bumps for that server arrive within one `sseEventDebounce` window
- **THEN** the hub performs exactly one cache invalidation + `FetchSessions` derive for that burst
- **AND** a bump arriving after the window closes triggers a subsequent derive (nothing is lost — `perServerGen` bookkeeping reflects every observed generation, and a bump landing after the final peek fires the next `waitForNext` immediately)

#### R2: Explicit wake() signals bypass the debounce entirely
A wake win (`waitCase.isWake`, consumed via `consumeWake`) MUST NOT be delayed by the debounce: a wake that fires **during** a pending debounce window MUST end the wait immediately (the pass proceeds at once, carrying both the wake-driven and any bump-driven `eventDrivenServers` entries), and a pass whose trigger was wake-only MUST NOT enter the debounce at all. The wake seam exists for sub-second post-mutation repaint (user-option POSTs emit no control-mode event); delaying it would regress a shipped latency fix.

- **GIVEN** a pending debounce window opened by a subscriber generation bump
- **WHEN** `wake(server)` fires mid-window
- **THEN** `waitForNext` returns without waiting out the remainder of the window
- **GIVEN** a hub with no pending bumps
- **WHEN** only `wake(server)` fires
- **THEN** the pass proceeds immediately with zero added latency

#### R3: Safety-timer and cache-TTL semantics are unchanged
The `safetyPollInterval` (12s), `legacyPollInterval` (2.5s), and `sseCacheTTL` (500ms) constants and their semantics MUST remain untouched. A timer-win pass (no events) MUST behave exactly as today — no debounce is entered. The debounce sits only between "subscriber bump observed" and "return to poll for cache invalidation + derive".

- **GIVEN** a hub with subscribed servers and no events arriving
- **WHEN** the safety timer elapses
- **THEN** the pass runs immediately as today, with no added `sseEventDebounce` delay

### Branch-PR Refresher: Negative-Result TTL

#### R4: A gh-confirmed negative suppresses the gh fallback for a TTL
`branchEntry` (`app/backend/internal/prstatus/prstatus_branch.go`) MUST gain a confirmation timestamp (e.g. `negativeAt time.Time`) that is set **only** on the gh-path write when a successfully parsed `gh pr list` result yields `pr == nil` (the true-negative write at the end of the pass loop), and zeroed whenever the entry gains a PR (gh-path positive or viewer-index hit). A new unexported constant `branchPRNegativeTTL = 10 * time.Minute` MUST sit alongside the existing TTL constants with a comment stating the staleness bound. At the gh-fallback step of `refreshPass`, a pair whose entry holds a **fresh** negative (`negativeAt` non-zero AND `now.Sub(negativeAt) < branchPRNegativeTTL`) MUST skip the `r.exec` call for that pass. Because `negativeAt` is set only by this process's gh path, a **seeded** (disk-cache) negative and a not-yet-resolved entry (`pr == nil`, `negativeAt` zero) never suppress the fallback.

- **GIVEN** a registered pair whose gh query returned a parsed empty result this pass
- **WHEN** subsequent 30s passes run within `branchPRNegativeTTL`
- **THEN** no `gh pr list` subprocess runs for that pair
- **AND** after the TTL expires, the next pass runs the gh fallback again
- **GIVEN** an entry seeded from disk with `pr == nil`
- **WHEN** the first pass reaches its gh-fallback step
- **THEN** the gh query runs (a seeded negative never starts the TTL clock)

#### R5: Earlier resolution stages override a fresh negative immediately
The default-branch exclusion and the viewer head-index join MUST keep running before the fallback on every pass, unchanged — an index hit (the viewer-wide 90s GraphQL collector seeing a new PR on the branch) overrides a fresh negative at once by writing the positive entry and zeroing `negativeAt`. Transient exec/parse errors MUST keep last-good and write no negative (existing semantics); the `branchPRObservedTTL`/`branchPRRetainTTL` entry lifecycle is untouched (an aged-out entry deletes its negative mark with it).

- **GIVEN** a pair holding a fresh negative
- **WHEN** the viewer head-index gains a PR for that (repo, branch) and the next pass runs
- **THEN** the entry resolves positive from the index join (no gh call, negative cleared)
- **GIVEN** a pair holding a fresh negative and an expired TTL
- **WHEN** the gh query fails transiently
- **THEN** the entry keeps `pr == nil` but gains no new `negativeAt` stamp (only a parsed result is authoritative)

### Non-Goals

- Changing `configs/tmux/default.conf`'s `automatic-rename-format` or demoting `%window-renamed` from trigger status — deferred as separate optional hardening.
- Parallelizing the per-server poll loop, touching `capturePreviews`, or modifying `internal/snapshot` (the Snapshotter already coalesces the same generation counter: 2s stability tick + 15s maxHold).
- A `Register` wake settle — **already shipped** as `branchPRWakeDebounce = 1s` (`prstatus_branch.go:122-129`); the intake's optional item 9 is pre-satisfied and needs no work.
- Config knobs, settings keys, or env vars for either constant.

### Design Decisions

#### Debounce lives in waitForNext, after the initial peek
**Decision**: Implement the coalescing inside `waitForNext` — after `selectFirst` unblocks and the existing non-blocking peek routes fired cases, if at least one **subscriber** case fired and **no wake** was consumed in the same peek, block on the wake cases plus a fresh `sseEventDebounce` timer; when the timer wins, run one final non-blocking peek over all cases (updating `perServerGen`/`eventDrivenServers`) and return; when a wake wins, consume it, mark it event-driven, and return immediately.
**Why**: `waitForNext` already owns the wait-case vocabulary (`waitCase.isWake`, `consumeWake`, `selectFirst`) and the `perServerGen` bookkeeping; putting the window there keeps `poll()`'s invalidation logic byte-identical and makes "wake bypasses debounce" a structural property (the wake channels stay armed during the window) rather than a flag check.
**Rejected**: a per-server pending-invalidation timestamp inside `poll()` — it would spread the coalescing across two functions, and a timestamp-only shape cannot end the window early on a wake without re-entering the select machinery anyway.
*Introduced by*: 260901-rtwx-sse-debounce-branchpr-negative-cache

#### negativeAt is a timestamp on branchEntry, consulted only at the gh step
**Decision**: The negative mark is a `negativeAt time.Time` field on the existing `branchEntry`, written/cleared only inside the pass's existing `r.mu` critical sections, and consulted only at the gh-fallback step (the exclusion and index join run first, unconditionally).
**Why**: `pr == nil` currently conflates "not yet resolved" with "confirmed no PR" (the comment at `branchEntry` says so explicitly); a timestamp disambiguates the confirmed case, gives the TTL its clock, and — being set only on the gh write path — makes the seeded-negative and not-yet-resolved exclusions fall out for free.
**Rejected**: treating a viewer-index miss as authoritative "no PR" — the index covers only viewer-authored PRs in a recency window, so it cannot distinguish "no PR" from "not covered".
*Introduced by*: 260901-rtwx-sse-debounce-branchpr-negative-cache

## Tasks

### Phase 2: Core Implementation

- [x] T001 Add `sseEventDebounce = 300 * time.Millisecond` to the `const` block in `app/backend/api/sse.go` (comment: bounds event-driven derive rate; a burst coalesces into one derive; wake and safety-timer paths unaffected) and implement the trailing-edge coalescing in `waitForNext` per the Design Decision: debounce entered only when a subscriber case fired and no wake was consumed in the initial peek; wake ends the window immediately; final peek folds window-landed bumps into `perServerGen`/`eventDrivenServers` <!-- R1, R2, R3 -->
- [x] T002 [P] Add `branchPRNegativeTTL = 10 * time.Minute` to the `const` block and `negativeAt time.Time` to `branchEntry` in `app/backend/internal/prstatus/prstatus_branch.go`; stamp it on the gh-path true-negative write, zero it on every positive write (gh path and viewer-index hit) and on the default-branch authoritative-negative write (a different negative kind, re-derived each pass); skip `r.exec` at the gh-fallback step when the entry holds a fresh non-zero `negativeAt` <!-- R4, R5 -->

### Phase 3: Integration & Edge Cases

- [x] T003 Extend `app/backend/api/sse_subscriber_test.go` (the file holding the bump/wake harness — `sse_test.go` in the intake was approximate): a burst of generation bumps within the window produces one `FetchSessions` call; a bump after the window derives again; a `wake()` during a pending window is not delayed (proven with a 2s override window via the new `eventDebounce` hub field, the `safetyInterval` override idiom); timer-only behavior unchanged is pinned by the existing `TestSSE_SafetyTickerFiresWithoutSubscriber` (timer wins never enter the debounce: `bumped == false`) <!-- R1, R2, R3 -->
- [x] T004 [P] Extend `app/backend/internal/prstatus/prstatus_branch_test.go`: a gh-confirmed negative suppresses the exec on the next pass within the TTL; the exec re-runs after TTL expiry (advance a clock seam or backdate `negativeAt`); a viewer-index hit overrides a fresh negative without a gh call; a transient exec error writes no `negativeAt`; a seeded `pr == nil` entry still reaches the gh fallback <!-- R4, R5 -->
- [x] T005 Run the verification gates: `cd app/backend && go test ./api/ ./internal/prstatus/`, then `go test ./...`, then `go vet ./...` — all green; two pre-existing tests updated to the new contract (`TestBranchRefresher_AvailabilityReprobedAfterTTL` now returns a positive PR so its availability-TTL subject still reaches the gh path; `TestBranchRefresher_SeedAfterRegistrationDrivesIndexServedPass` pre-seed gh count 6→3 since the coalesced wake pass is now negative-suppressed) <!-- R1, R4 -->

## Execution Order

- T001 blocks T003; T002 blocks T004; the two chains are independent ([P])
- T005 runs last

## Acceptance

### Functional Completeness

- [x] A-001 R1: `sseEventDebounce` exists as an unexported constant and `waitForNext` coalesces a same-window burst of subscriber bumps into one derive pass
- [x] A-002 R4: `branchPRNegativeTTL` and `branchEntry.negativeAt` exist; a fresh gh-confirmed negative skips `r.exec` for that pair within the TTL

### Behavioral Correctness

- [x] A-003 R2: a wake during a pending debounce window is served immediately (no 300ms penalty on the post-mutation repaint path); a wake-only pass never enters the debounce
- [x] A-004 R3: `safetyPollInterval`/`legacyPollInterval`/`sseCacheTTL` values and semantics are untouched; a timer-win pass has no added delay
- [x] A-005 R5: the default-branch exclusion and viewer-index join run before the fallback unchanged; an index hit overrides a fresh negative and zeroes it; transient errors and seeded entries never stamp `negativeAt`

### Scenario Coverage

- [x] A-006 R1: sse_test.go covers burst-coalescing, post-window re-derive, wake bypass, and quiet-timer scenarios (all four from the intake's test list)
- [x] A-007 R4: prstatus_branch_test.go covers TTL suppression, TTL expiry re-exec, index override, transient-error no-negative, and seeded-negative-still-queries (all five from the intake's test list)

### Edge Cases & Error Handling

- [x] A-008 R1: no lost bumps — a generation bump landing between the final peek and the return is picked up by the next `waitForNext` (Wait is anchored at the updated `perServerGen`), verified by test or by inspection against the `consumeWake`/`Wait(after)` at-least-once contracts

### Code Quality

- [x] A-009 Pattern consistency: both constants sit in the existing `const` blocks with constraint-stating comments matching their neighbors; `negativeAt` writes stay inside the existing `r.mu` critical sections
- [x] A-010 No unnecessary duplication: the debounce reuses `waitCase`/`selectFirst`/`consumeWake`; no new goroutines, channels maps, or state stores beyond the timestamp field
- [x] A-011 No polling/anti-patterns: no new env vars or settings keys; no client-side changes; `go test ./...` and `go vet ./...` pass in `app/backend`

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change corrects existing behavior without making any existing code redundant or unused.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Debounce implemented inside `waitForNext` (post-peek window over wake cases + fresh timer), not as `poll()`-side timestamps | Intake grants apply the mechanism ("decide-and-record"); this shape keeps wake bypass structural and `poll()` untouched | S:80 R:80 A:85 D:75 |
| 2 | Confident | Debounce entered only when a subscriber case fired AND no wake was consumed in the same initial peek (a racing wake wins immediately) | Intake: "If a wake and a bump race, the wake's immediacy wins"; deriving early on a bump is always safe | S:80 R:85 A:85 D:80 |
| 3 | Certain | The intake's optional `Register` wake settle is dropped from scope — `branchPRWakeDebounce = 1s` already ships exactly that coalescing | Verified at `prstatus_branch.go:122-129`; intake marked the item "in-scope only if cheap / skipping does not block" | S:90 R:95 A:95 D:95 |
| 4 | Confident | The default-branch authoritative-negative write also zeroes `negativeAt` (it is a different negative kind, re-derived from the local cache each pass and never reaching the gh step) | Keeps the field's meaning single-purpose ("gh-confirmed at T"); the exclusion path is unaffected either way since it precedes the fallback | S:70 R:85 A:85 D:75 |
| 5 | Confident | TTL-expiry testability via backdating `negativeAt` on the entry (or the package's existing clock seam if one exists), not a new injectable clock abstraction | Test-only concern, smallest surface; the package already tests TTL behaviors | S:65 R:85 A:80 D:70 |

5 assumptions (1 certain, 4 confident, 0 tentative).
