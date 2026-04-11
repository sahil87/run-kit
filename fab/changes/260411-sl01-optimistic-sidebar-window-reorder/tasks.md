# Tasks: Optimistic Sidebar Window Reorder

**Change**: 260411-sl01-optimistic-sidebar-window-reorder
**Spec**: `spec.md`
**Intake**: `intake.md`

## Phase 1: Core Implementation

- [x] T001 Add `swapWindowOrder(session, srcIndex, dstIndex)` action to `app/frontend/src/store/window-store.ts` — find two entries by session+index, swap their index values. No-op if either entry is missing.
- [x] T002 Wire optimistic reorder into `handleDrop` in `app/frontend/src/components/sidebar/index.tsx` — add `useOptimisticAction` hook with `swapWindowOrder` in `onOptimistic`, `moveWindow` API in `action`, reverse swap in `onAlwaysRollback`, toast in `onError`. Call `onSelectWindow` immediately after the optimistic swap.

## Phase 2: Tests

- [x] T003 [P] Add unit tests for `swapWindowOrder` in `app/frontend/src/store/window-store.test.ts` — verify swap updates indices correctly, no-op when entry missing, rollback (re-swap) restores original state.
- [x] T004 [P] Update sidebar drag-drop tests in `app/frontend/src/components/sidebar.test.tsx` — verify optimistic swap happens synchronously on drop (before API resolves), rollback on API failure restores original order.

---

## Execution Order

- T001 blocks T002 (store action must exist before sidebar wires it)
- T003 and T004 are independent of each other, can run in parallel after T001-T002