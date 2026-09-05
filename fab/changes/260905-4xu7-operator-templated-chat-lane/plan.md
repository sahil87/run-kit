# Plan: Operator Templated Chat Lane (chatDelivery)

**Change**: 260905-4xu7-operator-templated-chat-lane
**Intake**: `intake.md`

## Requirements

> Normative design source: `docs/specs/agent-messaging.md` § "Messaging the operator — three lanes"
> (working-tree edit shipping with this change). Shipped-state background:
> `docs/memory/run-kit/operator-actuation.md`, `docs/memory/run-kit/ui/operator-console.md`.

### Backend: the `chatDelivery` registry property

#### R1: `chatDelivery` skips the busy gate and the queue
The `operatorTemplate` registry entry struct SHALL gain a declarative `chatDelivery bool`
property (beside `acceptsText`/`requiresWaiting`/`acceptsSession`). For a template declaring
it, delivery through the shared prompt-level core (`deliverOperatorPrompt` in
`app/backend/api/operator.go`) SHALL skip the `active`/`waiting` busy rejection — an
`active`/`waiting` operator still receives the delivery attempt (allow + probe; the novelty
echo probe remains the fail-closed guard, exactly the compose-send posture) — and the HTTP
handler SHALL never convert such a delivery into an `operatorQueueTracker` enqueue (no
`202 {"queued":true}` is reachable for a `chatDelivery` template). Success is
`200 {"ok":true}`; `inject.ProbeFailure` / `inject.StagedSendFailure` /
`inject.SubmitUnverified` surface as the existing three structured 409s. The skip MUST be a
`chatDelivery`-aware branch inside the shared core (a parameter/field threaded to
`deliverOperatorPrompt`), preserving the single-injection-engine invariant: same
`sessions.ResolveAgentPane`, same in-process `s.injectIntoPane` under the one
`agentSendTotalBudget` deadline, no SSE hub wake, no new typing path. All existing callers
(request templates, auto-name tracker, queue drain) keep the busy gate unchanged.

- **GIVEN** an operator whose rolled-up `AgentState` is `active` (or `waiting`)
- **WHEN** a valid `chatDelivery` template request arrives on the window-scoped route
- **THEN** injection is attempted (no busy 409, no enqueue), and the response is
  `200 {"ok":true}` on engine success
- **AND GIVEN** a non-`chatDelivery` template and the same busy operator, **THEN** the
  existing busy ⇒ enqueue ⇒ `202` behavior is byte-identical

#### R2: `chatDelivery` composition invariant
`chatDelivery` SHALL require `acceptsText` and SHALL be incompatible with
`requiresAgentSessionRef`. The invariant is enforced by a registry-walking test in
`app/backend/api/operator_test.go` (the `promptVocab` set-equality precedent): every
`operatorTemplates` entry with `chatDelivery` must declare `acceptsText: true` and must not
declare `requiresAgentSessionRef`, so a future entry cannot combine them silently.

- **GIVEN** the `operatorTemplates` registry
- **WHEN** the invariant test walks its entries
- **THEN** it fails compilation-of-intent for any entry violating
  `chatDelivery ⇒ acceptsText ∧ ¬requiresAgentSessionRef`

### Backend: the `user-message` template

#### R3: `user-message` renders a source envelope + delimited user text
The registry SHALL gain a window-scoped entry `user-message` (`acceptsText: true`,
`chatDelivery: true`; NOT `serverScoped`, NOT `requiresAgentSessionRef`, no
`requiresWaiting`/`acceptsSession`). Its render func SHALL produce, in order: a compact
source envelope of server-derived facts — subject window `@N`, current window name, worktree
path, fab change + stage only when `FabChange` is non-empty (the `renderFixTabName`
conditional-clause pattern), and the transcript JSONL path only when it resolves (R4) —
followed by the user's text fenced via the existing `delimitUserText` (treat-as-data framing,
dynamic fence). The prompt SHALL frame a **conversation, not a work item**: no
`[run-kit request]` prefix, no "do not reply" / action-bounds clause — the operator may
reply. It rides the existing window-scoped route
`POST /api/windows/{windowId}/operator-request?server=` with `{windowId}` = the subject
window (the window the user was looking at, NOT the operator window); all existing
validation applies unchanged (unknown id 400, cross-scope 400, `acceptsText` lane rules —
empty/whitespace 400, 4096-byte cap — absent subject 404, no operator 404).

- **GIVEN** a subject window with a worktree, a non-empty fab change, and a resolvable
  transcript
- **WHEN** `user-message` renders with text "can you check the failing test?"
- **THEN** the prompt carries the `@N` id, window name, worktree path, fab change + stage,
  the transcript path, and the fenced user text — and contains neither `[run-kit request]`
  nor any do-not-reply bound
