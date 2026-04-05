# Tasks: Left Panel Window Sync

**Change**: 260405-2a2k-left-panel-window-sync

## Tasks

- [ ] T1: Fix `use-optimistic-action.ts` — move `onSettled` and `onRollback` before `mountedRef` guard
- [ ] T2: Update unit tests in `app/frontend/src/hooks/use-optimistic-action.test.ts` — revise "skips state updates after unmount" and "skips rollback/error callbacks after unmount" to assert the new behavior: `onSettled` fires after unmount on success; `onRollback` fires after unmount on failure; `setIsPending` and `onError` still do not fire after unmount <!-- clarified: two existing unit tests encode the old (buggy) behavior and will fail after T1; they must be updated to match the fix before T3 can pass -->
- [ ] T3: Add E2E test file `app/frontend/tests/e2e/sidebar-window-sync.spec.ts` with scenarios 1, 2, and 3 <!-- clarified: full path added from spec.md; kill button selector is `aria-label="Kill window {name}"` per sidebar.tsx:461; confirmation dialog Kill button is `button:has-text('Kill')` per existing api-integration.spec.ts pattern -->
- [ ] T4: Run existing test suites to confirm no regressions — `use-optimistic-action.test.ts` (after T2 updates), `optimistic-context.test.tsx` unit tests, and existing E2E suite

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | SSE polling (2500ms) is the real-time update path | Observable in `session-context.tsx` | S:5 R:5 A:5 D:5 |
| 2 | Certain | Page refresh works because `addClient` sends `previousJSON` immediately | Observable in `sse.go` | S:5 R:5 A:5 D:5 |
| 3 | Certain | E2E suite uses port 3333 (`RK_PORT`) and server `rk-e2e` (`E2E_TMUX_SERVER`) | Confirmed in `playwright.config.ts` and all existing E2E specs | S:5 R:5 A:5 D:5 |
| 4 | Certain | E2E test uses `execSync("tmux -L rk-e2e new-window ...")` and 5000ms assertion timeout | Consistent with existing E2E patterns; covers ≥2 poll cycles at 2500ms interval | S:5 R:5 A:5 D:5 |
| 5 | Certain | Root cause: `use-optimistic-action.ts` skips `onSettled`/`onRollback` when component unmounts, leaving stale `killed` entries | Code-confirmed: `if (!mountedRef.current) return` gates both callbacks | S:5 R:5 A:5 D:5 |
| 6 | Certain | Fix: move `onSettled` and `onRollback` before the `mountedRef` guard; keep `setIsPending` and `onError` behind it | `onSettled`/`onRollback` only mutate root-level OptimisticContext (always mounted); `setIsPending` is local state | S:5 R:5 A:5 D:5 |
| 7 | Certain | Two existing unit tests in `use-optimistic-action.test.ts` assert old behavior and must be updated: "skips state updates after unmount" (expects `onSettled` NOT called) and "skips rollback/error callbacks after unmount" (expects `onRollback` NOT called) | Code-confirmed: both tests use `expect(...).not.toHaveBeenCalled()` after unmount — directly contradicts the fix | S:95 R:5 A:5 D:5 |
| 8 | Certain | Kill window button selector: `aria-label="Kill window {name}"` (sidebar.tsx:461); confirmation: `button:has-text('Kill')` | Confirmed in sidebar.tsx and api-integration.spec.ts kill flow | S:95 R:5 A:5 D:5 |
| 9 | Confident | This is a regression from a recent change | User said "no longer in sync"; `use-optimistic-action` was modified in a recent PR | S:4 R:4 A:4 D:4 |
| 10 | Tentative | Scenario 3 (kill-then-create at same index) is the primary real-world trigger | tmux reuses window indices after kill; the user's `wt create` workflow typically creates windows right after kill | S:3 R:4 A:3 D:3 |

10 assumptions (8 certain, 1 confident, 1 tentative, 0 unresolved).

## Clarifications

### Session 2026-04-05 (auto)

| # | Action | Detail |
|---|--------|--------|
| new-T2 | Resolved — added task | Two existing unit tests in `use-optimistic-action.test.ts` assert old (buggy) behavior; will fail after T1 unless updated. Added explicit task to revise them. |
| T2→T3 | Resolved — file path clarified | Added full path `app/frontend/tests/e2e/sidebar-window-sync.spec.ts` from spec.md; also embedded kill button and confirmation selectors from sidebar.tsx and api-integration.spec.ts. |
| T3→T4 | Resolved — task renamed/scoped | Old T3 renamed T4; scoped to run after T2 updates so unit test run is valid. |
