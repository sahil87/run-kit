# Plan: Compose Enter Policy Flip + Readline Keys

**Change**: 260801-hsxm-compose-enter-policy-readline-keys
**Intake**: `intake.md`

## Requirements

### Frontend: Enter Policy (shared classifier)

#### R1: `classifyComposeEnter` flips to Enter=newline / Cmd-Ctrl+Enter=submit on all pointer types
`classifyComposeEnter` (`app/frontend/src/lib/compose-keys.ts`) SHALL classify: plain **Enter** → `"default"` (textarea newline) on ALL pointer types; **Shift+Enter** → `"default"` (kept for muscle memory, now redundant); **Cmd/Ctrl+Enter** → `"submit"` (the ONLY submit chord); **Alt+Enter** → `"insert"` (unchanged); IME-composing Enter → `"default"` (unchanged guard). The `coarse` parameter SHALL be removed from the signature (the pointer distinction existed solely to serve the old Enter-submits policy), and both call sites updated. Precedence: non-Enter/IME → default; meta/ctrl → submit; alt → insert; else → default.

- **GIVEN** a plain Enter keydown (no modifiers) on a fine OR coarse pointer
- **WHEN** the classifier runs
- **THEN** it returns `"default"` and the textarea inserts a newline (no send fires)
- **AND** a Cmd+Enter or Ctrl+Enter keydown returns `"submit"`; an Alt+Enter returns `"insert"`; Shift+Enter and IME-composing Enter return `"default"`.

#### R2: Compose strip surface reflects the flip
The compose strip (`app/frontend/src/components/compose-strip.tsx`) SHALL set `enterKeyHint="enter"` unconditionally (the hint must stay truthful — Enter now always inserts a newline), change the Send button's `Tip` keycap from `kbd="Enter"` to the platform-formatted submit chord (`⌘Enter` on mac, `Ctrl+Enter` elsewhere — the PR #506 keycap conventions, via one shared helper so the two surfaces render the identical chip), keep the Insert tip (`Alt+Enter`) unchanged, and drop its `useCoarsePointer()` subscription entirely (its only roles in this file were the Enter policy and the hint). Doc comments describing the old pointer-aware policy SHALL be rewritten.

- **GIVEN** the compose strip rendered on any pointer type
- **WHEN** the textarea and Send tooltip render
- **THEN** the textarea carries `enterkeyhint="enter"` and the Send tip keycap shows the platform-formatted Cmd/Ctrl+Enter chord (never bare `Enter`).

#### R3: Chat send form flips identically via the shared classifier
The chat send form (`ChatSendForm` in `app/frontend/src/components/chat-view.tsx`) SHALL flip via the SAME shared classifier (user-confirmed: both surfaces flip), with the same `enterKeyHint="enter"` and the same platform-formatted Send-tip keycap. `useCoarsePointer()` SHALL remain in `ChatSendForm` ONLY for the coarse-pointer autofocus skip (its Enter-policy role ends); the "two surfaces must not diverge" doc comments stay true and are updated to the new policy.

- **GIVEN** the chat lens send form with typed text on a fine pointer
- **WHEN** the user presses plain Enter
- **THEN** no POST fires and the textarea gains a newline; **AND WHEN** the user presses Cmd/Ctrl+Enter, **THEN** exactly one POST fires (default submit shape `{text}`), clearing the input on success
- **AND** on a coarse pointer the mount autofocus is still skipped.

### Frontend: Readline Key Layer

#### R4: Shared readline helper intercepts ONLY the natively-missing chords
A new pure, unit-testable helper module (`app/frontend/src/lib/readline-keys.ts`, the `palette-move.ts` extraction pattern) SHALL intercept exactly: **Ctrl+U** (kill from cursor to line start — readline unix-line-discard), **Ctrl+W** (delete word backward), **Alt+B / Alt+F** (move cursor word backward / forward), **Alt+D** (delete word forward). Constraints:
- Chords match on `KeyboardEvent.code` (`KeyU`/`KeyW`/`KeyB`/`KeyF`/`KeyD`), NOT `key` — on macOS Alt+B/F/D produce `∫`/`ƒ`/`∂` in `key`.
- Exact-modifier matching: Ctrl chords require no Meta/Alt/Shift; Alt chords require no Ctrl/Meta/Shift. IME-composing keydowns are never intercepted. Natively-bound macOS chords (Ctrl+A/E/B/F/P/N/D/H/K/T/O/Y, Opt+arrows, Opt+Delete) are NOT intercepted — none of them match the five-chord set.
- Word boundaries are whitespace-delimited (readline default), not camelCase-aware.
- Deletions go through undo-preserving editing — `document.execCommand("delete")` after `setSelectionRange` — with a controlled-component-safe fallback (native value setter + bubbled `input` event) when `execCommand` is unavailable or reports failure (jsdom, future removals). Motions use `setSelectionRange` only.
- Handled chords call `e.preventDefault()` + `e.stopPropagation()` (mirrors the existing Enter/Escape handling). An empty edit range (e.g. Ctrl+U with the cursor at line start) still consumes the chord but performs no edit (a collapsed-selection `execCommand("delete")` would eat a character).
- Platform caveat documented in the module: Ctrl+W is browser-reserved on win/linux browsers (uninterceptable); it works on macOS and the desktop shell.

