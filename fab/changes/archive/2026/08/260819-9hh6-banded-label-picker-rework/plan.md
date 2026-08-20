# Plan: Banded Label Picker Rework

**Change**: 260819-9hh6-banded-label-picker-rework
**Intake**: `intake.md`

## Requirements

### Picker: Banded B-H Layout (`app/frontend/src/components/swatch-popover.tsx`)

#### R1: Banded layout under a composite preview
The Label picker SHALL be restacked as a ~190px-wide, constant-height vertical stack: a full-width composite preview row (with the ✕ close button beside it and a combo caption underneath), then three bands — `color`, `marker`, `flair` — each with a micro band header in the green-bracket `[ axis ]` idiom naming the axis. The panel name and aria-labels stay `Label picker` (markers present) / `Color picker` (color-only); the palette action `Window: Label` is untouched.

- **GIVEN** the picker is opened for a window row (color + marker + flair props)
- **WHEN** it renders
- **THEN** it shows the preview row, the combo caption, and the three bands in order color → marker → flair, each named by a `[ axis ]` header
- **AND** the panel is ~190px wide and its height does not change when any axis vocabulary grows

#### R2: Composite preview row
The preview row SHALL render the row's actual resting look: color tint background, the marker stripe, the static paired texture (hatch ↔ hazard wedge), the live flair overlay (reusing `FlairOverlay` so the cube/warp child-markup contract holds), and a row name (the target row's real name when the caller supplies one, a neutral sample otherwise). The caption under it SHALL name the combo as `{color-family} · {marker} · {flair}` with `∅` for unset axes (flair last). Picks on ANY axis SHALL repaint the preview immediately (the `previewOverride` mechanism extended to marker and flair, not just color).

- **GIVEN** the picker is open with color `teal`, marker `hatch`, flair `scan`
- **WHEN** it renders
- **THEN** the preview shows the teal tint, the hatch stripe + hazard wedge, the scan overlay, and the caption reads `teal · hatch · scan`
- **AND** clicking a different marker cell repaints the preview's stripe without waiting for the caller's prop echo

#### R3: ∅ clear cell in each band header
Each band header SHALL carry a right-aligned ∅ clear cell; a ring on the header ∅ indicates the axis is unset. Clearing an axis SHALL affect only that axis. The ∅ cells keep the existing accessible names (`Clear color`, `Marker none`, `Flair none`) so existing e2e/unit locators keep working.

- **GIVEN** a row with marker `solid`
- **WHEN** the user activates the marker band's header ∅
- **THEN** `onSelectMarker("")` fires, the color and flair selections are untouched, and the picker stays open

#### R4: Color band — horizontal scroll strip
The color band SHALL be a 2-row (normal shade over dark shade, pairing preserved) × 10-family-column column-flow grid inside a horizontal-scroll strip with a thin scrollbar and a right-edge fade, so ~8 of 10 families are visible and the cut-off partial column advertises the overflow. Color SHALL only ever scroll horizontally.

- **GIVEN** 10 hue families × 2 shades
- **WHEN** the band renders at 190px panel width
- **THEN** both shade rows are always fully visible, family columns slide horizontally, and the strip shows a cut-off column at the right edge

#### R5: Marker band — 8 static cells, unscrolled
The marker band SHALL be a single row of the 8 named marker states (the ∅ lives in the header), fitting the panel without scrolling. Marker cells SHALL be fully static (no rain, no scanlines) — the only texture is hatch's hazard wedge (with the preview modifier that drops the wedge mask at 18px).

- **GIVEN** the 8-state marker vocabulary
- **WHEN** the band renders
- **THEN** all 8 cells are visible without scrolling, and only the hatch cell carries a texture overlay

#### R6: Flair band — 2-row column-flow strip
The flair band SHALL be a 2-row column-flow horizontal strip holding the 12 named flairs (rain + scan + the 10 shipped states); it fits the panel without scrolling at this count. Flair cells keep their always-on motion (motion IS flair identity).

