# Intake: Operator Templated Chat Lane (chatDelivery)

**Change**: 260905-4xu7-operator-templated-chat-lane
**Created**: 2026-09-05

## Origin

Synthesized from a discussion session with the user (2026-09-05), dispatched promptless via the Create-Intake Procedure (`{questioning-mode} = promptless-defer`). The target shape is already written into the spec: `docs/specs/agent-messaging.md` § "Messaging the operator — three lanes" (added in that session; the spec + index edits are **uncommitted working-tree changes that ship with this change**). That section is the decided design — this intake operationalizes it.

> **Operator chat, templated — a context-carrying send lane for the operator console (chatDelivery).** The ⌘J operator console sends free text through the raw chat lane (`sendToWindow(server, operatorWindowId, text, "submit", "agent")`) with zero context — the operator never learns which tab/pane/worktree the user was looking at. The operator-request seam (fix-tab-name etc.) already solves context via server-derived facts, but its busy posture (busy ⇒ 409 → queue → 202) is wrong for live chat. Add a window-scoped chat template (`user-message`) with a new registry property `chatDelivery: true` that skips the busy gate and the queue (allow + probe), and a console context chip that rides messages onto that lane on terminal routes.

Key decisions from the discussion (all settled — see Assumptions for grading):
1. New window-scoped chat template id `user-message` in the closed `operatorTemplates` registry, `acceptsText: true`, rendering a server-derived **source envelope** followed by the user's text fenced via `delimitUserText`.
2. New registry property `chatDelivery: true`: delivery skips the busy gate and the queue — allow + probe chat semantics. Requires `acceptsText`; incompatible with `requiresAgentSessionRef`.
3. The envelope frames a **conversation, not a work item**: no `[run-kit request]` prefix, no action bounds — the operator may reply.
4. Console: on terminal routes messages ride the new template with the route window as subject, behind a visible, dismissable context chip (default on). Chip dismissed or no subject window ⇒ today's direct lane, unchanged. The palette Ask-operator fallback's `pendingSend` flows through the same lane resolution.
5. Spec + index already updated in the working tree; hydrate updates `docs/memory/run-kit/operator-actuation.md` and `docs/memory/run-kit/ui/operator-console.md`.

**Rejected alternatives** (from the discussion — do not revisit at apply):
- *Client-side context prefix composition* — inverts Constitution X (facts must be server-derived), spoofable/drifty.
- *Routing console chat through the existing busy-gate/queue semantics* — silently queues a live chat message while the user watches the pane; a UX regression. The razor (now in the spec): chat is a human steer from a user watching the pane — it must land now; a request is work handed over — a busy operator queues it.

## Why

1. **The pain point**: The operator console (⌘J, `app/frontend/src/components/operator-console.tsx`) delivers compose-strip messages through `sendToWindow(server, operatorWindowId, text, "submit", "agent")` — the user's raw text, verbatim. The operator receives "can you look at the failing test?" with no idea which of a dozen windows, worktrees, or fab changes the user was looking at when they typed it. Users must hand-type context ("in the zesty-fjord worktree, window 5…") that the server can derive perfectly (Constitution X), or the operator answers blind.

2. **The consequence if unfixed**: Every contextual console message either carries manually-typed (error-prone, drifting) context or forces the operator into a discovery round-trip (`rk mux panes`, transcript greps) before it can act. The existing context-carrying seam — the `/operator-request` template routes — cannot be reused as-is: its busy posture (`active`/`waiting` ⇒ enqueue → `202 {"queued":true}`, drained minutes later on idle) silently parks a live chat message while the user watches the pane, which is exactly wrong for conversation.

3. **Why this approach**: A third lane that composes the two shipped mechanisms — the request seam's server-derived fact rendering (Constitution X, one FetchSessions pass) with the direct chat lane's busy posture (allow + probe, no queue) — declared per-template via one new registry property (`chatDelivery`), so the closed-registry posture, the single injection engine, and the existing routes all stay intact. The spec's § "Messaging the operator — three lanes" table is the normative statement of this design.

## What Changes

### 1. Backend — the `user-message` template (`app/backend/api/operator.go`)

