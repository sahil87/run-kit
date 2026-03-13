# Tasks: Remove Single-Key Keyboard Shortcuts

**Change**: 260313-3brm-remove-single-key-shortcuts
**Spec**: `spec.md`
**Intake**: `intake.md`

## Phase 1: Delete Hook Files

- [x] T001 [P] Delete `app/frontend/src/hooks/use-keyboard-nav.ts` and `app/frontend/src/hooks/use-keyboard-nav.test.ts`
- [x] T002 [P] Delete `app/frontend/src/hooks/use-app-shortcuts.ts`

## Phase 2: Core Cleanup

- [x] T003 In `app/frontend/src/app.tsx`: Remove `useKeyboardNav` and `useAppShortcuts` imports, remove `useAppShortcuts(...)` call, remove `navigateByIndex` callback, remove `const { focusedIndex } = useKeyboardNav(...)` call, remove `focusedIndex` prop from both `<Sidebar>` instances (desktop and drawer). Remove `shortcut: "c"` from create-session palette action and `shortcut: "r"` from rename-window palette action. Update empty state text from "No sessions. Press c to create one." to "No sessions. Use + Session or Cmd+K."
- [x] T004 In `app/frontend/src/components/sidebar.tsx`: Remove `focusedIndex` from `SidebarProps` type and destructured props. Remove `focusedRef` ref, `flatIndexMap` memo, scroll-into-view effect, `isFocused` derivation, `data-focused` attribute, and the `isFocused` style branch (`bg-bg-card/70 ring-1 ring-accent/50`). Simplify window row className to two states: `isSelected` and default.

## Phase 3: Test Updates

- [x] T005 In `app/frontend/src/components/sidebar.test.tsx`: Remove `focusedIndex` from any test rendering if present. Verify existing tests pass with the simplified sidebar props.
- [x] T006 Run `cd app/frontend && npx vitest run` to verify all frontend tests pass. Run `cd app/frontend && npx tsc --noEmit` to verify type check passes.

---

## Execution Order

- T001 and T002 are independent (parallel)
- T003 depends on T001 and T002 (imports removed files)
- T004 is independent of T003 (different file)
- T005 depends on T004 (sidebar props changed)
- T006 depends on T003, T004, T005 (full verification)
