# Plan: Compose strip Enter=insert-line policy (terminal-faithful Enter matrix)

**Change**: 260802-lj98-compose-enter-insert-line
**Intake**: `intake.md`

## Requirements

### Compose Keys: Surface-parameterized classifier

#### R1: `classifyComposeEnter` gains a required surface parameter and an `"insert-line"` action
`classifyComposeEnter` (`app/frontend/src/lib/compose-keys.ts`) SHALL take a **required** second parameter `surface: "strip" | "chat"` (no default — both call sites must declare their surface). `ComposeEnterAction` SHALL gain a fourth value `"insert-line"`. Precedence, first match wins: non-Enter or IME-composing → `"default"`; meta/ctrl → `"submit"`; alt → `"insert"`; shift → `"default"`; then plain Enter → `"insert-line"` when `surface === "strip"`, `"default"` when `surface === "chat"`. The classifier SHALL stay pure, component-free, and text-agnostic (empty-text handling remains at the call sites). `composeSubmitKeycap()` SHALL be unchanged. The file-header doc comment SHALL be rewritten: the classifier remains the single authority for BOTH surfaces' Enter policy, but the surfaces now deliberately diverge on plain Enter, with the visibility rationale (the strip overlays the visible terminal so staged text visibly lands in the pane's composer; the chat lens cannot show the pane's input box, so Enter-as-insert there would make typed text vanish).

- **GIVEN** a plain Enter keydown (no modifiers, not IME-composing)
- **WHEN** classified with `surface: "strip"`
- **THEN** the result is `"insert-line"`
- **AND** with `surface: "chat"` the result is `"default"`

- **GIVEN** an Enter keydown with meta or ctrl (either surface)
- **WHEN** classified
- **THEN** the result is `"submit"` (meta/ctrl outranks alt outranks shift/plain, on both surfaces)

- **GIVEN** an IME-composing Enter, a non-Enter key, or Shift+Enter (no meta/ctrl/alt)
- **WHEN** classified with either surface
- **THEN** the result is `"default"`

### Compose Strip: Mode-based send path

#### R2: `send()` becomes mode-based with per-mode payloads and empty-text policy
`ComposeStrip`'s `send` (`app/frontend/src/components/compose-strip.tsx`) SHALL become mode-based — `send(mode: "submit" | "insert" | "insert-line")`:
- `"submit"` → `ws.send(text + "\r")`; when `text.trim() === ""` (empty or whitespace-only) → `ws.send("\r")` (bare Enter — "press Enter in the pane"; replaces the empty-never-sends early return **for the submit path only**).
- `"insert"` → `ws.send(text)` (byte-exact, no trailing byte); empty/whitespace-only → no-op (unchanged).
- `"insert-line"` → `ws.send(text + "\n")`; empty/whitespace-only → no-op.

