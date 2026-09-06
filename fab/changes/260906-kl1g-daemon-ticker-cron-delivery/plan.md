# Plan: Daemon Ticker + Cron Delivery

**Change**: 260906-kl1g-daemon-ticker-cron-delivery
**Intake**: `intake.md`

## Requirements

### Cron: Daemon ticker invoker

#### R1: Ticker goroutine
A `Ticker` in `internal/cron` (new `ticker.go`) SHALL invoke `cron.Tick(ctx, deps)` on a fixed cadence (`DefaultTickInterval = 30s`, named constant), started from `cmd/rk/serve.go` and bound to the serve context. It MUST be isolated from the serving path: no shared locks (the only serialization is `Tick`'s own non-blocking flock), each iteration wrapped in panic recovery (a panicking tick logs at Error and skips the iteration — it never kills the daemon), and each iteration bounded by a per-tick context timeout (named constant). Startup MUST follow the snapshotter's best-effort posture: a cron state-dir resolution failure disables ticking with a `slog.Warn` and never blocks serving.

- **GIVEN** the daemon is serving and a due entry exists on a live server
- **WHEN** the next tick iteration runs
- **THEN** `cron.Tick` executes with the production deliverer and the entry fires
- **AND GIVEN** a tick iteration panics, **THEN** the daemon keeps serving and the next iteration runs on schedule

#### R2: `cron_ticker` settings key
The `internal/settings` registry SHALL gain a key `cron_ticker` (kind `bool`, default `"true"`, category `behavior`, `ui: true`, `live: true`) gating the ticker. The ticker MUST consult the setting at each iteration (`settings.Load()`), so toggling takes effect without a daemon restart; when off, the iteration skips with a debug note and performs no tmux or disk work beyond the settings read.

- **GIVEN** `cron_ticker: false` in config.yaml
- **WHEN** a tick iteration fires
- **THEN** no `cron.Tick` call is made
- **AND WHEN** the setting is flipped to true (live)
- **THEN** the next iteration runs `cron.Tick` without a restart

#### R3: Doctor row
`rk doctor` (`cmd/rk/doctor.go`) SHALL gain an informational, always-OK-shaped cron row (the ephemeral/tmux-config posture) reporting the `cron_ticker` setting state and the cron state dir resolvability/path. It MUST never fail the report — doctor runs in a separate process and reports config + disk facts only.

- **GIVEN** any machine state (state dir resolvable or not, setting on or off)
- **WHEN** `rk doctor` runs
- **THEN** the cron row renders `[ OK ]` with the setting state and dir fact (or the resolution failure named as a note)

### Cron: Injection-engine delivery

#### R4: EngineDeliverer through the injection engine
A new `internal/cron/deliver.go` SHALL implement the C1 `Deliverer` interface with an `inject.Engine` on a dedicated buffer (`const cronSendBuffer = "rk-cron-send"`) and a package-private `inject.Tmux` adapter delegating to `internal/tmux` context-bound primitives (mirror `riffInjectTmux` in `internal/riff/deliver.go` — cron cannot import cmd or riff). Delivery MUST go through `engine.Send(ctx, adapter, fire.Server, fire.PaneID, inject.Sanitize(payload), true)` — never raw `send-keys` — inheriting the pane-mode guard, echo probe, and submit verification. `deliver: immediate` (and an empty `deliver` field) sends now. A send error yields outcome `failed: <detail>` (logged — anchor advancement is deliberate self-throttling: retry next due period, not next tick).

- **GIVEN** a due fire with `deliver: immediate` and a resolved pane
- **WHEN** the deliverer runs
- **THEN** the payload is pasted + submitted via the engine on buffer `rk-cron-send` and the outcome logs `delivered`

#### R5: `when-idle` gating with held-not-logged semantics
For `deliver: when-idle`, the deliverer SHALL read the target pane's agent state at delivery time (`tmux.PaneAgentState`) and hold when the state is `active` or `waiting` (the operator request-lane busy predicate): outcome `held-busy` with `Held: true`. `Outcome` gains a `Held bool` field, and `Tick` MUST NOT append a log line for a held outcome (a diagnostic `delivery-held` is recorded instead) — logging one would advance the `every` anchor and distort the backoff anchor-join streak, silently delaying the fire by a full period. The hold is realized as cross-tick retry: the fire re-computes as due next tick. `idle` and unknown ("") states deliver. No in-tick waiting — ticks stay short-lived.

- **GIVEN** a due `when-idle` fire whose target pane carries `@rk_pane_agent_state` `active`
- **WHEN** the tick runs
- **THEN** nothing is typed, no log line is appended, a `delivery-held` diagnostic is recorded, and the fire is due again next tick
- **AND GIVEN** the pane later reads `idle`, **THEN** the next tick delivers and logs `delivered`

#### R6: `if_absent` dispositions (skip | notify; respawn degrades)
`Evaluate` SHALL surface due-but-target-unresolved entries as fires in a new `EvalResult.Absent []Fire` (empty `PaneID`), with `suppress_while` guards evaluated before emission exactly as for resolved fires (a suppressed absent fire is a silent diagnostic). `Tick` SHALL apply the entry's `if_absent` policy to each absent fire:
- `skip` (and empty) — append a log line with outcome `skipped-absent` (records the missed fire; the anchor advances so a dead target produces one line per due period, not one per tick).
- `notify` — call the notifier seam (`Deps.Notifier`, production default `internal/push.Notify`, fail-silent: a notify error is a diagnostic, never a tick error) with title `cron: <entry name>` and body naming the server; append outcome `notified-absent`.
- `respawn` — out of scope (C4/C8): behave as `notify` plus a `respawn-unimplemented` diagnostic, so a seeded entry on this binary is loud, not silent.

- **GIVEN** a due `every` entry with `if_absent: notify` whose session target resolves to no pane
- **WHEN** the tick runs
- **THEN** one notification is sent, one `notified-absent` line is appended, and no further notify occurs until the entry is due again

### Cron: Circuit breakers

#### R7: Per-target delivery rate cap, visible trip
Before delivering a resolved fire, `Tick` SHALL count the trailing hour's log lines for the same target (key: the fire's pane ID; for absent fires, the entry ID) — held outcomes never appear in the log so they are inherently excluded — and at or past `DefaultTargetRatePerHour = 30` (named constant) suppress the delivery with outcome `rate-capped`. The trip MUST be visible: the `rate-capped` line IS appended (the future UI's derivation source; anchor advancement self-throttles the storm) AND surfaced at `slog.Warn` — the one cron signal above debug.

- **GIVEN** 30 delivered lines for pane `%5` within the trailing hour and another due fire targeting `%5`
- **WHEN** the tick runs
- **THEN** nothing is typed into `%5`, the log gains a `rate-capped` line, and a Warn-level message names the entry, target, and cap

#### R8: Per-server entry cap
`Add` (`internal/cron/store.go`) SHALL refuse to add an entry when the server's file already holds `MaxEntriesPerServer = 50` entries (named constant), with a clear error naming the cap. Defensively, evaluation SHALL process at most the first `MaxEntriesPerServer` entries of a (hand-edited) larger file, skipping the excess with per-entry `entry-cap-exceeded` diagnostics.

- **GIVEN** a server file with 50 entries
- **WHEN** `Add` is called
- **THEN** it returns an error naming the 50-entry cap and the file is unchanged

### Non-Goals

- No API surface, SSE wiring, or frontend (C5–C7)
- No `cmd/rk` cron subcommand files (C2, parallel sibling agent) — `serve.go`/`doctor.go` only
- No operator-tick entry seeding (C4), no orphan GC/TTL (C8), no `cron` expression evaluation or `catch_up` (C9), no respawn implementation (C4/C8)
- No `when-idle` long-bound policy (drop vs deliver-late) — spec open question 2, decided at C9; v1 holds indefinitely via cross-tick retry

### Design Decisions

#### Held outcomes never reach the delivery log
**Decision**: `Outcome.Held` outcomes skip the log append; the hold is cross-tick retry via unchanged anchors.
**Why**: the log is the anchor-derivation source (`every` last-line, backoff streak join) — logging a held attempt advances anchors and silently delays the fire by a full period; not logging makes re-evaluation the retry mechanism for free.
**Rejected**: logging held attempts with an outcome filter in the schedule math (touches C1's pinned derivation semantics for no gain); in-tick waiting for idle (violates the short-lived-tick contract).
*Introduced by*: 260906-kl1g-daemon-ticker-cron-delivery

#### Held wake edges are consumed
**Decision**: a `wake`-reason fire held under `when-idle` does not restore the wake cursor; the payload lands on the entry's next schedule-due or next edge.
**Why**: `Evaluate` computes `NextCursor` before delivery outcomes exist; re-plumbing cursor persistence around outcomes buys nothing real — the only planned wake user (operator tick) is `deliver: immediate`.
**Rejected**: outcome-aware cursor persistence (couples the pure evaluator to delivery results).
*Introduced by*: 260906-kl1g-daemon-ticker-cron-delivery

#### `when-idle` busy predicate is `active | waiting`
**Decision**: hold on `active` and `waiting`; deliver on `idle` and unknown ("").
**Why**: matches the operator request-lane busy gate (`api/operator.go`); typing into a `waiting` pane would stack a payload behind a pending question; an unknown-state pane (plain shell, no agent) can't be gated on a signal it doesn't carry.
**Rejected**: hold on unknown (a when-idle entry targeting a non-agent pane would never fire).
*Introduced by*: 260906-kl1g-daemon-ticker-cron-delivery

#### Rate-cap key: pane ID for resolved fires, entry ID for absent fires
**Decision**: the trailing-hour count keys on the log line's target pane for deliveries, and on the entry ID for absent dispositions (their lines carry no pane).
**Why**: the spec's cap is per-target; absent fires have no target, but their notify path still needs the cap (the spec assigns notify throttling to it).
**Rejected**: a separate notify-cursor sidecar (the pulse plan's design, obsoleted by the spec's "the rate cap covers notify throttling").
*Introduced by*: 260906-kl1g-daemon-ticker-cron-delivery

## Tasks

### Phase 1: Setup

- [x] T001 [P] Add `cron_ticker` registry entry (bool, def "true", behavior, ui+live) with a `CronTicker` field on `Settings`, mirroring `auto_name`'s tolerant parse/serialize/read/apply, in `app/backend/internal/settings/settings.go`; extend the registry test in `settings_test.go`/`registry_test.go` <!-- R2 -->
- [x] T002 [P] Add named constants `DefaultTickInterval` (30s), `tickTimeout` (per-iteration ctx bound), `DefaultTargetRatePerHour` (30), `MaxEntriesPerServer` (50) in `app/backend/internal/cron` (ticker.go / tick.go / store.go as each lands) <!-- R1 -->

### Phase 2: Core Implementation

- [x] T003 Add `Held bool` to `Outcome` and make `tickServer` skip the log append for held outcomes, recording a `delivery-held` diagnostic instead; table-driven test proving a held outcome leaves the log untouched and the fire re-fires next tick while `delivered`/`failed` outcomes append, in `app/backend/internal/cron/tick.go` + `tick_test.go` <!-- R5 -->
- [x] T004 Surface due-but-unresolved fires: add `Absent []Fire` to `EvalResult`, emitted (empty PaneID) after guard evaluation when due-ness holds and `facts.Resolved()` is false; keep the `target-unresolved` diagnostic; tests for guard-suppressed absent fires and determinism, in `app/backend/internal/cron/evaluate.go` + `evaluate_test.go` <!-- R6 -->
- [x] T005 Apply `if_absent` in `tickServer`: `skip`/empty → log `skipped-absent`; `notify` → `Deps.Notifier` seam (default `push.Notify`, fail-silent) + log `notified-absent`; `respawn` → notify behavior + `respawn-unimplemented` diagnostic; tests with a fake notifier covering all three and once-per-due-period anchoring, in `app/backend/internal/cron/tick.go` + `tick_test.go` <!-- R6 -->
- [x] T006 New `app/backend/internal/cron/deliver.go`: `cronInjectTmux` adapter (mirror `riffInjectTmux`), `cronSendBuffer` constant, `EngineDeliverer` implementing `Deliverer` — `immediate` sends via `engine.Send(...)` with sanitize+submit; `when-idle` reads `tmux.PaneAgentState` and returns `Outcome{Status: "held-busy", Held: true}` on `active`/`waiting`; seams for state reader + engine send so `deliver_test.go` runs without tmux <!-- R4 R5 -->
- [x] T007 Per-target rate cap in `tickServer` before delivery (and before absent dispositions): trailing-hour count over parsed log lines keyed pane-ID/entry-ID, suppress with logged `rate-capped` outcome + `slog.Warn`; tests: cap trips at 30, held lines absent from count, absent-fire cap keys on entry, in `app/backend/internal/cron/tick.go` + `tick_test.go` <!-- R7 -->
- [x] T008 Entry cap: `Add` refuses past `MaxEntriesPerServer` with a named-cap error; evaluation processes only the first cap-many entries with `entry-cap-exceeded` diagnostics for the rest; tests for both seams, in `app/backend/internal/cron/store.go` + `evaluate.go` (or load site) + tests <!-- R8 -->

### Phase 3: Integration & Edge Cases

- [x] T009 New `app/backend/internal/cron/ticker.go`: `Ticker` with `Start(ctx)` (snapshotter pattern) — per-iteration settings gate (`settings.Load().CronTicker`), panic recovery, per-tick timeout ctx, stops on ctx done; seams for the tick fn + settings read; `ticker_test.go` covering gate-off skip, panic survival, ctx stop <!-- R1 R2 -->
- [x] T010 Wire ticker + deliverer in `app/backend/cmd/rk/serve.go` after the snapshotter block: resolve `cron.DefaultDir()` (failure ⇒ `slog.Warn` + disabled, never blocks serving), construct `cron.Deps{Deliverer: NewEngineDeliverer(), Notifier: ...}`, start `Ticker` bound to serve ctx <!-- R1 -->
- [x] T011 Doctor row in `app/backend/cmd/rk/doctor.go`: informational OK-shaped `cronTickerCheck()` reporting setting state + state-dir resolvability, registered with the existing checks; test in `doctor_test.go` <!-- R3 -->

### Phase 4: Polish

- [x] T012 Run the backend gate: `cd app/backend && go test ./...` green; confirm zero diffs under `cmd/rk` cron subcommand files (C2's territory: `git status` shows only serve.go/doctor.go/internal changes) <!-- R1 -->

## Execution Order

- T003 and T004 block T005 (dispositions need Held semantics and Absent fires)
- T006 blocks T010 (wiring needs the deliverer); T009 blocks T010
- T001 blocks T009 (settings gate) and T011 (doctor reads the key)
- T002 lands alongside first consumer; T007 after T003 (log-outcome classes), T008 independent

## Acceptance

### Functional Completeness

- [x] A-001 R1: A `Ticker` exists in `internal/cron`, invokes `Tick` at `DefaultTickInterval`, is started from `serve.go` bound to the serve context, and startup failures degrade to a Warn without blocking serving
- [x] A-002 R2: `cron_ticker` is a registered live bool setting defaulting to true, consulted every iteration — flipping it takes effect without restart
- [x] A-003 R3: `rk doctor` renders an always-OK cron row with setting state and state-dir facts
- [x] A-004 R4: `EngineDeliverer` delivers `immediate` fires through `inject.Engine` on buffer `rk-cron-send` via a tmux adapter — no raw send-keys anywhere in the new code
- [x] A-005 R6: `skip`, `notify`, and `respawn` dispositions behave as specified (log outcomes `skipped-absent`/`notified-absent`, fail-silent notifier, `respawn-unimplemented` diagnostic)
- [x] A-006 R7: The per-target rate cap trips at the named constant with a logged `rate-capped` line and a Warn
- [x] A-007 R8: `Add` refuses past 50 entries; oversized files evaluate only the first 50 with diagnostics

### Behavioral Correctness

- [x] A-008 R5: A held (`when-idle`, busy) outcome appends NO log line — the `every` anchor and backoff streak join are unchanged by holds, and the fire is due again next tick (test-pinned)
- [x] A-009 R5: The busy predicate is exactly `active|waiting`; `idle` and unknown deliver (test-pinned)
- [x] A-010 R6: Guards are evaluated before absent fires are emitted — a suppressed absent fire produces no notify and no log line

### Scenario Coverage

- [x] A-011 R1: A panicking tick iteration is recovered and the daemon's ticker continues (test exists)
- [x] A-012 R7: Held outcomes never count toward the rate cap (test exists)
- [x] A-013 R6: A dead target with `if_absent: notify` notifies once per due period, not once per tick (test exists)

### Edge Cases & Error Handling

- [x] A-014 R1: A tick exceeding the per-tick timeout is cancelled by its context and the next iteration runs normally
- [x] A-015 R4: A send failure logs outcome `failed: <detail>` (anchor advances — no per-tick retry storm)
- [x] A-016 R2: An unparseable `cron_ticker` value keeps the default (on) — tolerant parse

### Code Quality

- [x] A-017 Pattern consistency: ticker mirrors the snapshotter posture; adapter mirrors `riffInjectTmux`; settings entry mirrors `auto_name`; doctor row mirrors the ephemeral/tmux-config posture
- [x] A-018 No unnecessary duplication: reuses `inject.Engine`, `internal/tmux` primitives, `push.Notify`, C1's load/log/facts helpers — no reimplementation
- [x] A-019 All subprocess interaction stays behind `internal/tmux` (`exec.CommandContext` with timeouts) — the new code constructs no exec calls
- [x] A-020 No comment narration: comments state constraints (why held skips the log, why the cap keys differ), never change-ID provenance or next-line narration
- [x] A-021 New behavior is test-covered per code-quality.md (each new seam has a colocated `_test.go`)

### Security

- [x] A-022 R4: Delivered payloads pass through `inject.Sanitize`; pane IDs flow only from C1's validated schema (`tmux.ValidPaneID`) — no shell string construction

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change adds new functionality without making existing code redundant. The single-arg `boolValue` helper in `internal/settings/settings.go` was generalized in place (default parameter added) rather than left alongside a duplicate, and `cronInjectTmux` deliberately mirrors `riffInjectTmux` because cron cannot import riff.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Busy predicate = `active|waiting` (deliver on `idle`/unknown) | Operator request lane (api/operator.go:660) treats both as busy; unknown-state panes carry no gateable signal | S:55 R:75 A:75 D:60 |
| 2 | Confident | Notifier is a `Deps.Notifier` seam defaulting to `internal/push.Notify` | Matches C1's Deps seam pattern; fail-silent contract needs a test seam anyway | S:55 R:85 A:75 D:65 |
| 3 | Confident | Per-tick timeout = a named constant sized to the interval | Overlap is already impossible (flock); the timeout only bounds a hung enumeration | S:50 R:85 A:70 D:65 |
| 4 | Confident | Absent-fire rate-cap key = entry ID (resolved fires key on pane ID) | Absent log lines carry no pane; spec wants notify throttling under the same cap | S:45 R:75 A:65 D:60 |
| 5 | Confident | Entry-cap eval defense lives at the evaluation path over loaded entries (first 50 processed) | Load stays tolerant/complete for future list surfaces; evaluation is where storms materialize | S:45 R:75 A:65 D:60 |

5 assumptions (0 certain, 5 confident, 0 tentative).
