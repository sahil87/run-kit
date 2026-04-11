# Quality Checklist: Optimistic Sidebar Window Reorder

**Change**: 260411-sl01-optimistic-sidebar-window-reorder
**Generated**: 2026-04-11
**Spec**: `spec.md`

## Functional Completeness
- [x] CHK-001 Optimistic index swap: `swapWindowOrder` action exists in window-store and swaps index values of two entries
- [x] CHK-002 Sidebar handleDrop uses useOptimisticAction: handleDrop calls optimistic swap, then API, with rollback on failure
- [x] CHK-003 SSE reconciliation: `setWindowsForSession` still replaces all entries (no regressions from new code)

## Behavioral Correctness
- [x] CHK-004 Drag-drop reorder shows immediate visual feedback (no ~2.5s wait)
- [x] CHK-005 API failure rolls back to original order and shows toast

## Scenario Coverage
- [x] CHK-006 Scenario: User drags window 0 to position 2 — covered by unit test
- [x] CHK-007 Scenario: Swap with no matching entries — covered by unit test (no-op)
- [x] CHK-008 Scenario: API failure rolls back — covered by sidebar test

## Edge Cases & Error Handling
- [x] CHK-009 No-op when source and target indices are the same (guard in handleDrop)
- [x] CHK-010 No-op when dragging across sessions (existing guard unchanged)

## Code Quality
- [x] CHK-011 Pattern consistency: Optimistic reorder follows the same `useOptimisticAction` + ref pattern as kill/rename
- [x] CHK-012 No unnecessary duplication: Reuses existing `useOptimisticAction` hook and `moveWindow` API client
- [x] CHK-013 No god functions: handleDrop remains concise after change
- [x] CHK-014 No magic strings: Error message consistent with existing toast patterns

## Notes

- Check items as you review: `- [x]`
- All items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] CHK-008 **N/A**: {reason}`
