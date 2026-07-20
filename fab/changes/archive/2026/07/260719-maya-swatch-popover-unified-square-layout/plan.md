# Plan: SwatchPopover Unified Side-by-Side Square Layout

**Change**: 260719-maya-swatch-popover-unified-square-layout
**Intake**: `intake.md`

## Requirements

### SwatchPopover: Unified side-by-side layout

#### R1: Side-by-side sections for marker-enabled callers
When the marker section is shown (`onSelectMarker` + `markerColor` both present), `swatch-popover.tsx` SHALL render two side-by-side sections divided by a vertical hairline: markers LEFT (1 column of 4 cells), colors RIGHT (4-wide grid). The stacked layout (color grid → full-width Clear → horizontal hairline → marker row below) SHALL be removed.

- **GIVEN** a window-row Label picker (marker props supplied)
- **WHEN** the popover renders
- **THEN** a single-column marker section appears left of a vertical hairline, with the 4-wide color grid to its right
- **AND** no horizontal hairline or below-the-colors marker row exists

#### R2: Row 0 is the removal row
Row 0 SHALL be the removal row: the `∅` no-marker cell in the marker column (when shown) beside a `Clear color` button spanning the 4 color columns. Rows 1–3 SHALL pair the dotted / solid / double marker cells with color rows of 4/4/2 (the 10 `PICKER_COLOR_VALUES` laid out 4-wide). Marker cell order still mirrors `MARKER_STATES` (`["", "dotted", "solid", "double"]`). A code comment MUST mark the 10-colors + 4-marker-states row alignment as load-bearing (changing `PICKER_COLOR_VALUES` length or `MARKER_STATES` breaks the row pairing).

- **GIVEN** the marker-enabled popover
- **WHEN** it renders
- **THEN** row 0 is `∅` | `Clear color` (spanning 4 columns), row 1 is dotted | colors 1–4, row 2 is solid | colors 5–8, row 3 is double | colors 9–10
- **AND** a code comment marks the row-count alignment as load-bearing

#### R3: Marker cell rendering vocabulary unchanged
Marker cells SHALL keep today's rendering: stripes drawn via `markerStripeStyle` in the row's guarded family color (`markerColor`) on `bg-bg-inset` cells, `∅` glyph on the empty cell, current state highlighted, `aria-label="Marker <state>"` + `data-marker-value` preserved.

- **GIVEN** a marker-enabled popover with `markerColor="#8888ff"`
- **WHEN** the marker cells render
- **THEN** each non-empty cell draws its stripe via `markerStripeStyle(state, markerColor)` on a `bg-bg-inset` cell, the empty cell shows `∅`, and the selected state carries `aria-selected="true"`

### SwatchPopover: Square style universal

#### R4: Square is the only style
The `square` prop SHALL be removed from `SwatchPopoverProps` and the rounded variant deleted. All callers get the square vocabulary: hard 3px offset shadow `3px 3px 0 rgba(0,0,0,.35)` (no `rounded-md shadow-lg`), zero border radius on container + cells (no `rounded-sm`), 3px gaps (`gap-[3px]`), 18px cells (`w-[18px] h-[18px]`), 1px selection outlines (`ring-1`). The dual class-string branches (`containerCls`, `cellRadius`, `gridGap`, `colorGridCls`, `swatchSize`, `clearSpan`, `SQUARE_GRID_COLS`/`DEFAULT_GRID_COLS`) SHALL collapse to single literals. Session/server popovers and the palette color actions visibly change rounded → square — accepted and intended.

- **GIVEN** any caller (color-only or marker-enabled)
- **WHEN** the popover renders
- **THEN** the container has zero radius and the hard offset shadow, cells are 18px with 3px gaps and no rounding
- **AND** `SwatchPopoverProps` has no `square` member (TypeScript rejects passing it)

#### R5: Color-only callers get the pure color grid
The marker section SHALL stay conditional exactly as today (rendered only when `onSelectMarker` + `markerColor` are both present). Color-only callers (session-row, server-panel, app.tsx palette actions) SHALL get the pure color grid: no marker column, no vertical hairline, `Clear color` as its own full-width first row spanning the 4 color columns, then the 10 colors 4-wide (rows of 4/4/2). This replaces today's `col-span-2` bottom-right `Clear` cell.

- **GIVEN** a color-only caller (no marker props)
- **WHEN** the popover renders
- **THEN** 11 options render (10 swatches + Clear color), no `Marker` options exist, `Clear color` spans the full 4-column first row, and no vertical hairline renders

### SwatchPopover: Keyboard navigation

