# Intake: Operator Request Queue — Drain on Idle

**Change**: 260902-4km4-operator-request-queue-drain-on-idle
**Created**: 2026-09-02

## Origin

Promptless dispatch from `/fab-proceed`, synthesized from a `/fab-discuss` design conversation
(2026-09-02). The conversation resolved the design end-to-end; the decisions and rejected
alternatives below are transcribed from it.

> Operator requests ("Fix tab name", "Annotate tab", spawn-task, brief-me, etc.) are delivered to
> the server's operator window via `deliverOperatorPrompt` in `app/backend/api/operator.go`, whose
> busy policy is REJECT-never-queue: an operator whose `AgentState` is `active` or `waiting`
> returns a 409 and the request is lost. The user must notice and retry — bad especially from the
> mobile dashboard (fire-and-forget taps). Decided change: an in-memory pending queue per tmux
> server, drained when the operator is idle.

## Why

**Problem.** Both operator-request routes (`POST /api/windows/{windowId}/operator-request` and
`POST /api/operator-request`) share the busy gate inside `deliverOperatorPrompt`
(`app/backend/api/operator.go:601`): an operator at `active` or `waiting` yields
`409 "operator is busy (<state>) — request not delivered; try again when it is idle"`. The user's
intent is discarded. On the mobile dashboard, where operator actions are fire-and-forget taps
(flyout rows, palette entries, session-card rows), the user often never sees the failure toast —
or sees it and has no cheap way to know when the operator freed up. The operator is busy precisely
when a multi-tab server is most active, i.e. exactly when these requests are most wanted.

**If we don't fix it:** every operator feature stays reliable only against an idle operator; users
learn to distrust the buttons; the mobile dashboard's fire-and-forget model is broken for its
flagship actions.

**Why this approach** (an in-memory per-server pending queue, drained on idle): it preserves the
user's explicit intent without persisting state (Constitution II — the in-memory tracker precedent
`api/auto_name.go` cites in its own header comment), reuses the proven tracker shape
(`autoNameTracker` / `waitingPushTracker` riding the SSE per-tick assembly seam in `api/sse.go`),
and keeps the operator-actuation seam's delivery mechanics untouched — the drain enters through the
same `deliverOperatorPrompt` core. Alternatives were considered and rejected in the design
conversation (each with its reason):

- **Inject into the busy pane anyway** (the way Claude Code queues typed input mid-turn):
  `waiting` means a human-blocking dialog is up — typed text could answer it blind; the novelty
  echo probe cannot verify against an actively repainting screen; the operator may be a non-Claude
  provider with no input queueing.
- **tmux-option-backed durable queue** (`@rk_*` JSON on the operator window): survives restarts and
  arguably legal under Constitution X, but means the server writing state into tmux as a store,
  plus user-option mutations emit no control-mode event (safety-poll repaint lag). Rejected for
  in-memory.
- **Client-side retry-on-idle** (frontend holds the intent, re-POSTs when SSE shows idle): dies
  with the browser tab, invisible to other viewers, unusable by server-side callers. Per-viewer
  state is a blessed layer, but a queued instruction to a shared operator is not per-viewer intent.
- **Edge-triggered drain** (pure busy→idle transition, as `autoNameTracker` detects): strands
  entries whenever the edge is missed — a first-ever observation is not a transition, and the
  operator can flip idle before the tracker observes both states. Level-triggering self-heals.
- **Queue inspect/cancel UI**: deferred — Constitution IV (minimal surface area).

## What Changes

### 1. New in-memory queue tracker (`app/backend/api/operator_queue.go`)

A new tracker in the shape of `autoNameTracker` (`app/backend/api/auto_name.go`): own mutex,
`now func() time.Time` clock seam and injected `deliver` closure seam for tests, advanced
synchronously on the SSE per-server tick beside the auto-name block (`api/sse.go:1491`), reaped on
the post-loop retain seam scoped to successfully-polled-or-dead servers, wired where
`autoNameTracker`/`waitingPushTracker` are wired (hub construction / `initSSEHub` in
`api/router.go:271`). No persistence: a daemon restart forgets queued intents, degrading exactly to
today's reject behavior (Constitution II — the same precedent `auto_name.go`'s header cites).

**Entries queue the request, never the rendered prompt**:

