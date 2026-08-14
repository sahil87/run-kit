# Plan: Mobile Compose Strip — Coarse-Pointer Collapse + Local-Newline Chip

**Change**: 260814-ink6-mobile-compose-collapse-newline-chip
**Intake**: `intake.md`

## Requirements

### Compose Strip: Coarse-Pointer Presentation Collapse

#### R1: Bottom bar hides while the compose textarea is focused (coarse only)
While the compose strip's textarea has focus on a coarse pointer, the bottom-bar key row SHALL not render; it SHALL return on blur. Fine-pointer rendering MUST be unchanged. The hide MUST work identically at both footer mounts (AppShell `app.tsx` and `board/board-page.tsx`).

- **GIVEN** a coarse-pointer viewport with the compose strip open
- **WHEN** the strip's textarea gains focus
- **THEN** the bottom bar disappears (footer height shrinks; the terminal's ResizeObserver refits)
- **AND** blurring the textarea (Escape, tapping the terminal) restores the bar

- **GIVEN** a fine-pointer viewport
- **WHEN** the strip's textarea gains focus
- **THEN** the bottom bar renders exactly as today

#### R2: Header row folds away on coarse when it carries no unique signal
On coarse pointers in normal terminal-target mode, the `→ {target}` header row (including its × close) SHALL NOT render; the target name SHALL move into the textarea placeholder (`→ {name}…`). The header row MUST render as today whenever it carries real signal: selection-broadcast mode (`→ N selected`, `Uploading…`, ×) and the disabled no-target state. Fine pointers keep the header row unconditionally.

- **GIVEN** coarse pointer, a focused terminal target
- **WHEN** the strip renders
- **THEN** no header row is present and the placeholder reads `→ {window-name}…`
- **AND** the uploading status, when active, still surfaces (relocated with the button row, not dropped)

- **GIVEN** coarse pointer, selection-broadcast mode OR `focused === null`
- **WHEN** the strip renders
- **THEN** the header row renders exactly as on fine pointers

#### R3: Single coarse row — 📎 · textarea (flex-1) · ⏎ · Send
On coarse pointers the two-row stack SHALL collapse to one flex row: the 📎 attach chip, the textarea at `flex-1`, the ⏎ chip (R5), and Send. The Insert button SHALL NOT render on coarse (plain Enter already performs insert-line there; `enterKeyHint` stays `"send"`). Flanking chips SHALL bottom-align (`items-end`) so a grown textarea rises above them. Existing affordances carry over: `preventFocusSteal` on every chip, coarse touch-target sizing, enablement rules (`canUpload`, `canSubmit` — including #592's empty-composer bare-`\r` Send with the neutral secondary face). The fine-pointer two-row stack (260724-2bmy) stays byte-identical.

- **GIVEN** coarse pointer, terminal target
- **WHEN** the strip renders
- **THEN** one row renders 📎, textarea, ⏎, Send — and no Insert button
- **AND** on fine pointers the two-row stack renders with Insert present, unchanged

#### R4: `rows={1}` floor on coarse
The textarea's `rows` attribute SHALL be 1 on coarse pointers and stay 2 on fine pointers. Bounded auto-grow (`MAX_TEXTAREA_ROWS = 6`) is unchanged; the floor follows the `rows` attribute by construction.

- **GIVEN** coarse pointer, empty composer
- **WHEN** the strip opens
- **THEN** the textarea is one line tall, grows with content to 6 rows, and settles back to one row when emptied

#### R5: Coarse-only ⏎ chip inserts a local newline (Shift+Enter equivalent)
A ⏎ chip SHALL render between the textarea and Send on coarse pointers only, inserting `"\n"` at the caret. Requirements: undo-safe insertion (`document.execCommand("insertText", …)` with the `readline-keys.ts` prototype-setter + bubbled-`input` fallback); the insertion ends any sent-history recall walk (`endRecall()` — same exit rule as other non-recall text mutations); `preventFocusSteal` on `onMouseDown`; coarse touch-target sizing, secondary-button vocabulary, `aria-label` and `data-testid`; enabled whenever the textarea is usable (no text/target gating beyond the disabled no-target state). The chip SHALL be hidden in selection-broadcast mode (plain Enter is already a local newline there). `classifyComposeEnter` and `enterKeyHint` MUST be untouched.

- **GIVEN** coarse pointer, text `abc` with caret after `b`
- **WHEN** the ⏎ chip is tapped
- **THEN** the draft becomes `ab\nc`, the caret sits after the newline, the textarea keeps focus and auto-grows, and any recall walk has ended

- **GIVEN** selection-broadcast mode on coarse
- **WHEN** the strip renders
- **THEN** no ⏎ chip is present

#### R6: Test coverage
Colocated Vitest coverage SHALL exercise the coarse/fine split (`compose-strip.test.tsx`: header fold + must-return modes, single row without Insert, `rows` floor, ⏎ insertion incl. the execCommand fallback and recall-walk exit; `bottom-bar.test.tsx`: hide-on-compose-focus, coarse-gated). Playwright e2e coverage SHOULD be added where coarse-pointer emulation permits, with the sibling `.spec.md` updated in the same commit (constitution: Test Companion Docs).

- **GIVEN** the test suites
- **WHEN** `just test-frontend` runs
- **THEN** the new behaviors above are asserted on both pointer arms

### Non-Goals

- No change to `classifyComposeEnter`, send semantics, the draft/sent-history stores, or any desktop/fine-pointer rendering.
- No coarse Enter-policy flip to chat semantics (rejected in intake — possible future, deliberate intake).
- No new chrome preference, localStorage key, backend, API, or routing changes.

### Design Decisions

#### Compose-focus signal is a module store in `compose-strip-events.ts`, consumed inside `BottomBar`
**Decision**: Add a module-level focus flag with a listener set (`setComposeStripFocused` / `subscribeComposeStripFocus` / `isComposeStripFocused`) to `lib/compose-strip-events.ts`; the strip publishes from the textarea's `onFocus`/`onBlur` (and clears on unmount); `BottomBar` reads it via `useSyncExternalStore` and self-gates.
**Why**: `compose-strip-events.ts` already owns three cross-component module slots between exactly these two components, and `BottomBar` already imports it and `useCoarsePointer` — both footer mounts inherit the behavior with zero wiring in `app.tsx`/`board-page.tsx`. Context/chrome-state alternatives add provider plumbing for a transient, never-persisted flag.
**Rejected**: ChromeContext state (persistence machinery for a transient flag; re-renders the whole chrome tree per focus change); per-footer prop threading (two mounts to keep in sync).
*Introduced by*: 260814-ink6-mobile-compose-collapse-newline-chip

#### Bottom bar hides by early-return (unmount), not display-level hiding
**Decision**: `BottomBar` returns `null` when `coarse && composeStripFocused`.
**Why**: Unmount also tears down the armed-modifier capture-phase `keydown` listener, which must not intercept keystrokes typed into the compose textarea; the bar holds no state worth preserving across a compose session (armed modifiers auto-clear by design). Divergence from the right-panel "hide at display level" precedent is deliberate — that panel keeps iframe state; the bar has none.
**Rejected**: `hidden` class (keeps the armed-modifier capture listener alive while composing — an interception hazard, not a benefit).
*Introduced by*: 260814-ink6-mobile-compose-collapse-newline-chip

## Tasks

### Phase 1: Setup

- [x] T001 [P] `app/frontend/src/lib/readline-keys.ts`: export an undo-safe `insertTextAtCaret(el, text)` — `execCommand("insertText", false, text)` guarded like `deleteRange`, with the same prototype-value-setter + bubbled-`input` fallback (extract the shared fallback if cleaner); unit-test both paths in `readline-keys.test.ts` <!-- R5 -->
- [x] T002 [P] `app/frontend/src/lib/compose-strip-events.ts`: add the compose-focus module store (flag + listener set + `useSyncExternalStore`-compatible subscribe/snapshot, mirroring the file's existing slot patterns); unit coverage <!-- R1 -->

### Phase 2: Core Implementation

- [x] T003 `app/frontend/src/components/compose-strip.tsx`: publish focus state — textarea `onFocus`/`onBlur` → `setComposeStripFocused`, cleared on unmount (a strip toggled off while focused must restore the bar) <!-- R1 -->
- [x] T004 `app/frontend/src/components/bottom-bar.tsx`: self-gate — early-return `null` when `useCoarsePointer()` && compose-focused (via `useSyncExternalStore` over T002); no footer wiring changes <!-- R1 -->
- [x] T005 `app/frontend/src/components/compose-strip.tsx`: coarse header fold — suppress the header row in coarse normal mode, fold the target into the placeholder (`→ {name}…`), keep it rendering in selection-broadcast and no-target modes; relocate the `Uploading…` status into the visible row on coarse <!-- R2 -->
- [x] T006 `app/frontend/src/components/compose-strip.tsx`: coarse single-row layout — 📎 · textarea (`flex-1`) · ⏎ · Send with `items-end`, Insert omitted on coarse, `rows={coarse ? 1 : 2}`; fine-pointer two-row stack byte-identical <!-- R3, R4 -->
- [x] T007 `app/frontend/src/components/compose-strip.tsx`: ⏎ chip — coarse-only, hidden in selection-broadcast; `insertTextAtCaret(textarea, "\n")` + `endRecall()` + store write-through; `preventFocusSteal`, touch sizing, `aria-label="Insert newline"`, `data-testid="compose-strip-newline"` <!-- R5 -->

### Phase 3: Integration & Edge Cases

- [x] T008 `app/frontend/src/components/compose-strip.test.tsx` + `bottom-bar.test.tsx`: Vitest coverage per R6 (coarse/fine split via the existing `useCoarsePointer` mock seam; header must-return modes; ⏎ insertion, fallback path, recall-walk exit; bar hide/restore incl. unmount-clears-flag) <!-- R6 -->
- [x] T009 `app/frontend/tests/e2e/compose-strip.spec.ts` + sibling `.spec.md`: coarse-pointer e2e where emulation permits (touch device descriptor); update `.spec.md` in the same commit; verify fine-pointer specs still pass untouched <!-- R6 -->

## Execution Order

- T001 and T002 are independent `[P]`.
- T003→T004 (store publish before consumer), T005→T006→T007 sequential edits to one file; T007 depends on T001.
- T008/T009 last.

## Acceptance

### Functional Completeness

- [x] A-001 R1: On coarse pointers the bottom bar is absent exactly while the compose textarea is focused, at both footer mounts, and present otherwise
- [x] A-002 R2: Coarse normal mode renders no header row and a `→ {name}…` placeholder; broadcast and no-target modes render the header as on fine pointers
- [x] A-003 R3: Coarse renders one row (📎, textarea flex-1, ⏎, Send) with no Insert; fine keeps the two-row stack with Insert, byte-identical
- [x] A-004 R4: Textarea `rows` is 1 on coarse, 2 on fine; auto-grow bound (6) and settle-back behavior unchanged
- [x] A-005 R5: ⏎ inserts `\n` at the caret undo-safely, keeps focus, persists through the draft store, ends any recall walk, and is absent in selection-broadcast mode

### Behavioral Correctness

- [x] A-006 R1: Blur (Escape, terminal tap) and strip unmount both restore the bar; the flag can never stick hidden
- [x] A-007 R5: `classifyComposeEnter`, `enterKeyHint`, and all send payloads are byte-untouched (no classifier or send-path diffs)
- [x] A-008 R3: Enablement carries over — 📎 `canUpload`, Send `canSubmit` including the #592 empty-composer bare-`\r` case with its neutral face

### Scenario Coverage

- [x] A-009 R6: Vitest covers both pointer arms for every renamed/moved affordance; e2e (or a recorded N/A with reason) covers the coarse flow
- [x] A-010 R6: `.spec.md` sibling updated in the same commit as any `.spec.ts` change

### Edge Cases & Error Handling

- [x] A-011 R1: Fine-pointer rendering has zero diffs (bar never hides; header always renders; Insert present; rows=2)
- [x] A-012 R5: ⏎ on the disabled no-target strip is impossible (textarea disabled ⇒ chip disabled or inert); ⏎ with empty text inserts a bare newline (a local edit — legal, transmits nothing)

### Code Quality

- [x] A-013 Pattern consistency: module-slot store matches `compose-strip-events.ts` conventions; coarse gating uses `useCoarsePointer()`; no `as` casts on new code
- [x] A-014 No unnecessary duplication: newline insertion reuses/extends the `readline-keys.ts` undo-safe edit path rather than reimplementing it
- [x] A-015 No client polling introduced; no new chrome preference or storage key

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`
- Refit-churn watch (intake assumption 10): focus/blur-driven bar hide triggers `fitAndSync` per focus change — same reflow class as toggling the strip; verify against a busy pane during apply/review, no debounce up front.

## Deletion Candidates

- None — this change adds new functionality without making existing code redundant. The coarse `Compose text…` placeholder string was rewritten in place (not orphaned), the old inline JSX became the shared element descriptors referenced by both pointer branches, and Insert survives on fine pointers.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Focus-signal seam = module store in `compose-strip-events.ts`, consumed inside `BottomBar` (no footer wiring) | Intake left the seam apply-time; this file already owns three module slots between exactly these two components and BottomBar imports it today | S:70 R:90 A:85 D:75 |
| 2 | Confident | Bar hides by early-return (unmount), not `hidden` class | Unmount tears down the armed-modifier capture listener that would otherwise intercept compose keystrokes; the bar holds no state worth preserving | S:60 R:90 A:80 D:70 |
| 3 | Certain | ⏎ chip hidden (not disabled) in selection-broadcast mode | Intake assumption 8; broadcast's plain Enter is already a local newline | S:70 R:90 A:85 D:80 |
| 4 | Confident | Coarse placeholder format `→ {name}…` replaces the coarse `Compose text…` string only; fine-pointer education placeholder untouched | Placeholder strings already fork on `coarsePointer`; the target label layering (store name → registrant name → windowId) is reused verbatim | S:75 R:95 A:90 D:80 |
| 5 | Confident | e2e coarse coverage attempted via touch-enabled device descriptor; downgraded to a recorded N/A if `pointer: coarse` emulation proves unreliable under the shared test server | Playwright device descriptors set pointer/touch media features, but the suite's shared config may constrain per-spec device overrides | S:55 R:85 A:70 D:65 |
| 6 | Confident | The relocated coarse `Uploading…` status sits immediately left of Send in the single row | T005 requires relocation without a specified slot; Send-adjacent mirrors the header's uploading-left-of-× grouping | S:65 R:90 A:80 D:65 |
| 7 | Certain | The ⏎ chip's store write-through and recall-walk exit ride the bubbled `input` event → the existing `onChange` (no direct `setComposeText`/`endRecall` call in the chip handler) | Same path as typed text and the readline fallback — the walk-exit rule stays in one place | S:75 R:90 A:85 D:80 |
| 8 | Confident | The coarse/fine layout fork reuses single element descriptors (`textareaEl`, `attachChip`, `sendChip`, …) referenced from both branches rather than duplicating JSX | Exactly one branch renders per pointer type; the fine DOM is unchanged, and each control's props live in one place | S:70 R:90 A:80 D:70 |
| 9 | Certain | The focus publish effect SYNCS from `document.activeElement` at mount (declared after focus-on-open), not just onFocus/onBlur + unmount-clear | e2e/dev run under `<StrictMode>`: the effect replay clears the flag after focus-on-open focused the textarea, and no new focus event fires — found by the first e2e run; pinned by a StrictMode unit test | S:85 R:85 A:90 D:85 |

9 assumptions (3 certain, 6 confident, 0 tentative).
