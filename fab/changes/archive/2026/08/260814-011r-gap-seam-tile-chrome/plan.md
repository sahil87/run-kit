# Plan: Gap-Seam Tile Chrome

**Change**: 260814-011r-gap-seam-tile-chrome
**Intake**: `intake.md`

## Requirements

### Surface Layout: Seam geometry (grid + tile chrome)

#### R1: Tiles float on the inset ground with a wider gutter, ground inset, larger radius, and dimmed rest border
The desktop tile grid container (`app/frontend/src/components/surface-layout.tsx`, currently `grid gap-[3px] bg-bg-inset`) SHALL widen its gutter to 6px (`gap-[6px]`) and gain a NEW 6px ground inset (`p-[6px]`) so tiles float on the `bg-bg-inset` ground on all four sides at every arity, including `single`. Each desktop tile SHALL change its radius from `rounded` (4px) to `rounded-md` (6px) and its rest-state border color from full `border-border` to a ~55% mix of the border token (`color-mix(in srgb, var(--color-border) 55%, transparent)`). The focused-tile border MUST remain full `--color-accent-green` (existing 260812-wfic R2 behavior — suppressed at arity 1, default slot A). The tile header's `border-b` and other in-tile hairlines are NOT in scope — only the tile's outer frame border dims.

- **GIVEN** a desktop `single:tty` layout
- **WHEN** the terminal route renders
- **THEN** the terminal tile shows 6px of `bg-bg-inset` ground on all four sides, a 6px-radius frame, and the dimmed border — "the home for the main panel" reads as a rounded card

- **GIVEN** a desktop multi-tile layout with slot B focused
- **WHEN** tiles render
- **THEN** unfocused tiles carry the 55% dimmed border while the focused tile's border is full `accent-green`, exactly as before

### Surface Layout: Divider sash — three states

#### R2: Dividers render grip dots at rest and an accent-green sash pill on hover/drag
Each divider SHALL replace today's invisible-at-rest 6px hit zone with hover `bg-accent-green` fill (`w-1.5`/`h-1.5` + `hover:bg-accent-green`) with a three-state treatment:

- **Rest**: 3 centered grip dots (~2.5px each, border-token-colored, `pointer-events-none`) rendered in the gutter — stacked vertically on an x-axis (column) divider, horizontally on a y-axis (row) divider. No fill.
- **Hover**: a 5px-wide rounded pill (border-radius 3px, `--color-accent-green`) fills the gap along the seam, inset ~10px from both ends so it never touches the tile radii. The pill appears after a ~150ms `transition-delay` (anti-flicker — brushing across a seam en route to a tile must not strobe). Grip dots invert to the ground color while the sash is lit.
- **Dragging**: the same pill with zero delay (the `draggingIndex === spec.index` render is immediate).

The hit zone SHALL widen from 6px to 14px (`w-1.5` → `w-3.5` / `h-1.5` → `h-3.5`, same `-translate-*-1/2` centering). The sash/grip treatment lands as new `rk-*` utility classes in `app/frontend/src/globals.css` (the established convention for pseudo-element/child styling with delays); simple one-off values (gap, padding, radius, hit-zone width) stay inline Tailwind in `surface-layout.tsx`. Existing drag mechanics MUST be unchanged: `onDividerPointerDown`/`Move`/`Up` pointer capture, `clampRatio` + `MIN_PANEL_WIDTH_PX` (280px) floors, persist-on-release via `writeStoredRatios`, `touchAction: "none"`, tiles-stay-live/no-suspension, content `pointer-events: none` mid-drag, `role="separator"` + `aria-valuenow`, and dividers render only when not zoomed and never on `single`.

- **GIVEN** a desktop `split-h` layout with the pointer at rest away from the seam
- **WHEN** nothing is hovered
- **THEN** the seam shows only the 3 grip dots — no fill

- **GIVEN** the pointer moves onto a divider hit zone and stays
- **WHEN** ~150ms elapse
- **THEN** the rounded sash pill renders in the gap, inset from both ends, and the grip dots invert

- **GIVEN** an in-progress divider drag
- **WHEN** the pointer moves and releases
- **THEN** the pill shows immediately (no delay), the ratio clamps exactly as today, and the ratio persists on release only

### Surface Layout: Intersection — two-axis drag (`main-*` shapes)

