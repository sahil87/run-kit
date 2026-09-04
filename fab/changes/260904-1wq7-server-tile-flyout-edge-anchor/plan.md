# Plan: Server Tile Flyout Edge Anchor

**Change**: 260904-1wq7-server-tile-flyout-edge-anchor
**Intake**: `intake.md`

## Requirements

### Sidebar: Server-tile flyout positioning

#### R1: Tile card anchors at the sidebar's right edge
On fine pointers, the TMUX SERVERS panel tile's flyout card MUST open at the sidebar's right edge — where the session/window row cards already open — never over sibling tiles in the grid. `useRowFlyout` SHALL gain an opt-in that sets a floating-ui **virtual position reference** (via `refs.setPositionReference`): rect = the tile's y-band (`top`/`bottom`/`height` from the tile node) with a degenerate x at the sidebar container's right edge (`left = right = sidebarRight`, `width: 0`), `contextElement` = the tile node (so `autoUpdate` observes a real node). The sidebar right x MUST be derived at position time inside `getBoundingClientRect` (DOM walk from the tile node), never from lifted state. Interaction events stay bound to the real tile element via the existing `setReference`.

- **GIVEN** a fine pointer and a multi-column tile grid in the SERVER panel
- **WHEN** the user hovers any tile (left or right column) and the card opens
- **THEN** the card's left edge sits at the sidebar's right edge (+ the existing `offset(6)`), vertically aligned to the hovered tile (arrow notch at the tile's y-center)
- **AND** no sibling tile is covered by the card

#### R2: Traversal guard — `blockPointerEvents` for the tile consumer
The same opt-in SHALL switch the hook's `handleClose` from `safePolygon()` to `safePolygon({ blockPointerEvents: true })`, so tiles crossed en route from the hovered tile to its card fire no `mouseenter` (the warm window would otherwise open the crossed tile's card instantly and the single-open coordinator would close the original). Deliberate retargets stay possible: a stalled pointer inside the polygon closes the current card, pointer-events unblock, and the tile under the cursor opens.

- **GIVEN** a left-column tile's card is open at the sidebar's right edge
- **WHEN** the pointer travels right across the right-column sibling tile toward the card
- **THEN** the sibling tile does not hover-open its card and the original card stays open
- **AND** stopping on the sibling tile (stalled pointer) closes the original card and opens the sibling's

#### R3: All other consumers byte-identical; coarse arm untouched
Default `useRowFlyout` behavior (no opt-in) MUST be unchanged: full-bleed reference, plain `safePolygon()`, all existing placement arms and middleware. The window row, session row, and ServerGroup header consumers SHALL NOT be modified. The coarse-pointer arm (`bottom-start`, `size()` rail cap, rail/scrub `openNow`) is untouched — the tile mount stays fine-pointer-only (`suppressed: coarse || showColorPicker`). `strategy: "fixed"` MUST be preserved (an absolute portalled card grows body scrollWidth and fails the 375px width-sweep e2e specs).

- **GIVEN** a window/session/server-header row on either pointer class
- **WHEN** its flyout opens after this change
- **THEN** placement, delay, warm window, polygon, and focus behavior are identical to before

#### R4: Tests cover the new behavior
Unit tests SHALL cover the opt-in wiring (virtual position reference rect shape, `blockPointerEvents` selection, default consumers unchanged) and e2e SHALL assert the tile card's edge-anchored position on hover. New Playwright `test()`s carry the constitution's Test Intent Comment (Proves/Steps JSDoc). The 375px width-sweep specs (`top-bar-overflow.spec.ts`) and the flyout-surface specs (`row-flyout.spec.ts`, `server-panel-grid.spec.ts`) are re-run scoped as the gate.

- **GIVEN** the change is complete
- **WHEN** the scoped test gates run
- **THEN** new unit + e2e coverage passes and the width sweeps + flyout/grid specs stay green

### Design Decisions

