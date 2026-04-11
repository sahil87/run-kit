# Intake: Optimistic Sidebar Window Reorder

**Change**: 260411-sl01-optimistic-sidebar-window-reorder
**Created**: 2026-04-11
**Status**: Draft

## Origin

> Backlog item [sl01] from 2026-04-10 sync-latency audit: "Move window within session (drag-drop reorder) has no optimistic update — UI waits ~2.5s for SSE poll to reflect the new order. Add optimistic reorder to the sidebar window list on drop."

One-shot request from backlog. No prior conversation.

## Why

When a user drags a window to a new position within the same session in the sidebar, the `handleDrop` function in `sidebar/index.tsx` calls `moveWindow()` (API: `PATCH /api/sessions/{session}/windows/{index}`) and waits for the SSE session-state poll (~2.5s interval) to reflect the new window order. During this gap the sidebar shows the old ordering, creating a sluggish "nothing happened" experience.

The project already ships optimistic patterns for session/window create, kill, and rename — all using `useOptimisticAction` and `optimistic-context.tsx`. Drag-drop reorder is the only sidebar mutation that still blocks on the server round-trip. Fixing this brings reorder UX in line with every other sidebar action.

## What Changes

### Add optimistic reorder to `window-store.ts`

Introduce a `swapWindowOrder(session, srcIndex, dstIndex)` action in the window store that swaps the `index` values of two `WindowEntry` objects within the same session. No-op if either entry is missing. Rollback is achieved by calling the swap again with reversed arguments.

This follows the existing action pattern in `window-store.ts` (kill/restore/rename) but operates on ordering rather than adding/removing entries.

### Wire optimistic reorder into `sidebar/index.tsx` `handleDrop`

Replace the current fire-and-wait flow:

```ts
// Current (no optimistic update)
moveWindow(data.session, data.index, windowIndex)
  .then(() => onSelectWindow(sessionName, windowIndex))
  .catch((err) => addToast(err.message || "Failed to move window"));
```

With an optimistic flow using `useOptimisticAction`:

```ts
// Optimistic: swap immediately, API in background, rollback on error
fireOptimistic({
  onOptimistic: () => reorderWindow(session, srcIndex, dstIndex),
  apiCall: () => moveWindow(session, srcIndex, dstIndex),
  onSettled: () => onSelectWindow(session, dstIndex),
  onRollback: (rollback) => rollback(),
  onError: (err) => addToast(err.message || "Failed to move window"),
});
```

The exact wiring depends on how `useOptimisticAction` exposes its lifecycle — the pattern is already established in the codebase for kill, rename, and create operations.

### Tests

- Unit test in `window-store.test.ts`: verify `reorderWindow` swaps correctly and rollback restores original order
- Update existing sidebar drag-drop tests in `sidebar.test.tsx` to assert the optimistic reorder behavior (immediate visual swap before API resolves)

## Affected Memory

- `run-kit/ui-patterns`: (modify) Document the optimistic reorder pattern alongside existing optimistic create/kill/rename patterns

## Impact

- **Frontend**: `app/frontend/src/store/window-store.ts`, `app/frontend/src/components/sidebar/index.tsx`, `app/frontend/src/store/window-store.test.ts`, `app/frontend/src/components/sidebar.test.tsx`
- **Backend**: No changes — the `PATCH /api/sessions/{session}/windows/{index}` endpoint and `SwapWindow` tmux call remain unchanged
- **No new dependencies** — uses existing `useOptimisticAction` hook and `window-store` infrastructure

## Open Questions

- None — the existing optimistic patterns and the drag-drop API surface are well-established.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Use existing `useOptimisticAction` hook for lifecycle | Codebase convention — every other sidebar mutation uses this hook | S:90 R:95 A:95 D:95 |
| 2 | Certain | Add reorder action to `window-store.ts` | Window store already owns ghost windows and hide/kill state; reorder belongs here | S:85 R:90 A:90 D:90 |
| 3 | Certain | Backend unchanged | The API and tmux swap logic work correctly; only the frontend needs optimistic behavior | S:95 R:95 A:95 D:95 |
| 4 | Confident | Swap is the correct reorder operation (not insert/shift) | `tmux swap-window` is the underlying operation; frontend should mirror its semantics | S:80 R:85 A:80 D:75 |
| 5 | Certain | No new e2e tests needed | Unit tests on store + sidebar are sufficient; e2e for drag-drop is fragile and the backend is unchanged | S:85 R:90 A:85 D:90 |

5 assumptions (4 certain, 1 confident, 0 tentative, 0 unresolved).