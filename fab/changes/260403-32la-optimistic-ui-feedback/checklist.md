# Quality Checklist: Optimistic UI Feedback

**Change**: 260403-32la-optimistic-ui-feedback
**Generated**: 2026-04-03
**Spec**: `spec.md`

## Functional Completeness

- [x] CHK-001 useOptimisticAction hook: Exported from `use-optimistic-action.ts` with correct TypeScript signature (generic TArgs, optional callbacks, returns execute + isPending)
- [x] CHK-002 Toast system: ToastProvider + Toast component render error/info toasts in bottom-right, auto-dismiss after 4s, stacked
- [x] CHK-003 OptimisticProvider: Context provides addGhostSession/addGhostWindow/addGhostServer (refined from spec's generic addGhost), removeGhost, markKilled, markRenamed, and useMergedSessions
- [x] CHK-004 Ghost session entries: Create session inserts ghost with opacity-50 animate-pulse, SSE reconciles, failure rolls back + toast
- [x] CHK-005 Ghost window entries: Create window inserts ghost, same lifecycle as sessions
- [ ] CHK-006 Optimistic kill: Kill session/window/server removes entry immediately, failure restores + toast — **FAIL: Ctrl+click kill in sidebar.tsx has empty onRollback for both executeKillSession and executeKillWindow; unmarkKilled is never called on failure**
- [ ] CHK-007 Optimistic rename: Rename session/window updates name immediately, failure reverts + toast — **FAIL: Sidebar inline rename (executeRenameWindow) has empty onRollback; unmarkRenamed is never called on failure**
- [x] CHK-008 Server CRUD: Ghost server cards on create, immediate removal on kill, both with rollback
- [x] CHK-009 Button loading: SplitButton and ClosePaneButton show spinner + disabled during isPending
- [x] CHK-010 Config reload feedback: Info toast on success, error toast on failure
- [x] CHK-011 File upload indicator: "Uploading..." badge renders when uploading is true
- [x] CHK-012 Directory autocomplete spinner: Spinner visible in path input while fetching suggestions
- [x] CHK-013 Server list refresh spinner: Spinner on dropdown trigger during re-fetch

## Behavioral Correctness

- [x] CHK-014 SSE remains source of truth: Optimistic state is UI-only overlay, SSE data always wins
- [x] CHK-015 CreateSessionDialog retains inline errors: Existing error display preserved alongside ghost entry
- [ ] CHK-016 All .catch(() => {}) sites migrated: No remaining fire-and-forget patterns without useOptimisticAction — **FAIL: Command palette split/close actions in app.tsx (lines 468, 475, 482) still use .catch(() => {})**

## Scenario Coverage

- [x] CHK-017 Create session optimistic flow: Ghost appears, SSE reconciles, ghost cleared
- [x] CHK-018 Create session failure rollback: Ghost removed, error toast shown
- [x] CHK-019 Kill session optimistic flow: Entry removed immediately, SSE confirms
- [ ] CHK-020 Kill session failure rollback: Entry reappears, error toast shown — **FAIL: Ctrl+click kill path has no rollback (see CHK-006). Dialog-based kill path works correctly.**
- [x] CHK-021 Split pane button feedback: Spinner shown during isPending, restores after
- [x] CHK-022 Unmounted component safety: No state-after-unmount warnings when component unmounts during pending

## Edge Cases & Error Handling

- [x] CHK-023 Multiple concurrent toasts: Two+ toasts stack vertically, each dismisses independently
- [x] CHK-024 Theme change during toast: Toast colors update reactively via CSS custom properties
- [x] CHK-025 Rapid create/kill: Creating then immediately killing (or vice versa) doesn't corrupt optimistic state

## Code Quality

- [x] CHK-026 Pattern consistency: New code follows existing naming and structural patterns (hooks in hooks/, components in components/, contexts in contexts/)
- [x] CHK-027 No unnecessary duplication: useOptimisticAction reused across all mutation sites, not reimplemented
- [ ] CHK-028 Type narrowing over assertions: No `as` casts in new code — **SHOULD-FIX: `as MergedWindow` casts in sidebar.tsx (lines 277, 280) and dashboard.tsx (lines 93, 97), guarded by `"optimistic" in win` but could use type guard function instead**
- [x] CHK-029 No magic strings: Error messages and toast variants use named constants where repeated
- [x] CHK-030 No inline tmux command construction: No backend changes (verify)
- [x] CHK-031 No polling from client: No setInterval + fetch patterns added

## Notes

- Check items as you review: `- [x]`
- All items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] CHK-008 **N/A**: {reason}`
