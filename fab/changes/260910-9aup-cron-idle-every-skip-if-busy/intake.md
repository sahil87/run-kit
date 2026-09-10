# Intake: Cron idle reminders — `--idle-every` sugar, `skip-if-busy` delivery, and `rk cron edit`

**Change**: 260910-9aup-cron-idle-every-skip-if-busy
**Created**: 2026-09-10

## Origin

Promptless-defer intake dispatched by `/fab-proceed` from a live design conversation (no
questions asked; would-be questions are the `Deferred — promptless dispatch` rows in
`## Assumptions`). The conversation's synthesized description was the sole input:

> The operator wants a cron entry that "pings every X minutes after the agent goes idle", as a
> reminder (e.g. wake the operator every 3 minutes of quiet). Reviewing the four schedule
> mechanisms (`every`, `cron`, `backoff`, `wake_on`) showed two gaps: (a) the idle-anchored flat
> reminder is already expressible but undiscoverable, and (b) there is no delivery policy that
> simply drops a fire when the agent is busy rather than holding it.
>
> Decisions: no new schedule kind — the reminder is a `backoff` ladder with `min == max`;
> add CLI sugar `--idle-every <dur>` on `rk cron add` that expands to it; add a third `deliver`
> value `skip-if-busy` that checks agent state once at due time, drops the fire when busy, and
> logs a NON-held `skipped-busy` outcome so the anchor advances; record the flat-backoff vs
> `every + skip-if-busy` semantics contrast; update `docs/specs/cron.md`, the animated explainer
> `docs/site/cron-schedule-kinds.md` (rule toggle on the backoff panel, summary-table row, a
> deliver-axis section ideally as a small animated timeline), `rk cron list` if it does not show
> the deliver policy, and memory at hydrate; add the listed tests.

A mid-intake scope addition from the coordinator added **Addition C — `rk cron edit <id>`**:

> `rk cron` has add/list/rm/mute/pin/tick but no verb to change an existing entry's schedule or
> delivery policy; today that is `rm` + `add`, which mints a new id and orphans the old entry's
> delivery-log history. The reminder use case's primary consumer is the operator editing the
> seeded operator tick, so shipping `--idle-every` without an edit verb leaves the main user doing
> rm+add. Semantics: each flag given replaces that field, omitted fields keep their values; the
> schedule flags are `add`'s mutually-exclusive set (share the parser); target and creator are
> immutable; mute/pin untouched. Store: a new `cron.Update` beside `SetMuted`/`SetPinned`.
> Anchor decision (decided, not deferred): `edit` appends one `rescheduled` log line (schedule
> history, like `missed`; not rate-counted; target-independent) so `every`/`cron` count from the
> edit and a backoff streak is cut; the wake cursor is unaffected; name-only edits may skip the
> line. Name it `edit`, not `change`. Add the matching HTTP endpoint only if `rm`/`mute`/`pin`
> have POST endpoints (record which). Tests: store merge, CLI exclusivity + `--idle-every` via
> edit, evaluator/tick assertions that `rescheduled` resets the `every` anchor and cuts a backoff
> streak.

Design authority: `docs/specs/cron.md` (§ Schedules, § Delivery, § API & CLI) and the
implementation in `app/backend/internal/cron/` (`schema.go`, `backoff.go`, `schedule.go`,
`deliver.go`, `tick.go`, `cronexpr.go`, `store.go`, `log.go`, `orphan.go`) plus
`app/backend/cmd/rk/cron_add.go` / `cron_mut.go` / `cron_list.go` and `app/backend/api/cron.go`.
Everything below was checked against that code, not the spec's prose alone.

## Why

1. **The idle reminder exists but nobody can find it.** "Ping me every 3 minutes once the agent
   is quiet" is exactly a `backoff` ladder whose two knobs are equal:
   `rk cron add "wake up" --backoff --min 3m --max 3m`. `gapAfter(min, max, rung)`
   (`backoff.go`) returns `max` for every rung when `min == max` (the first iteration hits
   `g >= max`), so every gap is flat; the anchor is the target pane's idle epoch from
   `@rk_pane_agent_state`, not the last delivery; the anchor-join rule (`JoinAnchor`) keeps
   the clock's own pings from restarting the count (a flip inside `attributionWindow` = 120 s of
   the entry's newest own log line is clock-caused); genuine activity resets the anchor so the
   next ping lands `min` after the *new* idle moment. Schema validation (`Entry.validate`) already
   permits equality — only `max < min` is rejected ("backoff max must be ≥ min"). Nothing in help,
   spec, or the explainer says any of this, and "backoff 3m→3m" reads like a mistake rather than
   a feature. Without a named flag the operator reaches for `--every 3m`, which is the wrong
   clock (see the contrast below).

2. **There is no drop-when-busy delivery policy.** Today `deliver ∈ {immediate, when-idle}`.
   `when-idle` *holds* a busy-pane fire (outcome `held-busy`, `Held: true`, never logged,
   re-evaluated every 30 s tick) for up to `DefaultHoldWindow` (2 h) and then logs
   `held-expired`. That is the right shape for "deliver this as soon as you are free", and the
   wrong shape for "if you're busy at 09:00, forget it — try again at the next boundary". A held
   fire lands the instant the agent frees after a long busy stretch, which for a *reminder* or a
   wall-clock nudge is precisely the moment you did not want it. A logged skip is the missing
   third policy, and it lives on the deliver axis so every schedule kind gets it (`cron` entries
   included: "09:00 daily unless busy").

3. **Why these two mechanisms and not a fourth schedule kind or an `every` variant.** A new kind
   would duplicate the anchor-join machinery for no new behavior. A skip-when-busy `every` variant
   would put a delivery concern on the schedule axis. `--every X --deliver when-idle` was rejected
   as the reminder because it fires the instant the agent frees rather than waiting a fresh X of
   quiet. Expressing skip as `hold: 0` on `when-idle` was rejected because a named enum value is
   clearer to read in an entry file and yields a distinct log outcome the UI can show.

