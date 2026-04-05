# Quality Checklist: New Pane Inherits Current Working Directory

**Change**: 260403-xnq5-new-pane-inherit-cwd
**Generated**: 2026-04-03
**Spec**: `spec.md`

## Functional Completeness
- [x] CHK-001 New windows inherit active pane CWD: `handleCreateWindow` passes `currentWindow?.worktreePath` to `createWindow()`
- [x] CHK-002 `useCallback` deps updated: dependency array includes `currentWindow`

## Behavioral Correctness
- [x] CHK-003 Fallback preserved: when `currentWindow` is null, `cwd` is `undefined` and backend default applies

## Scenario Coverage
- [x] CHK-004 Sidebar "+" button routes through updated `handleCreateWindow`
- [x] CHK-005 Top bar "Create window" routes through updated `handleCreateWindow`
- [x] CHK-006 Cmd+K palette "Window: Create" routes through updated `handleCreateWindow`

## Code Quality
- [x] CHK-007 Pattern consistency: change follows existing `useCallback` patterns in the same file
- [x] CHK-008 No unnecessary duplication: uses existing `currentWindow` memo, no new state

## Notes

- Check items as you review: `- [x]`
- All items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] CHK-008 **N/A**: {reason}`
