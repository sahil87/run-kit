# Plan: Row Color System Overhaul — Owned Palette + Axis Split

**Change**: 260718-3prk-row-color-owned-palette-axis-split
**Intake**: `intake.md`

## Requirements

### Palette: Owned 10-Family Theme-Adapted Set

#### R1: Owned OKLCH hue families replace ANSI-derived swatches
`themes.ts` SHALL define 10 owned hue families by fixed OKLCH hue angle (red 25°, orange 55°, amber 90°, olive 120°, green 150°, teal 185°, blue 250°, purple 290°, magenta 330°, slate 250°-chroma-floored), replacing `PICKER_ANSI_INDICES` / `PICKER_BLEND_PAIRS`. Each family's rendered source hex MUST be derived from the active theme via full adoption: `OKLCH(L_theme, C_theme, ownHue)` where `L_theme`/`C_theme` are the mean OKLab L and mean chroma over `palette.ansi[1..6]`, with a chroma floor of 0.05. Slate uses `C = min(C_theme × 0.2, 0.025)`. Out-of-gamut results MUST be brought in-gamut by reducing chroma stepwise (×0.92, ≤20 iterations), never by sRGB channel clamping.

- **GIVEN** the Default Dark theme is active
- **WHEN** the palette source hexes are computed
- **THEN** each of the 10 families resolves to a valid in-gamut hex at the theme's mean L/C, and hue identity (e.g. "orange" reads orange) is preserved regardless of theme
- **AND** on a near-monochrome theme the chroma floor (0.05) keeps families distinguishable

#### R2: OKLCH→hex + in-gamut helpers added, existing OKLab reused
`themes.ts` SHALL add a small `oklchToHex(L, C, hueDeg)` helper (OKLCH → OKLab via `a = C·cos(h)`, `b = C·sin(h)`, then the existing `oklabToHex`) and an in-gamut check that detects sRGB-channel clamping, reusing the existing `hexToOklab`/`oklabToHex`/`srgbToLinear` conversions. A `themeColorStats(palette)` helper SHALL compute mean OKLab L and mean chroma over `ansi[1..6]` with the 0.05 chroma floor.

- **GIVEN** an OKLCH triple that maps outside sRGB
- **WHEN** the in-gamut reduction runs
- **THEN** chroma is reduced by ×0.92 up to 20 times until in-gamut (hue and L preserved), and the result never channel-clamps

#### R3: Downstream tint/border pipeline unchanged on new source hexes
The existing tint pipeline (`saturateHex ×1.5`, `blendHex` into background, `adjustBorderForContrast` at 3.0 min) SHALL operate on the new family source hexes unchanged. `computeRowTints`/`computeRowBorders` keep their signatures and keying by color value.

- **GIVEN** the new family palette
- **WHEN** `computeRowTints`/`computeRowBorders` run
- **THEN** they return the same `Map<string, RowTint>` / `Map<string, string>` shapes keyed by color value, consumed unchanged by window-row, session-row, server-panel

#### R4: Legacy color values resolve 1:1 to families (zero migration)
`colorValueToHex` SHALL resolve every legacy stored value (numeric `"4"` / blend `"1+3"`) to its mapped family base per the intake table (red←1, orange←1+3, amber←3, olive←1+2, green←2, teal←6, blue←4, purple←1+4, magenta←5, slate←3+4). Stored values remain the legacy vocabulary end-to-end — the swatch popover maps each pick back to its legacy descriptor on write (`familyToLegacy`) since the backend validators accept only numeric/blend forms; family names (`"orange"`) are frontend-side read aliases. No storage, API, or backend change is required for color.

- **GIVEN** a window with the stored value `"1+3"` (legacy orange blend)
- **WHEN** its tint is resolved
- **THEN** it renders the owned "orange" family (55°), identical to a window stored as `"orange"`
- **AND** the swatch popover, session tint, and server-tile tint all resolve the same way

#### R5: Swatch popover renders the 10 families + Clear
`swatch-popover.tsx` SHALL render the 10 owned families (no weight variants) plus Clear, driven by the palette's display-ordered value list — the grid layout, keyboard nav math, and Clear cell are preserved.

- **GIVEN** the popover is opened
- **WHEN** it renders
- **THEN** exactly 10 swatches + Clear appear, arrow-key navigation and Enter/Space selection behave as before

### Row Anatomy: Axis Split

