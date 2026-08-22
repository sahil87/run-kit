# Plan: Operator Request Seam + Fix Tab Name

**Change**: 260822-fih1-operator-request-fix-tab-name
**Intake**: `intake.md`

## Requirements

### Backend: operator-request endpoint (`app/backend/api/operator.go`)

#### R1: Endpoint contract + validation
The backend SHALL expose `POST /api/windows/{windowId}/operator-request?server={server}`
(mutation ⇒ POST, Constitution IX), registered in `api/router.go` beside the chat routes.
`{windowId}` is the **subject** window (the window the request is about). The JSON body is
`{"template": "<id>"}` and carries NOTHING else — no client-supplied text can ever reach
the rendered prompt. The handler MUST validate `{windowId}` via `parseWindowID` (400 on
malformed), reject an undecodable body (400), and check the template id against a closed
in-code registry (unknown id ⇒ 400 naming the id — the `/options` key-allowlist posture,
Constitution I).

- **GIVEN** a request with a malformed `{windowId}`, an undecodable body, OR a template id
  not in the registry
- **WHEN** the handler runs
- **THEN** it returns `400` with a `writeError` JSON body and performs no session fetch and
  no tmux call.

#### R2: Server-side resolution — subject + operator in one FetchSessions pass
The handler SHALL resolve everything server-side from ONE `s.sessions.FetchSessions(ctx,
server)` call: the subject window by `WindowID` and the operator window as the window with
`Role == "operator"` (the server-scoped radio). A `FetchSessions` error maps to `500`; an
absent subject window maps to `404`; no operator window on the server maps to `404` with
the message `"no operator on this server"`. The handler MUST NOT call `resolveWindowChat`
(which would issue a second `FetchSessions`) — pane resolution reuses
`sessions.ResolveChatPane(w.Panes)` on the already-fetched windows.

- **GIVEN** a server whose sessions contain no window with `Role == "operator"`
- **WHEN** the handler resolves
- **THEN** it returns `404` `"no operator on this server"` and performs no injection.
- **AND GIVEN** `FetchSessions` fails, **THEN** the response is `500` (infrastructure
  fault, mirroring the chat endpoints).

#### R3: Fact pre-derivation
The handler SHALL pre-derive the template facts server-side (Constitution X — all are
derivable): the subject's `windowId` (`@N`), current `Name`, transcript JSONL absolute
path (from the subject's reconciled `ChatProvider`/`ChatSessionRef` via the R7 seam),
`WorktreePath`, and `FabChange`/`FabStage` (included in the rendered prompt only when
non-empty). A subject window with no reconciled chat session (`ChatSessionRef == ""`) ⇒
`404`-class error (the fix-tab-name template declares the chat ref as a required fact); a
transcript-path resolution failure (`ErrInvalidRef`/`ErrTranscriptNotFound`) ⇒ `404`-class
via the same error-mapping vocabulary as the chat read endpoints.

- **GIVEN** a subject window whose reconciled chat ref is empty or whose transcript cannot
  be located
- **WHEN** facts are derived
- **THEN** the response is a 404-class `writeError` and no injection occurs.
- **AND GIVEN** a subject with a resolvable ref, **THEN** the rendered prompt contains the
  windowId, name, absolute JSONL path, and worktree path.

#### R4: Busy gate on the operator's agent state
The handler SHALL read the operator window's rolled-up `AgentState` (already on the
FetchSessions result) BEFORE delivering. `active` or `waiting` ⇒ `409` with a structured
message naming the state (e.g. `"operator is busy (active) — request not delivered; try
again when it is idle"`). `idle` or empty/unknown ⇒ proceed (the novelty echo probe
remains the final fail-closed guard). There SHALL be NO queue, NO retry, and NO state
written anywhere (Constitution II).

- **GIVEN** an operator window whose rollup state is `active` (or `waiting`)
- **WHEN** a request arrives
- **THEN** the response is `409` naming the state and no tmux injection subprocess runs.
- **AND GIVEN** state `idle` or empty, **THEN** delivery proceeds.

