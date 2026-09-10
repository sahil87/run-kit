# Intake: Structured `rk cron list --json` Fields

**Change**: 260910-r5ao-cron-list-structured-json
**Created**: 2026-09-10

## Origin

Backlog item `[r5ao]` (2026-09-10, tagged *fab-kit operator follow-up*), invoked one-shot via `/fab-new r5ao` with no prior discussion in the session:

> rk cron list --json: emit the schedule, wake_on and respawn as structured fields, not display text. cron_list.go's cronListRecord serializes `schedule` via cronScheduleSummary as a string ('backoff 1m→30m') and omits wake_on/if_absent/respawn; fab's tracked-set verbs already parse this output to find the operator entry (target == 'role:operator', name tiebreak) for mute/unmute, and the planned derived-schedule reconcile (fab derives idle-every min(check_every) vs backoff from what it tracks and applies it via the new `rk cron edit`) needs to compare kind/min/max/interval before editing. Add: `schedule: {kind, interval?, min?, max?, expr?, catch_up?}`, `wake_on: {event, scope, debounce} | null`, `if_absent`, `respawn: [argv]`, keeping the existing string under `schedule_summary` for one release so current parsers (fab-kit operator_clock.go) don't break. Depends on / lands with 260910-9aup (edit, skip-if-busy, --idle-every) so edit's flag surface and list's fields agree.

Gap analysis at intake: no existing mechanism covers this. The HTTP surface (`GET /api/cron`, `app/backend/api/cron.go`) already projects the schedule as a structured object (`cronScheduleJSON`, camelCase), but the CLI record (`cronListRecord` in `app/backend/cmd/rk/cron_list.go`) is a separate snake_case type that flattens the schedule to display text. The referenced dependency `260910-9aup` does not exist as a change (active or archived) or as a backlog item in this repo; see Assumptions.

## Why

**Pain point.** `rk cron list --json` is the only disk-only, zero-tmux way for another tool to read a server's cron intent. Today its `schedule` field is the human table's display string (`cronScheduleSummary`: `every 1h` / `backoff 1m→30m` / `cron <expr> (catch-up once)`), and the record omits `wake_on`, `if_absent`, and `respawn` entirely. A consumer that needs to know *what kind of schedule an entry has and with which parameters* — fab-kit's planned derived-schedule reconcile, which compares an entry's `kind`/`min`/`max`/`interval` against what it derives from its tracked set before deciding whether to edit — would have to parse a presentation string with an arrow glyph and compact duration formatting. That is a parser of a rendering, which breaks the moment the rendering changes.

**Consequence of not fixing.** Either fab-kit reimplements a fragile string parser against `rk`'s table format, or it reads the YAML entry file directly (bypassing `rk`'s tolerant load and coupling to the on-disk path layout), or the reconcile feature is blocked. All three violate the CLI-layering contract that `rk` owns the cron substrate and `fab` consumes it through the CLI.

**Why this approach.** Emit the intent fields as structured JSON keyed exactly like the on-disk schema (`kind`, `interval`, `min`, `max`, `expr`, `catch_up`, `wake_on.{event,scope,debounce}`, `if_absent`, `respawn`) so that the list output, the YAML file, and any future `rk cron edit` flag surface all speak the same vocabulary — there is nothing to keep in sync by hand. The display string survives for one release under `schedule_summary` so the change is purely additive from a consumer's point of view except for the type of the `schedule` key itself. Durations use the same `time.Duration.String()` encoding the HTTP API already uses (`cronDur`), so there is exactly one duration encoding across rk's JSON surfaces.

## What Changes

### 1. `cronListRecord` gains structured intent fields (`app/backend/cmd/rk/cron_list.go`)

The `--json` element shape changes from:

```json
{
  "id": "k7q2",
  "name": "op tick",
  "schedule": "backoff 1m→30m",
  "target": "role:operator",
  "deliver": "when-idle",
  "pinned": true,
  "muted": false,
  "last_fired": 0,
  "orphaned_since": 0,
  "expires_at": 0
}
```

to:

```json
{
  "id": "k7q2",
  "name": "op tick",
  "schedule": { "kind": "backoff", "min": "1m0s", "max": "30m0s" },
  "schedule_summary": "backoff 1m→30m",
  "wake_on": { "event": "agent-state-change", "scope": "server", "debounce": "2m0s" },
  "target": "role:operator",
  "deliver": "when-idle",
  "if_absent": "respawn",
  "respawn": ["rk", "operator", "-L", "{server}"],
  "pinned": true,
  "muted": false,
  "last_fired": 0,
  "orphaned_since": 0,
  "expires_at": 0
}
```

