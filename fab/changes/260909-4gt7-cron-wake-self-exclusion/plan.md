# Plan: Cron Wake Self-Exclusion, Transition Filter, Honest Debounce

**Change**: 260909-4gt7-cron-wake-self-exclusion
**Intake**: `intake.md`

## Requirements

### Cron: Per-entry wake fingerprint

#### R1: The entry's own target pane is excluded from its wake fingerprint
`Evaluate` MUST render a per-entry fingerprint from the raw agent-state map with the entry's resolved target pane removed. `ServerFacts` and `EvalInput` SHALL carry `States map[string]string` (pane id → state) in place of the pre-rendered `Fingerprint string`. When the target did not resolve, the full fingerprint SHALL be used. `Fingerprint(states)` remains the canonical sorted `pane=state\n` renderer; excluding a pane MUST NOT mutate the shared map.

- **GIVEN** states `{%683: idle, %685: active}`, entry target resolved to `%683`, cursor observation `%685=active\n`
- **WHEN** `%683` flips to `active` and nothing else changes
- **THEN** the per-entry fingerprint is still `%685=active\n`, no edge, cursor unchanged

- **GIVEN** the same states but the entry's target is unresolved
- **WHEN** `%683` flips
- **THEN** the full fingerprint is compared and the flip is a candidate edge (classified per R2)

### Cron: Wake transition classification

#### R2: Only actionable transitions fire; `→ active` advances silently
`wakeEdge` MUST parse the previous and current fingerprints back into maps (`parseFingerprint`, the lossless inverse of `Fingerprint`) and fire only when at least one pane's transition is actionable: new state `waiting`, new state `idle`, or the pane absent from the current fingerprint (vanished). A transition to `active` — including a pane first appearing as `active` — MUST NOT fire; the cursor SHALL advance to the current fingerprint with a `wake-ignored-transition` diagnostic. Any state value other than `active`/`idle`/`waiting` SHALL be treated as actionable (fail open toward firing).

- **GIVEN** observation `%685=active\n`, current `%685=idle\n`, no hold
- **WHEN** evaluated
- **THEN** edge fires; cursor advances

- **GIVEN** observation `%685=idle\n`, current `%685=active\n`
- **WHEN** evaluated
- **THEN** no edge; cursor advances to `%685=active\n`; diagnostic `wake-ignored-transition`

- **GIVEN** observation `%685=active\n`, current `%685=active\n%690=active\n`
- **WHEN** evaluated
- **THEN** no edge (new pane appeared active); cursor advances

- **GIVEN** observation `%685=active\n%690=idle\n`, current `%685=active\n`
- **WHEN** evaluated
- **THEN** edge fires (`%690` vanished)

- **GIVEN** observation `%685=active\n`, current `%685=waiting\n`
- **WHEN** evaluated
- **THEN** edge fires

### Cron: Honest debounce

#### R3: Debounce holds for `debounce` after the entry's own newest log line
`wakeEdge` MUST hold an actionable edge (no fire, previous observation kept so the edge stays pending) when `now − lastOwnDelivery < debounce`, where `lastOwnDelivery` is the timestamp of the entry's newest own delivery-log line (`LastDelivery(log, entryID)`, any reason or outcome). With no own log line there SHALL be no hold. Classification (R2) MUST run before the hold check: a diff with only ignored transitions advances the cursor regardless of the hold window. The `wake-debounced` diagnostic is kept. The unreachable `now − obs.ObservedAt < debounce` rule is removed.

- **GIVEN** debounce 60 s, own delivery at T, observation `%685=active\n`, current `%685=idle\n`
- **WHEN** evaluated at T+20s
- **THEN** no fire; diagnostic `wake-debounced`; next observation equals the old observation

- **GIVEN** the same at T+70s
- **THEN** fire; cursor advances

- **GIVEN** debounce 60 s, own delivery at T, observation `%685=idle\n`, current `%685=active\n`
- **WHEN** evaluated at T+20s
- **THEN** no fire; cursor advances (ignored transition is not held)

- **GIVEN** debounce 60 s and no own log line
- **WHEN** an actionable edge is evaluated
- **THEN** fire

### Cron: Operator entry seed and backfill

#### R4: Operator tick entry seeds `debounce: 60s`
`operatorTickEntrySpec()` in `cmd/rk/operator.go` MUST set `WakeOn.Debounce` to 60 s; its doc comment and the `operator_test.go` assertion SHALL match.

- **GIVEN** a fresh server with no operator entry
- **WHEN** `rk operator` seeds it
- **THEN** the entry file carries `debounce: 60s`