- **AND GIVEN** an empty `FabChange`, **THEN** no fab clause appears

#### R4: Best-effort transcript in the envelope — degrade, never 404
For a window-scoped template that does NOT declare `requiresAgentSessionRef`, the subject
fact derivation (`deliverOperatorRequest`) SHALL attempt transcript resolution
opportunistically: when the subject's `AgentSessionRef` is non-empty AND `transcript.Path`
resolves, fill `operatorFacts.TranscriptPath`; on an empty ref or any resolution error
(`ErrInvalidRef`/`ErrTranscriptNotFound`/`ErrNoAdapter`), leave it empty and proceed — the
render func omits the transcript line. This path SHALL never surface a transcript-related
404 (the load-bearing difference from `requiresAgentSessionRef` templates, whose behavior is
unchanged).

- **GIVEN** a subject window with no reconciled agent session (or an unresolvable ref)
- **WHEN** a `user-message` request is delivered
- **THEN** delivery proceeds with an envelope lacking the transcript line, and the response
  is `200 {"ok":true}` on engine success

### Frontend: console lane resolution + context chip

#### R5: Route-window subject resolution and the lane fork
The operator console (`app/frontend/src/components/operator-console.tsx`) SHALL extend its
deepest-first route-param walk to also read the `window` param, so terminal routes
(`/$server/$window`) yield a subject window id and board/host/server routes yield none. On
send: when a subject resolves AND the context chip (R6) is attached, the message SHALL ride
the templated lane — the window-scoped operator-request client call posting
`{template: "user-message", text}` at the SUBJECT window id; otherwise (chip dismissed, or
no subject) it SHALL ride today's direct lane
(`sendToWindow(server, operatorWindowId, text, "submit", "agent")`) byte-identically. The
palette Ask-operator fallback's `pendingSend` SHALL flow through the same lane resolution.
Structured failures on either lane render as the console's existing inline error line
(`role="alert"`), composed text preserved; the templated lane never resolves `202 queued`
(R1), so no queued-outcome handling is added.

- **GIVEN** the console opened on `/$server/$window` with the chip attached
- **WHEN** Enter sends the composed text
- **THEN** exactly one POST to `/api/windows/{routeWindowId}/operator-request` fires with
  `{template: "user-message", text}` and no `sendToWindow` call is made
- **AND GIVEN** a board/host route (no subject), **THEN** the send is exactly today's
  `sendToWindow(..., "submit", "agent")` call

#### R6: The context chip — visible, dismissable, default on, ephemeral
When a subject window resolves, the compose strip SHALL show a context chip naming the
attached source (subject `@N` and window name, e.g. `from: @5 "zesty-fjord"`) with a
dismiss affordance (✕). The chip defaults to attached; dismissing it drops the envelope for
subsequent sends (direct lane) until it resets. Chip state is ephemeral per-viewer component
state (Constitution IV — no URL/tmux/localStorage write) and resets to attached when the
console re-opens or the resolved subject window changes. On routes with no subject, no chip
renders.