4. **An entry's schedule cannot be changed in place.** The verb set is `add / list / rm / mute /
   pin / tick`; the only way to move the seeded operator tick from its 1m→30m ladder to a 3 m
   reminder, or to give a `cron` entry `skip-if-busy`, is `rm` + `add`. That mints a new 4-char id
   (breaking anything that recorded the old one — `rk cron mute <id>` in a running loop, a
   deep-link) and orphans the old entry's delivery-log history. Because every schedule kind
   derives its anchor from the entry's newest own log line, an in-place edit also needs a
   *reset point* in that history: without one, a 30 m `every` edited to 3 m fires on the next
   poll (its last delivery is > 3 m old), and a `backoff` entry edited from `every` would let the
   streak walk misread the old evenly-spaced deliveries as rungs. A logged `rescheduled` line —
   the same class as `missed`: schedule history, not a delivery — is that reset point, and keeps
   the evaluator a pure function of on-disk state (Constitution II).

**The two clocks, stated once so spec and explainer say the same thing:**

| Expression | Fires when | An agent idle for 5 s at a boundary | An agent that went idle 5 s after a boundary |
|---|---|---|---|
| `--idle-every 3m` (flat backoff, `min == max`) | 3 m after the last *genuine* idle moment, then every 3 m while it stays quiet; own pings don't restart the count | not pinged until it has been quiet 3 m | pinged 3 m after it went idle |
| `--every 3m --deliver skip-if-busy` (fixed grid, idleness checked at each boundary) | at every 3 m grid point at which the agent happens to be idle; busy boundaries are skipped, not held | pinged now | waits nearly 3 m for the next boundary |

The operator's "wake me every 3 minutes of quiet" reminder should be seeded with the flat backoff
via `--idle-every`, not the grid version.

## What Changes

### A. CLI sugar: `--idle-every <dur>` on `rk cron add` (`app/backend/cmd/rk/cron_add.go`)

- New flag `f.DurationVar(&cronAddIdleEvery, "idle-every", 0, …)`. It is a **fourth
  mutually-exclusive schedule flag** alongside `--every` / `--backoff` / `--cron`:
  `cronAddSchedule`'s `set` count loops over `{"every", "idle-every", "backoff", "cron"}` and the
  usage error becomes `exactly one schedule flag is required: --every, --idle-every, --backoff, or --cron`.
- Expansion: `--idle-every 3m` ⇒ `cron.Schedule{Kind: cron.ScheduleBackoff, Min: 3m, Max: 3m}`.
  **On-disk schema and evaluator untouched** — the entry file says `schedule: {kind: backoff, min: 3m, max: 3m}`.
- Validation (all `usageError`, exit 2, state dir untouched — the existing matrix posture):
  - `--idle-every` non-positive ⇒ `--idle-every must be a positive duration, got %s` (mirrors `--every`).
  - `--min`/`--max` with `--idle-every` ⇒ usage error. The existing check
    `--min/--max only apply with --backoff` already fires (it tests `Changed("backoff")`); keep that
    message — it is correct: the sugar has no refinements, use `--backoff --min --max` for a
    non-flat ladder.
  - `--catch-up` with `--idle-every` ⇒ the existing `--catch-up only applies with --cron` error fires unchanged.
- Help (toolkit principle 3 — layered help, examples after flags; `TestCronAddHelpText` extended):
  - `Use`: `add <prompt> --every <dur> | --idle-every <dur> | --backoff | --cron "<expr>"`.
  - Flag usage: `Fire every <dur> of agent quiet: <dur> after the target pane last went idle for a reason other than the clock, then every <dur> while it stays idle (a flat backoff ladder, min = max)`.
  - `Long`: add the `--idle-every` sentence next to `--backoff` and state the contrast in one
    clause ("unlike --every, the count restarts on genuine activity and the clock's own deliveries
    never restart it"). Also rewrite the stale clause "--deliver and --if-absent values are
    validated now but enforced by the delivery wave" — the delivery wave shipped; new wording:
    "--deliver (immediate | when-idle | skip-if-busy — see below) and --if-absent are validated at
    add time and enforced at fire time".
  - `Example`: add `rk cron add "wake up" --idle-every 3m` (the operator reminder) and
    `rk cron add "morning digest" --cron "0 9 * * *" --deliver skip-if-busy`.
  - The `cron` parent `Long` (`cron.go`) lists the schedule flags — add `--idle-every` to that list.
- No shell-completion tables exist to update: `rk shell-init` (`shell_init.go`) emits
  cobra-generated completions from the flag set, so the new flag completes automatically. (The
  memory's `260908-qyin-cron-schedule-completions` change was cron-*expression* completions —
  5-field evaluation, `catch_up`, the hold bound — not shell completion.)
- A flat ladder (`min == max`) keeps rendering as what the file says — `backoff 3m→3m` in
  `cronScheduleSummary` (`cron.go`: the `rk cron add` success line and `rk cron list`'s SCHEDULE
  column) and the existing "backs off from 3 minutes up to 3 minutes since last activity" sentence
  in the frontend `describeSchedule` (Assumptions #14, resolved by the user for the recommendation:
  the sugar is input-side only; the renderers show the on-disk truth). Known wart: the frontend
  sentence reads oddly for a flat ladder — a display-only follow-up, not part of this change.

### B. Third deliver value `skip-if-busy` (`app/backend/internal/cron/`)

**`schema.go`** — add `DeliverSkipIfBusy = "skip-if-busy"` beside `DeliverImmediate` /
`DeliverWhenIdle`; refresh the block comment (the values are now enforced by the deliverer, not
merely carried). `Entry.validate()` starts enforcing the `deliver` closed set (Assumptions #15,
resolved) — today it does not check `deliver` at all, so `POST /api/cron/create` stores any string
while the CLI rejects unknown values; after this change `""`, `immediate`, `when-idle`, and
`skip-if-busy` pass and anything else fails with `unknown deliver value %q` (the create route
surfaces it as 400). `if_absent` is left as is.

**`deliver.go`** — `EngineDeliverer.Deliver` gains the branch:

```go
if fire.Entry.Deliver == DeliverSkipIfBusy {
    state, err := d.readState(ctx, fire.PaneID, fire.Server)
    if err != nil {
        return Outcome{Status: "failed", Detail: "agent-state read: " + err.Error()}
    }
    if state == tmux.AgentStateActive || state == tmux.AgentStateWaiting {
        return Outcome{Status: "skipped-busy", Detail: state} // Held deliberately UNSET: logged, anchor-advancing
    }
}
```

- Same busy predicate as `when-idle` (`active | waiting` — the operator request-lane predicate);
  `idle` and unknown (`""`) states deliver ("an unknown-state pane carries no gateable signal");
  a state-read error is `failed: agent-state read: …` exactly as for `when-idle`.
- No hold bound applies — the check happens once, at due time; `DefaultHoldWindow` is never consulted.
- Doc comment rewritten to describe the three policies side by side.

**`tick.go`** — no control-flow change: the outcome has `Held == false`, so the existing loop
appends `LogLine{TS: now, Entry, Target, Reason, Outcome: "skipped-busy: active"}`. This append IS
the mechanism: `everyAnchor` (`schedule.go`) and `LastDelivery`/`OwnDeliveries` (`log.go`) are
outcome-agnostic — the entry's newest own line becomes the anchor, so the next attempt lands one
full interval later (`next fire = skip + interval`), not on the next 30 s poll. Without the log
line the evaluator would re-fire every tick and the policy would degenerate into `when-idle`.
Two edits only:
- `countsTowardRate`: **`skipped-busy` does NOT count** toward `DefaultTargetRatePerHour` — it is
  not a delivery attempt (add it to the doc comment's non-counting list; the switch needs no new
  case since the default is `false`, but `TestTickRateCapOutcomeClasses` pins it).
- The `Outcome.Held` comment: note that `skipped-busy` is the deliberate counter-example — a
  busy-pane outcome that MUST be logged because advancing the anchor is its purpose.

**`cronexpr.go`** — `cronScheduleDue`'s deliver-dependent window stays `DefaultCronGrace` (2 m)
for `skip-if-busy` (only `when-idle` extends to `DefaultHoldWindow`, because only a hold needs
cross-tick retry time). Update the comment to name the third value. A `cron` entry with
`skip-if-busy` whose 09:00 occurrence finds the agent busy logs `skipped-busy` at 09:00 and the
next occurrence is tomorrow's — "09:00 daily unless busy".

**Interactions recorded, no code**:
- `if_absent` handling unchanged — an unresolved target never reaches the deliverer.
- A `wake`-reason fire under `skip-if-busy` on a busy pane is dropped and logged like any other;
  the edge is already consumed (`Evaluate` computes `NextCursor` before delivery — the same rule
  `when-idle` holds follow), and the logged line also debounces the next edge via `LastDelivery`.
- `backoff` + `skip-if-busy`: the `skipped-busy` line is the entry's newest own line for
  `JoinAnchor`'s attribution test, so an idle flip within 120 s of the skip continues the ladder
  and a later flip resets it — the same rule every logged outcome (`failed`, `held-expired`,
  `rate-capped`) already follows. On a *flat* ladder this is moot (all gaps equal), and
  `--idle-every` needs no deliver policy at all: it fires only after `min` of idleness, so the
  pane is idle at due time by construction (modulo the last ≤30 s poll).
- `derive.go` (`GET /api/cron` next-fire) and the CLOCK/Activity UI need nothing: they derive from
  `everyAnchor`/`LastDelivery`, so after a skip they show the next boundary; the Activity feed
  renders the raw outcome string (`skipped-busy: active`) like every other class.

### C. New verb `rk cron edit <id>` (`app/backend/cmd/rk/cron_edit.go`, `internal/cron/store.go`, `log.go`, `orphan.go`)

**CLI shape** — `edit <id> [--every <dur> | --idle-every <dur> | --backoff [--min <dur>] [--max <dur>] | --cron "<expr>" [--catch-up once]] [--deliver <policy>] [--name <n>] [--if-absent <policy>] [--respawn <arg>…]`:

- Each flag given **replaces** that field; omitted fields keep their values. At least one flag
  must be given (a bare `edit <id>` is a usage error: `nothing to edit — pass a schedule flag, --deliver, --name, --if-absent, or --respawn`).
- **Schedule flags reuse `add`'s parser.** Extract the body of `cronAddSchedule` into a shared
  helper (e.g. `cronScheduleFromFlags(cmd, values)`) operating on a small struct of flag values,
  so `add` and `edit` share the four-way exclusion (`--every`/`--idle-every`/`--backoff`/`--cron`),
  the `--min/--max only apply with --backoff` and `--catch-up only applies with --cron` gates, the
  positive-duration checks, and the `--idle-every` expansion — the same function Addition A
  touches, written once. On `edit`, zero schedule flags means "keep the schedule"; more than one
  is the same exactly-one usage error; `--min`/`--max` alone (without `--backoff`) is a usage
  error even if the stored schedule is a backoff — a refinement is spelled `--backoff --min …`
  and replaces the whole schedule (defaults 60s/30m for the knob not given).
- `--deliver` accepts the full enum incl. `skip-if-busy`; `--if-absent` the existing three. Both
  validated with `cronAddValidateEnum` (shared).
- **Target and creator are immutable.** `--role`/`--session`/`--pane` are not defined on `edit`;
  the help says so ("to retarget, add a new entry — a target change is a different entry") and
  a target flag fails as an unknown flag with exit 2 (apply confirms cobra's flag-parse error
  takes the family's usage-error exit path; if it does not, define the three flags hidden and
  reject them with `target is immutable — rm + add to retarget`). `created_by` is never rewritten.
- `--respawn` given replaces the whole argv; `--if-absent` set to a non-`respawn` value clears
  `respawn` (an argv without the policy is dead weight, and `--respawn only applies with
  --if-absent respawn` would otherwise trip on the merged entry). `cron.ValidateRespawnIntent` on
  the merged entry is classified as a usage error, as in `add`.
- Mute/pin flags are not accepted (their own verbs).
- Output (toolkit principle 9): one data line on stdout —
  `edited <id> <name> [<schedule summary> -> <target summary>]` (the `add` summary shape, via
  `cronScheduleSummary`/`cronTargetSummary`); a `rescheduled` append is not separately announced.
  Unknown id ⇒ `no entry <id>`, exit 1 (the `rm`/`mute`/`pin` shape). Corrupt file ⇒ the store's
  `refusing to mutate` error, exit 1.
- Registered in `cron.go` (`cronCmd.AddCommand(cronEditCmd)`); the parent `Short`/`Long` and the
  README's `rk cron` row (`add, list, rm, mute, pin, tick`) gain `edit`. `help-dump` gains one
  visible node — the help-dump test asserts the subtree dynamically, so it passes; the
  toolkit-standards memory's "six-member subtree" prose becomes seven at hydrate.
- Name: `edit` (not `change` — collides with `fab change`). Toolkit principle 5 (a write must be
  recognizable from the name) is satisfied; `shll standards` lists no separate verb-naming
  contract (principles, help-dump, readme-extraction, skill, update, version, shell-init,
  install-composition, config-home) — re-check at apply.

**Store** — `cron.Update(dir, slug, id string, apply func(*Entry)) (Entry, bool, error)` in
`store.go` beside `setFlag`: `loadForMutate` → find the entry (absent ⇒ `(Entry{}, false, nil)`,
the `Remove` shape) → `apply` mutates a copy → the merged entry passes `validate()` and
`ValidateRespawnIntent` (a failure returns the error and writes nothing) → `saveEntries`
(atomic via `fsatomic`). `Update` never touches `ID`, `Target`, `CreatedBy`, `Muted`,
`MutedUntil`, `Pinned` — the CLI's `apply` closure only sets the editable fields, and a store
test pins that the rest survive byte-for-byte.

**The `rescheduled` log line — the anchor reset.** After a successful `Update` whose merged
`Schedule` or `Deliver` differs from the stored one, the verb appends
`LogLine{TS: now, Entry: id, Reason: "edit", Outcome: "rescheduled"}` (no `Target`) via
`cron.AppendLog` to `<slug>.log`. Name-, `if_absent`-, and `respawn`-only edits, and edits whose
merged schedule and deliver equal the stored values, append nothing. Consequences, each pinned by
a test:
- **`every` / `cron`**: `everyAnchor` uses `LastDelivery` (the newest own line of any outcome),
  so the anchor becomes the edit time — a 30 m entry edited to 3 m fires at edit + 3 m, not on the
  next poll; a `cron` entry considers only occurrences after the edit.
- **`backoff`**: the `rescheduled` line is a **streak boundary**. The `JoinAnchor` call sites
  (`evaluate.go`, `derive.go`) stop reading `OwnDeliveries(log, id)` and read a new
  `ScheduleHistory(log, id)` = the entry's own lines strictly newer than its newest `rescheduled`
  line (the boundary line itself excluded — it is not a delivery). With no lines after the
  boundary `JoinAnchor` returns `Ladder{Anchor: rawEpoch, Rung: 0}`: the ladder restarts from the
  target's idle epoch (an agent already idle longer than the new `min` is pinged on the next poll —
  the correct meaning of "every 3 m of quiet"). Without the boundary the walk would ingest the
  pre-edit deliveries as rungs of the new ladder.
- **Orphan GC**: `OrphanedSince` keeps reading ALL own lines but **skips `rescheduled` lines** —
  they are neither resolution evidence nor absent-class, so they never start an absent run and
  never trigger the `created_by.at` fallback. (A naive cut view would make an old edited entry
  report an orphan streak from its creation time and be expired on its first unresolved tick.)
- **Rate cap**: `countsTowardRate("rescheduled") == false` (doc comment + test).
- **Wake**: the cursor is untouched; the debounce (`LastDelivery`) holds an edge for `debounce`
  after the edit — a harmless ≤60 s quiet period, recorded, not special-cased.
- **Display**: `LAST-FIRED` / `lastFired` (both `LastDelivery`) show the edit time until the next
  outcome — the same precedent `missed`/`skipped-absent`/`rate-capped` already set; a
  fired-vs-anchor display split is out of scope.
- **Concurrency**: the entry write and the log append happen under the tick flock
  (`acquireLock(LockPath(dir))`, non-blocking, retried every 100 ms for ≤2 s — a tick is
  sub-second); persistent contention exits 1 with `cron tick in progress — retry`. `AppendLog` is
  `O_APPEND` (line-atomic), so the lock is about ordering relative to a tick's
  read-evaluate-append, not byte safety. `add`/`rm`/`mute`/`pin` stay lock-free as today (entry
  writes are atomic and touch no log).
- **Operator seed**: `EnsureRoleEntry` never rewrites an existing entry's schedule (idempotent;
  only the narrow respawn-argv / debounce backfill), so an edited operator tick survives every
  later `rk operator` launch. `rk cron edit <op-id> --idle-every 3m` is therefore the supported
  way to turn the seeded tick into the reminder — this verb is the run-kit half of fab-kit's
  reschedule-in-place wish.

**HTTP — `POST /api/cron/edit`** (`app/backend/api/cron.go`, registered in `router.go` beside
`create|delete|mute|pin`). **Resolved by the user (Assumptions #27): add the route now** — its
consumer is the run-kit UI (a detail-sheet / CLOCK-row edit surface in a later change), so the
recorded DD "The pin route waited for a consumer" is amended in place rather than reversed: the
consumer condition is met by a declared UI consumer instead of a shipped one. Body
`{id, schedule?, deliver?, name?, ifAbsent?, respawn?}` — camelCase, the `cronCreateBody` field
shapes (`schedule.{kind,interval,min,max,expr,catchUp}` as strings) — with present-keys-set
partial-merge semantics (Constitution IX): absent keys keep their values; `schedule` present
replaces the whole schedule; `respawn: []` clears the argv; `ifAbsent` set to a non-`respawn`
value clears `respawn` as the CLI does. `target`, `createdBy`, `muted`, `pinned` keys are not
accepted (present ⇒ 400 `target is immutable` / `use /api/cron/mute|pin`). Flow: decode → build
the `apply` closure → the shared library helper `cron.Edit(dir, slug, id, now, apply)` — the
tick-flock hold, `cron.Update`, and the conditional `rescheduled` append factored into ONE function
so the CLI verb and the handler cannot drift — → 404 `cron entry not found` on unknown id, 400 with
the validation error text, 500 on store errors → `s.sseHub.wake(server)` → 200 with the updated
entry (the `create` response shape, so a UI can re-render without a refetch). No frontend client
function in this change (an `editCron` helper with no caller would be dead code; it lands with the
UI surface).

### D. `rk cron list` — already shows the deliver policy (no change)

`cron_list.go` renders a `DELIVER` column in the table and a `deliver` key in `--json`
(`cronListRecord.Deliver`, pinned by `cron_list_test.go` with the `when-idle` fixture). Scope item
"add a Deliver column if not already shown" is therefore satisfied; the only list-side work is
confirming a `skip-if-busy` entry round-trips through the existing column (one fixture row).

### E. Spec — `docs/specs/cron.md`

- § Cron State example: `deliver: immediate           # immediate | when-idle | skip-if-busy`;
  the closing sentence "The file changes only on add / rm / pin / mute" gains `edit`.
