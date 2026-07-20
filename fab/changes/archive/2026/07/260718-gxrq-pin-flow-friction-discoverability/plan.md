# Plan: Pin Flow Friction & Boards Discoverability

**Change**: 260718-gxrq-pin-flow-friction-discoverability
**Intake**: `intake.md`

## Requirements

<!-- Derived from intake.md. Frontend-only; no backend/API changes. -->

### Pin Popover: Cold-start & Last-used

#### R1: Cold-start pre-filled default board name
When zero boards exist, the pin popover SHALL pre-fill its new-board input with `main` and select the text on autofocus, so a bare Enter pins to a new board `main` without the user typing.

- **GIVEN** the pin popover opens and `boards.length === 0`
- **WHEN** it mounts and autofocuses the input
- **THEN** the input value is `main` with its text selected
- **AND** pressing Enter immediately pins the window to a new board named `main` (existing `handleSubmitNew` path)
- **AND** typing any character replaces the selection, preserving the invent-a-name path
- **WHEN** `boards.length > 0`
- **THEN** the input stays empty (placeholder unchanged)

#### R2: Last-used board persistence and ordering
On every successful pin from any entry point, the board name SHALL be persisted client-side to `localStorage["runkit-last-pinned-board"]`; the popover's existing-board list SHALL render the last-used board first when it is still a live board.

- **GIVEN** a successful pin to board `X`
- **WHEN** the pin resolves
- **THEN** `localStorage["runkit-last-pinned-board"]` is `X`
- **GIVEN** a stored last-used board that is present in the live `boards` list
- **WHEN** the popover renders existing boards
- **THEN** that board is first, remaining boards keep their existing display order
- **GIVEN** a stored last-used board that is no longer in the live `boards` list
- **WHEN** the popover renders
- **THEN** the stale value is ignored (no reorder, no crash)

#### R3: Empty-input Enter pins to last-used board
When boards exist and the input is empty, pressing Enter SHALL pin to the last-used board (and close the popover) if a valid last-used board exists; otherwise it SHALL remain a no-op. The last-used row SHALL carry an `↵` hint marking Enter's target.

- **GIVEN** boards exist, the input is empty, and a valid last-used board `X` exists
- **WHEN** the user presses Enter
- **THEN** the window is pinned to `X` and the popover closes
- **GIVEN** boards exist, the input is empty, and no valid last-used board exists
- **WHEN** the user presses Enter
- **THEN** nothing happens (current no-op behavior)
- **AND** the last-used row displays a small `↵` hint (only when a valid last-used board is shown first)

### Boards Discoverability

#### R4: BOARDS panel default-open when boards exist
The BOARDS sidebar `CollapsiblePanel` SHALL default open when `boards.length > 0` and default closed otherwise; a stored user toggle SHALL always win over the default.

- **GIVEN** no stored `runkit-panel-boards` preference and ≥1 board exists
- **WHEN** the sidebar renders
- **THEN** the BOARDS panel is open
- **GIVEN** no stored preference and zero boards
- **WHEN** the sidebar renders
- **THEN** the BOARDS panel is closed
- **GIVEN** the user has explicitly toggled the panel (stored preference exists)
- **WHEN** the sidebar renders
- **THEN** the stored value wins regardless of board count

#### R5: PinIcon in the BOARDS panel header
The shared `PinIcon` glyph (outline variant) SHALL render in the BOARDS panel `headerRight`, leading the board count, and SHALL also render when the count is absent (zero-board hint mode). No new SVG is introduced.

- **GIVEN** the BOARDS panel renders with ≥1 board
- **WHEN** the header renders
- **THEN** an outline `PinIcon` appears in `headerRight`, leading the `{boards.length}` count
- **GIVEN** zero boards
- **WHEN** the header renders
- **THEN** the outline `PinIcon` still appears (no count)

#### R6: Post-pin success feedback toast with "View board" action
The toast system SHALL support an optional action `{ label, onSelect }` rendered as a focusable button. On a successful pin, `usePinActions.pin` SHALL surface an `info` toast "Pinned to <board>" with a "View board" action navigating to `/board/<board>`. Existing two-argument `addToast` call sites SHALL be unaffected; `unpin` stays error-only.

- **GIVEN** a successful pin to board `X`
- **WHEN** the pin resolves
- **THEN** an `info` toast "Pinned to X" is shown with a "View board" button
- **WHEN** the "View board" button is activated
- **THEN** the app navigates to `/board/X`
- **GIVEN** any existing `addToast(message)` / `addToast(message, variant)` call
- **WHEN** it fires
- **THEN** behavior is unchanged (no action button)
- **GIVEN** an unpin (success or failure)
- **WHEN** it resolves
- **THEN** no success toast is shown (error-only, unchanged)