Field contract (all keys snake_case, matching the record's existing keys and the on-disk YAML):

| Key | Type | Presence | Value |
|---|---|---|---|
| `schedule` | object | always | `{kind, interval?, min?, max?, expr?, catch_up?}` — `kind` always present; the other five are `omitempty` (present only when set on the entry), exactly mirroring `cron.Schedule`'s YAML tags. Durations render via `time.Duration.String()` (`"1h0m0s"`, `"1m0s"`, `"30m0s"`), the same encoding as `GET /api/cron`'s `cronDur`; an unset duration is omitted, never `"0s"` |
| `schedule_summary` | string | always (one release) | The exact string `cronScheduleSummary(e.Schedule)` produces today — the value the `schedule` key carried before this change. Deprecated on arrival: documented for removal after one release |
| `wake_on` | object or `null` | always | `{event, scope?, debounce?}` when the entry has a `wake_on` block; JSON `null` when it does not (a pointer field without `omitempty` — the fixed-key-set rule) |
| `if_absent` | string | always | The stored `if_absent` value verbatim (`""` when the entry does not set it — the raw intent, not the evaluator's effective default, matching how `deliver` is already emitted raw) |
| `respawn` | array of string | always | The stored argv verbatim, including an unsubstituted `{server}` placeholder; `[]` when unset (nil normalized to an empty slice so the key is never `null`) |

Unchanged keys: `id`, `name`, `target` (stays the `role:operator` / `session:<id>` / `pane:%N` summary string — fab-kit matches on it and the backlog did not ask for a structured target), `deliver`, `pinned`, `muted`, `muted_until` (still the sole `omitempty` scalar), `last_fired`, `orphaned_since`, `expires_at`.

Implementation shape: two CLI-local projection types beside `cronListRecord` — `cronListSchedule` and `cronListWakeOn` — with snake_case `json` tags, built in `runCronList` from `e.Schedule` / `e.WakeOn`. A small local duration helper (`""` for a non-positive duration, else `d.String()`) mirrors `api.cronDur`; the two live in different packages (`main` vs `api`) with different casing conventions, so no shared type is introduced. `Schedule` on the record changes from `string` to `cronListSchedule`; `ScheduleSummary string` is added immediately after it.

### 2. Human table unchanged

The tabwriter table keeps its seven columns (`ID NAME SCHEDULE TARGET DELIVER FLAGS LAST-FIRED`) and the SCHEDULE column keeps rendering `cronScheduleSummary` — the table reads `r.ScheduleSummary` instead of `r.Schedule`. No new columns: `wake_on`/`if_absent`/`respawn` are machine-consumer fields and the table stays scannable.

### 3. Help text (`cronListCmd.Long`)

The Long already enumerates the row fields and says "`--json` emits the same records as a JSON array". Extend that sentence to state that under `--json` the schedule is a structured object (`kind` plus its parameters) alongside the intent fields `wake_on`, `if_absent`, and `respawn`, with `schedule_summary` carrying the table's rendering. One or two sentences; this is a help-dump-visible surface, so the wording must stay factual and terse per the toolkit standards.

### 4. Tests (`app/backend/cmd/rk/cron_list_test.go`)

- Extend `cronListFixture` (or add a third entry) so one entry carries `wake_on: {event, scope, debounce}`, `if_absent: respawn`, and a multi-element `respawn` argv, and one entry carries neither `wake_on` nor `respawn`.
- `TestCronListJSON`: assert `records[0].Schedule.Kind == "every"` and `Interval == "1h0m0s"`; the backoff row's `Kind == "backoff"`, `Min == "1m0s"`, `Max == "30m0s"`, `Interval == ""`; `ScheduleSummary` equals the previous display string for each row (`"every 1h"`, `"backoff 1m→30m"`).
- New assertions (raw `map[string]any` decode, as `TestCronListMuteLease` does) for key presence: `wake_on` is `nil` (JSON null) on the entry without a block and an object with the three keys on the entry with one; `respawn` is an empty array (not null) when unset and the exact argv when set; `if_absent` present as `""` when unset; `schedule` omits `interval` on the backoff row and omits `min`/`max`/`expr`/`catch_up` on the every row.
- A `cron`-kind row with `catch_up: once` asserting `schedule.expr` and `schedule.catch_up`.
- `TestCronListRows` (human table) needs no behavior change; keep its `"every 1h"` / `"backoff 1m→30m"` expectations green.

### 5. Memory (`docs/memory/run-kit/cron.md`)

- § CLI table row `list [--json]`: name the structured `--json` fields.
- § "`list` is disk-derived only" paragraph: document the new key contract (the table above, condensed), the `schedule_summary` one-release deprecation, and that `wake_on` is `null`-not-omitted while the schedule's parameters are `omitempty`.
- § Requirement "`list` derives from disk only": extend the `--json` SHALL clause with the structured fields and the deprecation.
- § External Contracts: note that fab-kit's `operator_clock.go` reads `id`/`name`/`target`/`muted`/`muted_until` (unaffected) and that the structured fields exist for fab-kit's derived-schedule reconcile.
- § Design Decisions: one new entry — *List `--json` mirrors the on-disk schema keys* (Decision / Why / Rejected: parsing `schedule_summary`, integer-seconds durations, sharing the API's camelCase struct / Introduced by).

### Non-goals

- No structured `target` (fab-kit matches the summary string; not requested).
- No `payload` in the list record (not requested; the table stays payload-free by design).
- No `rk cron edit`, `--idle-every`, or skip-if-busy — those are the separately-described `9aup` work, which does not exist in this repo yet.
- No change to `GET /api/cron` (already structured, camelCase).
- No change to fab-kit (its parser reads none of the changed keys).

## Affected Memory

- `run-kit/cron`: (modify) § CLI table `list` row, § "`list` is disk-derived only", § Requirement "`list` derives from disk only", § External Contracts (fab-kit consumer note), and a new Design Decision on the structured `--json` contract and the `schedule_summary` deprecation.

## Impact

- **Code**: `app/backend/cmd/rk/cron_list.go` (record type, two projection types, duration helper, table column source, Long text); `app/backend/cmd/rk/cron_list_test.go` (fixture + assertions). ~80–120 lines net.
- **Behavior contract**: `rk cron list --json` — the `schedule` key changes type from string to object (breaking for any consumer that read it as a string; none is known: fab-kit's `operatorCronRow` declares no `schedule` field, so Go's decoder ignores it). Four keys are added. Human table output unchanged.
- **Docs**: `docs/memory/run-kit/cron.md`. `README.md`'s `rk cron` row lists verbs only and needs no change. No `rk skill` topic covers cron.
- **Downstream**: fab-kit `operator_clock.go` unaffected; the derived-schedule reconcile there becomes implementable once this ships.
- **Tests to run**: `just test-backend` (scope first to `go test ./cmd/rk -run TestCronList`).

## Open Questions

- None blocking. See Assumption 1 for the `9aup` dependency handling.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Ship standalone rather than wait for `260910-9aup` (`cron edit` / `--idle-every` / skip-if-busy), which exists neither as a change nor as a backlog item here | The stated reason for coupling is that edit's flags and list's fields must agree; keying the list fields on the on-disk schema names (`kind/interval/min/max/expr/catch_up`) makes that agreement structural, and the new fields are additive and independently useful. Reversible: a later edit verb adopts the same names | S:55 R:85 A:70 D:70 |
| 2 | Certain | snake_case keys (`schedule_summary`, `wake_on`, `if_absent`, `catch_up`) | Matches the record's existing keys (`muted_until`, `last_fired`, `orphaned_since`) and the on-disk YAML tags; the backlog spells them this way | S:90 R:90 A:95 D:95 |
| 3 | Confident | Durations encode as `time.Duration.String()` (`"1m0s"`), omitted when unset | Identical to `GET /api/cron`'s `cronDur` and to the YAML marshaller — one encoding across rk's JSON surfaces; fab compares via `time.ParseDuration` either way. Rejected: integer seconds (diverges from both existing surfaces) and `cronDurationShort` (a display format) | S:60 R:85 A:80 D:70 |
| 4 | Certain | `wake_on` is emitted as JSON `null` when absent, never omitted | Backlog spells it as object-or-null; the record's documented rule is a fixed key set with `muted_until` as the sole `omitempty` exception | S:90 R:90 A:95 D:95 |
| 5 | Certain | `respawn` is `[]` (never `null`) when unset; `if_absent` is the raw stored string, `""` when unset | Fixed-key-set rule; `deliver` is already emitted raw rather than as the evaluator's effective default, so `if_absent` follows the same posture | S:65 R:90 A:85 D:75 |
| 6 | Certain | `schedule` sub-keys other than `kind` are `omitempty` | Backlog marks them `?`; mirrors `cron.Schedule`'s YAML tags and the API's `cronScheduleJSON` | S:90 R:90 A:95 D:95 |
| 7 | Certain | Keep the display string under `schedule_summary` for one release; the human table reads it | Backlog explicit; deprecation recorded in memory so the removal is trackable | S:95 R:90 A:95 D:95 |
| 8 | Confident | CLI-local projection types in `cmd/rk` rather than sharing `api`'s structs or adding a JSON projection to `internal/cron` | The API is camelCase by convention and lives in another package; the list record is already a CLI-local type. Rejected: a shared `internal/cron` JSON type (would need dual casing) | S:60 R:80 A:85 D:75 |
| 9 | Certain | `target` stays the summary string; no `payload` added | fab-kit's `operatorCronRow` matches `target == "role:operator"`; the backlog asks for neither | S:85 R:90 A:95 D:90 |

9 assumptions (6 certain, 3 confident, 0 tentative, 0 unresolved). Run /fab-clarify to review.
