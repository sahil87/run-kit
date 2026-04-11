# Tasks: Cross-Session Drag Optimistic Update

**Change**: 260411-sl02-cross-session-drag-optimistic-update
**Spec**: `spec.md`
**Intake**: `intake.md`

## Phase 1: Setup

- [x] T001 Extend drag data payload to include `windowId` and `name` in `app/frontend/src/components/sidebar/index.tsx` — update `handleDragStart` to add `windowId` and `name` to the JSON payload, update `handleDrop` and `handleSessionDrop` to parse the extended payload

## Phase 2: Core Implementation

- [x] T002 Wire `useOptimisticAction` for cross-session drop in `app/frontend/src/components/sidebar/index.tsx` — add a new hook instance with `onOptimistic` (killWindow + addGhostWindow + navigate), `action` (moveWindowToSession API), `onAlwaysRollback` (restoreWindow + removeGhost), `onError` (toast). Store `optimisticId` in a ref for rollback. Replace the `onMoveWindowToSession` call in `handleSessionDrop` with `execute()`
- [x] T003 Import `moveWindowToSession` from `@/api/client` in sidebar, import `useWindowStore` actions (`killWindow`, `restoreWindow`, `addGhostWindow`, `removeGhost`), and import `navigate` from the router. Remove `onMoveWindowToSession` from `SidebarProps` interface

## Phase 3: Integration & Edge Cases

- [x] T004 Remove `handleMoveWindowToSession` callback from `app/frontend/src/app.tsx` and remove the `onMoveWindowToSession` prop from the `<Sidebar>` usage
- [x] T005 Add unit tests in `app/frontend/src/components/sidebar/sidebar.test.tsx` (or colocated test file) covering: successful cross-session drop triggers killWindow + addGhostWindow, API failure triggers restoreWindow + removeGhost + toast, drop on same session is no-op

---

## Execution Order

- T001 blocks T002 (drag data must include windowId/name before the hook can use them)
- T003 is parallel with T002 (imports can be wired alongside hook logic)
- T004 depends on T002+T003 (remove prop only after sidebar handles move internally)
- T005 depends on T002+T003+T004 (tests validate final wiring)
