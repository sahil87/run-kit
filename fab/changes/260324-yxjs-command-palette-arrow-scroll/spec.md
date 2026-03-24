# Spec: Command Palette Arrow Key Scroll

**Change**: 260324-yxjs-command-palette-arrow-scroll
**Created**: 2026-03-24
**Affected memory**: `docs/memory/run-kit/ui-patterns.md`

## Command Palette: Keyboard Navigation Scroll

### Requirement: Scroll-into-view on arrow key navigation

The Command Palette (`app/frontend/src/components/command-palette.tsx`) SHALL scroll the currently selected item into view whenever `selectedIndex` changes due to arrow key navigation.

The implementation SHALL use a `useRef<HTMLDivElement>` attached to the listbox container and a `useEffect` that queries for the `[aria-selected="true"]` element and calls `scrollIntoView({ block: "nearest" })`.

The `scrollIntoView({ block: "nearest" })` option SHALL be used to minimize scroll displacement — the container scrolls only when the selected item is outside the visible area.

#### Scenario: Arrow down past visible area
- **GIVEN** the Command Palette is open with more items than fit in the `max-h-64` container
- **WHEN** the user presses ArrowDown until the selected item is below the visible scroll area
- **THEN** the listbox container scrolls down so the selected item is visible

#### Scenario: Arrow up past visible area
- **GIVEN** the Command Palette is open, scrolled down, with the selection near the bottom
- **WHEN** the user presses ArrowUp until the selected item is above the visible scroll area
- **THEN** the listbox container scrolls up so the selected item is visible

#### Scenario: Selection within visible area
- **GIVEN** the Command Palette is open with the selected item already visible
- **WHEN** the user presses ArrowDown or ArrowUp
- **THEN** the selection moves but no scroll occurs (block: "nearest" is a no-op when already visible)

#### Scenario: Palette opens with selection at top
- **GIVEN** the Command Palette was previously scrolled
- **WHEN** the user reopens the palette (Cmd+K)
- **THEN** `selectedIndex` resets to 0 and the list starts at the top (existing behavior preserved)

### Requirement: Listbox ref attachment

The listbox container (`<div id={listId} role="listbox">`) SHALL have a `ref={listRef}` attribute where `listRef` is a `useRef<HTMLDivElement>(null)`.

#### Scenario: Ref available for scroll queries
- **GIVEN** the Command Palette is open
- **WHEN** the `useEffect` fires on `selectedIndex` change
- **THEN** `listRef.current` is the listbox DOM element and `querySelector('[aria-selected="true"]')` returns the selected option

### Requirement: No wrapping behavior change

The existing clamped navigation (ArrowDown stops at last item, ArrowUp stops at first item) SHALL NOT be changed. Wrap-around is out of scope.

#### Scenario: ArrowDown at last item
- **GIVEN** the last item in the filtered list is selected
- **WHEN** the user presses ArrowDown
- **THEN** the selection stays on the last item (no wrap to first)

### Requirement: Test coverage

A test SHALL verify that `scrollIntoView` is called on the selected element when `selectedIndex` changes via arrow key navigation.

#### Scenario: scrollIntoView called on ArrowDown
- **GIVEN** the Command Palette is open with items
- **WHEN** the user presses ArrowDown
- **THEN** `scrollIntoView({ block: "nearest" })` is called on the newly selected element

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Use `scrollIntoView({ block: "nearest" })` | Confirmed from intake #1 — established pattern in theme-selector.tsx, standard DOM API | S:90 R:95 A:95 D:95 |
| 2 | Certain | Add `listRef` to the listbox container | Confirmed from intake #2 — required for querying `aria-selected` elements | S:90 R:95 A:95 D:95 |
| 3 | Certain | Keep clamped navigation (no wrap-around) | Confirmed from intake #3 — description only mentions scroll, wrapping is separate | S:85 R:90 A:90 D:90 |
| 4 | Confident | No mouse-enter suppression needed | Confirmed from intake #4 — Command Palette has no hover-to-select during keyboard nav | S:75 R:90 A:80 D:85 |
| 5 | Certain | useEffect fires on `[selectedIndex, open]` | Matching theme-selector pattern exactly; both dependencies needed | S:90 R:95 A:95 D:95 |

5 assumptions (4 certain, 1 confident, 0 tentative, 0 unresolved).
