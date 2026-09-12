# Plan: Quake Terminal Edge and Corner Resize

**Change**: 260912-jl4w-quake-terminal-resize
**Intake**: `intake.md`

## Requirements

### Quake terminal: Geometry model

#### R1: Three-field geometry with a viewport-bounded center offset
`QuakeGeometry` in `app/frontend/src/lib/quake-terminal.ts` SHALL be `{ heightVh, widthPx, centerOffsetPx }`, where `centerOffsetPx` is the signed displacement of the drawer's center from the viewport center (positive = right). `QUAKE_GEOMETRY_DEFAULT` SHALL be `{ heightVh: 55, widthPx: 760, centerOffsetPx: 0 }`. `clampQuakeGeometry(geometry, viewportWidth)` SHALL keep the 25–85vh and 420px–96vw clamps and additionally clamp the offset to `|centerOffsetPx| ≤ max(0, (viewportWidth − clampedWidth)/2 − QUAKE_EDGE_PAD_PX)` with `QUAKE_EDGE_PAD_PX = 8`, rounding the offset to an integer and treating a non-finite offset as 0. With an undefined viewport width the offset is unclamped.

- **GIVEN** `{heightVh:55, widthPx:760, centerOffsetPx:500}` and a 1000px viewport
- **WHEN** clamped
- **THEN** `centerOffsetPx` is `112` (= (1000−760)/2 − 8), and `−500` clamps to `−112`
- **AND GIVEN** `widthPx: 2000` on a 1000px viewport, **THEN** width clamps to 960 and the offset to `|offset| ≤ 12`

#### R2: Stored geometry of either shape reads correctly
`readQuakeGeometry()` SHALL accept a stored record without `centerOffsetPx` (the pre-change two-field shape, under the current or the retired key) and read it with `centerOffsetPx: 0`; a record whose `centerOffsetPx` is present but not a finite number SHALL degrade to the defaults like any other corrupt record. `writeQuakeGeometry()` SHALL persist all three fields (clamped) under `runkit-quake-terminal-geometry` and remove the retired key, as today.

- **GIVEN** `runkit-quake-terminal-geometry` = `{"heightVh":70,"widthPx":900}`
- **WHEN** read
- **THEN** the result is `{heightVh:70, widthPx:900, centerOffsetPx:0}`
- **AND GIVEN** the retired key holds the same two-field record and the new key is absent, **THEN** the same result
- **AND GIVEN** `{"heightVh":70,"widthPx":900,"centerOffsetPx":"12"}`, **THEN** the defaults

### Quake terminal: Drag model and positioning

#### R3: Independent-edge drag through an edge mask
`components/quake-terminal.tsx` SHALL drive every grip through one handler set keyed on `QuakeResizeEdge = { x: -1|0|1; y: 0|1 }` (exported from `lib/quake-terminal.ts`). On pointer move with `dx`/`dy` from the pointer-down origin: `y === 1` → `heightVh = start.heightVh + dy / innerHeight · 100`; `x === −1` → `widthPx = start.widthPx − dx`, `centerOffsetPx = start.centerOffsetPx + dx/2`; `x === 1` → `widthPx = start.widthPx + dx`, `centerOffsetPx = start.centerOffsetPx + dx/2`; a corner applies both. The result is clamped through `clampQuakeGeometry`. Pointer capture, the `.rk-quake-dragging` class, the in-component `dragOverride`, and the single store write on pointer-up MUST be preserved; `pointercancel` MUST end the drag through the same up path.

- **GIVEN** the drawer at 760px, offset 0
- **WHEN** the right grip is dragged +100px
- **THEN** the live width is 860px and the live offset +50px, so the left edge stays put and the right edge sits under the pointer
- **AND WHEN** the bottom-right corner is dragged (+100, +Δy), **THEN** width, offset, and height all change in one drag

#### R4: Offset applied via `left`; display-only re-clamp on viewport resize
The drawer root SHALL position with `left: calc(50% + {centerOffsetPx}px)` and keep `-translate-x-1/2` (the centering rides the CSS `translate` property; the slide rides `transform`); the `left-1/2` utility MUST be removed so the offset is applied exactly once. `maxWidth: 96vw` stays. While rendered on desktop the component SHALL listen for `window` `resize` and re-render so the effective geometry is re-clamped against the new `innerWidth`; this re-clamp MUST NOT write the store.

- **GIVEN** a persisted offset of +300 on a wide viewport
- **WHEN** the window shrinks so the max offset is 100
- **THEN** the rendered `left` reflects an offset of 100 and `localStorage` still holds 300

### Quake terminal: Grips, cue, reset