- **GIVEN** a textarea with value `"one two three"` and the cursor at the end
- **WHEN** Ctrl+W fires
- **THEN** the value becomes `"one two "` with the cursor at the end, the chord is default-prevented, and (in a real browser) the edit is native-undoable
- **AND GIVEN** the cursor mid-text, Alt+B moves it to the current/previous word start and Alt+F to the next word end without changing the value; Ctrl+U removes from line start to cursor; Alt+D removes from cursor to next word end
- **AND GIVEN** a natively-bound chord (e.g. Ctrl+A) or a shifted/meta variant, the helper returns unhandled and the event proceeds natively.

#### R5: Both surfaces wire the readline layer into their textarea keydown
Both the compose strip textarea and the chat send input SHALL route keydown through the shared `handleReadlineKey` (before Enter classification; after the strip's Escape branch) — the consistency mirror of the shared Enter classifier. Conflict safety holds per the intake's verification: app chords are suppressed while a textarea has focus (`shouldSuppressChord`), the `ignoreInputs` punch-through set (⌘K, ⇧⌘E, ⇧⌘/, ⇧⌘,) does not collide, and Alt chords are excluded from every registry tier.

- **GIVEN** either surface's textarea focused with text
- **WHEN** one of the five chords fires
- **THEN** the shared helper edits/moves in that textarea (React state stays in sync via the fired `input` event on deletions) and the event never reaches global chord listeners.

### Tests & Companion Docs

#### R6: Test matrix and e2e send flows updated; `.spec.md` siblings in the same change
`compose-keys.test.ts` SHALL be rewritten for the new Enter matrix (no `coarse` parameter); new unit coverage SHALL exercise the readline helper's classification + cursor/selection math + textarea application; `compose-strip.test.tsx` and `chat-view.test.tsx` SHALL update Enter-behavior and `enterKeyHint` assertions and add readline wiring coverage; `tests/e2e/compose-strip.spec.ts` and `tests/e2e/chat-view.spec.ts` SHALL update send-flow steps to Cmd/Ctrl+Enter and the `enterkeyhint="enter"` assertion. Per the constitution (Test Companion Docs), the sibling `compose-strip.spec.md` and `chat-view.spec.md` MUST be updated in the same commit.

- **GIVEN** the frontend unit suite and the two e2e specs
- **WHEN** `just test-frontend` and the compose-strip/chat-view e2e specs run
- **THEN** all pass under the new policy, and each modified `.spec.ts` has its sibling `.spec.md` updated to match.

### Non-Goals

- No per-surface Enter-policy fork — the shared classifier remains the single policy point.
- No reimplementation of natively-working macOS editing chords (would break the Cocoa kill-buffer interplay, e.g. Ctrl+K↔Ctrl+Y).
- No kill-ring: the layer deletes; it does not feed the native yank buffer.
- No workaround for browser-reserved Ctrl+W on win/linux web (documented caveat only).
- No backend/API/route changes — frontend keydown layer only.

## Tasks

### Phase 1: Core Libraries

- [x] T001 Flip `classifyComposeEnter` in `app/frontend/src/lib/compose-keys.ts`: remove the `coarse` parameter, new precedence (non-Enter/IME → default; meta/ctrl → submit; alt → insert; else → default), rewrite the module/function docstrings; add a shared `composeSubmitKeycap()` helper returning the platform-formatted submit chord via `formatCombo({code:"Enter",tier:"cmd"}, detectPlatform())` <!-- R1 -->
- [x] T002 [P] Create `app/frontend/src/lib/readline-keys.ts`: `classifyReadlineKey` (code-based, exact-modifier, IME-guarded), pure `wordLeft`/`wordRight`/`lineStart` + range derivation, and `handleReadlineKey(e, el)` applier (motions via `setSelectionRange`; deletions via `execCommand("delete")` with the controlled-component-safe fallback; preventDefault+stopPropagation; empty-range no-edit guard; Ctrl+W platform caveat documented) <!-- R4 -->

### Phase 2: Surfaces

- [x] T003 Update `app/frontend/src/components/compose-strip.tsx`: classifier call without `coarse`, `enterKeyHint="enter"` unconditional, Send `Tip` keycap → `composeSubmitKeycap()`, remove the `useCoarsePointer` import/subscription, wire `handleReadlineKey` into `onKeyDown` (after Escape, before Enter classification), rewrite the policy doc comments <!-- R2 -->
- [x] T004 Update `app/frontend/src/components/chat-view.tsx` (`ChatSendForm`): same classifier/hint/keycap/readline-wiring updates; keep `useCoarsePointer` solely for the autofocus skip (comment updated); rewrite policy doc comments; also refresh the stale Enter-policy note in `app/frontend/src/hooks/use-coarse-pointer.ts` <!-- R3, R5 -->

### Phase 3: Tests & Companion Docs

- [x] T005 [P] Rewrite `app/frontend/src/lib/compose-keys.test.ts` for the new matrix (plain Enter/Shift+Enter default everywhere; Cmd/Ctrl+Enter the only submit; Alt+Enter insert; IME + non-Enter guards; precedence) and cover `composeSubmitKeycap` per platform <!-- R1 -->
- [x] T006 [P] Create `app/frontend/src/lib/readline-keys.test.ts`: classification (incl. natively-bound/shifted/meta/IME rejections), word/line math on plain strings, and applier behavior on a jsdom textarea (value+selection outcomes, input-event dispatch, empty-range no-edit, preventDefault) <!-- R4 -->
- [x] T007 Update `app/frontend/src/components/compose-strip.test.tsx`: plain Enter never sends (fine + coarse), Cmd/Ctrl+Enter sends `text+"\r"` and clears, IME guard on the submit chord, guard-blocked/clear-after-send flows via the chord, `enterkeyhint` always `"enter"`, plus a readline wiring test (Ctrl+U edits the strip textarea through React state) <!-- R2, R5 -->
- [x] T008 Update `app/frontend/src/components/chat-view.test.tsx`: same flip for the send form (plain Enter no POST; Cmd/Ctrl+Enter submits/clears; in-flight lock, 409-keeps-text, and keyed-remount tests re-keyed to the chord), `enterkeyhint` always `"enter"`, plus a readline wiring test (Ctrl+W) <!-- R3, R5 -->
- [x] T009 Update `app/frontend/tests/e2e/compose-strip.spec.ts` + sibling `compose-strip.spec.md`: Enter now inserts a newline (no send); Cmd/Ctrl+Enter is the send flow; `enterkeyhint="enter"`; header comments updated <!-- R6 -->
- [x] T010 Update `app/frontend/tests/e2e/chat-view.spec.ts` + sibling `chat-view.spec.md`: send-flow presses become `ControlOrMeta+Enter`; `enterkeyhint="enter"`; add a plain-Enter-does-not-POST assertion <!-- R6 -->
- [x] T011 Run the gates: `just test-frontend` (Vitest), frontend type check, and the two affected e2e specs via `just pw test compose-strip chat-view`; fix failures <!-- R6 -->

## Execution Order

- T001 and T002 are independent [P]; both block Phase 2.
- T003/T004 block T007/T008/T009/T010 (assertions target the updated surfaces).
- T011 runs last.

## Acceptance

### Functional Completeness

- [x] A-001 R1: `classifyComposeEnter` has no `coarse` parameter and returns default for plain/Shift Enter, submit only for meta/ctrl, insert for alt, default for IME/non-Enter — both call sites compile against the new signature
- [x] A-002 R2: Compose strip textarea carries `enterkeyhint="enter"` unconditionally; Send tip keycap is the platform-formatted Cmd/Ctrl+Enter chord; Insert tip unchanged; no `useCoarsePointer` usage remains in `compose-strip.tsx`
- [x] A-003 R3: Chat send form flips identically via the shared classifier; `useCoarsePointer` remains only for the autofocus skip
- [x] A-004 R4: `readline-keys.ts` intercepts exactly Ctrl+U / Ctrl+W / Alt+B / Alt+F / Alt+D by `code`, whitespace-delimited words, undo-preserving deletions with fallback, preventDefault+stopPropagation on handled chords only
- [x] A-005 R5: Both surfaces route keydown through the shared `handleReadlineKey` before Enter classification

### Behavioral Correctness

- [x] A-006 R1: Plain Enter accumulates lines locally in both surfaces (no send/POST); Cmd/Ctrl+Enter is the only keyboard submit
- [x] A-007 R4: Ctrl+U kills to line start (not whole line); Ctrl+W/Alt+D delete words; Alt+B/F move without editing; empty ranges consume the chord without editing; natively-bound/shifted/meta chords pass through untouched

### Scenario Coverage

- [x] A-008 R6: Unit matrix in `compose-keys.test.ts` rewritten; readline helper unit-tested (classification + math + textarea application); component tests cover the flip and readline wiring on both surfaces
- [x] A-009 R6: e2e send flows use Cmd/Ctrl+Enter and assert `enterkeyhint="enter"`; both sibling `.spec.md` files updated in the same change

### Edge Cases & Error Handling

- [x] A-010 R1: IME-composing Enter is never intercepted, with or without modifiers
- [x] A-011 R4: Deletion fallback (execCommand unavailable/false) updates React-controlled state via the native value setter + bubbled input event; guard-blocked sends and drafts behave as before

### Code Quality

- [x] A-012 Pattern consistency: readline helper follows the `palette-move.ts` pure-extraction pattern; keycap formatting reuses `formatCombo`/`detectPlatform` rather than duplicating platform logic
- [x] A-013 No unnecessary duplication: one shared classifier, one shared readline helper, one shared keycap helper across both surfaces
- [ ] A-014 Type narrowing over assertions: structural event/element interfaces; no `as` casts introduced beyond existing test idioms — structural interfaces ✔ (`ReadlineKeyInput`/`ReadlineKeyEvent`), but four unnecessary `as string` assertions were introduced at `readline-keys.ts:98,99,107,108`; `noUncheckedIndexedAccess` is NOT enabled in `app/frontend/tsconfig.json`, so `text[i]` is already `string` — verified `tsc --noEmit` passes cleanly with all four removed

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Send-tip keycap reuses `formatCombo({code:"Enter",tier:"cmd"}, detectPlatform())` via one shared `composeSubmitKeycap()` helper in `compose-keys.ts` | Intake mandates PR #506 keycap conventions; `formatCombo`'s `cmd` tier renders exactly `⌘Enter`/`Ctrl+Enter`; a shared helper preserves the no-divergence contract | S:80 R:90 A:90 D:85 |
| 2 | Confident | Readline chords match on `KeyboardEvent.code`, not `key` | macOS Alt+B/F/D produce `∫`/`ƒ`/`∂` in `key` (stated in the intake); `code` is layout-stable and the registry's own convention | S:75 R:85 A:90 D:85 |
| 3 | Confident | Handled readline chords require exact modifiers (no Shift/Meta); shifted or meta variants pass through natively | Keeps native selection-extending and system chords untouched; intake's do-not-intercept constraint generalized to modifier supersets | S:60 R:85 A:80 D:75 |
| 4 | Confident | With a non-collapsed selection, backward ops key on `selectionStart`, forward ops on `selectionEnd`, and deletions replace the computed range | Readline has no selection concept; a deterministic rule beats undefined behavior; low-stakes (rare interaction) | S:45 R:90 A:75 D:60 |
| 5 | Confident | Deletions try `execCommand("delete")` first and fall back to native-value-setter + bubbled `input` event when unavailable/false | Intake mandates execCommand as the undo-preserving path; jsdom lacks it, and a controlled React textarea needs the input event to sync state — fallback is test/runtime safety, not a policy change | S:65 R:85 A:85 D:75 |
| 6 | Confident | An empty edit range (Ctrl+U at line start, Ctrl+W at pos 0) consumes the chord but performs no edit | `execCommand("delete")` on a collapsed selection deletes one char backward — a real corruption bug; consuming keeps behavior consistent | S:55 R:90 A:90 D:80 |
| 7 | Certain | `useCoarsePointer` is removed from `compose-strip.tsx` entirely; `chat-view.tsx` keeps it solely for the autofocus skip | Direct file inspection: the strip has no other consumer; the chat form's autofocus skip is an existing non-Enter role the intake says to preserve | S:85 R:95 A:95 D:90 |
| 8 | Confident | e2e keeps fine-pointer-only coverage for the new chord flow; readline chords are unit/component-tested, not e2e-tested | Mirrors the existing split (coarse matrix already unit-level); intake's e2e ask is limited to updating send-flow steps | S:60 R:90 A:85 D:75 |

8 assumptions (2 certain, 6 confident, 0 tentative).
