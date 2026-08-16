# Plan: Compose Strip Card Unification

**Change**: 260816-q6hw-compose-strip-card-unification
**Intake**: `intake.md`

## Requirements

### Compose Strip: Card Layout Model

#### R1: One card structure shared by both pointers
When the strip is in card form (per R3/R4 triggers), it SHALL render one bordered card — `bg-bg-card`, rounded, accent border while the textarea is focused — containing, top to bottom: the attachment-preview row (only when files exist), a full-width auto-grow textarea (transparent background, no inner border — the card carries the chrome; `MAX_TEXTAREA_ROWS = 6` cap unchanged), and one quiet chip row (chips borderless / faint-bg inside the card). Send SHALL keep its existing neutral-when-empty / accent-when-text faces and its enabled-when-target rule including the empty bare-`\r` submit. The outer `data-compose-strip` root stays an unstyled box (all card chrome on inner wrappers) so the row-growth/refit mechanic keeps working at both docks.

- **GIVEN** a terminal-target strip with a multi-line draft, on either pointer type
- **WHEN** the strip renders
- **THEN** the textarea spans the full strip width inside one bordered card with the chip row along the card's bottom
- **AND** no chips flank the textarea horizontally

#### R2: Compact single row when there is no draft
When the strip is NOT in card form, it SHALL render a single compact row. Coarse: `📎 · textarea(flex-1, one row) · Send`, placeholder keeps the `→ {name}…` target fold. Fine: `📎 · a| · textarea(flex-1, one row, education placeholder) · Send`; the Insert chip is hidden in the compact state.

- **GIVEN** an empty draft, blurred textarea, no attachments (fine pointer)
- **WHEN** the strip renders
- **THEN** exactly `📎`, `a|`, the one-row textarea, and `Send` render in one row — no header row, no Insert chip

#### R3: Coarse morph trigger — focus, multi-line, or attachments
On coarse pointers the strip SHALL be in card form iff `focused OR multi-line draft OR attachments present`, and compact otherwise. Multi-line detection: the draft contains `\n` OR the one-row textarea's rendered content wraps (scrollHeight above the single-line height — the mock-validated probe).

- **GIVEN** a coarse pointer, compact strip
- **WHEN** the textarea gains focus
- **THEN** the strip morphs to card form (the OS keyboard slide masks the jump)
- **AND** blurring while the draft is empty returns it to compact

#### R4: Fine morph trigger — draft presence with a hysteresis latch, never focus
On fine pointers the card SHALL be entered on draft presence only (first character, or attachments present) — never on focus/blur alone. A hysteresis latch SHALL hold the card through any subsequent edits, including backspacing the draft to empty; the latch releases (card → compact) only on blur while the draft is empty AND no attachments remain. Focus/blur with the latch unchanged SHALL NOT resize the strip.

- **GIVEN** a fine pointer, card form, a draft the user backspaces to empty
- **WHEN** the last character is deleted
- **THEN** the strip stays in card form (no mid-edit snap, no xterm refit)
- **AND** when the textarea then blurs while empty, the strip returns to compact

#### R5: Chip rosters per pointer
The card chip row SHALL be: coarse `📎 · ⏎ · (spacer) · Send`; fine `📎 · a| · (spacer) · Insert · Send`. The `a|` closer chip is REMOVED entirely on coarse (every state — the bottom-bar `a▏` chip, the `View: Text Input` palette action, and ⇧⌘E remain the coarse closers). The ⏎ chip SHALL be hidden while the composer is empty and stays hidden in selection-broadcast mode as today. Coarse chips keep `coarse:min-h-[36px]`/`min-w` touch floors; fine chips keep current sizing.

- **GIVEN** a coarse pointer, any state
- **WHEN** the strip renders
- **THEN** no `a|` chip (`compose-strip-a-close`) exists in the DOM
- **AND** the ⏎ chip renders only when the composer is non-empty in terminal-target mode

#### R6: Header fold on fine at the terminal-target in-tile dock
The `→ {target} · ×` header row SHALL fold on fine pointers when the strip renders at the in-tile dock in terminal-target mode (the tile frame already names the target). The header MUST still render in selection-broadcast mode (`→ N selected`), in the disabled no-target state, and at the fine footer dock (board route / no-tty fallback, where no tile frame names the target). All coarse header rules are unchanged (coarse already folds it).

