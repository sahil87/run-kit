# Plan: Label Picker Markers & Shades

**Change**: 260723-wwoi-label-picker-markers-shades
**Intake**: `intake.md`

## Requirements

### Frontend: Marker vocabulary (themes.ts)

#### R1: Two new marker states in display order
`MARKER_STATES` in `app/frontend/src/themes.ts` MUST become `["", "dotted", "dashed", "solid", "double", "thick"]` (empty first, then the user-specified display order dotted → dashed → solid → double → thick). `markerStripeStyle(state, color)` MUST render: dashed = 3px-wide column of 8px dashes / 4px gaps (12px period), thick = 6px continuous solid bar (`borderLeft: 6px solid`). Semantics (dashed = "working", thick = "completed") are label conventions only — NO wiring to `@rk_agent_state` or the status pyramid. NO new animations in any state.

- **GIVEN** a window row whose `@rk_marker` is `dashed`
- **WHEN** the sidebar renders the row's left-edge stripe
- **THEN** the stripe is a static 3px column with an 8px-dash/4px-gap rhythm in the guarded family color
- **AND** a `thick` row renders a static 6px solid bar

#### R2: Fixed one-period stripe tiles (latent tile-height bug fix)
`markerStripeStyle` gradient cases MUST use one-period fixed tiles with plain `linear-gradient` + `backgroundRepeat: "repeat-y"` — dotted: `linear-gradient(to bottom, ${color} 0 3px, transparent 3px 6px)`, `backgroundSize: "3px 6px"`; dashed: `linear-gradient(to bottom, ${color} 0 8px, transparent 8px 12px)`, `backgroundSize: "3px 12px"` — replacing the element-height-dependent `repeating-linear-gradient` + `3px 100%` + `no-repeat` form, so the rhythm is correct at ANY element height (e.g. 18px picker preview cells) while row rendering stays pixel-identical (6px and 12px periods divide the 24/36px row heights exactly).

- **GIVEN** a dotted or dashed stripe rendered in an 18px-tall element
- **WHEN** the background tiles vertically
- **THEN** the dash rhythm continues uninterrupted across the tile boundary (no truncated period)

### Backend: Marker closed set (validate.go, tmux.go)

#### R3: Backend accepts dashed and thick
`MarkerValues` in `app/backend/internal/validate/validate.go` MUST gain `"dashed"` and `"thick"`; `ValidateMarkerValue`'s error copy MUST become `"Marker must be one of: dotted, dashed, solid, double, thick (or empty to clear)"`. The two `@rk_marker` closed-set doc comments in `app/backend/internal/tmux/tmux.go` (WindowInfo.Marker field ~line 473, parseWindows ~line 821) MUST list the 5-state set.

- **GIVEN** a `POST /api/windows/{id}/options` write of `@rk_marker: "thick"` (or `"dashed"`)
- **WHEN** the handler validates the value
- **THEN** validation passes, the option persists, and `parseWindows` surfaces it on the window payload
- **AND** an out-of-set token (e.g. `"Dotted"`, `"none"`) is still rejected

### Frontend: Hazard-wedge row texture (globals.css, window-row.tsx)

#### R4: Static hazard wedge paired with thick
A `thick`-marked window row MUST render a static "hazard wedge" background via a `.rk-hazard` block in `app/frontend/src/globals.css` beside the scanlines block, with exactly the approved geometry: `::before` overlay, 45° weave of the guarded marker color (`--rk-marker-color`) at 13% alpha via `color-mix`, 12px square tile (adjacent thick rows weld), and a `mask-image: linear-gradient(to right, #000, transparent 38%)` (+ `-webkit-` twin) confining it to a left-edge wedge. It MUST NEVER be animated in any state (rest, hover, selected). `window-row.tsx` MUST render it as a dedicated absolutely-positioned inner overlay element (`inset-0`, `overflow-hidden`, `pointer-events-none`, `z-[5]` — above tint, below the z-10 icon cluster / z-20 gutter), NEVER `overflow-hidden` on the row root (would clip the `top-full` popovers), and MUST set `--rk-marker-color` inline for `thick` rows exactly as it already does for `double`. No `prefers-reduced-motion` gate is needed (static), but the reduced-motion audit block MUST note it.

