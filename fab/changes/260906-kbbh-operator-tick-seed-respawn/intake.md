# Intake: Operator-Tick Seeding + Role Respawn

**Change**: 260906-kbbh-operator-tick-seed-respawn
**Created**: 2026-09-06

## Origin

Operator dispatch (one-shot, autonomous): C4 of the cron clock plan
(`fab/plans/sahil/26-09-06-cron-clock-plan.md`), wave 2 — the last change before the
plan's manual GATE. Depends on C1 (`internal/cron` core + evaluator, PR #855), C2
(`rk cron` CLI, PR #856), and C3 (daemon ticker + delivery, PR #857), all merged into
this worktree's base. Design authority: `docs/specs/cron.md` (§ Cron State's operator-tick
example, § Targets & Fire-Time Resolution's `if_absent` ladder, § One Operator Per Server,
§ Open Questions #3). Seed:

> Operator-tick seeding + role respawn: rk operator idempotently seeds the operator-tick
> entry (backoff 60s->30m, wake_on agent-state-change, suppress_while:
> [operator-loop-fresh, nothing-tracked], pinned); if_absent: respawn for role targets --
> spawn-then-deliver composite, kickoff prompt (/fab-operator) on first delivery, bare
> ticks after. Zero fab-operator skill changes in this wave -- the backstop must be
> invisible to a healthy operator.
>
> Also decide open question 3 from the plan (mutual watching: does the loop warn when
> the cron's delivery-log stamp goes stale?) as part of this change.

## Why

1. **The gate cannot pass without a seeded entry.** Wave 2's manual GATE requires "kill the
   operator's `/loop`: a tick arrives within one backoff step" and "healthy loop for 30+ min:
   zero cron deliveries." Both require the operator-tick entry to already exist on every
   server that runs `rk operator` — nothing today creates it. Without this change the
   substrate (C1–C3) is fully built but inert for its primary client.
2. **The backstop must self-install, not be hand-configured.** The dev-ws-sahil01 incident
   (`docs/specs/cron.md` § The Problem #1) happened because the operator's only clock lived
   inside a session that died silently. A cron entry an operator has to be told to create
   defeats the purpose — `rk operator` (the one command every operator session runs to come
   into existence) is the natural, zero-effort seeding point.
3. **Respawn closes the other half of the incident class.** The existing substrate handles
   "the `/loop` died but the operator window is still there" (the entry fires, the role
   target resolves, delivery proceeds). It does NOT handle "the operator window itself is
   gone" — C3 explicitly degrades `if_absent: respawn` to a `notify` + `respawn-unimplemented`
   diagnostic (`internal/cron/tick.go:341-346`). A cron backstop that cannot bring back a
   fully-dead operator only half-solves the incident.
4. **Zero fab-operator skill changes, by design.** The gate's own text states this
   requirement: a healthy operator (loop alive, window alive) must see no behavior change at
   all. Every piece of this change lives in `rk`/`internal/cron` — nothing in
   `fab-operator.md` is touched. This also means the reverse side of open question 3 (the
   loop watching the cron) cannot be implemented as a loop-side change this wave without
   violating that constraint — see the decision below.

## What Changes

Two independent additions to the shipped substrate, both scoped to `app/backend`, plus one
documentation resolution. **No fab-operator skill changes** (constraint from the dispatch,
verified by grep before ship — `docs/memory` note below).

### 1. `rk operator` idempotently seeds the operator-tick entry

`cmd/rk/operator.go`'s `runOperator` gains a seed step, run unconditionally on every
invocation — **before** the singleton probe (server-scoped seeding needs no tmux window
state, so it must not sit behind either the "switch to existing" or "create new" branch;
both return early today) and **best-effort**, mirroring the snapshotter/ticker posture in
`serve.go`: a seed failure is logged (e.g. one `fmt.Fprintf(cmd.ErrOrStderr(), ...)` line)
and never turns into a non-zero exit — opening the operator tab is the command's job, and
that must succeed even if the state dir is unwritable.

**Idempotency key**: a server holds at most one operator role (`docs/specs/cron.md` § One
Operator Per Server — the same radio invariant `@rk_win_role=operator` already enforces), so
the natural idempotency check is "does this server's entry file already contain an entry with
`target: {kind: role, role: operator}}`" — not a name/payload string match, which would drift
if the payload text ever changes. Concretely, a new `internal/cron` helper (store.go):

```go
// EnsureRoleEntry seeds a role-target entry if this server has none yet. It
// scans the existing entries for a Target{Kind: TargetRole, Role: spec.Target.Role}
// match; a hit is a no-op (returns the existing entry, created=false); a miss
// calls Add with spec (created=true). Existing entries are never mutated —
// re-seeding after a manual edit (e.g. a user changed the backoff bounds)
// leaves the user's edit alone.
func EnsureRoleEntry(dir, slug string, spec Entry) (entry Entry, created bool, err error)
```

The seeded spec (the spec's own operator-tick example, `docs/specs/cron.md` § Cron State):

```yaml
name: operator tick
schedule: { kind: backoff, anchor: operator-idle, min: 60s, max: 30m }
wake_on: { event: agent-state-change, scope: server, debounce: 10s }
suppress_while: [operator-loop-fresh, nothing-tracked]
target: { kind: role, role: operator }
payload: "operator tick"
deliver: immediate
if_absent: respawn
pinned: true
```

`created_by` is populated the same way `rk cron add` does inside a pane
(`created_by: {pane: $TMUX_PANE, at: now}`, session left empty) — `rk operator` already runs
inside the pane it just resolved/created, so the same auto-capture inputs
(`operatorOriginalTMUXFn()`, `$TMUX_PANE`) are available. The server slug is derived exactly
as `rk cron`'s caller-socket rule (`tmux.OriginalTMUX` → socket basename, the `cliServerLabel`
helper already in `cmd/rk/agent_kickoff.go`) — no new resolution logic.

**Re-seeding never overwrites a user's edit.** If the entry already exists (any values —
including a user who ran `rk cron mute` or hand-edited the backoff bounds), `EnsureRoleEntry`
leaves it untouched. This is deliberate: idempotent seeding establishes the entry once: it is
not a config-reconciliation loop that would fight a user's `rk cron` mutations.

### 2. `if_absent: respawn` for role targets — the spawn-then-deliver composite

`internal/cron/tick.go`'s absent-fire disposition switch (lines ~338-347) currently degrades
`IfAbsentRespawn` unconditionally to `notify` + a `respawn-unimplemented` diagnostic. This
change makes that real **for role targets only** (`fire.Entry.Target.Kind == TargetRole`) —
session-target respawn (closed-session `claude --resume`) stays out of scope per the plan
(C8, wave 4); a `respawn` entry on a `session`/`pane` target keeps today's notify-degrade
behavior unchanged.

**New seam** on `cron.Deps` (mirroring `Deliverer`/`Notifier`):

```go
// Respawner brings a dead role target back (role targets only, this wave —
// session-target respawn via claude --resume is C8's scope). Nil means the
// existing notify-degrade path runs for every if_absent: respawn entry,
// exactly as today (a daemon built before this change keeps working).
Respawner func(ctx context.Context, fire Fire) Outcome
```

`tick.go`'s disposition switch branches: `IfAbsentRespawn` + `Target.Kind == TargetRole` +
non-nil `Deps.Respawner` calls it and logs the returned `Outcome` (a new outcome class,
`respawned` on success — see § Delivery Log below); every other combination (no seam wired,
or a non-role target) falls through to the existing notify-degrade branch unchanged.

**The respawner implementation** lives in `cmd/rk` (new `cron_respawn.go`), because it needs
`internal/riff.ResolveLauncher` + the tmux new-window/role-stamp calls that `internal/cron`
cannot import (the package comment on `cronInjectTmux` already documents this boundary: "cron
cannot import cmd or riff"). Wired into `serve.go` alongside the existing ticker/deliverer
construction:

```go
cron.NewTicker(cron.Deps{
    Dir:       cronDir,
    Deliverer: cron.NewEngineDeliverer(),
    Respawner: rkCronRespawnRole, // new
}).Start(ctx)
```

**Mechanics — reuse, don't reimplement.** `cmd/rk/operator.go`'s `runOperator` already does
"create a window, stamp `@rk_win_role=operator` atomically, deliver a typed kickoff through
`inject.DeliverWhenReady`" (the exact **spawn-then-deliver composite** named in
`docs/specs/agent-messaging.md` § Spawn and trust walls and in the dispatch). This change
extracts the create-and-mark-window portion of that flow (currently inlined in `runOperator`,
lines ~217-262: `new-window` → resolve window id → `stampOperatorRole`) into a shared,
testable function callable from both the interactive command and the new headless respawner
— the same "extract a package-level seam so the core is testable without a live tmux
server" pattern the file already uses for `operatorRunFn`/`operatorRunOutputFn`.

The respawner's flow for a fire on server `fire.Server`:

1. Restore the daemon's own env for that server (TMUX scrubbed per the package's existing
   `cronInjectTmux` adapter — `-L <server>` addressing, never "current server").
2. Run the extracted create-and-mark step (no singleton probe needed here: `if_absent:
   respawn` only fires when target resolution already failed, i.e. no live operator window
   exists — but the extracted function stays defensive and re-checks, since a race between
   evaluation and delivery is possible across a 30s tick boundary).
3. **Spawn-then-deliver**, via `inject.DeliverWhenReady` (bounded by a deadline — reuse
   `operatorDeliverDeadline`, 25s): classify the fresh pane (`ready`/`parked`/`narrow`/`gone`)
   and only deliver on `ready`.
4. **The delivered text is always the kickoff prompt** (`operatorKickoffPrompt`,
   `"/fab-operator"`) — **never** `fire.Entry.Payload` ("operator tick"). This is the spec's
   "a respawn never delivers the bare tick": a fresh session has no tick convention in
   context, so its first delivery must be the launcher's kickoff. This falls out of the
   control flow for free — respawn only runs on the `Absent` branch (target didn't resolve);
   once the role resolves live again, the entry's *next* fire takes the normal `Fires` branch
   and delivers the bare payload through the existing `EngineDeliverer`, exactly as today.
   No extra "have we kicked off yet" state is needed.
5. **A `parked`/`narrow`/`gone` classification, or a delivery send error, escalates via
   `Deps.Notifier`** (the same fail-silent `rk notify` seam `if_absent: notify` already uses)
   — "the clock never auto-answers walls — judgment is caller-side and the daemon has no
   judge" (`docs/specs/cron.md` § `if_absent` ladder). The daemon never runs the interactive
   judgment-round carve-out (`_preamble.md` § The pane readiness gate) — that exists for a
   human-attended dispatch loop; here a wall is unconditionally a `rk notify` escalation, no
   round spent.

### 3. Delivery log — one new outcome class

`respawned` (successful create + deliver) joins the existing outcome vocabulary
(`delivered`, `failed: …`, `skipped-absent`, `notified-absent`, `rate-capped`,
`no-deliverer`); a failed respawn attempt (any readiness classification other than `ready`,
or a send error) logs `respawn-failed: <detail>`. Both are non-held outcomes (§ Delivery Log
in `docs/memory/run-kit/cron.md` — only `when-idle` busy holds are un-logged) — a respawn
attempt, successful or not, advances the entry's anchor exactly like any other disposition,
so a persistently-dead operator produces one respawn attempt per due period, not one per
30s tick. The rate cap (`DefaultTargetRatePerHour`) applies to `respawned`/`respawn-failed`
the same way it already applies to absent-fire dispositions (keyed on entry ID, since a fresh
respawn attempt has no resolved pane yet).

### 4. Open Question 3 — decided, not deferred to a loop-side mechanism

**Decision: do not build a reverse loop-watches-cron mechanism this wave.** Resolve
`docs/specs/cron.md` § Open Questions item 3 by rewriting it to record the decision (not
leaving it open), and add a one-line pointer in
`fab/plans/sahil/26-09-06-cron-clock-plan.md`'s C4 row.

Rationale (four points, all from the dispatch, reproduced here for `intake.md`'s
state-transfer role since the apply-stage agent has no other access to this reasoning):

1. **The zero-skill-change constraint makes a loop-side implementation impossible this
   wave.** The only place a "does the loop warn" check could live is inside the `/loop`
   itself, i.e. `fab-operator.md` — off-limits by the gate's own requirement.
2. **The risk is asymmetric.** A dead cron backstop while the loop is healthy is a benign
   no-op — the loop is already doing the monitoring job the cron exists to back up. There is
   no incident in that state, unlike the reverse (cron backstop alive, loop dead — the
   incident C1-C4 exist to prevent).
3. **C5 (wave 3) already builds the generic staleness mechanism** for the primary direction
   (cron watching the loop, via the fab operator state file's `last_tick_at` — CLOCK header
   warning, dimmed watched-row indicators, the mobile staleness banner). The reverse
   direction, if ever built, would consume the *cron's own* delivery-log staleness through
   the same UI surface rather than needing a bespoke loop-side check.
4. **C10 collapses the two clocks into one.** Once the fab-operator skill retires `/loop` in
   favor of the cron entry's union predicate (wave 4), there is no second clock left for a
   loop to watch — a standalone reverse-watch mechanism built now would be dead code by C10.

The spec edit replaces item 3's text with the decision + a link to this change; no code
implements a reverse check in this wave.

### Explicitly out of scope (later waves / this dispatch's own boundaries)

- `session`/`pane` target respawn (C8, wave 4) — the `Respawner` seam is role-only; a
  `respawn` entry on any other target kind keeps the current notify-degrade path.
- `cron`-kind schedule evaluation, the `when-idle` hold-window bound, 5-field cron
  expressions — untouched, other waves' scope.
- Any `fab-operator.md` / `fab/plans/sahil/26-09-03-operator-pulse-plan.md` edit beyond the
  single open-question-3 pointer line in the cron-clock plan doc.
- The CLOCK sidebar / agents-tile dashboard / mobile Activity feed (wave 3) — this change
  adds no API, no SSE wiring, no frontend.

## Affected Memory

- `run-kit/cron`: (modify) `EnsureRoleEntry` (the idempotent seed helper), the `Respawner`
  seam on `Deps`, real `if_absent: respawn` behavior for role targets (mechanics + the
  `respawned`/`respawn-failed` outcome classes and their rate-cap/anchor-advance treatment),
  and a Design Decisions entry for the role-only-this-wave scoping + the "kickoff always,
  never the bare payload" respawn-delivery rule
- `run-kit/rk-riff`: (modify) `rk operator` gains the seed-entry side effect (idempotent,
  best-effort, runs before the singleton probe); the create-and-mark-window logic is
  extracted into a function shared with the new cron respawner
- `run-kit/daemon-lifecycle`: (modify) one line — `serve.go`'s cron ticker construction gains
  the `Respawner` wiring alongside the existing `Deliverer`

## Impact

- **Code**: `app/backend/cmd/rk/operator.go` (seed call + extracted create-and-mark helper),
  new `app/backend/cmd/rk/cron_respawn.go` + test (the `Respawner` implementation), new
  helper in `app/backend/internal/cron/store.go` (`EnsureRoleEntry`) + test,
  `app/backend/internal/cron/tick.go` (respawn disposition branch, new outcome strings) +
  test, `app/backend/internal/cron/schema.go`/`tick.go` (Deps gains `Respawner`),
  `app/backend/cmd/rk/serve.go` (one-line wiring addition). No new files/packages beyond
  `cron_respawn.go`.
- **Docs**: `docs/specs/cron.md` § Open Questions (item 3 resolved, not left open);
  `fab/plans/sahil/26-09-06-cron-clock-plan.md` (C4 row gains a one-line pointer to the
  resolution — `fab/` and `docs/` are both in `true_impact_exclude`, so this is bookkeeping,
  not scope creep).
- **No** frontend, API, HTTP surface, or settings-registry changes. No `fab-operator.md` or
  any other fab-kit skill file changes — verify with a grep sweep of the diff against
  `.claude/skills/fab-operator/` and any fab-kit path before ship, mirroring the
  comment-provenance sweep pattern already used elsewhere in this pipeline.
- **Downstream**: this change satisfies the precondition for the wave 2 manual GATE (an
  operator server now has a live operator-tick entry the moment `rk operator` has ever run on
  it). The gate itself (kill `/loop` → tick within one backoff step; healthy loop → zero
  deliveries for 30+ min; `rk cron add/list/rm` from a pane; orphaned socket spawns no
  server) is a manual verification step on a live server, not an automated task in this
  change's plan — but the plan SHOULD include a task that walks it once locally before ship.
- **Tests to run**: `go test ./cmd/rk/... ./internal/cron/...` (scoped), then the backend
  suite; no frontend/e2e tests apply (no UI surface).

## Open Questions

- None blocking for this change's own scope. (Plan open question 3 from
  `docs/specs/cron.md` is *resolved*, not deferred, by § What Changes item 4 above.)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Idempotency key for seeding is `target: {kind: role, role: operator}` presence, not a name/payload string match | Spec's "one operator per server" radio invariant makes role-target presence the unambiguous, drift-proof key; a string match would break the moment a user edits the display name | S:75 R:85 A:90 D:85 |
| 2 | Certain | Seed values verbatim from the dispatch + the spec's own operator-tick example (`backoff 60s→30m`, `wake_on agent-state-change` scope server debounce 10s, `suppress_while: [operator-loop-fresh, nothing-tracked]`, `deliver: immediate`, `if_absent: respawn`, `pinned: true`, payload `"operator tick"`) | Both the dispatch and `docs/specs/cron.md` § Cron State give these values explicitly; no interpretation needed | S:95 R:80 A:90 D:95 |
| 3 | Confident | Seeding runs unconditionally at the top of `runOperator` (before the singleton probe), best-effort (log-and-continue on failure, never a non-zero exit) | Seeding is disk-only and independent of tmux window state, so it cannot sit behind either early-return branch; the snapshotter/ticker best-effort posture is the established pattern for non-critical daemon-adjacent side effects | S:60 R:80 A:75 D:70 |
| 4 | Confident | New `EnsureRoleEntry(dir, slug, spec) (Entry, bool, error)` helper in `internal/cron/store.go`, never mutating an existing match | Mirrors `Add`'s existing signature shape and atomic-write posture; "never overwrite a user's edit" follows directly from entry files being INTENT (Constitution II) that only `rk cron` verbs should mutate | S:55 R:85 A:80 D:75 |
| 5 | Confident | `Respawner func(ctx, Fire) Outcome` is a new `cron.Deps` field, called only when `Target.Kind == TargetRole`; nil or non-role falls through to the existing notify-degrade path unchanged | Mirrors the existing `Deliverer`/`Notifier` seam shape exactly; the role-only guard matches the plan's explicit C8-defers-session-respawn scoping | S:65 R:80 A:80 D:75 |
| 6 | Confident | The respawner implementation lives in `cmd/rk/cron_respawn.go`, extracting the create-and-mark-window logic out of `operator.go`'s `runOperator` into a shared function | `internal/cron` cannot import `cmd`/`riff` (documented package boundary already in `deliver.go`'s comments); `cmd/rk` is where `EngineDeliverer`'s sibling seams (e.g. the existing tutorial/operator kickoff plumbing) already live | S:60 R:75 A:80 D:70 |
| 7 | Certain | Respawn delivery is always the kickoff prompt (`/fab-operator`), never the fire's payload; the next normal (non-absent) fire delivers the bare payload as today | Directly stated in both the dispatch and the spec ("a respawn never delivers the bare tick"); falls out of the existing Absent-vs-Fires branch split with no new state needed | S:85 R:75 A:90 D:90 |
| 8 | Confident | A non-`ready` readiness classification or a send error during respawn escalates via the existing `Deps.Notifier` seam (fail-silent `rk notify`), never an in-tick retry or a blind delivery | Spec: "the clock never auto-answers walls — judgment is caller-side and the daemon has no judge"; the daemon has no human to spend a judgment round on, so escalate-don't-wait is the only safe posture; reuses the seam `if_absent: notify` already exercises | S:60 R:75 A:75 D:70 |
| 9 | Confident | New delivery-log outcome classes `respawned` / `respawn-failed: <detail>`, both non-held (they advance the anchor and count toward the rate cap, keyed on entry ID) | Matches the existing outcome-naming convention (`skipped-absent`, `notified-absent`, `rate-capped`) and the "every disposition advances the anchor" rule that throttles repeat attempts to once per due period | S:55 R:80 A:75 D:70 |
| 10 | Confident | Open question 3 is resolved as "no reverse loop-side mechanism this wave"; `docs/specs/cron.md` is edited to record the decision (not left as an open question), plus a one-line pointer in the plan doc | Dispatch supplies the full rationale verbatim (asymmetric risk, zero-skill-change constraint, C5's staleness UI already covers the general case, C10 collapses the two clocks) — this is a judgment call, not a technical determination, so graded Confident rather than Certain despite the strong rationale | S:70 R:90 A:60 D:65 |
| 11 | Certain | `change_type: feat` | Explicit in the dispatch ("Pin change_type appropriately (likely feat)") and correct under the taxonomy — new capability (seeding + respawn), not a fix/refactor/docs-only change | S:90 R:95 A:95 D:95 |

11 assumptions (4 certain, 7 confident, 0 tentative, 0 unresolved).
