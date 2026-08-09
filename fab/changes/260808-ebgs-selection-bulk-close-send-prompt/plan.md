# Plan: Selection Bulk Close + Send Prompt

**Change**: 260808-ebgs-selection-bulk-close-send-prompt
**Intake**: `intake.md`

## Requirements

### Selection Palette: Action Builders and Eligibility

#### R1: Close and send actions reflect the current selection
The frontend MUST expose pure `Selection:` palette builders for close and prompt broadcast. Each builder MUST omit its action when the selection is empty, MUST use correct singular/plural live-count labels, and MUST allow selections spanning multiple tmux servers because every close/send request carries the selected key's own server.

- **GIVEN** an empty selection
- **WHEN** selection palette actions are built
- **THEN** neither close nor send is present.
- **AND GIVEN** one or more selected keys, **THEN** both actions are present with count-correct labels regardless of whether the keys share a server.

### Command Palette: Destructive Confirmation

#### R2: Bulk close requires an in-palette confirmation step
Selecting `Selection: Close N window(s)` MUST keep the command palette open and replace its results with one `Close N window(s) — Enter to confirm` entry. Confirming MUST invoke the close action exactly once, while Escape or backdrop dismissal MUST cancel without invoking it.

- **GIVEN** a visible bulk-close palette action
- **WHEN** the user selects it
- **THEN** the palette shows only the confirmation entry and does not close any window yet.
- **AND WHEN** the user presses Enter again, **THEN** the action runs and the palette closes; **AND WHEN** the user presses Escape instead, **THEN** the palette closes without running the action.

### Selection Execution: Bulk Close

#### R3: Bulk close is sequential, resilient, and race-safe
`app/frontend/src/app.tsx` MUST execute one existing `killWindow(server, windowId)` request per selected key sequentially, deriving both fields with `splitSelectionKey`, continuing after failures, and reconciling with `settleBatch(keys, failedKeys)`. It MUST report `Closed N window(s)` on full success and an aggregate `Closed X of N window(s) — F failed: <first error>` error toast on partial or total failure. It MUST add no endpoint, route, or optimistic bulk machinery.

- **GIVEN** selected windows across one or more servers
- **WHEN** the close action is confirmed
- **THEN** requests run one at a time against each key's server and all keys are attempted even if an earlier request fails.
- **AND THEN** successful keys leave the owned selection, failed keys remain as the retry affordance, and a selection created while the batch runs is not clobbered.

### Compose Strip: Selection Broadcast Target

#### R4: The compose strip can target a frozen selection
Selecting `Selection: Send prompt to N agent(s)` MUST snapshot the selected keys, open and focus the existing compose strip, and display `→ N selected`. In selection mode the strip MUST retain its multiline textarea and readline editing behavior, but MUST submit non-empty text only through its Send/Cmd-or-Ctrl+Enter path; terminal raw/insert and file-upload actions MUST be unavailable because a cross-server selection has no single terminal stream or worktree upload target. Closing the strip MUST cancel the selection target, and completion MUST return the strip to its normal focused-terminal target model.

- **GIVEN** a selection and a closed or already-open compose strip
- **WHEN** the prompt action is selected
- **THEN** the strip is visible, focused, labels the snapshotted count, and keeps a target-keyed draft while the user composes.
- **AND WHEN** the user submits a non-empty prompt, **THEN** the selection send callback receives it once; terminal raw insert, insert-line, empty submit, and upload do not dispatch a broadcast.

### Selection Execution: Prompt Broadcast

#### R5: Prompt broadcast reuses chat send sequentially
`app/frontend/src/app.tsx` MUST execute one existing `sendChatMessage(server, windowId, text)` request per snapshotted key sequentially, deriving each request's server with `splitSelectionKey`, continuing after all failures including structured `409` probe failures, and reconciling with `settleBatch(keys, failedKeys)`. It MUST report `Sent prompt to N agent(s)` on full success and `Sent to X of N agent(s) — F failed: <first error>` on partial or total failure. The existing default `submit=true` contract MUST be used, with no backend changes.

- **GIVEN** selected windows across one or more servers and a composed prompt
- **WHEN** Send is activated
- **THEN** every recipient is attempted sequentially through `POST /api/windows/{windowId}/chat/send?server={server}` with the same text and default submit behavior.
- **AND THEN** successes leave the owned selection, failures remain selected, the first failure is reported once, and a per-window `409` does not abort later recipients.

