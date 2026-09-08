# Intake: Fix main-* divider clamp cross-axis contamination

**Change**: 260908-ek6j-fix-main-divider-cross-axis-clamp
**Created**: 2026-09-08

## Origin

Promptless dispatch (`/fab-proceed` create-new) from a synthesized user conversation. User report (2026-09-08), on `main-left` with surface order tty(main) | code(top-right) / web(bottom-right):

> 1. The code/web horizontal seam (divider index 1) cannot be dragged — the web tile's size is stuck.
> 2. Dragging the T-junction intersection handle couples the axes: horizontal pointer motion changes the code tile's height in a strange way.

The root cause was already diagnosed in the conversation by reading the code, and the fix direction was decided there. Line numbers below were re-verified against this worktree during intake. Provenance: the cross-axis bug was first noticed 2026-08-14 while hardening the seam drag (the window-level pointer-listener hardening landed; this clamp fix never did). Do not cite that history in code comments.

## Why

**Problem**: `clampBoundary` (`app/frontend/src/components/surface-layout.tsx:465-478`) clamps a boundary against `cur[index-1]` / `cur[index+1]` as if they were same-axis sibling boundaries:

```ts
const prev = index === 0 ? 0 : cur[index - 1];
const next = index === cur.length - 1 ? 100 : cur[index + 1];
```

That sibling chain is correct for `row`/`col` (two dividers on ONE axis that must not cross or strand each other) but wrong for `main-left`/`main-right`/`main-top`, where the two ratios live on DIFFERENT axes — main-left/right: ratio 0 = x column boundary, ratio 1 = y row boundary; main-top: ratio 0 = y, ratio 1 = x (see `dividerSpecs` at `surface-layout.tsx:423-458` and `intersectionAxes` at `:500-510` in the same file).

**Consequences of not fixing**:

- Divider 1 on main-left is clamped to `[r0 + floorY, 100 − floorY]` where `floorY = MIN_PANEL_WIDTH_PX/gridHeight·100` and `r0` is the unrelated *column* ratio. On short viewports the band is empty and the impossible-bounds guard (`Math.max(next − floor, prev + floor)`) degenerates to the single pinned value `r0 + floorY` — the seam won't move at all (symptom 1).
- The intersection drag (`onIntersectionPointerMove`, `surface-layout.tsx:1153-1176`) clamps each axis independently against the PRE-move ratios, so the x movement changes `r0`, which moves the y-seam's pinned/floored position — horizontal pointer motion drives vertical tile size (symptom 2).
- Symmetrically, divider 0's max is polluted by `r1 − floorX`.

**Why this approach**: the clamp needs shape awareness — the sibling-chain invariant is a property of `row`/`col` (same-axis dividers) only. Making the neighbor derivation shape-aware fixes both symptoms at the single source (root cause), preserves the row/col invariant untouched, and requires no change to the per-axis floor math (`clampRatio` already handles it).

## What Changes

### Shape-aware boundary neighbors in `clampBoundary`

`app/frontend/src/components/surface-layout.tsx` — give the clamp shape awareness:

- **`row`/`col`**: keep the existing sibling-boundary chaining (`prev = cur[index-1]`, `next = cur[index+1]` with 0/100 edges) — a divider may never cross or strand its sibling. Behavior unchanged.
- **`main-left`/`main-right`/`main-top`** (and trivially `split-h`/`split-v`, whose single ratio already resolves to `prev = 0, next = 100`): each ratio clamps independently on its own axis — `prev = 0`, `next = 100`, i.e. the band is `[floor, 100 − floor]`. The other ratio (which lives on the other axis) never participates.

Suggested implementation shape (from the conversation — an equivalent form is acceptable): a small `boundaryNeighbors(shape, cur, index)` helper returning `{ prev, next }`, or pass `shape` into `clampBoundary` directly. Whichever form, it must be used by **all three call sites**:

1. The single-axis divider drag — `onDividerPointerMove`, call at `surface-layout.tsx:1070`
2. The intersection drag's x-axis call — `surface-layout.tsx:1161`
3. The intersection drag's y-axis call — `surface-layout.tsx:1167`

With independent per-axis clamping for `main-*`, the intersection drag's pre-move-ratios snapshot is no longer a contamination vector: neither axis's clamp reads the other ratio.

### Explicitly NOT changed

- `clampRatio` in `app/frontend/src/lib/right-panel.ts` — it already handles the per-axis floor band and the <2×`MIN_PANEL_WIDTH_PX` (560px) 50/50 collapse. Do not change it.
- `MIN_PANEL_WIDTH_PX = 280` (`app/frontend/src/lib/right-panel.ts:82`) stays the floor for both axes.
- The window-level pointer-listener drag routing (already hardened) and the persistence path (`writeStoredRatios`) — untouched. No stored-ratio migration: the old bug pinned values inside valid ranges, it never persisted invalid ones.

### Doc comments

Update the `clampBoundary` doc comment (`surface-layout.tsx:460-464`) — and any divider/clamp comments that restate the neighbor rule — to state the same-axis-siblings-only constraint (sibling chaining applies only to shapes whose two dividers share an axis; `main-*` ratios are per-axis independent). Comments must state the invariant, not narrate history — no change IDs, PR numbers, or dates (code-quality anti-pattern).