Guards SHALL be unchanged for all modes: `draftKey !== null` and `wsRef.readyState === WebSocket.OPEN`; a guard-blocked send still early-returns WITHOUT clearing (draft preserved). Clear-on-delivery (clear that target's draft + revoke its preview URLs) SHALL be unchanged for non-empty sends in every mode; a delivered whitespace-only submit also clears (whitespace discarded). The terminal-conventional semantics of the transmitted `"\n"` (a plain shell pane executes the line; Claude Code treats it as newline-insert) SHALL be documented in the send-path code comment — accepted, not guarded (extends the existing multiline raw-bytes caveat).

- **GIVEN** a focused open target and draft text `"line one"`
- **WHEN** `send("insert-line")` runs
- **THEN** `ws.send("line one\n")` fires and that target's draft clears

- **GIVEN** a focused open target and an empty (or whitespace-only) textarea
- **WHEN** `send("submit")` runs
- **THEN** `ws.send("\r")` fires (bare Enter)

- **GIVEN** a CLOSED stream and a non-empty draft
- **WHEN** any send mode runs
- **THEN** nothing is sent and the draft is preserved

#### R3: Keydown routing — Enter transmits; empty Enter is a full no-op
The strip's `onKeyDown` SHALL pass `surface: "strip"` to the classifier; `"default"` falls through (unchanged); any other action → `preventDefault()` + `stopPropagation()` + `send(action)`. Because `"insert-line"` on an empty/whitespace-only textarea is consumed by the keydown handler but no-ops in `send`, an empty plain Enter SHALL be a **full no-op**: no local newline appears and nothing is sent. Shift+Enter stays the only local multi-line compose; Escape-blur, the readline layer (`handleReadlineKey` before Enter classification), focus contract, drafts store, and uploads SHALL be untouched.

- **GIVEN** the strip textarea contains `"marker"`
- **WHEN** plain Enter is pressed
- **THEN** `"marker\n"` is sent to the focused pane and the textarea clears (no local newline)

- **GIVEN** the strip textarea is empty
- **WHEN** plain Enter is pressed
- **THEN** the keydown is consumed (no newline appears in the textarea) and nothing is sent

- **GIVEN** the strip textarea contains text
- **WHEN** Shift+Enter is pressed
- **THEN** the textarea inserts a local newline and nothing is sent

#### R4: Buttons — Insert follows Enter; Send mirrors its chord including empty
The Insert button SHALL fire `send("insert-line")` and stay disabled when there is no target or the text is empty/whitespace-only (following Enter's empty no-op). The Send button SHALL fire `send("submit")` and be enabled whenever a target exists (`hasTarget`) — an empty click sends bare `"\r"`, mirroring the Cmd/Ctrl+Enter chord (the shared `canSend` splits into per-button conditions). Alt+Enter remains the chord-only byte-exact raw insert.

- **GIVEN** a focused target and an empty textarea
- **WHEN** the strip renders
- **THEN** Insert is disabled and Send is enabled
- **AND** clicking Send sends bare `"\r"`

- **GIVEN** a focused target and text `"via button"`
- **WHEN** the Insert button is clicked
- **THEN** `"via button\n"` is sent and the draft clears

#### R5: Tooltips + `enterKeyHint="send"`
The Insert tip SHALL reflect insert-line semantics with `kbd="Enter"`, keeping the Alt+Enter raw-insert chord discoverable in the tip's label text. The Send tip SHALL stay `composeSubmitKeycap()`. The textarea's `enterKeyHint` SHALL become `"send"`, with the "truthful hint" comment updated (Enter now transmits to the pane and clears the draft). The strip's header doc comment and onKeyDown comment SHALL be rewritten per R1's divergence rationale.

- **GIVEN** the strip is rendered
- **WHEN** the textarea attribute is inspected
- **THEN** `enterkeyhint` is `"send"`
- **AND** the Insert tip's kbd chip reads `Enter` while its label still names the Alt+Enter raw-insert chord

### Chat View: Signature-only + docs

#### R6: Chat behavior unchanged; declares `surface: "chat"`; docs rewritten
`ChatSendForm` (`app/frontend/src/components/chat-view.tsx`) SHALL pass `surface: "chat"` to the classifier and keep behavior byte-identical: Enter/Shift+Enter local newline, Cmd/Ctrl+Enter submit, Alt+Enter `submit:false`, empty never sends (chat's empty-Cmd+Enter does NOT gain a bare-Enter path), `enterKeyHint="enter"`, tips unchanged. Its doc comments (ChatSendForm doc + keydown comment) SHALL be rewritten from "the two surfaces cannot diverge" to the deliberate, visibility-motivated divergence.

- **GIVEN** the chat send textarea contains text
- **WHEN** plain Enter is pressed
- **THEN** no send fires and the textarea keeps its text (local newline via default behavior)
- **AND** Cmd/Ctrl+Enter still submits, Alt+Enter still sends `submit:false`, empty Cmd/Ctrl+Enter is still a no-op

### Tests

#### R7: Unit tests cover the new matrix and strip behaviors
`compose-keys.test.ts` SHALL exercise the surface-parameterized matrix per R1 (plain Enter → `"insert-line"` on strip / `"default"` on chat; Shift+Enter default on both; meta/ctrl submit on both; alt insert on both; IME + non-Enter default on both; precedence meta/ctrl > alt > shift/plain); `composeSubmitKeycap` tests unchanged. `compose-strip.test.tsx` SHALL cover: plain Enter sends `text + "\n"` and clears the target's draft; empty Enter is a full no-op (nothing sent, keydown consumed, no draft change); empty and whitespace-only Cmd/Ctrl+Enter send bare `"\r"`; Alt+Enter still raw (no trailing byte); the Insert button sends `text + "\n"`; the Send button is enabled on empty with a target and disabled without one; `enterkeyhint` is `"send"`; guard-blocked/draft-preservation behavior with the new payloads. `chat-view.test.tsx` SHALL keep passing against the new classifier signature with stale shared-policy comments updated.

- **GIVEN** the updated unit suites
- **WHEN** `just test-frontend` runs
- **THEN** all frontend unit tests pass

#### R8: E2E flows + sibling `.spec.md` updated in the same change
`app/frontend/tests/e2e/compose-strip.spec.ts` SHALL rework the Enter-flow test (Enter now transmits `text + "\n"`; empty Enter no-op) and the Insert-flow test (Insert button = insert-line; Alt+Enter is the raw-insert chord), assert `enterkeyhint="send"`, and add the stage-then-submit loop (Alt+Enter raw staging → empty Cmd/Ctrl+Enter bare `"\r"` commits the staged line). The sibling `compose-strip.spec.md` MUST be updated in the same change (constitution: Test Companion Docs). `chat-view.spec.ts`/`.spec.md` SHALL be checked for stale prose asserting the surfaces share one Enter policy and updated only if such prose exists (behavioral assertions unchanged).

- **GIVEN** the reworked e2e spec
- **WHEN** `just test-e2e compose-strip` runs
- **THEN** the compose-strip flows pass end-to-end against the `cat` pane

### Non-Goals

- Chat's empty-Cmd+Enter "press Enter in the pane" — a backend feature (POST /chat/send is probe-gated); surfaced in the intake's Open Questions as a post-ship follow-up.
- Any change to `lib/readline-keys.ts`, the chat-send backend path, the keybinding registry, bottom bar, or board twin wiring.
- A preference toggle for the Enter policy — one defensible default per surface.

## Tasks

### Phase 2: Core Implementation

- [x] T001 Rewrite `app/frontend/src/lib/compose-keys.ts`: add required `surface: "strip" | "chat"` param to `classifyComposeEnter`, add `"insert-line"` to `ComposeEnterAction`, implement per-surface plain-Enter branch, rewrite the header doc comment (deliberate divergence + visibility rationale); keep `composeSubmitKeycap()` untouched <!-- R1 -->
- [x] T002 Rewrite the `classifyComposeEnter` matrix in `app/frontend/src/lib/compose-keys.test.ts`, surface-parameterized per R1 (both surfaces × plain/shift/meta/ctrl/alt/IME/non-Enter + precedence); keep `composeSubmitKeycap` tests unchanged <!-- R7 -->
- [x] T003 Rework `app/frontend/src/components/compose-strip.tsx`: mode-based `send("submit"|"insert"|"insert-line")` with per-mode payloads + empty-submit bare `"\r"` (R2), onKeyDown passes `surface:"strip"` and routes non-default actions to `send(action)` (R3), Insert button → `send("insert-line")` / Send button enabled on `hasTarget` (R4), Insert tip label + `kbd="Enter"` + `enterKeyHint="send"` (R5), rewrite header/onKeyDown/send comments incl. the terminal-conventional `"\n"` caveat <!-- R2 -->
- [x] T004 Update `app/frontend/src/components/compose-strip.test.tsx` for the new strip behaviors per R7: Enter=insert-line + clear, empty-Enter full no-op, empty/whitespace Cmd/Ctrl+Enter bare `"\r"`, Alt+Enter raw, Insert button `+ "\n"`, Send enabled-on-empty split, `enterkeyhint="send"`, guard-blocked payload updates <!-- R7 -->
- [x] T005 [P] Update `app/frontend/src/components/chat-view.tsx`: pass `surface: "chat"` in `ChatSendForm`'s keydown; rewrite the ChatSendForm doc + keydown comments to the deliberate-divergence framing; no behavior change <!-- R6 -->
- [x] T006 [P] Verify `app/frontend/src/components/chat-view.test.tsx` passes against the new signature; update comments that claim the two surfaces share one Enter policy <!-- R7 -->
- [x] T007 Run `just test-frontend` and fix any failures <!-- R7 -->

### Phase 3: Integration & Edge Cases (e2e)

- [x] T008 Rework `app/frontend/tests/e2e/compose-strip.spec.ts`: Enter-flow test (Enter transmits `text + "\n"` to the `cat` pane, empty-Enter no-op, Cmd/Ctrl+Enter still submits, Escape blurs), Insert-flow test (Insert button = insert-line/commits; Alt+Enter = raw staging, appears once), `enterkeyhint="send"` assertion, and the stage-then-submit loop (Alt+Enter staging → empty Cmd/Ctrl+Enter bare `"\r"` commits the staged line) <!-- R8 -->
- [x] T009 Update the sibling `app/frontend/tests/e2e/compose-strip.spec.md` to mirror every reworked/added test (what it proves + steps) in the same change <!-- R8 -->
- [x] T010 [P] Check `app/frontend/tests/e2e/chat-view.spec.ts` + `.spec.md` for prose asserting a shared Enter policy across surfaces; update only if found (no behavioral changes) <!-- R8 -->
- [x] T011 Run `just test-e2e compose-strip` (and `chat-view` if its spec changed) and fix any failures <!-- R8 -->

## Execution Order

- T001 blocks T002, T003, T005 (classifier signature first)
- T003 blocks T004, T008
- T007 gates entry to Phase 3; T008–T009 land together (companion-doc rule); T011 last

## Acceptance

### Functional Completeness

- [x] A-001 R1: `classifyComposeEnter(key, surface)` requires the surface argument, returns `"insert-line"` only for strip plain Enter, `"default"` for chat plain Enter, and keeps meta/ctrl→submit, alt→insert, shift/IME/non-Enter→default on both surfaces
- [x] A-002 R2: The strip's send path delivers `text + "\n"` for insert-line, byte-exact `text` for insert, `text + "\r"` for submit, and bare `"\r"` for an empty/whitespace-only submit
- [x] A-003 R3: Plain Enter in the strip transmits and clears the draft; empty Enter is a full no-op (consumed, nothing sent, no local newline); Shift+Enter remains a local newline
- [x] A-004 R4: The Insert button sends `text + "\n"` and is disabled on empty; the Send button is enabled whenever a target exists and an empty click sends bare `"\r"`
- [x] A-005 R5: The strip textarea carries `enterkeyhint="send"`; the Insert tip shows `kbd="Enter"` with the Alt+Enter raw-insert chord still discoverable; the Send tip keeps `composeSubmitKeycap()`
- [x] A-006 R6: Chat behavior is byte-identical (Enter=newline, Cmd/Ctrl+Enter=submit, Alt+Enter=`submit:false`, empty never sends, `enterKeyHint="enter"`), now declared via `surface: "chat"`

### Behavioral Correctness

- [x] A-007 R2: A guard-blocked send (no target / stream not OPEN) still early-returns without clearing in every mode; clear-on-delivery holds for delivered sends
- [x] A-008 R1: The doc comments in `compose-keys.ts`, `compose-strip.tsx`, and `chat-view.tsx` no longer claim the surfaces cannot diverge — they state the deliberate, visibility-motivated per-surface divergence

### Scenario Coverage

- [x] A-009 R7: `just test-frontend` passes with the rewritten `compose-keys.test.ts` matrix, updated `compose-strip.test.tsx` behaviors, and passing `chat-view.test.tsx` — verified at review: 120 files / 2190 tests passed
- [x] A-010 R8: `just test-e2e compose-strip` passes with the reworked Enter/Insert flows, the `enterkeyhint="send"` assertion, and the stage-then-submit loop (staged text committed by an empty Cmd/Ctrl+Enter bare `"\r"`) — verified at review: 6/6 passed

### Edge Cases & Error Handling

- [x] A-011 R2: Whitespace-only text under Cmd/Ctrl+Enter sends bare `"\r"` (whitespace discarded, draft cleared); whitespace-only Enter and Alt+Enter remain no-ops
- [x] A-012 R3: An IME-composing Enter is never intercepted on either surface (unchanged)

### Code Quality

- [x] A-013 Pattern consistency: New code follows the existing pure-classifier / component conventions (type narrowing, no `as` casts, named constants) — `send` reuses the action union via `Exclude<ComposeEnterAction, "default">`, no casts added, `tsc --noEmit` clean
- [x] A-014 No unnecessary duplication: The single classifier remains the sole Enter-policy authority for both surfaces; no per-surface policy forks outside it — both call sites pass a literal surface and branch only on the returned action
- [x] A-015 Test companion docs: `compose-strip.spec.md` mirrors the updated `compose-strip.spec.ts` in the same change (constitution Test Companion Docs) — all 6 test titles match 1:1

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- `app/frontend/src/components/compose-strip.tsx:396` `canInsert` — if the Insert button's empty-disabled rule is ever reconciled with Send's `hasTarget`-only rule, this second per-button condition collapses back into one flag; keep for now (the split is the deliberate R4 behavior).
- No other candidates — this change revises an existing policy in place. The old `send(submit: boolean)` signature, the shared `canSend` flag, and the `"Insert without submitting"` tip copy were all replaced rather than left behind (verified: no `canSend` reference remains in `compose-strip.tsx`).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | `send`'s mode type is `Exclude<ComposeEnterAction, "default">` — the keydown handler passes the classifier action straight through (`send(action)`), buttons pass literals | Intake leaves the exact shape to apply; reusing the action union keeps one vocabulary and makes the keydown routing a direct pass-through | S:70 R:90 A:90 D:80 |
| 2 | Confident | Insert tip copy: `label="Insert line (Alt+Enter: raw insert)"`, `kbd="Enter"` — the Alt+Enter chord stays discoverable inside the tip label, no native `title` (titles were retired for Tip chips in the current pattern) | Intake row 13 leaves wording to apply and asks the chord to survive "in the tip or title"; a native title would double-bubble against the styled Tip | S:55 R:95 A:75 D:60 |
| 3 | Confident | A delivered empty/whitespace-only submit clears the draft uniformly (whitespace + any stranded attachments) via the existing `clearComposeDraft` path | Intake Assumption 11 says whitespace-only is cleared; one uniform clear-on-delivery path avoids a special case for the rare empty-text-with-attachments draft | S:50 R:90 A:75 D:65 |
| 4 | Confident | The e2e stage-then-submit loop stages via Alt+Enter (raw, appears once in `cat`) then commits with an empty Cmd/Ctrl+Enter — proving the bare `"\r"`; plain-Enter staging cannot be shown as "staged" on a `cat` pane because `"\n"` commits there (terminal-conventional, per R2's documented semantics) | The intake's loop description targets agent composers (Claude Code); on the e2e `cat` fixture the raw-insert + bare-`"\r"` pair is the observable equivalent that proves the same wire bytes | S:60 R:85 A:80 D:70 |

4 assumptions (1 certain, 3 confident, 0 tentative).
