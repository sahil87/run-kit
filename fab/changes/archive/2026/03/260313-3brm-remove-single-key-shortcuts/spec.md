# Spec: Remove Single-Key Keyboard Shortcuts

**Change**: 260313-3brm-remove-single-key-shortcuts
**Created**: 2026-03-13
**Affected memory**: `docs/memory/run-kit/ui-patterns.md`

## Non-Goals

- Changing the command palette (`Cmd+K`) — it stays as-is
- Modifying BottomBar modifier buttons — they stay for mobile
- Changing breadcrumb dropdown keyboard nav (ArrowUp/ArrowDown/Esc within dropdown)
- Changing compose buffer Esc / Cmd+Enter behavior

## Keyboard Navigation: Hook Removal

### Requirement: Remove `useKeyboardNav` hook

The `useKeyboardNav` hook (`app/frontend/src/hooks/use-keyboard-nav.ts`) and its test file (`app/frontend/src/hooks/use-keyboard-nav.test.ts`) SHALL be deleted. The hook provides `j`/`k`/`Enter` navigation and a `focusedIndex` state — all of which conflict with terminal input in xterm.js.

#### Scenario: Typing j/k in terminal no longer triggers sidebar navigation
- **GIVEN** the user has a terminal focused with xterm.js
- **WHEN** the user types `j` or `k`
- **THEN** only the terminal receives the keypress
- **AND** the sidebar does not scroll or change focus

### Requirement: Remove sidebar focus ring

The `Sidebar` component (`app/frontend/src/components/sidebar.tsx`) SHALL NOT accept a `focusedIndex` prop. All related state and rendering logic SHALL be removed:
- `focusedRef` ref
- `flatIndexMap` memo
- Scroll-into-view effect (keyed on `focusedIndex`)
- `isFocused` boolean derivation per window row
- `data-focused` attribute
- The `bg-bg-card/70 ring-1 ring-accent/50 border-transparent rounded` style branch (the blue focus ring)

Window row styling SHALL simplify to two states: `isSelected` (active highlight) and default (hover-only highlight).

#### Scenario: Sidebar window rows have two style states
- **GIVEN** the sidebar is rendered with sessions
- **WHEN** a window row is the currently selected window
- **THEN** it displays with `bg-accent/10 border-accent text-text-primary font-medium rounded-r`

#### Scenario: Non-selected window rows show default styling
- **GIVEN** the sidebar is rendered with sessions
- **WHEN** a window row is not the currently selected window
- **THEN** it displays with `text-text-secondary hover:text-text-primary hover:bg-bg-card/50 border-transparent rounded`
- **AND** there is no blue focus ring (`ring-accent/50`)

## App Shortcuts: Hook Removal

### Requirement: Remove `useAppShortcuts` hook

The `useAppShortcuts` hook (`app/frontend/src/hooks/use-app-shortcuts.ts`) SHALL be deleted. This removes:
- `c` → create session shortcut
- `r` → rename window shortcut
- `Esc Esc` → toggle drawer shortcut

#### Scenario: Typing c in terminal no longer opens create-session dialog
- **GIVEN** the user has a terminal focused with xterm.js
- **WHEN** the user types `c`
- **THEN** only the terminal receives the keypress
- **AND** no create-session dialog appears

#### Scenario: Typing r in terminal no longer opens rename dialog
- **GIVEN** the user has a terminal focused with xterm.js
- **WHEN** the user types `r`
- **THEN** only the terminal receives the keypress
- **AND** no rename dialog appears

### Requirement: Remove shortcut labels from palette actions

In `app/frontend/src/app.tsx`, the `paletteActions` array SHALL NOT include `shortcut: "c"` on the create-session action or `shortcut: "r"` on the rename-window action. These labels display in the command palette UI but the underlying shortcuts no longer exist.

#### Scenario: Command palette shows no shortcut hints for create/rename
- **GIVEN** the command palette is open
- **WHEN** the user views the "Create new session" and "Rename current window" actions
- **THEN** no shortcut label (e.g., "c" or "r") is displayed alongside them

## App Shell: Cleanup

### Requirement: Remove `navigateByIndex` callback and `useKeyboardNav` call from `app.tsx`

