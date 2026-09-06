# Plan: Operator-Tick Seeding + Role Respawn

**Change**: 260906-kbbh-operator-tick-seed-respawn
**Intake**: `intake.md`

## Requirements

### Cron: Idempotent Operator-Tick Seeding

#### R1: `EnsureRoleEntry` seeds a role-target entry exactly once per server
`internal/cron` SHALL provide `EnsureRoleEntry(dir, slug string, spec Entry) (entry Entry, created bool, err error)`: it SHALL scan the server's existing entries for one whose `Target.Kind == TargetRole && Target.Role == spec.Target.Role`; a match SHALL be returned unmodified with `created = false` (no file write); no match SHALL call `Add(dir, slug, spec)` and return the newly assigned entry with `created = true`.

- **GIVEN** an empty (or absent) entry file for server `work`
- **WHEN** `EnsureRoleEntry(dir, "work", operatorTickSpec)` runs
- **THEN** the file gains one entry with `target: {kind: role, role: operator}` and `created == true`
- **AND GIVEN** the same call runs again (any prior mutation to that entry, e.g. a user `rk cron mute`)
- **THEN** the file is unchanged, the existing entry is returned as-is, and `created == false`

#### R2: `rk operator` idempotently seeds the operator-tick entry
`runOperator` (`cmd/rk/operator.go`) SHALL call `EnsureRoleEntry` with the spec's fixed operator-tick fields (`docs/specs/cron.md` § Cron State: `schedule: {kind: backoff, anchor: operator-idle, min: 60s, max: 30m}`, `wake_on: {event: agent-state-change, scope: server, debounce: 10s}`, `suppress_while: [operator-loop-fresh, nothing-tracked]`, `target: {kind: role, role: operator}`, `payload: "operator tick"`, `name: "operator tick"`, `deliver: immediate`, `if_absent: respawn`, `pinned: true`, `created_by: {pane: $TMUX_PANE, at: now}`) unconditionally near the top of the command, before the singleton-probe/early-return branches, using the server slug derived the same way `rk cron`'s caller-socket rule does (`tmux.OriginalTMUX` → socket basename via the existing `cliServerLabel` helper) and `cron.DefaultDir()`. A seed failure SHALL be non-fatal: print one warning line to stderr and continue — it MUST NOT change the command's exit code or skip opening/switching to the operator window.

- **GIVEN** a server that has never run `rk operator` before (no cron dir)
- **WHEN** `rk operator` runs
- **THEN** the server's cron entry file gains the role:operator entry described above, AND the command still opens a new operator window, stamps its role, and exits 0
- **AND GIVEN** the cron state dir is unwritable (e.g. permissions)
- **WHEN** `rk operator` runs
- **THEN** a warning prints to stderr naming the seed failure, AND the command still succeeds in opening/switching to the window and exits 0

### Cron: Role-Target Respawn

#### R3: `Deps` gains a role-scoped `Respawner` seam
`cron.Deps` (`internal/cron/tick.go`) SHALL gain a field `Respawner func(ctx context.Context, fire Fire) Outcome`. The absent-fire disposition switch SHALL branch: when `fire.Entry.IfAbsent == IfAbsentRespawn && fire.Entry.Target.Kind == TargetRole && deps.Respawner != nil`, it SHALL call `deps.Respawner(ctx, fire)` and log the returned `Outcome` as the disposition (§ R6); every other combination (nil `Respawner`, or `IfAbsentRespawn` on a non-`TargetRole` target) SHALL keep today's `notify` + `respawn-unimplemented`-diagnostic degrade byte-for-byte unchanged.

- **GIVEN** a due-but-absent fire for a `role:operator` entry with `if_absent: respawn` and a non-nil `Deps.Respawner`
- **WHEN** `Tick` processes the absent-fire disposition
- **THEN** `Respawner` is called with that `Fire`, and no `respawn-unimplemented` diagnostic is recorded
- **AND GIVEN** the same entry but a `session`-target fire, or a nil `Respawner`
- **THEN** the existing `notify` + `respawn-unimplemented` path runs exactly as before this change

