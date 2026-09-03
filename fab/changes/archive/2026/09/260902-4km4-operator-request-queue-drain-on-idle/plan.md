# Plan: Operator Request Queue — Drain on Idle

**Change**: 260902-4km4-operator-request-queue-drain-on-idle
**Intake**: `intake.md`

## Requirements

### Backend: Queue Tracker (`app/backend/api/operator_queue.go`)

#### R1: In-memory per-server queue tracker in the established tracker shape
The backend SHALL add an `operatorQueueTracker` in a new `app/backend/api/operator_queue.go`, a structural sibling of `autoNameTracker` (`api/auto_name.go`): own mutex, `now func() time.Time` clock seam, an injected `deliver` closure seam (nil in test hubs — tracking still advances, fan-out skipped), advanced synchronously on the SSE per-server tick beside the auto-name block (`api/sse.go` ~:1490), and reaped on the post-loop retain seam scoped to successfully-polled-or-dead servers (`api/sse.go` ~:1647). State is process-memory only — a daemon restart forgets queued intents (Constitution II, the precedent `auto_name.go`'s header cites). Entries store the REQUEST, never the rendered prompt: `{template, windowID, text, session, enqueuedAt}`.

- **GIVEN** a freshly constructed hub
- **WHEN** the tracker is wired at `initSSEHub`
- **THEN** it advances on every per-server tick and its per-server state is dropped by the retain sweep when a server dies.

#### R2: Enqueue — coalesce, bound, idempotent
Enqueue SHALL dedup on the key `(template, windowID/session, hash(text))`: a duplicate returns success idempotently and KEEPS the original entry's `enqueuedAt` (no TTL extension by re-tapping). The per-server queue depth SHALL be capped at 8 (`operatorQueueCap` named constant); an enqueue against a full queue is rejected with a structured queue-full signal the handler maps to `409 "operator queue is full"`. Order is FIFO (oldest first).

- **GIVEN** a queued `{fix-tab-name, @5}` entry
- **WHEN** the same request is enqueued again
- **THEN** the queue still holds one entry with the original `enqueuedAt`, and the caller sees the same queued outcome.
- **AND GIVEN** a queue already holding 8 entries, **WHEN** a distinct request arrives, **THEN** enqueue is refused (queue-full).

#### R3: Level-triggered drain — one entry per observation
On each per-server tick the tracker SHALL evaluate the LEVEL condition — operator window present AND its rolled-up `AgentState` reads exactly `idle` AND the queue is non-empty AND the per-server drain min-gap (60s, `operatorQueueMinGap` named constant, same value + rationale as `autoNameMinGap`: the operator's rolled-up state lags an injection by a hook round-trip) has elapsed — and when it holds, pop exactly ONE entry (FIFO) and deliver it in a detached `context.Background()` goroutine (the `advance` fan-out pattern — the tick never blocks on injection), stamping the min-gap at decision time. The tracker SHALL keep its own per-server min-gap stamp, independent of `autoNameTracker.lastSent`. It is NOT edge-triggered: no transition memory is required for draining.

- **GIVEN** a non-empty queue and an operator observed `idle` with the min-gap elapsed
- **WHEN** the tick advances the tracker
- **THEN** exactly one entry is popped and handed to the deliver seam; a second tick inside the min-gap pops nothing.
- **AND GIVEN** an operator at `active`/`waiting`/empty state, **THEN** nothing is popped (entries wait).

#### R4: Drain-time revalidation and re-render from a FRESH fetch inside the delivery goroutine
The level condition (R3) is evaluated on the tick's snapshot, but the detached delivery goroutine SHALL perform its OWN fresh `s.sessions.FetchSessions` and re-derive everything from that result — it MUST NOT retain or read the tick's shared sessions slice (the SSE tick mutates that slice on later cache-hit ticks, e.g. `attachPRStatus`; retaining it is an unsynchronized read/write race). From the fresh result it re-validates the popped entry against the SAME gates the live path runs: subject window still alive and not the operator (window-scoped entries); chat ref still resolvable via `chat.TranscriptPath` (`requiresChatRef` templates); `requiresWaiting` still satisfied; `session` scope still names a live session (`acceptsSession` entries); operator window present with a resolvable chat pane. It then re-renders via the entry's registry render func over freshly built facts (`operatorFacts` / `buildServerOperatorFacts`, with the same consumer-side session filtering as the handler) and delivers through the existing `deliverOperatorPrompt` core (its busy gate untouched — and, reading the FRESH operator state, that gate is now a REAL re-busy check). A gate failure at drain SHALL drop the entry quietly — a `slog` debug line, never an error. A `FetchSessions` error at drain is transient infrastructure: the entry is requeued at the head (nothing was typed), debug-logged.

- **GIVEN** a queued `fix-tab-name` entry whose subject window was killed
- **WHEN** the drain pops it
- **THEN** the entry is dropped with a debug log line and no injection runs.
- **AND GIVEN** a still-valid entry, **THEN** the delivered prompt is rendered from the goroutine's fresh fetch, not from enqueue-time or tick-snapshot state, and no reference to the tick's sessions slice survives into the goroutine.
- **AND GIVEN** a `FetchSessions` error at drain, **THEN** the entry is back at the head of the queue.

#### R5: Drain failure policy — drop on injection failure, requeue on busy re-check
A drain-time injection failure (`inject.ProbeFailure`, `inject.SubmitUnverified`, or any other injection error) SHALL drop the entry with a debug log line — never retry (nobody is watching at drain; a retry could double-paste). The ONE exception is the busy-class `operatorReject` sentinel from `deliverOperatorPrompt`, which — because the goroutine fetched fresh state (R4) — genuinely means the operator went busy between the tick's idle observation and the delivery: nothing was typed, so the entry is NOT consumed — it goes back to the head of its queue for a later idle observation, with the min-gap already stamped so the race cannot burst. This path MUST be reachable in production (the fresh fetch is what makes it so) and covered by a test exercising the real deliver-closure semantics, not only a seam stub.

- **GIVEN** a popped entry whose injection returns `inject.ProbeFailure`
- **WHEN** the drain handles the error
- **THEN** the entry is gone from the queue and a debug line is logged.
- **AND GIVEN** an operator that turned `active` between the tick and the delivery goroutine's fresh fetch, **THEN** `deliverOperatorPrompt` rejects on fresh state and the entry is back at the head of the queue, draining on a later idle observation.

#### R6: TTL expiry
Entries older than 30 minutes (`operatorQueueTTL` named constant, measured from `enqueuedAt`) SHALL be dropped quietly at tick time (debug log only), independent of operator state — an operator parked in `waiting` for hours must not deliver stale intents.

- **GIVEN** an entry enqueued 31 minutes ago behind a `waiting` operator
- **WHEN** the next tick advances the tracker
- **THEN** the entry is dropped with a debug log line and never delivered.

### Backend: HTTP 202 Contract (`app/backend/api/operator.go`, wiring in `router.go`/`sse.go`)

#### R7: Busy 409 becomes enqueue + 202 on both routes; everything else fail-fast
Both HTTP handlers (`handleOperatorRequest`, `handleServerOperatorRequest`) SHALL branch on the busy-class `operatorReject` returned from delivery and convert it into enqueue + `202 {"queued": true}` — so a busy 409 can never escape the HTTP routes, while `deliverOperatorPrompt`'s internal busy gate stays byte-identical (it remains the fail-closed floor for every direct delivery, including the drain's re-busy race) and the auto-name caller keeps its existing debug-log-and-drop behavior on the same sentinel. All other validation stays fail-fast at request time exactly as today (Constitution I): unknown-template / wrong-scope / `acceptsText` / `acceptsSession` 400s, subject/operator/chat-ref 404s, the `requiresWaiting` zero-waiting 409, `inject.ProbeFailure`/`SubmitUnverified` 409s. A queue-full refusal maps to `409 "operator queue is full"`. Immediate delivery success stays `200 {"ok": true}`. No new routes (Constitution IV/IX); queueing is always-on (no settings key).

- **GIVEN** a valid `fix-tab-name` request while the operator is `active`
- **WHEN** the window-scoped handler runs
- **THEN** the response is `202 {"queued": true}` and the entry is in the tracker's queue.
- **AND GIVEN** an idle operator, **THEN** the response is `200 {"ok": true}` with no queue interaction.
- **AND GIVEN** an unknown template, wrong scope, missing chat ref, or zero-waiting `whats-stuck`, **THEN** today's 400/404/409 outcomes are unchanged and nothing is enqueued.

#### R8: Wiring at the hub seams
The tracker SHALL be wired where its siblings are: constructed at hub construction, applied at `initSSEHub` (`api/router.go` ~:271–285), with a deliver-closure builder on `Server` in the `autoNameDeliver` shape (`router.go` ~:286) closing over the drain revalidation + re-render + `deliverOperatorPrompt` sequence; advanced in the per-server tick right beside the auto-name block (`api/sse.go` ~:1490) and retained beside `autoName.retain` (`api/sse.go` ~:1647). Handlers reach the tracker through the hub (the `getAutoName` accessor pattern). Unlike auto-name there is no enable/disable seam — the tracker is always constructed.

- **GIVEN** the daemon starts
- **WHEN** `initSSEHub` runs
- **THEN** the queue tracker is live with its deliver closure wired, and the tick advances it for every polled server.

### Frontend: Queued Outcome (`app/frontend/src/`)

#### R9: Client surfaces delivered-vs-queued
`sendOperatorRequest` and `sendServerOperatorRequest` (`app/frontend/src/api/client.ts` ~:503/:530) SHALL surface the queued outcome to callers as a discriminated result (e.g. `{queued: boolean}` parsed from the response body; `200 {ok}` → delivered, `202 {queued}` → queued), keeping the `withServer` + `throwOnError` shape so structured 400/404/409 messages still surface as thrown Error messages.

- **GIVEN** a `202 {"queued": true}` response
- **WHEN** the client helper resolves
- **THEN** the caller can distinguish queued from delivered without re-parsing the response.

#### R10: Queued toast copy at every call site
The operator-request call sites — the fix-name / update-annotations / annotate-tab handlers in `app/frontend/src/app.tsx` (~:2359, :2385, :2399), the server-scoped palette handlers (`handleServerOperatorAction`, ~:3843–3864), and `app/frontend/src/components/operator-compose-dialog.tsx` (~:51) — SHALL toast a queued variant (`"Queued for operator — will be delivered when it is idle"`) when the result is queued, keeping their existing delivered copy otherwise. No new UI surface: no queue badge, no inspect/cancel affordance (Constitution IV). No SSE payload change.

- **GIVEN** a busy operator and a tap on "Fix tab name"
- **WHEN** the request resolves
- **THEN** the toast reads the queued variant; with an idle operator the existing delivered copy is unchanged.

### Non-Goals

- No queue inspect/cancel UI or endpoint — Constitution IV.
- No persistence of queued intents — restart degrades to today's behavior (Constitution II).
- No `rk notify` on drops — drops are routine stale intents, log-only.
- No change to `autoNameTracker` semantics — auto-name stays outside the queue.
- No change to chat-send's allow+probe busy policy or the injection engine.
- No settings key — queueing is always-on.

### Design Decisions

#### Level-triggered drain condition
**Decision**: drain when (operator idle ∧ queue non-empty ∧ min-gap elapsed), evaluated fresh each tick — not on the busy→idle edge.
**Why**: edge-triggering strands entries whenever the edge is missed (first observation is not a transition; the operator can flip idle between ticks); the level condition self-heals every missed edge at zero extra cost.
**Rejected**: reusing `autoNameTracker`'s transition detection for the drain trigger.
*Introduced by*: 260902-4km4-operator-request-queue-drain-on-idle

#### Busy race does not consume the entry
**Decision**: the busy-class `operatorReject` at drain requeues the entry (head position, min-gap stamped); every other delivery failure drops it.
**Why**: on a busy rejection nothing was typed, so redelivery is provably safe; dropping on a mere snapshot race would contradict the level-trigger's self-healing purpose. Real injection failures are ambiguous (text may sit in the composer) — retrying risks double-paste.
**Rejected**: uniform drop on any failure; uniform retry with a counter.
*Introduced by*: 260902-4km4-operator-request-queue-drain-on-idle

#### Queue the request, render at drain
**Decision**: entries carry `{template, windowID, text, session, enqueuedAt}`; facts re-derive and the prompt re-renders at drain from a fresh sessions fetch inside the detached worker.
**Why**: fact tables (agent states, PR rollups, transcript paths) go stale in minutes; a queued prompt would deliver stale facts as instructions.
**Rejected**: queueing the rendered prompt string.
*Introduced by*: 260902-4km4-operator-request-queue-drain-on-idle

## Tasks

### Phase 1: Setup

- [x] T001 Create `app/backend/api/operator_queue.go`: `queuedOperatorRequest` entry struct, `operatorQueueTracker` (mutex, per-server FIFO queues, per-server min-gap stamps, `now` clock seam, `deliver` closure seam, named constants `operatorQueueCap=8`, `operatorQueueTTL=30*time.Minute`, `operatorQueueMinGap=60*time.Second`), constructor `newOperatorQueueTracker` <!-- R1 -->

### Phase 2: Core Implementation

- [x] T002 Implement `enqueue` in `operator_queue.go`: dedup key `(template, windowID/session, hash(text))`, idempotent coalesce preserving `enqueuedAt`, cap-8 queue-full refusal, FIFO order <!-- R2 -->
- [x] T003 Implement `advance` (tick entry) in `operator_queue.go`: TTL sweep (drop + debug log), level-condition evaluation (operator idle ∧ non-empty ∧ min-gap), pop-one FIFO, decision-time min-gap stamp, detached-goroutine deliver fan-out; plus `retain` (post-loop reap) and a `requeueFront` used by the busy-race path <!-- R3, R6 -->
- [x] T004 Implement the drain delivery core: the detached goroutine performs its OWN fresh `FetchSessions` (retaining NO reference to the tick's sessions slice — the slice is mutated by later cache-hit ticks, e.g. `attachPRStatus`), re-runs the revalidation gates over the fresh result (subject alive/not-operator, chat ref via `chat.TranscriptPath`, `requiresWaiting`, `acceptsSession` liveness, operator chat pane), re-renders via the registry render funcs over freshly built `operatorFacts`/`buildServerOperatorFacts` (session-filtered), delivers through `deliverOperatorPrompt` (its busy gate now reads FRESH operator state, making the re-busy rejection reachable); failure policy — busy-class `operatorReject` ⇒ requeue front, `FetchSessions` error ⇒ requeue front, all other errors ⇒ drop + debug log. Reuse ONE subject-lookup helper between the drain path and `handleOperatorRequest` (no duplicated window scan — `findOperatorSubject` vs the inline handler loop) <!-- rework: cycle 1 — busy-race requeue was unreachable off the tick snapshot; snapshot retention raced attachPRStatus; subject scan duplicated --> <!-- R4, R5 -->
- [x] T005 `app/backend/api/operator_queue_test.go`: unit tests off the clock + deliver seams mirroring `auto_name_test.go` — coalesce/idempotence, cap overflow, FIFO order, TTL expiry, level-trigger + min-gap pacing, retain reap; plus busy-requeue and fetch-error-requeue vs injection-failure-drop tests exercising the REAL deliver-closure semantics (fresh-fetch path), not only a seam stub <!-- rework: cycle 1 — the busy-race test simulated an outcome the real closure could not return --> <!-- R1, R2, R3, R5, R6 -->

### Phase 3: Integration & Edge Cases

- [x] T006 Wire the tracker: hub field + accessor beside `autoName` in `api/sse.go` (~:298–491), construction + deliver-closure application in `initSSEHub` (`api/router.go` ~:271–285) with a `Server` builder in the `autoNameDeliver` shape (the closure fetches fresh sessions itself — it takes no snapshot slice), tick `advance` call beside the auto-name block (`api/sse.go` ~:1490), `retain` beside `autoName.retain` (~:1647) reusing `polledServers` for the retain keys (no parallel `liveOperatorQueueServers` allocation) <!-- rework: cycle 1 — closure signature drops the snapshot; retain key set duplicated polledServers --> <!-- R8 -->
- [x] T007 Handler enqueue branch in `app/backend/api/operator.go`: both handlers map the busy-class `operatorReject` to enqueue + `202 {"queued": true}` and the queue-full refusal to `409 "operator queue is full"` through ONE shared response-mapping helper (parameterized by the route's `queuedOperatorRequest`) — no repeated busy-enqueue/queue-full/generic-error/202 block per handler; all other error mappings and the `200 {"ok": true}` success unchanged <!-- rework: cycle 1 — the two handlers duplicated the whole mapping block --> <!-- R7 -->
- [x] T008 Update `app/backend/api/operator_test.go`: busy-gate handler assertions flip 409→202-with-enqueue; add queue-full 409 and coalesced-duplicate 202 handler tests; verify fail-fast 400/404/`requiresWaiting`-409 paths enqueue nothing; run `go test ./api` <!-- R7 -->

### Phase 4: Frontend & Verification

- [x] T009 [P] `app/frontend/src/api/client.ts`: `sendOperatorRequest` / `sendServerOperatorRequest` return a discriminated delivered/queued result parsed from the response (200 `{ok}` vs 202 `{queued}`), `withServer` + `throwOnError` shape unchanged <!-- R9 -->
- [x] T010 Queued toast variant at every call site: `app/frontend/src/app.tsx` fix-name/update-annotations/annotate-tab handlers (~:2359–2399) and `handleServerOperatorAction` palette sites (~:3843–3864), `app/frontend/src/components/operator-compose-dialog.tsx`; update/extend colocated unit tests (`operator-compose-dialog.test.tsx`, app-level toast tests) <!-- R10 -->
- [x] T011 Verification gates: `cd app/backend && go test ./...`, `cd app/frontend && npx tsc --noEmit`, targeted frontend unit tests for touched files <!-- rework: cycle 1 — re-run after the drain/handler rework --> <!-- R7, R9, R10 -->

## Execution Order

- T001 → T002 → T003 → T004 (tracker builds up in dependency order); T005 after T004
- T006 and T007 depend on T001–T004; T008 after T007
- T009 is independent ([P] with backend phase); T010 after T009; T011 last

## Acceptance

### Functional Completeness

- [x] A-001 R1: `operator_queue.go` exists with the tracker in the sibling shape (mutex, clock + deliver seams, advance/retain), entries carrying `{template, windowID, text, session, enqueuedAt}`; no persistence anywhere
- [x] A-002 R2: enqueue coalesces on the dedup key idempotently (original `enqueuedAt` kept), refuses past 8 entries per server, drains FIFO
- [x] A-003 R3: drain fires only on (idle ∧ non-empty ∧ min-gap elapsed), pops exactly one entry per observation, stamps min-gap at decision time, delivers in a detached goroutine; tracker keeps its own min-gap state
- [x] A-004 R4: the drain goroutine performs its own fresh FetchSessions (no tick-slice retention), re-validates all five gate classes against it, and re-renders from those facts; gate failures drop with a debug log and no injection; a FetchSessions error requeues at the head
- [x] A-005 R5: injection failures (probe/submit-unverified/other) drop the entry; the busy-class `operatorReject` — now reachable via the fresh fetch — requeues it at the head, covered by a test of the real closure semantics
- [x] A-006 R6: entries past 30 minutes drop at tick time regardless of operator state, debug-log only
- [x] A-007 R7: both routes return `202 {"queued": true}` on busy-enqueue and `409 "operator queue is full"` on overflow; `deliverOperatorPrompt`'s busy gate and the auto-name caller are byte-identical to before
- [x] A-008 R8: tracker wired at hub construction/`initSSEHub` with a deliver-closure builder, advanced and retained at the sibling call sites in `sse.go`
- [x] A-009 R9: client helpers return a discriminated delivered/queued result; error surfacing unchanged
- [x] A-010 R10: every operator-request call site toasts the queued variant on 202 and its existing copy on 200; no new UI surface

### Behavioral Correctness

- [x] A-011 R7: previously-409 busy responses are now 202 at the HTTP layer — no user-initiated operator request is lost to a busy operator short of cap/TTL bounds
- [x] A-012 R3: two queued entries deliver across two idle observations (never both in one), respecting the min-gap between them

### Scenario Coverage

- [x] A-013 R2: coalesced duplicate tap returns the queued outcome without growing the queue (unit test)
- [x] A-014 R5: busy-race requeue and later idle drain covered through the real fresh-fetch delivery closure
- [x] A-015 R6: TTL expiry behind a `waiting` operator covered by a unit test off the clock seam

### Edge Cases & Error Handling

- [x] A-016 R4: subject-window-gone, chat-ref-broken, zero-waiting (`whats-stuck`), and dead-session-scope entries each drop quietly at drain (unit tests)
- [x] A-017 R7: fail-fast 400/404/409 request-time paths enqueue nothing (handler tests)

### Code Quality

- [x] A-018 Pattern consistency: tracker mirrors `autoNameTracker`/`waitingPushTracker` structure (own file, mutex, seams, sibling wiring); handlers keep the `operatorReject` sentinel mapping style
- [x] A-019 No unnecessary duplication: drain revalidation reuses the registry flags, `buildServerOperatorFacts`/`operatorFacts` builders, `findOperatorSubject`, the shared queue-response mapper, and `deliverOperatorPrompt` — no parallel fact derivation or delivery path.
- [x] A-020 Named constants for cap/TTL/min-gap — no magic numbers; all subprocess work stays inside the existing injection engine (no new exec paths)
- [x] A-021 New behavior carries tests: tracker unit tests off seams, handler 202/409 tests, frontend queued-toast tests (code-quality "features include tests"; no new e2e — toast-copy-only UI delta)
- [x] A-022 No client polling: the frontend learns outcomes via existing SSE derive ticks; no setInterval/fetch added

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

None — this change adds new functionality without making existing code redundant.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Drain delivery closure lives on `Server` in the `autoNameDeliver` builder shape (`router.go`), with revalidation helpers extracted in `operator.go` only where reuse is clean | Mirrors the sibling wiring exactly; intake names the shape | S:70 R:85 A:85 D:80 |
| 2 | Confident | Busy-race requeue puts the entry at the HEAD of its queue (it was popped from the head; FIFO order preserved) | Follows from FIFO + non-consumption; alternative (tail) would reorder user intents on a pure race | S:55 R:90 A:80 D:75 |
| 3 | Confident | Handlers reach the tracker via a hub accessor (the `getAutoName` pattern) rather than a `Server` field | Sibling precedent; hub owns tick-adjacent state | S:60 R:90 A:80 D:75 |
| 4 | Confident | Dedup `hash(text)` is a plain FNV/sha over the raw text bytes; window-scoped entries key on `windowID`, server-scoped on `session` (empty for server-wide) | Any stable hash suffices; key shape follows the intake's `(template, windowID/session, hash(text))` verbatim | S:65 R:90 A:85 D:80 |
| 5 | Confident | The one request reserved for detached delivery remains part of the server's cap and dedup set until delivery settles | Preserves the strict eight-intent bound and prevents a duplicate tap or busy-race requeue from briefly creating a ninth pending intent | S:60 R:85 A:85 D:75 |

5 assumptions (0 certain, 5 confident, 0 tentative).