#### Tile card repositions via a virtual position reference, not timing changes
**Decision**: Anchor the tile card at the sidebar's right edge with `refs.setPositionReference` (events stay on the tile via `setReference`); leave `FLYOUT_OPEN_DELAY_MS`/warm window untouched.
**Why**: Timing is not the defect — the warm window makes retargets instant regardless of delay, and an open card occludes tiles however long it took to open. The edge anchor reuses the exact geometry the full-bleed rows already give `placement: "right"`.
**Rejected**: longer open delay (bypassed by warm retargets, doesn't remove occlusion); warm-window exemption for tiles (parked follow-up, out of scope); a different trigger — click/info icon (tile click is attach/navigate; extra per-tile affordance contradicts the tile diet #433).
*Introduced by*: 260904-1wq7-server-tile-flyout-edge-anchor

#### Traversal guard is `blockPointerEvents`, tile-consumer-only
**Decision**: The tile opt-in switches `handleClose` to `safePolygon({ blockPointerEvents: true })`; all other mounts keep plain `safePolygon()`.
**Why**: Only the tile's edge-anchored card creates a corridor crossing other hover targets (grid columns); full-bleed rows' cards align to their own y-band, and deliberate warm sweeps between rows must stay instant.
**Rejected**: enabling `blockPointerEvents` globally (changes row-sweep feel for no benefit); suppressing sibling opens via bespoke module state (floating-ui ships the purpose-built mechanism).
*Introduced by*: 260904-1wq7-server-tile-flyout-edge-anchor

## Tasks

### Phase 2: Core Implementation

- [x] T001 Add the opt-in to `useRowFlyout` in `app/frontend/src/components/sidebar/row-flyout-card.tsx`: an option (e.g. `edgeAnchor: boolean`) that (a) registers a virtual position reference — tile y-band, degenerate x at the sidebar container's right edge derived at position time via a DOM walk from the events-reference node, `contextElement` set — and (b) selects `safePolygon({ blockPointerEvents: true })`. Defaults (option absent) are byte-identical to today. `strategy: "fixed"` and both placement arms untouched. <!-- R1, R2, R3 -->
- [x] T002 Opt the server-tile consumer in: `app/frontend/src/components/sidebar/server-panel.tsx` (`useRowFlyout` call ~304); `setTileRefs` keeps setting the real tile node as events reference + popover anchor. No changes to `window-row.tsx`, `session-row.tsx`, or the ServerGroup header in `index.tsx`. <!-- R1, R3 -->

### Phase 3: Integration & Edge Cases

- [x] T003 Unit tests: extend `app/frontend/src/components/sidebar/row-flyout-card.test.tsx` (opt-in wires the position reference with the expected rect shape and selects `blockPointerEvents`; default path unchanged) and `server-panel.test.tsx` (tile mount passes the opt-in; card still opens on fine-pointer hover with `ServerCardContent`). Handle the missing-ancestor fallback (no sidebar container found → fall back to the tile's own rect). <!-- R4 -->
- [x] T004 E2E: extend `app/frontend/tests/e2e/server-panel-grid.spec.ts` (or `row-flyout.spec.ts` if the fixture fits better) — hovering a left-column tile opens the card with its left edge at/right of the sidebar's right edge, sibling tiles not covered. Test Intent Comment (Proves/Steps) on every new `test()`. <!-- R4 -->
- [x] T005 Gates (scoped): `npx tsc --noEmit` (frontend), Vitest for the touched sidebar suites, then `just test-e2e` scoped to `server-panel-grid.spec.ts`, `row-flyout.spec.ts`, and the `top-bar-overflow.spec.ts` width sweeps. <!-- R4 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: Hovering a server tile (either grid column, fine pointer) opens the card at the sidebar's right edge, vertically aligned to the tile; no sibling tile is occluded
- [x] A-002 R2: The tile consumer's close handler is `safePolygon({ blockPointerEvents: true })`; crossing a sibling tile en route to the card does not steal the card

### Behavioral Correctness

- [x] A-003 R3: Window row, session row, and ServerGroup header flyout behavior is unchanged (full-bleed reference, plain `safePolygon()`, warm sweeps instant); no edits to those consumers
- [x] A-004 R3: `strategy: "fixed"` retained; the 375px width-sweep specs (`top-bar-overflow.spec.ts`) pass
- [x] A-005 R3: Coarse-pointer behavior unchanged — tile flyout suppressed on coarse; `bottom-start` arm, `size()` rail cap, rail/scrub untouched

### Scenario Coverage

- [x] A-006 R4: Unit tests cover the opt-in wiring, `blockPointerEvents` selection, and default-path invariance; e2e asserts the edge-anchored tile card position with Test Intent Comments

### Edge Cases & Error Handling

- [x] A-007 R1: Sidebar-container lookup failure falls back to the tile's own rect (today's geometry) rather than throwing; the virtual rect derives at position time, not from lifted state

### Code Quality

- [x] A-008 Pattern consistency: New code follows `row-flyout-card.tsx`'s existing idioms (module-scoped coordination, row-local state, option plumbing style) and the PERF header constraints (nothing lifted to `Sidebar`, no clocks, body mounts only while open)
- [x] A-009 No unnecessary duplication: Reuses floating-ui's `setPositionReference`/`safePolygon` options — no bespoke positioning or pointer-event masking code
- [x] A-010 Comment discipline: comments state constraints only — no narration, no change-ID/PR citations in code or test intent comments

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change adds new functionality without making existing code redundant

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Option shape: a single boolean `useRowFlyout` option (working name `edgeAnchor`) driving both the virtual position reference and the `blockPointerEvents` polygon | Intake #7 left the shape to apply; one flag keeps the two behaviors coupled (they exist for the same geometry) and `server-panel.tsx` declarative | S:80 R:85 A:80 D:70 |
| 2 | Confident | Sidebar right x derived via `closest('nav[aria-label="Sessions"]')` from the tile node (the sidebar root that ServerPanel verifiably renders inside), with a tile-rect fallback | Intake #8 fixed "position time, DOM walk"; the nav is the existing full-width sidebar root at `sidebar/index.tsx:1685` — no new attribute needed | S:80 R:85 A:85 D:70 |
| 3 | Confident | E2E depth: position assertion only (card left edge vs sidebar right edge); the safePolygon traversal/steal behavior is covered at unit level, not e2e | Intake #9 flagged synthetic-pointer fidelity: Playwright's synthesized `mousemove` paths don't drive floating-ui's polygon rest-detection deterministically | S:65 R:90 A:75 D:65 |

3 assumptions (0 certain, 3 confident, 0 tentative).
