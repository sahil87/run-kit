# Plan: Cron Schedule Completions

**Change**: 260908-qyin-cron-schedule-completions
**Intake**: `intake.md`

## Requirements

### Cron: Expression schema & validation

#### R1: catch_up field and add-time expression validation
The `Schedule` schema SHALL gain `catch_up` (`yaml:"catch_up,omitempty"`, closed set `{"", "once"}`, constant `CatchUpOnce`), valid only with kind `cron`. `validate()` SHALL parse `Expr` via `robfig/cron/v3`'s `cron.ParseStandard` for kind `cron` — a non-parsing expression fails per-entry validation (tolerant load: `entry-invalid` diagnostic, entry skipped; strict mutation read: error). A `catch_up` value on a non-cron kind, or any value other than `once`, SHALL fail validation.

- **GIVEN** an entry `{kind: cron, expr: "0 9 * * *", catch_up: once}`
- **WHEN** loaded
- **THEN** it validates
- **AND GIVEN** `expr: "not an expr"` or `{kind: every, interval: 1h, catch_up: once}`, **THEN** validation fails with a named reason and the tolerant load skips only that entry

#### R2: Cron-kind due math (pure, window-bounded)
`Evaluate` SHALL compute cron-kind due-ness as a pure function of (entry, delivery log, now), replacing the `schedule-kind-unsupported` diagnostic. Anchor = the entry's newest own log line, else `created_by.at` (the `everyAnchor` rule). The entry is schedule-due iff an occurrence `O` (via `Schedule.Next` walks from the anchor, in the daemon's local time) exists in `(anchor, now]` AND `now − O ≤ window`, where `window` = `DefaultCronGrace` (named constant, 2m) for `deliver: immediate`/empty entries and `DefaultHoldWindow` (named constant, 2h) for `deliver: when-idle` entries. With `catch_up: once` the latest occurrence in `(anchor, now]` is due with no lateness bound. Every `Fire` SHALL carry `DueAt` — the scheduled time it came due (`every`: anchor+interval; `backoff`: ladder next-fire; `cron`: `O`; wake fires and catch-up late fires: `now`). Occurrence walks MUST be bounded (never an unbounded scan from an ancient anchor).

- **GIVEN** `{kind: cron, expr: "*/5 * * * *"}`, last own log line at 10:00:30, now 10:05:20
- **WHEN** evaluated
- **THEN** a schedule fire is emitted with `DueAt` 10:05:00 (within the 2m grace)
- **AND GIVEN** now 10:09:00 with no invoker having run since 10:04 (no log line after 10:00:30), **THEN** no fire is emitted (10:05:00 is beyond grace) — the missed path (R3) applies
- **AND GIVEN** the same entry with `catch_up: once`, **THEN** one fire is emitted with `DueAt = now`, and after its log line the next due is the next future occurrence

#### R3: Missed occurrences log one line per gap
A cron-kind occurrence that exists in `(anchor, now]` but is beyond its window (and not caught up) SHALL cause the tick orchestrator to append exactly one `missed` outcome line for the entry (advancing the anchor past the gap — one line per gap, not per tick), after the same muted → due math → guard gating as fires (a holding guard suppresses the missed line silently), regardless of target resolution (schedule history, not delivery — no `if_absent` disposition, no delivery attempt). `Evaluate` SHALL surface these to the orchestrator via a dedicated result field (e.g. `EvalResult.Missed`).

- **GIVEN** a daemon down over three daily-9am occurrences, entry without `catch_up`
- **WHEN** the next tick runs
- **THEN** exactly one `missed` line is appended (for the latest stale occurrence) and subsequent ticks append nothing until the next occurrence
- **AND GIVEN** `suppress_while: [nothing-tracked]` holding, **THEN** no `missed` line is appended and a `suppressed` diagnostic records the skip

### Cron: Delivery hold bound

#### R4: when-idle holds expire after DefaultHoldWindow
`EngineDeliverer.Deliver` on a `when-idle` fire whose target reads busy (`active | waiting`) SHALL return `held-busy`/`Held: true` while `now − fire.DueAt ≤ DefaultHoldWindow` (2h), and past the window SHALL return outcome `held-expired` with `Held: false` — a logged disposition that advances the anchor and drops the fire (the next due period fires normally). The bound MUST never force-deliver into a busy pane. Catch-up late fires (`DueAt = now`, R2) are exempt by construction. This resolves spec open question 2 as drop-with-visible-history.