- **GIVEN** a window row with `marker: "thick"` and a family color
- **WHEN** the row renders (selected or not)
- **THEN** a `.rk-hazard` inner overlay paints the left-edge wedge in the family color, the row root carries no `overflow-hidden`, and no animation class/keyframe is ever applied to it

### Frontend: Color shade axis (themes.ts)

#### R5: Normal + dark shades (20 values), zero migration
Each of the 10 `HUE_FAMILIES` MUST gain a dark variant rendered at `L_dark = themeColorStats(palette).L − 0.14` (same hue, same chroma — slate keeps its near-neutral chroma rule — gamut-reduced via the existing `oklchToHexInGamut`). The normal shade MUST stay the existing rendering (mean L) so every existing stored color maps to the normal shade untouched. `PICKER_COLOR_VALUES` MUST become the 20 display values in paired order (`red, red-dark, orange, orange-dark, … slate, slate-dark`). `resolveFamily` / `colorValueToHex` / `parseColorValue` MUST accept `-dark`-suffixed names; `formatColorValue` MUST emit the `-dark` form for dark shades. `computeRowTints` / `computeRowBorders` MUST compute entries for all 20 values (dark source hex → same ×1.5 saturate → same 14/22/40% blend ratios; borders through the same WCAG guardrail), keyed under every stored vocabulary form: family name + legacy descriptor for normal shades, `{family}-dark` for dark shades (no legacy form exists), plus the `"8"` sentinel. `familyToLegacy` MUST keep mapping normal-shade picks to the legacy numeric vocabulary and MUST pass dark picks through unchanged (stored as `"{family}-dark"`).

- **GIVEN** a stored window color `"blue-dark"`
- **WHEN** the sidebar looks up `rowTints.get("blue-dark")` / `rowBorders.get("blue-dark")`
- **THEN** both maps hit, and the resolved hex has blue's hue at the theme mean-L − 0.14 (gamut-reduced)
- **AND** a stored legacy `"4"` still resolves to the untouched normal blue rendering

### Backend: Color family-name vocabulary (validate.go)

#### R6: Backend accepts family names + -dark variants
`ValidateColorValue` / `NormalizeColorValue` MUST additionally accept the family-name vocabulary — the 10 family names (`red`…`slate`) and their `-dark` variants — alongside the existing numeric/blend forms. Existing numeric values MUST remain valid forever (read + write). Family-name values normalize to their trimmed verbatim form. The same shared rule serves window, session, and server color handlers, so all pick up the vocabulary transparently.

- **GIVEN** a `POST` write of color `"blue-dark"` (window/session/server handler)
- **WHEN** the handler validates it
- **THEN** validation passes, `NormalizeColorValue("blue-dark")` returns `("blue-dark", true)`, and `parseWindows` surfaces the stored value
- **AND** `"4"`, `"1+3"` stay valid; `"bluish"`, `"blue-light"` are rejected

### Frontend: Picker rebuild (swatch-popover.tsx)