In `app/frontend/src/app.tsx`:
- The `useKeyboardNav` import SHALL be removed
- The `useAppShortcuts` import SHALL be removed
- The `navigateByIndex` callback SHALL be removed
- The `const { focusedIndex } = useKeyboardNav(...)` call SHALL be removed
- The `useAppShortcuts(...)` call SHALL be removed
- The `focusedIndex` prop SHALL NOT be passed to `<Sidebar>` (both desktop and drawer instances)

#### Scenario: App shell renders without keyboard nav hooks
- **GIVEN** the app shell is mounted
- **WHEN** it renders
- **THEN** no global `document` keydown listeners are registered for `j`/`k`/`c`/`r`/`Esc Esc`
- **AND** the sidebar receives no `focusedIndex` prop

### Requirement: Preserve `flatWindows` memo for palette actions

The `flatWindows` `useMemo` in `app.tsx` SHALL be preserved — it is used by the `paletteActions` array to generate terminal navigation entries in the command palette.

#### Scenario: Command palette still lists all terminal windows
- **GIVEN** multiple sessions with windows exist
- **WHEN** the user opens the command palette
- **THEN** all windows are listed as navigable "Terminal: session/window" actions

### Requirement: Update empty state text

The empty state text in `app.tsx` that currently says "No sessions. Press c to create one." SHALL be updated to remove the `c` shortcut reference, since the shortcut no longer exists. The text SHOULD reference the command palette or the `+ Session` button instead.
<!-- assumed: Replace with "No sessions" or similar — c shortcut removal makes current text misleading -->

#### Scenario: Empty state text does not reference removed shortcut
- **GIVEN** no tmux sessions exist
- **WHEN** the app shell renders the empty state
- **THEN** the text does not mention pressing `c`
- **AND** the text suggests using `+ Session` or `Cmd+K`

## Deprecated Requirements

### Requirement: `j`/`k`/`Enter` sidebar keyboard navigation
**Reason**: Conflicts with xterm.js terminal input — bare character keys fire on the global `document` listener even when the terminal is focused.
**Migration**: Use command palette (`Cmd+K`) to navigate to any terminal window.

### Requirement: `c` create-session shortcut
**Reason**: Same conflict — typing `c` in the terminal opens the create-session dialog.
**Migration**: Use `+ Session` button in top bar or command palette.

### Requirement: `r` rename-window shortcut
**Reason**: Same conflict — typing `r` in the terminal opens the rename dialog.
**Migration**: Use command palette or top bar Rename button.

### Requirement: `Esc Esc` drawer toggle
**Reason**: Interferes with terminal Escape key usage (vi modes, Ctrl+[, etc.).
**Migration**: Use logo button to toggle sidebar/drawer.

### Requirement: Sidebar focus ring (`focusedIndex`)
**Reason**: Only existed to support `j`/`k` navigation. Without it, the blue ring has no purpose.
**Migration**: N/A — visual indicator removed with no replacement needed.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Remove j/k/Enter sidebar navigation | Confirmed from intake #1 — user explicitly chose this | S:95 R:90 A:95 D:95 |
| 2 | Certain | Remove c and r single-key shortcuts | Confirmed from intake #2 — user explicitly chose this | S:95 R:90 A:95 D:95 |
| 3 | Certain | Remove Esc Esc drawer toggle | Confirmed from intake #3 — user explicitly chose this | S:95 R:85 A:90 D:95 |
| 4 | Certain | Keep Cmd+K command palette | Confirmed from intake #4 — sole shortcut mechanism | S:95 R:90 A:95 D:95 |
| 5 | Certain | Keep BottomBar modifier buttons | Confirmed from intake #5 — mobile primary interaction | S:95 R:90 A:95 D:95 |
| 6 | Certain | Delete useKeyboardNav hook entirely | Confirmed from intake #6 — verified no other consumers in codebase | S:95 R:85 A:95 D:95 |
| 7 | Certain | Remove shortcut labels from palette actions | Upgraded from intake Confident #7 — verified palette renders shortcut hints that would be misleading | S:90 R:95 A:90 D:90 |
| 8 | Certain | flatWindows useMemo stays (used by palette actions) | Upgraded from intake Confident #8 — verified `flatWindows` is consumed by `paletteActions` at line 285 | S:95 R:90 A:95 D:95 |
| 9 | Confident | Update empty state text to remove "Press c" reference | Discovered during spec — current text references removed shortcut | S:80 R:95 A:85 D:80 |

9 assumptions (8 certain, 1 confident, 0 tentative, 0 unresolved).
