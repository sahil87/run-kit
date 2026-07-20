# Plan: Pointer-Aware Enter Semantics + Insert-Without-Submit

**Change**: 260719-mxvw-pointer-aware-enter-insert-mode
**Intake**: `intake.md`

## Requirements

### Frontend: Shared pointer/key policy primitives

#### R1: Live coarse-pointer detection hook
A new `useCoarsePointer()` hook (`app/frontend/src/hooks/use-coarse-pointer.ts`) SHALL return whether `window.matchMedia("(pointer: coarse)")` currently matches, subscribing to `change` events so the value updates live (plugging in a mouse mid-session flips it without a reload). It MUST key on pointer type only — NOT viewport width (explicitly not `useIsMobile()`'s narrow-width-OR-coarse rule) — and MUST tolerate environments without `window.matchMedia` (returning `false`), following the `use-is-mobile.ts` listener-fallback pattern. Both text-input surfaces consume this one hook for BOTH the keydown policy and the `enterkeyhint` value.

- **GIVEN** a rendered consumer of `useCoarsePointer()` on a fine-pointer device
- **WHEN** the `(pointer: coarse)` media query flips to matching (a `change` event fires)
- **THEN** the hook re-renders its consumer with `true`, and flips back to `false` on the reverse change.

#### R2: Pure Enter-classification helper shared by both surfaces
A pure function `classifyComposeEnter(key, coarse)` (`app/frontend/src/lib/compose-keys.ts`) SHALL map a keydown (`{key, shiftKey, metaKey, ctrlKey, altKey, isComposing}`) plus the coarse-pointer flag to exactly one action: `"submit"`, `"insert"`, or `"default"` (leave the textarea's native behavior — newline insertion — untouched). The decision table, in precedence order:

1. `key !== "Enter"` OR `isComposing` → `"default"` (IME guard unchanged)
2. `metaKey || ctrlKey` → `"submit"` (universal escape hatch, all devices)
3. `altKey` → `"insert"` (insert-without-submit chord)
4. `shiftKey` → `"default"` (newline, always)
5. `coarse` → `"default"` (touch: Enter inserts a newline; Send button submits)
6. else → `"submit"` (fine pointer: Enter submits — unchanged)

Both `ComposeStrip.onKeyDown` and `ChatSendForm.onKeyDown` MUST route Enter handling through this one function — divergence between the two surfaces is a defect (intake decision 5).

- **GIVEN** any combination of modifiers and pointer type
- **WHEN** `classifyComposeEnter` runs
- **THEN** it returns per the table above — e.g. plain Enter is `"submit"` on fine and `"default"` on coarse; Cmd/Ctrl+Enter is `"submit"` on both; Alt+Enter is `"insert"` on both; Shift+Enter is `"default"` on both; a composing Enter is `"default"` everywhere.

### Frontend: Compose strip (`compose-strip.tsx`)

#### R3: Pointer-aware Enter + universal Cmd/Ctrl+Enter on the compose strip
`ComposeStrip`'s keydown handler SHALL apply `classifyComposeEnter` with the live `useCoarsePointer()` value: `"submit"` → `preventDefault` + `stopPropagation` + submit-send (unchanged fine-pointer behavior); `"insert"` → `preventDefault` + `stopPropagation` + insert-send (R4); `"default"` → do not intercept (textarea inserts the newline natively). The empty/whitespace no-op, closed-WS draft preservation, and Escape-blurs behavior are unchanged.

- **GIVEN** the strip with typed text on a coarse pointer
- **WHEN** the user presses plain Enter
- **THEN** nothing is sent (the textarea gains a newline) — and the Send button still submits.
- **AND GIVEN** a coarse pointer with a hardware keyboard, **WHEN** Cmd/Ctrl+Enter is pressed, **THEN** the strip submits exactly as fine-pointer Enter does.

#### R4: Compose-strip insert-without-submit (no trailing `\r`)
The strip SHALL gain an insert-only delivery: `ws.send(text)` with NO trailing `\r` — re-adding the old modal ComposeBuffer's raw-insert as a secondary action. It uses the SAME delivery guards as submit (open WS, non-empty/non-whitespace text, live focused target) and the SAME clear-on-delivery (draft + attachments cleared, blob URLs revoked, strip stays open, no focus steal). Triggers: the Alt+Enter chord (R2) and a secondary "Insert" button rendered next to "Send" (border-styled secondary chip, `preventFocusSteal`, disabled exactly when Send is, `coarse:min-h-[36px]`, `title` documenting the Alt+Enter chord). The multiline raw-bytes caveat (embedded `\n` executes per line on a plain shell pane) is documented in a code comment, not guarded (intake §6).

- **GIVEN** the strip with text `hello` and an open focused stream
- **WHEN** the user presses Alt+Enter (or clicks Insert)
- **THEN** exactly `"hello"` (no `\r`) is sent over the relay WS, and the draft clears as after a submit.
- **AND GIVEN** the stream is not open, **THEN** the insert early-returns and the draft is preserved (same guard as submit).

### Frontend: Chat send form (`chat-view.tsx`, `client.ts`, `app.tsx`)

#### R5: Pointer-aware Enter + universal Cmd/Ctrl+Enter on the chat send form
`ChatSendForm`'s keydown handler SHALL apply the same `classifyComposeEnter` + `useCoarsePointer()` policy: `"submit"` → submit via the existing in-flight-locked `submit()`; `"insert"` → the insert-mode submission (R6); `"default"` → not intercepted. The in-flight lock, empty/whitespace no-op, clear-on-success/keep-on-failure, inline `role="alert"` error, and busy hint are unchanged and apply identically to insert-mode sends.

- **GIVEN** the chat form with typed text on a coarse pointer
- **WHEN** plain Enter is pressed
- **THEN** no POST fires and the textarea gains a newline; the Send button and Cmd/Ctrl+Enter both still submit.

#### R6: Chat insert-without-submit — additive `submit` flag end to end
The chat surface SHALL gain insert-only delivery via an additive optional `submit` boolean:

- `ChatSendForm` gains an "Insert" button next to "Send" (same enable/disable as Send, `title` documenting Alt+Enter) and the Alt+Enter chord; both route through the shared in-flight-locked submission with `submit: false`.
- `ChatView`'s `onSend` prop widens to `(text: string, submit: boolean) => Promise<void>`; `app.tsx` passes the flag through to the client.
- `sendChatMessage(server, windowId, text, submit = true)` (`client.ts`) SHALL include `submit: false` in the POST body only when false — the default body stays exactly `{ text }` (absent field ⇒ current behavior; older wire shape preserved).

- **GIVEN** the chat form with typed text
- **WHEN** the user clicks Insert (or presses Alt+Enter)
- **THEN** exactly one POST fires with body `{ "text": ..., "submit": false }`, and the textarea clears on success / keeps the text with the inline error on failure — identical to submit-mode.
- **AND GIVEN** a plain submit, **THEN** the body carries no `submit` field.

### Frontend: Truthful `enterkeyhint`

#### R7: `enterkeyhint` tracks what Enter actually does, on both textareas
Both textareas (`compose-strip-input`, `chat-send-input`) SHALL set `enterKeyHint` from the same live coarse-pointer value driving the keydown policy: `"send"` when Enter submits (fine pointer), `"enter"` when Enter inserts a newline (coarse pointer). Neither sets it today.

- **GIVEN** a fine pointer
- **THEN** both textareas render `enterkeyhint="send"`; **AND GIVEN** a coarse pointer, **THEN** both render `enterkeyhint="enter"` — and a live pointer-capability change updates hint and keydown policy together.

### Backend: `submit` flag on the chat-send endpoint (`chat.go`)

#### R8: `chatSendRequest.Submit` gates ONLY the final Enter
`chatSendRequest` SHALL gain `Submit *bool` (JSON `submit`), defaulting to `true` when absent. `injectChatMessage` gains the resolved boolean and, when false, SHALL skip ONLY step 5 (`SendEnterToPane`) — the baseline capture, handler-boundary sanitization, named-buffer set/paste, novelty echo probe (probe failure still returns the structured 409, Enter irrelevant but text left recoverable), per-(server,paneID) whole-sequence lock, `chatSetPasteMu`, and the single `chatSendTotalBudget` deadline are all unchanged. Success returns the same `200 {"ok":true}`. No new endpoint, no verb change (Constitution IX).

- **GIVEN** a POST body `{"text":"hi","submit":false}` with a passing echo probe
- **WHEN** the handler runs
- **THEN** set-buffer/paste/probe all execute against the resolved pane and `SendEnterToPane` is NEVER called; the response is `200 {"ok":true}`.
- **AND GIVEN** `submit:false` with a failing probe, **THEN** the response is `409` and no Enter is sent.
- **AND GIVEN** a body with no `submit` field (or `submit:true`), **THEN** behavior is byte-identical to today (Enter sent after a passing probe).

### Testing

#### R9: Unit + e2e coverage with `.spec.md` companions in the same commit
Coarse-pointer Enter behavior, the chord matrix, `enterkeyhint`, and insert semantics SHALL be unit-tested (jsdom `matchMedia` stubs) in the colocated `.test.ts(x)` files; the backend flag in `chat_send_test.go` against `mockTmuxOps`. E2e (`compose-strip.spec.ts`, `chat-view.spec.ts`) SHALL cover fine-pointer semantics plus the Insert affordance, with both `.spec.md` companions updated in the same commit (constitutional requirement).

- **GIVEN** the updated specs
- **WHEN** `just test-backend`, `just test-frontend`, and `just test-e2e` run for the touched specs
- **THEN** all pass, and each modified `.spec.ts` has a matching `.spec.md` update.

### Non-Goals

- Slash-command/skill autocomplete in the compose box — user's explicit scope call.
- Guarding the multiline raw-bytes caveat (insert-only with embedded `\n` executes per line on a plain shell pane) — documented in code/memory, no behavioral guard.
- Command-palette entries for the new chords — see Design Decisions (palette exemption).

### Design Decisions

#### Shared classifier in `lib/` + one pointer hook
**Decision**: Centralize the Enter decision table in a pure `lib/compose-keys.ts` function and pointer detection in one `useCoarsePointer` hook, consumed by both surfaces.
**Why**: The intake makes cross-surface divergence a defect (decision 5); a single shared decision path makes divergence structurally impossible and the table unit-testable without a component mount (the `palette-move.ts` extraction pattern).
**Rejected**: Per-surface inline branching — the two handlers already drifted once (compose strip vs chat form grew independently) and would again.
*Introduced by*: 260719-mxvw-pointer-aware-enter-insert-mode

#### Palette exemption for Alt+Enter / Cmd+Ctrl+Enter
**Decision**: The new chords are NOT registered in the command palette; each Insert button carries a `title` documenting its chord.
**Why**: The code-review rule targets global app shortcuts discoverable via `Cmd+K`; these are focused-textarea editing chords (like Shift+Enter today, which is likewise unregistered) — they are meaningless without the textarea focused, and the palette cannot act on a focused draft. Constitution V is satisfied: every action is keyboard-reachable (chords) AND mouse/touch-reachable (buttons). The intake explicitly allows this exemption with rationale.
**Rejected**: `Chat: Insert draft` palette entries — the palette steals focus from the textarea it would act on.
*Introduced by*: 260719-mxvw-pointer-aware-enter-insert-mode

#### `submit` serialized only when false
**Decision**: `sendChatMessage` includes `submit` in the POST body only for `submit: false`; the default body stays `{ text }`.
**Why**: Keeps the default wire shape byte-identical (additive contract per intake §4); a missing field and `true` are the same server-side (`*bool` nil-or-true), so serializing `true` adds noise without meaning.
**Rejected**: Always serializing the field — churns every existing test/mocked body for zero information.
*Introduced by*: 260719-mxvw-pointer-aware-enter-insert-mode

## Tasks

### Phase 1: Setup — shared primitives

- [x] T001 [P] Create `app/frontend/src/hooks/use-coarse-pointer.ts` — live `matchMedia("(pointer: coarse)")` hook (change-listener + legacy `addListener` fallback per `use-is-mobile.ts`, `false` without `matchMedia`) — with colocated `use-coarse-pointer.test.ts` (initial value, live change event, missing-matchMedia guard) <!-- R1 -->
- [x] T002 [P] Create `app/frontend/src/lib/compose-keys.ts` — `classifyComposeEnter(key, coarse): "submit" | "insert" | "default"` implementing the precedence table — with colocated `compose-keys.test.ts` covering the full matrix (plain/Shift/Alt/Meta/Ctrl/combined modifiers × fine/coarse × isComposing × non-Enter keys) <!-- R2 -->

### Phase 2: Core implementation

- [x] T003 Rework `app/frontend/src/components/compose-strip.tsx`: route `onKeyDown` Enter handling through `classifyComposeEnter` + `useCoarsePointer`; parametrize `send(submit: boolean)` (`ws.send(submit ? text + "\r" : text)`, shared guards/clear, raw-bytes caveat comment); add the Insert button (secondary chip left of Send, `data-testid="compose-strip-insert"`, `preventFocusSteal`, disabled with Send, Alt+Enter `title`); set `enterKeyHint` from the pointer value. Update `compose-strip.test.tsx`: coarse Enter does not send, Cmd/Ctrl+Enter sends on coarse+fine, Alt+Enter and Insert button send WITHOUT `\r` and clear, insert preserves draft on closed WS, `enterkeyhint` per pointer type (re-stub `matchMedia` for coarse) <!-- R3, R4, R7 -->
- [x] T004 Rework `ChatSendForm` in `app/frontend/src/components/chat-view.tsx`: widen `onSend` to `(text, submit) => Promise<void>`; `submit(submitFlag)` keeps the one in-flight lock/clear/error path; route keydown through the shared classifier + hook; add the Insert button (`data-testid="chat-send-insert"`, disabled with Send, Alt+Enter `title`); set `enterKeyHint`. Update `chat-view.test.tsx`: existing sends assert `onSend(text, true)`; coarse Enter no-op; Cmd/Ctrl+Enter submits; Alt+Enter + Insert button call `onSend(text, false)` with clear-on-success/keep-on-failure; `enterkeyhint` per pointer type <!-- R5, R6, R7 -->
- [x] T005 [P] Extend `sendChatMessage` in `app/frontend/src/api/client.ts` with `submit = true` (body gains `submit: false` only when false); update `client.test.ts` (default body has NO `submit` key; explicit false serializes it) <!-- R6 -->
- [x] T006 Wire `app/frontend/src/app.tsx` ChatView `onSend` to pass the flag through to `sendChatMessage(server, windowParam, text, submit)` <!-- R6 -->
- [x] T007 Backend `app/backend/api/chat.go`: add `Submit *bool` to `chatSendRequest`, resolve the default in `handleChatSend`, thread `submit bool` into `injectChatMessage`, gate ONLY the `SendEnterToPane` step. Add `chat_send_test.go` cases: `submit:false` + passing probe → 200 with `sendEnterCalled == false` (paste/probe still called); `submit:false` + failing probe → 409; explicit `submit:true` and absent field → Enter sent (unchanged) <!-- R8 -->

### Phase 3: Integration & edge cases (e2e)

- [x] T008 `app/frontend/tests/e2e/compose-strip.spec.ts` + `compose-strip.spec.md`: add fine-pointer coverage — Insert button delivers the marker into the `cat` pane's input line WITHOUT committing it (marker appears exactly once in `capture-pane`; textarea clears), then Cmd/Ctrl+Enter submits a second marker end-to-end (echoed line) <!-- R4, R9 -->
- [x] T009 `app/frontend/tests/e2e/chat-view.spec.ts` + `chat-view.spec.md`: extend `mockChatSend` to record full parsed bodies; add — Insert button POSTs `{text, submit:false}` and clears; plain-Enter submit body carries NO `submit` field (existing test tightened or new assertion) <!-- R6, R9 -->

### Phase 4: Polish

- [x] T010 Full verification gates: `just test-backend`, frontend type check (`npx tsc --noEmit` via the just recipe path), `just test-frontend`, `just test-e2e "compose-strip"` and `just test-e2e "chat-view"` <!-- R9 -->

## Execution Order

- T001, T002 are independent [P]; both block T003 and T004
- T005 blocks T006 (app.tsx passes the new client param); T004 blocks T006 (prop shape)
- T007 is independent of frontend tasks after Phase 1
- T008 depends on T003; T009 depends on T004–T006
- T010 last

## Acceptance

### Functional Completeness

- [x] A-001 R1: `useCoarsePointer` exists, subscribes live to `(pointer: coarse)`, and is the single pointer-detection source for both surfaces
- [x] A-002 R2: `classifyComposeEnter` implements the precedence table and is the ONLY Enter-decision path in both keydown handlers
- [x] A-003 R3: Compose strip — fine Enter submits, coarse Enter inserts a newline, Cmd/Ctrl+Enter submits everywhere, Shift+Enter always newline
- [x] A-004 R4: Compose strip insert-only sends bytes without trailing `\r` via Alt+Enter and the Insert button, with submit's guards and clear-on-delivery
- [x] A-005 R5: Chat send form mirrors the same Enter/chord policy with its in-flight lock and error semantics intact
- [x] A-006 R6: `submit:false` flows ChatSendForm → `onSend` → `sendChatMessage` → POST body; the default body remains exactly `{ text }`
- [x] A-007 R7: Both textareas carry `enterkeyhint="send"` on fine and `enterkeyhint="enter"` on coarse, live-updating
- [x] A-008 R8: Backend `submit:false` skips only `SendEnterToPane`; probe/409/locks/budget/sanitize unchanged; absent field ⇒ prior behavior

### Behavioral Correctness

- [x] A-009 R3: Coarse-pointer plain Enter no longer fires a send on either surface (the intake's premature-submit bug is gone)
- [x] A-010 R8: A `submit:false` send with a failing probe still returns the structured 409 and leaves the text recoverable

### Scenario Coverage

- [x] A-011 R9: Unit tests cover the chord matrix, coarse behavior (jsdom matchMedia), `enterkeyhint`, insert clearing/guards on both surfaces; Go tests cover the submit-flag matrix
- [x] A-012 R9: E2e covers the fine-pointer Insert affordance (compose strip raw insert; chat POST body) and both `.spec.md` companions are updated in the same commit

### Edge Cases & Error Handling

- [x] A-013 R2: IME-composing Enter and non-Enter keys classify as `"default"` on every surface/pointer combination
- [x] A-014 R4: Insert on a closed relay stream preserves the draft (no silent loss); empty/whitespace insert is a no-op on both surfaces

### Code Quality

- [x] A-015 Pattern consistency: new hook/lib files follow the `use-is-mobile.ts` / `palette-move.ts` extraction patterns; buttons reuse the house chip vocabulary (`rk-glint`, `preventFocusSteal`, `coarse:min-h-[36px]`)
- [x] A-016 No unnecessary duplication: one classifier + one hook shared by both surfaces; no per-surface reimplementation; type narrowing over `as` casts
- [x] A-017 Tests included for added/changed behavior (code-quality mandate); e2e via `just` recipes only

### Security

- [x] A-018 R8: The backend change introduces no new subprocess shapes — the same argv-slice tmux primitives run under the same shared deadline; handler-boundary sanitization still precedes all downstream consumers

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)

## Deletion Candidates

- None — this change is additive. The only code it superseded (the inline `matchMedia("(pointer: coarse)")` autofocus check in `ChatSendForm`, `chat-view.tsx`) was replaced in place by the shared `useCoarsePointer` hook within this diff, leaving nothing redundant behind.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Modifier precedence meta/ctrl > alt > shift > coarse (Cmd+Shift+Enter submits; Alt+Shift+Enter inserts) | Intake fixes each chord alone but not combinations; universal-submit reads as strongest intent; pure-UI, trivially reversible | S:55 R:90 A:80 D:65 |
| 2 | Confident | Insert button: text label "Insert", secondary border-styled chip placed left of Send, `title` documenting Alt+Enter | Intake row 5 pins "secondary Insert button next to Send" but not exact placement/styling; house secondary-chip vocabulary applies | S:60 R:95 A:85 D:70 |
| 3 | Confident | Palette exemption for the new chords (documented via button `title`s) — no `Cmd+K` entries | Intake explicitly offers "or exempted with rationale in the plan"; chords are focused-textarea-local like the unregistered Shift+Enter; buttons + chords satisfy Constitution V | S:60 R:90 A:75 D:65 |
| 4 | Confident | `submit` field serialized only when `false`; absent = true server-side via `*bool` | Intake specifies "additive optional, default true (absent field ⇒ current behavior)"; omitting the true case keeps the default wire shape byte-identical | S:70 R:90 A:85 D:80 |
| 5 | Certain | Coarse plain Enter is simply not intercepted (no preventDefault/stopPropagation) — the textarea's native newline | Intake states it verbatim: "do not intercept — the textarea default" | S:90 R:90 A:90 D:90 |
| 6 | Confident | Chat insert reuses the submit path's in-flight lock, clear-on-success, keep-on-failure, and inline error unchanged | Intake row 10 pins clear-on-success; a second parallel state machine for insert would be divergence the intake forbids | S:65 R:90 A:85 D:75 |
| 7 | Confident | E2e insert verification = marker present exactly once in `capture-pane` (typed echo, not committed) against the `cat` pane | Existing spec's own end-to-end vocabulary; a once-count distinguishes inserted-not-submitted from submitted (twice) | S:55 R:90 A:75 D:65 |

7 assumptions (1 certain, 6 confident, 0 tentative).
