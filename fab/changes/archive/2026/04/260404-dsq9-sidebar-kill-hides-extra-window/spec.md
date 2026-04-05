# Spec: Sidebar Kill Hides Extra Window

**Change**: 260404-dsq9-sidebar-kill-hides-extra-window
**Created**: 2026-04-04
**Affected memory**: `docs/memory/run-kit/ui-patterns.md`

## Non-Goals

- Fixing the same stale-state pattern for `killSession` entries — session names never shift on kill, so the index-collision mechanism does not apply to sessions
- Changing the optimistic kill architecture (killed-by-id approach) — `onSettled` cleanup is the minimal correct fix within the existing model

## Frontend: Optimistic Kill State Lifecycle

### Requirement: Window Kill Must Clear Optimistic State on Settled

After a window kill API call settles (success or failure), the optimistic killed entry for that window MUST be removed from the `killed[]` state via `unmarkKilled`. The existing `onRollback` path already handles the failure case; an `onSettled` callback MUST be added to handle the success case.

This requirement applies to all three `useOptimisticAction` instances that call `markKilled("window", ...)`:
1. `executeKillWindow` in `sidebar.tsx` (Ctrl+Click direct kill path)
2. `executeKillFromDialog` in `sidebar.tsx` (confirmation dialog kill path)
3. `executeKillWindow` in `use-dialog-state.ts` (command palette kill path)

#### Scenario: Direct kill clears state on success

- **GIVEN** a session has windows at indices [0, 1, 2]
- **WHEN** the user Ctrl+Clicks the X button on window at index 1
- **THEN** `markKilled("window", "session:1")` is called optimistically, hiding window 1
- **AND** the kill API call is dispatched
- **AND** when the API call resolves (success), `unmarkKilled("session:1")` is called
- **AND** the next SSE update showing windows [0, 1 (renumbered from 2)] renders correctly with both windows visible

#### Scenario: Dialog kill clears state on success

- **GIVEN** a session has windows at indices [0, 1, 2]
- **WHEN** the user clicks the X button on window at index 1 and confirms in the dialog
- **THEN** `markKilled("window", "session:1")` is called optimistically
- **AND** when the kill API call resolves (success), `unmarkKilled("session:1")` is called
- **AND** the renumbered window (old index 2, now index 1) appears in the sidebar after SSE update

#### Scenario: Rollback still removes optimistic state on failure

- **GIVEN** a window kill is in flight with optimistic state applied
- **WHEN** the kill API call fails (network error, tmux error)
- **THEN** `onRollback` fires and `unmarkKilled` removes the killed entry (existing behaviour preserved)
- **AND** the window reappears in the sidebar

#### Scenario: No double-kill appearance for last window in session

- **GIVEN** a session has exactly one window (index 0)
- **WHEN** the user kills window at index 0
- **THEN** the window disappears optimistically
- **AND** the session itself eventually disappears via SSE (no renumbering occurs)
- **AND** no phantom window appears after `unmarkKilled` fires (there is no next window to unhide)

### Requirement: `onSettled` Must Not Double-Invoke `unmarkKilled`

The `onSettled` callback for `executeKillFromDialog` in `sidebar.tsx` MUST guard against the case where `killTargetRef.current` is null before calling `unmarkKilled`. The ref is set via the component's state sync and may be null if the component unmounts before the API call settles.

#### Scenario: Dialog unmounts before API settles

- **GIVEN** a kill API call is in flight via `executeKillFromDialog`
- **WHEN** the sidebar component unmounts before the API call resolves
- **THEN** `onSettled` fires but `killTargetRef.current` is null
- **AND** `unmarkKilled` is NOT called (null guard prevents the call)
- **AND** no runtime error is thrown

### Requirement: `use-dialog-state.ts` `onSettled` Must Clear Both Ref and Killed State

The existing `onSettled` in `use-dialog-state.ts` `executeKillWindow` only nulls `lastKillWindowRef.current`. It MUST be extended to also call `unmarkKilled(lastKillWindowRef.current)` before nulling the ref.

#### Scenario: Command palette kill clears stale state

