# Plan: Consolidate Window Move Palette Entries

**Change**: 260719-p8pv-window-move-palette-consolidation
**Intake**: `intake.md`

## Requirements

### Command Palette: Window Move Consolidation

#### R1: Remove the Window: Move Left/Right palette entries
The `move-window-left` and `move-window-right` palette action objects in `app/frontend/src/app.tsx` (the two conditional spreads at ~lines 1691-1746) SHALL be deleted. The `window-move-up` / `window-move-down` entries SHALL remain as the sole window-move pair, with unchanged behavior: `computeWindowMoveTarget(index, ±1, minWindowIndex, maxWindowIndex)`, `moveWindow(server, windowId, targetIndex)`, navigate to the same `windowId` with `search: (prev) => prev`, boundary = hidden (no wraparound). The up/down pair's leading comment SHALL be updated to drop the "kept alongside them so the existing left/right entries are not regressed" clause — it now IS the pair.

- **GIVEN** a terminal route with a current window at a middle index
- **WHEN** the user opens the palette and types "move"
- **THEN** exactly one window-move pair appears — `Window: Move up` and `Window: Move down` — and no `Window: Move Left`/`Move Right` entries exist
- **AND** selecting `Move up`/`Move down` moves the window ±1 index and keeps the user on the same window with the current view preserved

#### R2: Retarget app.test.tsx move tests to the surviving pair
The move-action tests in `app/frontend/src/app.test.tsx` (header comment ~lines 7-14, `buildWindowActions` fixture ~lines 20-44, and the five tests in `CmdK Move Window Actions`: middle shows both / hidden at min / hidden at max / single-window hides both / onSelect fires ×2) SHALL be retargeted from `Window: Move Left`/`Move Right` labels and `move-window-left`/`move-window-right` ids to `Window: Move up`/`Move down` and `window-move-up`/`window-move-down`. Coverage stays equivalent — boundary gating and onSelect wiring for the surviving entries. No test SHALL remain that references the removed labels/ids.

- **GIVEN** the retargeted suite
- **WHEN** `just test-frontend` runs
- **THEN** all `CmdK Move Window Actions` tests pass, asserting `Window: Move up`/`Move down` presence/absence at boundaries and onSelect firing

#### R3: No residual references to the removed labels/ids
After the edits, a NUL-safe sweep (`grep -a -rE 'move-window-left|move-window-right|Window: Move Left|Window: Move Right'`) across `app/frontend/` SHALL produce zero hits. `app/frontend/src/lib/board-reorder.ts` pane-action comments ("Move Left/Right" for Board *pane* actions — a horizontal surface) are out of scope and MUST NOT be touched.

- **GIVEN** the completed change
- **WHEN** the sweep runs over `app/frontend/`
- **THEN** zero hits remain for the four removed strings (board-reorder.ts's Board-pane comments do not match these window-scoped strings)

### Non-Goals

- Board pane `Move Left`/`Move Right` actions (board-reorder.ts / board-page.tsx) — different, horizontal surface; backlog names only the `Window:` pair
- Any behavior change to the surviving up/down pair
- Memory update (`docs/memory/run-kit/ui-patterns.md` § Window move actions) — hydrate's job, not apply's

### Deprecated Requirements

#### Window: Move Left / Move Right palette entries
**Reason**: Behaviorally identical aliases of `Window: Move up`/`Move down`; four palette entries expressed two operations, with ~80 lines of duplicated handler code.
**Migration**: `Window: Move up` / `Window: Move down` (ids `window-move-up`/`window-move-down`) — same `computeWindowMoveTarget` + `moveWindow` path, same boundary-hidden gating.

## Tasks

### Phase 2: Core Implementation

- [x] T001 Delete the `move-window-left` and `move-window-right` conditional-spread action objects in `app/frontend/src/app.tsx` (~lines 1691-1746) and update the up/down pair's leading comment (drop the "kept alongside them so the existing left/right entries are not regressed" clause) <!-- R1 -->
- [x] T002 Retarget `app/frontend/src/app.test.tsx`: header comment, `buildWindowActions` fixture (ids/labels/callback names), and the five `CmdK Move Window Actions` tests from `Window: Move Left`/`Move Right` + `move-window-left`/`-right` to `Window: Move up`/`Move down` + `window-move-up`/`-down` <!-- R2 -->

### Phase 3: Integration & Edge Cases

- [x] T003 Run `just check` (typecheck) and `just test-frontend` (Vitest); then run the NUL-safe sweep `grep -a -rE 'move-window-left|move-window-right|Window: Move Left|Window: Move Right' app/frontend/` and confirm zero hits (board-reorder.ts untouched) <!-- R3 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: `app.tsx` registers exactly one window-move pair (`window-move-up`/`window-move-down`, labels `Window: Move up`/`Move down`); the `move-window-left`/`move-window-right` action objects are gone
- [x] A-002 R2: `app.test.tsx`'s `CmdK Move Window Actions` suite asserts the surviving labels/ids only, with equivalent coverage (both shown mid-list, hidden at min/max, both hidden single-window, onSelect fires for each)

### Behavioral Correctness

- [x] A-003 R1: The surviving up/down entries' behavior is unchanged — `computeWindowMoveTarget` ±1, `moveWindow` by stable windowId, same-windowId navigate with `search: (prev) => prev`, boundary = hidden

### Removal Verification

- [x] A-004 R3: `grep -a -rE 'move-window-left|move-window-right|Window: Move Left|Window: Move Right' app/frontend/` returns zero hits; `board-reorder.ts` is unmodified

### Scenario Coverage

- [x] A-005 R2: `just test-frontend` passes, including all retargeted `CmdK Move Window Actions` tests

### Edge Cases & Error Handling

- [x] A-006 R1: Boundary gating intact after deletion — `Move up` hidden at `minWindowIndex`, `Move down` hidden at `maxWindowIndex` (conditional spreads preserved verbatim on the surviving pair)

### Code Quality

- [x] A-007 Pattern consistency: Surviving code follows the existing palette-action patterns; comment updated to present truth (no stale "kept alongside" narration)
- [x] A-008 No unnecessary duplication: The alias pair (~80 lines of duplicated handler code) is removed; `just check` typecheck passes

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change is itself a deletion (the redundant `move-window-left`/`move-window-right` alias pair). It introduces no new code that renders any further existing code redundant or unused; `computeWindowMoveTarget`, `moveWindow`, and the surviving up/down pair all remain live.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Test fixture callback prop names (`onMoveLeft`/`onMoveRight`) are renamed to `onMoveUp`/`onMoveDown` as part of the retarget | Fixture-internal naming; keeping directional names that contradict the labels would be misleading; zero external surface | S:80 R:95 A:95 D:90 |
| 2 | Certain | The `Window: Move to {session}` cross-session actions and their tests are untouched | Different operation (session move, not index move); intake scopes only the Left/Right pair | S:85 R:95 A:95 D:95 |

2 assumptions (2 certain, 0 confident, 0 tentative).