#### R5: `EnsureRoleEntry` raises a below-spec debounce, never lowers one
On a role-target hit, `EnsureRoleEntry` MUST set the entry's `WakeOn.Debounce` to the spec's when both carry a `WakeOn` with the same `Event` and the existing debounce is strictly less than the spec's. It MUST NOT lower a debounce at or above the spec's. Both narrow upgrades (respawn argv, debounce) MAY apply in one call with a single file write; the returned entry reflects the upgrade.

- **GIVEN** an existing entry with `debounce: 10s` and the spec at 60 s
- **WHEN** `EnsureRoleEntry` runs
- **THEN** the file is rewritten with `debounce: 60s`, `created == false`, the returned entry reads 60 s, and every other field is untouched

- **GIVEN** an existing entry with `debounce: 5m`
- **WHEN** `EnsureRoleEntry` runs
- **THEN** the file is byte-identical afterward

### Cron: Spec and evidence

#### R6: The cron spec states the wake rules and the plan is in-repo
`docs/specs/cron.md` MUST describe, next to the anchor-join paragraph, the target-pane self-exclusion, the transition filter, and the hold-after-own-delivery debounce; the example entry reads `debounce: 60s`. The diagnosis plan `fab/plans/sahil/26-09-10-cron-wake-self-trigger.md` SHALL be committed on this branch.

- **GIVEN** the spec's `wake_on` bullet
- **WHEN** read after this change
- **THEN** it names all three rules and matches the implementation

### Non-Goals

- `backoff.go` / `JoinAnchor` rung seeding — Change 2 of the same plan, separate change.
- `DefaultTickInterval`, `deliver` mode, cursor file format, UI.
- Cursor migration — one spurious wake per entry after deploy is accepted.

### Design Decisions

#### Wake fingerprint excludes the entry's own target
**Decision**: `Evaluate` renders a per-entry fingerprint with the resolved target pane removed.
**Why**: the entry's own delivery makes the target busy; that flip is caused by the clock and must not read as a wake edge — the same principle as the backoff anchor-join rule.
**Rejected**: keeping one server-wide fingerprint and suppressing fires by target state — cannot distinguish "target busy because of us" from "target busy because a worker finished".
*Introduced by*: 260909-4gt7-cron-wake-self-exclusion

#### Debounce is hold-after-own-delivery
**Decision**: the hold window is measured from the entry's newest own log line, not from the previous observation's age.
**Why**: under a 30 s poll the previous observation is always older than any sub-poll debounce, so the old rule was unreachable; the meaningful question is "did we just act on this entry".
**Rejected**: deleting the `debounce` field — it exists in every entry file and hold-after-delivery is useful once the loop is gone.
*Introduced by*: 260909-4gt7-cron-wake-self-exclusion

#### `→ active` is not a wake edge
**Decision**: fire on `→ waiting`, `→ idle`, and pane-vanished; a transition to `active` advances the cursor without firing.
**Why**: an agent starting work never needs operator action; completions (`→ idle`) and questions (`→ waiting`) do.
**Rejected**: fire only on `→ waiting` — autopilot depends on completions, and the backoff anchor is the operator's own idle epoch, so worker completions would otherwise wait up to the 30 m rung.
*Introduced by*: 260909-4gt7-cron-wake-self-exclusion

## Tasks

### Phase 1: Core Implementation

- [x] T001 Replace `Fingerprint string` with `States map[string]string` on `ServerFacts` (`app/backend/internal/cron/facts.go`) and `EvalInput` (`evaluate.go`); update `tick.go` to pass `States: facts.States`; in `Evaluate` render the per-entry fingerprint via a new `fingerprintExcluding(states, paneID)` helper in `wake.go` that copies-minus-key (full fingerprint when the target is unresolved) <!-- R1 -->
- [x] T002 Rewrite `wakeEdge` in `app/backend/internal/cron/wake.go`: add `parseFingerprint`, classification of the union diff (`waiting`/`idle`/vanished actionable; `active` ignored; unknown actionable), `wake-ignored-transition` diagnostic, hold measured from `LastDelivery(in.Log, e.ID)` (classification before hold); update the file-header and function doc comments; wire the new signature in `evaluate.go` <!-- R2 R3 -->
- [x] T003 [P] Set `Debounce: 60s` in `operatorTickEntrySpec()` (`app/backend/cmd/rk/operator.go`, comment too); add the below-spec debounce backfill to `EnsureRoleEntry` (`app/backend/internal/cron/store.go`) with a single save when either upgrade applies; update its doc comment <!-- R4 R5 -->

### Phase 2: Tests & Spec