#### R6: Selection = tint depth + typography, borderless
`window-row.tsx` SHALL render selection as family tint at 40% blend ratio (uncolored: gray sentinel at the existing deeper ratio) plus `font-medium` + `text-primary`, with the 4px left `borderLeft` selection cue REMOVED. Rest tint stays 14%, hover 22%. `TINT_SELECTED_RATIO` becomes 0.40.

- **GIVEN** a colored window row
- **WHEN** it becomes selected
- **THEN** its background deepens to the 40% family tint and the name bolds/brightens, with NO left accent border
- **AND** an unselected row shows the 14% rest tint (22% on hover)

#### R7: Board-pin active-board cue moves to the pin glyph
The `isPinnedToActiveBoard` 4px accent `borderLeft` branch SHALL be removed; the persistent filled pin glyph (already `opacity-100` when `isPinnedToAny`) SHALL render accent-colored when the row is pinned to the active board, monochrome (`text-text-secondary`) otherwise.

- **GIVEN** a row pinned to the currently-viewed board
- **WHEN** it renders in the SESSIONS tree
- **THEN** its pin glyph is accent-colored (no left border); a row pinned to a different board shows a monochrome filled glyph

### Left-Gutter Marker Axis

#### R8: 4-state click-to-cycle marker gutter
Each window row SHALL render a ~14px full-height left gutter (fine pointers) presenting one of 4 marker states — empty → dotted (3px dotted) → solid (3px solid) → double (6px double) — cycled on click, rendered in the row's family guarded color (gray for uncolored rows). Markers are available on ALL rows including uncolored. A gutter click MUST `stopPropagation` so it does not select the row, and MUST coexist with drag-reorder.

- **GIVEN** any window row (colored or not)
- **WHEN** the gutter is clicked repeatedly
- **THEN** the marker cycles empty→dotted→solid→double→empty, persisting each state, without selecting the row or breaking drag

#### R9: Two-stage hover affordance + `cell` cursor
Hovering the row SHALL fill the gutter at ~20% family color; hovering the gutter itself SHALL step to ~30% and ghost a faint preview of the NEXT marker state. The gutter SHALL use `cursor: cell` on hover.

- **GIVEN** a row at rest
- **WHEN** the pointer enters the row, then the gutter
- **THEN** the gutter fills to ~20%, then ~30% with a next-state ghost, and the cursor is `cell` over the gutter

#### R10: Marker persistence via `@rk_marker` window option + wake seam
Marker state SHALL persist as a tmux window user option `@rk_marker` (values `""`/`dotted`/`solid`/`double`), written through the existing unified `POST /api/windows/{windowId}/options` endpoint (added to the allowlist with its own validator), read back through `parseWindows` into `WindowInfo.Marker` and surfaced on the state-socket window payload as `marker`. The write path already wakes the SSE hub (`handleWindowOptions` → `sseHub.wake`), so the mutation repaints in one poll pass rather than the 12s safety tick.

- **GIVEN** a marker cycle POST for `@rk_marker: "solid"`
- **WHEN** the tmux write succeeds
- **THEN** the option is set, an invalid value returns 400 with zero tmux calls, the hub is woken, and the next SSE payload carries `marker: "solid"` on that window

#### R11: Marker scope is windows only
Session rows and server tiles SHALL NOT gain markers in this change. The palette change (R1–R5) still applies to all color surfaces including server tiles.

- **GIVEN** the sidebar and server tiles
- **WHEN** rendered
- **THEN** only window rows show a marker gutter; server tiles/session rows show the new owned-palette tints but no marker

### Easter Egg: Double-Marker Scanlines

#### R12: Static scanline overlay on double-marker rows
A window row whose marker is `double` SHALL render a static CRT scanline overlay across its full width: `repeating-linear-gradient(to bottom, {markerColor}~14% 0 1px, transparent 1px 3px)` layered over the tint. Pure static CSS — MUST NOT touch the status pyramid's animation channel (waiting halo stays unambiguous).

- **GIVEN** a row with marker `double`
- **WHEN** it renders at rest
- **THEN** faint scanlines cover the full row width over its tint, readable from across the sidebar

#### R13: Selected + double retro animation, reduced-motion-zeroed
When a double-marker row is ALSO selected, the scanlines SHALL animate: a slow downward crawl (`background-position-y` over the 3px period, ~1.4s linear infinite) plus an occasional CRT refresh band (a ~12px soft gradient band in the marker color rolling top→bottom, ~3.4s cycle with a rest phase) via an absolutely-positioned `::after` (`pointer-events: none`; row `position: relative; overflow: hidden`). Static again when deselected. Under `prefers-reduced-motion: reduce` the crawl and band MUST be fully zeroed (band hidden).

