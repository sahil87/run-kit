# Tasks: Sidebar Window State Zustand

**Change**: 260405-x3yt-sidebar-window-state-zustand
**Spec**: `spec.md`
**Intake**: `intake.md`

## Phase 1: Setup

- [ ] T001 Add `zustand` dependency to `app/frontend/package.json` via `pnpm add zustand` (run in `app/frontend/`)
- [ ] T002 [P] Add `windowId: string` to `WindowInfo` in `app/frontend/src/types.ts` (new non-optional field, first in the type)
- [ ] T003 [P] Add `WindowID string` field (`json:"windowId"`) to `WindowInfo` struct in `app/backend/internal/tmux/tmux.go`; prepend `"#{window_id}"` to the format string in `ListWindows()`; update `parseWindows()` to extract position 0 as `WindowID`, shift all other field indices up by 1, and require `len(parts) >= 7` (was `>= 6`)

## Phase 2: Core Implementation

- [ ] T004 Create `app/frontend/src/store/window-store.ts` with the full Zustand store implementing: `WindowEntry`, `GhostWindow`, `MergedWindow`, `WindowStore` types and all actions: `setWindowsForSession`, `addGhostWindow`, `removeGhost`, `killWindow`, `restoreWindow`, `renameWindow`, `clearRename`, `clearSession`. Ghost reconciliation uses `snapshotWindowIds` set-difference. Export `useWindowStore` hook. `MergedWindow` type is defined here (imported by `optimistic-context.tsx` for use in `useMergedSessions`).
- [ ] T005 Update `useMergedSessions` in `app/frontend/src/contexts/optimistic-context.tsx` to read window data from the Zustand window store instead of `session.windows` directly: for each real session, read `entry.killed === false` windows from the store sorted by index ascending, apply `pendingName ?? name`, then append ghost windows. Remove the `killedWindows` and `renamedWindows` map logic from the windows section. `MergedWindow` must include `windowId: string`.
- [ ] T006 [P] Remove window-specific methods from `OptimisticContext`: remove `addGhostWindow`, and remove the `"window"` type-handling branches from `markKilled`/`unmarkKilled`/`markRenamed`/`unmarkRenamed`. Update `OptimisticContextType` interface accordingly. Do NOT remove session or server handling.

## Phase 3: Integration & Edge Cases

- [ ] T007 Update `app/frontend/src/app.tsx`:
  - Add `useEffect` to call `windowStore.setWindowsForSession(s.name, s.windows)` for each session in `rawSessions` on every SSE update
  - Replace `addGhostWindow` / `removeGhost` usage (for window creates) with `windowStore.addGhostWindow(session, "zsh", currentIds)` and `windowStore.removeGhost(ghostId)`. Derive `currentIds` from `useWindowStore` state before the action fires.
  - Remove `addGhostWindow` from the `useOptimisticContext()` destructure
  - Keep `addGhostServer` and server kill/restore from `useOptimisticContext()` unchanged

- [ ] T008 Update `app/frontend/src/components/sidebar.tsx`:
  - Replace all `markKilled("window", ...)` calls with `windowStore.killWindow(session, win.windowId)`
  - Replace `unmarkKilled(...)` for windows with `windowStore.restoreWindow(session, windowId)` in `onAlwaysRollback` and `onAlwaysSettled`
  - Replace all `markRenamed("window", ...)` calls with `windowStore.renameWindow(session, win.windowId, newName)`
  - Replace `unmarkRenamed(...)` for windows with `windowStore.clearRename(session, windowId)`
  - Change `editingWindow` state type from `{ session: string; index: number }` to `{ session: string; windowId: string }`; update `handleStartEditing` to receive `windowId` instead of `index`; update the conditional that checks `editingWindow.index === win.index` to use `windowId`
  - Change `killTarget` state: replace `windowIndex?: number` with `windowId?: string`; update all usages
  - Remove `useOptimisticContext` import; add `useWindowStore` import
  - The API calls (`killWindowApi`, `renameWindow`) still receive `win.index` for the backend

