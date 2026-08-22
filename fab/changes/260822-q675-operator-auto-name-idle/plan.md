# Plan: Operator Auto-Name on Idle

**Change**: 260822-q675-operator-auto-name-idle
**Intake**: `intake.md`

## Requirements

### Operator Actuation: Auto-Name Trigger

#### R1: Busy→idle transition detection on the SSE tick
A new in-memory tracker SHALL observe every window's rolled-up `AgentState` on the per-server SSE tick (the seam where `waitingPushTracker` is advanced — `app/backend/api/sse.go:1408–1418`) and detect the per-window transition **busy → idle**, where busy is `active` or `waiting` and idle is exactly `idle`. Empty/unknown states are neither busy nor idle: a window with no agent hooks MUST never trigger, and a `""`→`idle` tick is not a transition. The tracker MUST be pure and synchronous in the hot path (no I/O), mirroring `notifyWaiting`'s decide-then-fan-out shape.

- **GIVEN** a window whose tracked state was `active` (or `waiting`) on the previous tick
- **WHEN** the current tick derives its rollup as `idle`
- **THEN** the tracker emits an auto-name candidate for that window
- **AND** an `idle`→`idle`, `""`→`idle`, or first-ever-observation tick emits nothing.

#### R2: Eligibility gating — all facts from the same tick's snapshot
A candidate SHALL be dropped (no delivery attempted) unless ALL hold, derived from the same already-fetched sessions snapshot with no extra `FetchSessions` call: (a) the server has an operator window (`Role == "operator"`); (b) the subject is not itself the operator window; (c) the subject has a non-empty `ChatSessionRef` (the `fix-tab-name` template's `requiresChatRef`). A server with no operator MUST produce no delivery, no error-level log, and no tracker error — the feature degrades to absent.

- **GIVEN** a busy→idle transition on a window with no `ChatSessionRef`, or on the operator window itself, or on a server with no operator
- **WHEN** eligibility is evaluated
- **THEN** no delivery is attempted and the tick proceeds normally.

#### R3: Rate limiting — cooldown, min-gap, one per tick
The tracker SHALL enforce: (a) a **per-window cooldown** of 15 minutes since that window's last auto-request attempt; (b) a **per-server min-gap** of 60 seconds since the last auto-delivery on that server (the operator's `AgentState` lags a delivery by a hook round-trip, so back-to-back transitions must not double-deliver); (c) **at most one delivery per server per tick** (excess candidates in the same tick are dropped, not queued). Both durations are named constants. The per-window cooldown MUST stamp on every attempt — including one skipped because the operator was busy — so a busy operator never converts deferred transitions into a later burst.

- **GIVEN** a window that triggered an auto-request 5 minutes ago
- **WHEN** it transitions busy→idle again
- **THEN** no delivery is attempted (cooldown).
- **AND GIVEN** two eligible windows transitioning in the same tick, **THEN** exactly one delivery is attempted and the other window is not stamped (its next transition may fire).