- **GIVEN** a double-marker row that is selected
- **WHEN** motion is allowed
- **THEN** scanlines crawl downward and a refresh band periodically rolls through
- **AND** under reduced motion both are disabled (static scanlines only, band hidden)

### Keyboard + Touch Parity

#### R14: `Window: Cycle Marker` palette action
A command-palette action `Window: Cycle Marker` SHALL cycle the current window's marker through the 4 states, following the existing window-action grammar and boundary behavior.

- **GIVEN** a focused/current window
- **WHEN** `Window: Cycle Marker` is invoked from the palette
- **THEN** that window's marker advances one state and persists (same code path as the gutter click)

#### R15: Touch — gutter inert, palette is the marker path
On coarse pointers the gutter SHALL be inert (no tap target, no cycle on scroll); the palette action is the sole touch path for markers. The owned palette still applies on touch.

- **GIVEN** a coarse (touch) pointer
- **WHEN** the user taps/scrolls near the gutter
- **THEN** no marker cycle fires; the marker is reachable only via the palette action

### Documentation

#### R16: Spec + memory reflect the new design
`docs/specs/themes.md` (human-curated) SHALL be updated to describe the owned-palette derivation replacing the ANSI-derivation design, and this MUST be flagged in the PR body. New/changed Playwright specs SHALL ship sibling `.spec.md` companions. Memory updates happen at hydrate.

- **GIVEN** the change ships
- **WHEN** the PR is opened
- **THEN** `docs/specs/themes.md` reflects the owned-palette design and the PR body flags the human-curated spec edit

### Non-Goals

- Weight variants (muted/base/vivid) — dropped in favor of the marker axis (intake Why).
- Markers on session rows or server tiles — deferred (R11).
- Any color storage/API/backend migration — legacy values resolve unchanged (R4).
- Marker on coarse-pointer gutter — palette-only on touch (R15).

### Design Decisions

1. **Marker persists via the existing `/options` allowlist, not a new endpoint**: `@rk_marker` is added to the `handleWindowOptions` allowlist (`optKeyMarker`) with a dedicated validator — *Why*: the unified options endpoint IS "the color endpoint" the intake references; it already wakes the hub and applies atomically, so reusing it honors "mirror the color endpoints" (assumption 9) with zero new surface (Constitution IV, code-quality anti-pattern "duplicating existing utilities"). *Rejected*: a bespoke `POST /api/windows/{id}/marker` handler — duplicates validation, wake, and tmux-write plumbing already present.
2. **Full theme adoption over halfway lerp**: render families at exactly the theme's mean L/C — *Why*: user approved full adoption across 9 themes in the sim. *Rejected*: 65% lerp (intake Why).
3. **In-gamut via chroma reduction, not channel clamp**: preserves hue identity — *Why*: sRGB clamping shifts hue, defeating the stable-hue goal (R1). *Rejected*: channel clamp.
4. **Scanline overlay + retro band are pure CSS utilities in `globals.css`, gated in the existing reduced-motion block**: mirrors the `rk-waiting-halo`/`rk-waiting-seam` pattern (base rule precedes the reduced-motion override so source-order wins) — *Why*: consistency with the site animation vocabulary and the reduced-motion contract (context.md).

## Tasks

### Phase 1: Backend — Marker Persistence

- [x] T001 Add a `ValidateMarkerValue` rule in `app/backend/internal/validate/validate.go` accepting only `""`/`dotted`/`solid`/`double` (empty = unset), with a unit test in `validate_test.go`. <!-- R10 -->
- [x] T002 Add `@rk_marker` to `parseWindows` in `app/backend/internal/tmux/tmux.go`: extend the `ListWindows` format string with `#{@rk_marker}`, parse it into a new `WindowInfo.Marker string \`json:"marker,omitempty"\`` field (trim; drop unknown values), and update the field-count/format comments. <!-- R10 -->
- [x] T003 Add `optKeyMarker = "@rk_marker"` to the allowlist constants + `switch` in `handleWindowOptions` (`app/backend/api/windows.go`) and a `case optKeyMarker` in `validateWindowOption` calling `ValidateMarkerValue`; treat empty string as unset (nil op) mirroring `@rk_type`. <!-- R10 -->
- [x] T004 [P] Backend tests in `app/backend/api/windows_test.go`: `@rk_marker` set/unset/invalid(400, zero tmux calls)/wake-seam, mirroring the existing `@color` cases. <!-- R10 -->
- [x] T005 [P] tmux parse test in `app/backend/internal/tmux/tmux_test.go`: `parseWindows` populates `Marker` from the new field and drops malformed values. <!-- R10 -->

