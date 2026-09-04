# Intake: Server Tile Flyout Edge Anchor

**Change**: 260904-1wq7-server-tile-flyout-edge-anchor
**Created**: 2026-09-04

## Origin

Promptless dispatch (`/fab-proceed` create-new path) from a synthesized change description; all
decisions below were confirmed by the user in the preceding discussion (user screenshot showed the
fabKit tile's open card hiding sibling tiles in the TMUX SERVERS grid).

> The server tile in the sidebar's TMUX SERVERS panel hosts the shared row flyout card (introduced
> by change 260903-1ldw / PR #810) via `useRowFlyout` with `placement: "right"`. That placement
> assumes the reference is full-bleed to the sidebar width — true for session/window rows, so their
> cards always land at the sidebar's right edge. Server tiles sit in a multi-column grid inside the
> panel, so "right of a tile" is mid-panel: the open card covers neighboring tiles. Fix position,
> not timing: anchor the server-tile card at the sidebar's right edge via a virtual position
> reference, and guard the left-column→card pointer traversal with
> `safePolygon({ blockPointerEvents: true })` — server-tile consumer only.

## Why

1. **Pain point**: On fine pointers, hovering a server tile in the sidebar's TMUX SERVERS panel
   opens the shared server card immediately to the tile's right — mid-panel, on top of the
   neighboring tiles in the grid. The occluded tiles are unreadable and un-hoverable under the
   card. Session/window rows don't have this problem because a full-bleed row's right edge IS the
   sidebar's right edge (documented at
   `app/frontend/src/components/sidebar/row-flyout-card.tsx:994-998`), so their cards always open
   over the terminal area.

2. **Consequence of not fixing**: The server card — the entry point for Change color…, protect
   toggle, create session, kill server — actively degrades the tile grid it serves. Every card
   open hides sibling servers, and sweeping toward an occluded tile fights the card.

3. **Why this approach (position, not timing)**: Timing is not the problem. `FLYOUT_OPEN_DELAY_MS`
   (500ms) applies only to cold opens — the module-scoped warm window
   (`flyoutOpenDelay()`, `row-flyout-card.tsx:126`) makes retargets instant — and however long the
   delay, an open card still occludes tiles. `safePolygon()` bridges tile→card so the card stays up
   while the pointer is near, prolonging the occlusion. Repositioning the card to the sidebar's
   right edge (where session/window row cards already open — over the terminal area, vertically
   aligned to the hovered tile) removes the occlusion entirely.

**Alternatives rejected (user-confirmed)**:
- **Increasing the hover open delay** — warm retargets bypass it, and delay doesn't address
  occlusion once open.
- **Exempting server tiles from the warm window** (always pay 500ms) — parked as a possible
  follow-up only if instant retarget between tiles still feels aggressive after repositioning; NOT
  in scope.