- **GIVEN** the 12-state flair catalogue
- **WHEN** the band renders
- **THEN** all 12 cells render in 2 rows × 6 columns, each carrying its live `rk-flair-*` overlay

#### R7: Plain-grid keyboard model
Each band SHALL be a plain keyboard grid; the header ∅ acts as row 0 of its band (ArrowUp from a strip's first row lands on its header ∅). Arrow moves SHALL call `scrollIntoView({block:"nearest", inline:"nearest"})` so the scroll strip is invisible to the grid model. The `GRID_ROWS === MARKER_CELLS.length` 1:1 pairing invariant and its unit test SHALL be removed. Every picker action SHALL remain keyboard-reachable (Constitution V), including the ✕ close cell.

- **GIVEN** the picker is open and focused
- **WHEN** the user presses ArrowUp from the color band's first row
- **THEN** focus lands on the color band's header ∅, and Enter clears the color
- **AND** ArrowDown walks from the color band into the marker band and on to the flair band, clamping columns to each row's extent

#### R8: Dismissal contract retained
Selection SHALL never dismiss the picker; it closes only via the ✕ cell, an outside click, or Escape. The `familyToLegacy` write seam SHALL be retained verbatim (normal-shade picks map to legacy descriptors; dark picks pass through).

- **GIVEN** the picker is open
- **WHEN** the user picks a color, a marker, and a flair in one session
- **THEN** the picker is still open after all three picks, and `onClose` fires only on ✕ / outside click / Escape

#### R9: Caller variants
Server rows SHALL get no flair band (server identity stays flair-free); pure-color callers SHALL render preview + color band only (no marker/flair bands, no caption legs for absent axes beyond color). Band visibility stays gated on the existing per-caller props (`onSelectMarker` / `onSelectFlair` presence).

- **GIVEN** the settings/host-panel accent picker (no `onSelectMarker`/`onSelectFlair`)
- **WHEN** it renders
- **THEN** only the preview row and the color band appear, labelled `Color picker`

### Markers: Vocabulary Growth + Texture Remap

#### R10: Marker axis grows 5 → 8, all static
`MARKER_STATES` (`app/frontend/src/themes.ts`) SHALL grow to `["", "pipe", "dotted", "dashed", "solid", "double", "thick", "hatch", "block"]`. New states are new pattern CLASSES, never a new weight between existing ones. Suggested semantics stay label conventions only — NO wiring to `@rk_agent_state` or the status pyramid.

- **GIVEN** the themes module
- **WHEN** `MARKER_STATES` is read
- **THEN** it lists the 8 states in display order with `""` first

#### R11: `markerStripeStyle` gains the new pattern classes
`markerStripeStyle` SHALL gain: `pipe` (1px hairline), `hatch` (45° diagonals on a tile whose period divides the 12px weld module so stacked rows merge), `block` (heavy block dashes — 9px-on/3px-off on a 12px tile, 6px wide). All stripe periods SHALL divide the 12px weld module.

- **GIVEN** any of the 8 states
- **WHEN** `markerStripeStyle(state, color)` is called
- **THEN** it returns the documented stripe style (undefined only for `""`/unknown), and repeated vertically every 12px the pattern welds seamlessly

#### R12: Hazard wedge migrates thick → hatch; markers carry exactly one texture pairing
The hazard-wedge static texture SHALL pair with `hatch` (in-progress) instead of `thick`; `thick` (completed) goes clean and quiet, and `double` keeps a plain twin stripe (its scanlines are released to the flair axis). `window-row.tsx` SHALL mount the hazard overlay on hatch rows only and SHALL NOT mount the scanlines or data-rain overlays for any marker.

- **GIVEN** a window row with marker `hatch`
- **WHEN** it renders
- **THEN** it mounts the static `.rk-hazard` overlay in the guarded marker color
- **AND** rows with marker `thick`/`double`/`dashed` mount NO texture overlay

### Flairs: The Motion Split

#### R13: `rain` and `scan` join the flair axis
The always-on data rain SHALL move off the dashed marker into a new `rain` flair (same two-lane CSS); the scanlines + crawl + refresh band SHALL become a new always-on `scan` flair. The `.rk-dash-rain`, `.rk-scanlines`, and `.rk-scanlines-crawl` classes and the selection-gated crawl keyframes SHALL be removed from `globals.css`; the new `.rk-flair-rain` / `.rk-flair-scan` classes join the flair overlay section. Both SHALL read their tint from a `--rk-flair-color` custom property (set by the row/preview; fallback `--color-border`).

- **GIVEN** a row with flair `rain` and any marker
- **WHEN** it renders
- **THEN** the two-lane rain animates across the row regardless of marker, and no `rk-dash-rain`/`rk-scanlines*` CSS remains in globals.css

#### R14: Flair catalogue grows 10 → 12
`FLAIR_STATES` SHALL become `["", "rain", "scan", "nyan", "naruto", "onepiece", "pacman", "matrix", "aquarium", "roadrunner", "invaders", "cube", "warp"]`. The reduced-motion block SHALL hide the rain/scan motion entirely (they are motion-only decoration), and stale crawl/dash-rain entries SHALL be removed.

- **GIVEN** `prefers-reduced-motion: reduce`
- **WHEN** a row carries flair `rain` or `scan`
- **THEN** the overlay is fully hidden (animation none / display none), matching every other flair

#### R15: FlairOverlay serves rain/scan
`flair-overlay.tsx` SHALL render rain/scan like the other pseudo-element flairs (bare overlay span, no child markup) and SHALL accept an optional color used to set `--rk-flair-color` inline so tinted flairs (rain/scan) render in the row's guarded color. The picker's flair cells and composite preview SHALL reuse `FlairOverlay`.

- **GIVEN** `FlairOverlay` rendered with `flair="scan"` and a color
- **WHEN** it mounts
- **THEN** the overlay span carries `rk-flair-scan` and the `--rk-flair-color` custom property

### Backend: Closed Sets

#### R16: Marker/flair closed sets grow
`markerTokens` (`app/backend/internal/validate/validate.go`) SHALL grow to the 8-state set (adding pipe, hatch, block) and `flairTokens` to the 12-state set (adding rain, scan), in the frontend display order so the derived error copy lists them consistently. Stored values are unchanged — zero data migration; new values are additive. `validate_test.go` SHALL cover the widened sets and cross-axis rejection (a marker token is not a valid flair and vice versa).

- **GIVEN** `ValidateMarkerValue("hatch")` / `ValidateFlairValue("rain")`
- **WHEN** called
- **THEN** both return valid, while `ValidateMarkerValue("rain")` / `ValidateFlairValue("hatch")` return the closed-set error

### Row Integration

#### R17: Window/session rows follow the split
`window-row.tsx` SHALL drop the double-scanlines and dashed-rain overlays, move the hazard wedge to hatch, set `--rk-marker-color` only when the hatch hazard needs it, and pass the row's guarded color to `FlairOverlay` so rain/scan tint correctly; the Label picker invocation gains the row's name for the composite preview. `session-row.tsx` SHALL pass its row color to `FlairOverlay` the same way. Marker/flair values, tmux option names, and the POST-only API surface are unchanged.

- **GIVEN** a window row with marker `dashed` and no flair
- **WHEN** it renders
- **THEN** it shows the static dashed stripe with NO rain overlay; setting flair `rain` (via the picker or API) mounts the `rk-flair-rain` overlay instead

### Docs

#### R18: Design study publication
The study page SHALL be committed as `docs/wiki/picker-layout-studies.html` (from this change's `assets/picker-layout-studies.html`) and `docs/specs/index.md` SHALL gain a Wiki-table row for it, matching the precedent rows' style.

- **GIVEN** the docs tree
- **WHEN** `docs/specs/index.md` is viewed
- **THEN** the Wiki table lists the picker layout studies with a description in the established row style

### Non-Goals

- Renaming the panel (`Look` umbrella) — `Label` stays; recorded fallback only.
- Wiring marker semantics to `@rk_agent_state` / the status pyramid — Constitution X derivation wins; semantics are label conventions only.
- Giving `double` a new pattern class to replace its scanline identity — explicitly parked.
- Data migration for stored `@rk_marker`/`@rk_flair` values — values are additive, names unchanged.
- Scroll mechanics for the marker/flair bands — they fit unscrolled at current counts; only the color band scrolls.

### Design Decisions

#### B-H banded layout
**Decision**: Restack the picker as horizontal bands (color 2×N column-flow scroll strip, marker 1×8 row, flair 2×N column-flow strip) under a live composite preview row, ~190px wide, constant height.
**Why**: Names the axes with the band headers; panel height is constant regardless of any axis's growth; each band scrolls only in the direction its axis actually grows; fits the sidebar-flyout and coarse-pointer rail-card width budgets.
**Rejected**: A (labels on the old skeleton — the flair wall survives), C (tabs — hides two axes, costs a switch per axis during combo iteration), D (three columns — ~300px, too wide), B-V (vertical flair cap — loses height constancy and the swipe story).
*Introduced by*: 260819-9hh6-banded-label-picker-rework

#### The motion split
**Decision**: Markers are fully static; all row motion lives on the flair axis (`rain`/`scan` migrate off dashed/double; the selection-gated crawl is deleted).
**Why**: "Markers mean something and hold still; flairs mean nothing and move" — motion on the marker axis blurred the axis boundary once flairs existed.
**Rejected**: Keeping always-on rain on dashed and selection-gated crawl on double — mixes feedback motion into the categorical axis.
*Introduced by*: 260819-9hh6-banded-label-picker-rework

#### In-progress remap
**Decision**: `hatch` (45° construction-tape diagonals) is THE in-progress marker and receives the hazard-wedge texture; `thick` (completed) goes quiet; markers carry exactly ONE texture pairing (hatch ↔ hazard).
**Why**: Hazard stripes culturally mean "work zone", not "done"; an ordinal weight ladder can't encode categorical phases, so growth adds pattern classes and the highest-value state gets the iconic form.
**Rejected**: Hazard on thick (backwards semantics); a sixth weight of stripe (ordinal form for categorical meaning).
*Introduced by*: 260819-9hh6-banded-label-picker-rework

### Deprecated Requirements

#### Marker-column 1:1 pairing invariant
**Reason**: The marker column dies with the B-H restack; bands are independent plain grids, so `GRID_ROWS === MARKER_CELLS.length` and its unit test are removed.
**Migration**: Plain per-band grid model; header ∅ is row 0 of its band; `scrollIntoView` keeps scroll strips invisible to the keyboard model.

#### Marker-carried motion (dash rain, selection-gated scanline crawl)
**Reason**: The motion split — markers hold still, all row motion is flair.
**Migration**: `rain` and `scan` flairs (always-on, user-composable with any marker).

## Tasks

### Phase 1: Vocabulary & CSS Foundations

- [x] T001 [P] Backend closed sets: grow `markerTokens` (+pipe/hatch/block) and `flairTokens` (+rain/scan, front of display order) in `app/backend/internal/validate/validate.go`; refresh doc comments; widen `validate_test.go` valid/invalid lists incl. cross-axis rejection (marker tokens rejected as flairs and vice versa) <!-- R16 -->
- [x] T002 [P] Frontend vocabulary: grow `MARKER_STATES` (→ 8) and `FLAIR_STATES` (→ 12, rain/scan first) in `app/frontend/src/themes.ts`; add `pipe`/`hatch`/`block` cases to `markerStripeStyle` (hatch = 45° diagonal tile welding on the 12px module); update doc comments; update `themes.test.ts` set-order and stripe-geometry tests <!-- R10 R11 R14 -->
- [x] T003 [P] globals.css: add `.rk-flair-rain` (lifted two-lane rain, `--rk-flair-color`) and `.rk-flair-scan` (scanlines + crawl + refresh band, always-on) to the flair section; delete `.rk-dash-rain`, `.rk-scanlines`, `.rk-scanlines-crawl` and their keyframes; repoint `.rk-hazard` comments thick→hatch; update the reduced-motion block (drop crawl/dash-rain entries, hide rain/scan flairs); add the horizontal scroll-strip utility (thin scrollbar + right-edge fade) <!-- R12 R13 R14 -->

### Phase 2: Picker Rework

- [x] T004 `flair-overlay.tsx`: accept optional `color` prop setting `--rk-flair-color` inline; extend `flair-overlay.test.tsx` <!-- R15 -->
- [x] T005 `swatch-popover.tsx`: full B-H rework — composite preview row (tint + stripe + hatch-hazard texture + reused `FlairOverlay` + row name via new optional `rowName` prop) with ✕ beside it and combo caption underneath; three bands with `[ axis ]` headers carrying right-aligned ∅ clear cells (ring = axis unset; keep aria-names `Clear color`/`Marker none`/`Flair none`); color band as 2×10 column-flow horizontal scroll strip; marker band 1×8 static row; flair band 2×6 column-flow strip; plain-grid keyboard model (header ∅ = row 0, `scrollIntoView` on arrow moves, ✕ reachable at the top); extend `previewOverride` to marker/flair; caller variants per R9 <!-- R1 R2 R3 R4 R5 R6 R7 R8 R9 -->
- [x] T006 Rework `swatch-popover.test.tsx`: bands/headers/header-∅ rendering per caller variant, composite preview + caption + immediate repaint on all three axes, static marker cells with hatch-only texture, live flair cells (12), plain-grid keyboard walks incl. header-∅ rows and inter-band traversal, dismissal contract, legacy write seam; delete the 1:1-invariant test <!-- R1 R2 R3 R4 R5 R6 R7 R8 R9 -->

### Phase 3: Integration & E2E

- [x] T007 `window-row.tsx`: remove double-scanlines + dashed-rain overlays and `--rk-marker-color` wiring for them; mount `.rk-hazard` for hatch only (var set for hatch); pass guarded row color to `FlairOverlay`; pass `rowName` to the Label picker; update `window-row.test.tsx` texture/picker tests <!-- R12 R17 -->
- [x] T008 `session-row.tsx`: pass the row's color to `FlairOverlay` (rain/scan tint); audit the remaining `SwatchPopover` callers (host-panel.tsx, settings-dialog.tsx, app.tsx) for the color-only variant; update `session-row.test.tsx` if needed <!-- R9 R15 R17 -->
- [x] T009 Rework `app/frontend/tests/e2e/window-marker-gutter.spec.ts` (+ `.spec.md` in the same commit): banded picker chrome (headers, header-∅ clear), 8-marker persistence incl. pipe/hatch/block, rain/scan flair persistence via `@rk_flair` + overlay mount, hatch↔hazard row overlay, thick quiet <!-- R3 R10 R12 R13 R17 -->
- [x] T010 Sweep other picker-chrome e2e (`row-flyout.spec.ts`, `mobile-layout.spec.ts`): verify locators still hold (`Color picker`/`Label picker` listboxes, `Set window label` absence on coarse); update specs + `.spec.md` companions only where actually broken <!-- R8 R9 -->

### Phase 4: Docs & Verification

- [x] T011 Publish `docs/wiki/picker-layout-studies.html` (copy of this change's `assets/picker-layout-studies.html`) + Wiki-table row in `docs/specs/index.md` <!-- R18 -->
- [x] T012 Gates: `just test-frontend`, `just test-backend`, scoped `just pw test …` for touched specs, then full `just test` and `just build` <!-- R1 R10 R13 R16 -->

## Execution Order

- T001/T002/T003 are independent (different files) — parallel-safe.
- T004 precedes T005 (the picker preview reuses the extended FlairOverlay).
- T005 precedes T006 (tests assert the reworked component).
- T007/T008 follow T005 (row rendering consumes the new vocabulary/CSS and the picker's new props).
- T009/T010 follow T007/T008 (e2e asserts the integrated behavior).
- T011 is independent of code; T012 is last.

## Acceptance

### Functional Completeness

- [x] A-001 R1: The Label picker renders preview row + caption + `[ color ]`/`[ marker ]`/`[ flair ]` banded sections at ~190px with constant height
- [x] A-002 R2: The composite preview shows tint + stripe + hatch-hazard texture + live flair overlay + row name; caption names the combo with `∅` for unset axes; picks on every axis repaint immediately
- [x] A-003 R3: Each band header carries a right-aligned ∅ that clears only its axis, ringed when the axis is unset, keeping the `Clear color`/`Marker none`/`Flair none` accessible names
- [x] A-004 R4: The color band is a 2-shade-row × 10-family column-flow horizontal scroll strip (thin scrollbar, right-edge fade, cut-off column); never scrolls vertically
- [x] A-005 R5: The marker band shows all 8 states unscrolled, fully static, hatch the only textured cell
- [x] A-006 R6: The flair band shows all 12 flairs in a 2-row column-flow strip with live `rk-flair-*` overlays
- [x] A-007 R7: Every picker action is keyboard-reachable; header ∅ is row 0 of its band; arrow moves call `scrollIntoView`; the 1:1 pairing invariant and its test are gone
- [x] A-008 R8: Selection never dismisses; ✕/outside-click/Escape close; `familyToLegacy` seam intact (normal→legacy, dark→verbatim)
- [x] A-009 R9: Server-row pickers have no flair band; pure-color callers render preview + color band only with the `Color picker` aria-label
- [x] A-010 R10/R11: `MARKER_STATES` lists 8 states; `markerStripeStyle` renders pipe/hatch/block with periods dividing the 12px weld module
- [x] A-011 R12: `.rk-hazard` mounts on hatch rows only; thick/double/dashed rows mount no texture overlay
- [x] A-012 R13: `rain` and `scan` flairs animate on any marker combo; `.rk-dash-rain`/`.rk-scanlines`/`.rk-scanlines-crawl` are deleted from globals.css
- [x] A-013 R14: `FLAIR_STATES` lists 12 states (rain, scan first); reduced-motion hides rain/scan entirely
- [x] A-014 R15: `FlairOverlay` renders rain/scan (no child markup) and sets `--rk-flair-color` from its optional color prop; the picker reuses it for cells + preview
- [x] A-015 R16: Backend accepts the 8-marker/12-flair sets with derived error copy; cross-axis tokens rejected; tests green
- [x] A-016 R17: Window rows show static markers (hatch hazard only), tinted rain/scan flairs, and pass the row name to the picker; session rows tint rain/scan too
- [x] A-017 R18: `docs/wiki/picker-layout-studies.html` exists and is listed in the `docs/specs/index.md` Wiki table

### Behavioral Correctness

- [x] A-018 R8: `window-marker-gutter.spec.ts` proves marker/color/flair picks persist via `@rk_marker`/`@color`/`@rk_flair` through the banded picker in one open session
- [x] A-019 R12/R13: A dashed row is still (no rain) and a thick row is quiet (no hazard); a hatch row carries the hazard wedge; rain/scan flairs animate always-on regardless of selection

### Removal Verification

- [x] A-020 R7: No `MARKER_CELLS`/`GRID_ROWS` 1:1 invariant or test remains in swatch-popover
- [x] A-021 R13: `grep` finds no `.rk-dash-rain`, `.rk-scanlines`, or `.rk-scanlines-crawl` references in `app/frontend/src`

### Scenario Coverage

- [x] A-022 R7: Unit tests walk the keyboard grid: header-∅ rows (row 0 of each band), inter-band ArrowUp/Down traversal, per-row right-edge clamps, ✕ at the top
- [x] A-023 R9: Unit tests cover all three caller variants (full Label picker, no-flair server variant, color-only variant)

### Edge Cases & Error Handling

- [x] A-024 R2: Uncolored rows preview with the gray sentinel tint/border; dark-shade colors preview with their own tint/border; the caption shows `∅` legs for unset axes
- [x] A-025 R4: At 190px the color strip shows a cut-off partial column and the right-edge fade; a selected off-screen family scrolls into view on open/arrow nav

### Code Quality

- [x] A-026: New code follows naming and structural patterns of surrounding code (rk-* classes, doc-comment density, overlay discipline)
- [x] A-027: No unnecessary duplication — the picker reuses `FlairOverlay` and `markerStripeStyle` rather than mirroring them
- [x] A-028: Type narrowing over type assertions in the new picker code; no magic numbers without named constants
- [x] A-029: New/changed behavior is covered by tests (unit + e2e per the UI-changes guideline)
- [x] A-030: Every modified `*.spec.ts` ships its sibling `.spec.md` update in the same commit (Constitution)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None outstanding — the change deleted its own obsoleted code inline (the marker-column grid machinery in `swatch-popover.tsx` — `MARKER_CELLS`/`GRID_ROWS`/`FLAIR_ROW*`/`colorIndexAt`/`maxFlairCol`, the `.rk-dash-rain`/`.rk-scanlines`/`.rk-scanlines-crawl` classes + keyframes in `globals.css`, and the thick-hazard / double-scanline / dashed-rain overlay mounts in `window-row.tsx`); no further redundancy discovered.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Flair display order puts `rain`, `scan` first (FLAIR_STATES and flairTokens) | The study's iteration-4 flair band leads with rain/scan; intake fixes the set, not the order | S:85 R:90 A:85 D:80 |
| 2 | Confident | Hatch stripe uses the hazard-tile gradient form (`linear-gradient(45deg, …)` 25%/50%/75% stops on a 12px×12px tile) instead of the study's mock repeating gradient | The 45° linear form on a 12px tile provably welds vertically and horizontally (same math as `.rk-hazard`); the study's repeating-gradient form does not phase-align to the 12px module. Intake #14 explicitly delegates this tuning | S:55 R:85 A:80 D:70 |
| 3 | Confident | Keyboard model = one global logical row stack per panel — [✕] · [color ∅] · color shade rows · [marker ∅] · marker row · [flair ∅] · flair rows — preserving column with clamping on vertical moves | The intake fixes "header ∅ is row 0 of its band" and "plain grids" but not inter-band traversal; a single clamped row stack is the simplest model satisfying both, and keeps ✕ keyboard-reachable | S:55 R:80 A:75 D:65 |
| 4 | Confident | Header ∅ cells keep the incumbent accessible names (`Marker none`, `Flair none`) and the color one is `Clear color` | Preserves existing e2e/unit locators; the intake fixes the ∅-in-header placement, not the aria names | S:60 R:90 A:75 D:65 |
| 5 | Confident | Tinted flairs (rain/scan) read `--rk-flair-color`, set inline by a new optional `FlairOverlay` color prop (rows pass their guarded border color; picker previews pass the preview stripe color; fallback `var(--color-border)`) | Flair overlays are self-colored today except the two migrating treatments, which read `--rk-marker-color` — a variable whose semantics stay marker-scoped; an explicit prop keeps the seam typed and narrow | S:50 R:85 A:70 D:60 |
| 6 | Confident | `SwatchPopover` gains an optional `rowName` prop for the composite preview; window-row passes the window name, session-row the session name; other callers fall back to a neutral sample name | Intake #17 (real name when opened for a row, neutral sample otherwise) | S:45 R:90 A:75 D:60 |

6 assumptions (1 certain, 5 confident, 0 tentative).
