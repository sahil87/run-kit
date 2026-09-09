# Plan: Backoff Ladder Rung Seeding

**Change**: 260909-ts8e-backoff-ladder-rung-seeding
**Intake**: `intake.md`

## Requirements

### Cron: Backoff streak-walk seeding

#### R1: Seed the streak walk from the largest fitting rung
`JoinAnchor` (`app/backend/internal/cron/backoff.go`) SHALL seed its backward streak walk from the newest gap between two own deliveries as the **largest** rung `r ≥ 1` whose `gapAfter(r) ≤ gap + seedSkew`, where `seedSkew` is a named package constant equal to `DefaultTickInterval` (30s). The seed MUST NOT subtract any tolerance from the observed gap. The walk-back's membership check (`gap < gapAfter(expectRung) − attributionWindow ⇒ break`) and `attributionWindow` (120s) SHALL remain unchanged.

- **GIVEN** `min: 60s, max: 30m` and own deliveries at T+1m, T+3m, T+7m with a raw epoch at T+7m+5s
- **WHEN** `JoinAnchor` runs
- **THEN** the ladder is `Anchor = T, Rung = 3` and `NextFire = T+15m` (today: `Rung = 2`, `T+9m`)

- **GIVEN** the pathological log `0, 2m, 6m, 8m, 12m, 14m` (the observed 2m/4m alternation)
- **WHEN** the ladder is replayed forward — derive, append `NextFire` as the next delivery, repeat
- **THEN** the successive gaps are `4m, 8m, 16m, 30m, 30m` — the alternation is not a fixed point

#### R2: A sub-ladder gap starts a fresh ladder
When the newest gap plus `seedSkew` is smaller than `gapAfter(1)` (no rung-to-rung spacing fits), the seed SHALL be 0 and the streak SHALL be the newest delivery alone: `Anchor = newest − min, Rung = 1`, next fire `newest + 2·min`.

- **GIVEN** `min: 60s, max: 30m` and own deliveries 30s apart (T, T+30s) with an attributed epoch
- **WHEN** `JoinAnchor` runs
- **THEN** `Rung = 1`, `Anchor = T+30s − 1m`, `NextFire = T+2m30s`

#### R3: Cap-saturated gaps take the smallest saturated rung
When `gap + seedSkew ≥ max`, the seed helper SHALL return the smallest rung whose `gapAfter` reaches `max` and SHALL terminate (no unbounded loop, no magic iteration cap).

- **GIVEN** `min: 1m, max: 30m`
- **WHEN** the helper is asked for thresholds `30m` and `3h`
- **THEN** both return rung 5 (`gapAfter(5) = 30m` is the first saturated rung)

#### R4: Existing ladder shapes are preserved
Every existing `backoff_test.go`, `derive_test.go`, and `evaluate_test.go` backoff case SHALL pass unmodified: 2-delivery worked scenario (`+7m`), 4-delivery streak (`+31m`), restart tolerance (`+15m`), streak break (single-delivery fallback `+23m`, inside `(T+21m, T+36m]`), attribution-window boundary, no-deliveries.

- **GIVEN** the package test suite as shipped before this change
- **WHEN** `go test ./internal/cron/` runs after the change
- **THEN** every pre-existing test passes with no edits

#### R5: Retire the superseded seed helper
`smallestRungWithGapAtLeast` SHALL be removed; it has one call site (the seed) and no other users.

- **GIVEN** the change is applied
- **WHEN** grepping `app/backend` for `smallestRungWithGapAtLeast`
- **THEN** there are zero occurrences

#### R6: Memory states the seed rule
`docs/memory/run-kit/cron.md` SHALL describe the seed rule (largest fitting rung, `seedSkew`, the sub-ladder fresh-ladder case, saturated-gap handling) in § "`backoff` and the anchor-join rule", carry a `## Design Decisions` entry recording the rejected v1 seed, and extend the "Backoff anchor-join" requirement with: a clean own-delivery streak of any length SHALL reconstruct to its ladder rung. No transition narration; `docs/specs/cron.md` is not edited.

- **GIVEN** the hydrated memory file
- **WHEN** a reader looks up how the rung is reconstructed
- **THEN** the seed rule, its constant, and the reason the v1 seed was rejected are stated as present truth

### Non-Goals
- Wake-path changes (self-exclusion, transition filter, debounce) — plan § Change 1, a separate change
- `DefaultTickInterval`, `attributionWindow`, schema, log format, API wire shape — unchanged
- Live verification of the overnight ladder decay — post-ship, outside the pipeline

### Design Decisions

#### Seed the streak walk from the largest fitting rung
**Decision**: the seed is `largestRungWithGapAtMost(min, max, gap + seedSkew)` with `seedSkew = DefaultTickInterval`.
**Why**: lateness only inflates an observed gap (late poll, daemon restart); a genuine rung-r gap is observed as `gapAfter(r) + [0, jitter]`, never smaller. Adding one poll of jitter and taking the largest rung that fits is the only direction that never under-seeds.
**Rejected**: `smallestRungWithGapAtLeast(min, max, gap − attributionWindow)` (the v1 seed) — with `attributionWindow` equal to the rung-1→2 gap it under-seeds every three-delivery streak and pins the operator ladder at rungs 2↔3 (the 120s/240s alternation observed for five hours on 2026-09-09/10). Persisting the rung in a sidecar — Constitution II; the ladder must stay a pure function of on-disk inputs.
*Introduced by*: 260909-ts8e-backoff-ladder-rung-seeding

## Tasks

### Phase 1: Core Implementation

