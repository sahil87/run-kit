# Plan: Board Autofit Toggle

**Change**: 260708-738w-board-autofit
**Intake**: `intake.md`

## Requirements

### Board: Autofit Persistence

#### R1: Per-board autofit preference persists in localStorage
A new `useBoardAutofit(board)` hook SHALL persist a per-board autofit preference under the key `runkit:board-autofit:{board}`, defaulting to **off** when no value is stored, using the same guard discipline as `use-pane-widths.ts` (`typeof window === "undefined"` bail, `try/catch` around read/write, malformed values read as off).

- **GIVEN** a board with no stored autofit preference
- **WHEN** `useBoardAutofit(board)` is first read
- **THEN** `autofit` is `false`
- **AND** the stored key is untouched until the setter runs

#### R2: Toggling autofit persists and round-trips
`toggleAutofit()` SHALL flip the preference and persist it so a subsequent read (including after reload) returns the flipped value.

- **GIVEN** a board with autofit off
- **WHEN** `toggleAutofit()` is called
- **THEN** `autofit` becomes `true` AND the localStorage key holds the "on" sentinel
- **AND** a fresh hook instance for the same board reads `autofit === true`

#### R3: Per-board key isolation
The preference SHALL be scoped per board name, so enabling autofit on board A does not affect board B, and switching `board` reloads state from the new board's key (mirroring the `useEffect`-on-`board` reload in `usePaneWidths`).

- **GIVEN** board A has autofit on and board B has no stored preference
- **WHEN** the hook's `board` argument changes from A to B
- **THEN** `autofit` reflects B's stored value (off), not A's

### Board: Desktop Autofit Layout

#### R4: Autofit ON stretches panes to fill the row
When autofit is ON, the desktop `DesktopRow` SHALL stop passing the explicit pixel `width` to each `BoardPane` and instead lay each pane out as a flex item with `flex: 1 1 0` and `min-width: max(BOARD_PANE_MIN_WIDTH, calc(25% - 3px))` inside the existing `overflow-x-auto flex gap-1 p-1` row.

- **GIVEN** a desktop board with 2–3 panes and autofit ON
- **WHEN** the board renders
- **THEN** the panes share the full row width equally with no horizontal scrollbar
- **AND** resizing the window reflows the panes live (pure CSS, no row ResizeObserver)

#### R5: Autofit ON floors at ~25% past 4 panes
With more than 4 panes and autofit ON, each pane SHALL floor at `max(BOARD_PANE_MIN_WIDTH, calc(25% - 3px))` of the scrollport and the row SHALL scroll horizontally exactly as today.

- **GIVEN** a desktop board with 5+ panes and autofit ON on a viewport where 25% > 280px
- **WHEN** the board renders
- **THEN** each pane is approximately 25% of the scrollport width AND the row overflows horizontally (scrollWidth > clientWidth)

#### R6: Autofit OFF preserves current behavior and hand-tuned widths
When autofit is OFF the layout SHALL be exactly the current behavior (explicit per-pane pixel widths from `usePaneWidths`). Autofit (in either state) SHALL NOT modify the stored `runkit:board-widths:{board}` values, so toggling off restores the hand-tuned layout.

- **GIVEN** a board with hand-dragged pane widths and autofit toggled ON then OFF
- **WHEN** autofit is OFF again
- **THEN** each pane renders at its previously stored pixel width AND `runkit:board-widths:{board}` is unchanged

#### R7: Resize handles hidden while autofit is ON
While autofit is ON the per-pane resize handle SHALL be hidden (`showResizeHandle={false}`), and the drag-resize path SHALL NOT be wired.

- **GIVEN** a desktop board with autofit ON
- **WHEN** the board renders
- **THEN** no `resize pane` handle element is present on any pane

#### R8: Mobile carousel unaffected
The `MobileCarousel` SHALL be untouched by autofit (it is already one full-width pane via `w-full`).