- **GIVEN** a fine pointer, the strip at the in-tile dock targeting the tile's terminal
- **WHEN** the strip renders
- **THEN** no header row renders
- **AND** the same strip in selection-broadcast mode, or mounted at the shell footer, renders the header as today

#### R7: 2-row floor retired
The textarea SHALL use `rows={1}` on both pointer types; the `rows={coarsePointer ? 1 : 2}` fork and the fine 2-row floor are removed. The bounded auto-grow keeps treating the `rows` box as its floor.

- **GIVEN** a fine pointer, compact state
- **WHEN** the strip renders empty
- **THEN** the textarea is one line tall

#### R8: Uploading indicator moves onto the 📎 chip
The `Uploading…` text (header slot on fine, inline row slot on coarse) SHALL be replaced by a busy state on the 📎 chip itself, on both pointers, that remains accessible as a live status (an element with `role="status"` is preserved — visually attached to or within the chip). While uploading the chip is disabled.

- **GIVEN** an in-flight upload
- **WHEN** the strip renders
- **THEN** the 📎 chip shows a busy treatment and a `role="status"` element reports uploading
- **AND** no standalone `Uploading…` text steals row width

#### R9: Previews inside the card
Attachment previews SHALL render inside the card, above the textarea, on both pointers — replacing the current above-the-row placement. In compact form previews never render (attachments force card form on both pointers per R3/R4).

- **GIVEN** a draft with attachments
- **WHEN** the strip renders
- **THEN** the preview row is the card's first child, above the textarea

#### R10: Test coverage
Unit tests in `compose-strip.test.tsx` SHALL be reworked to the card/compact model, with new coverage for the fine hysteresis latch (type→card, erase-all→still card, blur-empty→compact), the coarse trigger set, chip visibility per pointer/state, and the header-fold scope. The primary e2e spec `tests/e2e/compose-strip.spec.ts` SHALL be updated with its sibling `.spec.md` in the same commit (constitution: Test Companion Docs); `status-bar.spec.ts`, `focus-restore.spec.ts`, `sidebar-multiselect.spec.ts` SHALL be reviewed for selector fallout. Visual verification at 375px and 1024px+ per the Playwright-driven-development workflow.

- **GIVEN** the reworked component
- **WHEN** `just test-frontend` and the compose e2e spec run
- **THEN** all pass, and modified `.spec.ts` files have updated sibling `.spec.md`

### Non-Goals

- Enter policy: `classifyComposeEnter`, the `"strip"`/`"chat"` surface split, Alt+Enter raw insert — untouched.
- Send semantics and payloads (`\r` / `\n` / byte-exact), empty bare-`\r` submit, guard-blocked-send draft preservation — untouched.
- Module draft store (`compose-draft-store.ts`), per-target keys, sent-history recall (↑/↓ walk) — untouched.
- Focus contracts (focus-on-open, no-steal, Escape-blurs), `enterKeyHint` values, focus-memory recording — untouched.
- Bottom-bar hide-while-composing seam (`setComposeStripFocused`) — untouched.
- Selection-broadcast and no-target behavior: header shown, submit-only policy, disabled upload/Insert, delivery-gated clear — unchanged.
- No backend, routing, store, or dock-predicate changes (`inTileDock` in `app.tsx` keeps its exact predicate).

### Design Decisions

#### Per-pointer morph triggers stay forked; the layout does not
**Decision**: One card/compact render model with exactly one remaining pointer fork — the morph trigger (coarse: `focused OR multiline OR attachments`; fine: draft-presence latch released on blur-while-empty).
**Why**: The pointer types differ physically: the OS keyboard slide masks a focus-triggered layout jump on touch, while on fine pointers every strip resize refits xterm, so the trigger must be draft-driven and latched to bound refit churn to deliberate boundaries.
**Rejected**: Focus-trigger on fine (refit churn on stray clicks); instant compact snap on empty (mid-edit refit when backspacing a draft away); a single shared trigger (would force the worse behavior on one pointer type).
*Introduced by*: 260816-q6hw-compose-strip-card-unification

