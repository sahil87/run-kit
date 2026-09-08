# Intake: Cron Schedule Completions

**Change**: 260908-qyin-cron-schedule-completions
**Created**: 2026-09-09

## Origin

> Wave 4 change C9 "Schedule completions" from fab/plans/sahil/26-09-06-cron-clock-plan.md (read that file's Wave 4 section and the 2026-09-09 off-plan-narrowing note below it for exact scope). Scope: 5-field cron expressions (evaluation), catch_up: once, when-idle hold-window bound (resolves open question 2).

Conversational intake (`/fab-new`). The plan's 2026-09-09 off-plan-narrowing note fixes C9's scope precisely: expression *evaluation* (expressions are already accepted and stored as intent by `rk cron add --cron`), `catch_up: once`, and the `when-idle` hold bound. Two decisions were asked and resolved during intake:

- **Hold-window bound (spec open question 2)**: user chose **drop after 2h** — a `when-idle` fire held busy past the bound logs a `held-expired` outcome and advances the anchor — over "no bound / deliver whenever idle" and "force-deliver at bound".
- **Cron expression math**: user chose the **`robfig/cron/v3` dependency** (`cron.ParseStandard` + `Schedule.Next` only — never its runtime scheduler) over an in-house parser.

## Why

1. **`--cron` entries are dead intent today.** `rk cron add --cron "0 9 * * *"` stores a schema-valid entry, then the evaluator skips it every tick (`schedule-kind-unsupported` diagnostic, `evaluate.go`), `DeriveEntry` reports no next-fire, and the CLI prints a stderr note that evaluation is unimplemented. The spec (docs/specs/cron.md § Schedules) promises classic 5-field wall-clock schedules; without them the substrate covers only interval and idle-anchored timing — no "9am daily" class of recurring work.
2. **Missed wall-clock fires have no policy.** The spec's catch-up rule (default skip / `catch_up: once` opt-in) exists only as prose; no schema field, no evaluation semantics. Without it, landing cron-kind evaluation naively would either fire arbitrarily late after a daemon gap (violating "never fire late") or silently lose fires with no history.
3. **`when-idle` holds are unbounded** (deliver.go: "no long-bound policy yet — v1 holds indefinitely via cross-tick retry" — spec open question 2). A pane busy for hours then idling receives a payload that stopped being relevant long ago, delivered mid-context-switch. This change decides and implements the bound: **drop after a named 2h window with a logged, UI-visible outcome** — recurring schedules lose nothing (the next due period fires normally), and stale payloads never land hours late. Force-delivering at the bound was rejected because interrupting a busy/waiting agent contradicts what `when-idle` exists for; unbounded hold was rejected because it delivers stale payloads at the worst moment.

C9 is the second half of Wave 4 generalization (C8 ∥ C9); agent adoption beyond the operator waits on C8's orphan GC, not on this change.

## What Changes

All in `app/backend` unless noted. The evaluator stays a pure function of disk-derivable inputs throughout — no new persisted state, no sidecar files.

### 1. Dependency: `github.com/robfig/cron/v3`

Added to `go.mod` for **parse + next-occurrence math only**: `cron.ParseStandard(expr)` (classic 5-field, incl. ranges, steps, names, the DOM/DOW union rule) and `Schedule.Next(t)`. Its runtime scheduler is never used — the stateless evaluator remains the only clock. Times evaluate in the daemon's local time (`Next` in the anchor's location; no per-entry TZ field this wave).

### 2. Schema (`internal/cron/schema.go`)