- **GIVEN** a mobile viewport
- **WHEN** autofit state changes
- **THEN** the carousel layout is identical to today (one full-width pane, no autofit branch)

### Board: Autofit Controls (Constitution V parity)

#### R9: Top-bar board-mode toggle button
A board-only toggle button SHALL render in the top-bar right-cluster L2 area (next to `Aa` `TerminalFontControl` and the `✕` `ClosePaneButton`), following the `FixedWidthToggle` pattern (`aria-pressed` reflecting `autofit`, CRT-glint hover vocabulary, `coarse:` touch sizing). Clicking it SHALL flip autofit.

- **GIVEN** a desktop board route
- **WHEN** the user clicks the autofit toggle button
- **THEN** autofit flips AND the button's `aria-pressed` reflects the new state
- **AND** the button renders only in `board` mode (not terminal/root/cockpit)

#### R10: Command-palette autofit action
A `Board: Toggle Autofit` action SHALL be registered in `boardRouteActions` and flip the same autofit state as the button (Constitution V palette parity).

- **GIVEN** a board route with the command palette open
- **WHEN** the user selects `Board: Toggle Autofit`
- **THEN** autofit flips (same state the button reflects)

#### R11: State plumbed through the top-bar slot context
`BoardPage` SHALL own the `useBoardAutofit` instance and publish `autofit` + `onToggleAutofit` into the top-bar slot context (`useRegisterTopBarSlot`), which `top-bar.tsx` consumes as new optional board-mode slot fields with tolerant-empty defaults (like `onCloseFocused`/`closeDisabled`).

- **GIVEN** the persistent root TopBar and a board page registering its slot
- **WHEN** the board publishes `autofit`/`onToggleAutofit`
- **THEN** the top-bar toggle reflects/controls that state; absent fields render no toggle (tolerant-empty)

### Non-Goals

- No relay-cap change — `MAX_LIVE_RELAY_PANES = 4` already aligns with the 4-visible max (intake §4).
- No autofit-specific xterm refit wiring — the existing `terminal-client.tsx` ResizeObserver refits on flex reflow (intake §5, verified).
- No backend, API, or route changes (Constitution IV).

### Design Decisions

1. **Gap-adjusted 25% floor**: `min-width: max(BOARD_PANE_MIN_WIDTH, calc(25% - 3px))` rather than the backlog's literal `max(280px, 25%)` — *Why*: the row has `gap-1` (4px × 3 gaps); a literal 25% forces `4×25% + 12px > 100%` → a 12px scrollbar at exactly 4 panes, contradicting "max 4 visible". `calc(25% - 3px)` (12px ÷ 4 panes) makes exactly 4 panes fit flush. — *Rejected*: literal `25%` (breaks the 4-visible invariant); JS row-measurement (unneeded — percentage min-width on a flex item resolves against the flex container content box = the scrollport).
2. **`autofit` prop on `BoardPane`**: a small `autofit?: boolean` prop selecting the flex sizing classes on the pane root, following the existing optional-`width` pattern. — *Why*: the pane root is the row's direct flex child; a prop keeps the sizing decision with the layout owner. — *Rejected*: a wrapper div (extra DOM node, breaks the direct-flex-child + IntersectionObserver `rootRef` contract).
3. **"on" sentinel string**: store the literal `"on"` and read anything else as off. — *Why*: matches the malformed-tolerant discipline of `use-pane-widths.ts`; simplest round-trip. — *Rejected*: JSON boolean (needless parse surface for a single flag).

## Tasks

### Phase 1: Persistence hook

- [x] T001 Create `app/frontend/src/hooks/use-board-autofit.ts` exporting `BOARD_AUTOFIT_LOCALSTORAGE_PREFIX = "runkit:board-autofit:"` and `useBoardAutofit(board): { autofit, toggleAutofit }`, mirroring `use-pane-widths.ts` guards (window bail, try/catch, malformed→off), default off, reload on `board` change. <!-- R1 R2 R3 -->
- [x] T002 [P] Create `app/frontend/src/hooks/use-board-autofit.test.ts` (Vitest, `renderHook`/`act`): default-off, persistence round-trip + "on" sentinel, per-board key isolation, board-switch reload, malformed-value tolerance. <!-- R1 R2 R3 -->

