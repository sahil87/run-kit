# Plan: Cron Core + Evaluator

**Change**: 260906-3jtn-cron-core-evaluator
**Intake**: `intake.md`

## Requirements

> Design authorities: `docs/specs/cron.md` (schema + semantics, verbatim) and
> `fab/plans/sahil/26-09-06-cron-clock-plan.md` (C1 scope + standing rules).
> Everything lands in a new package `app/backend/internal/cron`; no CLI, API,
> daemon, or frontend surface in this change.

### Non-Goals

- `rk cron` CLI verbs — C2.
- Daemon ticker goroutine, injection-engine delivery, `deliver: when-idle` gating, `if_absent` handling (skip/notify/respawn), circuit breakers — C3.
- 5-field `cron` expression evaluation, `catch_up` — C9 (the schema kind is recognized, never evaluated here).
- Session-target orphan GC / TTL — C8.
- Any UI, API endpoint, SSE wiring — C5+.

### Cron: State Files & Schema

#### R1: Entry schema types
The package SHALL define Go types for the spec's entry schema: `id` (4-char), `name`, `schedule` (`kind: every|backoff|cron` with `interval` / `anchor`+`min`+`max`), `wake_on` (`event`, `scope`, `debounce`), `suppress_while` (guard-name list), `target` (`kind: role|session|pane` + discriminant field), `payload`, `deliver` (`immediate|when-idle`), `if_absent` (`skip|notify|respawn`), `pinned`, `muted`, `created_by` (`session`, `pane`, `at`). Durations parse as Go `time.ParseDuration` strings (`60s`, `30m`). Runtime facts (`last_fired`, `next_fire`, rung, orphaned-since) SHALL NOT be fields of the entry schema.

- **GIVEN** the spec's example YAML (operator tick + hourly PR sweep entries)
- **WHEN** the file is loaded
- **THEN** every field round-trips into the typed form, and durations resolve to `time.Duration` values

#### R2: Tolerant load
Loading a server's entry file SHALL be tolerant: unknown keys are ignored; an entry that fails validation (bad duration, unknown target kind, missing id/schedule) is skipped with a per-entry diagnostic, never failing the file; an absent file yields an empty entry set with no error; a file that fails YAML parse entirely yields an empty set plus a diagnostic (never an aborted tick).

- **GIVEN** a file with one valid entry, one entry with `schedule: {kind: bogus}`, and a top-level unknown key
- **WHEN** loaded
- **THEN** the valid entry is returned, the bogus entry appears only in diagnostics, and no error is returned

#### R3: State dir, file naming, and mutation helpers
Cron state SHALL live under `$XDG_STATE_HOME/run-kit/cron/` (XDG-honoring with the `~/.local/state` fallback — the same resolution as `snapshot.DefaultDir`): entries at `<server-slug>.yaml`, delivery log at `<server-slug>.log`, wake-cursor at `<server-slug>.cursor.yaml`, and the tick lock at `.lock`. Server slugs are the socket name and MUST be validated (`[A-Za-z0-9_-]`, the snapshot-store rule) before path construction. The package SHALL provide mutation helpers — `Add` (generates the 4-char id), `Remove`, `SetMuted`, `SetPinned` — writing via `fsatomic.WriteFile`; these are the seam C2's CLI wires to.

- **GIVEN** `XDG_STATE_HOME=/tmp/x` and server `dev`
- **WHEN** an entry is added
- **THEN** `/tmp/x/run-kit/cron/dev.yaml` exists, written atomically, containing exactly the intent fields
- **AND** a server name containing `/` or `.` is rejected before any path is built

### Cron: Evaluator

#### R4: Stateless evaluation over disk-derivable inputs
The core SHALL be a pure function `Evaluate(in EvalInput) EvalResult` where `EvalInput` carries entries, derived facts (per-target idle epochs / agent-state fingerprint), the parsed delivery log, the previous wake cursor, and `now` — and `EvalResult` carries due fires (entry + resolved reason: schedule | wake), skip diagnostics, and the next wake cursor. It SHALL hold no package-level mutable state; two calls with equal inputs return equal results.

