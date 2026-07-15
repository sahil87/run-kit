# Plan: Board Splits, Close-Pane ✕, and Pin-Glyph Unpin

**Change**: 260715-6jwn-board-splits-close-pin-icon
**Intake**: `intake.md`

## Requirements

### Board Top Bar: Split & Close

#### R1: Board top-bar splits act on the focused tile's window
The two top-bar `SplitButton`s (vertical + horizontal) SHALL render on board mode, wired to the focused tile's window, in addition to terminal mode. `FixedWidthToggle` and the `ViewSwitcher` SHALL remain terminal-only (they stay gated on `currentWindow`, which is `null` on board). The split target's `cwd` SHALL come from the focused `BoardEntry`'s active pane (fallback: first pane; else omit).

- **GIVEN** a board with ≥1 pinned tile and a focused tile `{server, windowId}`
- **WHEN** the user clicks the top-bar Split vertically / Split horizontally button
- **THEN** `splitWindow(server, windowId, horizontal, cwd)` is called with the focused entry's values, splitting relative to the window's active pane
- **AND** the split appears live inside the tile (the relay renders the whole window)

- **GIVEN** the board is empty (no focused entry)
- **WHEN** the top bar renders
- **THEN** the SplitButtons are NOT rendered (no focused pane to target)

- **GIVEN** cockpit or root mode (no `currentWindow`, no `focusedPane`)
- **THEN** the SplitButtons stay absent (unchanged)

#### R2: Board top-bar ✕ kills the focused tile's active pane
The board-mode top-bar ✕ SHALL use `ClosePaneButton`'s existing kill path against the focused entry's `{server, windowId}` — `closePane(server, windowId)` → `POST /api/windows/{id}/close-pane` → `tmux.KillActivePane`. Its accessible label SHALL be `"Close pane"` (uniform with terminal mode). There SHALL be NO confirmation dialog. The button SHALL be disabled when the board has no focused entry.

- **GIVEN** a board with a focused tile
- **WHEN** the user clicks the top-bar ✕
- **THEN** `closePane(server, windowId)` is called (no confirmation), with the optimistic spinner + toast-on-error behavior inherited from the terminal path

- **GIVEN** the board is empty (no focused entry)
- **THEN** the ✕ is disabled

- **GIVEN** terminal mode
- **THEN** the ✕ still kills the current window's active pane (unchanged)

#### R3: Stale-pin self-heal after a window-killing board ✕
When a board-mode ✕ kills the last pane of a window (collapsing its single-window pin-session), the board page SHALL schedule its own entries refetch after the successful kill, because no `board-changed` SSE event fires on that path and `useBoardEntries` subscribes only to `board-changed`.

- **GIVEN** a single-pane tile on a board
- **WHEN** the top-bar ✕ kills its only pane (window dies, pin-session collapses)
- **THEN** the board page refetches entries, the dead tile disappears (`getBoard` skips vanished pin-sessions), and an emptied board vanishes from `GET /api/boards`, leaving the empty-state route

- **GIVEN** a multi-pane tile
- **WHEN** the ✕ kills the active pane (window survives)
- **THEN** the refetch is harmless (the entry still resolves) and the tile stays pinned, relay rendering the surviving layout

### Board Tile Header

#### R4: Tile-header unpin icon changes ✕ → pin glyph
The per-tile board header's unpin button SHALL render an inline-SVG pin/unpin glyph (hand-rolled, "pin with slash" style, matching the project's no-icon-library pattern) instead of the text `×`. All other behavior SHALL be preserved: `draggable={false}`, `e.stopPropagation()` on click, `aria-label={`Unpin ... from board`}`, `title="Unpin from board"`, no confirmation dialog.

- **GIVEN** a board tile header
- **WHEN** it renders
- **THEN** the unpin affordance is a pin/unpin SVG glyph, not a `×` text glyph
- **AND** clicking it unpins the tile (no confirmation), does not start a header drag, and does not refocus the pane