#### Dock awareness is a prop threaded from app.tsx's existing predicate
**Decision**: `ComposeStrip` gains an optional boolean prop (e.g. `dockedInTile`) set `true` only by the `ttyDockContent` element `app.tsx` builds when `inTileDock` is true; both footer mounts omit it. The fine header fold (R6) keys on it.
**Why**: `app.tsx` already computes `inTileDock` to select the dock — the strip must not re-derive dock identity from DOM ancestry or a second predicate that could drift.
**Rejected**: DOM/context sniffing inside the strip (fragile, duplicates the predicate); folding the header on ALL fine terminal-target mounts (loses the target label exactly where no tile frame names it — the no-tty footer fallback and board route).
*Introduced by*: 260816-q6hw-compose-strip-card-unification

#### One render path with state-driven structure, not two branches
**Decision**: Replace the `coarsePointer ? (...) : (...)` layout fork with a single JSX structure whose card/compact form and chip visibility derive from `{isCard, coarsePointer, isSelectionTarget, hasTarget}`; shared element descriptors remain the single home for each control's props.
**Why**: Deleting the fork is the change's core value — two layouts to maintain/test/document become one; divergences (header fold, relocated uploading status) historically accumulated exactly at this fork.
**Rejected**: Keeping two branches that both render "a card" (preserves the drift surface the change exists to remove).
*Introduced by*: 260816-q6hw-compose-strip-card-unification

## Tasks

### Phase 2: Core Implementation

- [x] T001 Add morph-state derivation to `app/frontend/src/components/compose-strip.tsx`: `isCard` per pointer — coarse `focused || multiline || files.length > 0` with the `\n`-or-scrollHeight multiline probe; fine draft-presence latch (set on text/attachments present, released only in the blur handler when text is empty and no attachments; selection-broadcast and no-target states are exempt and keep their current always-stacked form) <!-- R3, R4 -->
- [x] T002 Replace the `coarsePointer ?` layout fork in `compose-strip.tsx` with the unified card/compact structure: card wrapper (bg-bg-card, rounded, focus:border-accent) holding previews → transparent borderless full-width textarea → quiet chip row; compact single row otherwise; `rows={1}` everywhere; previews move inside the card <!-- R1, R2, R7, R9 -->
- [x] T003 Apply the chip rosters and visibility rules in `compose-strip.tsx` and thread the dock prop: drop the `a|` chip on coarse entirely, hide ⏎ while empty, hide Insert in fine compact, fold the fine header when `dockedInTile` && terminal-target (prop set on the `ttyDockContent` element in `app/frontend/src/app.tsx`; footer mounts in `app.tsx`/`board-page.tsx` unchanged) <!-- R5, R6 -->
- [x] T004 Move the uploading indicator onto the 📎 chip in `compose-strip.tsx`: busy treatment + disabled while uploading, preserve a `role="status"` element, delete the standalone `Uploading…` text from the header row and the coarse inline slot <!-- R8 -->

### Phase 3: Integration & Edge Cases

- [x] T005 Rework `app/frontend/src/components/compose-strip.test.tsx` to the card/compact model: coarse trigger set, fine latch (type→card, erase-all→still card, blur-empty→compact, attachment-exempt release), chip visibility per pointer/state, header-fold scope, uploading-on-📎; keep surviving test-ids stable <!-- R10 -->
- [x] T006 Update `app/frontend/tests/e2e/compose-strip.spec.ts` + sibling `compose-strip.spec.md` in the same commit; review `status-bar.spec.ts`, `focus-restore.spec.ts`, `sidebar-multiselect.spec.ts` for selector fallout from removed/state-gated controls <!-- R10 -->
- [x] T007 Playwright visual verification on a 3020 dev server at 375×812 (coarse emulation) and 1280×800: compact empty, card with multi-line draft, card with attachments, selection-broadcast unchanged; confirm no horizontal overflow and chip touch floors <!-- R10 -->

## Execution Order

- T001 → T002 → T003 → T004 sequentially (same file, each builds on the prior structure)
- T005–T007 after T004; T005 and T006 are independent of each other

## Acceptance

### Functional Completeness

- [x] A-001 R1: Card form renders the bordered card with full-width transparent textarea and bottom chip row on both pointer types; no flanking chips
- [x] A-002 R2: Compact form renders the exact per-pointer rosters (coarse `📎·ta·Send`, fine `📎·a|·ta·Send`) with no header and no Insert
- [x] A-003 R3: Coarse card iff focused/multiline/attachments; compact otherwise
- [x] A-004 R4: Fine card on draft presence with latch; focus/blur alone never resizes the strip
- [x] A-005 R5: Coarse has no `a|` in any state; ⏎ hidden while empty and in selection-broadcast; fine card row is `📎·a|·spacer·Insert·Send`
- [x] A-006 R6: Fine header folds only at the in-tile terminal-target dock; broadcast, no-target, and footer-dock keep it
- [x] A-007 R7: `rows={1}` both pointers; the `rows` pointer fork is gone
- [x] A-008 R8: 📎 carries the busy state with a preserved `role="status"`; chip disabled while uploading
- [x] A-009 R9: Previews render as the card's first child on both pointers