- **A different trigger (click / info icon)** — tile click is attach/navigate, and an extra
  per-tile affordance contradicts the tile diet (#433).

## What Changes

### 1. Virtual position reference: anchor the server-tile card at the sidebar's right edge

Use floating-ui's `refs.setPositionReference` with a **virtual element** whose rect is the tile's
y-band (the tile's own `top`/`bottom`/`height`) but whose right edge is the **sidebar container's
right edge** (`left = right = sidebarRight`, `width: 0` — degenerate-x rect, same geometry class
the full-bleed rows effectively give `placement: "right"`). Interaction events stay bound to the
real tile element via the existing `setReference` — floating-ui's documented split between the
events reference and the position reference.

- The card then opens where session/window row cards already open: at the sidebar's right edge,
  over the terminal area, vertically aligned to the hovered tile — never over sibling tiles. The
  row-aligned arrow notch keeps pointing at the hovered tile's y-center.
- The virtual element's `getBoundingClientRect` derives the sidebar right x **at position time**
  (e.g. via a `contextElement` — the tile node — walking `closest()` to the sidebar container),
  NOT from lifted state. `contextElement` should also be set on the virtual element so
  `autoUpdate` keeps observing a real node.
- `@floating-ui/react ^0.27.19` is installed (`app/frontend/package.json:16`) and supports both
  `refs.setPositionReference` and `safePolygon({ blockPointerEvents: true })`.

### 2. Traversal guard: `safePolygon({ blockPointerEvents: true })` for the server-tile consumer

With the card at the sidebar edge, the pointer must cross the right-column tile en route from a
left-column tile to its card. The crossed tile's hover would open instantly (warm window) and the
module-scoped single-open coordinator would close the original card. Fix: while the pointer
traverses the safe polygon, `blockPointerEvents: true` blocks pointer events on everything except
the reference tile and the card, so crossed tiles fire no `mouseenter`.

- **Deliberate retargets stay possible**: if the user stops on an in-between tile, safePolygon
  detects the stalled pointer and closes the current card; pointer-events unblock; the tile under
  the cursor opens (instantly, warm). Only pass-through crossings are ignored.
- Session/window rows keep plain `safePolygon()` — their cards align to their own y-band (no
  crossing problem), and deliberate warm sweeps between rows must stay instant.

### 3. `useRowFlyout` API surface

Expose both behaviors via `useRowFlyout` options (or an exposed `setPositionReference` handle)
consumed **only** by the server-tile consumer:

- The hook (`row-flyout-card.tsx` ~906) gains an opt-in that (a) applies the virtual position
  reference described in §1 and (b) switches `handleClose` from `safePolygon()`
  (`row-flyout-card.tsx` ~1057) to `safePolygon({ blockPointerEvents: true })`.
- Default behavior for all other consumers (`window-row.tsx`, `session-row.tsx`, the ServerGroup
  header in `index.tsx`) is byte-identical to today: full-bleed reference, plain `safePolygon()`.
- The coarse-pointer arm (`bottom-start` placement, size-cap middleware, rail/scrub `openNow`) is
  untouched: the tile's flyout is already suppressed on coarse pointers
  (`suppressed: coarse || showColorPicker` in `server-panel.tsx`), so the new options are
  fine-pointer-only in effect.

### 4. Consumer wiring in `server-panel.tsx`

The server-tile consumer (`app/frontend/src/components/sidebar/server-panel.tsx` ~294-346, the
`useRowFlyout` call + `setTileRefs`) opts in to the new option(s). `setTileRefs` keeps setting the
real tile node as the events reference (and the color-popover anchor); the position reference is
the hook's concern once opted in.

### 5. Constraints that MUST hold

- **`strategy: "fixed"` stays** (`row-flyout-card.tsx` ~1007): an absolute-positioned portalled
  card grows body scrollWidth and fails the 375px width-sweep e2e specs
  (`tests/e2e/top-bar-overflow.spec.ts` sweeps). The virtual position reference must not disturb
  this. **Re-run the width-sweep specs.**
- **PERF header constraints** in `row-flyout-card.tsx` hold: row-local state, module-scoped
  coordination (warm window, single-open), nothing lifted to `Sidebar`, no clocks in the card.
  Deriving the sidebar right x at position time (not state) is what keeps this true.
- **Coarse pointers unaffected**: the coarse `bottom-start` arm and rail/scrub behavior must not
  change.

### 6. Tests

Per `fab/project/code-quality.md`, new/changed behavior needs tests:

- Unit tests (`row-flyout-card.test.tsx` exists, colocated): the opt-in option wires
  `setPositionReference` with the expected rect shape (tile y-band, sidebar right x) and selects
  `blockPointerEvents`; default consumers unchanged.
- Playwright e2e where feasible: hovering a left-column server tile opens the card at the sidebar's
  right edge (card left edge ≥ sidebar right edge, minus offset), not over the sibling tile.
  Any new `test()` carries the constitution's Test Intent Comment (Proves/Steps JSDoc); the spec
  file header comment covers shared setup.
- Re-run the 375px width-sweep specs (`top-bar-overflow.spec.ts`) plus the flyout-surface specs
  (`row-flyout.spec.ts`, `server-panel-grid.spec.ts`) — scoped, not the full suite.

## Affected Memory

- `run-kit/ui/sidebar`: (modify) row-hover flyout card section — server-tile mount now anchors at
  the sidebar right edge via a virtual position reference + blockPointerEvents traversal guard
- `run-kit/ui/status-signals`: (modify) the row flyout card "one shared shell on four mounts"
  section — the server-tile mount's placement/guard delta vs the other three mounts

## Impact

- **Code**: `app/frontend/src/components/sidebar/row-flyout-card.tsx` (`useRowFlyout` ~906,
  placement/middleware ~991-1046, `safePolygon` ~1057; `FLYOUT_OPEN_DELAY_MS` /
  `FLYOUT_WARM_WINDOW_MS` ~73-85 read-only context), `server-panel.tsx` (~294-346, `setTileRefs`).
- **Not touched**: `window-row.tsx`, `session-row.tsx`, ServerGroup header wiring in `index.tsx`
  (they keep defaults); coarse-pointer arm; backend.
- **Tests**: `row-flyout-card.test.tsx` (extend), possible e2e additions in `row-flyout.spec.ts` /
  `server-panel-grid.spec.ts`; re-run `top-bar-overflow.spec.ts` width sweeps.
- **Dependencies**: none new — `@floating-ui/react ^0.27.19` already installed.
- **Scale**: small-to-medium frontend change, two files + tests.

## Open Questions

- None — all decisions in the originating description are user-confirmed; remaining choices are
  implementation details graded below.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Fix by repositioning (virtual position reference anchoring the card at the sidebar's right edge), not by changing hover timing | User-confirmed decision 1; matches where session/window row cards already open | S:95 R:70 A:90 D:95 |
| 2 | Certain | Traversal guard = `safePolygon({ blockPointerEvents: true })`, enabled only for the server-tile consumer | User-confirmed decision 2, including the stalled-pointer retarget semantics | S:95 R:80 A:85 D:90 |
| 3 | Certain | Session/window rows and the ServerGroup header keep today's behavior byte-identical (plain `safePolygon()`, full-bleed reference, instant warm sweeps) | User-confirmed decision 2's scope carve-out; no crossing problem exists for full-bleed rows | S:95 R:85 A:90 D:95 |
| 4 | Certain | `strategy: "fixed"` is preserved and the 375px width-sweep e2e specs are re-run as a gate | User-stated constraint; memory records the absolute-strategy body-scrollWidth failure mode | S:95 R:60 A:90 D:95 |
| 5 | Certain | Coarse-pointer behavior unchanged (tile flyout stays suppressed on coarse; `bottom-start` arm + rail/scrub untouched) | User-stated constraint; suppression already exists in server-panel.tsx | S:95 R:85 A:95 D:95 |
| 6 | Certain | Out of scope: warm-window exemption for tiles (parked follow-up), longer open delay, alternative triggers (click / info icon) | User-confirmed rejections; tile diet #433 cited for the trigger rejection | S:95 R:90 A:90 D:95 |
| 7 | Confident | API shape: a `useRowFlyout` opt-in option (single flag or small options object) rather than exporting a raw `setPositionReference` for the consumer to drive | User allowed either; an option keeps the virtual-rect logic inside the hook next to its middleware and keeps server-panel.tsx declarative — apply picks the exact name/shape | S:80 R:85 A:80 D:70 |
| 8 | Confident | Sidebar right x derived at position time inside the virtual element's `getBoundingClientRect` via a DOM walk from the tile node (`closest()` to the sidebar container / `contextElement`); exact lookup hook (existing class, data attribute, or ref) is apply's choice | User-stated constraint fixes "position time, not lifted state"; the concrete lookup mechanism is codebase-answerable | S:80 R:85 A:80 D:65 |
| 9 | Confident | Test split: unit coverage in `row-flyout-card.test.tsx` for the option wiring + an e2e position assertion where synthetic hover allows; safePolygon traversal depth in e2e decided at apply (synthetic pointer paths may not exercise the polygon faithfully) | code-quality.md mandates tests; e2e hover/pointer fidelity limits are a known project constraint — apply decides depth and records it | S:60 R:90 A:70 D:60 |

9 assumptions (6 certain, 3 confident, 0 tentative, 0 unresolved).
