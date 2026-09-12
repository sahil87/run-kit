# Plan: Cron wake_on CLI flags + interim operator-tick seed tuning

**Change**: 260911-ntde-cron-wake-on-flags-seed-tuning
**Intake**: `intake.md`

## Requirements

### Cron CLI: `rk cron add` wake_on flags

#### R1: `add` accepts and persists the wake_on block
`rk cron add` SHALL accept `--wake-on <event>` (string, default unset), `--wake-scope <scope>` (string, default `server` = `cron.WakeScopeServer`), and `--wake-debounce <dur>` (duration, default `60s`). When `--wake-on` is given, the added entry MUST carry `WakeOn: &cron.WakeOn{Event, Scope, Debounce}` built from the three flags; when `--wake-on` is not given, `WakeOn` MUST be `nil` and the on-disk YAML MUST omit the `wake_on:` key.

- **GIVEN** a stubbed cron dir and tmux pane
- **WHEN** `rk cron add "operator tick" --backoff --role operator --wake-on agent-state-change` runs
- **THEN** the stored entry has `WakeOn = {Event: agent-state-change, Scope: server, Debounce: 60s}`
- **AND** `rk cron add "x" --every 1h` (no wake flag) stores `WakeOn == nil` and the file text contains no `wake_on:`

- **GIVEN** the same setup
- **WHEN** `--wake-on agent-state-change --wake-scope server --wake-debounce 2m` is passed
- **THEN** the stored block is `{agent-state-change, server, 2m}`

#### R2: add-time validation is usage-classified
`rk cron add` MUST reject, as a usage error (exit 2, state dir untouched, message naming the flag): `--wake-on` outside `{agent-state-change}`; `--wake-scope` outside `{server}`; a negative `--wake-debounce`; and `--wake-scope` or `--wake-debounce` given (by `Flags().Changed`) without `--wake-on`. Enum checks SHALL reuse `cronAddValidateEnum`. `Entry.validate()` in `internal/cron/schema.go` MUST NOT gain a wake_on rule.

- **GIVEN** a stubbed cron dir
- **WHEN** `rk cron add "x" --every 1h --wake-on foo` runs
- **THEN** exit is 2, stderr names `--wake-on`, and no entry file is written

- **GIVEN** a stubbed cron dir
- **WHEN** `rk cron add "x" --every 1h --wake-scope server` runs (no `--wake-on`)
- **THEN** exit is 2 with `--wake-scope/--wake-debounce only apply with --wake-on`

### Cron CLI: `rk cron edit` wake_on flags

#### R3: `edit --wake-on <event>` replaces the whole block
`rk cron edit <id>` SHALL accept the same three flags. `--wake-on <event>` MUST replace the entry's whole `wake_on` block with `{event, scope, debounce}` where `--wake-scope`/`--wake-debounce` refine and the defaults (`server`, `60s`) fill any knob not given — including when the stored entry had a different debounce (the `--backoff --min/--max` "replaces the whole ladder" precedent). Validation rules are R2's verbatim; knobs without `--wake-on` are a usage error.

- **GIVEN** a stored entry with no `wake_on`
- **WHEN** `rk cron edit <id> --wake-on agent-state-change --wake-debounce 2m` runs
- **THEN** the entry now carries `{agent-state-change, server, 2m}`

- **GIVEN** a stored entry with `wake_on: {agent-state-change, server, 2m}`
- **WHEN** `rk cron edit <id> --wake-on agent-state-change` runs
- **THEN** the debounce is back at `60s` (whole-block replace)

#### R4: `edit --wake-on none|off` clears the block
`--wake-on none` MUST set `WakeOn = nil` so the file drops the key; `off` MUST be accepted as an alias for `none`. `--wake-on none` (or `off`) combined with `--wake-scope` or `--wake-debounce` MUST be a usage error (`--wake-scope/--wake-debounce do not apply with --wake-on none`). `none`/`off` MUST NOT be accepted by `add` (there is nothing to clear; `add` validates against the event enum only).