### Verification: User-Visible Coverage

#### R6: Tests document and prove the new workflows
Vitest coverage MUST prove builder eligibility/counts, confirmation execution/cancellation, sequential continue-on-error batches, and compose selection-target behavior. `app/frontend/tests/e2e/sidebar-multiselect.spec.ts` MUST cover a real confirmed bulk close and a routed bulk prompt broadcast, and its sibling `.spec.md` MUST document every changed or added test.

- **GIVEN** the frontend unit and sidebar multiselect e2e suites
- **WHEN** they run through the repository's `just` recipes
- **THEN** both selection workflows and their failure/cancellation boundaries are executable and documented without a new backend seam.

### Non-Goals

- New backend bulk endpoints, API routes, or pages.
- Bulk file upload or terminal raw/insert broadcast; selected recipients can span servers and worktrees, while this feature is specifically a submitted agent prompt.
- New inline selection buttons or dialogs; the palette and compose strip remain the only action/input surfaces.

### Design Decisions

#### Freeze broadcast recipients when the palette action is selected
**Decision**: The compose target owns a snapshot of the selected composite keys captured when `Selection: Send prompt…` is chosen.
**Why**: The displayed count, draft identity, requests, and terminal `settleBatch` reconciliation stay aligned even if the user changes selection while composing or while the batch is running.
**Rejected**: Reading the live selection at Send time, because that can silently deliver a prompt to recipients different from the palette command and target label the user chose.
*Introduced by*: 260808-ebgs-selection-bulk-close-send-prompt

#### Broadcast mode submits text only
**Decision**: Selection broadcast enables only the compose strip's submitted-text path; upload and terminal insert/raw modes remain unavailable in this target mode.
**Why**: The specified transport is chat send with default `submit=true`, and cross-server recipients do not share one websocket terminal or worktree for attachment upload.
**Rejected**: Reusing a focused pane's websocket or upload target for every recipient, because it would target the wrong server/window and make attachment paths invalid for other worktrees.
*Introduced by*: 260808-ebgs-selection-bulk-close-send-prompt

## Tasks

### Phase 1: Selection Primitives

- [x] T001 Add close/send pure builders plus a reusable sequential per-key batch helper and Vitest coverage in `app/frontend/src/lib/palette-selection.ts` and `app/frontend/src/lib/palette-selection.test.ts`. <!-- R1 R3 R5 -->

### Phase 2: Core Interaction Surfaces