#### R3: A T-junction zone lights both sashes and drags both ratios
In `main-left` / `main-right` / `main-top`, a ~20px hit zone SHALL be centered on the point where the two dividers meet (from `dividerSpecs` geometry — e.g. main-left at (`r0`%, `r1`%); main-right at (`r0`%, `r1`%) with the y-divider confined right-to-left; main-top at (`r1`%, `r0`%)). The zone:

- renders only on desktop, only in `main-*` shapes, never zoomed (same gating as dividers), with testid `surface-divider-intersection`;
- sits above both dividers in z-order so it wins the hit-test at the junction;
- carries `cursor: move` (single-axis dividers keep `cursor-col-resize`/`cursor-row-resize`);
- on **hover**, lights BOTH sashes (both pills render, same 150ms delay semantics); hovering a seam away from the junction lights only that seam;
- on **drag**, moves BOTH ratios at once: pointer x updates the x-axis boundary and pointer y the y-axis boundary (main-left/right: x → ratio 0, y → ratio 1; main-top: y → ratio 0, x → ratio 1), each clamped independently by the existing per-boundary 280px-floor clamp, both persisted on release via the existing `writeStoredRatios` path, with pointer capture and `touchAction: "none"` like the dividers.

`row`/`col` (two parallel same-axis dividers, no junction), `split-h`/`split-v`, and `single` SHALL render no intersection zone.

- **GIVEN** a desktop `main-left` 3-tile layout
- **WHEN** the pointer hovers the T-junction zone
- **THEN** both sash pills light (after the delay); moving off to a single seam lights only that seam

- **GIVEN** a drag started on the intersection zone
- **WHEN** the pointer moves diagonally and releases
- **THEN** both ratios track the pointer (each independently clamped), tiles stay live mid-drag, and both ratios persist on release

- **GIVEN** a `row` or `col` layout
- **WHEN** it renders
- **THEN** no intersection zone exists

### Board: Shared framed-tile vocabulary (bounded)

#### R4: Board idle-pane border dims; semantic borders stay full-strength
The idle board-pane border (`app/frontend/src/components/board/board-pane.tsx` ~line 186, `border border-border`) SHALL dim to the same ~55% border mix as R1. The semantic border states MUST stay full-strength and untouched: `waiting` (3px `rk-waiting-seam`) and focused (`border-accent` + shadow ring) are status signals, not card chrome. No gutters, ground inset, sash, radius, or drag changes on the board route.

- **GIVEN** a board with an idle, a focused, and a waiting pane
- **WHEN** it renders
- **THEN** only the idle pane's border is dimmed; the waiting seam and focused accent render exactly as before

### Mobile & motion

#### R5: The mobile branch stays fully exempt
Below `isMobileViewport()` the layout manager MUST keep rendering no tile chrome: no borders, radius, gutters, ground inset, dots, sash, or intersection zone — the mobile `renderTile` path stays `flex-1` only.

- **GIVEN** a 375px viewport on the terminal route
- **WHEN** the layout renders
- **THEN** the DOM carries none of the new chrome and the terminal keeps full width

#### R6: The sash hover delay is zeroed under `prefers-reduced-motion`
The motion-kill block in `globals.css` (`@media (prefers-reduced-motion: reduce)`, ~line 556) is per-class, not global — the new sash class SHALL get its own entry zeroing the transition/delay so the pill appears instantly; the states themselves (dots, pill, inversion) remain.

- **GIVEN** `prefers-reduced-motion: reduce`
- **WHEN** a divider is hovered
- **THEN** the sash renders without the 150ms delay and all states remain reachable

### Non-Goals

- Tier 2 shell card-ification (sidebar/center/rail as floating cards) — deferred to a separate future change.
- `session-tiles/` preview cards — list cards, not framed layout tiles.
- Board-route gutters, ground inset, radius, sash, or drag-model changes (its header-drag width model and no-handle Shell seam branch are Tier 2 territory).
- Keyboard-driven ratio adjustment — ratios remain pointer-only, as shipped in 260812-ab5v/R5.
- The full-border fallback — a noted escape hatch, not implemented.

### Design Decisions