### Tests

Frontend unit tests are Vitest, colocated. jsdom's zero `getBoundingClientRect` makes render-driven drags no-op (documented at `surface-layout.test.tsx:811-813`), so the clamp math needs a direct seam: export the clamp helper (`clampBoundary` and/or the new `boundaryNeighbors`) and unit-test it directly — mirroring `right-panel.ts` exporting `clampRatio` for `right-panel.test.ts`.

Pin these cases:

- **(a) Short-viewport un-pinning**: on a geometry where the old code pinned the seam (e.g. main-left, grid height small enough that `[r0 + floorY, 100 − floorY]` is empty), the y-seam (ratio 1) now moves freely within its own-axis floor band `[floorY, 100 − floorY]`.
- **(b) Axis independence**: for `main-*` shapes, a boundary's clamp result is independent of the other ratio's value (vary ratio 0, assert ratio 1's clamp band is unchanged, and vice versa).
- **(c) row/col regression guard**: sibling chaining unchanged — a row/col divider still cannot cross or strand its sibling (clamped to `[prev + floor, next − floor]` with the impossible-bounds degeneration preserved).

e2e: run the existing surface-layout specs only (`app/frontend/tests/e2e/surface-layout.spec.ts`, plus siblings touching the changed surface if any) via `just test-e2e "<spec>"` patterns — never raw playwright. The full suite is on-demand per project directive, never a change gate. No new e2e test is required: seam-drag capture loss is not reliably reproducible synthetically (known from prior investigation), and coverage lands in the unit tests above.

## Affected Memory

- `run-kit/ui/lenses-and-layout`: (modify) surface-layout divider/clamp behavior — record the shape-aware clamp rule (row/col sibling chaining vs. main-*/split-* per-axis independent bands)

## Impact

- `app/frontend/src/components/surface-layout.tsx` — `clampBoundary` (+ new helper or signature change), its three call sites (`:1070`, `:1161`, `:1167`), doc comments. Possible export addition for testability.
- `app/frontend/src/components/surface-layout.test.tsx` (or a colocated test of the exported helper) — new unit cases (a)/(b)/(c).
- `app/frontend/src/lib/right-panel.ts` — read-only dependency (`clampRatio`, `MIN_PANEL_WIDTH_PX`); no edits.
- e2e: existing `surface-layout.spec.ts` re-run as verification; no spec changes expected (no `test()` bodies or intent comments touched unless a spec asserts the old pinned behavior).
- No backend, API, routing, or persistence-schema impact. User-visible effect: main-* seams and the T-junction handle become draggable/decoupled as intended.

## Open Questions

- None — root cause verified against this worktree and the fix direction was decided in the originating conversation.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Root cause is `clampBoundary`'s same-axis sibling chaining applied to `main-*` shapes' cross-axis ratios | Diagnosed in conversation; re-verified in this worktree — `surface-layout.tsx:465-478` code matches, `dividerSpecs`/`intersectionAxes` confirm the per-shape axis mapping, call sites at :1070/:1161/:1167 | S:95 R:90 A:95 D:95 |
| 2 | Certain | Fix = shape-aware neighbors: row/col keep sibling chaining; main-* (and trivially split-*) clamp each ratio independently to `[floor, 100 − floor]` | Decided in conversation ("Fix decided"); geometry of `dividerSpecs` makes it the only correct band per axis | S:90 R:85 A:90 D:90 |
| 3 | Confident | Implementation shape: small `boundaryNeighbors(shape, cur, index)` helper (or pass `shape` into `clampBoundary`), consumed by all three call sites | Conversation says "suggested shape" — the mechanism is fixed, the exact form is apply's choice; easily reversed | S:80 R:90 A:85 D:75 |
| 4 | Certain | `clampRatio` and `MIN_PANEL_WIDTH_PX = 280` unchanged; floor applies to both axes as today | Explicit constraint in conversation; verified `right-panel.ts:82`/`:99` handle the floor band and 50/50 collapse | S:90 R:85 A:95 D:95 |
| 5 | Confident | Testing seam: export the clamp helper for direct Vitest unit tests rather than render-driven drags | jsdom `getBoundingClientRect` zeros make component-level drag moves no-op (`surface-layout.test.tsx:811-813`); `right-panel.ts` exporting `clampRatio` for `right-panel.test.ts` is the established neighbor pattern | S:70 R:85 A:80 D:70 |
| 6 | Certain | e2e verification scoped to existing surface-layout specs via `just test-e2e`; no new e2e test; full suite never a change gate | Explicit conversation constraint + standing project directive (code-quality gate edited 2026-09-03); seam drags known not reliably reproducible synthetically | S:90 R:90 A:95 D:95 |
| 7 | Confident | Affected memory is `run-kit/ui/lenses-and-layout` (modify) | `docs/memory/run-kit/ui/index.md` lists it as owning "surface layouts" and tile seams; no other file covers divider clamping | S:75 R:90 A:85 D:80 |
| 8 | Confident | No stored-ratio migration/heal needed for previously persisted layouts | The bug pinned drags but never wrote out-of-range values; the corrected clamp applies on the next drag; persistence path untouched | S:70 R:80 A:85 D:80 |

8 assumptions (4 certain, 4 confident, 0 tentative, 0 unresolved).
