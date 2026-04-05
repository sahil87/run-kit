# Quality Checklist: Left Panel Window Sync

**Change**: 260405-2a2k-left-panel-window-sync
**Generated**: 2026-04-05
**Spec**: `spec.md`

## Functional Completeness

- [ ] CHK-001 REQ-1 (`onSettled` always fires): `onSettled` is called before `mountedRef.current` check in the success path of `use-optimistic-action.ts`
- [ ] CHK-002 REQ-2 (`onRollback` always fires): `onRollback` is called before `mountedRef.current` check in the error path
- [ ] CHK-003 REQ-3 (`setIsPending` guarded): `setIsPending(false)` still gated behind `!mountedRef.current` check on both paths
- [ ] CHK-004 REQ-4 (`onError` guarded): `onError` still gated behind `!mountedRef.current` check on error path

## Behavioral Correctness

- [ ] CHK-005 Updated unit tests match new contract: "skips state updates after unmount" test verifies `onSettled` IS called, `setIsPending` is NOT called; "skips rollback/error callbacks after unmount" verifies `onRollback` IS called, `onError`/`setIsPending` are NOT called
- [ ] CHK-006 Old behavior preserved when mounted: on success, `onSettled` + `setIsPending` both called; on error, `onRollback` + `onError` + `setIsPending` all called (existing passing tests cover this)

## Scenario Coverage

- [ ] CHK-007 Scenario 1 (external new-window): E2E test creates window externally via `tmux -L rk-e2e new-window`, asserts sidebar shows new window within 5000ms without page reload
- [ ] CHK-008 Scenario 2 (external rename): E2E test renames window externally via `tmux -L rk-e2e rename-window`, asserts new name appears within 5000ms without page reload
- [ ] CHK-009 Scenario 3 (kill-then-create at same index): E2E test kills window via sidebar, creates replacement window externally, asserts replacement appears and killed window is gone

## Code Quality

- [ ] CHK-010 Pattern consistency: new E2E spec follows `TMUX_SERVER = process.env.E2E_TMUX_SERVER ?? "rk-e2e"` pattern; uses `execSync` for tmux commands; follows `beforeAll`/`afterAll` cleanup structure
- [ ] CHK-011 No duplicated test sessions: E2E test uses unique timestamped session name (`e2e-sync-${Date.now()}`) to avoid collisions with parallel test runs
- [ ] CHK-012 Cleanup enforced: `afterAll` kills the test session via `tmux -L rk-e2e kill-session -t <session>`

## Notes

- Check items as you review: `- [x]`
- All items must pass before hydrate
- If not applicable, mark `- [x] CHK-NNN **N/A**: {reason}`
