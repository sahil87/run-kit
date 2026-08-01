# Plan: Leading Icons on Top-Bar Menu Rows

**Change**: 260801-3q1z-top-bar-menu-leading-icons
**Intake**: `intake.md`

## Requirements

### Frontend: Shared top-bar glyph module

#### R1: One shared glyph component per mirrored control
A new module `app/frontend/src/components/top-bar-icons.tsx` SHALL export one glyph component per mirrored in-bar control — split-vertical, split-horizontal, close-pane, refresh, fixed-width, autofit, and the "Aa" terminal-font glyph — following the `OpenTargetIcon` precedent (`open-app-icons.tsx`): ~14px rendered size, `currentColor` stroke/fill, `aria-hidden="true"`, `shrink-0`, and a `data-icon` attribute as the test seam. `data-icon` values MUST be `split-vertical`, `split-horizontal`, `close-pane`, `refresh`, `fixed-width`, `autofit`, `terminal-font`.

- **GIVEN** the module `top-bar-icons.tsx`
- **WHEN** any exported glyph renders
- **THEN** it is a 14px `currentColor` element carrying `aria-hidden="true"`, `shrink-0`, and its kebab-case `data-icon` value
- **AND** the terminal-font glyph is an `aria-hidden` **text span** ("Aa") in a fixed ~14px `shrink-0` box — not an SVG (intake assumption #6)

#### R2: In-bar buttons consume the shared glyphs with zero visual change
The in-bar consumers — `SplitControl` primary segment (~top-bar.tsx:1960), `ClosePaneButton`, `RefreshButton`, `FixedWidthToggle`, `BoardAutofitToggle`, and the `TerminalFontControl` trigger — SHALL be refactored to render the shared glyph components so bar and menu render **one definition each**. The rendered SVG output (viewBox, strokeWidth, caps/joins, paths) MUST byte-match today's inline markup — zero visual change to the bar. `FixedWidthToggle` keeps its state-driven variant selection (outward arrows when `fixedWidth`, inward otherwise); `BoardAutofitToggle` keeps its filled-panes-when-on variant.

- **GIVEN** the terminal route with the in-bar cluster rendered
- **WHEN** comparing the split/close/refresh/Aa button markup before and after
- **THEN** the SVG paths and stroke attributes are unchanged (only the shared `data-icon` attribute is new)
- **AND** toggling `fixedWidth` / `autofit` still flips the in-bar glyph variant exactly as before

#### R3: SplitControl popover rows gain leading direction glyphs
The two `POPOVER_ROW_CLASS` rows in the SplitControl ▾ dropdown SHALL lead with their direction glyph: "Split vertical" → the square-split-vertical glyph (the same one the primary segment renders), "Split horizontal" → the lucide `square-split-horizontal` 90°-rotated variant (side brackets + vertical divider `line x1="12" x2="12" y1="4" y2="20"`, same stroke conventions).

- **GIVEN** the SplitControl ▾ dropdown is open
- **WHEN** the two direction rows render
- **THEN** each row's first child is its direction glyph (`data-icon="split-vertical"` / `data-icon="split-horizontal"`), aligned by the row's existing `flex items-center gap-2`
- **AND** each row's accessible name stays its text label ("Split vertical" / "Split horizontal")

#### R4: Overflow chevron menu rows gain leading glyphs
The overflow-menu row components in `top-bar.tsx` SHALL lead with the glyph mirroring their in-bar control: `SplitMenuRow` ×2 (direction glyphs), `ClosePaneMenuRow` (close ✕), `RefreshMenuRow` (rotate-cw), `FixedWidthMenuRow` (fixed-width arrows), `AutofitMenuRow` (frame-with-columns), `TerminalFontMenuRow` (the "Aa" text glyph). No `MENU_ROW_CLASS`/`POPOVER_ROW_CLASS` changes — the leading icon rides the existing `gap-2` row layout as first child.

- **GIVEN** the overflow chevron menu is open on a terminal route (and a board route for Autofit)
- **WHEN** each listed row renders
- **THEN** the row's first child is its `data-icon`-tagged glyph and the row's accessible name is unchanged

#### R5: Toggle rows — leading icon is static identity, trailing ✓ stays the state marker
On the two stateful toggle rows (`FixedWidthMenuRow`, `AutofitMenuRow`) the leading icon SHALL be a **static identity variant** that never flips with state — fixed-width → the inward/contract arrows form, autofit → the unfilled frame-with-columns form (intake assumption #5). The existing trailing ✓ SHALL remain the sole state marker (macOS menu pattern: leading = identity, trailing ✓ = state).

- **GIVEN** the overflow menu open with `fixedWidth` (or `autofit`) toggled ON, then OFF
- **WHEN** comparing the row's leading glyph across the two states
- **THEN** the leading glyph markup is identical in both states
- **AND** the trailing ✓ appears only in the ON state

#### R6: Accessible names and existing e2e stay green
All new glyphs are `aria-hidden` decoration, so every affected row/button SHALL keep its current accessible name, and the five e2e specs referencing these controls (`top-bar-overflow.spec.ts`, `top-bar-refresh.spec.ts`, `board-autofit.spec.ts`, `board-close-and-unpin.spec.ts`, `tooltips.spec.ts`) SHALL pass without modification (no `.spec.ts` edits ⇒ no `.spec.md` companion updates required).

- **GIVEN** the five named Playwright specs
- **WHEN** run against the change (via `just pw test`, port-3020 isolation)
- **THEN** all pass unmodified

#### R7: Unit coverage — `data-icon` presence per row
Colocated unit tests SHALL assert `data-icon` presence for each iconified surface: the six overflow-menu rows, the two SplitControl popover rows, and the refactored in-bar consumers (including the static-identity rule of R5 — the menu toggle rows' glyph not flipping with state).

- **GIVEN** `top-bar.test.tsx`
- **WHEN** the suite runs
- **THEN** each iconified row/button is asserted via its `data-icon` seam, and the toggle rows are asserted to keep a static leading glyph across ON/OFF states

### Non-Goals

- `ViewSwitcherMenuRows` (`view-switcher.tsx`) — the in-bar form is a text pill; no glyph to mirror
- Command palette rows, breadcrumb switcher dropdowns, desktop titlebar host-switcher menu, bottom-bar Fn-keys menu
- The Open rows (already iconified via `OpenTargetIcon`)
- No row-class (`MENU_ROW_CLASS`/`POPOVER_ROW_CLASS`) or backend/API changes

### Design Decisions

#### Dedicated sibling icons module, not `open-app-icons.tsx`
**Decision**: Host the shared glyphs in a new `app/frontend/src/components/top-bar-icons.tsx`.
**Why**: `open-app-icons.tsx` is Open-target-specific (its API takes an `OpenTarget`); `top-bar-overflow-menu.tsx` hosts row classes/sizing tokens, not glyphs. A dedicated module mirrors the `open-app-icons.tsx` shape and imports cleanly into `top-bar.tsx` with no cycle.
**Rejected**: Extending `open-app-icons.tsx` — would couple control glyphs to the OpenTarget resolution API; inlining into `top-bar-overflow-menu.tsx` — mixes glyph definitions into the menu-shell component.
*Introduced by*: 260801-3q1z-top-bar-menu-leading-icons

#### Per-glyph exact SVG attributes, not one uniform wrapper
**Decision**: Each glyph preserves its in-bar original's exact SVG attributes (split/close/refresh: 24-viewBox strokeWidth 2; fixed-width: 14-viewBox strokeWidth 1.5 round caps only; autofit: 14-viewBox strokeWidth 1.5 round caps+joins), via a small local wrapper parameterized by viewBox/strokeWidth/joins rather than `open-app-icons.tsx`'s fixed 24/1.8 `Glyph`.
**Why**: R2 mandates zero visual change to the bar; normalizing attrs onto one wrapper would subtly alter stroke rendering.
**Rejected**: Reusing the `Glyph` wrapper from `open-app-icons.tsx` — its fixed strokeWidth 1.8 / 24-viewBox would change every glyph's weight.
*Introduced by*: 260801-3q1z-top-bar-menu-leading-icons

## Tasks

### Phase 1: Setup

- [x] T001 Create `app/frontend/src/components/top-bar-icons.tsx`: shared glyph components `SplitVerticalGlyph`, `SplitHorizontalGlyph`, `ClosePaneGlyph`, `RefreshGlyph`, `FixedWidthGlyph({expanded?})`, `AutofitGlyph({filled?})`, `TerminalFontGlyph` — OpenTargetIcon conventions (~14px, `currentColor`, `aria-hidden`, `shrink-0`, kebab-case `data-icon`), each preserving its in-bar original's exact SVG attributes; `TerminalFontGlyph` is a text span "Aa" in a fixed ~14px box <!-- R1 -->

### Phase 2: Core Implementation

- [x] T002 Refactor the six in-bar consumers in `app/frontend/src/components/top-bar.tsx` onto the shared glyphs — `SplitControl` primary segment, `ClosePaneButton`, `RefreshButton`, `FixedWidthToggle` (state-driven `expanded={fixedWidth}`), `BoardAutofitToggle` (`filled={autofit}`), `TerminalFontControl` trigger — deleting the inlined SVGs/span; zero visual change <!-- R2 -->
- [x] T003 Add leading direction glyphs to the two SplitControl popover rows (`POPOVER_ROW_CLASS`) in `app/frontend/src/components/top-bar.tsx` <!-- R3 -->
- [x] T004 Add leading glyphs to the six overflow-menu row components in `app/frontend/src/components/top-bar.tsx` (`SplitMenuRow` ×2 directions, `ClosePaneMenuRow`, `RefreshMenuRow`, `FixedWidthMenuRow` static-contract, `AutofitMenuRow` static-unfilled, `TerminalFontMenuRow` "Aa"); trailing ✓ stays the sole state marker on the toggle rows <!-- R4, R5 -->

### Phase 3: Integration & Edge Cases

- [x] T005 Extend `app/frontend/src/components/top-bar.test.tsx` with `data-icon` presence assertions per iconified surface (menu rows, popover rows, in-bar consumers) plus static-identity assertions for the two toggle rows across ON/OFF; run `just test-frontend` <!-- R7 -->
- [x] T006 Run the five affected e2e specs unmodified via `just pw test top-bar-overflow top-bar-refresh board-autofit board-close-and-unpin tooltips` (check `lsof -i :3020` for a squatting cross-worktree server first); confirm green with no `.spec.ts` changes <!-- R6 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: `top-bar-icons.tsx` exports the seven glyphs with the OpenTargetIcon conventions and the specified `data-icon` values; the terminal-font glyph is a text span, not an SVG
- [x] A-002 R2: All six in-bar consumers render the shared glyphs; no inline SVG/span duplicates remain for these controls in `top-bar.tsx`
- [x] A-003 R3: Both SplitControl popover rows lead with their direction glyph
- [x] A-004 R4: All six overflow-menu row components lead with their mirroring glyph

### Behavioral Correctness

- [x] A-005 R2: In-bar rendered SVG output is unchanged (same viewBox/stroke attrs/paths; only `data-icon` added); `FixedWidthToggle`/`BoardAutofitToggle` still flip variants with state — verified glyph-by-glyph against the removed inline markup, incl. the fixed-width `join={false}` (round caps only) case. *Caveat*: the non-SVG `TerminalFontGlyph` is not byte-identical — the in-bar trigger's original bare `<span aria-hidden>Aa</span>` gains `w-[14px] inline-flex items-center justify-center font-semibold leading-none`. `font-semibold leading-none` are no-ops (the trigger button already carries both); the fixed 14px box is a ~0.4px squeeze on the 14.4px natural monospace width of "Aa" at `text-xs`, centered and unclipped. Sub-pixel, not visually perceptible — see review should-fix S1
- [x] A-006 R5: Menu toggle rows' leading glyphs are static identity (contract arrows / unfilled frame) in both states; trailing ✓ remains the sole state marker

### Scenario Coverage

- [x] A-007 R7: Unit tests assert `data-icon` presence per iconified row/button and the static-identity rule on the toggle rows; `just test-frontend` passes
- [x] A-008 R6: The five named e2e specs pass unmodified (accessible names unchanged; no `.spec.md` updates needed)

### Edge Cases & Error Handling

- [x] A-009 R2: SplitControl primary segment still swaps to `LogoSpinner` while pending (glyph only at rest); disabled/pending states unaffected across all refactored consumers

### Code Quality

- [x] A-010 Pattern consistency: New glyph module follows the `open-app-icons.tsx` shape and naming; rows keep `MENU_ROW_CLASS`/`POPOVER_ROW_CLASS` untouched
- [x] A-011 No unnecessary duplication: the split-vertical SVG (and every other mirrored glyph) is defined exactly once, consumed by bar and menu
- [x] A-012 Type safety: no `as` casts introduced; frontend type check (`tsc --noEmit`) passes

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- `app/frontend/src/components/top-bar-overflow-menu.tsx:409-423` — the "Check for updates" button's inline rotate-cw SVG is byte-identical to the new `RefreshGlyph` (its own comment cites "the refresh vocabulary (RefreshButton)"); it lives in the very menu this change iconifies, so the inline copy is now redundant. Out of this plan's declared R2 consumer list — surfaced for follow-up, not auto-deleted
- `app/frontend/src/components/sidebar/status-panel.tsx:296-300` — a third inline rotate-cw copy (sidebar pane-header refresh). Redundant against `RefreshGlyph` in principle, but it is a sidebar control outside the top-bar vocabulary; a shared home would need to be a module neither `top-bar-icons.tsx` nor `sidebar/icons.tsx` owns today

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Unit `data-icon` coverage lives in `top-bar.test.tsx` only; `top-bar-overflow-menu.test.tsx` is unchanged — it tests the menu shell with pre-rendered row nodes and contains no row components to assert | The intake names both files, but the row components (and their icons) render only through `top-bar.tsx`; asserting icons against fabricated nodes in the shell test proves nothing | S:60 R:90 A:85 D:75 |
| 2 | Certain | Each glyph preserves its in-bar original's exact SVG attributes rather than normalizing onto one shared wrapper | R2's zero-visual-change mandate; originals differ (24-vb/sw2 vs 14-vb/sw1.5, caps/joins vary) | S:85 R:90 A:90 D:85 |
| 3 | Confident | `FixedWidthGlyph`/`AutofitGlyph` take a variant prop (`expanded?`/`filled?`, default false = static identity form) so one definition serves both the state-driven bar and the static menu row | Intake mandates one definition each while the bar form is state-dependent; a defaulted prop is the minimal seam | S:70 R:90 A:85 D:75 |
| 4 | Confident | Split popover/menu rows show the plain direction glyph even while a split is pending (pending is carried by the row's disabled state; only the in-bar primary segment swaps to a spinner) | Rows never showed spinners before; adding one is scope creep and the disabled dim already signals pending | S:60 R:90 A:80 D:75 |
| 5 | Confident | e2e verification = the five named specs via `just pw test` (port-3020 isolation), not the full `just test-e2e` suite | Intake assumption #9 names exactly these five; the change is aria-hidden decoration with no name/role changes | S:70 R:85 A:80 D:80 |

5 assumptions (1 certain, 4 confident, 0 tentative).