A new **window-scoped** entry in the closed `operatorTemplates` registry (`app/backend/api/operator.go:120`):

- id `user-message`, `acceptsText: true`, `chatDelivery: true` (new property, below). NOT `serverScoped`, NOT `requiresAgentSessionRef`, no `requiresWaiting`/`acceptsSession`.
- Its render func produces a **source envelope** followed by the user's text:
  - Envelope facts, all server-derived from the handler's one `FetchSessions` pass (Constitution X — never client-composed): subject `@N` (window id), current window name, worktree path, fab change + stage **when `FabChange` is non-empty** (the shipped `renderFixTabName` conditional-clause pattern), and the transcript JSONL path **when it resolves**.
  - The transcript line is **best-effort**: `user-message` does not declare `requiresAgentSessionRef`, so the fact-derivation path must attempt `transcript.Path` resolution opportunistically and, on an empty/unresolvable ref (`ErrInvalidRef`/`ErrTranscriptNotFound`/`ErrNoAdapter` or no reconciled agent session), **omit the transcript line — never 404**. This is the load-bearing difference from `fix-tab-name`'s fact derivation, where an unresolvable transcript is a 404-class error.
  - The user's text follows, fenced via the existing `delimitUserText` (treat-as-data framing, dynamic fence length) — unchanged mechanism.
- **Conversational framing**: the rendered prompt does NOT use the `[run-kit request]` prefix and carries **no action bounds** (no "do not reply" clause) — the envelope frames a conversation the operator may reply to, not a work item.
- Rides the existing window-scoped route `POST /api/windows/{windowId}/operator-request?server=` (`handleOperatorRequest`) with `{windowId}` = the **subject** window (the window the user was looking at), body `{"template": "user-message", "text": "<the console message>"}`. Existing validation applies unchanged: `parseWindowID` 400, unknown id 400, cross-scope 400, the `acceptsText` lane rules (empty/whitespace 400, 4096-byte cap), absent subject 404, no operator on server 404. Mutation ⇒ POST (Constitution IX) — no new route, no new verb.

### 2. Backend — the `chatDelivery` registry property

A new declarative property on `operatorTemplate` (beside `acceptsText`/`requiresWaiting`/`acceptsSession`):

- `chatDelivery: true` ⇒ delivery **skips the busy gate and skips the queue**: an `active`/`waiting` operator still receives the delivery attempt (allow + probe — the novelty echo probe remains the fail-closed guard, exactly the compose-send posture). The handler never converts to a `202 {"queued":true}` enqueue for this template; `operatorQueueTracker` is never touched. Success is `200 {"ok":true}`; probe failure / `StagedSendFailure` / `SubmitUnverified` surface as the existing three structured 409s.
- Delivery still goes through the existing prompt-level core (`deliverOperatorPrompt`) with the busy gate conditionally skipped — or an equivalent seam preserving the **single-injection-engine invariant**: no new typing path, same `sessions.ResolveAgentPane` + in-process `s.injectIntoPane` under the one `agentSendTotalBudget` deadline, no SSE hub wake. Callers that must keep the busy gate (the request templates, auto-name, the queue drain) are unaffected.
- **Composition rules**: `chatDelivery` requires `acceptsText` (a chat template without user text is meaningless) and is **incompatible with `requiresAgentSessionRef`** (the transcript line is best-effort — a subject without an agent session degrades to an envelope without the transcript line, never a 404). Enforce as a registry invariant verified by a test over `operatorTemplates` (the `promptVocab` set-equality test pattern in `api/operator_test.go`), so a future entry cannot combine them silently.
- Closed-registry posture is otherwise **unchanged** for existing templates: unknown id 400, cross-scope 400, `acceptsText` lane rules, busy ⇒ queue for every non-`chatDelivery` template.

### 3. Frontend — console lane resolution + context chip (`app/frontend/src/components/operator-console.tsx`, `lib/operator-console.ts`)