### Phase 2: Layout branch

- [x] T003 Add an `autofit?: boolean` prop to `BoardPane` (`app/frontend/src/components/board/board-pane.tsx`): when `autofit`, the pane root uses `flex: 1 1 0` + `min-width: max(BOARD_PANE_MIN_WIDTH, calc(25% - 3px))` (import `BOARD_PANE_MIN_WIDTH` from `use-pane-widths`) and drops `w-full`/the pixel `width` style; the `width` prop is ignored while `autofit` is on. <!-- R4 R5 R6 -->
- [x] T004 Thread `autofit` through `DesktopRow` (`app/frontend/src/components/board/board-page.tsx`): accept an `autofit` prop, pass `autofit` to each `BoardPane`, pass `showResizeHandle={!autofit}`, and pass no pixel `width` when autofit is on. Mobile carousel path untouched. <!-- R4 R6 R7 R8 -->

### Phase 3: Controls + plumbing

- [x] T005 Add optional board-mode slot fields `autofit?: boolean` and `onToggleAutofit?: () => void` to `TopBarSlot` in `app/frontend/src/contexts/top-bar-slot-context.tsx`. <!-- R11 -->
- [x] T006 In `BoardPage` (`board-page.tsx`): instantiate `useBoardAutofit(name)`, pass `autofit` to `DesktopRow`, publish `autofit` + `onToggleAutofit: toggleAutofit` into the registered slot memo (with deps), and add a `Board: Toggle Autofit` action to `boardRouteActions`. <!-- R10 R11 -->
- [x] T007 Add a board-only `BoardAutofitToggle` to `top-bar.tsx`: new optional `autofit`/`onToggleAutofit` props on `TopBarProps`, consumed from the slot; render the toggle in the L2 cluster (board mode only) mirroring `FixedWidthToggle` (`aria-pressed`, `rk-glint`, `coarse:` sizing). Wire the slot fields through `RootTopBar` in `app.tsx` if the slot→props mapping is explicit there. <!-- R9 R11 -->

### Phase 4: E2E

- [x] T008 Create `app/frontend/tests/e2e/board-autofit.spec.ts` + companion `board-autofit.spec.md` (Constitution Test Companion Docs): desktop viewport, pin panes via API; assert (a) toggle on with 2–3 panes → equal widths filling the row, no horizontal scroll; (b) 5+ panes → ~25% floor + horizontal scroll; (c) per-board persistence across reload; (d) handles hidden while on; (e) top-bar button and palette action both flip state. Run via `just test-e2e` only. <!-- R4 R5 R6 R7 R9 R10 -->

## Execution Order

- T001 blocks T002, T006 (hook must exist).
- T003 blocks T004 (row passes the pane prop).
- T005 blocks T006, T007 (slot type first).
- T006, T007 before T008 (controls must exist for the e2e).

## Acceptance

### Functional Completeness

- [x] A-001 R1: `useBoardAutofit` reads off by default and does not write until the setter runs.
- [x] A-002 R2: Toggling persists an "on" sentinel that round-trips across a fresh hook instance.
- [x] A-003 R3: Preference is per-board; changing `board` reloads from the new board's key.
- [x] A-004 R4: Autofit ON with ≤4 panes stretches panes to share the row equally, no horizontal scroll.
- [x] A-005 R5: Autofit ON with 5+ panes floors panes at ~25% and the row scrolls horizontally.
- [x] A-006 R6: Autofit OFF renders explicit per-pane pixel widths; `runkit:board-widths:{board}` is never mutated by autofit.
- [x] A-007 R7: Resize handles are absent while autofit is ON.
- [x] A-008 R8: Mobile carousel is unchanged (no autofit branch).
- [x] A-009 R9: The board-only top-bar toggle flips autofit and reflects state via `aria-pressed`.
- [x] A-010 R10: The `Board: Toggle Autofit` palette action flips the same state.
- [x] A-011 R11: `autofit`/`onToggleAutofit` travel through the top-bar slot context with tolerant-empty defaults.