### Command-Palette Pin Actions

#### R7: `buildPinActions` pure builder
A new pure builder `lib/palette-pin.ts` SHALL produce `PaletteAction[]`: one direct-pin action per existing board the current window is NOT already pinned to (`Pin: Current Window to <board>`), ordered last-used-first, plus one new-board variant (`Pin: Current Window to new board…`). It SHALL be dependency-free and unit-testable.

- **GIVEN** boards `[a, b, c]`, the window pinned to `b`, last-used `c`
- **WHEN** `buildPinActions` runs
- **THEN** it returns direct-pin actions for `c` then `a` (last-used-first, `b` excluded), then the new-board variant last
- **GIVEN** the window is already pinned to every board
- **WHEN** `buildPinActions` runs
- **THEN** only the new-board variant is returned
- **GIVEN** zero boards
- **WHEN** `buildPinActions` runs
- **THEN** only the new-board variant is returned
- **AND** each direct-pin `onSelect` invokes the pin callback for its board; the new-board `onSelect` invokes the open-popover callback

#### R8: Palette wiring & supersession of the inline pin action
The pin palette actions SHALL be wired into AppShell's `boardActions` composition in `app.tsx`, gated on `sessionName && currentWindow && server`, so they are available on the terminal/server route for the current window. The inline `board-pin-current` (`Board: Pin Current Window`) action SHALL be removed (superseded by the new-board variant). `Board: Unpin Current Window` and `Board: Switch to <name>` SHALL be unchanged. The board-route palette mount (`board-page.tsx`) SHALL be unchanged. The palette registration SHALL carry a comment documenting the actions (code-review rule).

- **GIVEN** a terminal/server route with `sessionName && currentWindow && server`
- **WHEN** the palette is composed
- **THEN** the pin actions from `buildPinActions` are present and the old `board-pin-current` action is absent
- **GIVEN** the new-board variant is selected
- **WHEN** its `onSelect` fires
- **THEN** it dispatches the existing `pin-popover:open` CustomEvent (same mechanism the removed action used)
- **AND** `Board: Unpin Current Window` / `Board: Switch to <name>` are still present unchanged

### Non-Goals

- Renaming the BOARDS pane or any "Board" vocabulary — rejected (vocabulary split against the load-bearing "Board" term).
- Board-side "+ Add window" picker on `/board/$name` — deferred to a future change.
- Drag-to-pin from sidebar window row onto a board row — backlog idea [g0t1].
- Bookmark-star instant-pin (bare pin-icon click pins to last-used) — rejected.
- Changing the window-row pin icon's hover-reveal/mouse behavior.
- Any backend or API change (`POST /api/boards/{name}/pin` and `ValidBoardName` already suffice).

### Design Decisions

1. **Cold-start mechanism = pre-filled selected input** (not a separate one-click row) — *Why*: keyboard-first (Constitution V), smallest diff, reuses the existing autofocus target and `handleSubmitNew` path — *Rejected*: a primary "Pin to new board 'main'" row button (extra UI surface, more diff).
2. **Discoverability = dynamic `defaultOpen={boards.length > 0}`** (not one-shot auto-expand) — *Why*: `useLocalStorageBoolean` natively consults `defaultValue` only when no stored key exists and resyncs on `defaultValue` change, so the panel opens live when the first board appears and stored user toggles always win — *Rejected*: auto-expand-once (needs extra one-shot state).
3. **Last-used written at a single site inside `usePinActions.pin`** — *Why*: every entry point (popover, palette) routes through the hook, so one write keeps all sites consistent; the ordering/Enter-target logic lives in a small `lib/last-pinned-board.ts` helper so it is unit-testable — *Rejected*: per-call-site writes (drift risk).
4. **Success toast inside `usePinActions.pin` with a minimal toast `action` extension** — *Why*: hook placement gives all pin call sites feedback for free; the `action?: { label, onSelect }` third argument preserves all 74 existing positional `addToast` call sites — *Rejected*: per-call-site toasts.

## Tasks

### Phase 1: Setup (pure helpers)

