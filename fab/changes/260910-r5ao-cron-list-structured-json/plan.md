# Plan: Structured `rk cron list --json` Fields

**Change**: 260910-r5ao-cron-list-structured-json
**Intake**: `intake.md`

## Requirements

### Cron CLI: structured `--json` intent fields

#### R1: `schedule` is a structured object
Under `--json`, each `rk cron list` record's `schedule` key SHALL be an object `{kind, interval?, min?, max?, expr?, catch_up?}`. `kind` MUST always be present; the other five keys MUST be present only when set on the entry (`omitempty`), mirroring `cron.Schedule`'s YAML tags. Duration values SHALL render as `time.Duration.String()` (the same encoding as `GET /api/cron`'s `cronDur`); an unset duration is omitted, never `"0s"`.

- **GIVEN** an entry `schedule: { kind: every, interval: 1h }`
- **WHEN** `rk cron list --json` runs
- **THEN** the record carries `"schedule": {"kind": "every", "interval": "1h0m0s"}` with no `min`, `max`, `expr`, or `catch_up` keys

- **GIVEN** an entry `schedule: { kind: backoff, min: 60s, max: 30m }`
- **WHEN** `rk cron list --json` runs
- **THEN** the record carries `"schedule": {"kind": "backoff", "min": "1m0s", "max": "30m0s"}` with no `interval` key

- **GIVEN** an entry `schedule: { kind: cron, expr: "0 9 * * *", catch_up: once }`
- **WHEN** `rk cron list --json` runs
- **THEN** the record carries `"schedule": {"kind": "cron", "expr": "0 9 * * *", "catch_up": "once"}`

#### R2: `schedule_summary` preserves the display string for one release
Each `--json` record SHALL carry `schedule_summary`, a string equal to `cronScheduleSummary(e.Schedule)` — the value the `schedule` key carried before this change. The human table's SCHEDULE column SHALL render this same string; the table's columns and formatting MUST NOT otherwise change.

- **GIVEN** the backoff entry above
- **WHEN** `rk cron list --json` runs
- **THEN** `schedule_summary` is `"backoff 1m→30m"`
- **AND WHEN** `rk cron list` (table) runs, **THEN** the SCHEDULE column still reads `backoff 1m→30m`

#### R3: `wake_on` is an object or `null`, always present
Each `--json` record SHALL carry a `wake_on` key: an object `{event, scope?, debounce?}` when the entry has a `wake_on` block, else JSON `null`. The key MUST NOT be omitted. `debounce` renders per R1's duration rule; `scope` and `debounce` are `omitempty`, `event` is always present.

- **GIVEN** an entry with `wake_on: { event: agent-state-change, scope: server, debounce: 2m }`
- **WHEN** `rk cron list --json` runs
- **THEN** the record carries `"wake_on": {"event": "agent-state-change", "scope": "server", "debounce": "2m0s"}`

- **GIVEN** an entry with no `wake_on` block
- **WHEN** `rk cron list --json` runs
- **THEN** the record carries `"wake_on": null`

#### R4: `if_absent` and `respawn` are emitted raw, always present
Each `--json` record SHALL carry `if_absent` (the stored string verbatim, `""` when unset — never the evaluator's effective default) and `respawn` (the stored argv verbatim, including an unsubstituted `{server}` placeholder; `[]` when unset — never `null`).

- **GIVEN** an entry with `if_absent: respawn` and `respawn: ["rk", "operator", "-L", "{server}"]`
- **WHEN** `rk cron list --json` runs
- **THEN** the record carries `"if_absent": "respawn"` and `"respawn": ["rk", "operator", "-L", "{server}"]`

- **GIVEN** an entry with neither `if_absent` nor `respawn`
- **WHEN** `rk cron list --json` runs
- **THEN** the record carries `"if_absent": ""` and `"respawn": []`

#### R5: Unchanged keys and the zero-tmux invariant
The keys `id`, `name`, `target` (summary string), `deliver`, `pinned`, `muted`, `muted_until` (the sole `omitempty` scalar), `last_fired`, `orphaned_since`, and `expires_at` SHALL keep their current types and semantics. `rk cron list` MUST continue to issue zero tmux commands.

- **GIVEN** the existing list fixtures
- **WHEN** the existing `TestCronList*` tests run
- **THEN** every existing assertion on those keys still holds

#### R6: Help text names the structured fields
`cronListCmd.Long` SHALL state that under `--json` the schedule is a structured object (`kind` plus its parameters) alongside `wake_on`, `if_absent`, and `respawn`, with `schedule_summary` carrying the table's rendering — in one or two factual sentences.

- **GIVEN** `rk cron list --help`
- **WHEN** a reader scans the Long
- **THEN** the structured `--json` fields and `schedule_summary` are named

### Non-Goals

- No structured `target` — fab-kit matches on the `role:operator` summary string; not requested.
- No `payload` key in the list record.
- No `rk cron edit`, `--idle-every`, or skip-if-busy work.
- No change to `GET /api/cron` or to fab-kit.
- No new table columns.

### Design Decisions

#### List `--json` mirrors the on-disk schema keys
**Decision**: The structured fields use the entry file's own YAML key names (`kind`, `interval`, `min`, `max`, `expr`, `catch_up`, `wake_on`, `if_absent`, `respawn`) in snake_case, with durations as `time.Duration.String()`.
**Why**: Consumers (fab-kit's derived-schedule reconcile) compare these values against what they intend to write; sharing the schema vocabulary with the file and any future edit verb leaves nothing to keep in sync. One duration encoding across rk's JSON surfaces (the API already uses `d.String()`).
**Rejected**: Parsing `schedule_summary` (a rendering, not a contract); integer-seconds durations (diverges from both the API and the YAML marshaller); reusing the API's camelCase `cronScheduleJSON` (different package and casing convention).
*Introduced by*: 260910-r5ao-cron-list-structured-json

#### `schedule_summary` is a one-release compatibility field
**Decision**: The pre-change display string survives under `schedule_summary` for one release, after which it is removed; the table reads it so the human output is unchanged.
**Why**: The `schedule` key changes type, which is the one non-additive part of this change; the summary keeps any string-reading consumer working through one release.
**Rejected**: Dropping the string immediately (no grace period for unknown consumers); keeping it indefinitely (two encodings of one fact).
*Introduced by*: 260910-r5ao-cron-list-structured-json

## Tasks

### Phase 1: Core Implementation

- [x] T001 Add `cronListSchedule` and `cronListWakeOn` projection types (snake_case `json` tags, `omitempty` on the optional keys), a local `cronListDur` helper (`""` for non-positive, else `d.String()`), and builders from `cron.Schedule` / `*cron.WakeOn` in `app/backend/cmd/rk/cron_list.go` <!-- R1, R3 -->
- [x] T002 Change `cronListRecord.Schedule` to `cronListSchedule`, add `ScheduleSummary string`, `WakeOn *cronListWakeOn` (no omitempty), `IfAbsent string`, `Respawn []string` (nil normalized to `[]`); wire them in `runCronList`; switch the table's SCHEDULE column to `r.ScheduleSummary`; update the record type's doc comment and `cronListCmd.Long` in `app/backend/cmd/rk/cron_list.go` <!-- R2, R4, R5, R6 -->

### Phase 2: Tests

- [x] T003 Extend `app/backend/cmd/rk/cron_list_test.go`: add a `wake_on` + `if_absent: respawn` + multi-element `respawn` entry and a `cron`-kind `catch_up: once` entry to the fixture; update `TestCronListJSON` for the typed `Schedule` and `ScheduleSummary`; add raw-map assertions for `wake_on` null vs object, `respawn` `[]` vs argv, `if_absent` `""` vs value, and per-kind `omitempty` key sets <!-- R1, R2, R3, R4 -->
- [x] T004 Run `cd app/backend && go test ./cmd/rk -run 'TestCronList|TestCronAdd' ./...` scoped, then `go vet ./cmd/rk`; fix any failures so every existing `TestCronList*` assertion still holds <!-- R5 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: `--json` records carry a `schedule` object with `kind` always present and only the set parameters, durations as `time.Duration.String()`
- [x] A-002 R2: `--json` records carry `schedule_summary` equal to the prior display string; the table's SCHEDULE column reads it
- [x] A-003 R3: `--json` records carry `wake_on` as an object when set and JSON `null` when absent, never omitted
- [x] A-004 R4: `--json` records carry `if_absent` (raw, `""` when unset) and `respawn` (`[]` when unset, argv verbatim otherwise)
- [x] A-005 R6: `cronListCmd.Long` names the structured fields and `schedule_summary`

### Behavioral Correctness

- [x] A-006 R5: All previously existing `--json` keys keep their types and values; `TestCronListEmpty`, `TestCronListRows`, `TestCronListToleratesCorruptEntries`, `TestCronListMuteLease` pass unchanged in intent
- [x] A-007 R5: `runCronList` still touches only the entry file and delivery log (no tmux call introduced)

### Scenario Coverage

- [x] A-008 R1: A test covers each of the three schedule kinds' key sets (`every` → `interval` only; `backoff` → `min`/`max` only; `cron` → `expr` + `catch_up`)
- [x] A-009 R3: A test asserts `wake_on` is `null` for an entry without a block and an object with `event`/`scope`/`debounce` for one with
- [x] A-010 R4: A test asserts `respawn` decodes as an empty array (not null) when unset and as the exact argv when set

### Edge Cases & Error Handling

- [x] A-011 R1: An unset duration is omitted rather than emitted as `"0s"` (verified by the omitempty key-set assertions)
- [x] A-012 R4: An entry whose `respawn` argv contains `{server}` is emitted with the placeholder unsubstituted

### Code Quality

- [x] A-013 Pattern consistency: the new projection types sit beside `cronListRecord` with the same snake_case tag style and doc-comment posture as the existing record
- [x] A-014 No unnecessary duplication: `cronScheduleSummary` is reused for `schedule_summary` rather than re-rendered; the duration helper is the only new helper and mirrors `api.cronDur` deliberately (different package)
- [x] A-015 Tests cover added behavior: every new key has an assertion in `cron_list_test.go`
- [x] A-016 No magic strings: JSON keys live only in struct tags; test expectations reference the record's fields or literal fixture values
- [x] A-017 Comment narration: new comments state contracts (fixed key set, null-vs-omitted, one-release deprecation), not the next line

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

None — this change adds new functionality without making existing code redundant. The old `cronListRecord.Schedule string` field was replaced in the same diff (no dangling symbol), and `cronScheduleSummary` remains in use (`schedule_summary`, the table's SCHEDULE column, and `cron_add.go`'s confirmation output).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Keep `schedule` sub-keys `omitempty` while `wake_on`/`respawn`/`if_absent` are always present | Intake Assumptions 4–6 fix this split; the record's documented fixed-key-set rule applies at the top level, the `?` marks in the backlog apply inside `schedule` | S:90 R:90 A:95 D:95 |
| 2 | Confident | A `cron`-kind fixture entry is added to the list test even though the intake's fixture examples only show `every`/`backoff` | R1 names three kinds; covering the third costs one fixture entry and closes the `expr`/`catch_up` path | S:70 R:95 A:90 D:85 |

2 assumptions (1 certain, 1 confident, 0 tentative).
