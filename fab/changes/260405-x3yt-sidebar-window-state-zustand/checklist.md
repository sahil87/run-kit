# Quality Checklist: Sidebar Window State Zustand

**Change**: 260405-x3yt-sidebar-window-state-zustand
**Generated**: 2026-04-05
**Spec**: `spec.md`

## Functional Completeness

- [ ] CHK-001 Backend WindowID field: `WindowInfo` struct in `tmux.go` has `WindowID string` with `json:"windowId"` tag; format string starts with `#{window_id}`; `parseWindows` reads position 0 as `WindowID` and requires `len(parts) >= 7`
- [ ] CHK-002 WindowInfo type: `app/frontend/src/types.ts` has `windowId: string` as non-optional first field on `WindowInfo`
- [ ] CHK-003 Zustand store created: `app/frontend/src/store/window-store.ts` exists and exports `useWindowStore`; all 8 actions present (`setWindowsForSession`, `addGhostWindow`, `removeGhost`, `killWindow`, `restoreWindow`, `renameWindow`, `clearRename`, `clearSession`)
- [ ] CHK-004 setWindowsForSession reconciles by windowId: merges windows using `windowId` as key, never `index`; preserves `killed` and `pendingName` on SSE update; removes entries absent from SSE; reconciles ghosts via `snapshotWindowIds` set-difference
- [ ] CHK-005 Kill/restore actions: `killWindow` sets `killed: true`; `restoreWindow` sets `killed: false`; both are no-ops for unknown windowIds
- [ ] CHK-006 Rename/clearRename actions: `renameWindow` sets `pendingName`; `clearRename` nulls `pendingName`
- [ ] CHK-007 Ghost reconciliation: `addGhostWindow` creates entry with `snapshotWindowIds`; `setWindowsForSession` removes ghost when new windowId appears; ghost persists when no new windowId; `removeGhost` removes by ghostId
- [ ] CHK-008 clearSession: removes all `windows` and `ghosts` entries for the session; entries for other sessions unaffected
- [ ] CHK-009 OptimisticContext slimmed: `addGhostWindow`, `"window"` branches in `markKilled`/`markRenamed`/`unmarkKilled`/`unmarkRenamed` are removed; session and server handling untouched
- [ ] CHK-010 useMergedSessions updated: reads window data from Zustand store; returns `killed: false` windows sorted by index; applies `pendingName ?? name`; appends ghost windows
- [ ] CHK-011 app.tsx SSE sync: `useEffect` calls `setWindowsForSession` for each session in `rawSessions`; `addGhostWindow`/`removeGhost` for window creates uses `windowStore`; `clearSession` wired for session deletion
- [ ] CHK-012 sidebar.tsx migrated: all window kill/rename actions use `windowId`; `editingWindow` state uses `windowId`; `killTarget` uses `windowId`; no `markKilled("window", ...)` or `markRenamed("window", ...)` calls remain
- [ ] CHK-013 use-dialog-state.ts migrated: window kill/rename actions use `windowStore`; no `markKilled("window", ...)` or `markRenamed("window", ...)` remain

## Behavioral Correctness

- [ ] CHK-014 Kill does not suppress renumbered window: killing window `@2` and receiving SSE with `@1`+`@3` does NOT hide `@3` (the core regression); verified by unit test in `window-store.test.ts`
- [ ] CHK-015 Kill marker cleared on SSE confirm: after `killWindow("dev", "@3")`, when `setWindowsForSession` delivers data without `@3`, the entry is fully removed from the store
- [ ] CHK-016 Rename survives SSE: after `renameWindow`, calling `setWindowsForSession` with the old name still shows `pendingName` (not reverted to SSE name)
- [ ] CHK-017 Ghost clears correctly: ghost disappears when `setWindowsForSession` delivers a windowId not in `snapshotWindowIds`; ghost stays when no new windowId
- [ ] CHK-018 API calls still use index: `killWindowApi`, `renameWindow`, `moveWindow` all called with `win.index` (not windowId); URL routing unchanged

## Removal Verification

- [ ] CHK-019 No `markKilled("window", ...)` calls: grep for `markKilled.*window` in frontend — should return 0 results
- [ ] CHK-020 No `markRenamed("window", ...)` calls: grep for `markRenamed.*window` in frontend — should return 0 results
- [ ] CHK-021 No index-based window kill keys: grep for `\`${session}:${.*index` in frontend — should return 0 results (the old `session:index` key pattern)
- [ ] CHK-022 `addGhostWindow` removed from OptimisticContext: the method is absent from `OptimisticContextType` interface and `OptimisticProvider` body
- [ ] CHK-023 `MergedWindow` no longer imported from `optimistic-context`: all consumers import it from `window-store.ts` or it is re-exported from `optimistic-context.tsx`

## Scenario Coverage

- [ ] CHK-024 Core regression test exists: `window-store.test.ts` has a test that kills `@2`, receives renumbered SSE, and verifies `@3` is visible with correct name
- [ ] CHK-025 Ghost reconciliation test exists: test in `window-store.test.ts` verifies ghost creates, SSE with new windowId resolves ghost, SSE without new windowId keeps ghost
- [ ] CHK-026 Kill rollback test exists: test verifies `killWindow` + `restoreWindow` restores visibility
- [ ] CHK-027 SSE reconciliation tests: backend `tmux_test.go` has test for `parseWindows` extracting `WindowID` from position 0 with correct index at position 1
- [ ] CHK-028 `optimistic-context.test.tsx` window tests removed: no test cases referencing `kill-window` or `rename-window` buttons; session/server tests still present

## Edge Cases & Error Handling

- [ ] CHK-029 Unknown windowId no-op: `killWindow`, `restoreWindow`, `renameWindow`, `clearRename` called with a windowId not in the store do not throw or corrupt state
- [ ] CHK-030 Multiple ghosts for same session: creating two windows quickly results in two ghosts; each resolves independently when its corresponding new windowId appears
- [ ] CHK-031 clearSession on non-existent session: no error thrown; store state unchanged
- [ ] CHK-032 parseWindows with < 7 fields: lines with fewer than 7 tab-separated fields are silently skipped (same as before but now 7 not 6)

## Code Quality

- [ ] CHK-033 Readability and maintainability: Zustand store actions are small, single-purpose functions; no god functions (>50 lines) in `window-store.ts` without clear justification
- [ ] CHK-034 Type narrowing over assertions: no `as` casts in the Zustand store or updated consumers; discriminated unions or type guards used where narrowing is needed
- [ ] CHK-035 Derive state from tmux — no polling: `setWindowsForSession` is driven by SSE updates, not by `setInterval`; no new polling introduced
- [ ] CHK-036 Tests for changed behavior: `window-store.test.ts` covers all new store actions; `tmux_test.go` covers `WindowID` parsing; no new code paths are untested
- [ ] CHK-037 No duplicated utilities: `useWindowStore` selector used consistently; no inline state logic duplicated across `sidebar.tsx`, `app.tsx`, `use-dialog-state.ts`
- [ ] CHK-038 No magic strings: `windowId` values from tmux (`@N`) are passed through as-is; no string formatting of window keys in consumers (the `session:index` pattern is gone)
- [ ] CHK-039 Pattern consistency: Zustand store follows React 19 patterns; `useWindowStore` hook used with selector where appropriate; no `useStore(store, selector)` deprecated patterns

## Notes

- Check items as you review: `- [x]`
- All items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] CHK-NNN **N/A**: {reason}`
