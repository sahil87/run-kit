# Plan: Fix main-* divider clamp cross-axis contamination

**Change**: 260908-ek6j-fix-main-divider-cross-axis-clamp
**Intake**: `intake.md`

## Requirements

### Surface Layout: Divider Clamp

#### R1: Shape-aware boundary clamp
`clampBoundary` MUST derive its neighbor bounds from the layout shape: sibling-boundary chaining (`prev = cur[index-1]`, `next = cur[index+1]`, with 0/100 at the edges) applies ONLY to `row`/`col`, whose two ratios are same-axis dividers that must not cross or strand each other. For `main-left`/`main-right`/`main-top` (whose two ratios live on different axes) and `split-h`/`split-v` (single ratio), each ratio MUST clamp independently to `[floor, 100 − floor]` on its own axis (`prev = 0`, `next = 100`), where `floor = MIN_PANEL_WIDTH_PX / sizePx · 100` via the unchanged `clampRatio`. The other ratio SHALL NOT participate in the band.

- **GIVEN** `main-left` with ratios `[22, 37]` and a grid short enough that `[r0 + floorY, 100 − floorY]` is empty under the old chaining (e.g. `sizePx = 700`, `floorY = 40`)
- **WHEN** divider 1 (the code/web y-seam) is dragged to any raw percentage
- **THEN** the result is clamped to `[40, 60]` — the own-axis floor band — and follows the pointer within it (no longer pinned at `r0 + floorY`)

- **GIVEN** `row` with ratios `[30, 60]` and `sizePx = 1000` (`floor = 28`)
- **WHEN** divider 0 is dragged right to raw 80
- **THEN** it clamps to `60 − 28 = 32` — sibling chaining is preserved exactly as today

#### R2: All three call sites pass the shape
The single-axis divider drag (`onDividerPointerMove`) and both intersection-drag clamps (`onIntersectionPointerMove` x and y calls) in `app/frontend/src/components/surface-layout.tsx` MUST invoke the shape-aware clamp with the current `layout.shape`. With independent per-axis bands, the intersection drag's pre-move-ratios snapshot is no longer a contamination vector.

- **GIVEN** `main-left` and an intersection drag
- **WHEN** the pointer moves horizontally (changing ratio 0 across moves)
- **THEN** ratio 1's clamp band is `[floorY, 100 − floorY]` on every move, unaffected by ratio 0's value

#### R3: row/col invariant untouched
The `row`/`col` sibling invariant — a divider may never cross or strand its sibling, including the impossible-bounds degeneration (`Math.max(next − floor, prev + floor)` when the band inverts) — MUST behave byte-for-byte as today. `clampRatio` and `MIN_PANEL_WIDTH_PX` in `app/frontend/src/lib/right-panel.ts` SHALL NOT change.

- **GIVEN** `col` with ratios `[30, 45]` and a container where `floor` makes `[prev + floor, next − floor]` empty for divider 0
- **WHEN** divider 0 is dragged
- **THEN** it degenerates to `prev + floor` exactly as the current implementation does