- [x] T001 [P] Create `app/frontend/src/lib/last-pinned-board.ts` exporting `LAST_PINNED_BOARD_KEY = "runkit-last-pinned-board"`, `readLastPinnedBoard(): string | null` and `writeLastPinnedBoard(name: string): void` (try/catch-noop around localStorage, mirroring `lib/window-view.ts` read/write), plus `orderBoardsLastUsedFirst(boards, lastUsed)` returning the boards with a valid live last-used board moved first (stale/absent last-used ignored, input not mutated). <!-- R2 -->
- [x] T002 [P] Create `app/frontend/src/lib/palette-pin.ts` exporting a pure `buildPinActions(...)` returning `PaletteAction[]` from `command-palette.tsx`: direct-pin actions for boards the window is NOT already pinned to (labels `Pin: Current Window to <board>`, ordered via `orderBoardsLastUsedFirst`), plus the `Pin: Current Window to new board…` variant last. Dependency-free; callbacks (`onPin(board)`, `onOpenNewBoardPopover()`) passed in. <!-- R7 -->

### Phase 2: Core Implementation

- [x] T003 Extend the toast system in `app/frontend/src/components/toast.tsx`: add optional `action?: { label: string; onSelect: () => void }` to `ToastEntry` and as an optional third param to `addToast(message, variant?, action?)`; render the action as a keyboard-focusable `<button>` inside the `Toast` body (dismisses the toast on select, then runs `onSelect`). Existing two-arg call sites unaffected. <!-- R6 -->
- [x] T004 Update `app/frontend/src/hooks/use-pin-actions.ts`: on successful `pin`, write last-used via `writeLastPinnedBoard(board)` and surface `addToast("Pinned to <board>", "info", { label: "View board", onSelect: () => navigate to /board/<board> })` using `useNavigate` (the hook runs inside router context). Keep the existing error toast on failure; `unpin`/`reorder` unchanged. <!-- R2 R6 -->
- [x] T005 Update `app/frontend/src/components/sidebar/pin-popover.tsx`: cold-start (`boards.length === 0`) pre-fills `newName` with `"main"` and selects text on autofocus; existing-board list rendered via `orderBoardsLastUsedFirst(boards, readLastPinnedBoard())`; empty-input Enter pins to the last-used board when a valid one exists (else no-op); render a small `↵` hint on the last-used row. Typing still replaces the prefilled selection. <!-- R1 R2 R3 -->
- [x] T006 Update `app/frontend/src/components/sidebar/boards-section.tsx`: change `defaultOpen={false}` → `defaultOpen={boards.length > 0}`; render outline `PinIcon` in the `CollapsiblePanel` `headerRight`, leading the count and also present in zero-board hint mode. <!-- R4 R5 -->

### Phase 3: Integration & wiring

- [x] T007 Wire `buildPinActions` into `app/frontend/src/app.tsx` `boardActions` (gated on `sessionName && currentWindow && server`): direct-pin `onPin` calls the pin mutation from `usePinActions`; new-board `onOpenNewBoardPopover` dispatches the existing `pin-popover:open` CustomEvent; remove the inline `board-pin-current` action; keep `board-unpin-current` and `board-switch-*`. Add/adjust the registration comment documenting the new actions. Compute `alreadyPinned` from `currentWindowPinnedBoards`; pass `readLastPinnedBoard()` for ordering. <!-- R7 R8 -->

### Phase 4: Tests

- [x] T008 [P] Add `app/frontend/src/lib/last-pinned-board.test.ts` — read/write round-trip, missing-key returns null, localStorage-throws swallowed, `orderBoardsLastUsedFirst` (last-used-first, stale ignored, empty/absent no-op, input not mutated). <!-- R2 -->
- [x] T009 [P] Add `app/frontend/src/lib/palette-pin.test.ts` — label set, already-pinned exclusion, last-used-first ordering, new-board variant present/last, zero-boards → only new-board variant, `onSelect` wiring. <!-- R7 -->
- [x] T010 [P] Add `app/frontend/src/components/toast.test.tsx` — action button renders when provided, absent otherwise, activating it runs `onSelect` and dismisses; existing message-only entries unchanged. <!-- R6 -->
- [x] T011 [P] Add `app/frontend/src/hooks/use-pin-actions.test.ts(x)` — successful pin writes last-used + fires the info toast with a working "View board" action; failure fires the error toast and writes nothing; unpin stays error-only. <!-- R2 R6 -->
- [x] T012 [P] Add `app/frontend/src/components/sidebar/pin-popover.test.tsx` — cold-start prefill+select+Enter pins to `main`; empty-Enter pins to last-used when present; existing-board ordering last-used-first; `↵` hint on the last-used row. <!-- R1 R2 R3 -->
- [x] T013 [P] Add `app/frontend/src/components/sidebar/boards-section.test.tsx` — dynamic `defaultOpen` (open with boards, closed with none, stored toggle wins); header `PinIcon` present in both board and hint modes. <!-- R4 R5 -->
- [x] T014 Extend `app/frontend/tests/e2e/boards-pin-flow.spec.ts` with a palette direct-pin path exercising the real backend end-to-end (`Pin: Current Window to <board>` → pin lands via `GET /api/boards/<board>`) plus the post-pin toast "View board" link and its navigation to `/board/<board>`; update the sibling `app/frontend/tests/e2e/boards-pin-flow.spec.md` in the same change (Constitution Test Companion Docs). Cold-start Enter-pins-to-`main` is covered deterministically by `pin-popover.test.tsx` (see Assumption 12) rather than by a flaky hover-gated e2e gesture. <!-- R1 R6 R7 -->