- **GIVEN** a stored entry with a `wake_on` block
- **WHEN** `rk cron edit <id> --wake-on none` runs
- **THEN** the reloaded entry has `WakeOn == nil` and the file has no `wake_on:` key
- **AND** `--wake-on off` behaves identically

#### R5: a wake-only edit is an edit, but not a reschedule
`runCronEdit`'s `edited` predicate MUST include `Flags().Changed("wake-on")`, and the "nothing to edit" usage message MUST list `--wake-on`. A wake_on-only edit MUST NOT append a `rescheduled` log line: `cron.Edit` (`internal/cron/edit.go`) compares only `Schedule` and `Deliver` and MUST NOT be modified.

- **GIVEN** a stored entry and an empty delivery log
- **WHEN** `rk cron edit <id> --wake-on agent-state-change` runs
- **THEN** the log has no line (mirrors `TestCronEditNameOnlyNoLogLine`)

### Cron CLI: help surface

#### R6: help text names the wake flags and the full operator entry
`cronAddCmd.Long` MUST mention the wake flags as the reactive channel (fires on an actionable agent-state edge — a pane going `waiting`/`idle` or vanishing — in addition to the schedule, held `--wake-debounce` after the entry's own delivery). `cronAddCmd.Example` MUST replace the current `operator tick` line with the full shape fab will seed with:
`rk cron add "operator tick" --backoff --min 3m --max 24m --wake-on agent-state-change --deliver skip-if-busy --role operator --if-absent respawn --respawn rk --respawn operator --respawn -L --respawn '{server}' --pinned`.
`cronEditCmd.Use` MUST gain `[--wake-on <event>|none [--wake-scope <s>] [--wake-debounce <dur>]]`; its `Long` MUST state the replace-block and `none` semantics; its `Example` MUST gain `rk cron edit a3f9 --wake-on agent-state-change --wake-debounce 2m` and `rk cron edit a3f9 --wake-on none`. The existing pinned example strings in `TestCronAddHelpText`/`TestCronEditHelpText` stay valid; the generic `--backoff` usage text (`60s→30m by default`) and the `--min`/`--max` defaults (`time.Minute`, `30*time.Minute`) MUST NOT change.

- **GIVEN** the built command tree
- **WHEN** `TestCronAddHelpText` / `TestCronEditHelpText` run
- **THEN** they assert the new example strings and a `--wake-on` flag with usage text mentioning `agent-state-change`

### Cron CLI: list

#### R7: `rk cron list --json` round-trips wake_on unchanged
No list code changes. A test MUST show that an entry added with `--wake-on agent-state-change --wake-debounce 2m` appears in `rk cron list --json` with `wake_on: {event: agent-state-change, scope: server, debounce: 2m0s-or-equivalent}` (use the existing `cronListDur` rendering as the oracle), and that an entry without the flag lists `wake_on: null`.

- **GIVEN** two added entries, one with and one without `--wake-on`
- **WHEN** `rk cron list --json` runs
- **THEN** the first row's `wake_on` object carries the three fields and the second row's is `null`

### Operator seed: interim tuning

#### R8: `operatorTickEntrySpec` matches fab's derived values
In `app/backend/cmd/rk/operator.go`, `operatorTickEntrySpec` MUST set `Schedule.Min = 3m`, `Schedule.Max = 24m`, `Deliver = cron.DeliverSkipIfBusy`. Every other field (wake_on 60s, target, name/payload, if_absent, respawn argv, pinned, created_by) MUST be unchanged. `seedOperatorTick` and `cron.EnsureRoleEntry` MUST NOT change. `TestOperatorSeedsOperatorTickEntry` MUST assert the new values, and its doc comment MUST be corrected to state `3m→24m`, `wake_on … 60s`, `skip-if-busy` (it currently says `60s→30m`, `10s`, `immediate`).

- **GIVEN** a fresh state dir
- **WHEN** `runOperator` runs
- **THEN** the seeded entry has schedule `{backoff, 3m, 24m}` and `deliver: skip-if-busy`
- **AND** `TestOperatorSeedIsIdempotent` still passes unchanged

### Docs (spec + site; memory is hydrate's)

#### R9: spec and site docs state the ownership split and the new values
`docs/specs/cron.md`, `docs/site/skill/cron.md`, and `docs/site/cron-schedule-kinds.md` MUST be updated per intake § What Changes › 6: the operator-tick example values (`min: 3m, max: 24m`, `deliver: skip-if-busy`), the wake flags documented on `add` and `edit` (including `none`), and the ownership wording "rk defines the schema and the evaluator; the consumer (fab) seeds and tunes its entry" — stated as present truth (`rk operator` still seeds today; the seed move is STEP 2, pending fab-kit). The generic backoff-default prose (60s→30m / 1→30m ladder) MUST stay. `docs/site/skill/cron.md` edits MUST be checked against `shll standards skill` and the help edits against `shll standards principles` (№3, №4) and `help-dump`.

- **GIVEN** the edited `docs/site/skill/cron.md`
- **WHEN** a reader looks for how to seed the reactive channel
- **THEN** the `rk cron add` section documents `--wake-on`/`--wake-scope`/`--wake-debounce`, the edit section documents replace + `none`, and no sentence claims fab already seeds

### Backlog

#### R10: STEP 2 gets its own backlog row
`fab/backlog.md` MUST gain one new row (fresh 4-char id, today's date, tagged `[fab-kit operator clock]`) carrying STEP 2: delete `seedOperatorTick`/`operatorTickEntrySpec` and the three seed tests, `rk operator` becomes launcher-only, gated on fab-kit's reconcile seeding via `rk cron add … --wake-on agent-state-change … --pinned`; respawn argv unchanged; the safe overlap window; `EnsureRoleEntry`'s narrow upgrade retires with the seed.

- **GIVEN** the edited backlog
- **WHEN** this change is archived and `[ntde]` is marked done
- **THEN** STEP 2 survives as its own open row

### Non-Goals

- No change to backoff/idle-epoch semantics, `skipped-busy` logging, `cron.Edit`'s rescheduled rule, `EnsureRoleEntry`'s narrow upgrade, or `rk cron rm`.
- No wake column in the `rk cron list` text table; no `Entry.validate()` wake rule.
- No change to the generic `--backoff` defaults or their help text.
- No fab-kit changes (cross-repo; fab's seed move is its own backlog row).
- `docs/memory/` edits are hydrate's, not apply's.

### Design Decisions

#### wake_on is CLI-addressable; the generic backoff defaults stay
**Decision**: expose `wake_on` as three `rk cron add`/`edit` flags so a consumer can seed and tune the full operator entry through rk verbs alone, while the generic `--backoff` ladder defaults stay 60s→30m and only the operator spec moves to 3m→24m.
**Why**: fab's seed must not lose the reactive channel; the 3m→24m ladder is the operator consumer's tuning, not the substrate's default — moving the generic default would encode consumer policy in the substrate, the opposite of the ownership split.
**Rejected**: changing the generic defaults to agree (touches every "60s→30m by default" string and every user's future entries for one consumer's preference); a Go-only spec with no CLI path (blocks fab's seed).
*Introduced by*: 260911-ntde-cron-wake-on-flags-seed-tuning

#### A wake_on edit is not a reschedule
**Decision**: `edit --wake-on …` replaces or clears the block without a `rescheduled` log line; `cron.Edit`'s Schedule/Deliver comparison is untouched.
**Why**: `rescheduled` is the anchor-reset point for `every`/`cron`/`backoff`; `wake_on` has no anchor — its cursor is entry-id keyed and cold-starts harmlessly.
**Rejected**: logging `rescheduled` on any field change (would restart a healthy backoff streak for a debounce tweak).
*Introduced by*: 260911-ntde-cron-wake-on-flags-seed-tuning

## Tasks

### Phase 1: Setup

- [x] T001 Stage the Go embed and confirm the baseline: run `just _ensure-tmux-conf` from the repo root, then `cd app/backend && go test ./cmd/rk/ -run 'TestCron|TestOperator' -count=1` and confirm green before editing <!-- R1 -->

### Phase 2: Core Implementation

- [x] T002 In `app/backend/cmd/rk/cron_add.go`: add `cronAddWakeOn`/`cronAddWakeScope`/`cronAddWakeDebounce` vars and flags (`--wake-on`, `--wake-scope` default `cron.WakeScopeServer`, `--wake-debounce` default `60*time.Second`); add a shared helper `cronWakeOnFromFlags(cmd *cobra.Command, on, scope string, debounce time.Duration, allowClear bool) (w *cron.WakeOn, clear bool, err error)` next to `cronScheduleFromFlags` that implements R2's usage-error matrix (enum via `cronAddValidateEnum`, negative debounce, knobs-without-`--wake-on`, and — when `allowClear` — the `none`/`off` clear form and its knobs conflict); call it in `runCronAdd` with `allowClear=false` and pass the result into `cron.Add`'s `Entry` as `WakeOn` <!-- R1 -->
- [x] T003 In `app/backend/cmd/rk/cron_add.go`: update `cronAddCmd.Long` (wake flags as the reactive channel, debounce hold) and `Example` (replace the `operator tick` line with the full seed shape from R6); keep the generic `--backoff`/`--min`/`--max` text and defaults untouched <!-- R6 -->
- [x] T004 In `app/backend/cmd/rk/cron_edit.go`: add the three flag vars/flags (same defaults), call `cronWakeOnFromFlags(..., allowClear=true)`, extend `edited` with `Changed("wake-on")`, extend the "nothing to edit" message, and in `apply` set `e.WakeOn = w` (or `nil` on clear); update `Use`, `Long` (replace-block + `none` semantics, no rescheduled line), and `Example` per R6; do NOT touch `internal/cron/edit.go` <!-- R3 -->
- [x] T005 In `app/backend/cmd/rk/operator.go` `operatorTickEntrySpec`: `Min` → `3 * time.Minute`, `Max` → `24 * time.Minute`, `Deliver` → `cron.DeliverSkipIfBusy`; nothing else changes <!-- R8 -->

### Phase 3: Tests

- [x] T006 [P] In `app/backend/cmd/rk/cron_add_test.go`: add `TestCronAddWakeOnDefaults` (flag alone ⇒ `{agent-state-change, server, 60s}`), `TestCronAddWakeOnExplicit` (scope + 2m debounce), `TestCronAddNoWakeOnOmitsKey` (`WakeOn == nil`, file text lacks `wake_on:`), and `TestCronAddWakeOnMatrix` (table: bad event, bad scope, negative debounce, `--wake-scope` alone, `--wake-debounce` alone, `--wake-on none` rejected on add — each exit 2 and state dir untouched, in the `TestCronAddRespawnMatrix` style); extend `TestCronAddHelpText` with the new `Example` string and a `--wake-on` flag-usage assertion <!-- R2 -->
- [x] T007 [P] In `app/backend/cmd/rk/cron_edit_test.go`: add `TestCronEditWakeOnAdds` (entry without block gains `{…, 2m}`), `TestCronEditWakeOnReplacesWholeBlock` (stored 2m debounce → default 60s when `--wake-debounce` omitted), `TestCronEditWakeOnClears` (`none` and `off` both ⇒ `nil`, no `wake_on:` in file), `TestCronEditWakeOnlyNoLogLine` (no `rescheduled` line), and extend `TestCronEditFlagMatrix` (knobs without `--wake-on`; `none` + knob; bad enum; bare `edit <id>` message lists `--wake-on`); extend `TestCronEditHelpText` with the two new examples <!-- R4 -->
- [x] T008 [P] In `app/backend/cmd/rk/cron_list_test.go`: add `TestCronListJSONWakeOnRoundTrip` — add one entry with `--wake-on agent-state-change --wake-debounce 2m` and one without, run `list --json`, assert the first row's `wake_on` fields and the second row's `null` <!-- R7 -->
- [x] T009 [P] In `app/backend/cmd/rk/operator_test.go`: update `TestOperatorSeedsOperatorTickEntry`'s expected schedule (3m/24m) and deliver (`skip-if-busy`), and rewrite its doc comment to the true values (3m→24m, wake_on 60s, skip-if-busy) <!-- R8 -->
- [x] T010 Run `gofmt -l app/backend/cmd/rk` (must print nothing), `cd app/backend && go vet ./cmd/rk/`, then `just test-backend` from the repo root; fix anything red before moving on <!-- R1 -->

### Phase 4: Docs and backlog

- [x] T011 [P] Edit `docs/specs/cron.md`: § Cron State example (≈L111–115) values `min: 3m, max: 24m`, `deliver: skip-if-busy` + a comment that these are the operator consumer's tuning; ≈L190 debounce paragraph reworded to the consumer-seeds framing while keeping the rk narrow-upgrade sentence true until STEP 2; ≈L518–524 P1.5 gains the ownership decision and the two-step handover (STEP 1 shipped here, STEP 2 gated on fab-kit's seed); ≈L569 kbbh note gets one clause that the seed is moving to fab; the § CLI flag enumeration gains the three wake flags and the `none` clear form <!-- R9 -->
- [x] T012 [P] Edit `docs/site/skill/cron.md`: run `shll standards skill` first; in § `rk cron add` add a bullet group for `--wake-on`/`--wake-scope`/`--wake-debounce` (actionable edge, debounce hold, default 60s) and update the operator example line to the R6 shape; in § Managing entries note `edit --wake-on <event>` replaces the block and `--wake-on none` clears it with no `rescheduled` line; reword L15 `(rk operator's seeded entry)` to `(the operator tick entry)` <!-- R9 -->
- [x] T013 [P] Edit `docs/site/cron-schedule-kinds.md` ≈L163–172: YAML block → `min: 3m, max: 24m`, `deliver: skip-if-busy`; prose "that `rk operator` seeds" → ownership-neutral ("the operator tick seeded on every tmux server — rk defines the clock, the operator consumer seeds and tunes its entry"); "snaps back to 1 minute" → "to 3 minutes"; leave the generic backoff panel's 1→30m text <!-- R9 -->
- [x] T014 [P] Append the STEP 2 follow-up row to `fab/backlog.md` (fresh 4-char lowercase alphanumeric id not already present in the file, dated today, `[fab-kit operator clock]` tag) with the content in R10 <!-- R10 -->
- [x] T015 Re-run `just test-backend`; run `shll standards principles` and `shll standards help-dump` and confirm the help edits conform (layered help, exit-2 usage errors, no `-h` parsing); re-read the three doc edits once for any sentence that claims fab already seeds <!-- R9 -->

## Execution Order

- T002 blocks T004 (shared `cronWakeOnFromFlags` helper lives in cron_add.go)
- T002–T005 block Phase 3
- T010 blocks Phase 4 (docs describe green behavior)

## Acceptance

### Functional Completeness

- [x] A-001 R1: `rk cron add --wake-on agent-state-change` persists `{agent-state-change, server, 60s}`; explicit scope/debounce persist; omitting the flag leaves `WakeOn nil` and no `wake_on:` key
- [x] A-002 R2: bad event, bad scope, negative debounce, and knobs-without-`--wake-on` are exit-2 usage errors that leave the state dir untouched
- [x] A-003 R3: `edit --wake-on <event>` replaces the whole block, defaults filling omitted knobs
- [x] A-004 R4: `edit --wake-on none` and `off` clear the block; `none` + knob is a usage error; `add --wake-on none` is rejected
- [x] A-005 R5: `edited` includes `wake-on`; nothing-to-edit message lists it; a wake-only edit writes no `rescheduled` line; `internal/cron/edit.go` is unchanged
- [x] A-006 R6: add `Long`/`Example` and edit `Use`/`Long`/`Example` carry the wake flags and the R6 operator example; generic backoff text and `--min`/`--max` defaults unchanged
- [x] A-007 R7: `list --json` round-trip test passes with no change to `cron_list.go`
- [x] A-008 R8: `operatorTickEntrySpec` is 3m/24m/skip-if-busy with every other field unchanged; `seedOperatorTick`, `EnsureRoleEntry` unchanged
- [x] A-009 R9: the three spec/site docs carry the new values, the wake flags, and the present-truth ownership wording
- [x] A-010 R10: a new STEP 2 backlog row exists with a unique id

### Behavioral Correctness

- [x] A-011 R8: `TestOperatorSeedsOperatorTickEntry` asserts 3m/24m/skip-if-busy and its comment matches the spec; `TestOperatorSeedIsIdempotent` and `TestOperatorSeedFailureIsNonFatal` pass unchanged
- [x] A-012 R5: `TestCronEditNameOnlyNoLogLine`-style test proves no log line for a wake-only edit

### Scenario Coverage

- [x] A-013 R1: `TestCronAddWakeOnDefaults`, `TestCronAddWakeOnExplicit`, `TestCronAddNoWakeOnOmitsKey` exist and pass
- [x] A-014 R2: `TestCronAddWakeOnMatrix` covers all six usage-error rows
- [x] A-015 R3: `TestCronEditWakeOnAdds` and `TestCronEditWakeOnReplacesWholeBlock` exist and pass
- [x] A-016 R4: `TestCronEditWakeOnClears` covers `none` and `off`
- [x] A-017 R6: `TestCronAddHelpText` and `TestCronEditHelpText` pin the new examples and flag usage

### Edge Cases & Error Handling

- [x] A-018 R2: `--wake-debounce 0` is accepted (explicit no-hold) and persists as a zero duration
- [x] A-019 R2: detection of knobs-without-`--wake-on` uses `Flags().Changed`, so an explicit `--wake-scope server` alone still errors
- [x] A-020 R4: after `--wake-on none` the entry's other fields (schedule, deliver, target, respawn, pinned, muted) are untouched

### Code Quality

- [x] A-021 Pattern consistency: new flags, vars, and helper follow the `cronScheduleFromFlags` / `cronAddValidateEnum` shapes and naming in `cron_add.go`/`cron_edit.go`
- [x] A-022 No unnecessary duplication: the wake-flag parsing/validation lives in one helper shared by `add` and `edit`
- [x] A-023 Tests included: every new/changed behavior has a test (code-quality.md Principles)
- [x] A-024 No magic strings: `none`/`off` are named constants (`cronWakeClearNone`/`cronWakeClearOff`) and the default debounce is the shared `cronWakeDebounceDefault` used by both `add` and `edit`
- [x] A-025 Comments state constraints, not narration; no change-ids or PR numbers in code comments (code-quality.md Anti-Patterns)
- [x] A-026 `gofmt -l` clean and `go vet ./cmd/rk/` clean; `just test-backend` green (gofmt flags only 6 pre-existing-untouched files, dirty at HEAD too; all changed files clean)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change adds new functionality (the wake flags, their shared helper, and tests) and re-tunes three `operatorTickEntrySpec` constants without making any existing file, function, branch, or config redundant.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | One shared helper `cronWakeOnFromFlags` in `cron_add.go` serves both verbs, with an `allowClear` switch for edit's `none`/`off` | Mirrors `cronScheduleFromFlags` (defined in add, reused by edit); avoids duplicating the usage matrix | S:70 R:90 A:85 D:75 |
| 2 | Confident | `--wake-debounce 0` is accepted as an explicit no-hold | Schema allows a zero/omitted debounce; only negatives are nonsensical | S:55 R:90 A:80 D:70 |
| 3 | Certain | `off` is normalized to `none` before the clear branch; `add` rejects both | Intake fixes `none` canonical with `off` alias; add has nothing to clear | S:80 R:95 A:90 D:85 |
| 4 | Certain | Spec/site docs are apply tasks; `docs/memory/` is hydrate's | Pipeline convention: hydrate owns memory | S:85 R:95 A:95 D:90 |
| 5 | Confident | The STEP 2 backlog row's id is minted by picking a random 4-char id absent from the file | Backlog ids are 4-char lowercase alphanumerics; no `idea` tool step is required for a hand-added row | S:60 R:90 A:80 D:70 |

5 assumptions (2 certain, 3 confident, 0 tentative).