### Behavioral Correctness

- [x] A-012 R6: Toggling autofit ON then OFF restores the exact hand-tuned pixel widths (non-destructive round-trip).
- [x] A-013 R4: Window resize with autofit ON reflows visible panes (xterm refit rides the existing terminal-client ResizeObserver — no new wiring).

### Scenario Coverage

- [x] A-014 R1 R2 R3: Unit tests cover default-off, round-trip, per-board isolation, board-switch reload, malformed tolerance.
- [x] A-015 R4 R5 R7 R9 R10: Playwright e2e covers equal-fill/no-scroll, 25%-floor/scroll, handles-hidden, button + palette parity, per-board persistence across reload, with a companion `.spec.md`.

### Edge Cases & Error Handling

- [x] A-016 R1: Malformed/absent localStorage values read as off without throwing (window-undefined and try/catch guards).
- [x] A-017 R5: On narrow viewports where `280px > 25%`, the floor uses the 280px arm (`BOARD_PANE_MIN_WIDTH`), not a sub-280 pane.

### Code Quality

- [x] A-018 Pattern consistency: New code follows the naming and structural patterns of `use-pane-widths.ts`, `FixedWidthToggle`, and the existing slot-context fields.
- [x] A-019 No unnecessary duplication: The 280px floor imports `BOARD_PANE_MIN_WIDTH` (no magic number); the toggle reuses the `FixedWidthToggle`/`rk-glint` button vocabulary rather than a new style.
- [x] A-020 Type narrowing: New props/fields are optional with tolerant-empty handling; no `as` casts introduced beyond existing patterns.
- [x] A-021 Tests included: New hook has Vitest coverage; UI change ships a Playwright e2e with companion `.spec.md` (code-quality.md: UI changes SHOULD include e2e).

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)

## Deletion Candidates

None — this change adds new functionality without making existing code redundant.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Floor is gap-adjusted `max(BOARD_PANE_MIN_WIDTH, calc(25% - 3px))` rather than literal `max(280px, 25%)` | Intake assumption #3: row `gap-1` (4px × 3) makes literal 25% force a 12px scrollbar at exactly 4 panes; adjusted value honors the "max 4 visible" intent over the letter | S:70 R:90 A:85 D:60 |
| 2 | Confident | `BoardPane` grows an `autofit?: boolean` prop selecting flex classes on the pane root (not a wrapper div) | Intake assumption #8: pane root is the row's direct flex child; wrapper would break the `rootRef` IntersectionObserver contract; follows the optional-`width` pattern | S:70 R:85 A:80 D:70 |
| 3 | Confident | Toggle mirrors `FixedWidthToggle`, board-only in the L2 cluster, plumbed through the slot context like `onCloseFocused` | Intake assumption #9: placement explicit in backlog; visual/wiring pattern inferred from the analogous width toggle + existing board-mode slot fields | S:60 R:95 A:80 D:70 |
| 4 | Certain | "on" string sentinel in localStorage; any other value reads as off | Matches `use-pane-widths.ts` malformed-tolerant discipline; simplest single-flag round-trip | S:85 R:95 A:90 D:85 |
| 5 | Confident | E2E asserts DOM via `[aria-label="board pane win-N"]` bounding boxes + `.overflow-x-auto` scroll metrics, pinning real panes via the API, mirroring `boards-desktop-suspend.spec.ts` | The board-reorder spec avoids DnD simulation; suspend spec proves DOM-layout assertions on a live desktop board are deterministic | S:75 R:90 A:80 D:75 |

5 assumptions (1 certain, 4 confident, 0 tentative).