#### R5: Five grips
The drawer SHALL render five `aria-hidden` `touch-none select-none` grips as its last children (edges first, corners last): `quake-terminal-grip-left` (`left-[-5px] top-0 bottom-0 w-2.5`, `cursor-ew-resize`, mask `{x:-1,y:0}`), `quake-terminal-grip-right` (mirror, `{x:1,y:0}`), `quake-terminal-grip-bottom` (`left-0 right-0 bottom-[-5px] h-2.5`, `cursor-ns-resize`, `{x:0,y:1}`) which contains the existing 64×12px glass tongue `<span>` at `left-1/2 top-full -translate-x-1/2`, `quake-terminal-grip-bottom-left` (`left-[-6px] bottom-[-6px] h-4 w-4`, `cursor-nesw-resize`, `{x:-1,y:1}`), and `quake-terminal-grip-bottom-right` (`right-[-6px] bottom-[-6px] h-4 w-4`, `cursor-nwse-resize`, `{x:1,y:1}`). The former `quake-terminal-grip-height` test id is retired.

- **GIVEN** the drawer is open on desktop
- **WHEN** the DOM is inspected
- **THEN** exactly those five test ids exist, the tongue span is inside the bottom grip, and no `quake-terminal-grip-height` element exists

#### R6: Hover cue — the grabbed edge tints accent-green
The component SHALL track `hoverEdge` (set on grip `pointerenter`, cleared on `pointerleave`) and derive `litEdge = activeDragEdge ?? hoverEdge`. Each **edge** grip carries class `rk-quake-grip` and, when its axis is set in `litEdge`, `data-lit=""` + class `rk-quake-grip-lit` (so a corner lights both adjacent edges; corners paint nothing themselves). `globals.css` SHALL define `.rk-quake-grip::after` as a 3px `var(--color-accent-green)` bar with `border-radius: 2px` along the drawer border on the grip's inner side, `opacity: 0` at rest, `opacity: 1` when lit, `transition: opacity 120ms` with `transition-delay: 150ms` on the hover-in direction only (zero when unlit and zero under `.rk-quake-dragging`). While the bottom edge is lit the tongue span's border SHALL be accent-green. Under `prefers-reduced-motion: reduce` the transition and delay are zeroed; the lit state remains.

- **GIVEN** the pointer enters `quake-terminal-grip-bottom-right`
- **WHEN** the DOM is inspected
- **THEN** `grip-right` and `grip-bottom` carry `data-lit` and `grip-left` does not
- **AND WHEN** the pointer leaves, **THEN** no grip carries `data-lit`

#### R7: Double-click reset
`dblclick` on any grip SHALL clear `dragOverride` and write `QUAKE_GEOMETRY_DEFAULT` to the store.

- **GIVEN** a drawer resized to 70vh × 900px, offset +80
- **WHEN** any grip is double-clicked
- **THEN** `runkit-quake-terminal-geometry` holds `{heightVh:55, widthPx:760, centerOffsetPx:0}` and the drawer renders at the defaults

#### R8: Palette entry for the reset
`lib/palette/quake-terminal.ts` SHALL export `buildQuakeTerminalResetSizeAction()` returning `{ id: "quake-terminal-reset-size", label: "Operator: Reset quake terminal size", onSelect }` where `onSelect` calls `writeQuakeGeometry(QUAKE_GEOMETRY_DEFAULT)`; `hooks/use-global-palette-actions.ts` SHALL fold it into the layout-global group directly after `quakeTerminalLogEntry`, always listed like its siblings (the store write is inert where no drawer renders).

- **GIVEN** the palette is open
- **WHEN** the user picks `Operator: Reset quake terminal size`
- **THEN** the geometry store holds the defaults and an open drawer re-renders at 55vh × 760px centered

### Non-Goals

- Anything the drawer contains (segments, terminal, status line) — Change 2.
- The mobile arm and `QuakeTerminalTongue` — unchanged.
- A top-edge grip, keyboard-driven resize, or a resize settings row.
- `operator-compose-dialog.tsx` / `operator-compose.spec.ts`.

### Design Decisions

#### Independent edges replace symmetric-about-center
**Decision**: each edge moves only its own side; the width changes by the pointer delta and the persisted `centerOffsetPx` shifts by half of it, so the opposite edge stays put and the drawer may rest off-center.
**Why**: under symmetric width a corner grows the drawer at twice the pointer speed and cannot track the pointer; centering existed to sit under the top-bar launcher, an anchor the docked compose (Change 2) removes — the quake genre needs the drawer to *open* centered, not to *stay* so.
**Rejected**: symmetric width with corners (the corner escapes the pointer); no corners (two drags for one shape).
*Introduced by*: 260912-jl4w-quake-terminal-resize