- [x] T002 Extend `app/frontend/src/components/command-palette.tsx` with an optional one-entry confirmation sub-step and cover Enter/Escape behavior in `app/frontend/src/components/command-palette.test.tsx`. <!-- R2 -->
- [x] T003 Add the frozen selection-broadcast target, submit-only behavior, focus/cleanup semantics, and focused tests in `app/frontend/src/components/compose-strip.tsx` and `app/frontend/src/components/compose-strip.test.tsx`. <!-- R4 --> <!-- rework: review should-fix 1 — plain Enter is a dead key in selection-broadcast mode (classifyComposeEnter returns insert-line, the selection branch returns on mode !== "submit", onKeyDown already preventDefault'd at :520) while the textarea advertises enterKeyHint="send"; map plain Enter to submit in selection mode OR let it fall through to a native newline. review should-fix 2 — a TOTALLY failed broadcast still clears the composed prompt: onSend always resolves (executeSelectionBatch never rethrows) so pushComposeSentHistory + clearComposeDraft run even at 0-of-N delivery; have onSend resolve with a delivered count (or reject on zero delivery) and retain the draft in that case. Cover both with tests. -->

### Phase 3: Integration & Edge Cases

- [x] T004 Wire `executeBulkClose`, `executeBulkSend`, the new selection actions, cross-server per-key API calls, aggregate toasts, `settleBatch`, and compose-target lifecycle in `app/frontend/src/app.tsx`. <!-- R1 R3 R4 R5 --> <!-- rework: review must-fix — executeBulkMove (app.tsx:2074-2107) still hand-rolls the exact sequential continue-on-error loop that executeSelectionBatch (lib/palette-selection.ts:121-144) encapsulates (same splitSelectionKey null guard, same "malformed window key" literal, same failedKeys/firstError accumulation); migrate it behavior-identically onto the helper (~6 lines; move stays single-server gated and keeps ignoring the per-key server) so acceptance A-021 is fully met. review should-fix 3 — the aggregate-toast composition ("X of N <noun> — F failed: <first error>" + success twin) is written out three times across move/close/send; extract one shared helper next to executeSelectionBatch, keeping operation-specific verb/noun copy at the call sites. -->
- [x] T005 Extend `app/frontend/tests/e2e/sidebar-multiselect.spec.ts` with confirmed-close and prompt-broadcast workflows, and update `app/frontend/tests/e2e/sidebar-multiselect.spec.md` for every changed test/setup detail. <!-- R6 -->

### Phase 4: Verification

- [x] T006 Run `just test-frontend`, `cd app/frontend && npx tsc --noEmit`, and the focused `just test-e2e "tests/e2e/sidebar-multiselect.spec.ts"`; fix all failures without changing the specified behavior. <!-- R6 --> <!-- rework: re-verify after the T003/T004 rework edits -->

## Execution Order

- T001 and T002 establish the action/batch and confirmation contracts used by T004.
- T003 establishes the compose target contract used by T004.
- T004 must complete before the end-to-end coverage in T005.
- T006 runs after all implementation and test changes.

## Acceptance

### Functional Completeness

- [x] A-001 R1: Empty selections omit close/send; non-empty same-server and cross-server selections expose correctly pluralized actions. — `palette-selection.ts:77-109`; units cover empty/singular/plural/cross-server.
- [x] A-002 R2: Bulk close cannot execute from its first palette selection and requires the single Enter-to-confirm row; Escape cancels it. — `command-palette.tsx:38-49,94-106`; unit + e2e.
- [x] A-003 R3: Bulk close attempts each selected key sequentially on its own server, aggregates failures, and reconciles only its owned keys. — `app.tsx:2100-2115` via `executeSelectionBatch`.
- [x] A-004 R4: The compose strip opens/focuses on a snapshotted `N selected` target and submits only non-empty broadcast prompts while leaving terminal/upload-only modes unavailable. — `compose-strip.tsx:179-189,239-240,325-345,646-649`. Broadcast takes the classifier's `chat` surface (`compose-strip.tsx:532-538`): plain Enter is a local newline, Cmd/Ctrl+Enter and the Send button are the only submit paths, and the non-submit actions stay native rather than being consumed into a no-op — `enterkeyhint` follows the mode (`:752`).
- [x] A-005 R5: Prompt broadcast sends the same text sequentially with default submit behavior, continues after errors/409s, aggregates feedback, and reconciles its owned keys. — `app.tsx:2123-2139`; e2e asserts two ordered POSTs with no explicit `submit` field.
- [x] A-006 R6: Unit and e2e coverage proves both workflows, and the Playwright companion documentation matches the spec. — 2456 unit tests green; 8/8 `sidebar-multiselect` e2e green; `.spec.md` matches the spec (the rework changed no e2e test — the broadcast e2e submits via the Send button, not Enter).

### Behavioral Correctness

- [x] A-007 R2: A canceled close confirmation performs no kill request and leaves the selected windows live. — e2e asserts both tmux ids live and `2 selected` after Escape.
- [x] A-008 R3: Full close success reports `Closed N window(s)` and clears succeeded keys; partial/total failure reports counts plus the first error and retains failed keys. — `app.tsx:2107-2114` via the shared `batchToast`; the failure branch is implemented and unit-tested at the helper (`palette-selection.test.ts:333-385`).
- [x] A-009 R4: Changing live selection after opening broadcast cannot retarget the compose prompt away from its displayed snapshot. — e2e deselects a row and asserts the target stays `2 selected`.
- [x] A-010 R5: Full send success reports `Sent prompt to N agent(s)`; partial/total failure reports `Sent to X of N agent(s) — F failed: <first error>` and retains failed keys. — `app.tsx:2130-2138` via the shared `batchToast`. The executor also RESOLVES the delivered count, so a 0-of-N broadcast keeps both the frozen target and the composed prompt (`app.tsx:3303-3312`).

### Scenario Coverage

- [x] A-011 R2: Command-palette unit/e2e coverage exercises first-step selection, confirmation, and Escape cancellation. — `command-palette.test.tsx:83-136` + e2e.
- [x] A-012 R3: Unit/e2e coverage exercises sequential close and real tmux window removal. — `palette-selection.test.ts` batch units + e2e polls `listWindows` until both ids are gone.
- [x] A-013 R4: Compose-strip unit/e2e coverage exercises target label, draft entry, focus, unavailable insert/upload actions, and submission. — `compose-strip.test.tsx:153-281`, including the broadcast Enter policy (plain Enter falls through, Cmd/Ctrl+Enter submits) and both delivery outcomes; focus asserted in e2e.
- [x] A-014 R5: Unit/e2e coverage records one chat-send POST per selected key and proves sequential dispatch. — e2e route recorder asserts `maxInFlight === 1` and two ordered POSTs.

### Edge Cases & Error Handling

- [x] A-015 R1: Malformed keys fail locally as one batch item without aborting later keys; cross-server keys remain eligible for close/send. — `palette-selection.ts:127-133` + units.
- [x] A-016 R3: Close failure processing preserves the first error and calls `settleBatch` with exactly the failed keys. — `app.tsx:2112-2127`; first-error retention unit-tested at the helper.
- [x] A-017 R4: Empty broadcast submit is blocked, and closing/unmounting the strip clears broadcast target state without losing unrelated per-window drafts. — `compose-strip.tsx:326,647-649` + `app.tsx:2049-2053`; the strip's own draft key (`selection:…`) never collides with a window key. A broadcast delivered to NOBODY also retains its draft and records no sent history (`compose-strip.tsx:330-338`), so the prompt survives for the retry against the still-selected recipients.
- [x] A-018 R5: A send rejection, including the endpoint's structured 409, counts as a recipient failure and does not prevent later sends. — `throwOnError` turns the structured 409 into a rejection that `executeSelectionBatch` records and steps past (unit-tested with a rejecting operation).

### Code Quality

- [x] A-019: Readability: New functions remain focused and named consistently with the existing palette/compose/selection vocabulary.
- [x] A-020: Pattern consistency: Builders remain dependency-light, action bodies stay thin, and existing selection/compose utilities are reused.
- [x] A-021: No unnecessary duplication: Close/send share one sequential batch helper while keeping operation-specific toast copy clear. — move/close/send ALL run through `executeSelectionBatch` (`app.tsx:2075-2096`, `2100-2115`, `2123-2139`) and compose their one aggregate toast through the shared `batchToast` (`palette-selection.ts:146-183`); only the verb/noun/qualifier copy stays at the call sites. Move keeps its single-server gate and still ignores the per-key server.
- [x] A-022: Type narrowing: Malformed selection keys and unknown errors use guards rather than unchecked assertions. — `splitSelectionKey` null guard + `error instanceof Error` narrowing; no new `as` casts.
- [x] A-023: Tests accompany changed behavior, including Playwright companion documentation.
- [x] A-024: No polling, database state, new route, or backend endpoint is introduced. — frontend-only diff; reuses `POST /api/windows/{id}/kill` and `.../chat/send`.

## Notes

- Apply ignores acceptance checkboxes; review marks them after verifying the implementation.
- All frontend test commands run through `just` recipes except the explicitly required TypeScript compiler check.

## Deletion Candidates

*(Both candidates from the prior cycle — `executeBulkMove`'s inline per-key loop and the triplicated toast composition — were consumed by the rework: move now runs through `executeSelectionBatch` and all three call sites compose through `batchToast`.)*

- `app/frontend/src/lib/palette-selection.ts:62` (`windowCount`) and `:67` (`agentCount`) — two three-line singular/plural helpers that differ only in the noun, alongside a third inline pluralization inside `batchToast` (`:177`); one `pluralize(n, noun)` would delete both helpers and the inline branch.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Freeze the selected-key recipient set when the prompt palette action is chosen | Keeps the visible target count, draft identity, send recipients, and race-safe settlement aligned; the intake specifies a selection target but not whether it is live or frozen | S:72 R:88 A:82 D:72 |
| 2 | Certain | Selection broadcast exposes submitted text only; upload and terminal raw/insert modes are unavailable | The intake explicitly selects chat send with default `submit=true`; cross-server recipients cannot share one websocket or worktree upload target | S:90 R:86 A:94 D:90 |

2 assumptions (1 certain, 1 confident, 0 tentative).
