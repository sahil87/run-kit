# Spec: Optimistic Sidebar Window Reorder

**Change**: 260411-sl01-optimistic-sidebar-window-reorder
**Created**: 2026-04-11
**Affected memory**: `docs/memory/run-kit/ui-patterns.md`

## Sidebar: Optimistic Window Reorder

### Requirement: Optimistic index swap on drop

The window store SHALL provide a `swapWindowOrder(session, srcIndex, dstIndex)` action that swaps the `index` values of two `WindowEntry` objects within the same session. After the swap, `useMergedSessions` (which sorts by `entry.index`) SHALL render the windows in the new order immediately — before the API responds.

#### Scenario: User drags window 0 to position 2
- **GIVEN** a session "alpha" with windows at indices 0, 1, 2
- **WHEN** the user drops window 0 onto position 2
- **THEN** the store entry for window 0 SHALL have `index: 2`
- **AND** the store entry for window 2 SHALL have `index: 0`
- **AND** the sidebar SHALL render the windows in order [was-2, 1, was-0] immediately

#### Scenario: Swap with no matching entries
- **GIVEN** a session "alpha" with no entry at index 5
- **WHEN** `swapWindowOrder("alpha", 0, 5)` is called
- **THEN** the store state SHALL remain unchanged (no-op)

### Requirement: Sidebar handleDrop uses useOptimisticAction

The `handleDrop` function in `sidebar/index.tsx` SHALL use `useOptimisticAction` to wire the optimistic swap lifecycle, replacing the current fire-and-wait `moveWindow().then().catch()` pattern.

The hook configuration SHALL:
- `onOptimistic`: call `swapWindowOrder(session, srcIndex, dstIndex)` and store the swap parameters in a ref for rollback
- `action`: call the existing `moveWindow(session, srcIndex, dstIndex)` API client function
- `onAlwaysRollback`: call `swapWindowOrder(session, dstIndex, srcIndex)` to reverse the swap
- `onAlwaysSettled`: clear the ref
- `onError`: call `addToast(err.message || "Failed to move window")`

The `onSelectWindow` call SHALL execute immediately after the optimistic swap (not deferred to `onSettled`), since the visual state is already updated.

#### Scenario: Successful drag-drop reorder
- **GIVEN** a session "alpha" with windows at indices 0, 1, 2
- **WHEN** the user drops window 0 onto position 2
- **THEN** the sidebar SHALL immediately show the swapped order
- **AND** the API call `moveWindow("alpha", 0, 2)` SHALL fire in the background
- **AND** when the API succeeds, no further visual change occurs (SSE will confirm)

#### Scenario: API failure rolls back
- **GIVEN** a session "alpha" with windows at indices 0, 1, 2
- **WHEN** the user drops window 0 onto position 2
- **AND** the API call fails
- **THEN** the sidebar SHALL revert to the original order [0, 1, 2]
- **AND** a toast "Failed to move window" SHALL appear

### Requirement: SSE reconciliation clears optimistic state

The existing `setWindowsForSession` action SHALL continue to replace all entries for a session with fresh SSE data. This naturally overwrites any optimistic index swaps — no additional reconciliation logic is needed.

#### Scenario: SSE arrives after successful swap
- **GIVEN** an optimistic swap has moved window 0 to index 2
- **WHEN** SSE delivers updated session data with the server-confirmed order
- **THEN** the store entries SHALL reflect the SSE data exactly
- **AND** the visual order SHALL remain unchanged (server confirms the swap)

#### Scenario: SSE arrives after rollback
- **GIVEN** an optimistic swap was rolled back due to API failure
- **WHEN** SSE delivers session data (still original order)
- **THEN** the store entries SHALL match the SSE data (original order)
- **AND** the visual order SHALL remain unchanged (already rolled back)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Use existing `useOptimisticAction` hook for lifecycle | Confirmed from intake #1 — codebase convention, every other sidebar mutation uses this hook | S:90 R:95 A:95 D:95 |
| 2 | Certain | Add `swapWindowOrder` action to `window-store.ts` | Confirmed from intake #2 — store owns window state, swap operates on existing entries via index field | S:90 R:90 A:95 D:90 |
| 3 | Certain | Backend unchanged | Confirmed from intake #3 — API and tmux swap work correctly | S:95 R:95 A:95 D:95 |
| 4 | Confident | Swap indices directly (not insert/shift) | Confirmed from intake #4 — mirrors `tmux swap-window` semantics; `useMergedSessions` sorts by index so swapping index values produces correct visual order | S:85 R:85 A:85 D:80 |
| 5 | Certain | No new e2e tests needed | Confirmed from intake #5 — unit tests on store + sidebar are sufficient | S:85 R:90 A:85 D:90 |
| 6 | Certain | SSE reconciliation requires no new code | `setWindowsForSession` already replaces all entries, naturally clearing any optimistic index swaps | S:95 R:95 A:95 D:95 |
| 7 | Certain | `onSelectWindow` called immediately (not deferred) | Visual state is already correct after optimistic swap; deferring to `onSettled` would add unnecessary delay | S:80 R:95 A:90 D:85 |

7 assumptions (6 certain, 1 confident, 0 tentative, 0 unresolved).