#### R6: Conceptual 5-column grid navigation
The linear focus-index math (`gridCols`, `clearIndex`, `markerBaseIndex` arithmetic) SHALL be replaced with a conceptual 5-column grid model: marker column (col 0, when shown) + 4 color columns (cols 1–4), 4 rows (removal row + 3 color rows). ArrowLeft/ArrowRight cross the vertical hairline (marker column ↔ color columns); ArrowUp/ArrowDown move within columns/rows; the `Clear color` button occupies cols 1–4 of row 0 as a single focus target; color-only mode is the same grid minus column 0. Moves off a grid edge and moves into the two empty cells (row 3, color cols 3–4) clamp / land on the nearest valid cell, consistent with the current implementation's clamping. Enter/Space activates the focused cell; initial focus lands on the selected color swatch (first swatch when uncolored).

- **GIVEN** focus on a marker cell in row 2 (solid)
- **WHEN** ArrowRight is pressed
- **THEN** focus crosses the hairline to the first color of row 2 (color 5)
- **GIVEN** focus on the last color of row 2 (col 4)
- **WHEN** ArrowDown is pressed
- **THEN** focus lands on the nearest valid cell of row 3 (color 10, col 2) — not a dead cell
- **GIVEN** focus on any color of row 1
- **WHEN** ArrowUp is pressed
- **THEN** focus lands on the single `Clear color` target

#### R7: ARIA contract and write seam preserved
The component SHALL preserve: `role="listbox"` with aria-label `Label picker` (markers shown) / `Color picker` (color-only); `role="option"` cells with `Color <family>` / `Marker <state>` labels and `data-color-value`/`data-marker-value` hooks; listbox autofocus on mount; Escape close; outside-click close; the `familyToLegacy` write seam (`onSelect` receives legacy values, `null` clears); `onSelectMarker` receiving the exact state (`""` clears); `selectedColor` normalization via `resolveFamily`. The removal button is labeled `Clear color` for ALL callers (color-only callers change from `Clear`).

- **GIVEN** the rewritten component
- **WHEN** a color is picked (click or Enter)
- **THEN** `onSelect` receives the family's legacy descriptor (e.g. orange → `"1+3"`), and Clear sends `null`
- **AND** `tests/e2e/window-marker-gutter.spec.ts` selectors (`Label picker` listbox, `Marker <state>` / `Color <family>` options) keep resolving

### Callers

#### R8: window-row drops `square`; other callers unchanged
`src/components/sidebar/window-row.tsx` SHALL drop the `square` prop from its SwatchPopover usage. `session-row.tsx`, `server-panel.tsx`, and `app.tsx` SHALL need no code change (their rendering changes visually via R4 only).

- **GIVEN** the `square` prop no longer exists
- **WHEN** the frontend type-checks (`tsc --noEmit`)
- **THEN** no call site passes `square` and the build is clean

### Tests

#### R9: Unit and e2e tests updated
`swatch-popover.test.tsx` SHALL be rewritten for the side-by-side grid, universal square styling, `Clear color` label, and the 5-column keyboard model; `window-row.test.tsx` / `server-panel.test.tsx` swept for stale layout/prop assertions. `tests/e2e/window-marker-gutter.spec.ts` layout/keyboard assertions updated if any break; per the constitution's Test Companion Docs rule, its sibling `window-marker-gutter.spec.md` MUST be updated in the same commit as any `.spec.ts` change (no `.spec.ts` change ⇒ no companion change required).

- **GIVEN** the rewritten component
- **WHEN** `just test-frontend` runs
- **THEN** all SwatchPopover, window-row, and server-panel unit tests pass with assertions matching the new geometry

### Non-Goals

- No backend, storage, or API change (legacy color vocabulary preserved at the write seam)
- No change to `themes.ts` exports (`PICKER_COLOR_VALUES`, `MARKER_STATES`, `markerStripeStyle`, etc.) — consumed as-is
- No change to when/where popovers open (triggers, anchoring wrappers in callers)
- No new files, routes, or keyboard shortcuts

### Design Decisions

#### Markers-left, colors-right
**Decision**: The marker column sits LEFT of the vertical hairline, colors right.
**Why**: Markers render as the LEFT-edge border stripe on window rows (`markerStripeStyle`), so each picker row reads like a mini window-row — stripe on the left, fill color beside it — matching how the result renders in the sidebar.
**Rejected**: Colors-left/markers-right — breaks the mini-window-row reading; user explicitly chose markers-left after reviewing the mockup.
*Introduced by*: 260719-maya-swatch-popover-unified-square-layout

#### Row/col focus model over linear index
**Decision**: Keyboard focus is a `{row, col}` pair over the conceptual 5-column grid, not a linear item index.
**Why**: The grid model is the spec's vocabulary (hairline crossing, row pairing, a spanning Clear target); a coordinate pair makes each arrow a one-axis move with per-cell validity, eliminating the layout-dependent index arithmetic that made the old code branch on `square`.
**Rejected**: Keeping a linear index with new arithmetic — reintroduces exactly the derived-index coupling the intake calls out (`clearIndex`, `markerBaseIndex`).
*Introduced by*: 260719-maya-swatch-popover-unified-square-layout