- `Schedule` gains `CatchUp string \`yaml:"catch_up,omitempty"\`` — closed set `{"", "once"}` (`CatchUpOnce` constant). Kind-coupled like `interval`/`min`/`max`/`expr`.
- `validate()` for `ScheduleCron` now requires `Expr` to parse via `ParseStandard` (today it's "recognized, unevaluated — schema-valid" with no expr check), and rejects `catch_up` on non-cron kinds and any value other than `once`. Back-compat: a previously stored expression that doesn't parse becomes a per-entry `entry-invalid` diagnostic on tolerant load (the entry never fired anyway) and a hard error on the strict mutation-read path.
- `Fire` (`evaluate.go`) gains `DueAt time.Time` — the scheduled time the fire came due (`every`: anchor+interval; `backoff`: ladder next-fire; `cron`: the occurrence; `wake` and catch-up late fires: `now`). Input to the deliverer's hold bound.

### 3. Cron-kind evaluation (`internal/cron/` — new `cronexpr.go` or extension of `schedule.go`)

Pure due math, table-tested hard (the C1 posture). Anchor = the entry's newest own delivery-log line, else `created_by.at` (the `everyAnchor` rule — every logged disposition advances it):

- **Due (on-time)**: an occurrence `O` exists in `(anchor, now]` with `now − O ≤ window`, where `window` = `DefaultCronGrace` (2m — covers tick jitter and short daemon restarts; the ticker runs every 30s) for `deliver: immediate` entries, extended to `DefaultHoldWindow` (2h, § 5) for `deliver: when-idle` entries — a hold must be able to outlive the grace or every held cron fire would expire at 2m. The fire carries `DueAt = O`, `Reason: schedule`.
- **Missed (default `catch_up` absent)**: `O` exists in `(anchor, now]` but `now − O > window` ⇒ no fire; the tick appends **one `missed` log line** for the entry (a new outcome class). Logging (rather than a repeating diagnostic alone) advances the anchor — one line per gap, not per tick, bounding the next-occurrence walk — and gives the Activity feed visible "missed" history. Only the *latest* stale occurrence logs; intermediate occurrences in a long gap are implicitly skipped. Missed emission follows the same muted → due math → guard gating as fires (a guard that holds suppresses the missed line silently, like any fire) and is logged regardless of target resolution (schedule history, not delivery — no `if_absent` disposition).
- **`catch_up: once`**: the latest occurrence in `(anchor, now]` stays due with **no lateness bound** — at most one late fire per gap (delivery logs and advances the anchor past it). A catch-up late fire carries `DueAt = now`, deliberately opting it out of the hold bound (§ 5) — an entry that opted into unbounded lateness is not then dropped for being late.
- Occurrence math via `Next()` walks bounded by the window / the anchor — never an unbounded scan (the `missed` log line is what keeps the anchor near now).
- `Evaluate`'s `ScheduleCron` case replaces the `schedule-kind-unsupported` diagnostic with this math; `EvalResult` gains the missed-occurrence surface (e.g. `Missed []Fire`) for the tick orchestrator to log.

### 4. Read-side derivation (`internal/cron/derive.go`)

`DeriveEntry` cron-kind case: `NextFire = sched.Next(now)`, `HasNextFire = true` (the `now` parameter becomes real). `Rung` stays 0. `GET /api/cron` then reports real next-fires for cron entries with zero handler changes — the sidebar CLOCK rows and the mobile Activity feed's upcoming block pick them up through their existing absent-`nextFire` fallbacks.

### 5. `when-idle` hold bound (`internal/cron/deliver.go`)

`EngineDeliverer.Deliver`, when-idle branch, busy pane (`active | waiting`):

- `now − fire.DueAt ≤ DefaultHoldWindow` (named constant, **2h**) ⇒ `held-busy` with `Held: true` — unchanged cross-tick retry.
- past the window ⇒ **`held-expired`** outcome, `Held: false` — **logged**, advancing the anchor: the fire is dropped, the next due period fires normally. Applies to every schedule kind (an `every` fire held past 2h expires the same way).

Neither `held-expired` nor `missed` counts toward the per-target rate cap (`countsTowardRate` — nothing landed in a pane); both advance anchors like any logged disposition. This resolves spec open question 2 as **drop-with-visible-history**.

### 6. CLI (`cmd/rk/cron_add.go`)

- Remove the stderr "expression evaluation is not implemented yet" note and the matching help-text caveat; `--cron` expressions are now validated at parse/add time (a bad expression is an immediate usage-class error via `cron.Add`'s validate).
- New `--catch-up once` flag — usage error without `--cron` or with any value other than `once`.
- `rk cron list`'s schedule summary keeps rendering the expression; no other verb changes. Toolkit help-dump conformance re-checked for the changed `add` help.

### 7. HTTP API (`api/cron.go`)

`POST /api/cron/create` accepts `catchUp` in the schedule body (camelCase wire form), mapped to `Schedule.CatchUp` and validated by `cron.Add` (bad value ⇒ 400, the existing contract). `GET /api/cron` needs no shape change — cron entries simply start carrying `nextFire`, and `deliveries` lines start including the new outcome strings.

### 8. Frontend (`app/frontend/src/lib/cron-schedule.ts`)

`describeSchedule` cron-kind case: drop the "not yet evaluated" note (stale once the evaluator fires these) — render the raw expression alone; update its unit test. No other frontend change: upcoming rows, detail sheet, and outcome rendering all pass strings/timestamps through.

### 9. Spec + docs

- `docs/specs/cron.md`: record open question 2's resolution in place (the OQ3/C4 precedent — decision + rationale inline in § Open Questions), state the hold bound in § Delivery step 2, and note `catch_up`'s landed semantics in § Schedules.
- `docs/memory/run-kit/cron.md` + `docs/memory/run-kit/ui/cron-activity.md` updated at hydrate (below).

## Affected Memory

- `run-kit/cron`: (modify) cron-kind evaluation (due window, missed, catch_up: once), the `held-expired` hold bound resolving OQ2, new outcome classes + rate-cap exclusion, schema `catch_up` field, `--catch-up` flag, add-time expr validation, DeriveEntry cron next-fire, robfig/cron/v3 dependency posture
- `run-kit/ui/cron-activity`: (modify) `describeSchedule` cron-kind sentence loses the "not yet evaluated" note; upcoming rows now include cron entries with real next-fires

## Impact

- **Code**: `app/backend/internal/cron/` (schema, evaluate, derive, deliver, tick, log outcome classes, new cron due math + tests), `app/backend/cmd/rk/cron_add.go`, `app/backend/api/cron.go`, `app/backend/go.mod` (+`robfig/cron/v3`), `app/frontend/src/lib/cron-schedule.ts` (+ test).
- **Behavior contracts**: `rk cron add --cron` stops printing the unimplemented note and starts rejecting bad expressions; cron entries begin firing (anyone who stored one as inert intent now gets deliveries — the muted flag is the off switch); `when-idle` holds stop being indefinite (2h drop); two new delivery-log outcome strings (`missed`, `held-expired`) appear in `GET /api/cron` deliveries and the Activity feed.
- **Constitution**: II holds — no new state files; every new fact derives from (entry file, delivery log, now). I holds — no new subprocess surface. Size: S (per the plan), single-package-centric with thin CLI/API/frontend edges.
- **Tests**: table-driven Go tests for cron due math (on-time/missed/catch-up/window-extension), validate() expr + catch_up gating, deliverer hold-expiry, DeriveEntry next-fire; CLI flag tests; one Vitest update for `describeSchedule`.

## Open Questions

*(none — both intake-blocking decisions were asked and resolved; see Assumptions rows 1–2)*

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | `when-idle` hold bound: drop after `DefaultHoldWindow` (2h) with a logged `held-expired` outcome; never force-deliver into a busy pane | Asked — user chose drop-after-2h over no-bound and force-deliver; resolves spec OQ2 | S:95 R:75 A:90 D:95 |
| 2 | Certain | Expression math via `robfig/cron/v3` (`ParseStandard` + `Next` only, never its scheduler) | Asked — user chose the dependency over an in-house parser; DOM/DOW union semantics are battle-tested there | S:95 R:70 A:90 D:95 |
| 3 | Confident | `catch_up` lives on `Schedule` as a string enum (`once`), valid only with kind `cron` | Spec names `catch_up: once` per-entry and scopes catch-up to wall-clock fires; kind-coupled schedule params (interval/min/max/expr) are the placement precedent | S:70 R:80 A:75 D:70 |
| 4 | Confident | On-time window `DefaultCronGrace` = 2m, extended to the 2h hold window for `when-idle` entries | Spec says "never fire late" with no number; 2m covers 30s-tick jitter + short restarts; without the when-idle extension every held cron fire would expire at 2m, making when-idle+cron useless | S:40 R:90 A:65 D:45 |
| 5 | Confident | Expressions evaluate in the daemon's local time; no per-entry TZ field this wave | ParseStandard's default; a TZ field is speculative surface with no consumer (Constitution IV posture) | S:55 R:70 A:75 D:70 |
| 6 | Confident | A stale occurrence logs one `missed` outcome line (after muted/guard gating, regardless of target resolution), advancing the anchor | One line per gap not per tick; bounds the occurrence walk; visible Activity-feed history vs an invisible repeating diagnostic | S:45 R:75 A:70 D:55 |
| 7 | Confident | `validate()` now parses `Expr`; a stored non-parsing expression degrades to `entry-invalid` on tolerant load | The tolerant-load class already handles exactly this; such entries never fired, so nothing regresses | S:60 R:80 A:85 D:75 |
| 8 | Confident | `missed` and `held-expired` are excluded from `countsTowardRate`; both advance anchors like any logged disposition | The rate cap guards pane deliveries — neither outcome lands anything in a pane; anchor advancement is the every-logged-disposition rule | S:50 R:80 A:75 D:70 |
| 9 | Confident | Catch-up late fires carry `DueAt = now`, opting out of the hold bound | An entry that opted into unbounded lateness must not be dropped for being late; keeps DueAt derivation stateless | S:45 R:75 A:65 D:55 |
| 10 | Confident | CLI `--catch-up once` (usage error without `--cron`), API `catchUp` on create, stderr unimplemented-note removed, frontend "not yet evaluated" note removed | Direct consequences of the schema/evaluation landing; existing flag-validation and wire-shape patterns apply | S:65 R:85 A:80 D:75 |

10 assumptions (2 certain, 8 confident, 0 tentative, 0 unresolved).