#### R7: Paired grid + live marker row previews (Variant C)
`swatch-popover.tsx` MUST rebuild its layout: (a) **color grid** — 20 swatches, 4-wide, pairs adjacent (`normal | dark` side by side, row 1: red, red-dark, orange, orange-dark; …), 5 color rows + the full-width `Clear color` row = 6 grid rows; (b) **swatches** — uniform solid 18×18px squares (single fill = the value's selected-tint blend; no split base/selected halves), ✓ glyph + bright ring on the selected swatch (unambiguous between adjacent same-family shades); (c) **marker column** — 6 cells (∅ + the 5 states in display order), restoring the 1:1 marker-cell ↔ grid-row pairing DELIBERATELY (the old "LOAD-BEARING COINCIDENCE" comment is superseded by a documented invariant `GRID_ROWS === MARKER_CELLS.length`); (d) **marker cells are live row previews** — each non-∅ cell renders as a miniature window row for the currently selected color: background = that value's `tint.base` (gray sentinel when uncolored), stripe in the guarded border color with a 2px left inset, plus the paired row texture (hazard wedge on thick, static scanline wash on double); picking a different swatch repaints the marker column immediately; (e) **preview cells NEVER animate** — no scanline crawl even when the double cell is selected; (f) **keyboard grid** — conceptual 5-col × 6-row grid (marker col 0 + 4 color cols; Clear spans cols 1–4 of row 0), clamping rules preserved, no dead cells (20 colors fill 5×4 exactly); (g) the color-only variant (`onSelectMarker` absent) gets the same 20-swatch paired grid without the marker column.

- **GIVEN** the combined Label picker open on an uncolored window
- **WHEN** the user clicks the `blue-dark` swatch
- **THEN** `onSelect` receives `"blue-dark"` (passthrough — no legacy form) and the 5 marker preview cells repaint to blue-dark's `tint.base` / guarded stripe color
- **AND** the thick cell shows a static hazard wedge, the double cell a static scanline wash, and no cell ever carries `rk-scanlines-crawl`

### Tests & docs

#### R8: Test coverage + e2e chrome updates
Unit tests MUST cover the added/changed behavior: `themes.test.ts` (new marker cases, tile fix, dark-variant derivation + gamut, vocabulary resolution round-trip), `swatch-popover.test.tsx` (6-cell marker column, 20 swatches, preview repaint on color pick, keyboard grid), `validate_test.go` (new marker + color vocabularies, legacy still valid), `window-row.test.tsx` (thick hazard overlay wiring). The e2e spec asserting picker/marker chrome (`app/frontend/tests/e2e/window-marker-gutter.spec.ts`) MUST be updated for the new DOM (Playwright's substring accessible-name matching makes `Color orange` ambiguous against `Color orange-dark` — use `exact: true`) and extended to the new marker states, with its `.spec.md` companion updated in the same commit (constitution § Test Companion Docs). `fab/project/context.md`'s hover-animation vocabulary line needs no change (no new animations).

- **GIVEN** the full test gates (`just test-backend`, `npx tsc --noEmit`, `just test-frontend`, the scoped e2e spec)
- **WHEN** run after implementation
- **THEN** all pass, and the e2e spec + `.spec.md` companion describe the 5-state marker set and the 20-swatch paired grid

### Non-Goals

- No functional wiring of dashed/thick to `@rk_agent_state` or the status pyramid — explicitly deferred by the user
- No new animations anywhere (binding rejections: worker-stream dashed animation, progress seam, barber-pole thick, animated hazard weave, phosphor bleed) — the shipped double-marker scanline crawl + CRT band remains the only motion
- No light shade variant (replaced by normal+dark so existing colors map unchanged)
- No storage/API shape changes, no migrations — vocabulary widening is additive

### Design Decisions

#### Shade carried on PickerColor, not a parallel vocabulary
**Decision**: Extend `PickerColor` to `{ family, shade }` with `formatColorValue` emitting `"{family}-dark"`, rather than minting 10 new pseudo-families.
**Why**: Hue identity, legacy mapping, and theme adaptation stay properties of the 10 `HUE_FAMILIES`; the shade is a render-time L offset, so zero new palette data and every family-keyed code path (tints, borders, accent) derives dark variants for free.
**Rejected**: 20 `HueFamily` entries — duplicates hue/legacy data and breaks the 1:1 legacy map (dark variants have no legacy form).
*Introduced by*: 260723-wwoi-label-picker-markers-shades

#### Marker preview color held as picker-local state
**Decision**: The marker-preview color derives from `selectedColor` but a swatch pick also updates picker-local preview state before emitting.
**Why**: The intake requires "picking a different swatch repaints the marker column immediately"; the window-row caller closes the popover on pick, so prop-driven repaint alone would make the requirement vacuously untestable — local state makes it true for any caller.
**Rejected**: Prop-only derivation — repaint would depend on the caller keeping the popover open and re-rendering.
*Introduced by*: 260723-wwoi-label-picker-markers-shades

## Tasks

### Phase 1: Core vocabulary (frontend theme model + backend closed sets)

- [x] T001 `app/frontend/src/themes.ts`: extend `MARKER_STATES` to the 6-state display order and rewrite `markerStripeStyle` with the dashed/thick cases and the fixed one-period tiles (dotted `3px 6px`, dashed `3px 12px`, `linear-gradient` + `repeat-y`); update doc comments (semantics note, tile-height rule) <!-- R1 R2 -->
- [x] T002 `app/frontend/src/themes.ts`: add the shade axis — `Shade` type, `-dark` suffix parsing in `resolveFamily`/`parseColorValue`/`formatColorValue`, dark rendering in `colorValueToHex` (mean-L − 0.14, same chroma rules, gamut-reduced), `PICKER_COLOR_VALUES` = 20 paired values, `computeRowTints`/`computeRowBorders` entries for all 20 (dark keyed as `{family}-dark` only), `familyToLegacy` passthrough documented for dark picks <!-- R5 -->
- [x] T003 [P] `app/backend/internal/validate/validate.go`: add `"dashed"`/`"thick"` to `MarkerValues` + new error copy; accept the family-name vocabulary (10 names + `-dark` variants, trimmed verbatim canonical form) in `ValidateColorValue`/`NormalizeColorValue`; update the two `@rk_marker` closed-set doc comments in `app/backend/internal/tmux/tmux.go` (~473, ~821) <!-- R3 R6 -->

### Phase 2: UI (hazard wedge + picker rebuild)

- [x] T004 `app/frontend/src/globals.css`: add the `.rk-hazard::before` block (verbatim intake CSS: 45° weave, 13% `color-mix` of `--rk-marker-color`, 12px tile, 38% right-fade mask) beside the scanlines block, with a never-animated comment + a reduced-motion audit note <!-- R4 -->
- [x] T005 `app/frontend/src/components/sidebar/window-row.tsx`: wire `thick` — set `--rk-marker-color` inline for thick rows (as for `isDouble`) and render the dedicated `.rk-hazard` inner overlay (`absolute inset-0 z-[5] overflow-hidden pointer-events-none`); row root stays overflow-free <!-- R4 -->
- [x] T006 `app/frontend/src/components/swatch-popover.tsx`: rebuild — 20-swatch paired grid (uniform solid `tint.selected` fill, ✓ + bright ring on selected, `-dark` aware selection normalization), 6-cell marker column as live row previews (`tint.base` background w/ gray sentinel fallback, guarded stripe color with 2px left inset, static `rk-hazard`/`rk-scanlines` textures on thick/double, local preview state repaint), 5×6 keyboard grid with no dead cells, documented `GRID_ROWS === MARKER_CELLS.length` invariant replacing the coincidence comment, color-only variant = same grid minus marker column <!-- R7 -->

### Phase 3: Tests (unit + e2e per test-alongside strategy)

- [x] T007 [P] `app/frontend/src/themes.test.ts`: update PICKER/tint/border count expectations (20 values, 31-entry maps); add `markerStripeStyle` cases (all 6 states, fixed tiles), dark-variant derivation (hue preserved, L lowered, in-gamut, slate near-neutral), vocabulary round-trip (`parseColorValue`/`formatColorValue`/`resolveFamily`/`familyToLegacy`/`colorValueToHex` on `-dark` forms) <!-- R1 R2 R5 R8 -->
- [x] T008 [P] `app/backend/internal/validate/validate_test.go`: extend `TestValidateMarkerValue` (dashed/thick valid, near-misses invalid) and `TestValidateColorValue`/`TestNormalizeColorValue` (family names + `-dark` valid and canonical, legacy numeric still valid, `blue-light`/`bluish` invalid) <!-- R3 R6 R8 -->
- [x] T009 `app/frontend/src/components/swatch-popover.test.tsx`: update option counts (21 color-only / 27 combined), marker-cell order (6 cells), keyboard-grid indices for the 5×6 grid; replace the theme-foreground stripe test with live-preview tests (tint.base background, guarded stripe, sentinel when uncolored, repaint on pick, static textures, no crawl class); assert the `GRID_ROWS`↔`MARKER_CELLS` invariant <!-- R7 R8 -->
- [x] T010 `app/frontend/src/components/sidebar/window-row.test.tsx`: add thick-row cases — hazard overlay on a clipped inner element (never the root), `--rk-marker-color` set, no overlay on non-thick rows, no animation class <!-- R4 R8 -->
- [x] T011 `app/frontend/tests/e2e/window-marker-gutter.spec.ts` + `window-marker-gutter.spec.md`: `exact: true` on color-option locators (disambiguate `-dark` labels), extend the marker test through `dashed`/`thick` persistence, document the 5-state set + 20-swatch grid in the companion <!-- R8 -->

### Phase 4: Verification

- [x] T012 Run the gates: `just test-backend`, `cd app/frontend && npx tsc --noEmit`, `just test-frontend`, scoped e2e `just pw test window-marker-gutter`, then `just build` <!-- R8 -->

## Execution Order

- T001 → T002 (same file; shade axis builds on the marker rewrite landing first)
- T002 blocks T006/T007 (picker + tests consume the 20-value vocabulary)
- T004 blocks T005/T006 (overlay class must exist before wiring/preview reuse)
- T003 blocks T008; T011 runs after T003 + T006 (needs backend vocab + new DOM)
- T012 last

## Acceptance

### Functional Completeness

- [x] A-001 R1: `MARKER_STATES` is `["", "dotted", "dashed", "solid", "double", "thick"]` and `markerStripeStyle` renders dashed (3px, 8/4px rhythm) and thick (6px solid) statically
- [x] A-002 R2: dotted/dashed stripes use one-period fixed tiles (`3px 6px` / `3px 12px`, `linear-gradient` + `repeat-y`) — no element-height-dependent tile remains
- [x] A-003 R3: backend accepts `@rk_marker` `dashed`/`thick` (closed set of 5 + empty), error copy lists all five states, tmux.go doc comments updated
- [x] A-004 R4: thick rows render the static `.rk-hazard` left-edge wedge via a dedicated clipped inner overlay with `--rk-marker-color` set; row root never clips
- [x] A-005 R5: 20 paired `PICKER_COLOR_VALUES`; dark variants derive at mean-L − 0.14 (hue/chroma preserved, gamut-reduced); tints/borders keyed under family name + legacy + `-dark` forms; existing stored values resolve unchanged
- [x] A-006 R6: `ValidateColorValue`/`NormalizeColorValue` accept the 20 family-name forms alongside numeric/blend; legacy numeric remains valid
- [x] A-007 R7: picker renders the paired 20-swatch grid (uniform solid swatches) + 6-cell marker column of live row previews; color-only callers get the marker-less variant

### Behavioral Correctness

- [x] A-008 R7: marker preview cells repaint immediately on a swatch pick (tint.base background + guarded stripe of the picked value; gray sentinel when uncolored)
- [x] A-009 R5: normal-shade picks still write legacy descriptors (`familyToLegacy`); dark picks write `"{family}-dark"` verbatim (passthrough)
- [x] A-010 R4: the hazard wedge is never animated — no keyframes reference `.rk-hazard`, and preview cells never carry `rk-scanlines-crawl`

### Scenario Coverage

- [x] A-011 R1: unit tests cover all 6 `markerStripeStyle` states; e2e covers `dashed`/`thick` persistence through the picker → `@rk_marker` round-trip
- [x] A-012 R5: unit tests cover the `-dark` vocabulary round-trip (parse → format → hex → tints/borders) and gamut safety across all themes
- [x] A-013 R7: keyboard-grid tests cover the 5×6 grid (hairline crossing, marker column traversal to thick, Clear spanning row 0, edge clamping, no dead cells)

### Edge Cases & Error Handling

- [x] A-014 R6: out-of-vocabulary color values (`"blue-light"`, `"bluish"`, `"red-dark "` inner forms) are rejected/normalized per the trimmed-verbatim rule; malformed numeric forms still rejected
- [x] A-015 R3: near-miss marker tokens (`"Dashed"`, `"THICK"`, `" thick "`) remain invalid (case-sensitive closed set, no whitespace tolerance)

### Code Quality

- [x] A-016 Pattern consistency: new code follows the shipped scanlines/axis-split patterns (overlay-owns-clip, guarded family color, write-seam funneling, `rk-*` utility classes)
- [x] A-017 No unnecessary duplication: stripe vocabulary stays solely in `markerStripeStyle`; tints/borders/vocabulary logic stays in `themes.ts`; backend closed sets stay in `internal/validate`
- [x] A-018 Type narrowing over assertions: shade parsing uses guards/discriminated shapes, no `as` casts beyond the existing CSS-custom-property pattern
- [x] A-019 e2e spec changes ship with their `.spec.md` companion updated in the same commit (constitution § Test Companion Docs)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`
- Gate note (T012): `just build`'s final version-stamp step fails on ANY checkout — `scripts/build.sh:19` still reads the `VERSION` file deleted by the tag-driven release port (#193); pre-existing on main, unrelated to this change. The build's substantive halves both pass here: `pnpm build` (tsc + vite) succeeded and `go build ./cmd/rk` compiles clean.
- Gate note: the e2e run logs a pre-existing "Maximum update depth exceeded" console-error spam — reproduced identically on a clean tree (71 occurrences with this change stashed), unrelated to this change.

## Deletion Candidates

None — this change is purely additive (widens the marker + color vocabularies and rebuilds the picker layout). The superseded fragments were already replaced in place, not left behind: the split base/selected swatch spans (now one uniform fill), the `repeating-linear-gradient` dotted tile (now a one-period `repeat-y` tile), and the "LOAD-BEARING COINCIDENCE" comment (now the documented `GRID_ROWS === MARKER_CELLS.length` invariant). `resolveFamily` is no longer called by `swatch-popover.tsx` (it moved to `parseColorValue`/`formatColorValue`) but remains a used exported hue-identity helper (tests + public API) — not a deletion candidate.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | `PickerColor` extended to `{ family, shade }`; `formatColorValue` emits `"{family}-dark"` for dark shades | Intake requires parse/resolve to accept `-dark` names and the picker to highlight the exact shade; a shade field is the minimal shape that surfaces it — no external consumers of `PickerColor` exist outside tests | S:80 R:85 A:90 D:85 |
| 2 | Certain | Dark tints/borders keyed only under `"{family}-dark"` (maps: 10×2 normal + 10 dark + sentinel = 31 entries) | Intake: "Maps stay keyed under every stored vocabulary form" and dark picks have no legacy form — the stored form IS the only key needed | S:85 R:85 A:90 D:90 |
| 3 | Confident | Marker-preview repaint implemented via picker-local preview state (updated on swatch pick before emit), seeded from `selectedColor` | "Repaints immediately" must hold even though the window-row caller closes the popover on pick; local state makes the behavior caller-independent (recorded as a plan Design Decision) | S:65 R:85 A:85 D:70 |
| 4 | Certain | e2e color-option locators gain `exact: true` | Playwright `getByRole` name matching is substring-based — `"Color orange"` would strict-mode-collide with `"Color orange-dark"` | S:85 R:95 A:95 D:95 |
| 5 | Confident | Backend family-name canonical form = trimmed verbatim, case-sensitive; numeric-grammar error copy widened to mention family names | Mirrors the frontend `resolveFamily` trim rule and the marker set's case-sensitivity; error copy for color was unspecified in the intake | S:60 R:85 A:85 D:80 |
| 6 | Confident | Preview textures reuse the shipped `.rk-scanlines` (static, never `-crawl`) and new `.rk-hazard` classes with per-cell `--rk-marker-color` | Intake mandates "paired row texture" mirroring real rows; reusing the row classes keeps the texture vocabulary in one place (code-quality anti-duplication) | S:70 R:85 A:85 D:80 |
| 7 | Tentative | Uncolored marker previews use the gray sentinel (ANSI 8) tint/border (`UNCOLORED_SELECTED_KEY`) | Carried from intake assumption #9 (not discussed in the design session; mirrors the row's uncolored-selected convention) | S:45 R:80 A:70 D:60 |

7 assumptions (3 certain, 3 confident, 1 tentative).