### Board Command Palette (Constitution V)

#### R5: Board palette split/close actions
The board route's palette SHALL add three actions gated on `entries.length > 0`, acting on `entries[focusedIndex]`: `Board: Split Focused Pane Vertical`, `Board: Split Focused Pane Horizontal`, `Board: Close Focused Pane`. Split wiring SHALL mirror the terminal *palette*'s `horizontal` mapping (Vertical → `horizontal: true`). `Board: Unpin Focused Pane` SHALL remain unchanged. Split/close palette actions SHALL surface errors via the board's `addToast`.

- **GIVEN** a board route with ≥1 entry
- **WHEN** the user opens Cmd+K
- **THEN** the three new actions are present alongside `Board: Unpin Focused Pane`
- **WHEN** `Board: Split Focused Pane Vertical` is selected
- **THEN** `splitWindow(server, windowId, true, cwd)` fires for the focused entry
- **WHEN** `Board: Close Focused Pane` is selected
- **THEN** `closePane(server, windowId)` fires for the focused entry

- **GIVEN** a board with zero entries
- **THEN** the three actions are hidden

### Housekeeping

#### R6: Slot contract + comments
`top-bar-slot-context` SHALL carry the board kill/split target and refetch seam; the `onCloseFocused` slot field SHALL be removed from the top-bar ✕ wiring (retained only as the palette-shared `unpinFocused` handler within `board-page.tsx`, which no longer feeds the ✕). The top-bar right-cluster "button pyramid" comment (L1/L2) and the `board-page.tsx:657` rationale comment SHALL be updated to document the new semantics (L1 splits = terminal+board; board ✕ = close-pane kill; misclick tradeoff accepted, focused ring disambiguates).

- **GIVEN** a reader of `top-bar.tsx` / `board-page.tsx`
- **WHEN** they read the pyramid + rationale comments
- **THEN** the comments describe splits-on-board, board ✕ = kill, and the reversed unpin decision

#### R7: Tests and companion docs
Unit tests (`top-bar.test.tsx`, `command-palette.boards.test.tsx`) SHALL be updated to cover the new board ✕ = close-pane + board splits + palette actions, and the e2e `board-unpin-focused.spec.ts` + `.spec.md` SHALL be reworked (renamed if the name no longer fits) to cover (a) tile-header pin-glyph unpin and (b) board top-bar ✕ = close-pane + self-heal + board vanishing. Playwright mutating-route mocks (if any) SHALL carry the trailing `*` glob.

- **GIVEN** the change is complete
- **WHEN** `just test-frontend` and the reworked e2e run
- **THEN** they pass, asserting the new board split/close/unpin behavior; every touched `.spec.ts` has an updated sibling `.spec.md`

### Non-Goals

- Reconciling the pre-existing top-bar-chip vs palette "vertical/horizontal" flag divergence — the board palette mirrors the terminal *palette* mapping; reconciliation is out of scope.
- The board waiting-badge join (`board-page.tsx` joins entries against `ctx.sessionsByServer`, which excludes pin-sessions) — untouched.
- Mobile/breakpoint changes — board splits/✕ keep the `hidden sm:flex` gating.

### Design Decisions