- **GIVEN** a session has windows at indices [0, 1, 2] and the user navigates to window 1
- **WHEN** the user opens the command palette and selects "Window: Kill"
- **THEN** a kill confirm dialog appears
- **AND** on confirm, `markKilled("window", "session:1")` is called
- **AND** when the API call settles (success), `unmarkKilled("session:1")` is called
- **AND** `lastKillWindowRef.current` is nulled after unmarkKilled

## Design Decisions

1. **`onSettled` over SSE reconciliation in `useMergedSessions`**: Add `unmarkKilled` call in `onSettled` rather than auto-reconciling killed entries in the merge function.
   - *Why*: `useMergedSessions` can only detect that a killed window no longer appears in real SSE data, but cannot distinguish between "kill confirmed, index now occupied by renumbered window" vs "SSE update hasn't arrived yet". The `onSettled` hook fires after the API call completes, which is the definitive signal that the kill was processed. Reconciliation in `useMergedSessions` would require storing the window name in killed entries — unnecessary complexity for this fix.
   - *Rejected*: Adding a `windowName` field to `KilledEntry` and clearing in `useMergedSessions` when the real window at that index has a different name. Too complex and introduces a new failure mode (name-match false positive).

2. **Accepting micro-flash UX trade-off**: When the HTTP response arrives before the SSE update, `unmarkKilled` fires first and the old window slot may briefly reappear before SSE removes it.
   - *Why*: The flash is sub-100ms in practice and imperceptible. The alternative — permanently hiding a window — is a significant data-loss UX bug. The flash is strictly better.
   - *Rejected*: Delaying `unmarkKilled` until after SSE reconciliation via a flag in `.status.yaml` — overly complex, introduces coupling between SSE and the optimistic action hook.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Root cause: `unmarkKilled` is never called on success — only on rollback | Confirmed from intake #1. `onRollback` calls `unmarkKilled`; no `onSettled` does. tmux renumbering creates index collision for the next window. | S:95 R:95 A:90 D:90 |
| 2 | Certain | Fix is frontend-only — backend kills exactly one window, no side effects | Confirmed from intake #2. `handleWindowKill` at `windows.go:82` issues a single `tmux kill-window` call. | S:90 R:95 A:95 D:90 |
| 3 | Certain | Three `useOptimisticAction` instances need `onSettled`: `executeKillWindow` (sidebar), `executeKillFromDialog` (sidebar), `executeKillWindow` (use-dialog-state) | Confirmed by code review of all kill paths. No fourth path exists. | S:90 R:90 A:95 D:90 |
| 4 | Certain | `onSettled` fires on success only in `useOptimisticAction` — failure path calls `onRollback` then `onError`, never `onSettled` | <!-- clarified: codebase inspection of use-optimistic-action.ts confirms onSettled is only called in the .then() success branch (line 42); the rejection handler (lines 45-51) calls onRollback+onError but NOT onSettled. The original assumption was wrong. This means: onRollback handles the failure unmark, and onSettled handles the success unmark — no double-invoke risk at all. --> Verified from `app/frontend/src/hooks/use-optimistic-action.ts`: success branch calls `onSettled?.()` before `setIsPending(false)`; error branch calls `onRollback?.()` then `onError?.(error)` — no `onSettled` call. | S:95 R:95 A:95 D:95 |
| 5 | Confident | `onSettled` is the right hook — `useMergedSessions` reconciliation is unnecessary complexity | Confirmed from intake #3. API surface already exists; no structural changes needed. | S:80 R:85 A:85 D:75 |
| 6 | Confident | Session kill entries don't need same fix — session names are stable across kills | Confirmed from intake #4. | S:85 R:80 A:85 D:80 |
| 7 | Confident | Micro-flash UX (HTTP before SSE) is acceptable | Confirmed from intake #5. Sub-100ms flash preferred over permanent data loss. <!-- clarified: design decision #2 in this spec documents and explicitly accepts this trade-off with rationale; no user input needed to validate the acceptability. --> | S:80 R:80 A:80 D:75 |

7 assumptions (4 certain, 3 confident, 0 tentative, 0 unresolved).