- [ ] T009 Update `app/frontend/src/hooks/use-dialog-state.ts`:
  - Change `UseDialogStateOptions` from `windowIndex: number | undefined` to `windowId: string | undefined` (keep `windowIndex: number | undefined` as a separate field needed for the API call)
  - Replace `markKilled("window", ...)` with `windowStore.killWindow(session, windowId)`
  - Replace `unmarkKilled` for windows with `windowStore.restoreWindow`
  - Replace `markRenamed("window", ...)` with `windowStore.renameWindow`
  - Replace `unmarkRenamed` for windows with `windowStore.clearRename`
  - Remove `useOptimisticContext` import; add `useWindowStore` import

- [ ] T010 Audit `app/frontend/src/app.tsx` for any remaining uses of `currentWindow.index` in window navigation (prev/next window keyboard shortcuts and command palette actions). These use index for the API call (`moveWindow`) and for URL navigation — leave them as-is (index is still the correct tmux API parameter and URL scheme). Also wire up `clearSession`: call `windowStore.clearSession(sessionName)` when a session is confirmed killed (in the `executeKillSession` / `executeKillFromDialog` `onAlwaysSettled` callback, or when SSE delivers a session list that no longer includes a session name).

## Phase 4: Tests

- [ ] T011 Update `app/backend/internal/tmux/tmux_test.go`:
  - Update the `windowLine` helper to prepend `windowId string` as the first argument and include `windowId` as field 0 in the formatted string
  - Update all existing `TestParseWindows` test cases to pass a `windowId` argument (e.g., `"@1"`, `"@2"`) and assert `WindowID` on the result
  - Add new test cases: parse `@5` windowId correctly; verify `Index` still parses from new position 1; verify lines with < 7 fields are skipped

- [ ] T012 [P] Create `app/frontend/src/store/window-store.test.ts` with full unit test coverage:
  - Initial state empty
  - `setWindowsForSession`: basic upsert; `killed` preserved on SSE update; `pendingName` preserved on SSE update; window removed when absent from SSE
  - `killWindow` / `restoreWindow` round-trip; kill + SSE confirm removes entry
  - `renameWindow` / `clearRename` round-trip
  - `addGhostWindow` / ghost reconciliation via new windowId in SSE; ghost persists when no new windowId; `removeGhost` on failure
  - **Core regression test**: session with `@1`, `@2`, `@3` → kill `@2` → SSE delivers `@1`+`@3` (renumbered) → verify `@3` visible, `@2` absent, no false suppression

- [ ] T013 [P] Update `app/frontend/src/contexts/optimistic-context.test.tsx`:
  - Update `baseSessions` test data to include `windowId: string` in each `WindowInfo` (e.g., `windowId: "@1"`)
  - Remove window-specific test cases: kill window, rename window, ghost window reconciliation, and the renumbered-window regression test
  - Retain all session and server test cases unchanged
  - Remove `kill-window` and `rename-window` button handlers from `TestConsumer`

- [ ] T014 Run all tests to verify: `just test-backend` (Go tests) and `just test-frontend` (Vitest unit tests). Fix any TypeScript or test compilation errors.

---

## Execution Order

- T002, T003 are independent setup tasks — run in parallel after T001
- T004 (window store) is the core prerequisite — T005, T006, T007, T008, T009, T010 all depend on it
- T005 (useMergedSessions) depends on T004 (reads from window store)
- T006 (slim OptimisticContext) can run in parallel with T005 after T004 is done
- T007 (app.tsx) depends on T004 and T006
- T008 (sidebar.tsx) depends on T004
- T009 (use-dialog-state.ts) depends on T004
- T010 (audit app.tsx nav) depends on T007
- T011, T012, T013 (tests) depend on their respective implementation tasks completing
- T014 (run tests) is the final gate — depends on all prior tasks