- **Subject resolution**: the console's existing deepest-first route-param walk (`operator-console.tsx:55-66`, currently reading only `server`) gains the `window` param, so on terminal routes (`/$server/$window`) the console knows the route window. Board/host/server routes yield no subject.
- **Lane resolution**: on send, when a subject window resolves AND the context chip has not been dismissed ⇒ the message rides the templated lane — a window-scoped operator-request client call posting `{template: "user-message", text}` to `/api/windows/{subjectWindowId}/operator-request` (extending the `api/client.ts` operator-request helper shape — `withServer` + `throwOnError`; note the subject is the **route window**, while the direct lane targets the **operator window** — two different window ids). Chip dismissed, or no subject window ⇒ today's direct `sendToWindow(server, operatorWindowId, text, "submit", "agent")` lane, byte-identical behavior.
- **Context chip**: the compose strip shows the attached context as a visible, dismissable chip — `from: @5 "name" ✕` — **default on** whenever a subject resolves. Dismissing it (✕) drops the envelope for subsequent sends (direct lane). The IDE-chat pattern (Cursor/Copilot attach the active file the same way): implicit context the user cannot see erodes trust in what the operator was told.
- **Ask-operator fallback**: the palette's Ask-operator fallback row's `pendingSend` (delivered via the `rk:operator-console` event seam) flows through the **same lane resolution** — a pendingSend fired from a terminal route rides the template with that route's window as subject.
- **Error surface**: unchanged — structured failures render as the console's existing inline error line (`role="alert"`), text preserved in the input. A `chatDelivery` send can never resolve `202 queued`, so no queued-toast handling is needed on this path.

### 4. Docs — spec ships, memory hydrates

- `docs/specs/agent-messaging.md` + `docs/specs/index.md`: **already edited in the working tree (uncommitted)** — these edits are part of this change and ship on its branch/PR. No further spec edits expected.
- Hydrate updates `docs/memory/run-kit/operator-actuation.md` — the three-lane taxonomy (direct chat / templated chat / request), the `user-message` template requirement, the `chatDelivery` property and its composition rules, and the busy-posture razor — and `docs/memory/run-kit/ui/operator-console.md` — the lane resolution, the context chip, the `window` route-param read, and the pendingSend flow.

### 5. Tests

- **Go** (`app/backend/api/operator_test.go`): registry invariant (`chatDelivery` ⇒ `acceptsText` ∧ ¬`requiresAgentSessionRef`, over all entries); busy (`active`/`waiting`) operator + `user-message` ⇒ delivery attempted, `200` on engine success, never `202`/enqueue; envelope rendering with and without fab change and with a resolvable vs unresolvable transcript (line omitted, no 404); the conversational framing (no `[run-kit request]` prefix, no bounds clause); existing `acceptsText` lane rules apply to `user-message`.
- **Frontend**: colocated unit tests for the lane-resolution helper and chip state (`operator-console.test.tsx` / `lib/operator-console.test.ts`); Playwright e2e for the console chip per `fab/project/code-quality.md` (chip visible on a terminal route, dismiss ⇒ direct lane, absent on board/host routes), each new `test()` carrying the Test Intent Comments JSDoc block (constitution § Test Intent Comments).

## Affected Memory

- `run-kit/operator-actuation`: (modify) add the templated-chat lane — the `user-message` template requirement, the `chatDelivery` registry property + composition rules, the three-lane taxonomy and busy-posture razor, best-effort transcript degradation
- `run-kit/ui/operator-console`: (modify) lane resolution (template vs direct), the context chip, the `window` route-param subject read, pendingSend through the same resolution

## Impact

- `app/backend/api/operator.go` — registry entry, `chatDelivery` property, render func, conditional busy-gate/queue skip in the delivery seam; `app/backend/api/operator_test.go` — invariant + behavior tests
- `app/frontend/src/components/operator-console.tsx` + `app/frontend/src/lib/operator-console.ts` (+ colocated tests) — subject resolution, chip, lane fork
- `app/frontend/src/api/client.ts` — window-scoped operator-request call carrying text (extend `sendOperatorRequest` or a sibling helper)
- `app/frontend/tests/e2e/` — console chip e2e (new or extended operator-console spec)
- `docs/specs/agent-messaging.md`, `docs/specs/index.md` — already edited, uncommitted; ship with this change
- `docs/memory/run-kit/operator-actuation.md`, `docs/memory/run-kit/ui/operator-console.md` — hydrate
- No new routes, no SSE payload change, no settings key, no queue-tracker change

