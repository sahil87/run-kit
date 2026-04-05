# Intake: Sidebar Kill Hides Extra Window

**Change**: 260404-dsq9-sidebar-kill-hides-extra-window
**Created**: 2026-04-04
**Status**: Draft

## Origin

> Clicking on x in the left panel ends up killing two windows at a time

One-shot natural language report. No prior conversation.

## Why

When a user clicks the X (kill) button on a window in the left panel sidebar, two windows visually disappear instead of one. The root cause is a stale optimistic kill state that is never cleared on success.

Optimistic updates mark a window as killed using `markKilled("window", "session:index")`. This correctly hides the targeted window immediately. However, `unmarkKilled` is never called after a successful kill API response — only after a failure (rollback). When tmux kills window N, it renumbers all subsequent windows: the window that was at N+1 becomes N. When the next SSE update arrives, the new window at index N is filtered out by the stale killed entry (`session:N`), making it look like two windows were removed.

If not fixed, any session with more than one window will lose a visible window every time any window is killed — a confusing and persistent UI regression.

## What Changes

### Clearing stale optimistic kill state on success

All three `useOptimisticAction` instances that call `markKilled("window", ...)` need an `onSettled` callback that calls `unmarkKilled` to clear the optimistic filter after the API call completes (success or failure is handled separately via `onRollback`).

**`app/frontend/src/components/sidebar.tsx`** — two instances:

1. `executeKillWindow` (Ctrl+Click direct kill, lines 86–99): add `onSettled`:
   ```ts
   onSettled: () => {
     if (lastKillWindowRef.current) unmarkKilled(lastKillWindowRef.current);
   },
   ```

2. `executeKillFromDialog` (confirmation dialog kill, lines 105–131): currently no `onSettled`. Add it using `killTargetRef`:
   ```ts
   onSettled: () => {
     const target = killTargetRef.current;
     if (!target) return;
     if (target.type === "window" && target.windowIndex != null) {
       unmarkKilled(`${target.session}:${target.windowIndex}`);
     } else {
       unmarkKilled(target.session);
     }
   },
   ```

**`app/frontend/src/hooks/use-dialog-state.ts`** — one instance:

3. `executeKillWindow` (lines 132–148): already has `onSettled` but it only nulls the ref. Extend it to also call `unmarkKilled`:
   ```ts
   onSettled: () => {
     if (lastKillWindowRef.current) {
       unmarkKilled(lastKillWindowRef.current);
     }
     lastKillWindowRef.current = null;
   },
   ```

### Timing behaviour after fix

After a successful kill:
- If SSE arrives **before** the HTTP response: the stale killed state still filters the renumbered window until `onSettled` fires and calls `unmarkKilled`, after which the renumbered window appears correctly. No flash.
- If SSE arrives **after** the HTTP response: `unmarkKilled` fires first, the old window at that index may briefly reappear for the milliseconds before SSE clears it. This micro-flash is acceptable — it is far better than permanently losing a window.

Session kills (`killSession`) share the same pattern but are not affected by index renumbering since tmux session names are stable. No fix needed there for this specific bug, though the same `onSettled` cleanup is defensively correct.

## Affected Memory

- `ui/optimistic-state.md`: (modify) document that killed window entries must be cleared on success to avoid index collision after tmux renumbering

## Impact

- `app/frontend/src/components/sidebar.tsx` — two `useOptimisticAction` instances get `onSettled` callbacks
- `app/frontend/src/hooks/use-dialog-state.ts` — one `useOptimisticAction` instance gets extended `onSettled`
- `app/frontend/src/contexts/optimistic-context.tsx` — no changes needed; the `unmarkKilled` API is already correct
- No backend changes required

## Open Questions

- Should `killSession` entries also be cleaned up in `onSettled` for consistency, or is the index-collision risk specific enough to windows only that it should stay out of scope?

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Root cause is stale optimistic kill state in `killed[]` — `unmarkKilled` is never called on success | Code inspection: `onRollback` calls `unmarkKilled`, but no `onSettled` does. tmux renumbering confirmed by tmux kill-window behaviour. | S:95 R:95 A:90 D:90 |
| 2 | Certain | Fix scope is frontend only — `handleWindowKill` in backend correctly kills exactly one window | Backend handler at `windows.go:82` is a single `tmux kill-window` call with no side effects | S:90 R:95 A:95 D:90 |
| 3 | Confident | `onSettled` is the right hook (not a separate reconciliation in `useMergedSessions`) | `onSettled` is already in the `useOptimisticAction` API and used in rename flows; adding it to kill flows is consistent. Reconciliation in `useMergedSessions` would require storing window name in killed entries to distinguish old vs renumbered — unnecessary complexity. | S:80 R:85 A:85 D:75 |
| 4 | Confident | Session kill entries don't need the same fix in this change — session names don't shift on kill | tmux session names are user-chosen strings; killing one session never renames another. The index-collision mechanism is window-specific. | S:85 R:80 A:85 D:80 |
| 5 | Tentative | Brief reappearance flash (HTTP settles before SSE) is acceptable UX trade-off | The flash is sub-100ms in practice. The alternative (permanent hidden window) is far worse. No user preference gathered. <!-- assumed: flash acceptable — far better than permanent loss; can always revisit with SSE-gated unmark if needed --> | S:60 R:70 A:65 D:65 |

5 assumptions (2 certain, 2 confident, 1 tentative, 0 unresolved). Run /fab-clarify to review.