- **GIVEN** an `every 1h` `when-idle` entry due at T, target pane busy continuously
- **WHEN** a tick runs at T+2h1m
- **THEN** the outcome is `held-expired`, one log line is appended, and the next fire derives from that line
- **AND** at T+30m the outcome is `held-busy` with no log line (unchanged cross-tick retry)

#### R5: New outcomes stay outside the rate cap
`missed` and `held-expired` SHALL NOT count toward the per-target rate cap — `countsTowardRate` remains unchanged (neither outcome lands anything in a pane) and a test SHALL pin both strings as non-counting. Both SHALL advance anchors like any logged disposition.

- **GIVEN** a log with 29 `missed`/`held-expired` lines and 1 `delivered` line for one target in the trailing hour
- **WHEN** the rate cap is checked
- **THEN** the count is 1 and the next fire is not `rate-capped`

### Cron: Read-side derivation

#### R6: DeriveEntry reports cron next-fire
`DeriveEntry` SHALL compute `NextFire = Next(now)` / `HasNextFire = true` for a valid cron-kind entry (`Rung` stays 0), so `GET /api/cron` reports real next-fires with no handler changes. An entry whose expression fails to parse SHALL keep `HasNextFire = false` (never a fabricated time).

- **GIVEN** `{kind: cron, expr: "0 9 * * *"}` and now = 2026-09-09 10:00 local
- **WHEN** derived
- **THEN** `NextFire` is 2026-09-10 09:00 local and `HasNextFire` is true

### CLI & API

#### R7: `rk cron add` — --catch-up flag, live expressions
`rk cron add` SHALL gain `--catch-up once` (usage error without `--cron` or with any other value), SHALL stop printing the "not evaluated yet" stderr note and its help-text caveats (the `--cron` flag description, `Long`, and the file-header comment), and SHALL reject a non-parsing expression at add time (via `cron.Add` → `validate()`, replacing the current 5-field count check as the only gate — the count check MAY remain as a friendlier usage error). `rk cron list`'s schedule summary keeps rendering the expression, now with `catch_up: once` reflected (e.g. `cron 0 9 * * * (catch-up once)`).

- **GIVEN** `rk cron add "standup" --cron "0 9 * * *" --catch-up once --role operator`
- **WHEN** run
- **THEN** the entry persists with `catch_up: once`, no stderr note prints, and stdout shows the id + summary
- **AND GIVEN** `--catch-up once --every 1h`, **THEN** a usage error names the `--cron` requirement
- **AND GIVEN** `--cron "61 * * * *"`, **THEN** the add fails with the parser's error and the file is untouched

#### R8: API create accepts catchUp; GET exposes it
`POST /api/cron/create` SHALL accept `catchUp` in the schedule body (camelCase), mapped to `Schedule.CatchUp` and validated by `cron.Add` (bad value ⇒ 400 with the underlying text). `GET /api/cron`'s `cronScheduleJSON` SHALL carry `catchUp` (omitempty) so the entry detail sheet can render it.

- **GIVEN** a create body `{"schedule": {"kind": "cron", "expr": "0 9 * * *", "catchUp": "once"}, ...}`
- **WHEN** posted
- **THEN** 201 with the created entry echoing `catchUp: "once"`, and a subsequent GET includes it
- **AND GIVEN** `"catchUp": "always"`, **THEN** 400

### Frontend

#### R9: describeSchedule drops the not-yet-evaluated note
`describeSchedule` (`app/frontend/src/lib/cron-schedule.ts`) cron-kind case SHALL render the raw expression without the "not yet evaluated" note (empty expr renders "cron expression"); its unit test updates accordingly. No other frontend change.

- **GIVEN** `{kind: "cron", expr: "0 9 * * *"}`
- **WHEN** described
- **THEN** the sentence is the expression (plus any wake suffix), with no "not yet evaluated" text

### Docs

#### R10: Spec records the OQ2 resolution
`docs/specs/cron.md` SHALL record open question 2's resolution in place (the OQ3/C4 precedent): drop after a 2h hold window with a logged `held-expired` outcome, rationale included; § Delivery step 2's "bounded hold window" gains the concrete bound; § Schedules' catch-up paragraph notes the landed semantics (grace window, when-idle extension, `missed` lines).