```go
type queuedOperatorRequest struct {
    template   string    // registry id — closed set, validated at request time
    windowID   string    // subject @N, window-scoped templates only ("" for server-scoped)
    text       string    // validated acceptsText payload ("" otherwise)
    session    string    // validated acceptsSession scope ("" otherwise)
    enqueuedAt time.Time // TTL anchor
}
```

Fact tables (agent states, PR rollups, transcript paths) go stale in minutes — a `brief-me`
rendered 20 minutes ago is wrong. Rendering happens at drain time from fresh facts.

### 2. Drain — level-triggered, one entry per observation

On each SSE per-server tick the tracker evaluates the **level** condition: operator window present
AND its rolled-up `AgentState` reads exactly `idle` AND the server's queue is non-empty AND the
per-server drain min-gap has elapsed → pop ONE entry (FIFO, oldest first) and deliver it in a
detached `context.Background()` goroutine (the `advance` fan-out pattern — the tick never blocks
on injection). One entry per observation because the operator's rolled-up state lags an injection
by a hook round-trip — the exact rationale for the existing `autoNameMinGap` (60s); the queue
tracker keeps its own per-server min-gap stamp with the same value and rationale.

At drain, from the tick's already-fetched snapshot (no second `FetchSessions` — the auto-name
freshness posture), the entry is re-validated through the same gates the live path runs:

- subject window still alive (window-scoped entries) and not the operator itself;
- chat ref still resolvable via `chat.TranscriptPath` (`requiresChatRef` templates);
- `requiresWaiting` still satisfied (server has ≥1 waiting row);
- `session` scope still names a live session (`acceptsSession` entries);
- operator window still present with a resolvable chat pane.

Then re-render via the entry's registry render func over freshly built facts
(`operatorFacts` / `buildServerOperatorFacts`) and deliver through the existing
`deliverOperatorPrompt` core. **A gate failure at drain drops the entry quietly** — a daemon-log
line (slog debug, the auto-name pattern), never an error.

