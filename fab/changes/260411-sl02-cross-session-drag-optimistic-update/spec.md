# Spec: Cross-Session Drag Optimistic Update

**Change**: 260411-sl02-cross-session-drag-optimistic-update
**Created**: 2026-04-11
**Affected memory**: `docs/memory/run-kit/ui-patterns.md`

## Non-Goals

- Backend/API changes — the `moveWindowToSession` endpoint works correctly, this is frontend-only
- New window store actions — all required actions (`killWindow`, `restoreWindow`, `addGhostWindow`, `removeGhost`) already exist

## Sidebar: Optimistic Cross-Session Window Move

### Requirement: Extend drag data payload

The drag data set on `dragstart` for window rows SHALL include `windowId` and `name` in addition to the existing `session` and `index` fields. The payload format SHALL be:

```typescript
{ session: string; index: number; windowId: string; name: string }
```

This data is written to `e.dataTransfer` as `application/json` in `handleDragStart` and read in `handleDrop` and `handleSessionDrop`.

#### Scenario: Drag data includes windowId and name
- **GIVEN** a window row for window "@1" named "zsh" at index 0 in session "alpha"
- **WHEN** the user starts dragging the window row
- **THEN** the drag data SHALL contain `{ session: "alpha", index: 0, windowId: "@1", name: "zsh" }`

#### Scenario: Existing within-session drop still works
- **GIVEN** drag data with `{ session: "alpha", index: 0, windowId: "@1", name: "zsh" }`
- **WHEN** the user drops onto another window position within the same session
- **THEN** the existing `handleDrop` logic SHALL use `session` and `index` as before
- **AND** the added `windowId` and `name` fields SHALL be ignored by within-session reorder

### Requirement: handleSessionDrop uses useOptimisticAction

The `handleSessionDrop` function in `sidebar/index.tsx` SHALL use a `useOptimisticAction` hook instance to wire the cross-session move lifecycle. This replaces the current fire-and-forget call to `onMoveWindowToSession`.

The hook configuration SHALL:
- `onOptimistic(srcSession, srcIndex, windowId, windowName, dstSession)`:
  1. Call `killWindow(srcSession, windowId)` to hide the window from the source session
  2. Call `addGhostWindow(dstSession, windowName)` and store the returned `optimisticId` in a ref for rollback
  3. Navigate to `/$server` (server dashboard) immediately
- `action(srcSession, srcIndex, windowId, windowName, dstSession)`: Call `moveWindowToSession(srcSession, srcIndex, dstSession)` — the existing API client function
- `onAlwaysRollback`:
  1. Call `restoreWindow(srcSession, windowId)` to un-hide the window in the source session
  2. Call `removeGhost(optimisticId)` using the ref stored during `onOptimistic`
- `onError(error)`: Call `addToast(error.message || "Failed to move window to session")`

#### Scenario: Successful cross-session drag-drop
- **GIVEN** a session "alpha" with window "@1" (name "zsh") at index 0
- **AND** a session "beta" exists
- **WHEN** the user drags window "@1" from "alpha" and drops on the "beta" session header
- **THEN** the window SHALL immediately disappear from "alpha" in the sidebar
- **AND** a ghost window named "zsh" SHALL immediately appear under "beta" in the sidebar
- **AND** the user SHALL be navigated to `/$server`
- **AND** the API call `moveWindowToSession("alpha", 0, "beta")` SHALL fire in the background
- **AND** when the API succeeds, no further visual change occurs until SSE confirms

#### Scenario: API failure rolls back
- **GIVEN** a cross-session drag from "alpha" window "@1" to "beta"
- **WHEN** the API call `moveWindowToSession` fails
- **THEN** the window SHALL reappear in "alpha" at its original position
- **AND** the ghost window SHALL be removed from "beta"
- **AND** a toast "Failed to move window to session" SHALL appear

#### Scenario: Drop onto the same session is ignored
- **GIVEN** drag data with `{ session: "alpha", ... }`
- **WHEN** the user drops onto the "alpha" session header
- **THEN** no action SHALL be taken (existing guard: `data.session === sessionName`)

### Requirement: Ghost window uses source window name

The ghost window added to the target session SHALL use the source window's current display name (from the drag data `name` field). No placeholder like "Moving..." — the user sees the actual window name appear in the target session.

#### Scenario: Ghost displays correct name
- **GIVEN** a window named "vim" dragged from "alpha" to "beta"
- **WHEN** the optimistic update fires
- **THEN** the ghost window under "beta" SHALL display "vim"