#### Grip hover cue reuses the divider sash vocabulary
**Decision**: a lit edge paints a 3px accent-green inner bar with the layout dividers' ~150ms anti-flicker hover delay (immediate on drag); a corner lights both adjacent edges, the T-junction idiom.
**Why**: one drag-affordance vocabulary across the app — the sash is already what "this seam resizes" looks like here; brushing across an edge en route to the terminal never strobes.
**Rejected**: tinting the drawer's own 1px hairline border (too faint to read as an affordance); a new grip-dot treatment (a second vocabulary for one meaning).
*Introduced by*: 260912-jl4w-quake-terminal-resize

#### Viewport re-clamp is display-only
**Decision**: on `window` resize the component re-clamps the rendered geometry without writing the store.
**Why**: a transiently narrow window must not erase the viewer's preferred offset; per-viewer preferences are written only on user action.
**Rejected**: writing the clamped value back on resize.
*Introduced by*: 260912-jl4w-quake-terminal-resize

### Deprecated Requirements

#### Symmetric-about-center width resize
**Reason**: replaced by independent edges (R3) — the symmetric model cannot support corners.
**Migration**: two-field stored geometry reads with offset 0 (R2); a viewer who wants the centered posture back double-clicks a grip or picks the palette reset (R7, R8).

## Tasks

### Phase 1: Setup

*(none — a fresh worktree needs `just setup` once; already run)*

### Phase 2: Core Implementation

- [x] T001 Extend the geometry model in `app/frontend/src/lib/quake-terminal.ts`: add `centerOffsetPx` to `QuakeGeometry` and `QUAKE_GEOMETRY_DEFAULT`, add `QUAKE_EDGE_PAD_PX = 8`, export `QuakeResizeEdge`, extend `clampQuakeGeometry` with the offset clamp (after the width clamp, non-finite → 0, rounded), and make `parseStoredGeometry` default a missing offset to 0 while rejecting a present non-numeric one; update the geometry-key doc comment. Extend `src/lib/quake-terminal.test.ts` (old-shape read under both keys, non-numeric offset → defaults, offset clamp ±112 at 1000px/760px, offset at the 96vw ceiling, three-field round-trip, default offset 0) and fix the existing two-field literals in that file. <!-- R1, R2 -->
- [x] T002 Rework the drag model and positioning in `app/frontend/src/components/quake-terminal.tsx`: replace `kind` with `edge: QuakeResizeEdge`, implement the R3 move math, route `onPointerCancel` to the up handler, position the root with `left: calc(50% + Npx)` (drop `left-1/2`), add the desktop-only `window` resize listener that re-renders (no store write), render the five R5 grips (tongue span inside the bottom grip), the `hoverEdge`/`litEdge` state with `data-lit` + `rk-quake-grip(-lit)` classes on edge grips, and `onDoubleClick` reset on all five; update the component's JSDoc resize sentence. Rewrite/add the component tests in `src/components/quake-terminal.test.tsx`: right/left/bottom/corner drags with exact width/offset/height expectations, the `left` style, corner hover lights both edges, `pointercancel` ends the drag, double-click writes the defaults, window resize re-clamps `left` without writing the store, and no `grip-height` element. <!-- R3, R4, R5, R6, R7 -->
- [x] T003 [P] Add the lit-grip CSS to `app/frontend/src/globals.css` beside the `.rk-quake-slide` block: `.rk-quake-grip::after` (3px accent-green bar, `border-radius: 2px`, per-side placement via `.rk-quake-grip-left/-right/-bottom` modifier classes or data attributes, `opacity: 0`, `transition: opacity 120ms`), `.rk-quake-grip-lit::after` (`opacity: 1; transition-delay: 150ms`), `.rk-quake-dragging .rk-quake-grip-lit::after { transition-delay: 0ms }`, the lit-bottom tongue border color, and the `prefers-reduced-motion` line zeroing transition + delay. <!-- R6 -->
- [x] T004 [P] Add the palette reset row: `buildQuakeTerminalResetSizeAction()` in `app/frontend/src/lib/palette/quake-terminal.ts` (id `quake-terminal-reset-size`, label `Operator: Reset quake terminal size`, onSelect → `writeQuakeGeometry(QUAKE_GEOMETRY_DEFAULT)`), a test in `src/lib/palette/quake-terminal.test.ts` (shape + the store write), and fold `quakeTerminalResetSizeEntry` into `src/hooks/use-global-palette-actions.ts` after `quakeTerminalLogEntry` (both the array and the deps list). <!-- R8 -->

### Phase 3: Integration & Edge Cases