- [x] T004 Tests: rewrite `TestWakeEdge` and add `TestParseFingerprintRoundTrip`, a classification table test, debounce cases, and the 01:05–01:07 replay table in `wake_test.go`; rewrite `TestEvaluateWakeUnionAndDebounce` and fix every `EvalInput{Fingerprint:}` to `States` with real `Fingerprint(map)` values in `evaluate_test.go` (add target-flip-no-fire and unresolved-target-full-fingerprint cases); adapt `TestGatherFactsFingerprint` in `facts_test.go`; add `TestEnsureRoleEntryDebounceBackfill` and `TestEnsureRoleEntryNoDebounceDowngrade` in `store_test.go`; update the 10 s assertion in `cmd/rk/operator_test.go`; run `just test-backend` <!-- R1 R2 R3 R4 R5 -->
- [x] T005 [P] Update `docs/specs/cron.md` (`wake_on` bullet ~line 157: self-exclusion, transition filter, hold-after-delivery; example ~line 112: `debounce: 60s`); confirm `fab/plans/sahil/26-09-10-cron-wake-self-trigger.md` is staged on this branch <!-- R6 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: `ServerFacts.States` and `EvalInput.States` exist; no `Fingerprint string` field remains on either; `tick.go` passes `States`
- [x] A-002 R1: `Evaluate` compares a per-entry fingerprint with the resolved target pane removed; unresolved target uses the full fingerprint
- [x] A-003 R2: `wakeEdge` fires on `→ waiting`, `→ idle`, vanished; does not fire on `→ active` (existing or new pane), advancing the cursor with `wake-ignored-transition`
- [x] A-004 R3: the hold is `now − LastDelivery < debounce`; no own line ⇒ no hold; a held edge keeps the old observation; the old observation-age rule is gone
- [x] A-005 R4: `operatorTickEntrySpec().WakeOn.Debounce` is 60 s
- [x] A-006 R5: `EnsureRoleEntry` raises a below-spec debounce and leaves an at-or-above-spec one untouched; the file is written once
- [x] A-007 R6: `docs/specs/cron.md` describes all three wake rules and the example reads `debounce: 60s`; the plan file is in the tree (untracked — the ship stage commits it, like the apply edits)

### Behavioral Correctness

- [x] A-008 R1: a test shows the target pane flipping `idle↔active` with all else steady produces no fire (`TestEvaluateWakeExcludesOwnTarget`)
- [x] A-009 R3: a test shows an actionable edge 20 s after an own delivery with debounce 60 s is held (`wake-debounced`) and the same edge at 70 s fires (`TestWakeEdge`)

### Scenario Coverage

- [x] A-010 R2: the replay table from the plan's evidence (polls where only `%683` changed do not fire; `%690` appears idle fires; `%685 → idle` fires; a `→ active` poll does not) passes (`TestWakeEdgeReplay`)
- [x] A-011 R2: `parseFingerprint(Fingerprint(m))` round-trips for a non-empty map (`TestParseFingerprintRoundTrip`)

### Edge Cases & Error Handling

- [x] A-012 R2: an unknown state value is treated as actionable (`TestClassifyDiff` "unknown state fails open")
- [x] A-013 R3: an ignored-only diff inside the hold window still advances the cursor (`TestWakeEdge` ignored case at T+5s with delivery at T; `TestEvaluateWakeIgnoresActiveTransition`)
- [x] A-014 R1: `TestEvaluateDeterministic` passes — `Evaluate` mutates neither `in.States` nor `in.Cursor`

### Code Quality

- [x] A-015 Pattern consistency: new helpers follow the package's small-pure-function style and doc-comment conventions; diagnostics use the existing `diag(reason, detail)` shape (`evaluate.go:175`)
- [x] A-016 No unnecessary duplication: `LastDelivery` and `Fingerprint` are reused, not reimplemented
- [x] A-017 No magic numbers: the 60 s seed lives in `operatorTickEntrySpec` only; no new package-level constants without a name
- [x] A-018 Comments state constraints, not narration: no comment cites the change id or narrates the old rule
- [x] A-019 Tests cover the changed behavior (`just test-backend` green with a fresh test cache)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

None — this change rewrites the wake rule in place (the observation-age hold in `wakeEdge` was replaced, not orphaned) and makes no existing file, function, branch, or config redundant.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | `wakeEdge` signature becomes `wakeEdge(debounce, curFP string, obs WakeObservation, hasObs bool, lastDelivery time.Time, hasDelivery bool, now time.Time)` | Keeps the existing obs/hasObs pair and adds the delivery pair; intake left packaging to apply | S:70 R:90 A:90 D:80 |
| 2 | Confident | Existing tests using opaque fingerprints (`"F1"`, `"F2"`) are rewritten with real `Fingerprint(map)` renderings | Classification parses `pane=state`; opaque strings would parse empty and never diff | S:80 R:90 A:95 D:90 |
| 3 | Certain | Memory (`docs/memory/run-kit/cron.md`) is edited at hydrate, not apply | Pipeline contract | S:95 R:95 A:95 D:95 |

3 assumptions (1 certain, 2 confident, 0 tentative).
