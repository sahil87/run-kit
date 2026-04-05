# Tasks: Sidebar Kill Hides Extra Window

**Change**: 260404-dsq9-sidebar-kill-hides-extra-window
**Spec**: `spec.md`
**Intake**: `intake.md`

## Phase 1: Core Implementation

<!-- All three changes are independent — different instances in different files. -->

- [x] T001 [P] In `app/frontend/src/components/sidebar.tsx`, add `onSettled` to `executeKillWindow` (lines ~86–99) to call `unmarkKilled(lastKillWindowRef.current)` after a successful direct kill (Ctrl+Click path)
- [x] T002 [P] In `app/frontend/src/components/sidebar.tsx`, add `onSettled` to `executeKillFromDialog` (lines ~105–131) to call `unmarkKilled` for the targeted window/session using `killTargetRef.current`, guarded against null
- [x] T003 [P] In `app/frontend/src/hooks/use-dialog-state.ts`, extend the existing `onSettled` on `executeKillWindow` (lines ~132–148) to also call `unmarkKilled(lastKillWindowRef.current)` before nulling the ref

## Phase 2: Tests

- [x] T004 [P] Add a test to `app/frontend/src/components/sidebar.test.tsx` verifying that after a window kill succeeds, the killed entry is removed from the optimistic context (i.e., `unmarkKilled` is called on success)
- [x] T005 [P] Add a test to `app/frontend/src/contexts/optimistic-context.test.tsx` (or a new test file if needed) verifying that `useMergedSessions` renders the renumbered window correctly once the killed entry is cleared

---

## Execution Order

- T001, T002, T003 are independent and can run in parallel (different file locations)
- T004, T005 depend on T001–T003 being done (tests verify the fixed behaviour)
- T004 and T005 are independent of each other
