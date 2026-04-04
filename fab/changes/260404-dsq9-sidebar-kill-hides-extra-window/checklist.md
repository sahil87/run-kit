# Quality Checklist: Sidebar Kill Hides Extra Window

**Change**: 260404-dsq9-sidebar-kill-hides-extra-window
**Generated**: 2026-04-04
**Spec**: `spec.md`

## Functional Completeness

- [ ] CHK-001 `executeKillWindow` (sidebar Ctrl+Click): `onSettled` added and calls `unmarkKilled(lastKillWindowRef.current)` when ref is non-null
- [ ] CHK-002 `executeKillFromDialog` (sidebar dialog): `onSettled` added and calls `unmarkKilled` using `killTargetRef.current`, with null guard
- [ ] CHK-003 `executeKillWindow` (use-dialog-state command palette): existing `onSettled` extended to call `unmarkKilled(lastKillWindowRef.current)` before nulling the ref

## Behavioral Correctness

- [ ] CHK-004 After a successful window kill, the killed entry is removed from `OptimisticContext.killed[]` so the next SSE update renders the renumbered window correctly
- [ ] CHK-005 On kill failure, `onRollback` still fires and `unmarkKilled` is called (no regression to existing rollback behaviour)

## Scenario Coverage

- [ ] CHK-006 Direct kill scenario: killing window N in a multi-window session does not hide the window that gets renumbered to index N
- [ ] CHK-007 Dialog kill scenario: same scenario via the confirmation dialog path
- [ ] CHK-008 Command palette kill scenario: same scenario via `use-dialog-state` path
- [ ] CHK-009 Null guard scenario: `executeKillFromDialog` `onSettled` does not throw when `killTargetRef.current` is null

## Edge Cases & Error Handling

- [ ] CHK-010 Single-window session: killing the only window (index 0) does not cause a phantom window to appear after `unmarkKilled` fires
- [ ] CHK-011 `onSettled` is not called on failure — failure path calls `onRollback` + `onError` only (verified from `use-optimistic-action.ts` inspection)

## Code Quality

- [ ] CHK-012 Pattern consistency: `onSettled` callbacks follow the same pattern as `onRollback` callbacks in the same `useOptimisticAction` instances (guard → unmark → null ref)
- [ ] CHK-013 No unnecessary duplication: no new utilities introduced — `unmarkKilled` is already available via `useOptimisticContext()` in each affected file
- [ ] CHK-014 Type narrowing: all `onSettled` closures use `if` guards rather than non-null assertions to access refs
- [ ] CHK-015 Tests added: `sidebar.test.tsx` and/or `optimistic-context.test.tsx` cover the new `onSettled` behaviour

## Notes

- All items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] CHK-NNN **N/A**: {reason}`
