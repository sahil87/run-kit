# Tasks: Sidebar Component Decomposition

**Change**: 260405-f8p9-sidebar-component-decomposition
**Spec**: `spec.md`
**Intake**: `intake.md`

## Phase 1: Setup

- [x] T001 Create `app/frontend/src/components/sidebar/` directory (empty) to establish the new module root

## Phase 2: Core Implementation

- [x] T002 Extract `KillDialog` to `app/frontend/src/components/sidebar/kill-dialog.tsx` — standalone presentational component using `<Dialog>` from `@/components/dialog`; accepts `killTarget`, `onConfirm`, `onCancel` props
- [x] T003 [P] Extract `ServerSelector` to `app/frontend/src/components/sidebar/server-selector.tsx` — owns `serverDropdownOpen`, `refreshingServers`, `serverDropdownRef`, and outside-click `useEffect` internally; accepts `server`, `servers`, `onSwitchServer`, `onCreateServer`, `onRefreshServers` props
- [x] T004 [P] Extract `WindowRow` to `app/frontend/src/components/sidebar/window-row.tsx` — pure presentational; accepts all window rendering, drag-and-drop, inline rename, and kill props; calls `isGhostWindow` and `getWindowDuration` internally
- [x] T005 Extract `SessionRow` to `app/frontend/src/components/sidebar/session-row.tsx` — pure presentational; accepts session data, collapsed/drag/editing state, and all event handler props; renders chevron, session name (with inline rename input), +window, and ✕kill buttons
- [x] T006 Create `app/frontend/src/components/sidebar/index.tsx` — orchestrator; contains all state (`collapsed`, `killTarget`, `editingWindow`, `editingSession`, `dragSource`, `dropTarget`, `sessionDropTarget`), all refs, all `useOptimisticAction` hooks, and all handler functions; composes `SessionRow`, `WindowRow`, `ServerSelector`, `KillDialog`; exports `Sidebar` and `SidebarProps`

## Phase 3: Integration & Edge Cases

- [x] T007 Delete `app/frontend/src/components/sidebar.tsx` — remove the original monolithic file after `sidebar/index.tsx` is verified
- [x] T008 Verify `app/frontend/src/components/sidebar.test.tsx` — check if any import paths need updating (e.g., type imports for `SidebarProps`); update import paths only if needed, no test logic changes
- [x] T009 Run `cd app/frontend && npx tsc --noEmit` — confirm zero TypeScript errors across all sidebar sub-components and consumers
- [x] T010 Run `just test-frontend` — confirm all tests in `sidebar.test.tsx` pass with no regressions

---

## Execution Order

- T002, T003, T004 are parallelizable (independent files, no shared dependencies)
- T005 has no dependency on T002/T003/T004 but SessionRow renders no sub-components itself — can run in parallel
- T006 depends on T002, T003, T004, T005 all being complete (it imports all four)
- T007 depends on T006 (delete original only after orchestrator is complete)
- T008 depends on T007 (check test imports only after original file is removed)
- T009 depends on T008
- T010 depends on T009