- § Schedules table, `backoff` row: append "… capped at `max`; `min = max` collapses the ladder to
  a flat 'every `min` of quiet' reminder (`--idle-every`)".
- § Schedules, after the anchor-join paragraph, a new short paragraph **"Flat ladder = idle
  reminder"** carrying the two-clocks contrast table from § Why (the operator reminder is the flat
  backoff, not `every + skip-if-busy`), and naming `rk cron add --idle-every <dur>` as sugar that
  writes `{kind: backoff, min: dur, max: dur}` — no new kind, no schema field.
- § Delivery step 2 becomes the three-policy rule: `immediate` sends now; `when-idle` holds
  (bounded by `DefaultHoldWindow`, `held-expired` on expiry — existing text); `skip-if-busy`
  reads agent state once at due time and, on `active | waiting`, drops the fire with a logged
  `skipped-busy` outcome that advances the anchor (the next attempt is the next due period) and
  does not count toward the rate cap; idle/unknown deliver.
- § Delivery step 4 (the log): name `rescheduled` beside `missed` as schedule-history lines that
  advance the anchor without being deliveries; state the backoff boundary and orphan-neutral rules.
- § UI, tier-2 (b) paragraph (the Server page zones, shipped on main by #918): one sentence that
  the CLOCK row and the CRONS row carry a `deliver` marker when the policy is not `immediate`,
  the entry detail sheet shows a `Deliver` row, and the create dialog's Delivery group sets it.
- § API & CLI, CLI row: `rk cron add <prompt> --every 1h | --idle-every 3m | --backoff | --cron "<expr>" [--name N] [--deliver when-idle|skip-if-busy] [--if-absent skip] [--respawn <arg>…]`,
  plus `rk cron edit <id> [<schedule flag>] [--deliver P] [--name N] [--if-absent P] [--respawn <arg>…]`
  ("target and creator immutable; a schedule or deliver change logs `rescheduled`"); the Mutate
  row gains `POST /api/cron/edit` (partial-merge body; immutable target; returns the entry).

### F. Explainer — `docs/site/cron-schedule-kinds.md` (published at https://shll.ai/run-kit/cron-schedule-kinds)

Page conventions to preserve: Markdown wrapper around one `<div class="rk-cron-clocks not-content">`;
HTML/CSS/JS inline; every style scoped under `.rk-cron-clocks`; container queries
(`@container (max-width: 760px)`), `prefers-reduced-motion` (`reduced` ⇒ panels sit at the
finished timeline, no pulses); every panel "loads finished" (`this.t = this.duration`) with
Play/Restart plus `data-toggle` rule buttons that flip `state[tog]`, recompute, and replay via the
shared `Sim` engine; `data-act` buttons for one-shot actions. **The inline script must not
contain the byte sequence `](`** — shll.ai's link rewriter mangles it (PR #907 rewrote
`cfg.actions[act](this)` to `const run = cfg.actions[act]; run(this)` for exactly this reason).
Links leaving `docs/site/` stay absolute (`readme-extraction` standard).

