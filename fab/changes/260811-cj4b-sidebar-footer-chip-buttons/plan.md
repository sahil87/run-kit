# Plan: Sidebar Footer Chip Buttons

**Change**: 260811-cj4b-sidebar-footer-chip-buttons
**Intake**: `intake.md`

## Requirements

### Frontend: Sidebar Footer Chip Idiom

#### R1: Footer actions adopt the top-bar chip idiom at footer scale
The shared `FOOTER_ICON_CLASS` constant in `app/frontend/src/components/sidebar/index.tsx` MUST become the top-bar chip idiom at footer scale: `rk-glint` plus a bordered fixed-size rounded square (`w-[24px] h-[24px]` on fine pointers, `coarse:w-[30px] coarse:h-[30px]` on touch), with rest/hover colors reused from the already-exported `TOP_BAR_BUTTON_REST` in `app/frontend/src/components/top-bar-overflow-menu.tsx` (imported, never duplicated). The old `hover:text-text-primary` flip MUST be dropped — hover is the `rk-glint` green line, same as every top-bar chip. The fixed sizes MUST be `w/h` utilities, not `min-*` floors (the top bar's anti-drift rationale).

- **GIVEN** the sidebar footer renders on any route with a sidebar
- **WHEN** the four right-cluster actions render
- **THEN** each carries `rk-glint`, a `border-border` box at 24×24 (fine) / 30×30 (coarse), and the `TOP_BAR_BUTTON_REST` colors
- **AND** hovering produces the CRT glint sweep plus the border/glyph flip to accent-green, with no `hover:text-text-primary` utility present

#### R2: One constant restyles the whole cluster; everything else unchanged
The idiom swap MUST apply to all four actions — the Help `<a>` and the Keyboard, Theme, and Settings `<button>`s — via the single shared `FOOTER_ICON_CLASS`. Icons (SVGs), ordering (Help · Keyboard · Theme · Gear), click behaviors (theme cycle, Ctrl/Cmd-click theme selector, `shortcuts-overlay:open` dispatch, settings open), Tips (`placement="top"`, kbd chords), and aria-labels MUST be unchanged.

- **GIVEN** the existing footer cluster
- **WHEN** the change is applied
- **THEN** all four controls share the new `FOOTER_ICON_CLASS` and no behavioral/ARIA/icon diff exists outside the class constant, the cluster gap, and the doc comments

#### R3: Cluster spacing widens to `gap-1`
The right action cluster's gap MUST widen from `gap-0.5` (2px) to `gap-1` (4px) so adjacent bordered chips do not visually fuse.

- **GIVEN** the new bordered chips sit 2px apart
- **WHEN** the cluster renders
- **THEN** the action segment uses `gap-1` (4px) between chips

#### R4: No footer row layout shift
The footer row (`px-2 py-1` around 24px-tall controls) MUST NOT change its resting height — the new chip is the same 24px box with the border inside via `box-sizing`.

- **GIVEN** the footer row before and after the change
- **WHEN** the chip idiom is applied
- **THEN** the rendered footer height against the sidebar bottom edge is identical

#### R5: Doc comments record the o7q8 reversal
The comment block above `FOOTER_ICON_CLASS` and the `SidebarFooter` JSDoc line referencing the "borderless footer idiom" MUST be rewritten to state the footer now deliberately shares the top-bar chip vocabulary at 24px scale, recording this change (260811-cj4b) as the source of the o7q8 reversal.

- **GIVEN** comments that claim a deliberate borderless contrast
- **WHEN** the idiom changes
- **THEN** no comment describes the old borderless decision as current truth, and the reversal is attributed to this change

#### R6: Left readouts untouched
The connection dot and version readout segment MUST keep their current passive-readout styling and behavior.

- **GIVEN** the left segment of the footer
- **WHEN** the change is applied
- **THEN** the dot and version readout markup, classes, and behavior are byte-identical

#### R7: Unit tests assert the chip idiom
The sidebar footer unit tests in `app/frontend/src/components/sidebar/index.test.tsx` MUST be updated so the existing borderless-idiom assertions are inverted: the four footer actions are asserted to carry the chip idiom (`rk-glint` + `border`). No new e2e spec (styling only, no behavioral change); existing e2e specs that click footer buttons MUST be verified unaffected.

- **GIVEN** the existing footer test block asserting the borderless idiom
- **WHEN** the change is applied
- **THEN** the tests assert `rk-glint` + `border` on the footer actions and the full frontend suite passes

### Non-Goals

- Changing the top bar's own chip tokens (`TOP_BAR_BUTTON_BASE` etc.) — the footer keeps local 24px geometry.
- Touching `globals.css` — `rk-glint` already exists and is reduced-motion-safe.
- Any icon, ordering, aria, Tip, or behavior change.
- New e2e specs — styling-only change.

### Design Decisions

#### Footer shares the top-bar chip vocabulary (reverses o7q8)
**Decision**: The sidebar footer's four actions render as bordered `rk-glint` chips (footer-scaled 24px fine / 30px coarse) reusing the top bar's exported `TOP_BAR_BUTTON_REST` colors.
**Why**: The bare 13–14px `text-secondary` glyphs read as decoration and were under-discovered; reusing an existing button vocabulary gives the footer presence without introducing a third visual species, and sharing the exported rest-state string keeps the two surfaces from drifting.
**Rejected**: Filled tiles (a third button species), a segmented tray (visually heavier group), bolder glyphs only (not bold enough vs. the user's reference) — all rejected from a live rendered mock; keeping o7q8's borderless contrast preserves the under-discovery problem.
*Introduced by*: 260811-cj4b-sidebar-footer-chip-buttons

### Deprecated Requirements

#### Borderless footer idiom (o7q8)
**Reason**: User found the borderless glyphs too subtle; Option A (chip idiom) was chosen from a rendered mock of four alternatives.
**Migration**: `FOOTER_ICON_CLASS` becomes the top-bar chip idiom at footer scale (R1).

## Tasks

### Phase 2: Core Implementation

- [x] T001 Replace `FOOTER_ICON_CLASS` with the top-bar chip idiom at footer scale and import `TOP_BAR_BUTTON_REST` from `@/components/top-bar-overflow-menu` in `app/frontend/src/components/sidebar/index.tsx` <!-- R1 -->
- [x] T002 Widen the right action cluster from `gap-0.5` to `gap-1` in `app/frontend/src/components/sidebar/index.tsx` <!-- R3 -->
- [x] T003 Rewrite the `FOOTER_ICON_CLASS` doc comment and the `SidebarFooter` JSDoc borderless-idiom line to record the o7q8 reversal in `app/frontend/src/components/sidebar/index.tsx` <!-- R5 -->

### Phase 3: Integration & Edge Cases

- [x] T004 Update the footer tests in `app/frontend/src/components/sidebar/index.test.tsx` — invert the two borderless-idiom assertions to assert the chip idiom (`rk-glint` + `border`) on the footer actions <!-- R7 -->
- [x] T005 Run frontend unit tests + type check (`just test-frontend`) and confirm the footer row height is unchanged (fixed 24px box, border via `box-sizing`; R4/R6 by inspection) <!-- R4 -->
- [x] T006 Run the sidebar-footer e2e spec (`just pw test sidebar-footer`) to confirm no pointer-interception or layout regressions in footer-clicking specs <!-- R2 -->

## Execution Order

- T001–T003 touch the same file/constant and run sequentially
- T004 depends on T001 (assertions target the new class)
- T005 depends on T001–T004; T006 depends on T001

## Acceptance

### Functional Completeness

- [x] A-001 R1: `FOOTER_ICON_CLASS` is `rk-glint` + bordered fixed square (24×24 fine / 30×30 coarse) composing the imported `TOP_BAR_BUTTON_REST`; `hover:text-text-primary` is gone
- [x] A-002 R2: All four footer actions (Help, Keyboard, Theme, Gear) render with the shared class; icons, order, aria-labels, Tips, and click behaviors are unchanged
- [x] A-003 R3: The right action cluster uses `gap-1`
- [x] A-004 R5: The `FOOTER_ICON_CLASS` comment and `SidebarFooter` JSDoc state the shared chip vocabulary and attribute the reversal to 260811-cj4b; no comment claims the borderless contrast as current

### Behavioral Correctness

- [x] A-005 R1: Hover treatment on footer actions is the `rk-glint` sweep + green border/glyph flip, identical in kind to top-bar chips
- [x] A-006 R4: The footer row's resting height is unchanged (no layout shift against the sidebar bottom edge)

### Removal Verification

- [x] A-007 R1: The borderless constant (`min-w-[24px] min-h-[24px] … hover:text-text-primary`) no longer exists anywhere in `sidebar/index.tsx`

### Scenario Coverage

- [x] A-008 R7: `sidebar/index.test.tsx` asserts all four footer actions carry `rk-glint` + `border`, and `just test-frontend` passes

### Edge Cases & Error Handling

- [x] A-009 R1: Coarse-pointer touch target remains 30×30 (`coarse:w-[30px] coarse:h-[30px]`), preserving the previous coarse size

### Code Quality

- [x] A-010 Pattern consistency: New code follows naming and structural patterns of surrounding code (constant-template idiom mirroring `TOP_BAR_BUTTON`)
- [x] A-011 No unnecessary duplication: `TOP_BAR_BUTTON_REST` is imported from `top-bar-overflow-menu.tsx`, not duplicated as a string
- [x] A-012 Test coverage: Changed behavior is covered by updated unit tests per `fab/project/code-quality.md` (test-alongside)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change replaces the footer idiom in place (old constant swapped at the same declaration site) without making other existing code redundant.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Update the two existing borderless-idiom assertions in place and add one all-four-actions chip assertion rather than restructuring the footer describe block | Minimal diff; the block's other tests (order, aria, tips, behaviors) already cover R2's unchanged surface | S:75 R:90 A:85 D:80 |
| 2 | Certain | Verify R4 (no row-height change) by inspection — the 24px fixed box with border inside `box-sizing` equals the old 24px min-box at rest | CSS box model is deterministic; the intake's own row-height check section specifies this verification | S:85 R:90 A:90 D:90 |
| 3 | Confident | E2E verification limited to running the existing `sidebar-footer` spec — no spec edits expected (bordered chips add no `pointer-events` gating) | Intake states this explicitly; styling-only change | S:80 R:85 A:85 D:80 |

3 assumptions (1 certain, 2 confident, 0 tentative).