#### Sash accent is green, not VS Code blue
**Decision**: The sash pill uses `--color-accent-green`, not VS Code's blue and not run-kit's `--color-accent`.
**Why**: Green already means interactive/live-pane in run-kit's hover vocabulary (CRT glint, focused tile, agent state); the focus border (1px frame) and sash (5px pill) differ by geometry, so sharing the hue is unambiguous.
**Rejected**: VS Code-literal blue — it would split the hover vocabulary; shown as a toggle in the design mock and rejected.
*Introduced by*: 260814-011r-gap-seam-tile-chrome

#### The gap does the separating — tile borders dim to 55%
**Decision**: Rest-state tile borders (and the board idle-pane border) dim to a 55% `color-mix` of `--color-border`; separation is carried by the widened gutter + ground inset.
**Why**: Full-strength borders 3px apart read as one shared border, not cards with a gap; VS Code's language keys card identity off the ground gap.
**Rejected**: Keeping full-strength borders — approved-mock decision; known tension against dark terminal content accepted, full-border fallback noted as an escape hatch only.
*Introduced by*: 260814-011r-gap-seam-tile-chrome

## Tasks

### Phase 2: Core Implementation

- [x] T001 Add the gap-seam CSS to `app/frontend/src/globals.css`: `rk-*` utilities for the sash pill (5px, r=3px, accent-green, 150ms hover `transition-delay`, zero-delay drag state), the 3 grip dots (border-colored, inverting to ground while lit, `pointer-events: none`), the dimmed card border (shared 55% `color-mix` treatment for tiles + board idle panes), and a `prefers-reduced-motion` entry zeroing the sash delay in the ~line-556 block <!-- R2, R6 -->
- [x] T002 [P] Update grid + tile classes in `app/frontend/src/components/surface-layout.tsx`: container `gap-[3px]` → `gap-[6px]` + `p-[6px]`; desktop tile `rounded` → `rounded-md`, rest border → the dimmed treatment from T001; focused border stays `border-accent-green`; mobile branch untouched <!-- R1, R5 -->
- [x] T003 Redesign the divider render in `surface-layout.tsx`: widen hit zones `w-1.5`/`h-1.5` → `w-3.5`/`h-3.5`, render the sash pill + grip dots as children (axis-aware orientation), wire the three states (rest/hover/drag) to the T001 classes; keep every existing drag/aria/persistence mechanic unchanged <!-- R2 -->
- [x] T004 Add the intersection zone in `surface-layout.tsx`: derive the junction point per `main-*` shape from the existing `dividerSpecs` geometry, render a ~20px `surface-divider-intersection` zone (desktop, non-zoomed, `main-*` only) above the dividers with `cursor: move`; hover lights both sashes; a two-axis drag handler maps pointer x/y to the shape's two ratio indices, reusing the existing clamp + `writeStoredRatios` release path with pointer capture and `touchAction: "none"` <!-- R3 -->
- [x] T005 [P] Dim the idle board-pane border in `app/frontend/src/components/board/board-pane.tsx` (~line 186) using the shared T001 treatment; leave the `waiting` seam and focused accent branches untouched <!-- R4 -->

### Phase 3: Integration & Tests

- [x] T006 Extend `app/frontend/src/components/surface-layout.test.tsx`: grid/tile class assertions (gutter, inset, radius, dimmed vs focused border), grip-dot render + `pointer-events-none`, sash element presence per state, intersection-zone presence in `main-*` only (absent on `single`/`split-*`/`row`/`col`/zoomed/mobile), and two-axis drag math (both ratios move, clamps hold, both persist on release); update any board-pane unit assertions touched by T005 <!-- R1, R2, R3, R4, R5 -->
- [x] T007 Update `app/frontend/tests/e2e/surface-layout.spec.ts` + `surface-layout.spec.md` (same commit, per constitution): keep the existing divider drag/persistence cases green (mechanics unchanged); add sash-state coverage (rest dots, hover pill, drag pill) and intersection coverage (hover lights both, drag moves both `aria-valuenow`s, persistence) — reuse/extend the ONE existing 3-tile mount (HTTP/1.1 6-slot perf budget is binding) and hover the divider/zone before hit-testing (`pointer-events-none` dots) <!-- R2, R3 -->
- [x] T008 Verification gates: `cd app/frontend && npx tsc --noEmit`, `just test-frontend`, and the targeted e2e (`just test-e2e "surface-layout"`); fix fallout <!-- R1, R2, R3, R4, R5, R6 -->