## Execution Order

- T001, T002 (Phase 1) are independent helpers; both block their consumers.
- T003 blocks T004 (toast action shape) and T010.
- T004 depends on T001 (writeLastPinnedBoard) and T003 (toast action); blocks T011.
- T005 depends on T001; T006 is independent of T005.
- T007 depends on T002 + T004; blocks T014's palette path.
- Phase 4 tests follow their targets; T008/T009 may run alongside Phase 2.

## Acceptance

### Functional Completeness

- [x] A-001 R1: With zero boards, the pin popover pre-fills `main` (text selected) and a bare Enter creates and pins to board `main`.
- [x] A-002 R2: A successful pin persists the board to `localStorage["runkit-last-pinned-board"]`; the popover renders a live last-used board first and ignores a stale one.
- [x] A-003 R3: With boards present and an empty input, Enter pins to a valid last-used board (else no-op); the last-used row shows an `↵` hint.
- [x] A-004 R4: The BOARDS panel defaults open when boards exist, closed otherwise, and a stored user toggle always wins.
- [x] A-005 R5: An outline `PinIcon` renders in the BOARDS panel header (leading the count and in zero-board hint mode), reusing the shared glyph.
- [x] A-006 R6: A successful pin shows an `info` "Pinned to <board>" toast whose "View board" action navigates to `/board/<board>`; existing `addToast` call sites are unchanged; unpin stays error-only.
- [x] A-007 R7: `buildPinActions` returns last-used-first direct-pin actions excluding already-pinned boards plus the new-board variant, and is dependency-free/unit-tested.
- [x] A-008 R8: Pin palette actions are wired into AppShell gated on `sessionName && currentWindow && server`; the inline `board-pin-current` is removed; unpin/switch actions and the board-route mount are unchanged; registration is documented.

### Behavioral Correctness

- [x] A-009 R1: Typing after cold-start prefill replaces the selection, preserving the invent-a-name path; the input stays empty when boards already exist.
- [x] A-010 R8: The new-board palette variant opens the popover via the existing `pin-popover:open` CustomEvent (the only free-text entry seam).

### Removal Verification

- [x] A-011 R8: The `board-pin-current` action id/label no longer exists anywhere in `app.tsx` (no dead code, no duplicate opener).

### Scenario Coverage

- [x] A-012 R7: `palette-pin.test.ts` exercises label set, already-pinned exclusion, ordering, and the zero-boards → only-new-board case.
- [x] A-013 R6: `toast.test.tsx` and `use-pin-actions` tests exercise the action button render + View-board navigation and the success/failure branches.
- [x] A-014 R1 R3: `pin-popover.test.tsx` exercises cold-start Enter-to-`main` and empty-Enter-to-last-used.

### Edge Cases & Error Handling

- [x] A-015 R2: A localStorage read/write failure (private mode / quota) is swallowed (try/catch-noop) and never throws.
- [x] A-016 R2: A stale last-used board (no longer live) is filtered out of ordering and never becomes the empty-Enter target.

### Code Quality

