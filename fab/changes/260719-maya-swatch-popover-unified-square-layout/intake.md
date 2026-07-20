# Intake: SwatchPopover Unified Side-by-Side Square Layout

**Change**: 260719-maya-swatch-popover-unified-square-layout
**Created**: 2026-07-20

## Origin

Promptless dispatch (Create-Intake Procedure, `{questioning-mode} = promptless-defer`) from a design discussion the user concluded by approving an interactive HTML mockup built with real `computeRowTints` values from `src/themes.ts`. Synthesized description:

> Restructure SwatchPopover into a unified side-by-side layout and make the square style universal. Two side-by-side sections divided by a vertical hairline: markers LEFT (1 column), colors RIGHT (4-wide grid). Row 0 is the removal row (`∅` no-marker cell | `Clear color` spanning the 4 color columns). Rows 1–3: dotted / solid / double marker cells beside color rows of 4/4/2. Square style becomes the only style — drop the `square` prop and the rounded variant entirely. Marker section stays conditional exactly as today. Keyboard navigation rewritten around a conceptual 5-column grid. No caller API changes except the window-row caller dropping `square`.

Key decisions were made *in that discussion with rationale* — captured verbatim in What Changes and graded in Assumptions.

## Why

1. **The pain point**: `app/frontend/src/components/swatch-popover.tsx` currently renders two divergent layouts from one component. Color-only callers (session/server rows, palette color actions) get a rounded 4-col grid with `Clear` as a `col-span-2` bottom-right cell; the window-row Label picker (`square` + `onSelectMarker` + `markerColor`) gets a square 5×2 color grid with a full-width "Clear color" row and a marker row stacked BELOW a horizontal hairline. The stacked marker row reads poorly — markers render as the LEFT-edge border stripe on window rows (`markerStripeStyle` in `src/themes.ts`: borderLeft 3px dotted / 3px solid / 6px double), so a marker row placed underneath the colors has no spatial relationship to what it controls. The two style vocabularies (rounded vs square) also force a `square` prop, duplicated class-string branches, and two keyboard-nav geometries in one component.
2. **If not fixed**: the component keeps carrying two layout systems and two focus-math models (`gridCols`, `clearIndex`, `markerBaseIndex` all branch on `square`), every future picker change pays double, and the Label picker keeps the weaker below-the-fold marker placement.
3. **Why this approach**: the side-by-side (markers-left) arrangement was chosen over color-left/marker-right specifically because each picker row then reads like a mini window-row — stripe on the left, fill color beside it — matching how the result renders in the sidebar. Making square the only style deletes the prop and the rounded branch rather than maintaining both. The user approved this after reviewing an interactive HTML mockup rendered with real `computeRowTints` values.

## What Changes

### 1. Unified side-by-side layout (marker-enabled callers)

`swatch-popover.tsx` replaces the stacked layout (5×2 color grid → full-width Clear → horizontal hairline → 4-cell marker row) with two side-by-side sections divided by a **vertical hairline**: markers LEFT (1 column), colors RIGHT (4-wide grid).

```
∅   │  [   Clear color    ]     ← row 0: removal row
▐░  │  c1  c2  c3  c4           ← row 1: dotted  + colors 1–4
▐█  │  c5  c6  c7  c8           ← row 2: solid   + colors 5–8
▐▓  │  c9  c10  .   .           ← row 3: double  + colors 9–10
```

- **Row 0 is the removal row**: `∅` no-marker cell (left) | `Clear color` button spanning the 4 color columns (right).
- **Rows 1–3**: dotted / solid / double marker cells beside color rows of 4/4/2 (the 10 `PICKER_COLOR_VALUES` laid out 4-wide).
- Marker cell order still mirrors `MARKER_STATES` (`["", "dotted", "solid", "double"]` — `themes.ts:426`); `∅` moves to row 0, the three non-empty states to rows 1–3.
- The 3-rows-of-colors = 3-non-empty-marker-states alignment is a **coincidence** of 10 colors + 4 marker states — add a code comment marking it load-bearing (changing `PICKER_COLOR_VALUES` length or `MARKER_STATES` breaks the row pairing).
- Rationale for markers-left (not colors-left): markers render as the LEFT-edge border stripe on window rows (`markerStripeStyle`, `src/themes.ts:432` — borderLeft 3px dotted / 3px solid / 6px double), so each picker row reads like a mini window-row: stripe on the left, fill color beside it.
- Marker cells keep today's rendering vocabulary: stripes drawn via `markerStripeStyle` in the row's guarded family color on `bg-bg-inset` cells, visually distinct from the color fills; the hairline plus that distinct styling is what signals the two sections are independent axes.

