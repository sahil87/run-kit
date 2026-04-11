# Intake: Cross-Session Drag Optimistic Update

**Change**: 260411-sl02-cross-session-drag-optimistic-update
**Created**: 2026-04-11
**Status**: Draft

## Origin

> Backlog [sl02] 2026-04-10: Sync latency: Move window to another session (cross-session drag) has no optimistic update — UI waits ~5s+ for SSE to reflect the move. Add optimistic removal from source session and insertion into target session on drop.

One-shot from backlog. Related to sl01 (within-session drag optimistic reorder), which is already implemented. This is the cross-session counterpart.

## Why

When a user drags a window from one session to another in the sidebar, the API call to `POST /api/sessions/{session}/windows/{index}/move-to-session` succeeds quickly, but the UI doesn't update until the next SSE poll (~2.5s interval, often 5s+ in practice). During this gap, the window remains visible in the source session and doesn't appear in the target — the user has no feedback that the drop worked.

If we don't fix this, cross-session drag feels broken compared to within-session reorder (sl01), which already has sub-100ms optimistic feedback. The inconsistency makes the drag-drop UX feel unreliable.

The approach: apply the same `useOptimisticAction` pattern used for sl01, kill/rename/create operations — optimistically remove the window from the source session and add a ghost window in the target session on drop, with rollback on API failure.

## What Changes

### Optimistic removal from source session

On drop, immediately mark the dragged window as killed in the source session using the existing `killWindow(srcSession, windowId)` store action. This hides the window from the sidebar instantly. On rollback (API failure), call `restoreWindow(srcSession, windowId)` to bring it back.

The `killWindow` action already exists and is used for the delete-window optimistic flow — it sets `killed: true` on the `WindowEntry`, which the sidebar filters out during rendering.

### Optimistic insertion into target session

On drop, add a ghost window in the target session using `addGhostWindow(dstSession, windowName)`. This shows the window appearing in the target session sidebar immediately. The ghost is automatically reconciled when the next SSE arrives and `setWindowsForSession` detects a new `windowId` that wasn't in the ghost's snapshot.

### Rewire `handleSessionDrop` to use `useOptimisticAction`

Currently in `app/frontend/src/components/sidebar/index.tsx` (line 388-404), `handleSessionDrop` calls `onMoveWindowToSession` directly (fire-and-forget). This needs to be replaced with a `useOptimisticAction` call following the established pattern:

```typescript
// Current (fire-and-forget):
onMoveWindowToSession(data.session, data.index, sessionName);

// New (optimistic):
moveWindowCrossSession.execute(data.session, data.index, data.windowId, data.name, sessionName);
```

The `useOptimisticAction` hook instance needs:
- `onOptimistic`: call `killWindow(src, windowId)` + `addGhostWindow(dst, name)` + navigate to target
- `action`: call `moveWindowToSession(src, index, dst)` API
- `onAlwaysRollback`: call `restoreWindow(src, windowId)` + `removeGhost(ghostId)`
- `onAlwaysSettled`: (no-op — SSE reconciliation handles final state)

### Propagate `windowId` through drag data

The drag data currently carries `{ session, index }`. The optimistic update needs `windowId` and `name` too, so the drag data payload must be extended to `{ session, index, windowId, name }`.

### Navigation on optimistic update

The current `handleMoveWindowToSession` in `app.tsx` (line 408-419) navigates to `/$server` after the API resolves. With the optimistic approach, navigation should happen in `onOptimistic` (immediately on drop) rather than waiting for the API response. The sidebar handler already has access to the router via the existing `navigate` function.

## Affected Memory

- No memory files affected — this is a frontend-only optimistic update wiring change.

## Impact

- **`app/frontend/src/components/sidebar/index.tsx`**: Rewire `handleSessionDrop` to use `useOptimisticAction`; extend drag data payload with `windowId` and `name`
- **`app/frontend/src/app.tsx`**: Remove or simplify `handleMoveWindowToSession` — the optimistic action moves to the sidebar
- **`app/frontend/src/stores/window-store.ts`**: No new actions needed — `killWindow`, `restoreWindow`, `addGhostWindow`, `removeGhost` already exist
- **`app/frontend/tests/e2e/sync-latency.spec.ts`**: Test #7 already exists and should pass faster once optimistic update is wired
- **Unit tests**: Add tests for the new optimistic flow (sidebar cross-session drop)

## Open Questions

- Should the ghost window in the target session use a predictable name (the source window's current name) or a generic placeholder like "Moving..."?

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Use `useOptimisticAction` hook for the optimistic lifecycle | Established pattern — sl01, kill, rename all use it | S:95 R:90 A:95 D:95 |
| 2 | Certain | Use existing `killWindow` to hide from source session | Action exists, same semantics as delete-window optimistic flow | S:90 R:90 A:90 D:90 |
| 3 | Certain | Use existing `addGhostWindow` for target session insertion | Ghost system designed for optimistic additions; SSE reconciles automatically | S:90 R:85 A:90 D:85 |
| 4 | Confident | Navigate to target session immediately in `onOptimistic` | Current behavior navigates on API success; moving to optimistic feels right but changes error UX — user is already on target if API fails | S:75 R:80 A:80 D:70 |
| 5 | Certain | SSE `setWindowsForSession` handles final reconciliation | Replaces all entries per session; ghosts reconcile via snapshot diff | S:95 R:95 A:95 D:95 |
| 6 | Confident | Rollback: `restoreWindow` + `removeGhost` | Direct reversal of optimistic actions; same pattern as kill rollback | S:80 R:90 A:85 D:80 |
| 7 | Confident | Extend drag data with `windowId` and `name` | Needed for optimistic store operations; minor data payload change | S:85 R:95 A:90 D:85 |
| 8 | Confident | Move optimistic logic from app.tsx to sidebar | Sidebar owns drag state and has access to window-store; keeps handler co-located with drag events | S:80 R:85 A:85 D:75 |

8 assumptions (3 certain, 5 confident, 0 tentative, 0 unresolved).