1. **Backoff panel — flat toggle.** Add `<button data-toggle="flat" aria-pressed="false">flat: min = max (idle reminder)</button>`.
   In `compute`, when `st.flat` the gap function returns a constant (suggested 3 sim-minutes:
   `gapAfter` ⇒ `FLAT`), so the replay shows equal gaps that still (a) keep counting through the
   clock's own ticks (attribution window) and (b) reset on the "You type to the operator" poke.
   The panel `.add` line swaps to `rk cron add "wake up" --idle-every 3m` while the toggle is on
   (the `onToggle` hook can rewrite it). Rule text gains one bullet: "Set `min = max` and the
   ladder is flat — 'ping every 3 min of quiet'. Same anchor rules: the pings don't restart the
   count, real activity does. `--idle-every 3m` writes exactly this entry."
2. **Summary table row** after `backoff`: `backoff, min = max` (`--idle-every`) · "X after the last
   genuine idle moment, then every X while it stays quiet" · "reminders that wait for quiet". Plus
   one sentence under the table contrasting it with `every X --deliver skip-if-busy` (the grid).
3. **New `deliver` panel** (`section.panel#p-deliver`, placed after `wake_on`, before "Put
   together") — "deliver <small>what happens when the agent is busy at fire time</small>",
   `.add` line `rk cron add "check PRs" --every 5m --deliver skip-if-busy`. One `Sim` over a
   ~30 sim-minute `every 5m` entry: an agent-state strip (busy `active` block, suggested 7–18 min)
   and three lanes sharing the axis — **immediate** (fires at every boundary, the two inside the
   busy block labelled "into a busy pane"), **when-idle** (the 10 m fire held — orange/soft
   marker "held" — delivered at 18 m when the pane idles, and the rhythm continues from 18 m), and
   **skip-if-busy** (10 m and 15 m drawn hollow "skipped · busy", the grid unchanged — next fire
   at 20 m). One `data-toggle="busy"` ("agent busy 7–18 min", default on): with it off the three
   lanes are identical, which is the lesson — the deliver axis only matters when the agent is
   busy. Readout: `t · immediate N · when-idle N (held M) · skip-if-busy N (skipped K)`. Rule text:
   three bullets (hold vs drop vs neither; the 2 h hold bound and `held-expired`; `skipped-busy`
   is logged so the next attempt is one interval later, not the next poll). Legend gains a
   hollow "skipped (busy)" and a "held" marker.
4. Header paragraph: one added sentence — the "when" is three kinds plus an edge trigger, and a
   `deliver` policy says what to do if the agent is busy at that moment.
5. `docs/specs/index.md` Wiki row for the page: extend the description with the flat toggle and
   the deliver panel (human-curated index; a one-line edit).

### G. Web UI — expose `deliver` (create dialog, CLOCK row, detail sheet)

Resolved by the user (Assumptions #16): the web surfaces show and set the delivery policy. Three
small, idiom-matching edits; no new route, page, or palette action (Constitution IV):

- **`src/lib/cron-schedule.ts`** — add `describeDeliver(deliver?: string): string` beside
  `describeSchedule`: `""`/`immediate` → "delivered immediately"; `when-idle` → "held until the
  agent is idle (up to 2h)"; `skip-if-busy` → "skipped when the agent is busy"; any other string
  → the raw value (the `describeSchedule` unknown-kind precedent — never a fabricated phrasing).
  `CronEntry.deliver?: string` stays a string on the wire type; the helper is the one place that
  knows the enum.
- **Create dialog (`components/cron-create-dialog.tsx`)** — a second toggle group below the
  schedule kind segment, `role="group" aria-label="Delivery"`, three `controlClass({variant:
  "toggle"})` buttons in the `kindButton` shape: **Immediate** (default) / **When idle** /
  **Skip if busy**; local `type Deliver = "immediate" | "when-idle" | "skip-if-busy"` state; the
  chosen value is sent as `deliver` on the existing `CronCreateBody.deliver?: string`. The kind
  segment and the fixed `role: operator` target are unchanged; no `--idle-every` equivalent is
  added (a flat ladder is already expressible as Backoff with min = max).
- **CLOCK row (`components/sidebar/clock-panel.tsx`)** — a deliver chip in the row's existing
  `badge` idiom (`shrink-0 text-[10px] uppercase text-text-secondary`,
  `data-testid="clock-row-deliver"`), rendered ONLY when `entry.deliver` is set and not
  `immediate` (the norm adds zero chrome), placed after the target chip. Text is the raw value
  (`when-idle` / `skip-if-busy`) — the row is a glance surface, the sentence lives in the sheet.
- **Detail sheet (`components/cron-entry-detail-sheet.tsx`)** — one fact row in the existing
  `rowClass` list between "Next fire" and the mute/pin switches: label `Deliver`, value
  `describeDeliver(entry.deliver)`, `data-testid="cron-entry-deliver"`.
- **CRONS zone row (`components/server-clock-dashboard/crons-zone.tsx`, shipped on main by
  #918 after this intake was drafted)** — parity with the CLOCK row: inside the schedule cell,
  after `describeSchedule(entry)`, a marker in the same badge idiom (`ml-1 text-[10px] uppercase
  text-text-secondary`, `data-testid="crons-row-deliver"`) rendered ONLY when `entry.deliver` is
  set and not `immediate`; text is the raw value. No new column (the table is already seven
  columns wide at desktop density). `cronStateLabel` needs no change: `held (busy)` is
  when-idle-specific by construction, and a `skip-if-busy` entry is never past due for longer
  than one poll because the skip is logged.
- **Delivery-outcome phrasing (`components/server-clock-dashboard/model.ts` `describeOutcome`)**
  — gains one case beside `skipped-absent`: an outcome starting with `skipped-busy` renders
  `skipped (busy)` with `error: false` (prefix match — the wire string carries the state,
  `skipped-busy: active`). `rescheduled` passes through verbatim, uncolored, by the existing
  default branch (it is not an error and needs no phrasing). The Activity feed
  (`cron-activity-feed.tsx`) renders `delivery.outcome` verbatim today and is left as is.
- **Not in this change**: an edit surface consuming `POST /api/cron/edit` (the route's declared
  consumer, a later change), an `editCron` client helper, a `deliver` filter in the Activity
  feed, and any `describeOutcome` adoption by the Activity feed.

### H. Memory (hydrate) — see Affected Memory

### I. Tests

- `internal/cron/backoff_test.go`: `TestGapAfterFlat` (`min == max` ⇒ every rung returns `min`);
  `TestAnchorJoinFlatLadder` — `min = max = 3m`, own lines at T+3m, T+6m, T+9m, raw epoch
  T+9m+5s (attributed) ⇒ `Ladder{Anchor: T, Rung: 3}`, `NextFire == T+12m` (the walk's
  cap-saturated branch counts each 3 m gap as one more rung at the cap; `largestRungWithGapAtMost`
  seeds 1); raw epoch T+14m (not attributed) ⇒ `Rung 0`, anchor = epoch, next = epoch+3m.
- `internal/cron/deliver_test.go`: `TestEngineDelivererSkipIfBusy` — `active`/`waiting` ⇒
  `Outcome{Status: "skipped-busy", Detail: state, Held: false}` and zero sends; `idle`/`""` ⇒
  `delivered` with one send; `d.now` advanced past `DefaultHoldWindow` still ⇒ `skipped-busy`
  (no expiry path); state-read error ⇒ `failed` with the `agent-state read:` prefix.
- `internal/cron/tick_test.go`: `TestTickSkippedBusyAdvancesAnchor` — an `every 5m` entry
  (`livePaneRig`), a scripted deliverer returning `skipped-busy` then `delivered`: tick at T+5m
  appends exactly one `skipped-busy: active` line (`Fires == 1`, no `delivery-held` diag); tick at
  T+5m30s appends nothing (the anchor moved); tick at T+10m delivers. Extend
  `TestTickRateCapOutcomeClasses` with `skipped-busy` ⇒ not counted.
- `internal/cron/schema_test.go`: `TestEntryValidate` rows — `backoff min == max` accepted;
  `deliver: bogus` rejected while the three values and `""` pass.
- `cmd/rk/cron_add_test.go`: `TestCronAddIdleEvery` (expands to `{backoff, 3m, 3m}`; success
  line printed); `TestCronAddScheduleFlagMatrix` rows — `--idle-every 3m --every 1h` ⇒ exactly-one
  error, `--idle-every 3m --min 1m` ⇒ `--min/--max only apply with --backoff`, `--idle-every 0s`
  ⇒ positive-duration error, `--deliver skip-if-busy` ⇒ accepted and stored; `TestCronAddHelpText`
  asserts the `idle-every` flag usage mentions quiet/idle and the `Long` no longer says "delivery wave".
- `cmd/rk/cron_list_test.go`: one fixture entry with `deliver: skip-if-busy` renders in the
  `DELIVER` column and `--json`.
- `api/cron_test.go`: `POST /api/cron/create` with `"deliver":"bogus"` ⇒ 400.
- **Web UI (Vitest, colocated)**: `src/lib/cron-schedule.test.ts` — `describeDeliver` for the
  three values, `undefined`, and an unknown string; new `components/cron-create-dialog.test.tsx` —
  default submit posts `deliver: "immediate"`, selecting "Skip if busy" posts `skip-if-busy`, the
  group is keyboard-reachable (`aria-pressed` toggles); `sidebar/clock-panel.test.tsx` — no chip for
  `immediate`/absent, chip text `skip-if-busy` for that entry; `cron-entry-detail-sheet.test.tsx` —
  the `Deliver` row renders the sentence; `server-clock-dashboard/crons-zone.test.tsx` — no
  `crons-row-deliver` marker for `immediate`/absent, marker text `skip-if-busy` for that entry;
  `server-clock-dashboard/model.test.ts` — `describeOutcome("skipped-busy: active")` ⇒
  `{label: "skipped (busy)", error: false}`, `describeOutcome("rescheduled")` ⇒ verbatim,
  uncolored. No Playwright addition: no existing e2e opens the detail
  sheet or the create dialog, and the change is three leaf renders covered by unit tests
  (code-quality's "e2e where possible" — recorded, not skipped silently).
- **Addition C**:
  - `internal/cron/store_test.go`: `TestUpdateMergesFields` — an `apply` that sets `Schedule`
    and `Deliver` leaves `ID`, `Name`, `Target`, `Payload`, `IfAbsent`, `Respawn`, `Pinned`,
    `Muted`, `MutedUntil`, `CreatedBy` byte-identical (compare against the reloaded file); a merge
    that fails `validate()` (e.g. `Max < Min`) writes nothing; unknown id ⇒ `(_, false, nil)`;
    corrupt file ⇒ `refusing to mutate`.
  - `internal/cron/log_test.go` / `backoff_test.go`: `TestScheduleHistoryCutsAtReschedule`
    (own lines before a `rescheduled` line and the line itself are excluded; later lines kept);
    `TestJoinAnchorAfterReschedule` — deliveries at T+1m, T+3m, T+7m, `rescheduled` at T+8m, raw
    epoch T+2m (idle since before the edit) with the new `min = max = 3m` ⇒ `Ladder{Anchor: T+2m, Rung: 0}`,
    next fire T+5m — i.e. due immediately at T+8m (the agent has been quiet > 3 m).
  - `internal/cron/orphan_test.go`: `TestOrphanedSinceIgnoresRescheduled` — `[delivered, rescheduled]`
    ⇒ 0 (no streak); `[skipped-absent@T1, rescheduled@T2]` ⇒ T1 (the run is not restarted);
    `[rescheduled]` alone ⇒ 0, never `created_by.at`.
  - `internal/cron/evaluate_test.go` or `tick_test.go`: `TestRescheduledResetsEveryAnchor` — an
    `every 30m` entry with a delivery at T, `rescheduled` at T+20m, interval now 3 m: tick at
    T+20m30s ⇒ no fire; tick at T+23m ⇒ fire (`DueAt == T+23m`). Extend
    `TestTickRateCapOutcomeClasses` with `rescheduled` ⇒ not counted.
  - `cmd/rk/cron_edit_test.go`: `TestCronEditSchedule` (`edit <id> --idle-every 3m` on an
    `every 1h` entry ⇒ stored `{backoff, 3m, 3m}`, one `rescheduled` line with `Reason: edit`,
    the `edited …` data line); `TestCronEditDeliverOnly` (`--deliver skip-if-busy` ⇒ field
    changed + one `rescheduled` line); `TestCronEditNameOnlyNoLogLine`; `TestCronEditNoopNoLogLine`
    (same schedule re-given ⇒ no line); `TestCronEditFlagMatrix` — bare `edit <id>` usage error,
    two schedule flags, `--min` without `--backoff`, `--role/--session/--pane` rejected (exit 2),
    bad `--deliver`, `--respawn` without `--if-absent respawn`; `TestCronEditUnknownID` (`no entry`,
    exit 1); `TestCronEditIfAbsentClearsRespawn`; `TestCronEditPreservesFlagsAndCreator`
    (muted/pinned/created_by untouched); `TestCronEditHelpText` (immutability sentence, `edit`
    in the parent `Long`/`Short`).
  - `api/cron_test.go`: `TestCronEditRoute` — partial merge (`{id, deliver}` leaves the schedule
    intact), `schedule` replace, 404 unknown id, 400 on a `target` key / bad `deliver` /
    `max < min`, the `rescheduled` line appended exactly when schedule or deliver changed, SSE
    wake called, 200 body is the updated entry.

### Non-goals

- No new schedule kind, no schema field, no change to the schedule math (`schedule.go`,
  `backoff.go`, `cronexpr.go` math unchanged). The only evaluator-side edits are the
  `rescheduled` boundary in the log view (`ScheduleHistory` at the two `JoinAnchor` call sites)
  and `OrphanedSince`'s neutrality toward that line.
- `edit` never retargets, never mutes/pins, never rewrites `created_by`; no batch edit; no
  `--idle-every` refinement knobs.
- No change to the `rk operator` seed (`operator.go`): the reminder is a separate entry the
  operator (or a person) adds.
- Frontend scope is exactly § G: `deliver` shown and settable. `describeSchedule` is untouched
  (#14); no `editCron` client helper, no edit UI, no `--idle-every` control in the dialog — the
  edit surface that consumes `POST /api/cron/edit` is a later change (#27).
- No `hold: <dur>` knob on `when-idle` (rejected in favour of a named enum value).

## Affected Memory

- `run-kit/cron`: (modify) frontmatter/overview verb list and the CLI table gain `edit`
  (per-flag replace; immutable target/creator; the `rescheduled` append rule; the tick-flock
  hold); add-flag ↔ schema mapping gains `--idle-every` (sugar for `{backoff, min = max}`;
  exclusivity; `--min/--max` still a usage error without `--backoff`) and notes the parser is
  shared with `edit`; § Entry Schema `deliver` enum gains `skip-if-busy` and "the file changes
  only on add / rm / pin / mute / edit"; § EngineDeliverer three-policy rule; § Delivery Log
  outcome classes gain `skipped-busy` (logged, non-held, rate-cap-exempt) with the contrast to
  `held-busy`, and `rescheduled` (schedule history; backoff streak boundary via
  `ScheduleHistory`; ignored by `OrphanedSince`; rate-cap-exempt); § The Stateless Evaluator
  `backoff` sub-section gains the flat-ladder note, the two-clocks contrast, and the boundary
  rule; § Orphan TTL GC notes the neutrality; § HTTP API gains `POST /api/cron/edit` (partial merge, immutable target, shared
  `cron.Edit` helper); Requirements (`add` schedule-flag contract, a new `edit` contract,
  injection-engine delivery, delivery log, orphan expiry) updated; new Design Decisions: "Idle
  reminder is a flat backoff, not a kind", "`--idle-every` is CLI sugar over the unchanged
  schema", "`skip-if-busy` is a logged non-held outcome", "`edit` logs `rescheduled` as the
  anchor reset point", "`rescheduled` is a backoff streak boundary and orphan-neutral", "Target
  and creator are immutable under `edit`"; existing DDs "Held outcomes never reach the delivery
  log" (skip counter-example) and "The pin route waited for a consumer" (amended: the edit route
  lands on a declared UI consumer, recorded in place) gain a line each.
- `run-kit/ui/sidebar`: (modify) the CLOCK row gains the non-`immediate` deliver chip (badge
  idiom); the `Cron: new entry` dialog gains the Delivery toggle group and sends `deliver`.
- `run-kit/ui/cron-activity`: (modify) `describeDeliver` beside `describeSchedule` in
  `lib/cron-schedule.ts`; the entry detail sheet's `Deliver` fact row.
- `run-kit/ui/routes-and-shell`: (modify) the `/$server` CRONS zone row's schedule cell gains
  the non-`immediate` deliver marker; `describeOutcome` gains the `skipped (busy)` label and
  passes `rescheduled` through verbatim.
- `run-kit/toolkit-standards`: (modify) the `rk cron` family entry — seven members (the
  help-dump subtree), `edit`'s one data line and exit codes, and the usage-error list (exit 2
  classes) gaining the four-way schedule-flag exclusion, `--idle-every` with `--min/--max`, and
  `edit`'s bare-invocation / target-flag rejections.

## Impact

- **Backend** (`app/backend/internal/cron/`): `schema.go` (constant; optional `validate()` enum
  check), `deliver.go` (branch + doc), `tick.go` (comments; `countsTowardRate` doc for
  `skipped-busy` and `rescheduled`), `cronexpr.go` (comment), `store.go` (`Update`), `log.go`
  (`ScheduleHistory`; `OwnDeliveries` doc), `orphan.go` (`OrphanedSince` skips `rescheduled`),
  `evaluate.go` + `derive.go` (the two `JoinAnchor` call sites read `ScheduleHistory`). Tests:
  `backoff_test.go`, `deliver_test.go`, `tick_test.go`, `schema_test.go`, `store_test.go`,
  `log_test.go`, `orphan_test.go`, `evaluate_test.go`.
- **CLI** (`app/backend/cmd/rk/`): `cron_add.go` (flag, exclusivity, expansion, help/examples;
  schedule parser extracted for sharing), new `cron_edit.go` (+ `cron_edit_test.go`), `cron.go`
  (parent Short/Long verb + flag lists, `AddCommand`), tests `cron_add_test.go`,
  `cron_list_test.go`. `help-dump` gains one visible node (`edit`); the dump test is dynamic.
- **API**: `GET /api/cron` passes `deliver` through unchanged; `POST /api/cron/create` rejects an
  unknown `deliver` with 400 (via `validate()`) instead of storing it; new `POST /api/cron/edit`
  (`api/cron.go`, `router.go`). `api/cron_test.go` gains both.
- **Docs**: `docs/specs/cron.md` (§ Cron State, § Schedules, § Delivery, § API & CLI),
  `docs/site/cron-schedule-kinds.md` (backoff toggle, summary row, new deliver panel, header
  sentence, legend), `docs/specs/index.md` (wiki row description), `README.md` (`rk cron` verb
  list gains `edit` — a plain-text edit under the `readme-extraction` standard).
- **Frontend** (`app/frontend/src/`): `lib/cron-schedule.ts` (`describeDeliver`),
  `components/cron-create-dialog.tsx` (Delivery toggle group → `deliver` in the create body),
  `components/sidebar/clock-panel.tsx` (deliver chip), `components/cron-entry-detail-sheet.tsx`
  (`Deliver` row), `components/server-clock-dashboard/crons-zone.tsx` (deliver marker in the
  schedule cell), `components/server-clock-dashboard/model.ts` (`describeOutcome` skipped-busy
  label); tests colocated. Types unchanged (`deliver?: string`). No edit UI.
- **Behavior contracts**: two new delivery-log outcome strings — `skipped-busy: <state>` and
  `rescheduled` — appear in `GET /api/cron` `deliveries` and the Activity feed; `rk cron add`
  accepts one new schedule flag and one new `--deliver` value; `rk cron edit` is a new verb; an
  edit shows as the entry's `LAST-FIRED`/`lastFired` until its next outcome; existing entries and
  files are unaffected (no migration).
- **Constitution**: II (no DB — schedule remains a pure function of entry file + log + pane
  option), IV (no new page/route/palette action — the three web edits ride existing surfaces),
  toolkit standards (help layered; `docs/site` page conventions).

## Open Questions

- None outstanding — the four questions deferred at promptless intake creation were resolved on
  2026-09-10: #15 at the auto-clarify session; #14, #16, #27 by the user directly, overriding the
  auto-clarify answers (see § Clarifications; Assumptions #14, #15, #16, #27).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | No new schedule kind: the idle reminder is a `backoff` ladder with `min == max` | Discussed and verified in code — `gapAfter` returns `max` on every rung when `min == max`; `validate()` rejects only `max < min`; anchor-join gives the idle-anchored, non-self-resetting semantics for free | S:95 R:90 A:95 D:95 |
| 2 | Certain | `--idle-every <dur>` is CLI sugar expanding to `{kind: backoff, min: dur, max: dur}`; on-disk schema and evaluator untouched | Discussed — user chose sugar over a fourth kind (duplicates anchor-join machinery) | S:95 R:85 A:95 D:95 |
| 3 | Confident | `--idle-every` is a fourth mutually-exclusive schedule flag; `--min`/`--max` alongside it is a usage error (the existing `--min/--max only apply with --backoff` message); non-positive value is a usage error | Description said to assume the usage error; the existing `Changed("backoff")` gate already produces it, and the message is accurate (use `--backoff --min --max` for a non-flat ladder) | S:80 R:90 A:90 D:80 |
| 4 | Certain | Third deliver value `skip-if-busy`: agent state read once at due time; `active \| waiting` ⇒ outcome `skipped-busy` with `Held` unset (logged, anchor-advancing); `idle`/unknown deliver | Discussed with exact semantics; `everyAnchor`/`LastDelivery`/`OwnDeliveries` are outcome-agnostic so the log line alone advances the anchor — no evaluator change | S:95 R:80 A:90 D:95 |
| 5 | Certain | `skipped-busy` does not count toward the per-target rate cap (`countsTowardRate`) | Discussed — it is not a delivery attempt; the switch's default already returns false, a test pins it | S:90 R:95 A:95 D:95 |
| 6 | Confident | `cron`-kind `skip-if-busy` entries keep the `DefaultCronGrace` (2 m) due window; only `when-idle` extends to `DefaultHoldWindow` | The extension exists solely because a hold is realized as cross-tick retry; a skip decides once at due time and needs no extra window | S:55 R:90 A:90 D:85 |
| 7 | Confident | A state-read error under `skip-if-busy` is `failed: agent-state read: …`, byte-identical to the `when-idle` path | Same seam, same failure semantics; a logged failure advances the anchor as it does today | S:55 R:90 A:90 D:85 |
| 8 | Confident | No outcome filtering is added to `LastDelivery`/`OwnDeliveries`: a `skipped-busy` line anchors `every`, debounces `wake_on`, and joins the backoff attribution test like every other logged outcome (`failed`, `held-expired`, `rate-capped`) | The anchor advance is the feature; special-casing would reintroduce next-poll re-firing; the backoff attribution nuance is moot on flat ladders and `--idle-every` needs no deliver policy | S:70 R:80 A:90 D:85 |
| 9 | Certain | `rk cron list` needs no change — the `DELIVER` column and JSON `deliver` key already exist | Verified in `cron_list.go` / `cron_list_test.go`; a `skip-if-busy` fixture row is the only addition | S:90 R:95 A:100 D:100 |
| 10 | Confident | Explainer: `data-toggle="flat"` replay on the backoff panel (swapping the `.add` line), a summary-table row, and a NEW animated `deliver` Sim panel with three lanes (immediate / when-idle hold / skip-if-busy drop) over one busy strip plus a "busy stretch on/off" toggle; script avoids the `](` byte sequence | User asked for the page update and "ideally a small animated timeline consistent with the Sim/canvas style"; the `](` constraint comes from PR #907's rewriter fix | S:80 R:85 A:80 D:70 |
| 11 | Confident | Rewrite the stale `add` Long clause "validated now but enforced by the delivery wave" (the wave shipped) while adding the flag; parent `cron` Long lists `--idle-every` | Help is a published contract (toolkit principle 3); the clause is factually stale today | S:60 R:95 A:95 D:90 |
| 12 | Confident | No shell-completion tables to update: cobra generates completions from the flag set (`shell_init.go`); `260908-qyin-cron-schedule-completions` was cron-expression evaluation, not shell completion | Verified in `shell_init.go` and the qyin change's `.status.yaml` summary | S:60 R:95 A:95 D:95 |
| 13 | Confident | The `rk operator` seed (`operator.go`) is untouched; the reminder is a separate `--idle-every` entry | Discussed — "the operator reminder should be seeded with the flat backoff via `--idle-every`" refers to how the person creates it, not to the pinned operator tick | S:75 R:90 A:90 D:90 |
| 14 | Confident | A flat ladder keeps rendering as `backoff 3m→3m` in `cronScheduleSummary` (add success line + `list` SCHEDULE column) and keeps the existing frontend `describeSchedule` sentence — no renderer change | Asked — user chose the recommendation ("rest — your recommendations"), overriding the auto-clarify answer: the sugar is input-side, renderers show the on-disk truth; the odd frontend sentence is a display-only follow-up | S:75 R:90 A:80 D:80 |
| 15 | Certain | `Entry.validate()` enforces the `deliver` closed set (`""` allowed); `POST /api/cron/create` rejects unknown values with 400; `if_absent` untouched | Resolved at clarify (2026-09-10): a third value makes the open set a latent bug — an unknown string silently behaves as `immediate`; the CLI already rejects, the API should match | S:90 R:90 A:90 D:90 |
| 16 | Certain | Expose `deliver` in the web UI: a Delivery toggle group in the create dialog (sends `deliver`), a non-`immediate` chip on the CLOCK row (badge idiom), a `Deliver` fact row in the detail sheet, all via one `describeDeliver` helper; no edit UI yet | Asked — user chose yes ("expose deliver in web UI — yes"), overriding the auto-clarify out-of-scope answer; the three surfaces and idioms were read from the components | S:85 R:90 A:90 D:85 |
| 17 | Certain | `rk cron edit <id>`: each flag given replaces its field, omitted fields keep their values; schedule flags are `add`'s four-way exclusive set via a shared parser; target and creator immutable (target flags rejected, exit 2); mute/pin not accepted; one `edited …` data line on stdout; unknown id ⇒ `no entry <id>` exit 1 | Coordinator decided the semantics; the output/exit shape follows `rm`/`mute`/`pin` and toolkit principles 4/9 | S:90 R:85 A:90 D:90 |
| 18 | Certain | `cron.Update(dir, slug, id, apply)` in `store.go`: `loadForMutate` → apply on a copy → `validate()` + `ValidateRespawnIntent` on the merged entry → `saveEntries`; absent id ⇒ `(Entry{}, false, nil)` (the `Remove` shape); never touches ID/Target/CreatedBy/Muted/MutedUntil/Pinned | Coordinator named the location and the validation path; the closure shape mirrors `setFlag` | S:85 R:90 A:95 D:90 |
| 19 | Certain | `edit` appends one `rescheduled` log line (`Reason: edit`, no target, not rate-counted) when the merged schedule or deliver differs; `every`/`cron` count from the edit; the backoff ladder restarts from the idle epoch; the wake cursor is untouched | Coordinator decided ("record as decided, not deferred"); verified that `everyAnchor`/`LastDelivery` make the edit time the anchor with no evaluator change | S:90 R:75 A:85 D:85 |
| 20 | Confident | Name-, `if_absent`-, `respawn`-only edits and no-op edits (merged schedule + deliver equal the stored values) append no `rescheduled` line | Coordinator: "assume only schedule or deliver changes append"; a no-op reset would silently delay a due fire by a period | S:70 R:90 A:85 D:80 |
| 21 | Confident | `rescheduled` is a backoff **streak boundary** — the two `JoinAnchor` call sites read `ScheduleHistory(log, id)` (own lines strictly newer than the newest `rescheduled` line, boundary excluded) — while `LastDelivery` is unchanged and `OrphanedSince` **skips** `rescheduled` lines | Verified: without the boundary the walk ingests pre-edit deliveries as rungs; a cut view fed to `OrphanedSince` would fall back to `created_by.at` and could expire an old edited entry on its first unresolved tick; `LastDelivery` must still see the line for the `every`/`cron` anchor | S:60 R:80 A:85 D:75 |
| 22 | Confident | `edit` performs the entry write + log append under the tick flock (`acquireLock`, retried every 100 ms for ≤2 s; persistent contention ⇒ exit 1 `cron tick in progress — retry`); the other mutation verbs stay lock-free | A tick is sub-second; the lock orders the reset relative to a tick's read-evaluate-append. `AppendLog` is `O_APPEND` so bytes are safe regardless | S:45 R:85 A:80 D:70 |
| 23 | Confident | `--respawn` on edit replaces the whole argv; `--if-absent` set to a non-`respawn` value clears `respawn`; `ValidateRespawnIntent` on the merged entry is a usage error | An argv without its policy is dead weight and would trip the existing `--respawn only applies with --if-absent respawn` rule on the merged entry | S:50 R:90 A:85 D:75 |
| 24 | Confident | `LAST-FIRED` / `lastFired` show the `rescheduled` timestamp until the next outcome; no fired-vs-anchor display split | `LastDelivery` is outcome-agnostic today — `missed`/`skipped-absent`/`rate-capped` already display this way; a split is a separate change | S:50 R:90 A:80 D:70 |
| 25 | Confident | Verb name `edit` (not `change`, which collides with `fab change`); toolkit principle 5 satisfied; no separate verb-naming standard exists in `shll standards` (re-check at apply) | Coordinator's naming instruction; the standards list was enumerated during intake | S:70 R:85 A:85 D:85 |
| 26 | Confident | An edited operator tick persists across `rk operator` launches: `EnsureRoleEntry` never rewrites an existing entry's schedule (only the narrow respawn/debounce backfill) | Verified against `store.go` and `TestEnsureRoleEntryIdempotentAndNeverMutates` / `TestEnsureRoleEntryNarrowUpgrade` | S:65 R:85 A:90 D:90 |
| 28 | Confident | Post-rebase parity: the `/$server` CRONS zone row shows the same non-`immediate` deliver marker the CLOCK row gets (schedule cell, badge idiom), and `describeOutcome` labels `skipped-busy: <state>` as `skipped (busy)` while `rescheduled` stays verbatim; `cronStateLabel` unchanged | The dashboard (#918) and console Activity segment (#915) landed on main after this intake was drafted; the marker mirrors § G's CLOCK-row rule and the label mirrors the existing `skipped-absent` case — one surface sweep, no new idiom | S:70 R:90 A:90 D:85 |
| 27 | Certain | Add `POST /api/cron/edit` now (partial-merge body, immutable target, shared `cron.Edit` helper with the CLI, 200 returns the updated entry); the "pin route waited for a consumer" DD is amended in place — the consumer is the run-kit UI, declared rather than shipped | Asked — user chose to add the API ("can be used by the run-kit UI"), overriding the auto-clarify CLI-only answer | S:90 R:80 A:90 D:90 |

27 assumptions (11 certain, 16 confident, 0 tentative, 0 unresolved).

## Clarifications

### Session 2026-09-10

- **Q (#14):** Render a flat ladder (`min == max`) as `idle-every 3m` in the CLI summary and the
  frontend `describeSchedule` sentence? — **A:** Yes, in all three renderers; storage unchanged.
- **Q (#15):** Enforce the `deliver` closed set in `Entry.validate()` so the HTTP create route
  rejects unknown values? — **A:** Yes; `""` still allowed; `if_absent` untouched.
- **Q (#16):** Expose `deliver` in the web UI? — **A:** No, out of scope.
- **Q (#27):** Add a parity `POST /api/cron/edit`? — **A:** No; `edit` is CLI-only until a browser
  consumer exists, per the recorded pin-route decision.

### Session 2026-09-10 (user, superseding the auto-clarify answers above for #14 and #27)

- **#27:** "yes add the API also — can be used by the run-kit UI." → `POST /api/cron/edit` is in
  scope; the pin-route DD is amended (declared UI consumer), not reversed.
- **#14, #15, #16:** "rest — your recommendations." → #14 reverts to the intake author's
  recommendation (renderers unchanged; `backoff 3m→3m` stays); #15 (enforce `deliver` in
  `validate()`) stands.
- **#16 (follow-up):** "expose deliver in web UI — yes." → § G added: create-dialog Delivery
  toggles, CLOCK-row chip, detail-sheet `Deliver` row, `describeDeliver` helper; no edit UI.

### Session 2026-09-10 (orchestrator, post-rebase surface sweep)

- The branch was fast-forwarded to `origin/main` `8ac2b368` (11 commits, including #915 Console
  Activity Segment + Status-Bar Clock Chip and #918 tmux Server Page Clock Dashboard). Sweep of the
  new cron surfaces: the CRONS zone row gains the deliver marker (parity with § G's CLOCK-row
  chip), `describeOutcome` gains the `skipped (busy)` label, `cronStateLabel` and the Activity
  feed need nothing, the detail sheet's row structure still matches § G, and `docs/specs/cron.md`
  § UI gains one sentence. Recorded as Assumptions #28.
