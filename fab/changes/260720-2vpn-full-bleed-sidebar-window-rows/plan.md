# Plan: Full-Bleed Sidebar Window Rows

**Change**: 260720-2vpn-full-bleed-sidebar-window-rows
**Intake**: `intake.md`

## Requirements

### Sidebar: Window-Row Group Indent → Per-Row Padding

#### R1: Group wrapper loses its left margin
The window-list group wrapper (`app/frontend/src/components/sidebar/index.tsx:1597`) MUST drop the `ml-3` class while keeping `role="group"`, `id={windowGroupId}` (the session row's `aria-controls` target), and all children unchanged.

- **GIVEN** an expanded session in the sidebar
- **WHEN** its window rows render
- **THEN** each row's box starts at the physical left edge of the sidebar (no 12px group gutter)
- **AND** the group element still carries `role="group"` and the `windowGroupId` id

#### R2: Window-row box absorbs the indent as left padding
The window-row `<button>` (`app/frontend/src/components/sidebar/window-row.tsx`) MUST change `pl-[18px]` → `pl-[30px]` (12px former margin + 18px former padding), so the status dot and window name keep their exact current absolute x-positions while the row box — and every box-anchored visual layer (family tint via `buttonStyle`, hover fill, 40% selection tint, `isDragOver` box-shadow, the `inset-0` scanline overlay) — spans the sidebar edge-to-edge. Comments narrating the old geometry (the buttonClass comment block and the `pl-[18px]`/"−12px into the group indent" derivations) MUST be rewritten to the new derivation. The wider scanline band on selected+double rows is intended (matches the demo's "operator" row).

- **GIVEN** a colored window row (e.g. family "orange") in an expanded session
- **WHEN** the row renders at rest, on hover, and selected
- **THEN** the tint/hover/selection background reaches the sidebar's left edge with no black gutter
- **AND** the status dot's leading edge remains 30px from the sidebar edge (unchanged content x-position)

#### R3: LabelZone re-derived — plain left-0 overlay, edge-anchored stripe, explicit icon-over-stripe layering
The label zone (`LabelZone` in `window-row.tsx`) MUST be re-derived coherently, not patched:

- The zone MUST be positioned `left-0` (replacing `-left-3`) with width 26px and full row height — its absolute span (sidebar x = 0…26) is unchanged; only the coordinate expression simplifies.
- The marker stripe MUST anchor at the true sidebar left edge with a single small inset constant (2px, per the demo screenshot's near-flush stripes), replacing the `left: ICON_ZONE_WIDTH + STRIPE_INSET` (17px) placement.
- The hover palette icon MUST stay in the leftmost 12px of the zone (now the true sidebar edge) with the same two-stage opacity (row hover ~65% → zone hover 100%) and family tinting, and MUST render **above** the stripe — layering made explicit (DOM order + explicit z-index), not incidental.
- The geometry constants (`LABEL_ZONE_WIDTH` / `ICON_ZONE_WIDTH` / stripe-inset constant) and every geometry comment (constants block, zone className comment, icon/stripe child comments, LabelZone doc comment) MUST be rewritten to the new derivation with no stale "-left-3"/"group indent" narration.
- The interaction contract MUST NOT change: one 26px click target opening the combined Label picker (no cycling), `stopPropagation` (never selects the row), active on coarse pointers, `aria-label="Set window label"`, zone glow at 12%/24% family tint, `z-20` above the icon cluster (`z-10`) and scanline overlay (`z-[5]`); the dot at `pl-[30px]` stays 4px clear of the zone's inner edge so the zone never steals the dot's hover-card/click (must-fix-3 geometry).

- **GIVEN** a window row with a solid marker and a color family
- **WHEN** the row renders
- **THEN** the stripe paints 2px from the sidebar's physical left edge
- **AND** hovering the row reveals the palette icon on top of the stripe in the leftmost 12px
- **AND** clicking the zone opens the Label picker without selecting the row

#### R4: Boards section rows go full-bleed with the same margin→padding conversion
`app/frontend/src/components/sidebar/boards-section.tsx` MUST convert both `ml-3` uses:

- Hint-mode div (line 59): `ml-3 px-2` → `pl-5 pr-2` (left 12+8 = 20px; right stays 8px; `py-2` unchanged).
- Board list item (line 69): drop `ml-3` from the `<li>`; the row `<button>`'s `px-2` → `pl-5 pr-2`.

Board name/pin-count keep their x-positions; the active `bg-bg-card` and hover `bg-bg-card/50` fills span edge-to-edge.

- **GIVEN** at least one board in the Boards panel
- **WHEN** a board row renders active or hovered
- **THEN** its background fill spans the sidebar edge-to-edge and the board name keeps its current x-position

#### R5: Unit-test stripe expectation updated to the edge-anchored inset
`app/frontend/src/components/sidebar/window-row.test.tsx:948` (stripe container `left` is `"17px"`) MUST be updated to the new edge-anchored inset (`"2px"`), with its comment rewritten. No new couplings to spacing utility classes may be added; geometry is asserted via computed positions or existing aria handles.

- **GIVEN** the window-row unit suite
- **WHEN** `just test-frontend` runs
- **THEN** the display-only-stripe test asserts the new edge-anchored `left` and passes

#### R6: Preserved behaviors — explicit regression guards
The change MUST NOT alter: (a) the fixed-rhythm dotted-stripe cross-row continuity (PR #420 — `markerStripeStyle` in `src/themes.ts` untouched; only the stripe's x-position moves); (b) the selected+double `rk-scanlines-crawl` overlay classes, `--rk-marker-color` custom property, dedicated inner clip element, and reduced-motion behavior (only the overlay's width grows with the row box); (c) the dot hover-card/click-to-select (dot starts 4px past the zone's inner edge). `markerStripeStyle` and `computeRowBorders` MUST NOT be modified.

- **GIVEN** two adjacent dotted-marker rows
- **WHEN** they render full-bleed
- **THEN** the dotted rhythm carries across the row seam with no restart (6px period divides the 24px/36px row heights exactly — position-independent)
- **AND** a selected double-marker row still animates the crawl inside its dedicated clipped overlay

### Non-Goals

- Session rows, server group headers, and server tiles — already full-width; untouched (intake assumption 8).
- Theme/palette changes (`markerStripeStyle`, `computeRowBorders`) — untouched.
- Backend, API, routes — untouched.
- `docs/memory/run-kit/ui-patterns.md` rewrite — hydrate-stage work, not apply.

### Design Decisions

#### Stripe-inset constant renamed to reflect the new anchor
**Decision**: Replace `STRIPE_INSET = 5` ("display-only stripe inset within its 14px zone") with `STRIPE_EDGE_INSET = 2` ("stripe inset from the zone's/sidebar's left edge"), and drop the `ICON_ZONE_WIDTH +` term from the stripe position.
**Why**: The constant's semantics changed from "offset within the post-icon stripe zone" to "offset from the physical sidebar edge"; keeping the old name would preserve a stale mental model the intake explicitly asks to rewrite.
**Rejected**: Keeping `STRIPE_INSET` with a new value only — the name would silently mean something different from every historical reading of it.
*Introduced by*: 260720-2vpn-full-bleed-sidebar-window-rows

## Tasks

### Phase 1: Core Implementation

- [x] T001 Remove `ml-3` from the window-list group wrapper in `app/frontend/src/components/sidebar/index.tsx` (line 1597), keeping `role="group"` and `id={windowGroupId}` <!-- R1 -->
- [x] T002 In `app/frontend/src/components/sidebar/window-row.tsx`, change the row button's `pl-[18px]` → `pl-[30px]` and rewrite the buttonClass geometry comment block (lines ~221–235) to the new full-bleed derivation <!-- R2 -->
- [x] T003 In `app/frontend/src/components/sidebar/window-row.tsx`, re-derive `LabelZone`: zone `-left-3` → `left-0`; stripe container `left: ICON_ZONE_WIDTH + STRIPE_INSET` → `left: STRIPE_EDGE_INSET` (2px); make icon-over-stripe layering explicit (stripe child before the icon child + explicit z-index on the icon container); rewrite the constants block (lines ~462–469), the LabelZone doc comment, and the zone/icon/stripe child comments — no stale "-left-3"/"group indent" narration <!-- R3 -->
- [x] T004 [P] In `app/frontend/src/components/sidebar/boards-section.tsx`, convert both `ml-3` uses: hint div `ml-3 px-2` → `pl-5 pr-2` (line 59); drop `ml-3` from the board `<li>` (line 69) and change the board button's `px-2` → `pl-5 pr-2` <!-- R4 -->

### Phase 2: Tests & Verification

- [x] T005 Update `app/frontend/src/components/sidebar/window-row.test.tsx` (line ~948): stripe `left` expectation `"17px"` → `"2px"`, rewrite the comment to the edge-anchored derivation <!-- R5 -->
- [x] T006 Run `just test-frontend` (unit suite) and `just test-e2e "window-marker-gutter"` (behavioral label-zone e2e) — all green; verify no other spec couples to the old geometry <!-- R5 -->
- [x] T007 Visual verification against the demo screenshot `.uploads/260720140259-image.png`: render the sidebar (dev server on port 3020 per context.md § Playwright-Driven Development, read-only against live tmux) and confirm full-bleed tints, edge-anchored stripes, dotted continuity across adjacent rows, and the hover palette icon overlaying the stripe <!-- R2, R3, R6 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: The window-list group wrapper renders without `ml-3`; `role="group"` and the `aria-controls` id are intact
- [x] A-002 R2: The window-row button uses `pl-[30px]`; tint/hover/selection/drag-over/scanline layers span the sidebar edge-to-edge; dot and name x-positions unchanged (30px from the sidebar edge)
- [x] A-003 R3: LabelZone is `left-0`, 26px wide; the marker stripe anchors 2px from the sidebar edge; the palette icon renders above the stripe with explicit layering; constants and comments carry the new derivation with no stale narration
- [x] A-004 R4: Both boards-section `ml-3` uses converted to `pl-5 pr-2` padding; board rows' fills span edge-to-edge with unchanged text x-positions

### Behavioral Correctness

- [x] A-005 R3: The zone's interaction contract is unchanged — opens the combined Label picker, never selects the row, active on coarse pointers, `aria-label="Set window label"`, glow 12%/24%, z-20 stacking above the z-10 icon cluster and z-[5] scanline overlay
- [x] A-006 R6: Dotted-stripe cross-row continuity (PR #420) and the selected+double `rk-scanlines-crawl` (dedicated clip element, `--rk-marker-color`, reduced-motion) are preserved; `markerStripeStyle`/`computeRowBorders` untouched

### Scenario Coverage

- [x] A-007 R5: `just test-frontend` passes with the stripe expectation updated to the edge-anchored inset; `just test-e2e "window-marker-gutter"` passes unchanged (behavioral, no pixel couplings)

### Edge Cases & Error Handling

- [x] A-008 R3: The status dot at `pl-[30px]` stays 4px clear of the zone's inner edge — the zone does not steal the dot's hover-card or the row-select click (must-fix-3 geometry)

### Code Quality

- [x] A-009 Pattern consistency: New code follows the surrounding Tailwind-utility + commented-geometry conventions; no test couples to spacing utility classes
- [x] A-010 No unnecessary duplication: The stripe vocabulary stays solely in `markerStripeStyle`; no new geometry helpers introduced

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change is a margin→padding re-derivation. Every removal (the `STRIPE_INSET` constant, the three `ml-3` classes, the `-left-3` offset, the `ICON_ZONE_WIDTH +` stripe term) is an in-place replacement (`STRIPE_INSET`→`STRIPE_EDGE_INSET`; margins→padding), not new code added alongside orphaned old code. No existing file, function, branch, or config was made redundant.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Stripe edge inset = **2px** (from the intake's allowed 2–5px band) | Demo screenshot (authoritative, ~2x scale) shows stripes ~2–3 CSS px from the sidebar's inner edge; nearest integer that reads "near-flush"; trivially tunable one-constant change | S:70 R:95 A:75 D:70 |
| 2 | Confident | Rename `STRIPE_INSET` → `STRIPE_EDGE_INSET` (intake permits renames "if the re-derivation makes better ones obvious") | The constant's meaning changed from "inset within the post-icon stripe zone" to "inset from the sidebar edge" — keeping the old name would be misleading | S:75 R:95 A:85 D:80 |
| 3 | Confident | Explicit icon-over-stripe layering = reorder DOM (stripe child before icon child) + explicit z-index utility on the icon container | Intake notes the current implicit sibling-order stacking actually has the stripe LAST (painting above the icon once they overlap) and requires the layering be made explicit; DOM order + explicit z is the minimal, readable fix inside the zone's own stacking context | S:80 R:90 A:85 D:80 |
| 4 | Certain | `LABEL_ZONE_WIDTH = 26` and `ICON_ZONE_WIDTH = 12` keep their names and values — only their comments re-derive | The zone's absolute span and the icon zone are unchanged by the intake's own statement; no semantic shift to justify a rename | S:85 R:95 A:90 D:90 |

4 assumptions (1 certain, 3 confident, 0 tentative).
