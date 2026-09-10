# Plan: Cron idle reminders — `--idle-every` sugar, `skip-if-busy` delivery, and `rk cron edit`

**Change**: 260910-9aup-cron-idle-every-skip-if-busy
**Intake**: `intake.md`

<!--
  Co-generated at apply entry by /fab-fff, regenerated after the intake's
  second clarify session (user overrides on #14/#16/#27) and the post-rebase
  surface sweep (#28). Requirements derive from intake.md § What Changes A–I
  and the resolved Assumptions table (28 rows, all Certain/Confident). Tasks
  and acceptance items trace back with <!-- R# --> annotations. The
  ## Acceptance section is review-owned; apply ignores it.
-->

## Requirements

### CLI: `rk cron add --idle-every`

#### R1: `--idle-every <dur>` is a fourth, mutually exclusive schedule flag that expands to a flat backoff ladder
`rk cron add` MUST accept `--idle-every <dur>` (Go duration) as a schedule flag alongside `--every` / `--backoff` / `--cron`. Exactly one of the four MUST be set; the usage error becomes `exactly one schedule flag is required: --every, --idle-every, --backoff, or --cron`. `--idle-every d` MUST produce `cron.Schedule{Kind: backoff, Min: d, Max: d}` — no schema change, no evaluator change; the entry file reads `schedule: {kind: backoff, min: d, max: d}`. A non-positive value MUST fail with `--idle-every must be a positive duration, got %s`. `--min`/`--max` alongside `--idle-every` MUST fail with the existing `--min/--max only apply with --backoff`; `--catch-up` alongside it MUST fail with the existing `--catch-up only applies with --cron`. All are `usageError` (exit 2, state dir untouched). Renderers are NOT changed: `cronScheduleSummary` keeps `backoff 3m→3m` and the frontend `describeSchedule` keeps its sentence (the sugar is input-side only).

- **GIVEN** a pane caller, **WHEN** `rk cron add "wake up" --idle-every 3m`, **THEN** the stored entry has `schedule.kind == backoff`, `min == max == 3m`, **AND** the success line reads `… [backoff 3m→3m -> …]`.
- **GIVEN** `--idle-every 3m --every 1h`, **THEN** exit 2 with the exactly-one error naming all four flags.
- **GIVEN** `--idle-every 3m --min 1m`, **THEN** exit 2 with `--min/--max only apply with --backoff`.
- **GIVEN** `--idle-every 0s`, **THEN** exit 2 with the positive-duration error.

#### R2: Help text names the new flag and the deliver contrast, and drops the stale "delivery wave" clause
The `add` command's `Use` MUST read `add <prompt> --every <dur> | --idle-every <dur> | --backoff | --cron "<expr>"`. The `--idle-every` flag usage MUST describe the flat ladder ("Fire every <dur> of agent quiet: <dur> after the target pane last went idle for a reason other than the clock, then every <dur> while it stays idle (a flat backoff ladder, min = max)"). The `Long` MUST gain an `--idle-every` sentence beside `--backoff` stating the contrast with `--every` (the count restarts on genuine activity; the clock's own deliveries never restart it), MUST replace the stale clause "validated now but enforced by the delivery wave" with "--deliver (immediate | when-idle | skip-if-busy) and --if-absent are validated at add time and enforced at fire time", and the `Example` MUST include `rk cron add "wake up" --idle-every 3m` and `rk cron add "morning digest" --cron "0 9 * * *" --deliver skip-if-busy`. The parent `cron` command's `Long` MUST list `--idle-every` among the schedule flags.

- **GIVEN** `rk cron add --help`, **THEN** the flag usage mentions idle/quiet, the Long does not contain "delivery wave", and both new examples appear.

### Delivery: the `skip-if-busy` policy

#### R3: The `deliver` closed set gains `skip-if-busy` and is enforced by schema validation
`schema.go` MUST define `DeliverSkipIfBusy = "skip-if-busy"` beside `DeliverImmediate` / `DeliverWhenIdle`, with the block comment describing all three policies as enforced by the deliverer. `Entry.validate()` MUST accept `deliver ∈ {"", immediate, when-idle, skip-if-busy}` and reject anything else with `unknown deliver value %q`. `if_absent` validation is unchanged. The CLI's `--deliver` enum (`cronAddValidateEnum`) MUST include `skip-if-busy`. `POST /api/cron/create` MUST return 400 for an unknown `deliver` (through the existing validate-error path; touch the handler only if that mapping is absent).

- **GIVEN** `deliver: bogus`, **WHEN** validated, **THEN** an error containing `unknown deliver value "bogus"`; **GIVEN** each accepted value, **THEN** no error.
- **GIVEN** `POST /api/cron/create` with `"deliver":"bogus"`, **THEN** HTTP 400.

#### R4: The deliverer drops a busy-pane fire under `skip-if-busy` with a logged, non-held outcome
`EngineDeliverer.Deliver` MUST, for `Deliver == DeliverSkipIfBusy`, read the target's agent state once and: on `active` or `waiting` return `Outcome{Status: "skipped-busy", Detail: state, Held: false}` with zero sends; on `idle` or unknown (`""`) deliver normally; on a state-read error return `Outcome{Status: "failed", Detail: "agent-state read: " + err}` exactly as `when-idle` does. No hold bound applies — `DefaultHoldWindow` is never consulted for this policy. The doc comment MUST describe the three policies side by side.

- **GIVEN** a `skip-if-busy` fire and pane state `active`, **THEN** outcome `skipped-busy`, `Held == false`, zero sends.
- **GIVEN** pane state `idle` (or `""`), **THEN** outcome `delivered` with one send.
- **GIVEN** `d.now` advanced past `DefaultHoldWindow` and state `active`, **THEN** still `skipped-busy`.

#### R5: The logged skip advances the anchor and is exempt from the rate cap
Because `skipped-busy` is non-held, the tick MUST append it to the delivery log (existing loop, no control-flow change) so `everyAnchor`/`LastDelivery` make the skip the entry's newest own line: the next attempt lands one full interval later, never on the next 30 s poll. `countsTowardRate("skipped-busy: …")` MUST be `false` (doc comment lists it and `rescheduled` among non-counting outcomes; tests pin both). The `Outcome.Held` comment MUST name `skipped-busy` as the deliberate counter-example. `cronScheduleDue` MUST keep the `DefaultCronGrace` window for `skip-if-busy` (only `when-idle` extends to `DefaultHoldWindow`), with the comment naming the third value. No outcome filtering is added to `LastDelivery` / `OwnDeliveries`.

- **GIVEN** an `every 5m` entry and a scripted deliverer returning `skipped-busy` then `delivered`, **WHEN** ticks run at T+5m, T+5m30s, T+10m, **THEN** T+5m appends exactly one `skipped-busy: active` line (`Fires == 1`, no `delivery-held` diagnostic), T+5m30s appends nothing, T+10m delivers.
- **GIVEN** the rate-cap classification test, **WHEN** given `skipped-busy: active` or `rescheduled`, **THEN** not counted.

### Edit: store, log semantics, CLI verb, HTTP route

#### R6: `cron.Update` merges and validates without touching identity fields
`store.go` MUST gain `Update(dir, slug, id string, apply func(*Entry)) (Entry, bool, error)` beside `setFlag`: `loadForMutate` → locate the entry (absent ⇒ `(Entry{}, false, nil)`) → `apply` on a copy → `validate()` and `ValidateRespawnIntent` on the merged entry (a failure returns the error and writes nothing) → `saveEntries` (atomic). `Update` never touches `ID`, `Target`, `CreatedBy`, `Muted`, `MutedUntil`, `Pinned`; a store test pins that they survive byte-for-byte after reload.

- **GIVEN** an `apply` that sets `Schedule` and `Deliver`, **WHEN** reloaded, **THEN** `ID`, `Name`, `Target`, `Payload`, `IfAbsent`, `Respawn`, `Pinned`, `Muted`, `MutedUntil`, `CreatedBy` are identical.
- **GIVEN** a merge with `Max < Min`, **THEN** an error and an unchanged file. **GIVEN** a corrupt file, **THEN** `refusing to mutate`.

#### R7: One shared `cron.Edit` helper owns the flock, the update, and the `rescheduled` append
`internal/cron` MUST expose `Edit(dir, slug, id string, now time.Time, apply func(*Entry)) (Entry, bool, error)` (in `store.go` or a sibling file) used by BOTH the CLI verb and the HTTP handler so they cannot drift. It MUST: acquire the tick flock (`acquireLock(LockPath(dir))`, non-blocking, retried every 100 ms for up to 2 s; persistent contention returns a sentinel error the callers render as `cron tick in progress — retry`) → snapshot the stored `Schedule`/`Deliver` → `Update` → when the merged `Schedule` or `Deliver` differs from the snapshot, append `LogLine{TS: now, Entry: id, Reason: "edit", Outcome: "rescheduled"}` (no `Target`) via `AppendLog` to `<slug>.log` → release. Name-, `if_absent`-, `respawn`-only edits and no-op edits (merged schedule and deliver equal the stored values) MUST append nothing. `add`/`rm`/`mute`/`pin` stay lock-free.

- **GIVEN** an `apply` that changes only `Deliver`, **THEN** exactly one `rescheduled` line with `Reason: edit` and no target.
- **GIVEN** an `apply` that changes only `Name`, or re-sets the identical schedule, **THEN** no log line.
- **GIVEN** the flock held by another process for > 2 s, **THEN** the contention error and no write.

#### R8: `rescheduled` resets `every`/`cron`, bounds the backoff streak, and is neutral to orphan GC and the rate cap
`LastDelivery` MUST stay outcome-agnostic so `everyAnchor` (and the `cron` occurrence anchor) becomes the edit time. `log.go` MUST gain `ScheduleHistory(log, id)` = the entry's own lines strictly newer than its newest `rescheduled` line (boundary excluded; with no boundary, identical to `OwnDeliveries`), and both `JoinAnchor` call sites (`evaluate.go`, `derive.go`) MUST read `ScheduleHistory` instead of `OwnDeliveries`, so a ladder restarts from the target's raw idle epoch after an edit. `OrphanedSince` MUST skip `rescheduled` lines (never start an absent run from one; never fall back to `created_by.at` because of one). `countsTowardRate("rescheduled")` MUST be `false`. The wake cursor is untouched. `OwnDeliveries` itself is NOT filtered.

- **GIVEN** an `every 30m` entry delivered at T and `rescheduled` at T+20m with interval now 3m, **WHEN** ticks run at T+20m30s and T+23m, **THEN** no fire, then a fire with `DueAt == T+23m`.
- **GIVEN** deliveries at T+1m, T+3m, T+7m, `rescheduled` at T+8m, raw epoch T+2m, `min = max = 3m`, **WHEN** `JoinAnchor(epoch, ScheduleHistory(...))`, **THEN** `Ladder{Anchor: T+2m, Rung: 0}` and next fire T+5m (due at T+8m).
- **GIVEN** own lines `[delivered, rescheduled]`, **WHEN** `OrphanedSince`, **THEN** 0; **GIVEN** `[skipped-absent@T1, rescheduled@T2]`, **THEN** T1; **GIVEN** `[rescheduled]` alone, **THEN** 0, never `created_by.at`.

#### R9: `rk cron edit <id>` replaces the fields given and keeps the rest
A new verb `edit <id> [--every <dur> | --idle-every <dur> | --backoff [--min] [--max] | --cron "<expr>" [--catch-up once]] [--deliver <policy>] [--name <n>] [--if-absent <policy>] [--respawn <arg>…]` MUST exist in `cmd/rk/cron_edit.go`, registered via `cronCmd.AddCommand` and listed in the parent `Short`/`Long`. Each flag given replaces that field; omitted fields keep their values. A bare `edit <id>` MUST fail with usage error `nothing to edit — pass a schedule flag, --deliver, --name, --if-absent, or --respawn`. Schedule flags MUST go through the same parser `add` uses (extracted from `cronAddSchedule` into a shared helper over a struct of flag values, returning `(schedule, set, err)`), so the four-way exclusion, the `--min/--max` and `--catch-up` gates, the positive-duration checks, and the `--idle-every` expansion are written once; zero schedule flags on `edit` means "keep the schedule"; `--min`/`--max` without `--backoff` is the existing usage error even if the stored schedule is a backoff. `--deliver` and `--if-absent` MUST be validated with `cronAddValidateEnum`. `--respawn` replaces the whole argv; `--if-absent` set to a non-`respawn` value MUST clear `respawn`; `ValidateRespawnIntent` failures on the merged entry are usage errors. Target and creator are immutable: `--role`/`--session`/`--pane` MUST NOT be accepted (exit 2 — cobra's unknown-flag error on the usage-error path, or hidden flags rejected with `target is immutable — rm + add to retarget` if that exit code does not hold); mute/pin flags are not accepted; the help MUST state the immutability rule. The verb MUST call `cron.Edit` (R7). Output: one stdout data line `edited <id> <name> [<schedule summary> -> <target summary>]` via `cronScheduleSummary`/`cronTargetSummary`; the `rescheduled` append is not announced. Unknown id ⇒ `no entry <id>` on stderr, exit 1; flock contention ⇒ `cron tick in progress — retry`, exit 1. `README.md`'s `rk cron` row MUST read `add, edit, list, rm, mute, pin, tick`.

- **GIVEN** an `every 1h` entry, **WHEN** `edit <id> --idle-every 3m`, **THEN** the stored schedule is `{backoff, 3m, 3m}`, everything else is unchanged, one `rescheduled` line exists, and `edited … [backoff 3m→3m -> …]` is printed.
- **GIVEN** `edit <id>` with no flags, **THEN** exit 2 with the nothing-to-edit error.
- **GIVEN** `edit <id> --role operator`, **THEN** exit 2. **GIVEN** an unknown id, **THEN** `no entry <id>`, exit 1.
- **GIVEN** `edit <id> --if-absent skip` on an entry with a respawn argv, **THEN** `respawn` is cleared.

#### R10: `POST /api/cron/edit` is the route parity of the verb
`api/cron.go` MUST add `handleCronEdit`, registered in `router.go` beside `create|delete|mute|pin` as `r.Post("/api/cron/edit", …)`. Body `{id, schedule?, deliver?, name?, ifAbsent?, respawn?}` in camelCase with the `cronCreateBody` field shapes (`schedule.{kind,interval,min,max,expr,catchUp}` as strings), present-keys-set partial-merge semantics (Constitution IX): absent keys keep their values; `schedule` present replaces the whole schedule; `respawn: []` clears the argv; `ifAbsent` set to a non-`respawn` value clears `respawn`. `target`, `createdBy`, `muted`, `pinned` keys MUST be rejected with 400 (`target is immutable` / `use /api/cron/mute|pin`). Flow: decode → build the `apply` closure → `cron.Edit` (R7) → 404 `cron entry not found` on unknown id, 400 with the validation error text, 500 on store errors → `s.sseHub.wake(server)` → 200 with the updated entry in the `create` response shape. No frontend client helper is added in this change. The spec's § API & CLI row MUST record the route.

- **GIVEN** `{id, deliver: "skip-if-busy"}`, **THEN** 200, the schedule is intact, one `rescheduled` line, SSE wake called, body is the updated entry.
- **GIVEN** `{id, schedule: {kind: "every", interval: "3m"}}` on a backoff entry, **THEN** the schedule is replaced and `rescheduled` appended.
- **GIVEN** an unknown id, **THEN** 404. **GIVEN** a `target` key, bad `deliver`, or `max < min`, **THEN** 400 and no write.

### Web UI: show and set `deliver`

#### R11: One helper phrases the policy; the create dialog sets it
`src/lib/cron-schedule.ts` MUST add `describeDeliver(deliver?: string): string` beside `describeSchedule`: `""`/`undefined`/`immediate` → "delivered immediately"; `when-idle` → "held until the agent is idle (up to 2h)"; `skip-if-busy` → "skipped when the agent is busy"; any other string → the raw value. `components/cron-create-dialog.tsx` MUST add a second toggle group below the schedule-kind segment, `role="group" aria-label="Delivery"`, three `controlClass({variant: "toggle"})` buttons in the `kindButton` shape — **Immediate** (default) / **When idle** / **Skip if busy** — with local `type Deliver = "immediate" | "when-idle" | "skip-if-busy"` state, sent as `deliver` on the existing `CronCreateBody.deliver?: string`. The kind segment and the fixed `role: operator` target are unchanged; no `--idle-every` control is added (Backoff with min = max already expresses it).

- **GIVEN** the dialog, **WHEN** submitted with defaults, **THEN** the body carries `deliver: "immediate"`; **WHEN** "Skip if busy" is pressed first, **THEN** `deliver: "skip-if-busy"` and `aria-pressed` reflects the choice.
- **GIVEN** `describeDeliver("skip-if-busy")`, **THEN** "skipped when the agent is busy"; **GIVEN** `describeDeliver("weird")`, **THEN** "weird".

#### R12: Glance surfaces show a non-`immediate` policy; the detail sheet shows the sentence
`components/sidebar/clock-panel.tsx` MUST render a deliver chip in the row's existing `badge` idiom (`shrink-0 text-[10px] uppercase text-text-secondary`, `data-testid="clock-row-deliver"`) after the target chip, ONLY when `entry.deliver` is set and not `immediate`, text = the raw value. `components/server-clock-dashboard/crons-zone.tsx` MUST render the same marker inside the schedule cell after `describeSchedule(entry)` (`ml-1 text-[10px] uppercase text-text-secondary`, `data-testid="crons-row-deliver"`), same visibility rule, no new column. `components/cron-entry-detail-sheet.tsx` MUST add one fact row in the existing `rowClass` list between "Next fire" and the Mute switch: label `Deliver`, value `describeDeliver(entry.deliver)`, `data-testid="cron-entry-deliver"`. `components/server-clock-dashboard/model.ts` `describeOutcome` MUST label an outcome starting with `skipped-busy` as `skipped (busy)` with `error: false`; `rescheduled` passes through verbatim by the default branch. `cronStateLabel` and the Activity feed are unchanged.

- **GIVEN** an entry with `deliver: "immediate"` or absent, **THEN** no `clock-row-deliver` and no `crons-row-deliver` node; **GIVEN** `skip-if-busy`, **THEN** both read `skip-if-busy`.
- **GIVEN** the detail sheet for a `when-idle` entry, **THEN** the `Deliver` row reads "held until the agent is idle (up to 2h)".
- **GIVEN** `describeOutcome("skipped-busy: active")`, **THEN** `{label: "skipped (busy)", error: false}`; **GIVEN** `"rescheduled"`, **THEN** `{label: "rescheduled", error: false}`.

### Docs: spec and explainer

#### R13: `docs/specs/cron.md` records the additions
The spec MUST: (a) § Cron State example comment read `# immediate | when-idle | skip-if-busy` and the file-changes sentence gain `edit`; (b) § Schedules `backoff` row note that `min = max` collapses the ladder to a flat "every `min` of quiet" reminder (`--idle-every`); (c) add a short **Flat ladder = idle reminder** paragraph after the anchor-join paragraph carrying the two-clocks contrast table from intake § Why and naming `--idle-every` as sugar writing `{kind: backoff, min: d, max: d}`; (d) § Delivery step 2 become the three-policy rule; (e) § Delivery step 4 name `rescheduled` beside `missed` as schedule history with the backoff-boundary and orphan-neutral rules; (f) § API & CLI gain `--idle-every 3m`, `--deliver when-idle|skip-if-busy`, the `rk cron edit` line ("target and creator immutable; a schedule or deliver change logs `rescheduled`"), and `POST /api/cron/edit` (partial merge, immutable target, shared `cron.Edit`); (g) § UI tier-2 (b) gain one sentence: the CLOCK row and the CRONS row carry a `deliver` marker when the policy is not `immediate`, the detail sheet shows a `Deliver` row, and the create dialog's Delivery group sets it.

- **GIVEN** the spec, **THEN** (a)–(g) are present and consistent with the code.

#### R14: The animated explainer shows the flat ladder and the deliver axis
`docs/site/cron-schedule-kinds.md` MUST, preserving its conventions (Markdown wrapper around `<div class="rk-cron-clocks not-content">`, inline HTML/CSS/JS, styles scoped under `.rk-cron-clocks`, container queries, `prefers-reduced-motion`, every panel loads finished with Play/Restart, `data-toggle` rule buttons via the shared `Sim` engine, absolute links, and **no `](` byte sequence anywhere in the inline script**): (1) add a backoff-panel toggle `data-toggle="flat"` labelled "flat: min = max (idle reminder)" that makes the gap constant (3 sim-minutes) while keeping the attribution-window continuation and the poke reset, swaps the panel's `.add` line to `rk cron add "wake up" --idle-every 3m` while on, and adds one rule bullet; (2) add a summary-table row after `backoff` — `backoff, min = max` (`--idle-every`) · "X after the last genuine idle moment, then every X while it stays quiet" · "reminders that wait for quiet" — plus one sentence contrasting it with `every X --deliver skip-if-busy`; (3) add `section.panel#p-deliver` after `wake_on` and before "Put together": heading "deliver <small>what happens when the agent is busy at fire time</small>", `.add` line `rk cron add "check PRs" --every 5m --deliver skip-if-busy`, one `Sim` over ~30 sim-minutes of an `every 5m` entry with an agent-state strip (busy 7–18 min) and three lanes — immediate (fires at every boundary, the two inside the busy block labelled "into a busy pane"), when-idle (the 10 m fire held, delivered at 18 m, rhythm continues from 18 m), skip-if-busy (10 m and 15 m drawn hollow "skipped · busy", grid unchanged, next at 20 m) — a `data-toggle="busy"` ("agent busy 7–18 min", default on) under which the lanes coincide when off, a readout `t · immediate N · when-idle N (held M) · skip-if-busy N (skipped K)`, three rule bullets, and legend entries for hollow "skipped (busy)" and "held"; (4) one header-paragraph sentence that a `deliver` policy says what to do if the agent is busy at that moment. `docs/specs/index.md`'s Wiki row for the page MUST mention the flat toggle and the deliver panel.

- **GIVEN** the page in a browser, **THEN** the flat toggle, the new summary row, and the deliver panel with three lanes and its toggle render; `grep -c '](' ` over the inline `<script>` is 0.

### Non-Goals

- No new schedule kind, no schema field, no change to schedule math. The only evaluator-side edits are the `ScheduleHistory` boundary at the two `JoinAnchor` call sites and `OrphanedSince`'s neutrality.
- Renderers unchanged for flat ladders: `cronScheduleSummary` stays `backoff 3m→3m`, `describeSchedule` keeps its sentence (Assumptions #14).
- `edit` never retargets, mutes/pins, or rewrites `created_by`; no batch edit; no `--idle-every` refinement knobs; no `rk operator` seed change.
- Frontend scope is exactly R11–R12: no `editCron` client helper, no edit UI, no Activity-feed `describeOutcome` adoption, no `--idle-every` dialog control. No Playwright addition (three leaf renders covered by unit tests — recorded, not skipped silently).
- No `hold: <dur>` knob on `when-idle`; no fired-vs-anchor display split (`LAST-FIRED`/`lastFired` show the `rescheduled` time until the next outcome, as `missed` already does).

### Design Decisions

#### Idle reminder is a flat backoff, not a schedule kind
**Decision**: "Ping every X of quiet" is `{kind: backoff, min: X, max: X}`.
**Why**: `gapAfter` returns `max` on every rung when `min == max`; the anchor is the pane's idle epoch and the anchor-join rule keeps the clock's own pings from restarting the count — the wanted semantics, already shipped and tested.
**Rejected**: a fourth schedule kind (duplicates the anchor-join machinery); a skip-when-busy `every` variant (a delivery concern on the schedule axis).
*Introduced by*: 260910-9aup-cron-idle-every-skip-if-busy

#### `--idle-every` is input-side CLI sugar over the unchanged schema
**Decision**: The flag expands in the CLI parser to a flat backoff; renderers keep showing the on-disk truth (`backoff 3m→3m`).
**Why**: Discoverability was the gap; sugar keeps the format and evaluator untouched, and displaying the stored schedule keeps `list`/UI honest about what the file says.
**Rejected**: a `kind: idle-every` on disk (a second spelling the evaluator must normalize); round-trip rendering (`idle-every 3m`) — deferred as a display-only follow-up.
*Introduced by*: 260910-9aup-cron-idle-every-skip-if-busy

#### `skip-if-busy` is a logged, non-held outcome on the deliver axis
**Decision**: A third `deliver` value checks agent state once at due time and drops a busy-pane fire with `Outcome{Status: "skipped-busy", Held: false}`, which the tick logs; rate-cap-exempt; ordinary `DefaultCronGrace` window.
**Why**: Logging is the mechanism — the newest own log line is the anchor for every kind, so a logged skip moves the next attempt to the next period; an unlogged skip would re-fire on the next poll and degenerate into `when-idle`.
**Rejected**: `hold: 0` on `when-idle` — a sentinel is less readable and yields no distinct log outcome.
*Introduced by*: 260910-9aup-cron-idle-every-skip-if-busy

#### `edit` logs `rescheduled` as the anchor reset point, through one shared helper
**Decision**: `cron.Edit` holds the tick flock, runs `Update`, and appends one `rescheduled` line (`Reason: edit`) when schedule or deliver changed; both the CLI verb and `POST /api/cron/edit` call it.
**Why**: Every kind anchors on the entry's newest own log line, so an edited entry would otherwise be judged against history produced under the old schedule; the lock orders the reset relative to a concurrent tick; a single helper keeps the two surfaces from drifting.
**Rejected**: mutating the delivery log or rewriting `created_by.at`; duplicating the choreography in the handler.
*Introduced by*: 260910-9aup-cron-idle-every-skip-if-busy

#### `rescheduled` is a backoff streak boundary and orphan-neutral
**Decision**: `JoinAnchor` reads `ScheduleHistory` (own lines newer than the newest `rescheduled`); `LastDelivery` is unchanged; `OrphanedSince` skips `rescheduled` lines.
**Why**: The ladder walk is outcome-agnostic and would ingest pre-edit deliveries as rungs; `LastDelivery` must still see the line so `every`/`cron` anchor on the edit; a cut view fed to `OrphanedSince` would fall back to `created_by.at` and could expire an old edited entry on its first unresolved tick.
**Rejected**: filtering `OwnDeliveries` itself.
*Introduced by*: 260910-9aup-cron-idle-every-skip-if-busy

#### Target and creator are immutable under `edit`; the route lands on a declared UI consumer
**Decision**: `edit` (verb and route) accepts no target/creator/mute/pin keys; `POST /api/cron/edit` ships now, amending the "pin route waited for a consumer" decision in place — the consumer is the run-kit UI's future edit surface, declared rather than shipped.
**Why**: A retarget is a different entry (the history belongs to the old target). The UI is the declared consumer of in-place editing, and shipping the route with the verb keeps the two surfaces on one helper from day one.
**Rejected**: CLI-only (the auto-clarify default) — overridden by the user; an `editCron` client helper with no caller (dead code until the UI lands).
*Introduced by*: 260910-9aup-cron-idle-every-skip-if-busy

## Tasks

### Phase 1: Setup

- [x] T001 Extract the schedule-flag parser in `app/backend/cmd/rk/cron_add.go`: a `cronScheduleFlags` struct (every, idleEvery, min, max, cronExpr, catchUp values + the `Changed` booleans) and `cronScheduleFromFlags(cmd *cobra.Command, f cronScheduleFlags) (cron.Schedule, bool, error)` returning `(schedule, set, err)`; keep `cronAddSchedule` as a thin wrapper that requires `set`. Add `--idle-every` to the four-way exclusion (error names all four), the positive-duration check, and the `{backoff, d, d}` expansion. Existing `cron_add_test.go` stays green. <!-- R1, R9 -->
- [x] T002 [P] Add `DeliverSkipIfBusy` to `app/backend/internal/cron/schema.go`, rewrite the deliver block comment for three enforced policies, and add the `deliver` closed-set check to `Entry.validate()` (`""` allowed; `unknown deliver value %q`). Extend `schema_test.go` `TestEntryValidate`: `backoff min == max` accepted; `deliver: bogus` rejected; the three named values and `""` pass. <!-- R3 -->
- [x] T003 [P] Run `cd app/frontend && pnpm install --frozen-lockfile` (fresh worktree, no `node_modules`) so Vitest/tsc can run in later tasks. <!-- R11 -->

### Phase 2: Core Implementation

- [x] T004 Wire `--idle-every` on `rk cron add` in `app/backend/cmd/rk/cron_add.go`: `f.DurationVar(&cronAddIdleEvery, "idle-every", 0, <usage per R2>)`, `Use`/`Long`/`Example` updates (two new examples; replace the "delivery wave" clause), `cronAddValidateEnum("--deliver", …)` gaining `cron.DeliverSkipIfBusy`; add `--idle-every` to the parent `cron` `Long` in `cron.go`. Tests in `cron_add_test.go`: `TestCronAddIdleEvery` (stored `{backoff, 3m, 3m}`; success line shows `backoff 3m→3m`), `TestCronAddScheduleFlagMatrix` rows (`--idle-every 3m --every 1h`; `--idle-every 3m --min 1m`; `--idle-every 0s`; `--deliver skip-if-busy` accepted), `TestCronAddHelpText` (flag usage mentions quiet/idle; Long has no "delivery wave"; examples present). Add one `cron_list_test.go` fixture with `deliver: skip-if-busy` asserting the DELIVER column and `--json`. <!-- R1, R2, R3 -->
- [x] T005 [P] Implement `skip-if-busy` in `app/backend/internal/cron/deliver.go` `EngineDeliverer.Deliver` per R4 (state read once; `active|waiting` ⇒ `skipped-busy` non-held; idle/unknown deliver; read error ⇒ `failed: agent-state read: …`; three-policy doc comment). Tests in `deliver_test.go` `TestEngineDelivererSkipIfBusy`: active/waiting ⇒ skipped-busy, zero sends; idle and `""` ⇒ delivered, one send; `now` past `DefaultHoldWindow` still skipped-busy; read error ⇒ failed with prefix. <!-- R4 -->
- [x] T006 Tick/cron bookkeeping in `app/backend/internal/cron/tick.go` and `cronexpr.go`: `countsTowardRate` doc lists `skipped-busy` and `rescheduled` as non-counting; `Outcome.Held` comment names `skipped-busy` as the logged counter-example; `cronScheduleDue` comment names `skip-if-busy` at `DefaultCronGrace`. Tests in `tick_test.go`: `TestTickSkippedBusyAdvancesAnchor` (every 5m, scripted deliverer skipped-busy then delivered; T+5m one `skipped-busy: active` line, `Fires == 1`, no `delivery-held` diag; T+5m30s nothing; T+10m delivered); extend `TestTickRateCapOutcomeClasses` with `skipped-busy: active` and `rescheduled` ⇒ not counted. <!-- R5 -->
- [x] T007 [P] Add `Update(dir, slug, id string, apply func(*Entry)) (Entry, bool, error)` to `app/backend/internal/cron/store.go` beside `setFlag` per R6. Tests in `store_test.go` `TestUpdateMergesFields`: identity fields byte-identical after reload; `Max < Min` merge writes nothing; unknown id ⇒ `(_, false, nil)`; corrupt file ⇒ `refusing to mutate`. <!-- R6 -->
- [x] T008 [P] Add `ScheduleHistory(lines []LogLine, entryID string) []LogLine` to `app/backend/internal/cron/log.go` (own lines strictly newer than the newest `rescheduled` line; boundary excluded; no boundary ⇒ same as `OwnDeliveries`), document `OwnDeliveries` as the unfiltered view, and name the `rescheduled` outcome / `edit` reason as constants if the package names outcomes/reasons as constants (else documented literals beside `missed`). Test `log_test.go` `TestScheduleHistoryCutsAtReschedule`. <!-- R8 -->
- [x] T009 Add `Edit(dir, slug, id string, now time.Time, apply func(*Entry)) (Entry, bool, error)` to `app/backend/internal/cron/` per R7 (flock via `acquireLock(LockPath(dir))` retried every 100 ms ≤ 2 s with a named contention error; snapshot schedule/deliver; `Update`; conditional `AppendLog` of `{TS: now, Entry: id, Reason: "edit", Outcome: "rescheduled"}`). Tests in `store_test.go` (or `edit_test.go`): deliver-only change ⇒ one `rescheduled` line, no target; name-only and identical-schedule edits ⇒ no line; unknown id ⇒ `(_, false, nil)` and no line; contention (hold the lock in the test) ⇒ the named error and no write. Depends on T007, T008. <!-- R7 -->

### Phase 3: Integration & Edge Cases

- [x] T010 Switch both `JoinAnchor` call sites — `app/backend/internal/cron/evaluate.go` (~line 143) and `derive.go` (~line 62) — from `OwnDeliveries(log, e.ID)` to `ScheduleHistory(log, e.ID)`. Tests: `backoff_test.go` `TestGapAfterFlat`, `TestAnchorJoinFlatLadder` (`min = max = 3m`; own lines T+3m, T+6m, T+9m; epoch T+9m+5s ⇒ `Ladder{Anchor: T, Rung: 3}`, `NextFire == T+12m`; epoch T+14m ⇒ `Rung 0`, anchor = epoch, next = epoch+3m), `TestJoinAnchorAfterReschedule` (deliveries T+1m, T+3m, T+7m; `rescheduled` T+8m; epoch T+2m; `min = max = 3m` ⇒ `Ladder{Anchor: T+2m, Rung: 0}`, next T+5m); `evaluate_test.go` or `tick_test.go` `TestRescheduledResetsEveryAnchor` (every 30m delivered at T, `rescheduled` T+20m, interval now 3m: T+20m30s no fire, T+23m fire `DueAt == T+23m`). <!-- R8 -->
- [x] T011 [P] Make `OrphanedSince` in `app/backend/internal/cron/orphan.go` skip `rescheduled` lines (filter before the streak walk; only `rescheduled` lines ⇒ 0, never `created_by.at`). Test `orphan_test.go` `TestOrphanedSinceIgnoresRescheduled`: `[delivered, rescheduled]` ⇒ 0; `[skipped-absent@T1, rescheduled@T2]` ⇒ T1; `[rescheduled]` ⇒ 0. <!-- R8 -->
- [x] T012 Implement `rk cron edit` in new `app/backend/cmd/rk/cron_edit.go` per R9 (flags via `cronScheduleFromFlags`, `--deliver`, `--name`, `--if-absent`, `--respawn`; nothing-to-edit usage error; enum validation; `--if-absent` non-respawn clears `respawn`; immutability help sentence; calls `cron.Edit`; `edited <id> <name> [<schedule> -> <target>]` data line; `no entry <id>` exit 1; contention ⇒ `cron tick in progress — retry` exit 1). Register in `cron.go` (`AddCommand`; `Short`/`Long` verb lists) and update `README.md`'s `rk cron` row (`add, edit, list, rm, mute, pin, tick`). Confirm `--role/--session/--pane` exit 2 via cobra's unknown-flag path; if not, define them hidden and reject with `target is immutable — rm + add to retarget`. <!-- R9 -->
- [x] T013 Tests for the verb in new `app/backend/cmd/rk/cron_edit_test.go`: `TestCronEditSchedule` (every 1h → `--idle-every 3m` ⇒ stored `{backoff, 3m, 3m}`, one `rescheduled` line `Reason: edit`, `edited …` line showing `backoff 3m→3m`), `TestCronEditDeliverOnly`, `TestCronEditNameOnlyNoLogLine`, `TestCronEditNoopNoLogLine`, `TestCronEditFlagMatrix` (bare edit; two schedule flags; `--min` without `--backoff`; `--role/--session/--pane` exit 2; bad `--deliver`; `--respawn` without `--if-absent respawn`), `TestCronEditUnknownID` (exit 1), `TestCronEditIfAbsentClearsRespawn`, `TestCronEditPreservesFlagsAndCreator`, `TestCronEditHelpText` (immutability sentence; `edit` in parent `Short`/`Long`). <!-- R9 -->
- [x] T014 Add `POST /api/cron/edit` in `app/backend/api/cron.go` (`cronEditBody` with pointer/optional fields for present-key detection; reject `target`/`createdBy`/`muted`/`pinned` keys with 400; build the `apply` closure; `cron.Edit`; 404/400/500 mapping; `s.sseHub.wake(server)`; 200 with the updated entry in the `create` response shape) and register it in `router.go` beside the four cron routes. Tests in `api/cron_test.go`: `TestCronEditRoute` — partial merge (`{id, deliver}` leaves the schedule intact), `schedule` replace, 404 unknown id, 400 on a `target` key / bad `deliver` / `max < min`, `rescheduled` appended exactly when schedule or deliver changed, SSE wake called, 200 body is the updated entry; plus `POST /api/cron/create` with `"deliver":"bogus"` ⇒ 400. <!-- R10, R3 -->
- [x] T015 Frontend helper + create dialog: add `describeDeliver` to `app/frontend/src/lib/cron-schedule.ts` per R11 (tests in `cron-schedule.test.ts` for the three values, `undefined`, unknown string); add the Delivery toggle group to `app/frontend/src/components/cron-create-dialog.tsx` per R11 and send `deliver` in the create body; new `cron-create-dialog.test.tsx`: default submit posts `deliver: "immediate"`, selecting "Skip if busy" posts `skip-if-busy`, `aria-pressed` toggles. <!-- R11 -->
- [x] T016 [P] Frontend glance/detail surfaces per R12: `sidebar/clock-panel.tsx` deliver chip (`data-testid="clock-row-deliver"`, non-immediate only, after the target chip); `server-clock-dashboard/crons-zone.tsx` schedule-cell marker (`data-testid="crons-row-deliver"`, same rule); `cron-entry-detail-sheet.tsx` `Deliver` row between "Next fire" and Mute (`data-testid="cron-entry-deliver"`, `describeDeliver`); `server-clock-dashboard/model.ts` `describeOutcome` `skipped-busy` prefix ⇒ `skipped (busy)`. Tests: `clock-panel.test.tsx` (no chip for immediate/absent; `skip-if-busy` text), `crons-zone.test.tsx` (same for the marker), `cron-entry-detail-sheet.test.tsx` (row sentence), `model.test.ts` (`skipped-busy: active` ⇒ `{label: "skipped (busy)", error: false}`; `rescheduled` verbatim uncolored). <!-- R12 -->
- [x] T017 Run the Go gates: `cd app/backend && go build ./... && go vet ./internal/cron/... ./cmd/rk/... ./api/... && go test ./internal/cron/... ./cmd/rk/... ./api/...` (run `just _ensure-tmux-conf` first if the embed complains); fix failures; confirm the `help-dump` test passes with the new `edit` node. <!-- R1, R3, R4, R5, R6, R7, R8, R9, R10 -->

### Phase 4: Polish

- [x] T018 [P] Update `docs/specs/cron.md` per R13 (a)–(g): Cron State example comment + file-changes sentence; Schedules `backoff` row note; the **Flat ladder = idle reminder** paragraph with the two-clocks table (from `intake.md` § Why); Delivery step 2 three-policy rule; Delivery step 4 `rescheduled` beside `missed`; API & CLI row (`--idle-every`, `--deliver when-idle|skip-if-busy`, `rk cron edit`, `POST /api/cron/edit`); § UI tier-2 (b) sentence on the deliver marker / row / group. <!-- R13 -->
- [x] T019 Update the explainer `docs/site/cron-schedule-kinds.md` per R14: (1) backoff `data-toggle="flat"` with constant 3-minute gap, `.add` line swap, rule bullet; (2) summary-table row + contrast sentence; (3) new `#p-deliver` panel (Sim with agent-state strip, three lanes, `data-toggle="busy"`, readout, three rule bullets, legend entries); (4) header sentence. Preserve every page convention; after editing run `awk '/<script/,/<\/script>/' docs/site/cron-schedule-kinds.md | grep -c '\](' ` and require 0. Verify visually with a headless screenshot if Playwright is installed, else by careful review of the Sim code paths. <!-- R14 -->
- [x] T020 [P] Update `docs/specs/index.md`'s Wiki row for Cron Schedule Kinds (flat toggle + deliver panel). <!-- R14 -->
- [x] T021 Final gates: `cd app/backend && go test ./...`; `cd app/frontend && npx tsc --noEmit && pnpm vitest run src/lib src/components/cron-create-dialog.test.tsx src/components/cron-entry-detail-sheet.test.tsx src/components/sidebar/clock-panel.test.tsx src/components/server-clock-dashboard`; `gofmt -l app/backend` empty. Re-check `shll standards` for any CLI-surface rule the new verb/flag must satisfy (help layering, readme-extraction) and fix drift. <!-- R2, R9, R11, R12 -->

- [x] T022 [P] Update `docs/wiki/cron-clock-design-studies.html` (the cron UI design authority): CLOCK caption names the non-`immediate` deliver chip; § 2 backoff paragraph gains the flat-ladder / `--idle-every` sentence; the resolution-ladder caption states the three deliver policies; § 4 interaction inventory gains "Set delivery policy" and "Edit schedule / delivery in place" rows; the mutations line lists `create·delete·mute·pin·edit`. Requested by the user after review; docs-only, no code impact. <!-- R13, R14 -->

## Execution Order

- T001 blocks T004 and T012 (shared parser). T002 blocks T004, T005, T014.
- T007 and T008 block T009; T009 blocks T012 and T014; T008 blocks T010 and T011.
- T012 blocks T013. T003 blocks T015, T016, T021's frontend gates. T017 follows T004–T014.
- T018–T020 are independent of code but should follow T012/T014 so the docs describe the shipped shapes.

## Acceptance

### Functional Completeness

- [x] A-001 R1: `--idle-every 3m` stores `{backoff, 3m, 3m}`; the four-way exclusivity, positive-duration, min/max, and catch-up usage errors behave as specified (exit 2); renderers still show `backoff 3m→3m`.
- [x] A-002 R2: `rk cron add --help` and `rk cron --help` name `--idle-every`, the Long contrasts it with `--every`, the "delivery wave" clause is gone, and both new examples appear.
- [x] A-003 R3: `DeliverSkipIfBusy` exists; `validate()` accepts `""`/immediate/when-idle/skip-if-busy and rejects others; the CLI enum and the create route agree.
- [x] A-004 R4: The deliverer returns non-held `skipped-busy` on active/waiting, delivers on idle/unknown, fails with the `agent-state read:` prefix on read error; no hold bound applies.
- [x] A-005 R5: A skipped fire is logged, the next attempt is one interval later, `skipped-busy` and `rescheduled` are rate-cap-exempt, and the cron window comment names the third value.
- [x] A-006 R6: `cron.Update` validates the merged entry, writes atomically, and leaves ID/Target/CreatedBy/Muted/MutedUntil/Pinned untouched.
- [x] A-007 R7: `cron.Edit` holds the tick flock, appends exactly one `rescheduled` line (`Reason: edit`, no target) only when schedule or deliver changed, and is the single helper both the verb and the route call.
- [x] A-008 R8: `ScheduleHistory` feeds both `JoinAnchor` call sites; `LastDelivery`/`OwnDeliveries` are unfiltered; `OrphanedSince` skips `rescheduled`.
- [x] A-009 R9: `rk cron edit` exists with the specified flags, merge semantics, shared parser, nothing-to-edit error, immutable target (exit 2), data line, `no entry` exit 1, parent-help and README registration.
- [x] A-010 R10: `POST /api/cron/edit` is registered, partial-merges, rejects target/createdBy/muted/pinned keys with 400, maps 404/400/500, wakes SSE, returns the updated entry.
- [x] A-011 R11: `describeDeliver` phrases the three values and passes unknowns through; the create dialog's Delivery group sends `deliver`.
- [x] A-012 R12: The CLOCK row chip, the CRONS row marker, the detail-sheet `Deliver` row, and `describeOutcome`'s `skipped (busy)` label are implemented; `cronStateLabel` and the Activity feed are unchanged.
- [x] A-013 R13: `docs/specs/cron.md` carries (a)–(g) and they match the code.
- [x] A-014 R14: The explainer has the flat toggle, the summary row + contrast sentence, the deliver panel with three lanes and its toggle, the header sentence, and legend entries; `docs/specs/index.md`'s wiki row is updated.
- [x] A-035 R13: `docs/wiki/cron-clock-design-studies.html` names the deliver chip, the flat ladder / `--idle-every` sugar, the three deliver policies, the in-place edit verb + route, and the five mutation routes — verified by the orchestrator after the review pass.

### Behavioral Correctness

- [x] A-015 R5: `TestTickSkippedBusyAdvancesAnchor` proves T+5m logs one skip, T+5m30s logs nothing, T+10m delivers.
- [x] A-016 R8: `TestRescheduledResetsEveryAnchor` proves an `every 30m → 3m` edit fires at edit+3m, not on the next poll; `TestJoinAnchorAfterReschedule` proves the ladder restarts from the raw epoch.
- [x] A-017 R10: `TestCronEditRoute` proves `{id, deliver}` leaves the schedule intact and appends `rescheduled`; a name-only edit appends nothing.
- [x] A-018 R11: The dialog test proves the default body carries `deliver: "immediate"` and a pressed "Skip if busy" carries `skip-if-busy`.

### Scenario Coverage

- [x] A-019 R1: `TestAnchorJoinFlatLadder` proves a `min == max` ladder keeps flat 3 m gaps through attributed flips and resets to epoch+3m on a genuine flip.
- [x] A-020 R4: `TestEngineDelivererSkipIfBusy` covers active, waiting, idle, `""`, past-hold-window, and read-error cases.
- [x] A-021 R9: `TestCronEditFlagMatrix` covers bare edit, two schedule flags, `--min` without `--backoff`, target flags, bad `--deliver`, `--respawn` without `--if-absent respawn`.
- [x] A-022 R12: Tests prove no chip/marker for `immediate`/absent and the raw value for `skip-if-busy` on both the CLOCK row and the CRONS row; the detail sheet renders the `describeDeliver` sentence; `describeOutcome("skipped-busy: active")` ⇒ `skipped (busy)`.

### Edge Cases & Error Handling

- [x] A-023 R3: `POST /api/cron/create` with `"deliver":"bogus"` returns 400.
- [x] A-024 R6: A merge failing `validate()` (e.g. `Max < Min`) writes nothing; a corrupt entry file yields `refusing to mutate`.
- [x] A-025 R8: `TestOrphanedSinceIgnoresRescheduled` proves `[rescheduled]` alone returns 0 and never `created_by.at`, and an absent run is not restarted by a `rescheduled` line.
- [x] A-026 R9: `edit <id> --if-absent skip` clears a stored respawn argv; `ValidateRespawnIntent` violations on the merged entry are usage errors.
- [x] A-027 R7: Flock contention beyond 2 s yields the contention error (CLI exit 1 `cron tick in progress — retry`; route 500 or 409 with the message) and writes nothing.
- [x] A-028 R10: A `target` key, a bad `deliver`, or `max < min` on the edit route returns 400 and writes nothing; an unknown id returns 404.

### Code Quality

- [x] A-029 Pattern consistency: `cron_edit.go` mirrors the `cron_mut.go`/`cron_add.go` verb shape (outputSink data line, `usageError`, exit codes); `Update` mirrors `setFlag`; `handleCronEdit` mirrors `handleCronMute`/`handleCronCreate`; frontend edits use the existing `badge`/`kindButton`/`rowClass` idioms.
- [x] A-030 No unnecessary duplication: `add` and `edit` share one schedule-flag parser and `cronAddValidateEnum`; the verb and the route share `cron.Edit`; `describeDeliver` is the single place that knows the deliver enum on the frontend.
- [x] A-031 All tmux interaction stays inside `internal/tmux`; no shell strings; the new route is spec-justified (`docs/specs/cron.md` § API & CLI).
- [x] A-032 Comments state constraints, not narration; no change IDs or PR numbers in code comments.
- [x] A-033 Tests are colocated (`*_test.go`, `*.test.ts(x)`); `gofmt -l` is empty; `go vet` and `tsc --noEmit` are clean; the explainer script contains no `](`.
- [x] A-034 Magic strings named: `DeliverSkipIfBusy`, the `rescheduled` outcome, and the `edit` reason are constants or documented literals beside their siblings.

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`
- The explainer script must never contain the byte sequence `](` (shll.ai link rewriter).

## Deletion Candidates

- None — this change adds new functionality without making existing code redundant. The stale "delivery wave" help clause was rewritten in place (help text, not code), and `cronAddSchedule` survives as a thin wrapper over the extracted shared parser rather than becoming dead code.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | The shared schedule parser returns `(schedule, set, err)` so `edit` can distinguish "no schedule flag" from an invalid one; `add` keeps `cronAddSchedule` as a wrapper | Follows directly from R9's "zero schedule flags means keep the schedule" | S:85 R:90 A:90 D:85 |
| 2 | Confident | `cron.Edit` lives in `internal/cron` (in `store.go` or a sibling `edit.go`) and returns a named contention error the CLI maps to exit 1 and the route to a 5xx/409 with the same message | The intake fixes the helper's contract but not its file or the route's contention status; both are routine | S:65 R:95 A:90 D:80 |
| 3 | Confident | `ScheduleHistory` lives in `log.go` beside `OwnDeliveries`; `rescheduled`/`edit` become constants only if the package already names outcomes/reasons as constants | Match the package's existing convention | S:60 R:95 A:85 D:80 |
| 4 | Confident | Target flags on `edit` are rejected by cobra's unknown-flag error on the usage-error path (exit 2); the hidden-flag fallback is used only if that exit code does not hold | Intake specified the two-step rule; the apply worker confirms empirically | S:70 R:90 A:85 D:80 |
| 5 | Confident | `cronEditBody` uses pointer fields (`*string`, `*cronScheduleBody`, `*[]string`) for present-key detection and rejects forbidden keys by decoding into a raw map first or via `DisallowUnknownFields` on a struct that omits them | Partial-merge needs presence, which plain zero values cannot express; either mechanism is idiomatic Go | S:65 R:90 A:90 D:75 |
| 6 | Confident | Explainer Sim numbers (busy 7–18 min, `every 5m`, 30 sim-minutes, flat gap 3 min) are illustrative and may be tuned for legibility as long as the three-lane lesson holds | Intake labelled them suggestions, not contract | S:75 R:95 A:85 D:85 |
| 7 | Confident | API 400 for `deliver: bogus` on create comes from the existing validate-error mapping; the handler is touched only if that mapping is absent | Create already returns 400 on validation failures for other fields | S:65 R:90 A:85 D:85 |
| 8 | Confident | The CRONS-zone marker is a sibling `<span>` after `describeSchedule` inside the same `<td>` (not a new column), with a test in `crons-zone.test.tsx` | Intake § G post-rebase bullet; the seven-column table has no room for an eighth at desktop density | S:70 R:95 A:90 D:85 |
| 9 | Confident | Apply-time refinements: the CRONS-zone marker nests INSIDE the schedule cell's truncating span (a sibling would wrap to a second line — supersedes #8's placement detail, same visibility rule/testid); the explainer's two "into a busy pane" labels are vertically staggered to avoid canvas collision; `edit_test.go` adds `TestEditAcquiresAReleasedLock` (retry-loop success path) beyond the plan; `tick.go` got a whitespace-only gofmt fix for pre-existing misalignment | Surfaced during apply; all preserve the requirement's intent | S:60 R:95 A:90 D:75 |

9 assumptions (1 certain, 8 confident, 0 tentative).