## Execution Order

- T001 blocks T002/T003/T004/T005 (they consume its classes); T002 and T005 are `[P]` against each other and T003/T004
- T003 blocks T004 (the intersection reuses the sash render)
- T006/T007 follow the implementation; T008 last

## Acceptance

### Functional Completeness

- [x] A-001 R1: The desktop grid renders `gap-[6px]` + `p-[6px]` on the `bg-bg-inset` ground at every arity including `single`; tiles are `rounded-md` with the 55% dimmed rest border
- [x] A-002 R2: Each divider renders 3 grip dots at rest, the inset rounded accent-green pill on hover (delayed ~150ms) and drag (immediate), on a 14px hit zone
- [x] A-003 R3: `main-left`/`main-right`/`main-top` render the `surface-divider-intersection` zone at the junction; hover lights both sashes; drag moves both ratios
- [x] A-004 R4: The idle board-pane border is dimmed; `waiting` seam and focused accent are byte-identical to before
- [x] A-005 R5: The mobile branch renders none of the new chrome (tile stays `flex-1`-only)
- [x] A-006 R6: The reduced-motion block zeroes the sash delay; all sash states remain reachable

### Behavioral Correctness

- [x] A-007 R2: Divider drag mechanics are unchanged — clamping (280px floors), persist-on-release, `aria-valuenow`, tiles live mid-drag, content `pointer-events-none` mid-drag; the pre-existing divider e2e cases pass unmodified in their drag semantics
- [x] A-008 R3: Intersection drag updates both ratios with independent clamps, captures the pointer, and persists both on release only; the zone wins the hit-test over both dividers at the junction
- [x] A-009 R1: The focused-tile border remains full accent-green and suppressed at arity 1

### Scenario Coverage

- [x] A-010 R2/R3: e2e covers the three sash states and the intersection (hover-both, drag-both, persistence), reusing the single 3-tile mount within the perf budget; `.spec.md` updated in the same commit
- [x] A-011 R1–R5: Unit tests cover the class/geometry changes, grip dots, intersection presence matrix, and two-axis drag math

### Edge Cases & Error Handling

- [x] A-012 R3: No intersection zone on `single`/`split-h`/`split-v`/`row`/`col`, on zoomed renders, or on mobile; a mid-drag `pointercancel` releases capture without stranding drag state (the existing endDrag double-release guard pattern)
- [x] A-013 R2: Grip dots are `pointer-events-none` and never intercept divider hits; the widened hit zones do not overlap tile verb buttons or swallow tile clicks (z-order confined to the gutter region)

### Code Quality

- [x] A-014 Pattern consistency: new CSS follows the `rk-*` utility convention with comments matching `globals.css` style; component changes match `surface-layout.tsx`'s existing comment density and structure
- [x] A-015 No unnecessary duplication: junction geometry derives from `dividerSpecs` output (single-sourced), the two-axis drag reuses the existing clamp/persist helpers, and the dimmed-border treatment is one shared definition used by tiles and board panes

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

None — this change replaces the old divider chrome (`hover:bg-accent-green` fill, 6px hit zones) in place and extracts `clampBoundary` from the existing inline clamp math; no existing symbol, file, or branch is left redundant.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | The intersection zone is a separate absolutely-positioned element with its own pointer handlers that reuse the existing per-boundary clamp math and `writeStoredRatios` release path (no refactor of the single-axis drag machinery) | Smallest change that satisfies R3; the single-axis path stays byte-stable for A-007 | S:70 R:85 A:85 D:75 |
| 2 | Confident | Sash pill + grip dots render as child elements of the existing divider divs, styled by new `rk-*` classes; divider geometry stays single-sourced in `dividerSpecs` | Follows the established `rk-*` convention; keeps the divider DOM the drag target so mechanics are untouched | S:65 R:90 A:85 D:75 |
| 3 | Confident | The 55% dimmed border ships as one shared CSS treatment consumed by both surface tiles and the board idle pane (exact vehicle — utility class vs shared constant — left to implementation) | A-015 requires single-sourcing; the vehicle is reviewable and trivially reshaped | S:60 R:90 A:85 D:70 |

3 assumptions (0 certain, 3 confident, 0 tentative).