- [x] A-017 Pattern consistency: New code follows surrounding naming/structure — pure builder in `lib/` mirroring `palette-move.ts`/`palette-version.ts`, localStorage helper mirroring `lib/window-view.ts` try/catch-noop, `runkit-*` key convention.
- [x] A-018 No unnecessary duplication: Reuses `PinIcon`, `usePinActions`, `pinWindow`, `ValidBoardName`, `CollapsiblePanel` `headerRight`/`defaultOpen`, and the existing `pin-popover:open` event rather than reimplementing them.
- [x] A-019 Type narrowing over assertions: New TS uses guards/discriminated unions, no `as` casts (code-quality.md); `cd app/frontend && npx tsc --noEmit` passes.
- [x] A-020 Client polling anti-pattern avoided: No `setInterval`+fetch introduced; board state continues to flow via existing hooks/SSE.
- [x] A-021 Keyboard shortcut documentation: The new palette pin actions are documented in the command-palette registration comment (code-review.md rule).
- [x] A-022 Test companion docs: `boards-pin-flow.spec.md` is updated in the same change as `boards-pin-flow.spec.ts` (constitution).

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- `app/frontend/src/components/command-palette.boards.test.tsx:84-89, 185-203` — the hand-written `buildBoardActions` mirror still models the removed `board-pin-current` action (`Board: Pin Current Window`) and two visibility tests assert it; production superseded it with `buildPinActions` (lib/palette-pin.ts), so the mirror block + those two rule-checks are stale.
- `app/frontend/src/components/sidebar/window-row.tsx:137` — comment attributes the `pin-popover:open` dispatch to "the command palette's `Board: Pin Current Window` action", which no longer exists (the dispatcher is now the `Pin: Current Window to new board…` variant).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Default new-board name is `main`; helper key is `runkit-last-pinned-board` | Agreed in intake (Assumption 1/4); `ValidBoardName` accepts `main`; `runkit-*` prefix matches existing keys | S:95 R:90 A:95 D:95 |
| 2 | Confident | Cold-start = pre-filled selected input (not a one-click row) | Intake Assumption 2; keyboard-first, smallest diff, reuses `handleSubmitNew` | S:70 R:85 A:60 D:55 |
| 3 | Confident | Discoverability = dynamic `defaultOpen={boards.length > 0}` | Intake Assumption 3; `useLocalStorageBoolean` supports a dynamic default and stored toggles win natively | S:75 R:90 A:80 D:65 |
| 4 | Confident | Toast gains optional `action` as a THIRD positional arg `addToast(message, variant?, action?)` (not an options object) | Preserves all 74 existing positional call sites with zero churn; matches the existing `(message, variant?)` shape | S:75 R:85 A:80 D:70 |
| 5 | Confident | Last-used written once inside `usePinActions.pin`; ordering/Enter-target logic in `lib/last-pinned-board.ts` | Intake Assumption 5/6; single write site keeps entry points consistent; helper is unit-testable | S:70 R:90 A:80 D:70 |
| 6 | Confident | `orderBoardsLastUsedFirst` moves only the last-used board to the front, remaining boards keep their `boards`-prop order | Intake §1b ("remaining boards in existing display order"); minimal reorder, stale value filtered against live boards | S:70 R:90 A:80 D:70 |
| 7 | Confident | Palette labels `Pin: Current Window to <board>` + `Pin: Current Window to new board…`; inline `board-pin-current` removed | Intake Assumption 7; exclusion mirrors the "show the destination" palette pattern | S:65 R:90 A:70 D:60 |
| 8 | Confident | `↵` hint rendered on the last-used popover row only (input placeholder unchanged) | Intake Assumption 8; minor reversible microdesign | S:50 R:90 A:55 D:45 |
| 9 | Confident | PinIcon placement = BOARDS `headerRight`, outline variant, leading the count (also in hint mode) | Intake Assumption 9; `headerRight` is the existing extension point; `PinIcon` default is outline | S:60 R:95 A:70 D:60 |
| 10 | Confident | Palette pin actions gated on `sessionName && currentWindow && server` in AppShell `boardActions`; board-route mount unchanged | Intake Assumption 12; mirrors the removed inline action's gating | S:70 R:85 A:80 D:70 |
| 11 | Certain | Tests = colocated Vitest per changed module + extended `boards-pin-flow.spec.ts` with `.spec.md` companion updated in the same change | Constitution (Test Companion Docs) + code-quality.md mandate tests for changed behavior | S:90 R:90 A:95 D:90 |
| 12 | Confident | The e2e adds a palette direct-pin path (real backend POST + toast navigation) rather than a cold-start Enter-pins-to-`main` gesture; cold-start Enter→`main` is covered deterministically by `pin-popover.test.tsx` | Cold-start is fully unit-tested; a hover-gated popover e2e gesture is flaky in the SSE-driven environment (per the existing spec's own "popover gesture is unit-tested" note), while the palette path is the higher-value integration only e2e can cover | S:65 R:90 A:75 D:65 |

12 assumptions (2 certain, 10 confident, 0 tentative).