- **GIVEN** identical `EvalInput` values
- **WHEN** `Evaluate` runs twice
- **THEN** the results are deep-equal (property pinned by a test)

#### R5: `every` schedule
An `every` entry SHALL fire when `now − lastDelivery ≥ interval`, where `lastDelivery` derives from the entry's newest delivery-log line; with no logged delivery the anchor is `created_by.at`.

- **GIVEN** an `every: 1h` entry created at T with no deliveries
- **WHEN** evaluated at T+59m / T+61m
- **THEN** not due / due; **AND** after a delivery at T+61m it is next due at T+2h1m

#### R6: `backoff` schedule with the anchor-join rule
A `backoff` entry SHALL fire on the ladder `anchor + min·(2ⁿ − 1)` (gaps `min, 2min, 4min…`) with per-gap cap `max`. The effective anchor MUST be *the last activity not caused by the clock*: the raw idle epoch (from `@rk_pane_agent_state`, supplied in facts) is joined against the entry's own delivery log — a raw epoch within the attribution window (named constant `attributionWindow`, default 120s) after the entry's own latest delivery does NOT reset the ladder; the rung continues as the trailing streak of own deliveries each of whose successor epoch was attributed. A non-attributed raw epoch resets the rung to 0 with the raw epoch as anchor. An implementation that derives the ladder from the raw epoch alone (rung pinned at 1 after every delivery) MUST fail the tests — this is the review-gating rule.

- **GIVEN** `min: 60s, max: 30m`, idle since T, deliveries at T+1m and T+3m, and a raw idle epoch 5s after the T+3m delivery (attributed)
- **WHEN** evaluated
- **THEN** the next fire is T+7m (rung 3), not T+3m+1m — the ladder did not reset
- **AND GIVEN** a raw idle epoch 10m after the T+3m delivery (genuine activity, non-attributed), **THEN** the rung resets and the next fire is epoch+60s
- **AND** gaps never exceed `max`

#### R7: `wake_on` poll approximation
A `wake_on: agent-state-change` entry SHALL fire when the server-scoped agent-state fingerprint differs from the previous evaluation's cursor, debounced per the entry's `debounce` (a change younger than the debounce holds until a later tick — a burst coalesces into at most one fire). The cursor (fingerprint + observation time) is persisted at `<slug>.cursor.yaml` by the tick orchestrator; a missing/corrupt cursor is a cold start — no edge fires that tick, the cursor is rewritten (seed-cache class: never authoritative, at worst one missed or duplicate edge).

- **GIVEN** a cursor fingerprint F1 and current facts fingerprint F2 ≠ F1 older than `debounce`
- **WHEN** evaluated
- **THEN** the entry is due with reason `wake`; **AND** with an absent cursor nothing edge-fires and the result carries a fresh cursor

#### R8: `suppress_while` guards
Guards SHALL be evaluated at fire time; while any holds, the fire is skipped silently (a suppression diagnostic, never an error, never a recorded miss). Two named guards ship: `operator-loop-fresh` (holds while `last_tick_at` in the fab operator state file `$XDG_STATE_HOME/fab/operator/<server-slug>.yaml` is within the freshness threshold — a guard parameter with named-constant default) and `nothing-tracked` (holds while `monitored`, `watches`, and `autopilot` are all empty). The state-file read is tolerant (unknown keys ignored) and documented as an external fab-owned contract. Absent or unparseable file ⇒ `operator-loop-fresh` does NOT hold, `nothing-tracked` DOES hold. An unknown guard name in an entry never holds and yields a diagnostic.

- **GIVEN** the truth table: file {fresh, stale, absent, corrupt} × tracked sets {empty, non-empty} × guard list combinations
- **WHEN** a due fire is guarded
- **THEN** every cell matches the semantics above (table-driven test covers all cells)

#### R9: Skip semantics
A `muted` entry SHALL never fire (skipped with a diagnostic). A `cron`-kind schedule SHALL be recognized but unevaluated in this change (skipped with a "not yet supported" diagnostic). Ticks are idempotent by contract: a duplicate fire after a restart is acceptable; a missed suppression is not — guard evaluation MUST precede due-fire emission.