- **GIVEN** the updated spec
- **WHEN** § Open Questions is read
- **THEN** item 2 states the decision, the deciding change (this one), and the drop-vs-deliver-late rationale

### Non-Goals

- Per-entry timezone field (daemon-local time only — speculative surface with no consumer)
- Session-target respawn, orphan TTL expiry, `--session` capture (C8's scope)
- Seconds-field or non-standard cron syntax (`ParseStandard`'s 5-field set only)
- Any UI beyond the one stale-note removal (upcoming rows/detail sheet consume existing shapes)

### Design Decisions

#### Hold bound resolves OQ2 as drop-with-visible-history
**Decision**: a `when-idle` fire held busy past `DefaultHoldWindow` (2h) logs `held-expired` and is dropped; never force-delivered.
**Why**: user decision at intake — recurring schedules lose nothing (next due period fires normally) and stale payloads never land mid-task hours later; the bound derives from `Fire.DueAt`, keeping evaluation stateless.
**Rejected**: unbounded hold (delivers stale payloads at the worst moment); force-deliver at the bound (interrupting a busy/waiting agent contradicts when-idle's purpose).
*Introduced by*: 260908-qyin-cron-schedule-completions

#### Expression math via robfig/cron/v3, parse+next only
**Decision**: depend on `github.com/robfig/cron/v3` for `ParseStandard` + `Schedule.Next`; its runtime scheduler is never used.
**Why**: user decision at intake — DOM/DOW union semantics, ranges, steps, and names are battle-tested there; the stateless evaluator remains the only clock.
**Rejected**: in-house 5-field parser (~300 lines of subtle edge cases for zero dependency savings that matter — the lib has no transitive deps).
*Introduced by*: 260908-qyin-cron-schedule-completions

#### Missed occurrences log rather than diagnose
**Decision**: a stale occurrence appends one `missed` log line (guard-gated, target-independent), advancing the anchor.
**Why**: one line per gap (not per tick) bounds the occurrence walk near now; the Activity feed gets visible missed history; a diagnostic alone repeats every tick and leaves the anchor stale.
**Rejected**: diagnostic-only (invisible, unbounded walk); one line per missed occurrence in a gap (log spam over long gaps for no derivation gain).
*Introduced by*: 260908-qyin-cron-schedule-completions

#### The when-idle due window extends to the hold bound
**Decision**: a cron occurrence stays deliverable for `DefaultCronGrace` (2m) on immediate entries and `DefaultHoldWindow` (2h) on when-idle entries.
**Why**: a when-idle hold is realized as cross-tick re-evaluation — with only the 2m grace every held cron fire would expire before the pane could idle, making when-idle+cron useless.
**Rejected**: one shared window (either too lax for immediate or too strict for when-idle); persisted first-observed-due state (Constitution II violation).
*Introduced by*: 260908-qyin-cron-schedule-completions

## Tasks

### Phase 1: Setup

- [x] T001 Add `github.com/robfig/cron/v3` to `app/backend/go.mod` (`go get`, tidy; verify zero transitive additions in go.sum) <!-- R1 -->

### Phase 2: Core Implementation

- [x] T002 `app/backend/internal/cron/schema.go`: add `CatchUp` to `Schedule` (+ `CatchUpOnce` constant); extend `validate()` — parse `Expr` via `cron.ParseStandard` for kind cron, reject `catch_up` on non-cron kinds and values ≠ `once`; extend `schema_test.go` (valid/invalid exprs, catch_up gating, tolerant-load skip of a bad-expr entry) <!-- R1 -->
- [x] T003 New `app/backend/internal/cron/cronexpr.go`: `DefaultCronGrace` (2m) + `DefaultHoldWindow` (2h) named constants; pure cron due math — latest occurrence in `(anchor, now]` via bounded `Next` walks, window selection by `deliver`, `catch_up: once` unbounded branch; `DueAt = now` ONLY for a catch-up occurrence already beyond its window (a late fire) — an on-time occurrence carries `DueAt = O` even with catch_up set, so the hold bound applies to it; table-driven `cronexpr_test.go` (on-time, beyond-grace, when-idle extension, catch-up on-time DueAt=O, catch-up late DueAt=now, DST-adjacent local-time sanity) <!-- R2 --> <!-- rework: on-time catch-up occurrences got DueAt=now, defeating the R4 hold bound for catch-up entries (review cycle 1) -->
- [x] T004 `app/backend/internal/cron/evaluate.go`: add `Fire.DueAt` (populate for every/backoff/cron/wake per R2); replace the `ScheduleCron` diagnostic with the T003 math; add `EvalResult.Missed []Fire` emitted through the existing muted/guard gating; extend `evaluate_test.go` (cron fires, missed emission, guard-suppressed missed, determinism pin) <!-- R2 -->
- [x] T005 `app/backend/internal/cron/tick.go`: append one `missed` line per `EvalResult.Missed` fire (target-independent, before/independent of if_absent handling); leave `countsTowardRate` untouched and pin `missed`/`held-expired` as non-counting in `tick_test.go`; assert one-line-per-gap across consecutive ticks <!-- R3, R5 -->
- [x] T006 `app/backend/internal/cron/deliver.go`: in the when-idle busy branch return `held-expired` (`Held: false`) when `now − fire.DueAt > DefaultHoldWindow`, else `held-busy` as today; extend `deliver_test.go` (busy within window holds, past window expires, catch-up fires with `DueAt = now` never expire, immediate entries unaffected) <!-- R4 -->
- [x] T007 `app/backend/internal/cron/derive.go`: cron-kind case sets `NextFire = Next(now)`/`HasNextFire = true` (parse failure ⇒ unchanged false); extend `derive_test.go` <!-- R6 -->

### Phase 3: Integration & Edge Cases

- [x] T008 `app/backend/cmd/rk/cron_add.go`: add `--catch-up` flag (usage error without `--cron` or value ≠ `once`); delete the `cronExprStored` stderr note and scrub "not implemented/not evaluated" from flag help, `Long`, and the file-header comment; reflect catch-up in `cronScheduleSummary` (`cmd/rk/cron.go` or wherever it lives); extend CLI tests (flag gating, bad-expr add fails via validate, summary rendering) <!-- R7 -->
- [x] T009 `app/backend/api/cron.go`: add `CatchUp string \`json:"catchUp,omitempty"\`` to `cronScheduleJSON` + the create body's schedule struct, mapped to `Schedule.CatchUp`; extend `api/cron_test.go` (create with catchUp echoes 201 + GET round-trip, bad value 400) <!-- R8 -->
- [x] T010 [P] `app/frontend/src/lib/cron-schedule.ts`: drop the "not yet evaluated" note from the cron case (bare expr; empty expr ⇒ "cron expression"); update `cron-schedule.test.ts` AND every other frontend spot carrying the stale note — `cron-activity-feed.test.tsx:157-164` (rewrite the stale-premise test: cron rows now carry real next-fires, so assert the expr renders and a relative time appears instead of asserting its absence), `cron-create-dialog.tsx:156` (placeholder copy), `cron-activity-feed.tsx:21` (header comment) <!-- R9 --> <!-- rework: grep missed three not-yet-evaluated spots; cron-activity-feed.test.tsx fails (review cycle 1) -->

### Phase 4: Polish

- [x] T011 [P] `docs/specs/cron.md`: record OQ2's resolution inline in § Open Questions (decision, deciding change, rationale — the OQ3 precedent); concretize § Delivery step 2's hold bound; update § Schedules' catch-up paragraph (grace, when-idle extension, `missed` lines) <!-- R10 -->
- [x] T012 Verification gates: `cd app/backend && go test ./...`, `cd app/frontend && npx tsc --noEmit` + the touched Vitest file, then `just build` <!-- R1 -->

## Execution Order

- T001 → T002 → T003 → T004 → {T005, T006, T007} → {T008, T009}
- T010, T011 independent; T012 last

## Acceptance

### Functional Completeness

- [x] A-001 R1: `Schedule.CatchUp` exists, `validate()` parses cron exprs and gates catch_up (kind + value), with tests covering valid/invalid/misplaced cases
- [x] A-002 R2: cron-kind entries fire on schedule — pure due math with anchor-from-log, grace/hold windows, catch-up branch, and `Fire.DueAt` populated for all schedule kinds
- [x] A-003 R3: stale occurrences append exactly one `missed` line per gap, guard-gated, target-independent
- [x] A-004 R4: when-idle holds return `held-expired` past 2h (logged, anchor-advancing) and `held-busy` within it; no force-delivery path exists
- [x] A-005 R6: `GET /api/cron` reports real `nextFire` for cron entries via `DeriveEntry` (API layer reimplements no schedule math)
- [x] A-006 R7: `rk cron add --cron` validates the expression, supports `--catch-up once`, and prints no unimplemented note
- [x] A-007 R8: `catchUp` round-trips through create and GET; invalid values 400

### Behavioral Correctness

- [x] A-008 R2: an entry stored before this change with a valid expression starts firing (and a stored non-parsing expression degrades to `entry-invalid` on load, never aborting the tick)
- [x] A-009 R4: catch-up late fires carry `DueAt = now` and are exempt from hold expiry
- [x] A-010 R5: `countsTowardRate` excludes `missed` and `held-expired` (pinned by test); both advance anchors

### Scenario Coverage

- [x] A-011 R2: table-driven tests cover on-time fire, beyond-grace miss, when-idle window extension, and catch-up-once late fire
- [x] A-012 R3: consecutive-tick test proves one `missed` line per gap, not per tick
- [x] A-013 R9: `describeSchedule` cron sentence carries no "not yet evaluated" text (test updated)

### Edge Cases & Error Handling

- [x] A-014 R2: occurrence walks are bounded from an ancient anchor (no unbounded `Next` scan; missed-line anchor advancement keeps later walks short)
- [x] A-015 R7: `--catch-up` without `--cron`, `--catch-up always`, and a 5-field-but-invalid expression each fail with a named usage/validation error, file untouched

### Code Quality

- [x] A-016 Pattern consistency: new code follows internal/cron idioms (named constants, seam-based tests, tolerant-load diagnostics, comment style stating constraints not narration)
- [x] A-017 No unnecessary duplication: due math reuses `everyAnchor`-style log derivation and `LastDelivery`/`OwnDeliveries` helpers; robfig scheduler unused (parse+next only)
- [x] A-018 Tests accompany every behavior change (Go: colocated `_test.go`; frontend: colocated `.test.ts`)
- [x] A-019 No new exec/subprocess surface; Constitution II holds (no new state files — every new fact derives from entry file + log + now)

### Security

- [x] A-020 R1: expression strings are parsed, never shelled or interpolated into commands; a hostile expr can at worst fail validation

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | `cronScheduleJSON` gains `catchUp` on GET (not just create) | Symmetry with every other schedule field the wire shape already carries; detail sheet can render it | S:60 R:85 A:80 D:75 |
| 2 | Confident | Missed lines ride the existing `appendLine` path (they count in `TickResult.Fires` summary) | Reuses the mirror-into-logLines mechanics the rate cap depends on; the CLI summary counting a missed line as activity is acceptable | S:50 R:80 A:75 D:65 |
| 3 | Confident | The CLI's 5-field count pre-check remains as a friendlier usage error ahead of ParseStandard | Cheap, better message class (usage vs validation); ParseStandard stays the authority | S:55 R:90 A:80 D:70 |
| 4 | Certain | Vitest/`tsc` and `go test` gates run per `fab/project/code-quality.md` verification order | Config deterministically prescribes the gates | S:90 R:95 A:95 D:95 |
| 5 | Confident | "Bounded Next walks" is implemented as a minute-granularity binary search over the existence probe `Next(t) ≤ now` (~log2(span-minutes) Next calls), not a capped occurrence-by-occurrence scan | Exact for dense expressions from an ancient anchor (a capped scan mislabels a minutely schedule's in-grace latest occurrence as missed); ParseStandard occurrences are minute-aligned, so minute granularity loses nothing | S:60 R:85 A:75 D:70 |
| 6 | Confident | `EngineDeliverer` relies on `Fire.DueAt` being populated (zero DueAt on a busy when-idle fire would expire instantly); its only caller is the tick, which passes Evaluate fires | R2 makes DueAt mandatory on every Fire; a defensive zero-guard would mask construction bugs — tests pin the boundary instead | S:55 R:80 A:75 D:65 |

6 assumptions (1 certain, 5 confident, 0 tentative).

## Deletion Candidates

- None — this change adds new functionality without making existing code redundant (the superseded `schedule-kind-unsupported` diagnostic and the frontend "not yet evaluated" strings were removed in-diff, not left behind)
