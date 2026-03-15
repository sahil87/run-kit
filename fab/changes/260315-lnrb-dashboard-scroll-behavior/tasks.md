# Tasks: Per-Region Scroll Behavior

**Change**: 260315-lnrb-dashboard-scroll-behavior
**Spec**: `spec.md`
**Intake**: `intake.md`

## Phase 1: Core Implementation

- [x] T001 [P] Activate fullbleed class in `useVisualViewport` hook — add `document.documentElement.classList.add("fullbleed")` in the initial sync block and `classList.remove("fullbleed")` in the cleanup function in `app/frontend/src/hooks/use-visual-viewport.ts`
- [x] T002 [P] Restructure Dashboard layout — split the outer `<div className="flex-1 overflow-y-auto p-4 sm:p-6">` into a flex column wrapper (`flex-1 flex flex-col`) with two children: (1) pinned stats line (`shrink-0 px-4 sm:px-6 pt-4 sm:pt-6`) and (2) scrollable card area (`flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 pb-4 sm:pb-6`) in `app/frontend/src/components/dashboard.tsx`

## Phase 2: Testing

- [x] T003 [P] Update Dashboard tests if any assertions break due to container structure change in `app/frontend/src/components/dashboard.test.tsx`
- [x] T004 [P] Run full test suite — `cd app/frontend && npx vitest run` and `cd app/backend && go test ./...` — fix any failures

## Execution Order

- T001 and T002 are independent (different files), can run in parallel
- T003 and T004 depend on T001+T002 being complete