- [x] T001 `app/backend/internal/cron/backoff.go`: add `seedSkew = DefaultTickInterval` with its reasoning comment; add `largestRungWithGapAtMost(min, max, threshold)` returning the largest rung `r ≥ 1` with `gapAfter(r) ≤ threshold` (0 when none fits; stop at the first saturated rung); replace the seed branch in `JoinAnchor` (seed 0 ⇒ break with streak 1); delete `smallestRungWithGapAtLeast`; update the file header comment to name the seed rule. <!-- R1 R2 R3 R5 -->
- [x] T002 `app/backend/internal/cron/backoff_test.go`: add `TestAnchorJoinThreeDeliveryStreak` (+1m/+3m/+7m ⇒ anchor T, rung 3, next +15m, failure message names today's +9m), `TestAnchorJoinEscapesAlternation` (forward replay from `0,2m,6m,8m,12m,14m` ⇒ gaps `4m,8m,16m,30m,30m`), `TestAnchorJoinSubLadderGap` (30s-apart deliveries ⇒ rung 1, next newest+2m), and `TestLargestRungWithGapAtMost` (below `gapAfter(1)` ⇒ 0; exact rung; between rungs ⇒ lower; at/above `max` ⇒ 5; `max < min` terminates). Run `go test ./internal/cron/` and confirm all pre-existing tests pass unmodified. <!-- R1 R2 R3 R4 -->

### Phase 2: Documentation

- [x] T003 `docs/memory/run-kit/cron.md`: rewrite the second bullet of § "`backoff` and the anchor-join rule" to state the seed rule as present truth; add the "Seed the streak walk from the largest fitting rung" Design Decisions entry (four-field shape); append the streak-of-any-length sentence to § Requirements "Backoff anchor-join" and add a three-delivery scenario. Hydrate finalizes and regenerates indexes. <!-- R6 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: `JoinAnchor` seeds via `largestRungWithGapAtMost(min, max, gap+seedSkew)`; `seedSkew` is a named constant equal to `DefaultTickInterval` — backoff.go:79,126
- [x] A-002 R2: a seed of 0 breaks the walk with streak 1 (newest delivery as rung 1 of a fresh ladder) — backoff.go:127-129
- [x] A-003 R3: the helper returns the smallest saturated rung for thresholds ≥ `max` and always terminates — backoff.go:90-102 (`g >= max` return; `gapAfter` clamps `max < min`, so the loop exits at rung 1 there too)
- [x] A-004 R5: `smallestRungWithGapAtLeast` no longer exists anywhere under `app/backend` — grep-verified zero occurrences
- [x] A-005 R6: `docs/memory/run-kit/cron.md` states the seed rule, the constant, the fresh-ladder case, the saturated-rung rule, and carries the Design Decisions entry with the rejected v1 seed

### Behavioral Correctness

- [x] A-006 R1: deliveries +1m/+3m/+7m reconstruct to anchor T, rung 3, next fire +15m (pinned by `TestAnchorJoinThreeDeliveryStreak`) — green; hand-traced to match
- [x] A-007 R1: the forward replay from `0,2m,6m,8m,12m,14m` yields gaps `4m,8m,16m,30m,30m` (pinned by `TestAnchorJoinEscapesAlternation`); the pre-change seed fails this test (hand-traced: v1 seed answers 4m then 2m at step 2)

### Scenario Coverage

- [x] A-008 R2: `TestAnchorJoinSubLadderGap` pins the 30s-apart case (rung 1, next newest+2m)
- [x] A-009 R3: `TestLargestRungWithGapAtMost` covers below-rung-1, exact, between, saturated, and `max < min` (both directions)

### Edge Cases & Error Handling

- [x] A-010 R4: all pre-existing `backoff_test.go`, `derive_test.go`, `evaluate_test.go` tests pass with zero edits (`go test ./internal/cron/` green; `just test-backend` fully green; existing tests untouched in the diff)
- [x] A-011 R1: the walk-back membership tolerance and `attributionWindow` are byte-identical to before (only the seed branch changed) — diff-verified at backoff.go:132 and :25

### Code Quality

- [x] A-012 Pattern consistency: the new helper and constant follow `backoff.go`'s existing doc-comment style (constraints and rationale, no narration of the next line)
- [x] A-013 No unnecessary duplication: no second ladder-math helper; `gapAfter` remains the single gap source
- [x] A-014 No magic numbers: the 30s jitter is expressed via `DefaultTickInterval`, not a literal; the old hardcoded `60` loop bound is gone
- [x] A-015 Tests cover the changed behavior (code-quality.md: fixes MUST include tests) — four new tests
- [x] A-016 Comments state constraints the code cannot show; no change IDs or PR numbers in code comments

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — the one symbol this change made redundant (`smallestRungWithGapAtLeast`, and with it the magic `60` iteration bound) was already deleted in the same diff (planned removal, R5); no other file, function, branch, or config lost its callers.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | The helper stops at the first rung whose gap reaches `max` (returns it) rather than iterating to a fixed bound | Bounds the loop structurally; matches the intake's saturated-gap rule and drops the old magic `60` | S:85 R:95 A:95 D:90 |
| 2 | Confident | Add a dedicated `TestAnchorJoinSubLadderGap` beyond the three tests the intake names | The intake documents the sub-ladder behavior change explicitly; pinning it costs one small test and makes the behavior change reviewable | S:70 R:95 A:90 D:85 |
| 3 | Certain | Memory edits at apply are a draft the hydrate step finalizes (present-truth style, index regen) | Hydrate Behavior owns index regeneration and the post-hydrate self-check | S:90 R:95 A:95 D:95 |

3 assumptions (2 certain, 1 confident, 0 tentative).