- **GIVEN** a due-but-muted entry and a `cron`-kind entry
- **WHEN** evaluated
- **THEN** neither is due and both appear in diagnostics with distinct reasons

### Cron: Delivery Log

#### R10: Append-only delivery log as derivation source
Each completed delivery SHALL append one JSON line to `<server-slug>.log`: `{ts, entry, target, reason, outcome}`. The log parser SHALL expose the per-entry newest delivery and the trailing own-delivery streak — the derivation sources for R5's `lastDelivery` and R6's rung. Unparseable lines are skipped tolerantly.

- **GIVEN** a log with interleaved entries and one corrupt line
- **WHEN** parsed
- **THEN** per-entry last-delivery and streaks are correct and the corrupt line is ignored

#### R11: Size cap
When an append pushes the log past the cap (named constant, 512 KiB), the log SHALL be atomically trimmed to its newest tail (retain the newest ~half, cut at a line boundary, via `fsatomic`). History is recovery-backup class — trimming loses only old history, never live state.

- **GIVEN** a log at the cap
- **WHEN** a line is appended
- **THEN** the file ends with the new line, is under the cap, starts at a line boundary, and every retained line is newer than every dropped one

### Cron: Tick Orchestration & Guards

#### R12: Live-server filter before any socket touch
The tick orchestrator (`Tick(ctx, deps)`) SHALL derive its server set from `tmux.ListServers` (the live-socket-probed enumeration) and MUST NOT issue any tmux command for a server outside that set. Entry files whose server is not live are skipped entirely (diagnostic only) — a dead socket is never probed, so the evaluator can never resurrect a server.

- **GIVEN** entry files for servers `live1` and `dead1` where only `live1` enumerates
- **WHEN** a tick runs
- **THEN** facts are gathered and fires evaluated for `live1` only, and zero tmux commands target `dead1` (pinned via a seam/fake in tests)

#### R13: TMUX scrub and absolute addressing
All tmux interaction SHALL route through `internal/tmux` helpers (whose runner core already scrubs `TMUX`/`TMUX_PANE` and takes explicit `-L <server>` targeting) — the package SHALL NOT construct its own tmux `exec` calls, and target resolution SHALL use exact-match forms (`ExactSessionTarget`, option constants), never bare names.

- **GIVEN** the package's imports and call graph
- **WHEN** reviewed
- **THEN** no direct `exec.Command*("tmux", …)` exists in `internal/cron`; every tmux touch goes through `internal/tmux`

#### R14: flock serialization
A tick SHALL take a non-blocking `flock` (LOCK_EX|LOCK_NB via `golang.org/x/sys/unix` or `syscall`) on `cron/.lock` before evaluating; when the lock is held elsewhere, the tick exits cleanly and quietly (no error, a debug-level note) — the idempotent-tick contract makes skip-on-contention correct.

- **GIVEN** one process holding the lock
- **WHEN** a second tick starts
- **THEN** it returns immediately with no fires, no log writes, and no error

#### R15: Deliverer seam
Delivery SHALL be an interface (`Deliverer` — `Deliver(ctx, Fire) Outcome`) supplied to `Tick` by the caller; this change ships only a test fake. `Tick` appends a log line for each attempted delivery with the fake's outcome and persists the next wake cursor after evaluation. C3 substitutes the injection-engine implementation without touching evaluation.

- **GIVEN** a fake deliverer recording calls
- **WHEN** a tick with one due entry runs
- **THEN** the fake receives exactly one fire and the log gains exactly one line