- **GIVEN** the chip dismissed on a terminal route
- **WHEN** the console is closed and re-opened (or the route's window changes)
- **THEN** the chip is attached again
- **AND GIVEN** a board route, **THEN** no chip renders and sends are direct

#### R7: Client helper carries text on the window-scoped route
`sendOperatorRequest` (`app/frontend/src/api/client.ts`) SHALL be extended to carry the
user's text on the window-scoped route — an optional trailing `text` parameter included in
the body only when non-empty (mirroring `sendServerOperatorRequest`'s `session` handling),
keeping the `withServer` + `throwOnError` + `OperatorRequestResult` shape. Existing callers
(fix-tab-name, annotate-tab) pass no text and their request bodies are byte-identical.

- **GIVEN** `sendOperatorRequest(server, "@5", "user-message", "hello")`
- **WHEN** the request fires
- **THEN** the body is `{"template":"user-message","text":"hello"}`
- **AND GIVEN** the existing 3-argument call, **THEN** the body is `{"template":"..."}`
  exactly as today

### Non-Goals

- No new HTTP route or verb (rides the existing window-scoped operator-request POST)
- No queued-outcome UI on the console path (unreachable by construction)
- No server-scoped chat template (board/host routes keep the direct lane)
- No change to auto-name, the queue tracker, or any existing template's behavior
- No persistence of chip state (Constitution IV)

### Design Decisions

#### Busy-gate skip lives inside the shared delivery core
**Decision**: thread the template's `chatDelivery` flag into `deliverOperatorPrompt` and
branch the busy gate there, rather than adding a parallel chat-delivery core.
**Why**: `deliverOperatorPrompt` exists precisely so delivery mechanics cannot drift across
callers (operator-actuation memory § shared core); a parallel core would duplicate pane
resolution + deadline + injection wiring for one conditional.
**Rejected**: a second `deliverOperatorChat` core (drift risk, duplicated mechanics);
routing console chat through `handleSendToWindow` with server-side envelope enrichment
(muddies the generic send lane with operator-specific fact rendering).
*Introduced by*: 260905-4xu7-operator-templated-chat-lane

#### Envelope facts reuse `operatorFacts` with opportunistic transcript fill
**Decision**: `user-message` renders from the existing `operatorFacts` struct; the
best-effort transcript fill happens in `deliverOperatorRequest` for
non-`requiresAgentSessionRef` templates.
**Why**: one fact struct per scope is the registry's established shape (scope-discriminator
decision in operator-actuation memory); the only delta needed is when resolution failure is
fatal vs. degrading.
**Rejected**: a chat-specific fact struct (duplicates derivation for identical fields).
*Introduced by*: 260905-4xu7-operator-templated-chat-lane

## Tasks

### Phase 1: Setup

*(none — no scaffolding or dependency work)*

### Phase 2: Core Implementation

- [x] T001 Add `chatDelivery bool` to `operatorTemplate`, the `user-message` registry entry, and `renderUserMessage` (envelope + `delimitUserText`, conversational framing, conditional fab/transcript lines) in `app/backend/api/operator.go` <!-- R3 -->
- [x] T002 Thread `chatDelivery` through delivery: skip the busy gate in `deliverOperatorPrompt` for chat templates and bypass the handler's busy⇒enqueue branch (never 202); best-effort transcript fill in `deliverOperatorRequest` for non-`requiresAgentSessionRef` templates in `app/backend/api/operator.go` <!-- R1 -->
- [x] T003 Go tests in `app/backend/api/operator_test.go`: registry composition invariant (`chatDelivery ⇒ acceptsText ∧ ¬requiresAgentSessionRef` over all entries); busy (`active`/`waiting`) operator + `user-message` ⇒ delivery attempted, `200`, never `202`/enqueue; render variants (with/without fab change, resolvable vs unresolvable transcript — line omitted, no 404); no `[run-kit request]` prefix and no bounds clause; `acceptsText` lane rules apply to `user-message` <!-- R2 -->
- [x] T004 [P] Extend `sendOperatorRequest` in `app/frontend/src/api/client.ts` with an optional `text` parameter (body carries `text` only when non-empty; existing callers byte-identical) + unit coverage in `app/frontend/src/api/client.test.ts` <!-- R7 --> <!-- rework: drop the change-ID citation from the rewritten doc comment at client.ts:444 -->

### Phase 3: Integration & Edge Cases

- [x] T005 Console lane fork in `app/frontend/src/components/operator-console.tsx`: read the `window` route param in the existing deepest-first walk; route sends (including `pendingSend`) through `sendOperatorRequest(server, subjectWindowId, "user-message", text)` when subject + chip attached, else the existing `sendToWindow` path; inline-error behavior preserved on both lanes <!-- R5 --> <!-- rework: pendingSend stale-closure — delivery must read post-reset chip state -->
- [x] T006 Context chip in the compose strip: `from: @N "name"` + ✕ dismiss, default attached, ephemeral state resetting on console reopen / subject change, hidden with no subject; any pure helper logic in `app/frontend/src/lib/operator-console.ts` <!-- R6 --> <!-- rework: replace the duplicate findWindowById with the existing resolveFocusedWindow helper (or one shared find-by-id) --> <!-- rework: provenance citation survives in re-authored focused-pane-window.ts:7 -->
- [x] T007 Frontend unit tests: lane fork + chip semantics in `app/frontend/src/components/operator-console.test.tsx` (templated send targets the route window, dismissed chip ⇒ direct send, board/host ⇒ direct send, pendingSend rides the fork, chip reset on reopen), plus `lib/operator-console.test.ts` for any new pure helpers <!-- R5 -->
- [x] T008 Playwright e2e in `app/frontend/tests/e2e/operator-console.spec.ts`: chip visible on a terminal route and send hits the templated route; dismissed chip ⇒ direct send lane; chip absent on a board/host route. Each new `test()` carries the Proves/Steps JSDoc intent block (constitution § Test Intent Comments). Cautions: mutating-route mocks need a trailing `*` (withServer appends `?server=`); run via `just test-e2e "operator-console"` / `just pw`, never bare Playwright <!-- R5 -->

## Execution Order

- T001 blocks T002 (property before threading), T002 blocks T003 (tests exercise both)
- T004 is independent ([P] with T001–T003); T004 blocks T005
- T005 blocks T006 (chip gates the fork) — implement together; T005–T006 block T007–T008

## Acceptance

### Functional Completeness

- [x] A-001 R1: A `chatDelivery` template delivers to an `active`/`waiting` operator (200 on engine success) and can never produce a `202`/enqueue; non-`chatDelivery` templates keep busy⇒queue byte-identically
- [x] A-002 R2: The registry invariant test exists and fails on any entry violating `chatDelivery ⇒ acceptsText ∧ ¬requiresAgentSessionRef`
- [x] A-003 R3: `user-message` is window-scoped `acceptsText`+`chatDelivery`; its rendered prompt carries the envelope (@N, name, worktree, conditional fab clause, conditional transcript line) then the `delimitUserText`-fenced user text
- [x] A-004 R4: An unresolvable/absent transcript on `user-message` degrades to an envelope without the line — no 404, delivery proceeds
- [x] A-005 R5: Console sends ride the templated lane exactly when a route window resolves AND the chip is attached; all other sends are today's `sendToWindow` call unchanged; `pendingSend` flows through the same fork
- [x] A-006 R6: The chip renders only with a subject, defaults attached, dismisses per-send-session, and resets on reopen/subject change with no persisted state
- [x] A-007 R7: `sendOperatorRequest` carries `text` only when non-empty; existing 3-arg callers produce byte-identical bodies

### Behavioral Correctness

- [x] A-008 R3: The rendered `user-message` prompt contains neither the `[run-kit request]` prefix nor any do-not-reply/action-bounds clause
- [x] A-009 R1: The busy-gate skip lives inside the shared delivery core (no parallel delivery path; single-injection-engine invariant intact — same pane resolution, deadline, and injectIntoPane seam)

### Scenario Coverage

- [x] A-010 R5: e2e proves chip-on-terminal-route → templated POST, dismissed → direct lane, absent on board/host — each test() with a Proves/Steps intent block
- [x] A-011 R1: Go test proves an `active` operator receives a `user-message` delivery attempt (allow + probe) while a request template still enqueues

### Edge Cases & Error Handling

- [x] A-012 R3: `acceptsText` lane rules hold for `user-message` (empty/whitespace text 400, 4096-byte cap 400, absent subject 404, no operator 404)
- [x] A-013 R5: Structured 409s on the templated lane render inline in the console with the composed text preserved (existing behavior, both lanes)

### Code Quality

- [x] A-014 Pattern consistency: new registry entry/property follows the declarative-flag shape; render func is plain string composition (no text/template); frontend follows existing console/component idioms
- [x] A-015 No unnecessary duplication: no parallel delivery core; `delimitUserText`, `operatorFacts`, `parseOperatorRequestResult` reused; no new tmux/inject paths
- [x] A-016 No comment narration: comments state constraints only — no change-ID/PR citations in code or tests (git history owns provenance)
- [x] A-017 Tests included for added behavior (Go handler/render/invariant, frontend unit, e2e per code-quality.md UI rule)

## Notes

- Spec + index edits (`docs/specs/agent-messaging.md`, `docs/specs/index.md`) are already in
  the working tree and ship with this change — do not re-edit, do not revert.
- Run scoped tests: `cd app/backend && go test ./api/`, `just test-frontend`, and
  `just test-e2e "operator-console"` — never the full `just test` suite as a gate.

## Deletion Candidates

- None — this change adds a new lane (template + registry property + console fork) without making existing code redundant; the direct chat lane remains in active use on the chip-dismissed and no-subject paths.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Busy-gate skip threaded as a parameter/field into `deliverOperatorPrompt` (shared-core branch), handler enqueue branch bypassed via the same flag | Intake assumption 9 front-runner; shared-core no-drift rationale in operator-actuation memory | S:70 R:80 A:80 D:70 |
| 2 | Confident | Best-effort transcript fill implemented in `deliverOperatorRequest` for ALL non-`requiresAgentSessionRef` window templates (currently only `user-message` hits it) | Smallest seam honoring intake's "opportunistic" wording; no behavior change for shipped templates (both declare the flag) | S:65 R:85 A:80 D:70 |
| 3 | Confident | Chip copy `from: @N "name"` with ✕; exact styling follows the console's existing text-chip idiom (text-xs, border tokens) | Spec names the chip shape loosely; visual detail is apply-level and trivially reversible | S:55 R:90 A:80 D:65 |
| 4 | Confident | `sendOperatorRequest` gains an optional 4th `text` param (no new sibling helper) | Intake assumption 10; mirrors `sendServerOperatorRequest`'s optional `session` shape | S:60 R:85 A:80 D:65 |

4 assumptions (0 certain, 4 confident, 0 tentative).