#### R5: Delivery via the existing injection machinery
The handler SHALL deliver the rendered prompt in-process through the existing shared
engine — `s.injectChatMessage(ctx, server, operatorPaneID, prompt, true)` — where
`operatorPaneID` is resolved by `sessions.ResolveChatPane` over the OPERATOR window's
panes (active-pane-first rule; injection targets the pane, never the window). An operator
window with no reconciled chat pane ⇒ `404`-class error. The engine's existing semantics
apply unchanged: handler-boundary sanitize, per-(server,paneID) whole-sequence lock,
shared injection deadline, novelty echo probe; a probe failure surfaces as the same
structured `409` chat-send returns (`inject.ProbeFailure` mapping). Success is
`200 {"ok":true}`. The handler MUST NOT wake the SSE hub (rk mutated no tmux state — the
operator's later `rename-window` surfaces via the normal derive tick).

- **GIVEN** an idle operator with a resolved chat pane `%7`
- **WHEN** delivery runs
- **THEN** every injection subprocess targets `%7` (never the subject's pane, never a
  window id), the sequence is baseline → set-buffer → paste → probe → Enter, and the
  response is `200 {"ok":true}`.
- **AND GIVEN** the probe fails, **THEN** no Enter is sent and the response is the
  structured `409`.

#### R6: The `fix-tab-name` template
The template registry SHALL be an in-code map `templateID → operatorTemplate` where each
entry declares its required facts and a pure render func (plain Go string composition —
no `text/template` dependency needed for v1). v1 ships exactly one entry, `fix-tab-name`,
rendering (with the fab-context line included only when `FabChange` is non-empty):

```
[run-kit request] Fix the tab name for tmux window {windowId} (currently "{name}") on this server.

Read the recent conversation in the transcript to see what this tab is actually working on: {jsonlPath}
(read the tail of the file — the last ~30 JSONL lines are enough)

Context: worktree {worktreePath}{; fab change {change} at stage {stage}}.

Then rename the window to a short, accurate name (2-4 words, kebab-case preferred):
  tmux rename-window -t {windowId} "<new-name>"

Do not reply to this message or take any other action.
```

- **GIVEN** the derived facts for window `@5` named `zsh` with a resolvable transcript
- **WHEN** the template renders
- **THEN** the prompt names `@5`, the current name, the absolute JSONL path, the worktree,
  the exact `tmux rename-window -t @5` actuation command, and the do-not-reply bound; with
  an empty `FabChange` no fab clause appears.

### internal/chat: transcript-path seam

#### R7: Exported transcript-path capability with the UUID guard intact
`internal/chat` SHALL expose the transcript path per-provider through the registry: a
`TranscriptLocator` optional interface (`TranscriptPath(ref string) (string, error)`)
implemented by the claude adapter (delegating to the existing `locateTranscript`), plus a
package-level convenience `TranscriptPath(provider, ref string) (string, error)` that
does `Lookup` + type-assert (returning `ErrNoAdapter` for an unregistered provider or one
without the capability). The strict UUID guard (`uuidRe` → `ErrInvalidRef` before ANY
filesystem access) MUST remain in front of every path resolution reachable through the
export (Constitution I — path-traversal guard).

- **GIVEN** a ref containing `../`, an absolute path, or glob metacharacters
- **WHEN** `chat.TranscriptPath("claude", ref)` is called
- **THEN** it returns `ErrInvalidRef` with no glob/stat/open performed.
- **AND GIVEN** a valid-UUID ref with an existing transcript, **THEN** it returns the
  absolute path; a valid UUID with no file returns `ErrTranscriptNotFound`.

### Frontend: client + two entry points

#### R8: API client function
`app/frontend/src/api/client.ts` SHALL export
`sendOperatorRequest(server: string | null, windowId: string, template: string): Promise<void>`
POSTing `{template}` to `/api/windows/{windowId}/operator-request` via the established
`withServer` + `throwOnError` shape, so the server's structured 409/404 messages surface
as the thrown Error's message (the `sendChatMessage` pattern).

- **GIVEN** a 409 busy response
- **WHEN** the client call rejects
- **THEN** the Error message is the server's structured message text.

#### R9: "Fix tab name" flyout action row
The window flyout card (`components/sidebar/row-flyout-card.tsx`) SHALL carry a new
"Fix tab name" row in its sectioned action list, following the `ForkActionRow` pattern
(own in-flight guard so a double-click cannot double-send, `stopPropagation`, muted
sub-hint). Availability is derived, degrade-to-absent (never disabled): the row renders
only when (a) the server has an operator window, (b) the subject window has a non-empty
`chatSessionRef`, and (c) the subject is not itself the operator window. On success it
toasts `"Sent to operator — tab will rename shortly"`; on failure it toasts the thrown
Error's message. No spinner beyond the in-flight guard — the rename arrives via the
normal SSE derive tick.

- **GIVEN** a window row on a server with an idle operator and a chat-carrying subject
- **WHEN** the flyout opens and "Fix tab name" is clicked
- **THEN** exactly one `sendOperatorRequest` fires (re-clicks during flight are no-ops)
  and a success toast appears.
- **AND GIVEN** no operator on the server, OR a subject without `chatSessionRef`, OR the
  operator's own row, **THEN** the row is absent (not disabled).

#### R10: Palette entry
`app.tsx`'s `windowActions` group SHALL carry `Tab: Fix name (ask operator)` (id
`window-fix-name-operator`), acting on the current window, gated by the same availability
rule as R9 (omitted when unavailable — the family's omit-not-disable convention), firing
the same `sendOperatorRequest` + toast path. No keyboard chord is bound (palette-only,
like the tty export entries).

- **GIVEN** the terminal route with a current window meeting R9's availability rule
- **WHEN** the palette opens
- **THEN** the entry is listed and selecting it sends the request; with no operator or no
  chat ref it is absent.

### Non-Goals

- No request queue, persisted mailbox, or retry semantics (Constitution II).
- No response channel or reply parsing — delivery + derive only.
- No rate limiting in v1 (manual per-click action; busy gate + per-pane injection lock
  bound the blast radius).
- No second template; no e2e that drives a live agent TUI.
- No SSE wake from this endpoint (nothing derivable changed at request time).

### Design Decisions

#### In-process reuse of the chat-send injection path
**Decision**: the handler calls `s.injectChatMessage` + `sessions.ResolveChatPane`
directly (same `api` package) after its own single `FetchSessions` pass.
**Why**: an HTTP self-call would re-enter the router for no isolation gain; calling
`resolveWindowChat` would issue a second `FetchSessions` per request. One fetch serves
subject lookup, operator lookup, fact derivation, AND the busy gate.
**Rejected**: HTTP self-call (needless hop, loses the request context);
`resolveWindowChat` reuse (double fetch — the helper is window-scoped, this handler is
two-window).
*Introduced by*: 260822-fih1-operator-request-fix-tab-name

#### Busy = `active` OR `waiting`; unknown proceeds
**Decision**: reject on `active`/`waiting`; deliver on `idle` or empty state.
**Why**: `waiting` means a human-blocking dialog is up — pasting into it is the exact
blind-typing hazard the probe exists for; empty state must pass or an operator whose
hooks haven't fired is permanently unreachable (the probe still fail-closes delivery).
**Rejected**: idle-only (strands hookless operators); active-only-busy (types into
permission dialogs).
*Introduced by*: 260822-fih1-operator-request-fix-tab-name

#### Optional `TranscriptLocator` capability, not an Adapter interface change
**Decision**: expose the transcript path as an optional interface the claude adapter
implements, reached via `Lookup` + type-assert behind a package-level `TranscriptPath`.
**Why**: the core `Adapter` interface stays provider-neutral (a future protocol-based
provider may have no on-disk transcript); the guard-bearing `locateTranscript` stays the
single path-resolution site.
**Rejected**: widening the `Adapter` interface (forces a meaningless method on
non-file providers); exporting `locateTranscript` bare (loses provider routing).
*Introduced by*: 260822-fih1-operator-request-fix-tab-name

## Tasks

### Phase 1: Setup

- [x] T001 Export the transcript-path seam in `app/backend/internal/chat`: add the `TranscriptLocator` optional interface + package-level `TranscriptPath(provider, ref)` in `adapter.go`, implement on `claudeAdapter` in `claude.go` (delegating to `locateTranscript`), and add unit tests in `claude_test.go` covering valid-UUID path, `ErrInvalidRef` before any FS access, `ErrTranscriptNotFound`, and `ErrNoAdapter` for an unknown provider <!-- R7 -->

### Phase 2: Core Implementation (backend)

- [x] T002 Create `app/backend/api/operator.go`: the `operatorTemplate` registry (required-facts declaration + pure render func) with the `fix-tab-name` entry rendering the R6 prompt (fab clause conditional on non-empty `FabChange`) <!-- R6 -->
- [x] T003 Implement `handleOperatorRequest` in `app/backend/api/operator.go`: parse/validate (R1), single `FetchSessions` resolution of subject + operator (R2), fact derivation via `chat.TranscriptPath` (R3), busy gate (R4), delivery via `sessions.ResolveChatPane` on the operator's panes + `s.injectChatMessage(..., submit=true)` (R5), `200 {"ok":true}`; register the route in `app/backend/api/router.go` beside the chat routes <!-- R1 -->
- [x] T004 Write `app/backend/api/operator_test.go` (patterned on `chat_send_test.go` / `mockTmuxOps` / mock session fetcher): the full status matrix — 400 bad id / bad body / unknown template; 404 no subject, no operator, subject without chat ref, unresolvable transcript, operator without chat pane; 409 operator `active`, operator `waiting`, probe failure (no Enter sent); 500 FetchSessions error; 200 happy path asserting injection order and that every subprocess targets the OPERATOR's resolved pane; rendered-prompt assertions (facts present, fab clause conditional, no client text) <!-- R2 -->

### Phase 3: Frontend

- [x] T005 [P] Add `sendOperatorRequest(server, windowId, template)` to `app/frontend/src/api/client.ts` (withServer + throwOnError, `sendChatMessage` pattern) <!-- R8 -->
- [x] T006 Add the "Fix tab name" action row to `app/frontend/src/components/sidebar/row-flyout-card.tsx` (ForkActionRow pattern: in-flight guard, stopPropagation, sub-hint), wire the availability inputs (operator presence on the server, subject `chatSessionRef`, not-the-operator-row) through `window-row.tsx`/`sidebar/index.tsx` as needed, success/error toasts; unit tests in `row-flyout-card.test.tsx` covering visibility gating and single-flight <!-- R9 -->
- [x] T007 Add the `Tab: Fix name (ask operator)` palette entry (id `window-fix-name-operator`) to the `windowActions` group in `app/frontend/src/app.tsx` with the same availability gating + toast path; extend the existing palette/app tests where the group is asserted <!-- R10 -->

### Phase 4: Polish

- [x] T008 Run the verification gates: `cd app/backend && go test ./...`, `cd app/frontend && npx tsc --noEmit`, and the affected Vitest suites (`row-flyout-card`, client/palette tests) <!-- R1 -->

## Execution Order

- T001 blocks T003 (the handler imports the seam)
- T002 blocks T003 (the handler renders via the registry)
- T003 blocks T004
- T005 blocks T006 and T007
- T001/T002 and T005 are independent starting points

## Acceptance

### Functional Completeness

- [x] A-001 R1: The route exists, validates windowId/body/template-id closed-set, and 400s before any session fetch on invalid input
- [x] A-002 R2: Subject + operator resolve from one FetchSessions pass; no-operator ⇒ 404 "no operator on this server"; FetchSessions error ⇒ 500
- [x] A-003 R3: The rendered prompt carries windowId, window name, absolute JSONL path, worktree, and conditional fab change/stage — all server-derived
- [x] A-004 R4: `active` and `waiting` operator states each produce a 409 naming the state, with zero injection subprocesses
- [x] A-005 R5: Delivery targets the operator's ResolveChatPane pane via injectChatMessage with submit=true; success is 200 {"ok":true}; no SSE wake in the handler
- [x] A-006 R6: The fix-tab-name template renders the R6 shape including the exact `tmux rename-window -t {windowId}` command and the do-not-reply bound
- [x] A-007 R7: `chat.TranscriptPath` exists, routes via the registry, and preserves the UUID guard (ErrInvalidRef before filesystem access)
- [x] A-008 R8: `sendOperatorRequest` posts the template id and surfaces structured server errors as thrown Error messages
- [x] A-009 R9: The flyout row renders only under the three-part availability rule and fires exactly one request per click cycle
- [x] A-010 R10: The palette entry is present/absent per the same rule and fires the same path

### Behavioral Correctness

- [x] A-011 R5: A probe failure returns the structured 409 and no Enter reaches the operator pane
- [x] A-012 R4: An idle or state-less operator receives delivery (unknown is not busy)

### Scenario Coverage

- [x] A-013 R2: Go tests cover the full 400/404/409/500/200 matrix enumerated in T004
- [x] A-014 R9: Frontend unit tests cover hidden-without-operator, hidden-without-chat-ref, hidden-on-operator-row, and the in-flight guard

### Edge Cases & Error Handling

- [x] A-015 R3: Subject window without a reconciled chat ref ⇒ 404-class error and the UI never shows the action for it
- [x] A-016 R5: Operator window without a reconciled chat pane ⇒ 404-class error, no injection

### Code Quality

- [x] A-017 Pattern consistency: operator.go follows the chat.go handler idioms (writeError vocabulary, parseWindowID, serverFromRequest, context timeouts)
- [x] A-018 No unnecessary duplication: pane resolution reuses sessions.ResolveChatPane; injection reuses injectChatMessage; no second FetchSessions
- [x] A-019 All subprocess paths remain argv-slice `exec.CommandContext` with timeouts (no new tmux primitives should be needed at all)
- [x] A-020 Frontend uses type narrowing (no `as` casts) and the omit-not-disable availability convention
- [x] A-021 New behavior is test-covered (Go matrix + Vitest gating tests) per code-quality's tests-required principle

### Security

- [x] A-022 R1: No client-supplied text reaches the rendered prompt (body carries only the closed-set template id); the transcript-path UUID guard is unbypassed through the new export

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

None — this change adds new functionality without making existing code redundant. The planned `api/chat.go` shared-helper refactor was deliberately dropped (Design Decision: single-fetch resolution via `sessions.ResolveChatPane`), so no pre-existing code path was superseded.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Single-fetch resolution: skip `resolveWindowChat`, use `sessions.ResolveChatPane` on already-fetched windows | The helper would double-fetch; ResolveChatPane is the exported single-source rule | S:70 R:80 A:85 D:75 |
| 2 | Confident | Transcript seam = optional `TranscriptLocator` interface + package-level `TranscriptPath` | Keeps `Adapter` provider-neutral; registry Lookup already exists | S:60 R:80 A:80 D:65 |
| 3 | Confident | Palette entry lives inline in `windowActions` (no `lib/palette-*` pure builder) | One gated entry with a client call — the pure-builder convention is for families with derivation logic; gating here is a boolean conjunction | S:55 R:85 A:75 D:65 |
| 4 | Confident | Availability inputs reach the flyout via props from the sidebar's existing windows data (exact prop threading decided at apply) | The sidebar already holds all windows per server; only plumbing shape varies | S:50 R:85 A:75 D:60 |
| 5 | Certain | No new tmux primitives — existing TmuxOps surface suffices | Injection + capture already exist for chat-send; the handler adds only orchestration | S:85 R:85 A:90 D:85 |

5 assumptions (1 certain, 4 confident, 0 tentative).