**Drain-time failure policy: drop, never retry.** An `inject.ProbeFailure` (text pasted, Enter
withheld) or `inject.SubmitUnverified` at drain has nobody watching; a retry would double-paste
into the composer. Drop with a daemon-log line. The one exception is the busy-gate rejection
itself (the typed `operatorReject` busy sentinel from `deliverOperatorPrompt`): the operator went
busy again between the tick's snapshot and the injection — nothing was typed, so the entry is NOT
consumed; it stays queued for a later idle observation (the level-trigger's self-healing), with
the min-gap stamped so the race cannot burst.

### 3. Coalesce, bound, expire

- **Dedup key** `(template, windowID/session, hash(text))` — repeated taps collapse to one entry.
  A coalesced duplicate returns the same `202 {queued: true}` (idempotent) and keeps the original
  entry's `enqueuedAt` (no TTL extension by re-tapping).
- **Depth cap 8 per server** (`operatorQueueCap` named constant); overflow returns a structured
  `409 "operator queue is full"` — the seam's valid-request-wrong-state class.
- **TTL 30 minutes** (`operatorQueueTTL` named constant): entries older than TTL are dropped
  quietly at tick time (log-only). Protects against an operator parked in `waiting` on a dialog
  for hours, where the queued intent outlives its usefulness.

### 4. API change — 202 on enqueue instead of 409 on busy

Both routes return `202 {queued: true}` when the request is valid but the operator is busy.
Validation order is unchanged and fail-fast (closed-registry posture, Constitution I): unknown
template / wrong-scope / `acceptsText` lane / `acceptsSession` lane 400s, subject/operator/chat-ref
404s, and the `requiresWaiting` zero-waiting 409 all still reject at request time — **only the
busy-state 409 becomes an enqueue**. Mechanically: `deliverOperatorPrompt`'s internal busy gate is
UNTOUCHED (it remains the fail-closed floor for every direct delivery, including the drain's
re-busy race); the two HTTP handlers branch on the typed busy-class `operatorReject` coming back
from delivery and convert it into enqueue + `202` — so a busy 409 can never escape the HTTP routes,
while the auto-name caller keeps its existing debug-log-and-drop behavior on the same sentinel.
Success stays `200 {"ok": true}` when delivered immediately. No new routes, no cancel/inspect
endpoint (Constitution IV), POST-only unchanged (Constitution IX).

### 5. Frontend — queued toast copy

Operator-request call sites distinguish delivered (`200 {ok}`) from queued (`202 {queued}`):
`sendOperatorRequest` / `sendServerOperatorRequest` (`app/frontend/src/api/client.ts`) surface the
queued outcome (e.g. return the parsed body or a discriminated result), and the call sites — the
window flyout / palette handlers in `app/frontend/src/app.tsx` (~lines 2359–2399, 3843–3864) and
`app/frontend/src/components/operator-compose-dialog.tsx` — toast a queued variant (e.g.
`"Queued for operator — will be delivered when it is idle"`) instead of their delivered copy.
No new UI surface: no queue badge, no inspect/cancel affordance (Constitution IV). No SSE payload
change.

### 6. Explicitly unchanged

- **Auto-name stays OUTSIDE the queue.** `autoNameTracker` is a recurring, derivable trigger whose
  busy-skip + decision-time cooldown-stamp semantics ("a busy operator never converts deferred
  transitions into a later burst") are deliberate and unchanged. Only user-initiated requests
  queue.
- The chat-send route's allow+probe busy policy, the injection engine, and the derive-tick result
  posture (no response channel, no SSE hub wake on delivery) are untouched.
- No settings key: queueing is always-on — it preserves an explicit user action, unlike the
  opt-in system-initiated `auto_name` trigger.

## Affected Memory

- `run-kit/operator-actuation`: (modify) the seam's no-queue posture is amended — the busy gate
  requirement gains the enqueue branch (202 contract, coalesce/cap/TTL, drain gates,
  drop-never-retry), a new requirement documents the queue tracker (sibling of the auto-name
  requirement), the frontend availability requirement gains the queued toast, and the
  "Delivery + derive only — no queue" design decision is superseded/annotated (in-memory pending
  intents, still no persisted mailbox, no response channel, no RPC).
- `run-kit/architecture`: (modify) § SSE Hub — the queue tracker joins waiting-push and auto-name
  on the per-tick assembly seam and the retain sweep.

## Impact

- **Backend**: `app/backend/api/operator.go` (both handlers' busy-reject → enqueue branch;
  possibly extracting the drain-time gate checks into shared helpers), new
  `app/backend/api/operator_queue.go` + `operator_queue_test.go` (tracker: enqueue/coalesce/cap/
  TTL/drain decision off clock + deliver seams, mirroring `auto_name_test.go`), `api/sse.go`
  (advance + retain call sites beside auto-name, ~:1491/:1648), `api/router.go` (wiring at
  `initSSEHub`, a deliver-closure builder in the `autoNameDeliver` shape). Existing
  `operator_test.go` busy-gate assertions flip from 409 to 202.
- **Frontend**: `app/frontend/src/api/client.ts` (202 body surfaced), `app/frontend/src/app.tsx`
  operator toast handlers, `app/frontend/src/components/operator-compose-dialog.tsx` (+ its
  `.test.tsx`); frontend unit tests for the queued toast path.
- **Tests**: Go unit tests off the tracker's seams; frontend unit tests for queued toasts. No new
  e2e expected — no new user-visible surface beyond toast copy (flagged as an assumption below).
- **Constraints**: Constitution II (no database — in-memory tracker precedent), IX (POST-only
  unchanged), IV (no new pages/surfaces), X (nothing new pushed by agents — the queue holds
  user-initiated intents server-side; all facts still derive at drain time).

## Open Questions

None — the design conversation resolved the open decisions; residual implementation choices are
graded in Assumptions.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Queue the request `{template, windowID, text, session, enqueuedAt}`, never the rendered prompt; re-derive facts, re-run the live path's gates, and re-render at drain; a drain-time gate failure drops the entry quietly (log-only) | Discussed — fact tables go stale in minutes; a brief-me rendered 20 minutes ago is wrong | S:90 R:70 A:85 D:90 |
| 2 | Certain | In-memory per-server tracker in the hub, mirroring `autoNameTracker`/`waitingPushTracker` (own mutex, clock + deliver seams, SSE per-tick seam, retain sweep); no persistence — restart degrades to today's reject behavior | Discussed — Constitution II precedent cited by `auto_name.go` itself; proven test pattern | S:90 R:75 A:90 D:90 |
| 3 | Certain | Drain is LEVEL-triggered (operator idle AND queue non-empty AND per-server min-gap elapsed → pop ONE entry), not edge-triggered | Discussed — edge-triggering strands entries on missed edges; one-per-observation because rolled-up state lags injection by a hook round-trip (the `autoNameMinGap` rationale) | S:90 R:70 A:85 D:85 |
| 4 | Certain | Coalesce on `(template, windowID/session, hash(text))`; depth cap per server with a structured 409 "queue full" on overflow; TTL after which entries drop quietly (log-only) | Discussed — repeated taps collapse; bounded memory; a parked-for-hours operator outlives the intent's usefulness | S:85 R:80 A:85 D:85 |
| 5 | Certain | Drain-time injection failure (ProbeFailure / SubmitUnverified) drops the entry, never retries | Discussed — nobody is watching at drain; a retry would double-paste into the composer | S:90 R:75 A:85 D:90 |
| 6 | Certain | Both routes return `202 {queued: true}` on busy-enqueue; all other validation stays fail-fast at request time (400s/404s and the requiresWaiting 409); no cancel/inspect UI | Discussed — closed-registry posture (Constitution I) + minimal surface (Constitution IV) | S:90 R:75 A:85 D:85 |
| 7 | Certain | Auto-name stays outside the queue; `deliverOperatorPrompt`'s busy gate remains the fail-closed floor for direct delivery | Discussed — the tracker's decision-time stamp semantics are deliberate; only user-initiated requests queue | S:90 R:80 A:90 D:90 |
| 8 | Confident | Exact constants: TTL 30 min (`operatorQueueTTL`), depth cap 8 (`operatorQueueCap`), drain min-gap 60s (same value + rationale as `autoNameMinGap`); all named constants | Conversation gave approximate values ("~30 minutes", "~8", "reuse the min-gap concept") — pinning them is trivially tunable later | S:65 R:90 A:75 D:70 |
| 9 | Confident | Drain order is FIFO (oldest first) within a server | Not explicitly discussed; single obvious default for user-initiated intents, trivially changeable | S:50 R:90 A:80 D:80 |
| 10 | Confident | A coalesced duplicate tap returns `202 {queued: true}` idempotently and keeps the original `enqueuedAt` (no TTL extension by re-tapping) | Follows from the coalesce decision; refreshing TTL on spam would defeat the parked-operator protection | S:55 R:90 A:75 D:70 |
| 11 | Confident | Queueing is always-on — no `internal/settings` key gating it | Implied by the decided 202 API contract (frontend call sites handle queued as the normal busy outcome); unlike `auto_name` (opt-in system-initiated trigger), the queue preserves an explicit user action | S:60 R:75 A:70 D:65 |
| 12 | Confident | A busy-gate rejection AT DRAIN (operator went busy again in the snapshot→injection race) does NOT consume the entry — it stays queued, min-gap stamped; only actual injection failures drop | Nothing was typed, so re-delivery is safe; dropping on a mere race contradicts the level-trigger's self-healing purpose ("the gate still protects against the race" — discussed) | S:50 R:80 A:75 D:60 |
| 13 | Confident | The queue tracker keeps its own per-server min-gap stamp, independent of `autoNameTracker.lastSent` | Sibling trackers keep independent state (the established pattern); cross-tracker spacing is already bounded by the operator's busy gate reading `active` after any injection | S:45 R:85 A:70 D:65 |
| 14 | Confident | Drain drops are daemon-log-only — no `rk notify` initially (the conversation left notify "optional") | Trivially addable behind the fail-silent `command -v rk` gate later; drops are routine (stale intents), not incidents | S:45 R:95 A:60 D:50 |
| 15 | Confident | Test strategy: Go unit tests off the tracker's clock/deliver seams (mirror `auto_name_test.go`/`operator_test.go`) + frontend unit tests for the queued toast; NO new e2e | The only user-visible delta is toast copy — covered by unit tests; code-quality's "UI changes SHOULD include e2e where possible" judged not to apply to copy-only changes | S:55 R:85 A:65 D:60 |

15 assumptions (7 certain, 8 confident, 0 tentative, 0 unresolved).