#### R4: The production Respawner brings back a dead role-target window
The production `Respawner` (`cmd/rk/cron_respawn.go`, wired into `cron.Deps` in `serve.go` alongside the existing `EngineDeliverer`) SHALL, for a role-target fire on `fire.Server`: (a) ensure a live operator window exists — reusing the create-and-mark logic (singleton probe, `new-window`, atomic `stampOperatorRole`) extracted from `runOperator` into a shared helper parameterized on the tmux-calling seam (matching the `operatorRunFn`/`operatorRunOutputFn` shape) so the daemon can supply its own `-L <server>`-addressed, `TMUX`/`TMUX_PANE`-scrubbed implementation distinct from the CLI's `$TMUX`-restored one; (b) run `inject.DeliverWhenReady` bounded by a deadline to classify the fresh pane's readiness and, only on a `ready` classification, deliver `operatorKickoffPrompt` ("/fab-operator") through it — **never** `fire.Entry.Payload`.

- **GIVEN** no live window carries `@rk_win_role=operator` on server `work`
- **WHEN** the Respawner runs for a `role:operator` fire on `work`
- **THEN** a new window is created on `work`, atomically stamped `@rk_win_role=operator`, and — once its agent reports `ready` — receives the typed `/fab-operator` kickoff (not the entry's `"operator tick"` payload)

#### R5: Respawn walls and failures escalate, never retry blind or in-tick
A `parked`/`narrow`/`gone` readiness classification, an `AwaitReady` timeout, or a send error during respawn SHALL escalate via the existing `Deps.Notifier` seam (fail-silent `rk notify`, the same one `if_absent: notify` already uses) — the daemon SHALL NOT spend an interactive judgment round (there is no human to answer) and SHALL NOT deliver into a pane it could not classify as `ready`.

- **GIVEN** the freshly created window's pane reports `parked` (a trust dialog) within the readiness deadline
- **WHEN** the Respawner classifies it
- **THEN** `Deps.Notifier` is called (fail-silent) naming the entry and server, no delivery is attempted, and the Respawner returns without blocking the tick further

#### R6: Respawn outcomes are new non-held log classes
A successful respawn (window ensured + kickoff delivered) SHALL return `Outcome{Status: "respawned"}`; any escalated failure (§ R5) SHALL return `Outcome{Status: "respawn-failed", Detail: <classification or error>}`. Both are non-held: `Tick` SHALL append one delivery-log line per attempt (as it already does for every other absent-fire disposition) so the entry's anchor advances and the per-target rate cap (keyed on entry ID, matching the existing absent-fire keying) counts respawn attempts exactly as it counts `notified-absent`/`skipped-absent` lines.

- **GIVEN** a due-but-absent role-target fire whose respawn succeeds
- **WHEN** `Tick` logs the disposition
- **THEN** the log gains one line with outcome `respawned`, and the entry's next fire is computed from this delivery (not immediately due again)

### Cron: Documentation — Open Question 3 Resolved

#### R7: The mutual-watching open question is resolved, not left open
`docs/specs/cron.md` § Open Questions item 3 SHALL be rewritten from a question into a recorded decision: no reverse loop-side cron-staleness check is built this wave, with its four-point rationale (zero-skill-change constraint; asymmetric risk — a dead backstop while the loop is healthy is a benign no-op; C5's staleness UI already covers the general case and the reverse direction can piggyback on it; C10 collapses the two clocks into one). `fab/plans/sahil/26-09-06-cron-clock-plan.md`'s C4 row SHALL gain a one-line pointer to this resolution.

- **GIVEN** the current open-question phrasing ("...should the operator's tick also check the cron's health...? Cheap and symmetric; decide at P1.5.")
- **WHEN** this change ships
- **THEN** the spec text is replaced with the decision text above (or a close paraphrase preserving all four rationale points) and no longer reads as an open question

### Non-Goals

- `session`/`pane` target respawn (closed-session `claude --resume`) — C8, wave 4. A `respawn` entry on a non-role target keeps today's notify-degrade path.
- `cron`-kind (5-field expression) schedule evaluation, the `when-idle` hold-window bound, HTTP API / SSE / frontend surfaces — untouched, later waves' scope.
- Any edit to `fab-operator.md` or any other fab-kit skill file — verified by an explicit grep sweep before ship (§ Acceptance, Security).
- A reverse loop-side cron-staleness check (the R7 decision is documentation-only this wave).

### Design Decisions

#### Idempotency key: role-target presence, not name/payload
**Decision**: `EnsureRoleEntry` treats "a server already has an entry with `target: {kind: role, role: X}}`" as the sole seeded/not-seeded signal.
**Why**: the spec's "one operator per server" radio invariant (`@rk_win_role=operator`) makes role-target presence the unambiguous, drift-proof key — it survives a user renaming the entry or editing its payload text.
**Rejected**: matching on `name`/`payload` string equality (breaks the moment a user or a later change edits the display text); a reserved fixed entry ID (adds a special-cased ID outside `Add`'s uniform random-assignment contract for no real gain).
*Introduced by*: 260906-kbbh-operator-tick-seed-respawn

#### `Respawner` mirrors `Deliverer`/`Notifier` exactly
**Decision**: `Respawner func(ctx context.Context, fire Fire) Outcome`, nil-safe, called only for role targets.
**Why**: `cron.Deps`'s existing seams already establish "the disk/logic core stays testable via fakes, production wires the real implementation in `serve.go`" — a third seam of the same shape costs nothing new to learn and keeps `tick.go`'s disposition switch a simple, uniform branch.
**Rejected**: overloading `Deliverer` itself to also handle absent-fire respawn (conflates two different call sites — resolved-fire delivery vs. absent-fire disposition — with different inputs and different failure semantics).
*Introduced by*: 260906-kbbh-operator-tick-seed-respawn

#### Kickoff-vs-bare-payload needs no new state
**Decision**: the Respawner always delivers the kickoff prompt; the entry's next (non-absent) fire delivers the bare payload through the ordinary `EngineDeliverer` path, unchanged.
**Why**: `if_absent: respawn` only runs when target resolution already failed — by construction there is no live agent context to resume, so every respawn is "first contact." Once the role resolves live, the *next* fire takes the `Fires` branch (not `Absent`), which already delivers `fire.Entry.Payload` via `EngineDeliverer` — no bookkeeping is needed to distinguish "has this entry ever kicked off" from "is the target currently absent."
**Rejected**: a persisted "has-kicked-off" flag on the entry or in a sidecar (an intent file is the wrong place for a runtime fact, and the branch split already gives this behavior for free).
*Introduced by*: 260906-kbbh-operator-tick-seed-respawn

#### Escalate-don't-wait for respawn walls
**Decision**: any non-`ready` classification or send error during respawn calls `Deps.Notifier` and returns; there is no in-daemon judgment-round carve-out.
**Why**: the judgment-round carve-out (`_preamble.md` § The pane readiness gate) exists for a human-attended dispatch loop that can read a capture snippet and decide what a wall wants; the daemon tick has no human present, so the only safe move on an unclassifiable pane is to escalate to one (`rk notify`) — exactly the posture `docs/specs/cron.md` states ("the clock never auto-answers walls").
**Rejected**: retrying the readiness wait across ticks with no escalation (a silently-stuck respawn defeats the whole point of the backstop); auto-answering a common wall pattern (violates the spec's explicit prohibition).
*Introduced by*: 260906-kbbh-operator-tick-seed-respawn

## Tasks

### Phase 1: Setup

- [x] T001 Add `Respawner func(ctx context.Context, fire Fire) Outcome` to `cron.Deps` in `app/backend/internal/cron/tick.go`, documented as nil-safe (existing notify-degrade behavior when unset) <!-- R3 -->

### Phase 2: Core Implementation

- [x] T002 Implement `EnsureRoleEntry(dir, slug string, spec Entry) (Entry, bool, error)` in `app/backend/internal/cron/store.go`: load entries via the existing `loadForMutate`-class read, scan for `Target.Kind == TargetRole && Target.Role == spec.Target.Role`, return the match unmodified on a hit, else call `Add(dir, slug, spec)` <!-- R1 -->
- [x] T003 [P] Add unit tests in `app/backend/internal/cron/store_test.go` for `EnsureRoleEntry`: empty file → created; existing match (including one with mutated flags/payload) → returned unchanged, `created=false`; two different roles never collide (only one role value, `operator`, is defined today, so this is a single-role coverage test plus a comment noting the generality) <!-- R1 -->
- [x] T004 In `app/backend/cmd/rk/operator.go`, extract the create-and-mark-window sequence (currently inline in `runOperator`: `new-window -P -F pane_id` → resolve window id via `display-message` → `stampOperatorRole`) into a helper parameterized on the run/run-output function shapes (matching `operatorRunFn`/`operatorRunOutputFn`), so it can be driven by either the CLI's `$TMUX`-restored env or the daemon respawner's own `-L <server>`-addressed, scrubbed-env calls <!-- R4 -->
- [x] T005 In `app/backend/cmd/rk/operator.go`, add the idempotent seed call inside `runOperator`: derive the slug via `cliServerLabel(operatorOriginalTMUXFn())`, build the operator-tick `cron.Entry` spec per R2's fixed field values, call `cron.EnsureRoleEntry(cron.DefaultDir(), slug, spec)` before the singleton-probe branch, and on error print one warning line to stderr (`cmd.ErrOrStderr()`) without returning an error <!-- R2 -->
- [x] T006 Create `app/backend/cmd/rk/cron_respawn.go` with the production Respawner: resolve the fire's server, call the extracted T004 helper (daemon-flavored tmux calls) to ensure the window, then `inject.DeliverWhenReady` (reusing `operatorDeliverDeadline`-class timing) to classify readiness and deliver `operatorKickoffPrompt`; return `Outcome{Status: "respawned"}` on success <!-- R4 -->
- [x] T007 In `cron_respawn.go`, handle every non-`ready` classification / send error: call the passed `Deps.Notifier` (fail-silent) naming the entry and server, and return `Outcome{Status: "respawn-failed", Detail: <detail>}` <!-- R5 -->

### Phase 3: Integration & Edge Cases

- [x] T008 In `app/backend/internal/cron/tick.go`'s absent-fire disposition switch, add the `IfAbsentRespawn` + `TargetRole` + non-nil `deps.Respawner` branch that calls it and logs the returned `Outcome`; confirm every other combination falls through to the existing `notify` + `respawn-unimplemented` diagnostic path byte-for-byte <!-- R3, R6 -->
- [x] T009 Add table-driven tests in `app/backend/internal/cron/tick_test.go` covering: role-target respawn success (fake Respawner returns `respawned`, log line appended, anchor advances), role-target respawn failure (fake returns `respawn-failed: ...`), non-role target with `if_absent: respawn` (unchanged notify-degrade path, `Respawner` never called even if non-nil), nil `Respawner` (unchanged notify-degrade path regardless of target kind) <!-- R3, R6 -->
- [x] T010 [P] Add tests in `app/backend/cmd/rk/operator_test.go` for the seed call: fresh state dir → entry created with the exact spec'd field values; existing entry → left untouched (idempotent re-run); seed failure (e.g. an unwritable dir seam) → command still reports success and the window-open path is unaffected <!-- R2 -->
- [x] T011 Add `app/backend/cmd/rk/cron_respawn_test.go` covering the Respawner end-to-end against fakes: window absent → created + marked + kickoff delivered on `ready`; `parked`/`gone`/timeout classification → `Notifier` called, `respawn-failed` returned, no delivery attempted <!-- R4, R5 -->
- [x] T012 Wire `Respawner: rkCronRespawnRole` (or the chosen exported name) into the `cron.Deps{...}` literal in `app/backend/cmd/rk/serve.go`'s ticker construction, alongside the existing `Deliverer: cron.NewEngineDeliverer()` <!-- R4 -->

### Phase 4: Polish

- [x] T013 Edit `docs/specs/cron.md` § Open Questions item 3 to record the decision per R7 (replace the question text, keep the four-point rationale) <!-- R7 -->
- [x] T014 Add a one-line pointer in `fab/plans/sahil/26-09-06-cron-clock-plan.md`'s C4 row (or immediately below it) referencing the resolved open question 3 and this change <!-- R7 -->
- [x] T015 Grep the full diff against `.claude/skills/fab-operator/` and any other fab-kit skill path to confirm zero skill-file changes before ship (a verification step, not a code task — record the grep result in the review notes) <!-- R2, R4 -->

## Execution Order

- T001 (Deps field) blocks T006/T007 (Respawner needs the type) and T008 (switch branch needs the field)
- T002 blocks T003, T005 (seeding needs `EnsureRoleEntry` to exist)
- T004 blocks T006 (Respawner needs the extracted window-create helper) and T005 is independent of T004 (seeding doesn't touch window creation)
- T006+T007 block T008 (the switch branch calls the production Respawner's shape) and T009 (tests exercise the wired branch)
- T008 blocks T012 (wiring needs the Deps field consumed correctly) — T012 can otherwise run any time after T001
- T013/T014 (docs) are independent of all code tasks
- T015 runs last, after all code tasks, as a final sweep before hydrate/ship

## Acceptance

### Functional Completeness

- [x] A-001 R1: `EnsureRoleEntry` exists in `internal/cron/store.go` with the exact seed-once-per-role-target behavior, covered by passing unit tests
- [x] A-002 R2: `rk operator` seeds the operator-tick entry on every invocation, idempotently, without changing its exit code or window-open behavior on seed failure
- [x] A-003 R3: `cron.Deps.Respawner` exists and the absent-fire disposition switch calls it exactly under the role-target + non-nil-Respawner condition
- [x] A-004 R4: the production Respawner ensures a live operator window and delivers the kickoff prompt only on a `ready` classification, never the bare payload

### Behavioral Correctness

- [x] A-005 R3: a non-role target or a nil `Respawner` produces byte-identical behavior to pre-change `if_absent: respawn` handling (notify + `respawn-unimplemented` diagnostic) — a regression test pins this
- [x] A-006 R5: a `parked`/`narrow`/`gone`/timeout classification during respawn calls `Deps.Notifier` and never attempts delivery
- [x] A-007 R6: both `respawned` and `respawn-failed` outcomes append a delivery-log line and advance the entry's anchor (no immediate re-fire next tick)

### Scenario Coverage

- [x] A-008 R2: a scenario test (or manual local walkthrough, noted in review) confirms a fresh server with no cron dir ends up with the seeded entry after one `rk operator` run
- [x] A-009 R4: a scenario test confirms the full respawn path — no live window → new window created, role-stamped, kickoff delivered — using fakes for tmux/inject
- [x] A-010 R7: `docs/specs/cron.md` § Open Questions item 3 reads as a resolved decision (not a question) and the plan doc's C4 row carries the pointer

### Edge Cases & Error Handling

- [x] A-011 R2: seeding against an unwritable/unresolvable cron state dir degrades to a stderr warning, never a non-zero exit or a skipped window-open
- [x] A-012 R1: re-running `EnsureRoleEntry` after a user has muted or hand-edited the seeded entry leaves that edit untouched (no silent overwrite)
- [x] A-013 R5: a send error mid-delivery (post-`ready` classification) is distinguished from a pre-delivery readiness failure in the logged detail, both landing in `respawn-failed`

### Security

- [x] A-014 R4: every tmux call the extracted window-create helper and the Respawner make uses `exec.CommandContext` with argv slices (no shell strings) and an explicit `-L <server>`/scrubbed-env addressing on the daemon path, per Constitution §I
- [x] A-015 R2, R4: zero changes to `.claude/skills/fab-operator/` or any other fab-kit skill path in the diff (T015's grep sweep, recorded in the review notes)

### Code Quality

- [x] A-016 Pattern consistency: the extracted window-create helper follows the existing `operatorRunFn`/`operatorRunOutputFn` seam-injection style already in `operator.go`; the Respawner follows the `EngineDeliverer` construction style in `serve.go`
- [x] A-017 No unnecessary duplication: the Respawner reuses `inject.DeliverWhenReady` and the extracted window-create helper rather than reimplementing tmux new-window/role-stamp/readiness logic
- [x] A-018 Go backend subprocess calls (new code in `store.go`, `tick.go`, `operator.go`, `cron_respawn.go`, `serve.go`) use `exec.CommandContext` with timeouts — never shell strings — per `code-quality.md`
- [x] A-019 New behavior (seeding, respawn) includes tests covering the added/changed behavior per `code-quality.md`'s "New features and bug fixes MUST include tests"
- [x] A-020 No god functions: `runOperator` does not grow past a reasonable size from the seed-call addition — the window-create logic is extracted, not merely duplicated inline in both `operator.go` and `cron_respawn.go`

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`
- No frontend/e2e coverage applies (no UI surface in this change) — A-item scope is backend-only by design, not an omission.

## Deletion Candidates

None — this change adds new functionality without making existing code redundant. The inline create-and-mark sequence in `runOperator` was extracted into `createMarkedOperatorWindow` (not duplicated), so no orphaned copy remains.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | The extracted window-create helper is parameterized on run/run-output function types (matching `operatorRunFn`/`operatorRunOutputFn`'s shape) rather than on a higher-level interface, so the CLI and daemon can each supply their own tmux-calling convention | Matches the file's existing seam-injection idiom exactly (`operator*Fn` package vars); a new interface would be an unjustified abstraction for two call sites | S:55 R:80 A:75 D:70 |
| 2 | Confident | `respawn-failed` carries the classification/error string in `Outcome.Detail` (e.g. the readiness error's message), following the existing `failed: <detail>` outcome convention in `EngineDeliverer` | Matches `Outcome.String()`'s existing `Status + ": " + Detail` rendering and the established `failed: <detail>` precedent in `deliver.go` | S:55 R:85 A:80 D:75 |
| 3 | Confident | The Respawner's deadline for `inject.DeliverWhenReady` reuses the same class of bound as `operatorDeliverDeadline` (25s) rather than a new named constant tied to the tick's own timeout | The daemon tick already runs under a bounded per-tick context (`tickTimeout`); a respawn attempt that blocks tmux/readiness work for tens of seconds inside one tick would stall the whole sweep, so the exact bound is an apply-time judgment call within the existing tick-timeout budget, not a new design decision | S:45 R:75 A:60 D:60 |
| 4 | Confident | The Respawner escalates through its own `push.Notify`-backed seam (`cronRespawnNotifyFn`) rather than a `Deps.Notifier` handed to it | The plan-fixed seam shape `Respawner func(ctx, Fire) Outcome` carries no notifier parameter; `push.Notify` IS the production default `Deps.Notifier` falls back to, so the escalation channel is behaviorally identical and tests stub the seam | S:55 R:80 A:75 D:70 |
| 5 | Confident | A defensive probe hit (an operator window appeared between evaluation and the respawn) returns `respawned` WITHOUT a delivery — the window's creator owns its kickoff | Re-kicking a live, already-kicked-off operator would re-run `/fab-operator` against an initialized session; a window mid-creation by a concurrent `rk operator` gets its kickoff from that creator | S:50 R:80 A:70 D:65 |
| 6 | Confident | The respawned window opens in the user's home directory and the launcher resolves with an empty repo root | The daemon has no project cwd to anchor on; `riff.ResolveLauncher` degrades to `DefaultLauncher` on any failure, so an unresolvable project context never blocks the respawn | S:45 R:75 A:65 D:60 |

6 assumptions (0 certain, 6 confident, 0 tentative).