### Behavioral Correctness

- [x] A-010 R4: Erasing a fine draft to empty keeps the card until blur-while-empty (unit-proven); removing the last attachment while blurred keeps the card until the next blur
- [x] A-011 R3: Coarse blur while empty returns compact; keyboard-masked focus morph verified at 375px

### Removal Verification

- [x] A-012 R5: `compose-strip-a-close` absent from every coarse render
- [x] A-013 R7: No 2-row floor remains (no `rows={2}`, no fine min-height floor emulating it)
- [x] A-014 R8: The standalone `Uploading…` text is gone from the header row and the coarse inline slot
- [x] A-015 R9: The above-the-row previews placement is gone

### Scenario Coverage

- [x] A-016 R10: Unit tests cover triggers, latch, rosters, header fold, uploading; `just test-frontend` passes
- [x] A-017 R10: `compose-strip.spec.ts` updated with sibling `.spec.md` in the same commit; toucher specs reviewed; compose e2e passes via `just test-e2e`/`just pw`
- [x] A-018 R10: 375px and 1024px+ visual verification performed (screenshots or spec assertions)

### Edge Cases & Error Handling

- [x] A-019 Non-goal: Selection-broadcast behavior unchanged — header shown, submit-only, ⏎ hidden, upload/Insert disabled, delivery-gated clear
- [x] A-020 Non-goal: No-target state unchanged — disabled textarea, header with "no target", focuser declines
- [x] A-021 Non-goal: `lib/compose-keys.ts`, `send()` payloads, draft store, recall walk, focus contracts, and `setComposeStripFocused` publishing are untouched by the diff

### Code Quality

- [x] A-022 Pattern consistency: New code follows the component's descriptor pattern, Tailwind token vocabulary, and `coarse:` variant conventions
- [x] A-023 No unnecessary duplication: shared element descriptors remain single-home; no parallel card markup per pointer
- [x] A-024 Type narrowing over assertions: no new `as` casts in the reworked render/state code
- [x] A-025 No comment narration: new comments state constraints only — no change-ID citations, no reviewer-addressed narration
- [x] A-026 Tests included for added/changed behavior (unit + e2e per R10)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None remaining — the apply diff already deletes everything this change made redundant: the `coarsePointer ?` two-branch layout fork (fine two-row stack + coarse single row), the `rows={coarsePointer ? 1 : 2}` floor fork, the standalone `Uploading…` spans (header slot and coarse inline slot), the above-the-row previews block, and the coarse `a|` chip. No newly introduced symbol is left without a call site (`textFocused`, `wrapped`, `latchedKey`, `chipTone`, `headerEl`, `previewsEl`, `dockedInTile` are all consumed).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Dock awareness via an optional `dockedInTile` prop set only by app.tsx's in-tile element | app.tsx already computes `inTileDock`; re-deriving in the strip would drift; intake §5 requires footer-dock fine to keep the header | S:70 R:85 A:80 D:70 |
| 2 | Confident | Fine latch release condition = blur AND text empty AND zero attachments | Intake assumption 11 pins release-on-blur-only; attachments force card (R4), so they must block release | S:65 R:85 A:80 D:75 |
| 3 | Confident | 📎 busy state = disabled chip + busy glyph/animation with a preserved `role="status"` element for a11y | Intake pins "busy/spinner state on the 📎 chip" without the exact treatment; role="status" preserves the current announcement | S:60 R:85 A:75 D:65 |
| 4 | Confident | Multiline probe = `text.includes("\n") || scrollHeight > one-line height` mirroring the validated mock | Intake assumption 9 names exactly this mechanism | S:65 R:85 A:80 D:75 |
| 5 | Confident | Surviving test-ids keep their names; state-hidden controls simply don't render in that state | Intake assumption 12; minimizes e2e fallout | S:60 R:85 A:75 D:70 |

5 assumptions (0 certain, 5 confident, 0 tentative).