### 2. Square style becomes the only style

Drop the `square` prop from `SwatchPopoverProps` and delete the rounded variant entirely. The square vocabulary applies to **all** callers:

- hard 3px offset shadow: `3px 3px 0 rgba(0,0,0,.35)` (replaces `rounded-md shadow-lg`)
- zero border radius (container + cells; no `rounded-sm`)
- 3px gaps (`gap-[3px]`)
- 18px cells (`w-[18px] h-[18px]`, replacing the color-only callers' 20px `w-5 h-5`)
- 1px selection outlines (`ring-1`)

Session/server popovers (and the palette color actions) **visibly change from rounded to square — accepted and intended**. The dual class-string branches (`containerCls`, `cellRadius`, `gridGap`, `colorGridCls`, `swatchSize`, `clearSpan`, `SQUARE_GRID_COLS`/`DEFAULT_GRID_COLS`) collapse to single literals.

### 3. Color-only callers: pure color grid

The marker section stays conditional **exactly as today**: rendered only when `onSelectMarker` + `markerColor` are both present. Color-only callers (session-row.tsx:258, server-panel.tsx:193, app.tsx:2889 palette actions) get the pure color grid: left marker column and vertical hairline absent, `Clear color` keeps its own full-width first row (spanning the 4 color columns), then the 10 colors at 4-wide (rows of 4/4/2). Note this is itself a layout change for color-only callers: today `Clear` is a `col-span-2` bottom-right cell; the new layout puts removal on its own first row, consistent with the marker-enabled layout minus the left column.

### 4. Keyboard navigation rewrite

The current focus-index math (`gridCols`, `clearIndex`, `markerBaseIndex` — a linear index with layout-dependent arithmetic) is built around the stacked layout. Replace with a **conceptual 5-column grid** model: marker column (col 0, when shown) + 4 color columns (cols 1–4), 4 rows (removal row + 3 color rows).

- ArrowLeft/ArrowRight cross the vertical hairline (marker column ↔ color columns).
- ArrowUp/ArrowDown move within columns/rows.
- The `Clear color` button occupies cols 1–4 of row 0 as a single focus target.
- Color-only mode is the same grid minus column 0.
- Edge behavior not specified in the discussion (moves off the grid edge; the two empty cells at row 3 cols 3–4 of the color section) resolves as clamp/no-op consistent with the current implementation's clamping. <!-- assumed: edge-case arrow behavior — clamp at edges / land on nearest valid cell; discussion specified only the grid model, not per-edge semantics -->

### 5. Callers and API

No caller API changes except `window-row.tsx` (SwatchPopover usage at :443) dropping the `square` prop (:455). The write seam is untouched:

- `onSelect` still receives `familyToLegacy`-mapped values; `null` clears (single write seam, legacy vocabulary the backend validates — zero backend change).
- `onSelectMarker` receives the marker state directly; `""` clears.
- Marker stripes draw in the row's guarded family color (`markerColor` prop; gray sentinel on uncolored rows) — unchanged.
- `selectedColor` normalization via `resolveFamily` — unchanged.

### 6. Tests and verification

- **Unit**: `src/components/swatch-popover.test.tsx` has a `combined Label picker (marker section + square styling)` describe block asserting the stacked geometry, the `square` flag, the 5×2/18px layout, and the linear keyboard path — rewrite for the side-by-side grid and prop removal. `window-row.test.tsx` / `server-panel.test.tsx` touch the popover and need sweeping for layout/prop assertions.
- **e2e**: `tests/e2e/window-marker-gutter.spec.ts` drives the Label picker via `getByRole("listbox", { name: "Label picker" })` and `Marker <state>` options (:132–199). Selectors should survive if ARIA roles/labels are preserved; any layout/keyboard assertions need updating. The constitution's Test Companion Docs rule requires the sibling `window-marker-gutter.spec.md` updated in the same commit as any `.spec.ts` change.
- **Visual-clarity risk to verify** (Playwright/e2e): the side-by-side rows could read as if a marker pairs with its row's colors (they are independent axes); the hairline plus distinct cell styling (stripes on bg-inset vs color fills) should carry it. Verify visually at both light/dark themes.

## Affected Memory

- `run-kit/ui-patterns`: (modify) sidebar color/label picker section — SwatchPopover becomes single square style (no rounded variant, no `square` prop), unified side-by-side markers-left/colors-right layout with vertical hairline, conceptual 5-column keyboard grid; color-only callers get the square pure color grid with full-width Clear-color first row

## Impact

- **Primary**: `app/frontend/src/components/swatch-popover.tsx` — layout restructure, `square` prop removal, keyboard-nav rewrite. Single-component blast radius; no new files, no route or API changes.
- **Callers** (prop-drop / no functional change): `src/components/sidebar/window-row.tsx` (drops `square`); `src/components/sidebar/session-row.tsx`, `src/components/sidebar/server-panel.tsx`, `src/app.tsx` (palette color actions, lazy import) — unchanged code, visibly changed rendering (rounded → square).
- **Unchanged dependencies**: `src/themes.ts` exports (`PICKER_COLOR_VALUES`, `MARKER_STATES`, `markerStripeStyle`, `computeRowTints`, `familyToLegacy`, `resolveFamily`, `colorValueToHex`) are consumed as-is; no backend or storage change (legacy color vocabulary preserved at the write seam).
- **Tests**: `src/components/swatch-popover.test.tsx` (substantial rewrite of the layout/keyboard describe blocks), `window-row.test.tsx` / `server-panel.test.tsx` (sweep), `tests/e2e/window-marker-gutter.spec.ts` + `window-marker-gutter.spec.md` (companion doc, constitution-required).

## Open Questions

- None — the design was resolved in the originating discussion (user approved the interactive mockup); residual micro-decisions are graded below.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Side-by-side layout: markers LEFT (1 column), colors RIGHT (4-wide grid), divided by a vertical hairline | Discussed — chosen over color-left/marker-right because markers render as the LEFT-edge stripe on window rows, so each picker row reads like a mini window-row; user approved the mockup | S:95 R:70 A:90 D:95 |
| 2 | Certain | Row 0 is the removal row: `∅` no-marker cell on the left, `Clear color` spanning the 4 color columns on the right | Explicit in the approved design | S:95 R:75 A:90 D:95 |
| 3 | Certain | Rows 1–3 pair dotted/solid/double with color rows of 4/4/2; a code comment marks the 10-colors + 4-marker-states row alignment as load-bearing | Explicit in the approved design, including the comment requirement | S:95 R:80 A:95 D:90 |
| 4 | Certain | Square style becomes the only style — drop the `square` prop and rounded variant; square vocabulary = 3px offset shadow, zero radius, 3px gaps, 18px cells, 1px outlines; session/server popovers visibly change | Explicit — "accepted and intended" per the discussion | S:95 R:80 A:95 D:95 |
| 5 | Certain | Marker section stays conditional on `onSelectMarker` + `markerColor` both present; color-only callers get the pure color grid (no left column/hairline) with `Clear color` as its own full-width first row | Explicit in the approved design | S:90 R:80 A:90 D:90 |
| 6 | Certain | Write seam untouched: `onSelect` gets `familyToLegacy`-mapped values with `null` clearing; `onSelectMarker` gets the state directly with `""` clearing; `markerColor` guarded-family stripe drawing unchanged | Explicit — "the write seam is untouched"; matches current code | S:95 R:85 A:95 D:95 |
| 7 | Confident | Keyboard nav = conceptual 5-column grid (marker col + 4 color cols); unspecified edge cases (moves off grid edges, the 2 empty cells at row 3 cols 3–4) clamp / no-op consistent with the current implementation | Grid model explicit; per-edge semantics not discussed — existing code clamps, one obvious default | S:65 R:85 A:80 D:70 |
| 8 | Confident | The removal button is labeled `Clear color` for ALL callers, including color-only ones (today they show `Clear`) | Design says "`Clear color` keeps its own full-width first row" for color-only callers; label unification is the natural reading but was not called out as a copy change | S:65 R:90 A:75 D:75 |
| 9 | Confident | ARIA contract preserved: `role="listbox"`/`role="option"`, aria-labels `Label picker`/`Color picker`, `data-color-value`/`data-marker-value` hooks — so `window-marker-gutter.spec.ts` selectors keep resolving | Not discussed; strong signal from existing tests/e2e depending on these names, no reason to change | S:55 R:85 A:85 D:75 |
| 10 | Confident | Initial focus lands on the selected color swatch (first swatch when uncolored), as today; the marker column is reached via ArrowLeft | Not discussed; current behavior is the obvious default under the new grid | S:45 R:90 A:75 D:60 |
| 11 | Certain | Tests updated: `swatch-popover.test.tsx` layout/keyboard rewrite, caller-test sweep, `window-marker-gutter.spec.ts` updates with its `.spec.md` companion in the same commit | Constitution (Test Companion Docs) + code-quality.md mandate; explicit in the discussion | S:80 R:90 A:95 D:90 |

11 assumptions (7 certain, 4 confident, 0 tentative, 0 unresolved).
