# Quality Checklist: Remove Single-Key Keyboard Shortcuts

**Change**: 260313-3brm-remove-single-key-shortcuts
**Generated**: 2026-03-13
**Spec**: `spec.md`

## Functional Completeness
- [x] CHK-001 useKeyboardNav hook deleted: `app/frontend/src/hooks/use-keyboard-nav.ts` no longer exists
- [x] CHK-002 useKeyboardNav test deleted: `app/frontend/src/hooks/use-keyboard-nav.test.ts` no longer exists
- [x] CHK-003 useAppShortcuts hook deleted: `app/frontend/src/hooks/use-app-shortcuts.ts` no longer exists
- [x] CHK-004 Shortcut labels removed: no `shortcut: "c"` or `shortcut: "r"` in palette actions
- [x] CHK-005 Empty state text updated: no reference to "Press c" in app.tsx

## Behavioral Correctness
- [x] CHK-006 No global keydown listeners for j/k/c/r/Esc Esc: grep for `useKeyboardNav` and `useAppShortcuts` returns zero results in `app/frontend/src/`
- [x] CHK-007 Cmd+K command palette still works: CommandPalette component and its registration unchanged

## Removal Verification
- [x] CHK-008 focusedIndex prop removed from Sidebar: prop not in SidebarProps type, not passed from app.tsx
- [x] CHK-009 Focus ring styles removed: no `ring-accent/50` or `data-focused` in sidebar.tsx
- [x] CHK-010 flatIndexMap removed from sidebar: no `flatIndexMap` in sidebar.tsx
- [x] CHK-011 focusedRef removed from sidebar: no `focusedRef` in sidebar.tsx
- [x] CHK-012 navigateByIndex removed from app.tsx: callback no longer exists

## Scenario Coverage
- [x] CHK-013 Sidebar renders with two style states: isSelected and default (no isFocused branch)
- [x] CHK-014 Palette actions list all terminals without shortcut hints on create/rename

## Code Quality
- [x] CHK-015 Pattern consistency: remaining code follows existing naming and structural patterns
- [x] CHK-016 No unnecessary duplication: no dead imports or unused variables left behind
- [x] CHK-017 No stale references: no imports of deleted hook files anywhere in `app/frontend/src/`

## Notes

- Check items as you review: `- [x]`
- All items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] CHK-008 **N/A**: {reason}`