### Phase 2: Frontend — Owned Palette

- [x] T006 In `app/frontend/src/themes.ts` add `oklchToHex(L, C, hueDeg)` (OKLCH→OKLab→existing `oklabToHex`), an in-gamut check (detect channel clamp on encode), and `themeColorStats(palette)` (mean OKLab L + mean chroma over `ansi[1..6]`, chroma floor 0.05). <!-- R2 --> <!-- rework: review should-fix — oklchInGamut (themes.ts:303-320) re-derives the full OKLab→LMS→linear-sRGB matrix (18 coefficients) already present in oklabToHex (:229-236). Extract a shared oklabToLinearRgb(c) helper consumed by both so the coefficients can't drift. -->
- [x] T007 Replace `PICKER_ANSI_INDICES`/`PICKER_BLEND_PAIRS` with a 10-family definition (name→hue angle + legacy-value alias) in `themes.ts`; define the display-ordered `PICKER_COLOR_VALUES` over family names and a legacy→family alias map. Family source hex = adopted OKLCH via T006, gamut-reduced; slate uses `C = min(C_theme × 0.2, 0.025)`. <!-- R1 -->
- [x] T008 Rewrite `colorValueToHex` in `themes.ts` to resolve a family name OR a legacy numeric/blend alias to the family's adopted source hex (1:1 legacy map, R4); keep `parseColorValue`/`formatColorValue` accepting both forms. Ensure `computeRowTints`/`computeRowBorders` keep their signatures and consume the new source hexes (R3). <!-- R4 --> <!-- rework: review must-fix 2 — legacy stored colors render uncolored: computeRowTints/computeRowBorders (themes.ts:513, :550) key ONLY family names (+ the "8" sentinel), but consumers look up the RAW stored value (window-row.tsx:180/:196, session-row.tsx:117, server-panel.tsx:156/:165). The backend only ever emits legacy forms ("4", "1+3") today, so every pre-existing colored row loses tint/border, and a SELECTED legacy-colored row renders NO background (gray sentinel gated on color == null). FIX: key BOTH vocabularies in the two maps (legacy alias keys point at the same tint/border entries) so consumers stay untouched; keep the exported resolveFamily for the popover highlight. -->
- [x] T009 [P] Update `app/frontend/src/themes.test.ts`: cover `oklchToHex`, `themeColorStats` (mean/floor), gamut reduction, the 10-family value list, and legacy alias→family resolution (`"1+3"` → orange === `"orange"`). <!-- R1 R2 R4 -->

### Phase 3: Frontend — Row Anatomy + Marker Gutter

