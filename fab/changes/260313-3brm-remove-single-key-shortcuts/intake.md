# Intake: Remove Single-Key Keyboard Shortcuts

**Change**: 260313-3brm-remove-single-key-shortcuts
**Created**: 2026-03-13
**Status**: Draft

## Origin

> Remove single-key keyboard shortcuts (j/k/c/r) and Esc Esc drawer toggle. These conflict with xterm.js terminal input — typing in the terminal triggers sidebar navigation, create-session dialog, etc. Only Cmd+K command palette survives. Also removes the blue focus ring (focusedIndex) from sidebar since it only existed for j/k navigation. BottomBar modifier buttons stay for mobile.

Conversational — user noticed the blue focus ring around a sidebar window item, we traced it to the `focusedIndex` / `useKeyboardNav` system, then discussed whether single-key shortcuts make sense in a terminal-centric tool. User decided to remove them entirely.

## Why

1. **Active bugs**: The global `document` keydown listeners in `useAppShortcuts` and `useKeyboardNav` only skip `INPUT`/`TEXTAREA`/`SELECT` elements. xterm.js renders into a plain `<div>`, so the guards don't catch it. This means typing `j`/`k` in the terminal also moves the sidebar focus ring, `c` opens create-session dialog, and `r` opens rename dialog — all silently alongside terminal input.

2. **Fundamental incompatibility**: run-kit is a terminal multiplexer where xterm.js is the primary interaction surface. Reserving bare single-character keys (`j`, `k`, `c`, `r`) for global shortcuts is incompatible with a tool where users type into terminals most of the time. Even fixing the focus detection wouldn't help — users would need to explicitly "exit" the terminal to use shortcuts, defeating the purpose of quick-access keys.

3. **Cmd+K already covers everything**: The command palette provides access to all actions (create session, rename, kill, navigate to any terminal) and doesn't conflict with terminal input because modifier-key combos pass through xterm.

## What Changes

### Remove `useKeyboardNav` hook and sidebar focus ring

- **Delete** `app/frontend/src/hooks/use-keyboard-nav.ts` and its test file `use-keyboard-nav.test.ts`
- **In `app/frontend/src/app.tsx`**: Remove import of `useKeyboardNav`, remove `focusedIndex` / `navigateByIndex` / `flatWindows` (only if solely used by keyboard nav), remove `focusedIndex` prop from `<Sidebar>` and `<TopBar>` if passed
- **In `app/frontend/src/components/sidebar.tsx`**: Remove `focusedIndex` from props, remove `focusedRef`, `flatIndexMap`, scroll-into-view effect, `isFocused` logic, `data-focused` attribute, and the `ring-1 ring-accent/50` style branch. Simplify to just `isSelected` vs default styling.

### Remove `useAppShortcuts` hook

- **Delete** `app/frontend/src/hooks/use-app-shortcuts.ts`
- **In `app/frontend/src/app.tsx`**: Remove import and `useAppShortcuts()` call. This removes:
  - `c` → create session
  - `r` → rename window
  - `Esc Esc` → toggle drawer

### Remove shortcut labels from palette actions

- **In `app/frontend/src/app.tsx`**: Remove `shortcut: "c"` from create-session palette action and `shortcut: "r"` from rename-window palette action. These display in the command palette UI but the underlying shortcuts no longer exist.

### What stays unchanged

- `Cmd+K` command palette (handled by `command-palette.tsx`)
- BottomBar modifier buttons for mobile (handled by `bottom-bar.tsx`)
- Arrow keys / Enter / Esc within command palette when open
- Compose buffer Esc / Cmd+Enter
- Breadcrumb dropdown keyboard nav (ArrowUp/ArrowDown/Esc within dropdown)

## Affected Memory

- `run-kit/ui-patterns`: (modify) Remove "Keyboard Shortcuts" section entries for j/k/Enter/c sidebar shortcuts and Esc Esc global shortcut. Keep Cmd+K. Update "Create Session Dialog" to remove `c` shortcut reference.

## Impact

- **Frontend only** — no backend changes
- **Files deleted**: `use-keyboard-nav.ts`, `use-keyboard-nav.test.ts`, `use-app-shortcuts.ts`
- **Files modified**: `app.tsx`, `sidebar.tsx`, `sidebar.test.tsx`
- **No API changes, no routing changes, no SSE changes**
- **Risk**: Low — removing functionality, not adding. All removed shortcuts are already broken (fire during terminal input).

## Open Questions

None — scope is clear and fully discussed.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Remove j/k/Enter sidebar navigation | Discussed — user explicitly chose this | S:95 R:90 A:95 D:95 |
| 2 | Certain | Remove c and r single-key shortcuts | Discussed — user explicitly chose this | S:95 R:90 A:95 D:95 |
| 3 | Certain | Remove Esc Esc drawer toggle | Discussed — user explicitly chose this | S:95 R:85 A:90 D:95 |
| 4 | Certain | Keep Cmd+K command palette | Discussed — user explicitly chose this as the sole shortcut | S:95 R:90 A:95 D:95 |
| 5 | Certain | Keep BottomBar modifier buttons | Discussed — user confirmed this is mobile primary interaction | S:95 R:90 A:95 D:95 |
| 6 | Certain | Delete useKeyboardNav hook entirely | No other consumers — only used by app.tsx for sidebar j/k nav | S:90 R:85 A:90 D:90 |
| 7 | Confident | Remove shortcut labels from palette actions | Palette displays "c" and "r" hints but shortcuts won't exist; showing them would be misleading | S:80 R:95 A:85 D:85 |
| 8 | Confident | flatWindows useMemo can be removed if only used by keyboard nav | Need to verify no other consumer during implementation | S:70 R:90 A:75 D:80 |

8 assumptions (6 certain, 2 confident, 0 tentative, 0 unresolved).