#### R4: Delivery via a shared internal core; busy operator skips
The post-parse core of `handleOperatorRequest` (`app/backend/api/operator.go`) — fact derivation, the busy gate, operator pane resolution, and injection — SHALL be extracted into an internal function usable with already-resolved `*tmux.WindowInfo` subject/operator values, and the HTTP handler MUST keep byte-identical external behavior (all existing `operator_test.go` cases pass unchanged). The auto-namer SHALL deliver through this core in a **detached goroutine** (the tick never blocks on injection, mirroring `notifyWaiting`'s fan-out) with its own timeout context (`chatSendTotalBudget`). An operator whose state is `active`/`waiting` at delivery time ⇒ the request is **skipped** — never queued, never retried (Constitution II); injection/probe errors are logged at debug/info level and otherwise dropped. The novelty echo probe remains the fail-closed guard.

- **GIVEN** an eligible candidate and an operator whose rollup is `active`
- **WHEN** delivery runs
- **THEN** no injection subprocess runs, nothing is queued, and the subject window's cooldown is stamped.
- **AND GIVEN** an idle operator, **THEN** the injection sequence targets the operator's resolved chat pane exactly as the HTTP path does.

#### R5: Template no-op clause
`renderFixTabName` SHALL gain one clause instructing the operator that if the current window name already accurately describes the work, it should do nothing — keeping the existing do-not-reply bound. The clause applies to both the manual (HTTP) and auto paths — same registry entry, one template.

- **GIVEN** the rendered `fix-tab-name` prompt
- **WHEN** its content is inspected
- **THEN** it contains the already-accurate⇒do-nothing instruction alongside the existing rename command and do-not-reply bound.

#### R6: In-memory lifecycle with reap
The tracker's state (per-window previous state + cooldown stamps, per-server delivery stamps) SHALL live only in process memory (Constitution II — mirrors the waiting-push episode map: a daemon restart forgets cooldowns, acceptable). State for windows/servers no longer present SHALL be reaped on the same post-loop seam `waitingPush.retain` uses (`sse.go:1559–1567`), so the maps cannot grow unboundedly across dead servers/windows.

- **GIVEN** a window whose server was reaped or which no longer appears in the polled snapshot
- **WHEN** the post-loop retain runs
- **THEN** its tracker entries are removed.

#### R7: Opt-in setting gate (user review feedback, 2026-08-22; revised same day: settings key, not env var)
The trigger SHALL be strictly opt-in behind the **`auto_name` key in the settings store** (`internal/settings`, `~/.rk/settings.yaml` — the same store that holds the theme): default **off**; tolerant read (`strconv.ParseBool` values, quote-stripped; anything else keeps off); serialized only when true so legacy files round-trip byte-identically. `Server.autoNameEnabled` is seeded from `settings.Load().AutoName` at construction, so a toggle applies on the next daemon restart (live application is deferred to the config-consolidation plan, `fab/plans/sahil/26-08-22-config-consolidation.md`, phase 3). When disabled, `initSSEHub` SHALL nil the hub's tracker — the feature-absent state both tick sites (`advance`, `retain`) already check — so no transition detection, delivery, or state accumulation occurs at all. When enabled, R1–R6 apply unchanged. There SHALL be no `RK_AUTO_NAME` env var (env is deployment bootstrap, not a settings channel — the first iteration used one and was reverted).

- **GIVEN** a settings file without `auto_name` (or with `auto_name: false` / garbage)
- **WHEN** the daemon starts and the hub initializes
- **THEN** the hub's auto-name tracker is nil and the feature is entirely absent.
- **AND GIVEN** `auto_name: true`, **THEN** the tracker is constructed with its delivery seam wired and R1–R6 semantics apply.

### Non-Goals

- ~~No config toggle or env var — armed exactly when an operator window exists (intake assumption #5).~~ **Revised 2026-08-22 (user review feedback on PR #711)**: the trigger is strictly opt-in behind the `auto_name` settings key (a first-iteration `RK_AUTO_NAME` env var was reverted the same day) — see R7.
- No new HTTP endpoint, body field, or template id; no frontend changes.
- No queue, no persistence, no retry; no SSE hub wake on delivery (rk mutates no tmux state).

### Design Decisions

#### Mirror waitingPushTracker rather than a new observer framework
**Decision**: the auto-name tracker is a sibling of `waitingPushTracker` — own file, own mutex, clock + delivery func seams for tests, advanced synchronously in the per-server tick, fan-out detached.
**Why**: the seam already exists, is Constitution-II-vetted ("no durable store beyond the hub's episode map"), and its test pattern (pure decision function) is proven.
**Rejected**: a generic transition-observer registry (speculative abstraction for a second consumer); a separate polling goroutine (duplicate FetchSessions cost, drift from the hub's snapshot).
*Introduced by*: 260822-q675-operator-auto-name-idle

#### Delivery seam is an injected closure, not a hub→Server reference
**Decision**: the tracker holds `deliver func(...)`-style seams (as `waitingPushTracker` holds `notify`); the Server wires a closure over the extracted delivery core at hub construction.
**Why**: keeps the tracker pure/unit-testable and avoids a hub→Server cycle; identical to the waiting-push `notify` seam.
**Rejected**: calling `s.injectChatMessage` directly from the tracker (couples tracker tests to the injection engine).
*Introduced by*: 260822-q675-operator-auto-name-idle

## Tasks

### Phase 1: Core Implementation

- [x] T001 Extract the post-parse delivery core from `handleOperatorRequest` into an internal function in `app/backend/api/operator.go` (e.g. `deliverOperatorRequest(ctx, server string, subject, operator *tmux.WindowInfo, tmpl operatorTemplate) error` returning typed/sentinel errors the HTTP handler maps to its existing 404/409/500 bodies); handler behavior stays byte-identical and all existing `app/backend/api/operator_test.go` cases pass unchanged <!-- R4 -->
- [x] T002 [P] Add the already-accurate⇒do-nothing clause to `renderFixTabName` in `app/backend/api/operator.go`; update the rendered-content assertions in `app/backend/api/operator_test.go` <!-- R5 -->
- [x] T003 Create `app/backend/api/auto_name.go`: `autoNameTracker` with per-window previous-state + cooldown maps and per-server last-delivery map (keyed via the `waitingKey` pattern), named constants for the 15-min cooldown and 60-s min-gap, clock seam, and a pure per-tick decision method (observe snapshot → at most one eligible candidate per server, applying R1 transitions, R2 eligibility, R3 limits) <!-- R1 -->

### Phase 2: Integration

- [x] T004 Wire the tracker into the hub in `app/backend/api/sse.go`: field + construction beside `waitingPush` (~:287/:412), per-tick advance after the waiting-push block (~:1418) with delivery fanned out in a detached goroutine through an injected deliver closure (wired at hub construction over T001's core with `chatSendTotalBudget` timeout; busy-skip stamps cooldown; errors logged quietly, never blocking the tick), and post-loop retain beside `waitingPush.retain` (~:1559–1567) <!-- R4 -->
- [x] T005 Tracker lifecycle: implement the retain/reap method on `autoNameTracker` (live-key accumulation from the tick, sweep of dead windows/servers) following `waitingPushTracker.retain` <!-- R6 -->

### Phase 3: Tests & Verification

- [x] T006 Unit tests in `app/backend/api/auto_name_test.go` (pure decision function, fake clock/deliver): active→idle and waiting→idle fire; idle→idle, ""→idle, and first-observation don't; no-operator / no-chatref / subject-is-operator skips; cooldown suppression incl. stamp-on-busy-skip; per-server min-gap; one-per-tick with the un-delivered window left unstamped; retain sweeps dead entries <!-- R1 -->
- [x] T007 Integration-shape tests: HTTP handler equivalence through the extracted core (busy 409, no-operator 404, probe-failure 409 unchanged) and an auto-path test that a busy operator produces zero injection calls via the deliver seam <!-- R4 -->
- [x] T008 Run verification gates: `cd app/backend && go test ./...`; confirm no frontend impact (`git status` shows backend-only) <!-- R4 -->

### Phase 4: Setting Gate (user review feedback, 2026-08-22)

- [x] T009 Add `AutoName bool` to `app/backend/internal/settings/settings.go` (`auto_name` scalar: tolerant `ParseBool` parse case, emit-only-when-true serialize, default off), seed `Server.autoNameEnabled` from `settings.Load()` in `NewServer`, gate in `initSSEHub` (`app/backend/api/router.go` — disabled ⇒ nil the tracker; enabled ⇒ wire the deliver seam). No env var, no `.env` entry (first iteration's `RK_AUTO_NAME` reverted) <!-- R7 -->
- [x] T010 Tests: `TestAutoName` in `app/backend/internal/settings/settings_test.go` (default off, ParseBool/garbage matrix, round-trip, omitted-when-off serialization); `TestAutoName_SettingGatesTracker` in `app/backend/api/auto_name_test.go` (disabled ⇒ nil tracker, enabled ⇒ wired seam); `go test ./internal/settings/ ./internal/config/ ./api/` green <!-- R7 -->

## Execution Order

- T001 blocks T004 and T007; T003 blocks T004, T005, T006. T002 is independent.

## Acceptance

### Functional Completeness

- [x] A-001 R1: A window transitioning `active`→`idle` or `waiting`→`idle` produces an auto-name candidate on that tick; no other state pair does
- [x] A-002 R2: Candidates on operator-less servers, chatless windows, or the operator window itself are dropped with no delivery attempt and no error-level noise
- [x] A-003 R3: 15-min per-window cooldown, 60-s per-server min-gap, and one-delivery-per-server-per-tick are all enforced by the decision function; cooldown stamps on busy-skip
- [x] A-004 R4: Delivery reuses the extracted core (facts → busy gate → pane resolve → `injectChatMessage`) in a detached goroutine; busy operator ⇒ silent skip, no queue/retry
- [x] A-005 R5: The rendered `fix-tab-name` prompt carries the already-accurate⇒do-nothing clause plus the existing command and bounds
- [x] A-006 R6: Tracker state is process-memory only and reaped for dead windows/servers on the post-loop retain seam

### Behavioral Correctness

- [x] A-007 R4: The HTTP `operator-request` endpoint's external behavior is byte-identical after the extraction — every pre-existing `operator_test.go` case passes without modification (except the R5 content assertions)

### Scenario Coverage

- [x] A-008 R1: Unit tests cover the full transition matrix (fires/doesn't) per T006
- [x] A-009 R3: Unit tests cover cooldown, min-gap, one-per-tick, and stamp-on-busy-skip semantics
- [x] A-010 R4: A test proves zero injection subprocess/seam calls when the operator is busy at delivery time

### Edge Cases & Error Handling

- [x] A-011 R1: A window first observed as `idle` (no prior state) never triggers; a flapping window is bounded by the cooldown
- [x] A-012 R6: Server reap / window disappearance removes tracker entries (no unbounded map growth)
- [x] A-013 R4: Injection/probe failures on the auto path are contained (logged, dropped) — the tick and other servers' processing are unaffected

### Code Quality

- [x] A-014 Pattern consistency: tracker file/tests mirror `waiting_push.go`'s structure (seams, mutex, retain, pure decision fn)
- [x] A-015 No unnecessary duplication: the HTTP handler and auto path share the extracted delivery core; no second FetchSessions on the tick
- [x] A-016 No new subprocess patterns: all tmux interaction stays behind the existing injection engine (`exec.CommandContext` discipline untouched)
- [x] A-017 Derive-don't-store: no durable state introduced; in-memory maps only (Constitution II)
- [x] A-018 Tests cover the added behavior (new-feature test requirement from code-quality.md)

### Security

- [x] A-019 R4: No client-controlled input enters the auto path (trigger is derived state; template facts are server-derived; body/template surface unchanged)

### Setting Gate (R7, added at review-pr per user feedback)

- [x] A-020 R7: With `auto_name` absent/false/unparsable in the settings store the hub's tracker is nil — no detection, delivery, or state accumulation (verified by `TestAutoName_SettingGatesTracker` + `TestAutoName` settings tests)
- [x] A-021 R7: With `auto_name: true` the tracker is constructed with its deliver seam wired and R1–R6 semantics apply unchanged; the key serializes only when true (legacy files byte-identical) and no `RK_AUTO_NAME` env var or `.env` entry exists

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

None — this change adds new functionality without making existing code redundant (the handler's inline delivery logic moved into the shared `deliverOperatorRequest` core; no orphaned symbols, branches, or config remain).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Extracted core returns typed/sentinel errors; the HTTP handler maps them to its existing status/body strings (rather than the core writing HTTP responses) | Keeps the core reusable from the hub goroutine; exact error taxonomy is the worker's latitude within byte-identical handler behavior | S:60 R:85 A:80 D:70 |
| 2 | Confident | Deliver seam is an injected closure wired at hub construction (waiting-push `notify` pattern) | Existing precedent in the same file; avoids hub→Server coupling | S:70 R:85 A:85 D:80 |
| 3 | Confident | Auto-path delivery failures (probe, injection) log quietly and drop — no surfacing channel exists for a background trigger | The seam has no response channel; a toast has no user context; next transition retries naturally after cooldown | S:65 R:80 A:80 D:75 |
| 4 | Confident | Extracted core wraps HTTP-mapping failures as a typed `operatorReject{status,msg}` sentinel; transcript-resolution and injection errors return RAW so the handler's existing `errors.Is`/`errors.As` mappings (`writeChatReadError` vocabulary, `inject.ProbeFailure`→409) stay byte-identical without re-encoding | Preserves the pre-extraction error taxonomy exactly; the auto path just logs whatever comes back | S:70 R:85 A:80 D:70 |
| 5 | Confident | The core applies the `chatSendTotalBudget` timeout INTERNALLY (both callers pass a bare parent ctx) — handler behavior unchanged (same budget, same parent), auto-path goroutine gets its deadline for free | Keeps the deadline rule in one place; the handler previously created it inline with identical arguments | S:60 R:80 A:75 D:65 |
| 6 | Confident | `deliver` closure is wired post-construction in `initSSEHub` (not inside `newSSEHub`) since the 4-arg hub constructor can't see the Server; test hubs run with `deliver == nil` (tracking/live-keys still advance, fan-out skipped) — mirrors the `codeServerPort` post-construction seeding pattern | Keeps every existing `newSSEHub` test call site compiling untouched; nil-deliver degrade mirrors the plan's injected-seam decision | S:65 R:85 A:80 D:70 |
| 7 | Confident | Cooldown + min-gap stamp in `decide` at EMISSION time (not after delivery), so the busy-skip case (reject surfaced by the core) is covered by construction; ineligible transitions (no operator / chatless / operator-subject) are consumed unstamped | R3 demands stamp-on-busy-skip and the busy gate lives inside the core, below the tracker's horizon; unstamped ineligibility lets a window that later gains a chat ref fire immediately | S:60 R:85 A:75 D:65 |

| 8 | Certain | `auto_name` settings key gates at hub construction (nil tracker when off; restart to apply), read from the existing `internal/settings` store | User directive (gate behind a setting in the settings file, not an env var — 2026-08-22); nil is the feature-absent state the tick sites already handle; live application deferred to the config-consolidation plan | S:90 R:90 A:90 D:85 |

8 assumptions (1 certain, 7 confident, 0 tentative).