1. **Board ✕ reuses the terminal kill path, not a new API**: `ClosePaneButton` with `{server, windowId}` from the new `focusedPane` slot field. — *Why*: minimal surface area, uniform ✕ semantics across modes, inherits the optimistic spinner + error toast for free. — *Rejected*: a confirmation dialog on board kill (rejected for terminal-mode consistency; focused ring disambiguates); keeping the ✕ as unpin on board (rejected — redundant with tile-header + palette unpin).
2. **`ClosePaneButton` drops `onUnpin`**: after this change no caller passes `onUnpin` (board switches to the kill path), so the prop + its "no handler → disable" guard become dead and are removed; the component keeps only the kill path. — *Why*: the intake explicitly permits dropping `onUnpin` "if no other caller remains"; removing dead branches over keeping them.
3. **`focusedPane` slot field + `onPaneClosed` refetch seam**: board publishes `focusedPane {server, windowId, cwd}` (`currentWindow` stays `null`) plus a refetch callback; `useBoardEntries` gains a `refetch` return consumed by the board kill handler. — *Why*: mirrors the existing `onCloseFocused`/`autofit` slot-field pattern; the refetch is the minimal frontend self-heal for the no-`board-changed`-on-kill gap.
4. **Pin glyph is hand-rolled inline SVG**: a "pin with slash" outline, matching every existing top-bar/header chip. — *Why*: the project uses no icon library.

## Tasks

### Phase 1: Slot contract + hook seam

- [x] T001 Add `focusedPane?: { server: string; windowId: string; cwd?: string } | null` and `onPaneClosed?: () => void` to `TopBarSlot` in `app/frontend/src/contexts/top-bar-slot-context.tsx`; document them and note that `onCloseFocused` is now palette-internal (no longer the top-bar ✕ source). Keep `onCloseFocused?` in the type only if still referenced; otherwise remove it. <!-- R6 -->
- [x] T002 Expose a `refetch` function from `useBoardEntries` in `app/frontend/src/hooks/use-boards.ts` (return `{ entries, isLoading, error, refetch }`, where `refetch` calls `fetchEntries`). <!-- R3 -->

### Phase 2: Top bar (splits + close on board)

- [x] T003 In `app/frontend/src/components/top-bar.tsx`, add `focusedPane` (+ any needed board-close/refetch handler) to `TopBarProps`; wire it through from `RootTopBar` in `app/frontend/src/app.tsx` (add `focusedPane={slot?.focusedPane}` and drop the `onCloseFocused` pass-through if the field is removed). <!-- R1 -->
- [x] T004 In `top-bar.tsx`, render the two `SplitButton`s on board mode (fed by `focusedPane` when `mode === "board"`), keeping `hidden sm:flex` gating; preserve the terminal-mode `currentWindow &&` render. Ensure `FixedWidthToggle`/`ViewSwitcher` stay terminal-only. <!-- R1 -->
- [x] T005 In `top-bar.tsx`, rewire the board-mode L2 ✕: use `ClosePaneButton`'s kill path with `focusedPane.{server,windowId}`, label `"Close pane"`, disabled when `focusedPane` is null; on click, after a successful `closePane` call `onPaneClosed` (self-heal). Terminal-mode ✕ unchanged. <!-- R2 R3 -->
- [x] T006 In `top-bar.tsx`, remove the `onUnpin` prop from `ClosePaneButton` and its "no handler → disable" guard (dead after board switches to the kill path); simplify to the single kill path. <!-- R2 -->
- [x] T007 In `top-bar.tsx`, update the right-cluster button-pyramid comment block (L1 splits become terminal+board; L2 ✕ description = close-pane kill on both modes). <!-- R6 -->

### Phase 3: Board page (slot registration, kill handler, palette, comment, header icon)

