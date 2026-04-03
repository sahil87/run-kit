# Tasks: New Pane Inherits Current Working Directory

**Change**: 260403-xnq5-new-pane-inherit-cwd
**Spec**: `spec.md`
**Intake**: `intake.md`

## Phase 1: Core Implementation

- [x] T001 Pass `currentWindow?.worktreePath` as `cwd` to `createWindow()` in `handleCreateWindow` callback (`app/frontend/src/app.tsx:275-283`). Update `useCallback` dependency array to include `currentWindow`.

## Phase 2: Testing

- [x] T002 Add or update test for `handleCreateWindow` to verify `cwd` is passed through to `createWindow()` (`app/frontend/src/api/client.test.ts`).

---

## Execution Order

- T001 blocks T002