- [x] T010 In `app/frontend/src/components/swatch-popover.tsx` render from the new `PICKER_COLOR_VALUES` (10 families + Clear); verify grid/keyboard-nav math still holds for 10 items. Also normalize a legacy `selectedColor` to its family so the right swatch highlights. <!-- R5 --> <!-- rework: review must-fix 1 — color WRITE path broken end-to-end: the popover emits family names ("orange") as the stored value, but the backend validators were never extended — validate.ValidateColorValue (validate.go:42; called from windows.go:366, sessions.go:103, settings.go:119) rejects non-numeric values, so EVERY color pick from the UI 400s; NormalizeColorValue on the read seams (tmux.go:802/:616, settings.go:118) silently DROPS family names. FIX (decided): map family→legacy descriptor at the write seam — onSelect emits the family's legacy alias ("orange" → "1+3") so stored values remain the legacy vocabulary end-to-end, zero backend change, honoring R4's zero-migration promise. All UI write paths (window rows, session rows, server tiles, palette "Set Color" actions) must go through this mapping; verify each. -->
- [x] T011 In `app/frontend/src/components/sidebar/window-row.tsx`: remove the `borderLeft` selection cue and the `isPinnedToActiveBoard` border branch; make selection = 40% tint + `font-medium` + `text-primary`; render the pin glyph accent-colored when `isPinnedToActiveBoard` (monochrome otherwise). <!-- R6 R7 -->
- [x] T012 Set `TINT_SELECTED_RATIO = 0.40` in `themes.ts` (rest 0.14/hover 0.22 unchanged; uncolored-selected ratio unchanged). <!-- R6 -->
- [x] T013 Add the marker gutter to `window-row.tsx`: a ~14px full-height left element rendering the 4-state marker (dotted/solid/double borders in the row's guarded color, gray uncolored), click-to-cycle with `stopPropagation`, coexisting with drag; two-stage hover fill (row ~20% / gutter ~30% + next-state ghost) and `cursor: cell`; inert on coarse pointers (R15). Read `win.marker`. <!-- R8 R9 R11 R15 --> <!-- rework: review must-fix 3 — the 14px z-20 gutter OVERLAYS the interactive StatusDot: with pl-2 (8px) the 7px dot sits at x≈8-15px under the gutter, so hovering the dot shows the gutter affordance instead of the StatusDotTip hover-card, and clicking the dot area silently writes a marker cycle instead of selecting the row. FIX: pad button content clear of the gutter (e.g. pl-[18px] or equivalent in-flow layout) so dot + text start after GUTTER_WIDTH. Also (nice-to-have picked up): the gutter div carries role="button" + a comment claiming keyboard interactivity but has no tabIndex/keydown — deliberate per intake #12 (palette is the keyboard path); fix the comment and drop the misleading role or make the ARIA honest. -->
- [x] T014 Thread the marker: add `marker?: string` to `WindowInfo` in `app/frontend/src/types.ts`; add a `setWindowMarker(server, windowId, marker|null)` client fn in `app/frontend/src/api/client.ts` (via `setWindowOptions({"@rk_marker": ...})`); wire an `onMarkerChange`/cycle handler alongside the existing `onColorChange` handler in the sidebar (`components/sidebar/index.tsx` + prop-drill through `ServerGroup`) and pass it to `WindowRow`. <!-- R8 R10 -->

### Phase 4: Frontend — Easter Egg + Palette Action

- [x] T015 Add scanline + retro-band CSS utilities to `app/frontend/src/globals.css`: `.rk-scanlines` (static `repeating-linear-gradient` via `::before`, ~14% marker color via `--rk-marker-color`), `.rk-scanlines-crawl::before` (`background-position-y` ~1.4s linear infinite) and a `::after` refresh band (~3.4s cycle w/ rest, `pointer-events:none`); base rules PRECEDE the reduced-motion block, then add crawl/band `animation:none` + band hidden inside the existing `@media (prefers-reduced-motion: reduce)` block. <!-- R12 R13 -->
- [x] T016 Apply the scanline classes in `window-row.tsx`: `double` marker → `.rk-scanlines`; `double` AND selected → add `rk-scanlines-crawl`; pass the marker color via the `--rk-marker-color` CSS custom property. <!-- R12 R13 --> <!-- rework: review must-fix 4 — overflow-hidden on the row ROOT clips the PinPopover and SwatchPopover (absolute top-full children of the row div, window-row.tsx:409/:421): on a selected+double row both popovers become invisible/unusable. FIX: never put overflow-hidden on the row root — clip the CRT band inside a dedicated absolutely-positioned inner overlay element (inset-0, overflow-hidden, pointer-events-none) that hosts the ::before/::after scanline+band pseudos, leaving the row root free to overflow for popovers. -->
- [x] T017 Register the `Window: Cycle Marker` command-palette action (in `app.tsx` `windowActions`, alongside `Window: Set Color`), resolving the current window and calling `nextMarkerState`→`setWindowMarker` (same path as the gutter click). <!-- R14 -->

### Phase 5: Tests + Docs

- [x] T018 [P] Unit tests: `swatch-popover.test.tsx` (10 families + Clear) and `window-row.test.tsx` (no selection border; selected = 40% tint + bold; pin glyph accent when pinned-to-active-board; marker gutter cycle click stopPropagation; scanlines on double; gutter inert on coarse). <!-- R5 R6 R7 R8 R12 R15 -->
- [x] T019 e2e coverage in `app/frontend/tests/`: a spec exercising gutter marker cycling + selection rendering (borderless 40% tint), with a sibling `.spec.md` companion per constitution. <!-- R6 R8 --> <!-- rework: review should-fix — the "deep tint with no left border" test sets @color orange via the tmux CLI, which the backend's NormalizeColorValue drops on read, so it actually exercises an UNCOLORED selected row (masking must-fix 2) while its .spec.md claims a family tint renders. After the vocabulary fix: set the color through the API using the stored (legacy) vocabulary, assert the ACTUAL tint background renders, and update the .spec.md to match. -->
- [x] T020 Update `docs/specs/themes.md` to describe the owned-palette derivation (mean L/C adoption, chroma floor, gamut reduction, 10 families, legacy 1:1 map) replacing the ANSI-derivation picker design; note the axis split (hue=label / tint=selection / gutter marker) and the `@rk_marker` option. <!-- R16 -->

## Execution Order

- Phase 1 (backend) is independent of Phases 2–4 and can proceed first; T001 blocks T003; T002 blocks T005.
- T006 blocks T007 blocks T008; T009 follows T008.
- T007/T008 (palette value list) block T010 (popover) and T013 (gutter guarded color).
- T014 (types + client + handler) blocks T013's marker read/write and T017's palette action.
- T015 (CSS utilities) blocks T016.
- Phase 5 follows the implementation it tests.

## Acceptance

### Functional Completeness

- [x] A-001 R1: 10 owned OKLCH hue families (angles per intake) replace the ANSI picker machinery and render adopted at the theme's mean L/C with the 0.05 chroma floor and slate chroma rule.
- [x] A-002 R2: `themes.ts` exports `oklchToHex` + an in-gamut check + `themeColorStats`, reusing the existing OKLab conversions; unit-tested.
- [x] A-003 R3: signatures/shapes kept; `computeRowTints`/`computeRowBorders` now key BOTH vocabularies (family name + legacy descriptor at the same entry, unit-tested `tints.get("1+3") === tints.get("orange")`), so window-row/session-row/server-panel raw-value lookups hit for every stored value. *(Rework-verified.)*
- [x] A-004 R4: `resolveFamily`/`colorValueToHex` resolve legacy values 1:1 AND the render seams now hit via the dual-key maps; the write seam (`SwatchPopover.emit` → `familyToLegacy`) maps picked family names to legacy descriptors so every color-pick surface (window/session/server rows + palette Set Color) stores the vocabulary the untouched backend validators accept — zero backend change, e2e-proven end-to-end with `@color "1+3"`. *(Rework-verified.)*
- [x] A-005 R5: the swatch popover shows exactly 10 families + Clear with working keyboard nav.
- [x] A-006 R8: the marker gutter cycles empty→dotted→solid→double on click, on all rows, without selecting the row or breaking drag.
- [x] A-007 R10: `@rk_marker` persists via the `/options` allowlist, reads back onto the window payload as `marker`, and the hub is woken on write.
- [x] A-008 R14: `Window: Cycle Marker` palette action cycles the current window's marker via the shared handler.

### Behavioral Correctness

- [x] A-009 R6: borderless 40%-tint + bold selection correct for BOTH vocabularies — the dual-key tint maps make legacy-stored colors (every pre-existing colored row) resolve their family tint, including the selected state (e2e asserts a real painted tint on a `"1+3"`-stored selected row, 0px left border, font-weight ≥ 500). *(Rework-verified.)*
- [x] A-010 R7: the active-board cue renders as an accent-colored pin glyph (no left border); other-board pins are monochrome filled.
- [x] A-011 R9: row hover fills the gutter ~20%, gutter hover steps to ~30% with a next-state ghost, cursor is `cell`.
- [x] A-012 R12: a `double` marker row shows static full-width scanlines over its tint.
- [x] A-013 R13: selected + double animates (crawl + refresh band); reverts to static on deselect.
- [x] A-014 R11: only window rows get markers; server tiles/session rows show new tints but no marker.

### Scenario Coverage

- [x] A-015 R8 R6: `window-marker-gutter.spec.ts` (+ updated `.spec.md`) exercises gutter cycling, no-select, AND the real family-tint half: the deep-tint test now sets `@color "1+3"` through the `POST /options` API (the stored legacy vocabulary) and polls the selected row's computed background until an actual tint paints (not `rgba(0,0,0,0)`), alongside the 0px-border and bold assertions. 3/3 green on the isolated e2e server. *(Rework-verified.)*
- [x] A-016 R5 R7: unit tests cover the 10-family popover, borderless selection, and accent pin glyph.

### Edge Cases & Error Handling

- [x] A-017 R10: an invalid `@rk_marker` value returns 400 with zero tmux calls; absent option = empty marker state.
- [x] A-018 R1: near-monochrome themes stay distinguishable (chroma floor); out-of-gamut families reduce chroma (no hue-shifting channel clamp).
- [x] A-019 R15: on coarse pointers the gutter is inert (no cycle on tap/scroll); the palette action still works.
- [x] A-020 R13: under `prefers-reduced-motion: reduce` the crawl and refresh band are fully zeroed (static scanlines only, band hidden).

### Code Quality

- [x] A-021 Pattern consistency: marker persistence reuses the `/options` allowlist + wake seam and the `WindowOptionOp` primitive; no bespoke marker endpoint; frontend follows the existing color prop-drill and palette-action patterns.
- [x] A-022 No unnecessary duplication: OKLCH helpers reuse existing `hexToOklab`/`oklabToHex`/`srgbToLinear`; scanline/animation utilities follow the `rk-*` + reduced-motion gate convention. The former residual is resolved: the shared `oklabToLinearRgb` helper now feeds BOTH `oklabToHex` and `oklchInGamut`, so the 18 matrix coefficients cannot drift. *(Rework-verified.)*
- [x] A-023 Security: `@rk_marker` is validated before any `tmux set-option`; all tmux calls remain argv-sliced via `exec.CommandContext` (Constitution I).
- [x] A-024 Type narrowing: new frontend code prefers guards/discriminated forms over `as` casts (code-quality Principles).
- [x] A-025 Test companion docs: any new/changed `*.spec.ts` ships an updated sibling `*.spec.md` in the same commit (constitution).

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- `app/frontend/src/themes.ts` `parseColorValue` / `formatColorValue` — zero production call sites after the owned-palette rewrite (only unit tests import them; the popover and rows resolve via `resolveFamily`/`colorValueToHex`/`familyToLegacy` directly). The legacy-vocabulary decision has settled (stored values stay legacy; family names are frontend read aliases), so these can be de-exported or deleted alongside their tests.
- `app/frontend/scripts/audit-swatch-colors.ts` — the 70-theme ANSI blend-distinctness audit script existed to lock `PICKER_BLEND_PAIRS`, which this change deleted; it now imports the removed `PICKER_ANSI_INDICES` export (broken at runtime, invisible to `tsc` — `scripts/` is outside the tsconfig `include`). Dev-time evidence for a removed mechanism; delete.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | `@rk_marker` persists via the existing unified `POST /api/windows/{id}/options` allowlist (new `optKeyMarker` + validator) rather than a bespoke endpoint | The unified options endpoint IS the color endpoint the intake's "mirror the color endpoints" refers to; it already wakes the hub and writes atomically via `WindowOptionOp`. Reuse over duplication (code-quality anti-pattern; Constitution IV). Fully derivable from the existing pattern | S:90 R:85 A:95 D:85 |
| 2 | Certain | `oklchToHex` implemented as OKLCH→OKLab (`a=C·cos h`, `b=C·sin h`) → existing `oklabToHex`; in-gamut check = detect channel clamp on encode | Standard OKLCH↔OKLab identity; `themes.ts` already ships the OKLab conversions and encoder. Only correct construction available | S:85 R:80 A:95 D:90 |
| 3 | Certain | New per-window `marker` field threads through `WindowInfo` (Go + TS) and the existing `sd.windows` pass-through to the state payload — no new socket event | Colors already flow this exact way (`WindowInfo.Color` → `ProjectSession.Windows`); marker is a sibling field. Principle II derive-at-request preserved | S:90 R:85 A:95 D:90 |
| 4 | Certain | Scanline + retro-band shipped as `rk-*` CSS utilities in `globals.css`, gated in the existing `prefers-reduced-motion` block (base rule precedes override) | Mirrors `rk-waiting-halo`/`rk-waiting-seam` exactly; the intake mandates reduced-motion zeroing and the site vocabulary lives in `globals.css` | S:90 R:85 A:90 D:90 |
| 5 | Certain | `Window: Cycle Marker` palette action registered in the same site as the existing window color/rename palette actions, calling the shared cycle handler | Constitution V mandates keyboard parity; naming/site follow the existing window-action grammar. Shared handler avoids logic divergence from the gutter click | S:85 R:90 A:95 D:90 |

5 assumptions (5 certain, 0 confident, 0 tentative).