- [x] T008 In `app/frontend/src/components/board/board-page.tsx`, consume `refetch` from `useBoardEntries`; derive a `focusedPane` from `entries[focusedIndex]` (with `cwd` = active pane's cwd, fallback first pane, else undefined) and publish it into the slot via `useRegisterTopBarSlot`; publish `onPaneClosed` = a handler that schedules `refetch()` after a board-mode kill. Remove `onCloseFocused`/`closeDisabled` from the slot registration (or keep `unpinFocused` only for the palette). <!-- R2 R3 R6 -->
- [x] T009 <!-- rework: review should-fix — unpinFocused is now dead code (the palette action inlines unpin() directly) while the new comment above it falsely claims it "survives ONLY as the palette-action handler"; either wire the board-unpin-focused palette action to call unpinFocused (R6's letter) or delete it and correct the comment --> In `board-page.tsx`, replace the `board-page.tsx:657` rationale comment (currently "kill stays in the pane's own UI") with one documenting the reversal: board ✕ = kill active pane, no confirm, uniform with terminal, misclick tradeoff accepted, focused ring disambiguates. Keep `unpinFocused` as the palette-only unpin handler. <!-- R6 -->
- [x] T010 <!-- rework: review must-fix (parsimony/duplicated-logic) — the palette's focusedCwd IIFE (board-page.tsx:572-577) + per-handler entries[focusedIndex] lookups duplicate the focusedPane memo (:730-736); hoist the focusedPane memo above boardRouteActions and have the three palette handlers consume it directly --> In `board-page.tsx` `boardRouteActions`, add `useOptimisticAction`-wrapped `splitWindow`/`closePane` executors (with `addToast` on error) and three palette actions gated on `entries.length > 0` acting on `entries[focusedIndex]`: `Board: Split Focused Pane Vertical` (horizontal: true), `Board: Split Focused Pane Horizontal` (horizontal: false), `Board: Close Focused Pane` (calls closePane then schedules `refetch`). Derive cwd from the focused entry's active/first pane. Update the memo dep array. <!-- R5 -->
- [x] T011 In `app/frontend/src/components/board/board-header.tsx`, replace the `×` text glyph with a hand-rolled inline-SVG pin/unpin glyph; preserve `draggable={false}`, `stopPropagation`, `aria-label`, `title`, no-confirm. Update the component doc comment (it names "the ✕ unpin button"). <!-- R4 -->

### Phase 4: Tests + companion docs

- [x] T012 Rewrite the `board-mode ✕ = unpin focused pane` describe in `app/frontend/src/components/top-bar.test.tsx`: board ✕ now carries `"Close pane"` and calls `closePane(server, windowId)` with the focused entry's values; disabled when no focused entry; add board-mode assertions that both SplitButtons render and call `splitWindow` with the focused entry's `{server, windowId, cwd}`; keep cockpit/root assertions that splits/✕ stay absent; keep FixedWidthToggle board-absent. Adjust the render helper to pass `focusedPane`. <!-- R7 -->
- [x] T013 In `app/frontend/src/components/command-palette.boards.test.tsx`, extend the `buildBoardActions` mirror + cases to cover the three new board palette actions (presence gated on entries, selection wiring). <!-- R7 -->
- [x] T014 <!-- rework: review must-fix (A-008) — the reworked e2e only polls GET /api/boards after the ✕ kill, which passes even if the onPaneClosed→refetch wiring is deleted; add a post-kill UI assertion that the tile disappears from the DOM (e.g. expect(page.getByText("win-b")).toHaveCount(0) or the board empty-state becoming visible) so the self-heal refetch itself is exercised --> Rework `app/frontend/tests/e2e/board-unpin-focused.spec.ts` (rename the file/describe if the name no longer fits, e.g. `board-close-and-unpin.spec.ts`): (a) tile-header pin-glyph unpin → click the header unpin button, assert click-triggered `POST /api/boards/<name>/unpin` + board emptying; (b) board top-bar ✕ → assert the `Close pane` name + click-triggered `POST /api/windows/<id>/close-pane`, then the tile disappearing (self-heal refetch) + the board vanishing from the listing. Any added mutating-route mocks carry the trailing `*` glob. <!-- R7 -->
- [x] T015 <!-- rework: review should-fix — board-close-and-unpin.spec.md:20 falsely cites a "board-header render" unit test for the pin-glyph rendering (no board-header test file exists); correct the doc or add a small board-header render test covering the glyph (A-004) --> Update the sibling `.spec.md` (rename to match if the spec file is renamed) to document the reworked tests per Constitution Test Companion Docs. <!-- R7 -->

## Execution Order

- T001, T002 first (contract + hook seam consumed by everything downstream).
- T003 before T004–T006 (props threaded before use).
- T008 depends on T001/T002; T010 depends on T002.
- Phase 4 tests come after their implementation tasks.

## Acceptance

### Functional Completeness

- [x] A-001 R1: Both top-bar SplitButtons render on board mode fed by the focused tile and call `splitWindow` with the focused entry's `{server, windowId, cwd}`; they stay absent on empty board / cockpit / root; FixedWidthToggle + ViewSwitcher remain terminal-only.
- [x] A-002 R2: The board top-bar ✕ carries the `"Close pane"` label, calls `closePane(server, windowId)` with the focused entry's values, has no confirmation dialog, and is disabled when the board has no focused entry; terminal ✕ still kills the current window's pane.
- [x] A-003 R3: `useBoardEntries` exposes a `refetch`; after a board-mode ✕ kill the board page schedules a refetch (dead tile drops for a window-killing kill; harmless for a surviving multi-pane tile).
- [x] A-004 R4: The tile-header unpin button renders an inline-SVG pin/unpin glyph (no `×` text), preserving `draggable={false}`, `stopPropagation`, `aria-label`, `title`, and no-confirm.
- [x] A-005 R5: The board palette has `Board: Split Focused Pane Vertical/Horizontal` + `Board: Close Focused Pane`, gated on entries, wired to `splitWindow`/`closePane` for the focused entry with error toasts; `Board: Unpin Focused Pane` is unchanged.

### Behavioral Correctness

- [x] A-006 R2: The board ✕ reverses the prior unpin behavior — it no longer calls the unpin path; `unpinFocused` remains reachable only via the tile header + `Board: Unpin Focused Pane` palette action. *(Re-verified after rework: T009 rewired the palette action to `onSelect: unpinFocused` — the callback is live again and its comment is accurate.)*
- [x] A-007 R3: A single-pane board-mode kill empties the board and lands on the empty-state route (`getBoard` skips the vanished pin-session; empty board removed from `GET /api/boards`).

### Scenario Coverage

- [x] A-008 R7: `top-bar.test.tsx` asserts board ✕ = close-pane (not unpin) + board splits; `command-palette.boards.test.tsx` covers the three new palette actions; the reworked e2e asserts tile-header pin-glyph unpin and board top-bar ✕ close-pane + self-heal + board vanishing. *(Re-verified after rework: T014 added the post-kill DOM assertions — `expect(page.getByText("win-b")).toHaveCount(0)` + the `No panes pinned to this board yet.` empty-state — so the `onPaneClosed`→`refetch` frontend self-heal is exercised directly, before the server-derived `GET /api/boards` poll. `just test-e2e "board-close-and-unpin"`: 2 passed.)*

### Edge Cases & Error Handling

- [x] A-009 R1: A split on a too-small tile surfaces via the existing `SplitButton`/palette toast-on-error path (no crash).
- [x] A-010 R5: With zero entries the three new palette actions are hidden (gated on `entries.length > 0`).

### Code Quality

- [x] A-011 Pattern consistency: New code follows the top-bar chip / hand-rolled inline SVG / `useOptimisticAction` + `addToast` / slot-registration patterns of surrounding code.
- [x] A-012 No unnecessary duplication: Reuses `SplitButton`, `ClosePaneButton` kill path, `splitWindow`/`closePane` clients, and `useBoardEntries` — no reimplementation; dead `onUnpin` branch removed. *(Re-verified after rework: T010 hoisted the `focusedPane` memo above `boardRouteActions` (board-page.tsx:403) and the three palette handlers consume it directly — the `focusedCwd` IIFE is gone; the active-pane-cwd derivation now exists exactly once.)*
- [x] A-013 Type narrowing over assertions: `focusedPane` null-handling uses guards, not `as` casts (code-quality Frontend principle).
- [x] A-014 Test companion docs: every touched `*.spec.ts` ships an updated sibling `*.spec.md` in the same change (Constitution).
- [x] A-015 No client polling: self-heal uses an event-driven one-shot refetch after the kill, not `setInterval` (code-quality anti-pattern).

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- Backend is untouched (`splitWindow`/`closePane` REST paths, `SplitWindow`/`KillActivePane`, and the `getBoard` dead-pin filtering already exist).

## Deletion Candidates

- `ClosePaneButton` `label` prop (`app/frontend/src/components/top-bar.tsx:1744`) — vestigial after the board branch dropped `label="Unpin pane from board"`: no caller passes it, every render uses the `"Close pane"` default; the prop + default can be inlined as a constant.

*(Reconciled on rework cycle 1: the prior `unpinFocused` candidate is withdrawn — T009 rewired the `Board: Unpin Focused Pane` palette action to call `unpinFocused` directly (board-page.tsx:592), so the callback is live again and its "survives ONLY as the palette-action handler" comment is now accurate.)*

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Board top-bar splits act on the focused tile via existing `splitWindow`; ViewSwitcher/FixedWidthToggle stay terminal-only (gated on `currentWindow`) | Intake Certain #1; verified `currentWindow` gates all three and stays null on board | S:90 R:85 A:90 D:90 |
| 2 | Certain | Board top-bar ✕ = kill active pane via `ClosePaneButton` kill path, no confirmation, label "Close pane" | Intake Certain #2; user accepted misclick tradeoff | S:95 R:70 A:90 D:90 |
| 3 | Certain | Tile-header ✕ → hand-rolled inline-SVG pin/unpin glyph, all other behavior preserved | Intake Certain #4 + Confident #7 | S:85 R:90 A:85 D:80 |
| 4 | Confident | Board split cwd = focused `BoardEntry.panes` active pane's cwd (fallback first pane, else omit) — NOT the discussion's `sessionsByServer` lookup | Intake Confident #5; verified pin-sessions are filtered from every session list so the lookup can't find them; `BoardEntry.panes` carries cwd+isActive | S:60 R:85 A:85 D:75 |
| 5 | Confident | `useBoardEntries` gains a `refetch` return; board page schedules it after a board-mode kill (self-heal) | Intake Confident #6; verified no `board-changed` fires on kill-collapsed pin-sessions and the hook subscribes only to `board-changed`; minimal one-shot refetch | S:55 R:80 A:80 D:70 |
| 6 | Confident | `ClosePaneButton` drops `onUnpin` entirely (no caller remains after board switches to the kill path) | Intake §2 explicitly permits dropping it "if no other caller remains"; grep confirms board was the only `onUnpin` caller | S:70 R:85 A:85 D:75 |
| 7 | Confident | Slot gains `focusedPane {server, windowId, cwd}` + `onPaneClosed` refetch seam; `onCloseFocused` leaves the top-bar ✕ wiring (kept only as the palette `unpinFocused` handler in board-page) | Intake Confident #9; mirrors the existing `onCloseFocused`/`autofit` slot pattern | S:55 R:85 A:85 D:70 |
| 8 | Confident | Board palette labels: "Board: Split Focused Pane Vertical/Horizontal" + "Board: Close Focused Pane", mirroring the terminal *palette* horizontal mapping (Vertical→true) | Intake Confident #8; follows the "Board: …" convention + terminal palette wiring (app.tsx:1507-1526) | S:40 R:90 A:60 D:45 |
| 9 | Confident | E2E reworked into tile-header pin-glyph unpin + board top-bar ✕ close-pane; file renamed if the name no longer fits | Intake §5; Constitution Test Companion Docs mandates the paired `.spec.md` update | S:65 R:90 A:80 D:70 |
| 10 | Certain | No mobile/breakpoint changes — board splits/✕ keep the `hidden sm:flex` gating | Intake Certain #11; matches existing responsive pattern | S:85 R:90 A:90 D:90 |

10 assumptions (4 certain, 6 confident, 0 tentative).