## Open Questions

*(none — promptless dispatch; every sub-decision is graded in Assumptions)*

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Template id `user-message`, window-scoped, `acceptsText: true`; envelope = subject `@N` + window name + worktree + fab change/stage when present + best-effort transcript path; user text via `delimitUserText` | Discussed — decided with the user and written into `docs/specs/agent-messaging.md` § three lanes verbatim | S:95 R:70 A:95 D:95 |
| 2 | Certain | `chatDelivery: true` skips the busy gate AND the queue (allow + probe; never 202); requires `acceptsText`; incompatible with `requiresAgentSessionRef` | Discussed — the lane's defining property, in the spec's lane table and composition note | S:95 R:75 A:90 D:95 |
| 3 | Certain | Envelope frames a conversation: no `[run-kit request]` prefix, no action bounds — the operator may reply | Discussed — explicit decision 3; spec states it verbatim | S:90 R:85 A:90 D:90 |
| 4 | Certain | Console: terminal routes ride the template with the route window as subject; visible dismissable chip (`from: @5 "name" ✕`), default on; dismissed or no-subject routes ⇒ direct lane unchanged; Ask-operator `pendingSend` through the same resolution | Discussed — decision 4; spec § console behavior states all four clauses | S:90 R:75 A:90 D:90 |
| 5 | Certain | Facts derived server-side from the handler's one FetchSessions pass; transcript best-effort — unresolvable ⇒ envelope without the line, never 404 | Discussed — Constitution X + the spec's degradation clause; rejected alternative (client composition) recorded | S:90 R:80 A:95 D:90 |
| 6 | Certain | Single-injection-engine invariant: delivery through the existing prompt-level core with the gate conditionally skipped (or an equivalent seam) — no new typing path | Constraint stated by the user; constitution-adjacent (spec's single-engine invariant) | S:90 R:70 A:90 D:85 |
| 7 | Certain | Spec + index working-tree edits (`docs/specs/agent-messaging.md`, `docs/specs/index.md`) ship with this change; hydrate updates operator-actuation + ui/operator-console memory | Discussed — decision 5, explicit | S:90 R:90 A:95 D:95 |
| 8 | Certain | Registry invariant (`chatDelivery` ⇒ `acceptsText` ∧ ¬`requiresAgentSessionRef`) enforced by a test over `operatorTemplates`; Playwright e2e for the chip with Test Intent Comments | Constitution (Test Integrity, Test Intent Comments) + code-quality.md e2e rule + the shipped `promptVocab` invariant-test precedent | S:75 R:90 A:90 D:85 |
| 9 | Confident | The gate skip is a `chatDelivery`-aware branch/parameter inside `deliverOperatorPrompt` rather than a parallel delivery core | User left "or an equivalent seam" open; the shared-core no-drift rationale in operator-actuation memory makes the in-core branch the front-runner — apply decides and records | S:70 R:80 A:80 D:70 |
| 10 | Confident | Client call: extend the window-scoped operator-request helper in `api/client.ts` to carry `text` (same `withServer` + `throwOnError` + `OperatorRequestResult` shape) rather than a new endpoint-specific helper | Existing helper posts `{template}` without text; server-scoped sibling already carries text — small signature extension matches the established shape; apply may pick a named sibling if cleaner | S:60 R:85 A:80 D:65 |
| 11 | Confident | Chip dismissal is ephemeral per-viewer component state: resets to on when the console reopens or the route's subject window changes; no localStorage, no tmux write | Not explicitly discussed; "default on" + the console's Constitution-IV ephemeral-state precedent (open/closed, pinned server all ephemeral) make reset-on-reopen the obvious default; trivially reversible | S:50 R:85 A:75 D:55 |
| 12 | Certain | `chatDelivery` failures surface as the existing structured 409s rendered inline in the console (text preserved); no queued toast on this path | Follows deterministically from decisions 2 + the console's shipped inline-error requirement | S:80 R:85 A:90 D:85 |

12 assumptions (9 certain, 3 confident, 0 tentative, 0 unresolved).