## Tasks

### Phase 2: Core Implementation

- [x] T001 Rewrite `app/frontend/src/components/swatch-popover.tsx`: remove `square` from `SwatchPopoverProps` + all style branches (single square literals — 3px offset shadow, zero radius, `gap-[3px]`, 18px cells, `ring-1`); restructure marker-enabled layout to side-by-side (marker column | vertical hairline | 4-wide color grid) with row 0 = `∅` | full-width `Clear color`, rows 1–3 = dotted/solid/double | colors 4/4/2; color-only = same minus marker column/hairline; label `Clear color` for all callers; add the load-bearing row-alignment comment; preserve ARIA labels, data hooks, autofocus, Escape/outside-click, `familyToLegacy` seam <!-- R1 R2 R3 R4 R5 R7 -->
- [x] T002 Rewrite keyboard navigation in `swatch-popover.tsx` as the conceptual 5-column grid (`{row, col}` focus state): ArrowLeft/Right cross the hairline, ArrowUp/Down move rows, Clear color is a single spanning focus target, edge moves and the two dead cells clamp to nearest valid, Enter/Space activates, initial focus on selected swatch (first when uncolored) <!-- R6 -->
- [x] T003 Drop the `square` prop from the SwatchPopover usage in `app/frontend/src/components/sidebar/window-row.tsx` (~:455) <!-- R8 -->

### Phase 3: Integration & Edge Cases

- [x] T004 Rewrite `app/frontend/src/components/swatch-popover.test.tsx`: update Clear label assertions (`Clear color`, `col-span-4` first row), universal-square assertions (18px cells, no `rounded-md`/`shadow-lg`, offset shadow for ALL callers), side-by-side marker-section assertions (marker column + vertical hairline, no horizontal separator), and new 5-column-grid keyboard tests (hairline crossing, row moves, Clear spanning target, dead-cell clamping, color-only grid minus col 0) <!-- R9 -->
- [x] T005 [P] Sweep `window-row.test.tsx` and `server-panel.test.tsx` for stale SwatchPopover layout/prop assertions; fix any that break <!-- R9 -->
- [x] T006 Run `just test-frontend`; verify `tests/e2e/window-marker-gutter.spec.ts` assertions against the new component (ARIA-based selectors expected to survive), update the spec + its `window-marker-gutter.spec.md` companion in the same commit if any change is needed, and run the relevant e2e spec via `just test-e2e` <!-- R9 -->

### Phase 4: Polish

- [x] T007 Frontend type check (`npx tsc --noEmit` via `just check` path) confirming no remaining `square` references; visual sanity pass of the three popover shapes (Label picker, session/server color-only, palette modal) <!-- R4 R8 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: Marker-enabled popover renders markers LEFT (1 column) and colors RIGHT (4-wide) divided by a vertical hairline; the stacked layout is gone
- [x] A-002 R2: Row 0 is `∅` | `Clear color` (spanning the 4 color columns); rows 1–3 pair dotted/solid/double with color rows of 4/4/2; a code comment marks the row alignment load-bearing
- [x] A-003 R3: Marker cells draw stripes via `markerStripeStyle` in `markerColor` on `bg-bg-inset`, `∅` on the empty cell, selected state highlighted
- [x] A-004 R4: Square vocabulary (3px offset shadow, zero radius, 3px gaps, 18px cells, ring-1) applies to ALL callers; `square` prop and every dual class-string branch removed
- [x] A-005 R5: Color-only callers render the pure color grid — no marker column/hairline, `Clear color` full-width first row, colors 4/4/2
- [x] A-006 R6: Keyboard nav follows the conceptual 5-column grid — hairline crossing via ArrowLeft/Right, row moves via ArrowUp/Down, Clear as single spanning target, color-only = grid minus col 0
- [x] A-007 R7: ARIA contract (listbox/option roles, `Label picker`/`Color picker` labels, `Color <family>`/`Marker <state>` options, data hooks), autofocus, Escape/outside-click, and the `familyToLegacy`/`onSelectMarker` write seams are unchanged
- [x] A-008 R8: `window-row.tsx` no longer passes `square`; session-row/server-panel/app.tsx unchanged in code; `tsc --noEmit` clean

### Behavioral Correctness

- [x] A-009 R5: The color-only removal control changed from a `col-span-2` bottom-right `Clear` to a full-width first-row `Clear color` — asserted by test
- [x] A-010 R6: Edge moves and the two dead cells (row 3, color cols 3–4) clamp/land on the nearest valid cell — asserted by test

### Removal Verification

