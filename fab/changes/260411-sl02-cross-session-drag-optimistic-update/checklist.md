# Quality Checklist: Cross-Session Drag Optimistic Update

**Change**: 260411-sl02-cross-session-drag-optimistic-update
**Generated**: 2026-04-11
**Spec**: `spec.md`

## Functional Completeness
- [ ] CHK-001 Extend drag data payload: `handleDragStart` includes `windowId` and `name` in JSON
- [ ] CHK-002 handleSessionDrop uses useOptimisticAction: hook instance wired with correct lifecycle callbacks
- [ ] CHK-003 Ghost window uses source window name: `addGhostWindow` called with source window's display name, not placeholder
- [ ] CHK-004 Remove onMoveWindowToSession prop: `SidebarProps` no longer includes it, `app.tsx` no longer passes it
- [ ] CHK-005 SSE reconciliation: no new reconciliation code added — existing `setWindowsForSession` handles cleanup

## Behavioral Correctness
- [ ] CHK-006 Optimistic removal: window disappears from source session sidebar immediately on drop
- [ ] CHK-007 Optimistic insertion: ghost window appears in target session sidebar immediately on drop
- [ ] CHK-008 Navigation: user navigated to `/$server` immediately on drop (not after API response)
- [ ] CHK-009 Rollback on failure: window reappears in source, ghost removed from target, error toast shown

## Scenario Coverage
- [ ] CHK-010 Successful cross-session drag: drop from session A to session B — immediate visual feedback, API fires in background
- [ ] CHK-011 API failure rollback: simulated failure — source restored, ghost removed, toast shown
- [ ] CHK-012 Same-session drop ignored: dropping on own session header is no-op
- [ ] CHK-013 Within-session reorder unaffected: existing `handleDrop` still works with extended drag data

## Edge Cases & Error Handling
- [ ] CHK-014 Component unmount during pending: `onAlwaysRollback` runs even if sidebar unmounts (not `onRollback`)
- [ ] CHK-015 SSE arrives before API response: store correctly reconciles (killed entry removed from source, ghost claimed in target)

## Code Quality
- [ ] CHK-016 Pattern consistency: hook instance follows same structure as existing `executeKillWindow`, `executeSwapOrder` instances
- [ ] CHK-017 No unnecessary duplication: reuses existing store actions, no new store actions added
- [ ] CHK-018 Type narrowing over assertions: drag data parsing uses try/catch, not `as` cast
- [ ] CHK-019 No duplicating existing utilities: `moveWindowToSession` imported from `@/api/client`, not re-implemented

## Notes

- Check items as you review: `- [x]`
- All items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] CHK-008 **N/A**: {reason}`