- [x] T005 Update `app/frontend/tests/e2e/quake-terminal.spec.ts`: retarget the existing height-drag test to `quake-terminal-grip-bottom` (JSDoc + selector), add the corner test (drag `quake-terminal-grip-bottom-right` by (+120, +80) with `page.mouse`; assert via `boundingBox()` that the drawer's right and bottom edges land within 4px of the pointer and the left edge did not move; assert the stored `centerOffsetPx` is positive; reload, reopen via the chord, assert the `left` style carries the persisted offset), each with the constitution's Proves/Steps JSDoc; update the file header's resize sentence. Then run the gates: `cd app/frontend && npx tsc --noEmit`, `just test-frontend` (or scoped vitest on the four touched test files), and `just test-e2e quake-terminal`. <!-- R3, R5, R7 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: `QuakeGeometry` carries `centerOffsetPx`; `clampQuakeGeometry` bounds it by `(viewport − width)/2 − 8`, rounded, non-finite → 0
- [x] A-002 R2: two-field stored records (current and retired key) read with offset 0; a non-numeric offset degrades to defaults; writes persist three fields
- [x] A-003 R3: one edge-mask handler set drives every grip with the specified `dx`/`dx/2`/`dy` math; capture, dragging class, override, and single store write preserved; `pointercancel` handled
- [x] A-004 R4: root positions via `left: calc(50% + Npx)` with `-translate-x-1/2` kept and `left-1/2` removed; a resize listener re-clamps without writing the store
- [x] A-005 R5: the five grips exist with the specified boxes, cursors, masks, and test ids; the tongue span lives inside the bottom grip; `grip-height` is gone
- [x] A-006 R6: corner hover/drag lights both adjacent edge grips (`data-lit`); CSS paints the 3px bar with the 150ms hover-in delay, zero on drag and under reduced motion
- [x] A-007 R7: double-click on any grip writes `QUAKE_GEOMETRY_DEFAULT`
- [x] A-008 R8: `Operator: Reset quake terminal size` exists in the palette group and resets the store

### Behavioral Correctness

- [x] A-009 R3: dragging the right grip +100px yields width +100 and offset +50 (the left edge does not move) — no symmetric doubling remains

### Removal Verification

- [x] A-010 R3: no code path multiplies the pointer delta by 2; the `kind: "height" | "left" | "right"` discriminant is gone

### Scenario Coverage

- [x] A-011 R3: component tests cover right, left, bottom, and corner drags with exact expectations
- [x] A-012 R3: an e2e test drags the bottom-right corner and asserts the right and bottom edges land under the pointer, then persistence across reload
- [x] A-013 R6: a component test asserts corner hover lights exactly the two adjacent edges

### Edge Cases & Error Handling

- [x] A-014 R1: at the 96vw width ceiling the offset clamp never goes negative (`Math.max(0, …)`)
- [x] A-015 R4: a persisted offset beyond the current viewport's bound renders clamped while the store keeps the persisted value

### Code Quality

- [x] A-016 Pattern consistency: new code follows the surrounding naming, the `use-local-storage-enum` pub/sub idiom, and the existing grip/handler structure
- [x] A-017 No unnecessary duplication: one handler set for all grips; the palette row reuses the existing builder pattern; the CSS reuses the accent-green token
- [x] A-018 Type narrowing over assertions: the `QuakeResizeEdge` union is narrowed by comparison, no `as` casts introduced
- [x] A-019 Magic numbers named: `QUAKE_EDGE_PAD_PX` and the existing clamp constants are used, not literals
- [x] A-020 Tests cover the added behavior (unit + component + e2e), and e2e `test()` blocks carry Proves/Steps JSDoc updated in the same commit
- [x] A-021 Comments state constraints, not narration; no change-ID citations in code comments

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — the change's planned removals (the `kind: "height" | "left" | "right"` drag discriminant, the symmetric-width `2 *` delta math, and the `quake-terminal-grip-height` test id) were already deleted in the apply diff; review found no further code this change makes redundant or unused.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | The palette reset row is always listed (not `isMobile`-gated), matching its four `Operator:` siblings | `useGlobalPaletteActions` has no mobile gating for these rows and memory records them as always listed; the store write is inert where no drawer renders — the intake's "desktop-only" intent is satisfied by behavior, not by hiding the row | S:55 R:95 A:85 D:80 |
| 2 | Confident | Per-side bar placement rides small modifier classes (`rk-quake-grip-left/-right/-bottom`) rather than inline styles | Keeps the treatment in `globals.css` beside the other `rk-*` utilities, matching the sash idiom | S:50 R:95 A:85 D:80 |
| 3 | Confident | Five tasks — light lane | Each task is one focused session; the plan's lane hint names Change 1 a light-lane candidate | S:70 R:90 A:85 D:85 |

3 assumptions (0 certain, 3 confident, 0 tentative).