#### R4: Directly testable clamp seam
The clamp MUST be exported as a pure helper unit-testable without DOM geometry (jsdom's zero `getBoundingClientRect` makes render-driven drags no-op, per `surface-layout.test.tsx`), following the established pattern of `right-panel.ts` exporting `clampRatio`. Unit tests MUST pin: (a) the short-viewport un-pinning scenario, (b) main-* axis independence, (c) the row/col regression guard with degeneration.

- **GIVEN** the exported helper
- **WHEN** the unit suite runs under jsdom
- **THEN** cases (a)/(b)/(c) assert the clamp bands directly on pure inputs, no rendered component required

### Non-Goals

- No stored-ratio migration or healing — the old bug pinned drags inside valid ranges; it never persisted out-of-range values.
- No change to drag routing (window-level pointer listeners), persistence (`writeStoredRatios`), divider chrome, or the intersection zone's geometry/hit-testing.
- No new e2e test — seam-drag capture loss is not reliably reproducible synthetically; coverage lands in unit tests.

### Design Decisions

#### Clamp helper lives in `lib/right-panel.ts` § layout-divider clamp
**Decision**: Move `clampBoundary` out of the component into `app/frontend/src/lib/right-panel.ts`'s existing "layout-divider clamp (surface-layout R5)" section with a `shape: LayoutShape` parameter, beside `clampRatio`/`MIN_PANEL_WIDTH_PX`; the component imports it back. The `LayoutShape`/`LayoutRatios` types ride the file's existing type-only import from `./surface-layout`.
**Why**: That section is the named home for the divider clamp — `clampRatio` and the floor constant already live and are unit-tested there (`right-panel.test.ts`), so the whole composed band becomes directly testable next to its floor math with zero new module edges.
**Rejected**: `lib/surface-layout.ts` — it would need runtime imports of `clampRatio`/`MIN_PANEL_WIDTH_PX` from `right-panel.ts`, which already runtime-imports `availableTiles` from `surface-layout.ts`: a module cycle. Also rejected: exporting the helper from the component file (pure-logic exports from `.tsx` cut against the repo's lib/components split) and a `boundaryNeighbors`-only fragment (splits one invariant across two files, leaves the composed band untested).
*Introduced by*: 260908-ek6j-fix-main-divider-cross-axis-clamp

## Tasks

### Phase 2: Core Implementation

- [x] T001 Move `clampBoundary` from `app/frontend/src/components/surface-layout.tsx` into `app/frontend/src/lib/right-panel.ts`'s layout-divider clamp section as an exported pure helper with signature `clampBoundary(shape, cur, index, rawPct, sizePx)`; derive neighbors shape-aware (row/col: sibling chain with 0/100 edges; all other shapes: `prev = 0`, `next = 100`); doc comment states the same-axis-siblings-only invariant (no history narration) <!-- R1 -->
- [x] T002 Update `app/frontend/src/components/surface-layout.tsx`: delete the local `clampBoundary`, import it from `@/lib/right-panel`, and pass `layout.shape` at all three call sites (single-axis `onDividerPointerMove`, intersection x + y calls); update the divider/intersection comments that restate the neighbor rule <!-- R2 -->
- [x] T003 Add unit tests in `app/frontend/src/lib/right-panel.test.ts` (beside the `clampRatio` suite): (a) main-left short-viewport un-pinning — divider 1 follows raw input within `[floorY, 100 − floorY]` on a geometry where the old chain pinned it; (b) axis independence — for each `main-*` shape, each index's clamp result is invariant under changes to the other ratio; (c) row/col regression — sibling chaining bands and the impossible-bounds degeneration match the current behavior <!-- R4 -->
- [x] T004 Verification: run the scoped unit suites (`lib/right-panel`, `components/surface-layout`) and `tsc --noEmit` in `app/frontend`, then `just test-e2e "surface-layout"` on the derived rig <!-- R3 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: `clampBoundary` clamps `main-*`/`split-*` ratios to the own-axis `[floor, 100 − floor]` band with no term from the other ratio, and keeps sibling chaining for `row`/`col`
- [x] A-002 R2: all three call sites in `components/surface-layout.tsx` pass the current `layout.shape`; no call site retains the shape-blind form

### Behavioral Correctness

- [x] A-003 R1: on the short-viewport main-left geometry where the old code pinned divider 1 at `r0 + floorY`, the seam now tracks the pointer within `[floorY, 100 − floorY]`
- [x] A-004 R2: during a main-* intersection drag, horizontal pointer movement no longer shifts the y-seam's clamp band (and vice versa)

### Scenario Coverage

- [x] A-005 R4: unit cases (a)/(b)/(c) exist in `lib/right-panel.test.ts` and pass
- [x] A-006 R3: existing `right-panel` and `surface-layout` unit suites and the `surface-layout.spec.ts` e2e pass unmodified (no spec asserts the old pinned behavior)

### Edge Cases & Error Handling

- [x] A-007 R1: containers below `2 × MIN_PANEL_WIDTH_PX` on an axis still collapse that axis's boundary to 50 via the unchanged `clampRatio`; row/col band inversion still degenerates to `prev + floor`

### Code Quality

- [x] A-008 Pattern consistency: the helper follows the `right-panel.ts` layout-divider clamp section's pure/DOM-free style and the `clampRatio` export-for-test pattern
- [x] A-009 No unnecessary duplication: `clampRatio` is reused, not reimplemented; no second floor computation drifts from `MIN_PANEL_WIDTH_PX`
- [x] A-010 Comment discipline: updated comments state the invariant (same-axis siblings only), never history, change IDs, or PR numbers

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

None — the former component-local `clampBoundary` was removed as part of this change, and no other existing code became redundant.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Helper relocation to `lib/right-panel.ts` § layout-divider clamp (not the component, not `lib/surface-layout.ts`) | Within intake assumption 3's latitude ("equivalent form acceptable"); the section already owns `clampRatio`/`MIN_PANEL_WIDTH_PX` with tests, and the alternative lib home would create a right-panel ↔ surface-layout module cycle | S:75 R:90 A:85 D:75 |
| 2 | Certain | `layout.shape` is available at all three call sites without new plumbing | All three handlers close over the component's `layout` prop; the mid-drag window listeners already route through latest-closure refs, so the current shape is what they see | S:85 R:90 A:90 D:90 |
| 3 | Confident | `split-h`/`split-v` ride the independent branch (pure `clampRatio`) | Arity 1 means `prev`/`next` already resolved to 0/100, so the band is identical except on a degenerate axis (< 2×280px), where the old composed math pinned at `floorPct > 50` and the branch now honors `clampRatio`'s documented 50/50 collapse — an intended alignment, not drift | S:75 R:95 A:90 D:80 |

3 assumptions (1 certain, 2 confident, 0 tentative).