### Requirement: Remove onMoveWindowToSession from sidebar props

The `onMoveWindowToSession` prop on `SidebarProps` SHALL be removed. The cross-session move API call is now handled internally by the sidebar's `useOptimisticAction` hook. The `handleMoveWindowToSession` callback in `app.tsx` SHALL be removed.

The sidebar SHALL import `moveWindowToSession` directly from `@/api/client` — following the same pattern as other sidebar API calls (e.g., `moveWindow`, `killTmuxWindow`, `renameWindow`).

#### Scenario: Sidebar handles move internally
- **GIVEN** the sidebar component
- **WHEN** a cross-session drop occurs
- **THEN** the sidebar SHALL call `moveWindowToSession` directly
- **AND** no prop callback to `app.tsx` is involved

### Requirement: SSE reconciliation clears optimistic state

No new reconciliation code is needed. The existing `setWindowsForSession` action:
1. Removes the moved window's entry from the source session (it's no longer in the incoming window list)
2. Adds the moved window's entry to the target session (it appears in the incoming list with a new index)
3. Reconciles the ghost in the target session (the new `windowId` wasn't in the ghost's `snapshotWindowIds`, so the ghost is claimed)

The `killed` flag on the source entry is naturally cleaned up when `setWindowsForSession` removes the entry entirely.

#### Scenario: SSE arrives after successful move
- **GIVEN** window "@1" was optimistically killed in "alpha" and ghosted in "beta"
- **WHEN** SSE delivers updated data for both sessions
- **THEN** the entry for "@1" SHALL be removed from "alpha" (not in incoming list)
- **AND** a new entry for "@1" SHALL appear in "beta" (in incoming list)
- **AND** the ghost in "beta" SHALL be reconciled (removed) because "@1" is a new ID for "beta"

#### Scenario: SSE arrives after rollback
- **GIVEN** a cross-session move was rolled back
- **WHEN** SSE delivers session data (window still in source)
- **THEN** the source session SHALL show the window normally (`killed: false` was restored by rollback)
- **AND** the target session SHALL have no ghost (removed by rollback)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Use existing `useOptimisticAction` hook for lifecycle | Confirmed from intake #1 — every sidebar mutation uses this hook | S:95 R:90 A:95 D:95 |
| 2 | Certain | Use `killWindow` to hide from source session | Confirmed from intake #2 — same semantics as delete-window optimistic flow; `killed: true` entries are filtered by `useMergedSessions` | S:90 R:90 A:90 D:90 |
| 3 | Certain | Use `addGhostWindow` for target session insertion | Confirmed from intake #3 — ghost system designed for this; SSE reconciliation via snapshot diff handles cleanup | S:90 R:85 A:90 D:85 |
| 4 | Certain | Navigate to `/$server` immediately in `onOptimistic` | Upgraded from intake Confident #4 — matches current post-move behavior; rollback restores visual state regardless of navigation; server dashboard is the safe landing page | S:85 R:90 A:85 D:85 |
| 5 | Certain | SSE reconciliation requires no new code | Confirmed from intake #5 — `setWindowsForSession` replaces entries, ghosts reconcile via snapshot diff | S:95 R:95 A:95 D:95 |
| 6 | Certain | Rollback: `restoreWindow` + `removeGhost` | Confirmed from intake #6 — direct reversal; `onAlwaysRollback` ensures cleanup even if component unmounts | S:85 R:90 A:90 D:85 |
| 7 | Certain | Extend drag data with `windowId` and `name` | Confirmed from intake #7 — minimal payload change, backward compatible with existing within-session drop handler | S:90 R:95 A:90 D:90 |
| 8 | Certain | Move optimistic logic from app.tsx to sidebar | Confirmed from intake #8 — sidebar owns all other `useOptimisticAction` instances; co-locating keeps the pattern consistent | S:85 R:85 A:90 D:85 |
| 9 | Certain | Ghost uses source window's display name | Resolves intake open question — "vim" not "Moving..." matches ghost pattern for session/window creates | S:85 R:95 A:90 D:90 |
| 10 | Certain | Remove `onMoveWindowToSession` prop entirely | Sidebar imports API directly for every other mutation; no reason for this one to be different | S:85 R:85 A:90 D:90 |

10 assumptions (10 certain, 0 confident, 0 tentative, 0 unresolved).