- [x] A-011 R4: No `square` prop, no `SQUARE_GRID_COLS`/`DEFAULT_GRID_COLS`, no `rounded-md`/`rounded-sm`/`shadow-lg`/`w-5 h-5`/`col-span-2`/`col-span-5` remnants in `swatch-popover.tsx`

### Scenario Coverage

- [x] A-012 R6: Unit tests cover: ArrowRight crossing marker→color, ArrowUp from row 1 to Clear, ArrowDown from Clear into colors, ArrowLeft from Clear to `∅`, activation via Enter and Space
- [x] A-013 **N/A**: R9: `window-marker-gutter.spec.ts` is unchanged — its selectors are all ARIA role/label based (`Label picker`, `Marker <state>`, `Color <family>`), preserved by R7; so no `.spec.ts` change and (per constitution) no `.spec.md` companion change required. Selector preservation verified by inspection; e2e server not re-run in review

### Edge Cases & Error Handling

- [x] A-014 R6: ArrowLeft at col 0 (or col 1 color-only), ArrowUp at row 0, ArrowDown at row 3, ArrowRight at col 4 are no-ops (no crash, focus stays valid)

### Code Quality

- [x] A-015 Pattern consistency: rewritten component follows surrounding conventions (memoized tints, useCallback handlers, Tailwind literal class strings for JIT)
- [x] A-016 No unnecessary duplication: `markerStripeStyle`/`computeRowTints`/`resolveFamily`/`familyToLegacy` reused from `@/themes`; no reimplementation
- [x] A-017 No polling added; SSE/write seams untouched (anti-pattern check)
- [x] A-018 New/changed behavior covered by tests (code-quality mandate); UI change verified via Playwright e2e (existing `window-marker-gutter.spec.ts` exercises the Label picker via preserved selectors; unit tests cover the new keyboard grid)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None in source — this refactor's redundant code (the `square` prop, `SQUARE_GRID_COLS`/`DEFAULT_GRID_COLS`, and every dual class-string branch: `containerCls`/`cellRadius`/`gridGap`/`colorGridCls`/`swatchSize`/`clearSpan`, plus `clearIndex`/`markerBaseIndex`/`totalItems`/`gridCols`/`colorCount`) was already removed inline by apply; `tsc --noEmit` and a repo grep confirm no remnants. No newly-orphaned symbol, file, or branch remains.
- `docs/memory/run-kit/ui-patterns.md:240` — stale cross-reference (not code): the StatusDotTip entry describes its card as using "the same theme tokens as `SwatchPopover` (`bg-bg-primary border border-border rounded-md shadow-lg`, monospace)". After this change `SwatchPopover` no longer carries `rounded-md shadow-lg` (it is now zero-radius + hard offset shadow). StatusDotTip's own styling is unchanged — only the comparison phrasing is now false. Fix during hydrate (memory-drift correction), not a code deletion.

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Focus state modeled as a `{row, col}` pair (not a rewritten linear index); Clear color is one focus target treated as cols 1–4 of row 0 | Intake mandates the "conceptual 5-column grid" model; a coordinate pair is its direct encoding — implementation detail, easily reversed | S:75 R:85 A:85 D:70 |
| 2 | Confident | Dead-cell/edge semantics: ArrowDown from row 2 cols 3–4 lands on the nearest valid cell of row 3 (color 10); all other off-grid moves are no-ops; ArrowDown from Clear lands on row 1 col 1 | Intake grades this Confident itself (clamp/no-op "consistent with the current implementation's clamping" — the old code also lands past-the-row moves on the nearest valid target) | S:60 R:90 A:80 D:65 |
| 3 | Confident | `Clear color` height matches the 18px cell height so marker rows and color rows align 1:1 (old Clear was 20px `h-5`) | Row 0 pairing (`∅` beside Clear) requires equal row heights; 18px is the universal square cell size | S:60 R:95 A:85 D:80 |
| 4 | Confident | Vertical hairline rendered as a 1px `bg-border`/`border-border` divider element between the two sections (same border token as the old horizontal hairline) | "Vertical hairline" specified; token choice follows the existing hairline's `border-border` | S:70 R:95 A:90 D:85 |
| 5 | Certain | e2e spec untouched if it passes as-is — its selectors are ARIA-based (`Label picker`, `Marker <state>`, `Color <family>`) which R7 preserves; companion `.spec.md` then needs no change | Constitution rule binds companion updates to `.spec.ts` changes only; intake says selectors should survive | S:80 R:90 A:90 D:85 |
| 6 | Confident | Marker column implemented as a 4-row flex/grid column whose cells share the color grid's 18px/3px metrics, keeping row alignment without a single CSS grid spanning both sections | Two-section DOM (column | hairline | grid) is the natural reading of "two side-by-side sections divided by a vertical hairline"; equal fixed cell metrics guarantee alignment | S:65 R:85 A:85 D:70 |

6 assumptions (1 certain, 5 confident, 0 tentative).