#### R16: Fact gathering and fire-time target resolution
The facts gatherer SHALL resolve, per live server: role targets via the shipped `@rk_win_role` radio semantics (the operator window → its agent pane; never a bare `-t _rk-operator`), session targets via `@rk_pane_agent_session`, pane targets by liveness — and read each resolved target's `@rk_pane_agent_state` idle epoch (the `backoff` anchor input) plus the server-scoped agent-state fingerprint (the `wake_on` input). A target that fails resolution marks the entry's fires unresolvable this tick (skipped with a diagnostic — `if_absent` policy is C3's).

- **GIVEN** a live server with an operator window and an agent pane carrying an idle-epoch state
- **WHEN** facts are gathered
- **THEN** the `role: operator` target resolves to that pane and the epoch feeds R6's evaluation; **AND** an unresolvable target produces a skip diagnostic, not an error

### Design Decisions

#### Anchor-join as a log-derived streak
**Decision**: rung = trailing streak of the entry's own deliveries whose following idle-epoch observations were attributed (within `attributionWindow` after a delivery); a non-attributed epoch resets rung 0 / anchor = epoch.
**Why**: the pre-delivery idle epoch is unrecoverable once tmux overwrites the option, so the log is the only durable record; the streak formulation is a pure function of (raw epoch, log) — both on disk, per the spec's statelessness requirement.
**Rejected**: persisting the effective anchor in a sidecar (a live-state store — Constitution II violation, and drift-prone); raw-epoch ladder (the self-resetting-ladder bug the plan's standing rule exists to reject).
*Introduced by*: 260906-3jtn-cron-core-evaluator

#### Wake cursor as a seed-cache-class sidecar
**Decision**: the `wake_on` previous-observation fingerprint persists at `<slug>.cursor.yaml`; corrupt/absent = cold start (no edge fire that tick), rewritten every tick.
**Why**: a state-delta needs a previous observation; entry files must stay intent-only; Constitution II's seed-cache carve-out covers never-authoritative, droppable files.
**Rejected**: fingerprint in the entry file (runtime fact in an intent file); in-memory only (breaks the every-invoker-is-equivalent stateless contract).
*Introduced by*: 260906-3jtn-cron-core-evaluator

#### `muted` as a schema field
**Decision**: add `muted: bool` to the entry schema (default false); the evaluator skips muted entries.
**Why**: the spec fixes mute as a first-class verb (`rk cron mute`, `POST /api/cron/mute`, the UI toggle) and states the file changes on mute — the flag must live in the intent file.
**Rejected**: a separate muted-ids sidecar (splits intent across files for no gain).
*Introduced by*: 260906-3jtn-cron-core-evaluator

#### Delivery boundary at the `Deliverer` interface
**Decision**: C1's `Tick` computes fires, resolves targets, and calls a caller-supplied `Deliverer`; injection, `when-idle`, `if_absent`, and circuit breakers live behind the interface (C3).
**Why**: matches the plan's C1/C3 split; keeps every C1 function testable without tmux delivery; the log-append and cursor-write choreography still exercises end-to-end in tests via the fake.
**Rejected**: stubbing `internal/inject` calls directly in C1 (drags C3's scope in; injection gating decisions belong with the delivery change).
*Introduced by*: 260906-3jtn-cron-core-evaluator

## Tasks

### Phase 1: Setup

- [x] T001 Create `app/backend/internal/cron/dir.go`: state-root resolution (`$XDG_STATE_HOME/run-kit/cron/`, `~/.local/state` fallback — mirror `snapshot.DefaultDir`), server-slug validation (`[A-Za-z0-9_-]`), per-slug entry/log/cursor path builders; `dir_test.go` covering env set/unset and slug rejection <!-- R3 -->

### Phase 2: Core Implementation

- [x] T002 [P] `app/backend/internal/cron/schema.go`: entry/schedule/wake/target types with yaml.v3 tags, duration wrapper (ParseDuration), 4-char id generation, per-entry validation; `schema_test.go` round-trips the spec's example YAML <!-- R1 -->
- [x] T003 `app/backend/internal/cron/store.go`: tolerant `LoadEntries` (absent file, unknown keys, per-entry skip + diagnostics, whole-file parse failure ⇒ empty + diagnostic) and mutation helpers `Add`/`Remove`/`SetMuted`/`SetPinned` via `fsatomic.WriteFile`; `store_test.go` <!-- R2 -->
- [x] T004 [P] `app/backend/internal/cron/log.go`: JSON-lines delivery log — `Append` (with cap check + atomic trim-to-newest-tail at 512 KiB), `ParseLog` exposing per-entry last-delivery and trailing own-delivery streak, tolerant line skip; `log_test.go` incl. cap-trim boundary cases <!-- R10, R11 -->
- [x] T005 `app/backend/internal/cron/backoff.go`: pure ladder math (`anchor + min·(2ⁿ−1)`, `max` cap) and the anchor-join (`attributionWindow` const, streak derivation from parsed log, attributed-continue / non-attributed-reset); `backoff_test.go` — the hard table: self-resetting-ladder regression (raw-epoch impl must fail), multi-delivery streaks, cap, restart duplicate-fire tolerance <!-- R6 -->
- [x] T006 [P] `app/backend/internal/cron/schedule.go`: `every` due math (log-derived last delivery, `created_by.at` fallback); `schedule_test.go` <!-- R5 -->
- [x] T007 [P] `app/backend/internal/cron/wake.go`: agent-state fingerprint, delta-vs-cursor detection with per-entry debounce, cursor read/write (tolerant, seed-cache semantics); `wake_test.go` <!-- R7 -->
- [x] T008 [P] `app/backend/internal/cron/guards.go`: fab operator state file tolerant reader (external-contract doc comment), `operator-loop-fresh` (threshold param + named default) and `nothing-tracked` guards, unknown-guard diagnostic; `guards_test.go` — full truth table (fresh/stale/absent/corrupt × empty/non-empty × guard combos) <!-- R8 -->
- [x] T009 `app/backend/internal/cron/evaluate.go`: `EvalInput`/`EvalResult`/`Fire` types and pure `Evaluate` composing R5–R9 (schedule OR wake, guards last, muted/cron-kind/unknown-kind skips with distinct diagnostic reasons); `evaluate_test.go` incl. determinism (equal inputs ⇒ deep-equal results) and guard-precedes-fire ordering <!-- R4, R9 -->

### Phase 3: Integration & Edge Cases

- [x] T010 `app/backend/internal/cron/facts.go`: per-live-server fact gathering behind narrow seams — role resolution via `tmux.RoleOption` radio semantics, session via `tmux.AgentSessionOption`, pane liveness, `@rk_pane_agent_state` epoch reads, server fingerprint; unresolvable-target skip diagnostics; `facts_test.go` over seam fakes <!-- R16 -->
- [x] T011 `app/backend/internal/cron/lock.go`: non-blocking flock on `cron/.lock` (acquire/release, held ⇒ ErrTickHeld sentinel); `lock_test.go` proving contention no-op <!-- R14 -->
- [x] T012 `app/backend/internal/cron/tick.go`: `Deliverer` interface + `Tick(ctx, deps)` orchestration — flock, `tmux.ListServers`-derived live set (dead-server entry files skipped, zero tmux calls off the live set — pinned via seams), load → facts → `Evaluate` → deliver via seam → log append → cursor write; `tick_test.go` with fake deliverer/facts incl. the dead-socket-untouched pin and lock-contention exit <!-- R12, R13, R15 -->

## Execution Order

- T001 → everything (paths); T002 → T003/T009; T004 → T005 (streak input)
- T005/T006/T007/T008 are mutually independent after T002/T004
- T009 needs T005–T008; T012 needs T009–T011

## Acceptance

### Functional Completeness

- [x] A-001 R1: Spec example YAML round-trips into typed entries with parsed durations; runtime facts have no schema fields
- [x] A-002 R2: Tolerant load — unknown keys ignored, bad entries skipped with diagnostics, absent file = empty set, whole-file parse failure never aborts
- [x] A-003 R3: State paths resolve under `$XDG_STATE_HOME/run-kit/cron/` with fallback; slugs validated before path build; mutations atomic via fsatomic
- [x] A-004 R4: `Evaluate` is pure and deterministic (pinned by test); no package-level mutable state
- [x] A-005 R5: `every` math correct incl. `created_by.at` fallback
- [x] A-006 R6: Backoff ladder + anchor-join correct; the raw-epoch (self-resetting-ladder) implementation is impossible under the shipped tests
- [x] A-007 R7: Wake delta + debounce + cursor cold-start semantics correct
- [x] A-008 R8: Both guards match the full truth table; state-file read tolerant; unknown guard = never-holds + diagnostic
- [x] A-009 R9: Muted and `cron`-kind entries skip with distinct diagnostics; guards evaluated before fires are emitted
- [x] A-010 R10: Log lines append per delivery; parser derives last-delivery + streak; corrupt lines tolerated
- [x] A-011 R11: Cap trim atomic, line-bounded, newest-tail-preserving
- [x] A-012 R15: `Tick` delivers through the seam exactly once per due fire and logs each attempt
- [x] A-013 R16: Role/session/pane targets resolve per the shipped conventions; unresolvable target = skip diagnostic

### Scenario Coverage

- [x] A-014 R6: The intake's worked scenario (deliveries at +1m/+3m, attributed epoch ⇒ next fire +7m; non-attributed ⇒ reset) exists as a test case
- [x] A-015 R8: Truth-table test enumerates every file-state × tracked-state cell
- [x] A-016 R12: A tick with a dead server's entry file present issues zero tmux commands for it (seam-pinned test)

### Edge Cases & Error Handling

- [x] A-017 R14: Lock contention exits clean — no fires, no writes, no error
- [x] A-018 R7: Corrupt/absent cursor degrades to cold start (no edge fire, cursor rewritten), never an error
- [x] A-019 R2: Corrupt entry file or corrupt operator state file never aborts a tick (diagnostics only)

### Code Quality

- [x] A-020 Pattern consistency: dir resolution mirrors `snapshot.DefaultDir`; tolerant YAML reads mirror existing store patterns; diagnostics via `log/slog` like neighboring packages
- [x] A-021 No unnecessary duplication: reuses `tmux.ListServers`, `tmux.RoleOption`/`AgentSessionOption`/`AgentStateOption` constants and read helpers, `internal/fsatomic`; no reimplemented liveness probe
- [x] A-022 No shell strings / direct tmux exec: all subprocesses via `internal/tmux` (which uses `exec.CommandContext` + TMUX scrub); no `exec.Command*` in `internal/cron`
- [x] A-023 No new env vars, no database: state under the sanctioned XDG carve-outs only; no new `RK_*` keys
- [x] A-024 Tests: every new behavior covered by colocated `*_test.go`; `go test ./...` green

### Security

- [x] A-025 R3: Server slugs validated before filesystem path construction (no traversal); state dir created 0700-class perms consistent with `cb/` precedent

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change adds new functionality without making existing code redundant

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | `muted: bool` added to the entry schema (spec shows the verb but not the field) | Mute is a first-class spec verb and "file changes on mute" — the flag must be intent | S:65 R:80 A:80 D:70 |
| 2 | Confident | `attributionWindow` default 120s; log cap 512 KiB; both named constants | Spec says "immediately follow" / "size-capped" without numbers; constants are trivially tunable | S:50 R:90 A:70 D:60 |
| 3 | Confident | Fire-time target resolution + agent-state reads are in C1 (facts gathering) | The `backoff` anchor IS the target pane's idle epoch — evaluation cannot run without resolution; `if_absent` policy stays C3 | S:70 R:65 A:80 D:70 |
| 4 | Confident | Log lines are JSON (yaml file, JSON-lines log) | JSON-lines is the appendable line-oriented form; snapshot store precedent uses JSON | S:55 R:85 A:85 D:75 |
| 5 | Certain | flock via `syscall.Flock` (LOCK_EX\|LOCK_NB); linux/darwin targets only | Spec names flock; repo already targets unix platforms | S:80 R:90 A:90 D:90 |
| 6 | Confident | `operator-loop-fresh` default threshold 120s | Sits above the loop's short-cadence ticks and below the backoff min×2; C4 tunes the seeded entry | S:45 R:80 A:60 D:55 |

6 assumptions (1 certain, 5 confident, 0 tentative).
