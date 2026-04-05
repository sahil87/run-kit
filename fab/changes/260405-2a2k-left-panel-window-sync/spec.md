# Spec: Left Panel Window Sync

**Change**: 260405-2a2k-left-panel-window-sync
**Created**: 2026-04-05
**Affected memory**: none (implementation-only fix)

## Non-Goals

- Reducing the SSE poll interval — the 2500ms interval is acceptable latency for normal use
- Adding a push/webhook mechanism from tmux to run-kit — polling is the intended architecture (Constitution §II)

## Root Cause

`app/frontend/src/hooks/use-optimistic-action.ts` gates `onSettled` and `onRollback` behind a `mountedRef.current` check. When a kill operation's API call resolves after the initiating component has unmounted, neither callback fires. For kill operations this means `unmarkKilled` is never called, leaving a stale identifier in the `killed` set inside `OptimisticContext`. Any subsequent real tmux window whose `session:index` key matches the stale entry is silently filtered out by `useMergedSessions`.

The `mountedRef` guard exists to prevent React's "setState on unmounted component" warning. Only `setIsPending(false)` actually triggers that warning — `onSettled` and `onRollback` interact only with root-level context setters (OptimisticContext), which are always mounted.

## Fix — `use-optimistic-action.ts`

Move `onSettled` and `onRollback` calls to execute **before** the `mountedRef.current` guard. Keep `setIsPending(false)` and `onError` behind the guard.

### Before (buggy)

```typescript
.then(
  () => {
    if (!mountedRef.current) return;
    onSettled?.();
    setIsPending(false);
  },
  (err: unknown) => {
    if (!mountedRef.current) return;
    onRollback?.();
    const error = err instanceof Error ? err : new Error(String(err));
    onError?.(error);
    setIsPending(false);
  },
);
```

### After (fixed)

```typescript
.then(
  () => {
    onSettled?.();                    // always runs — cleans up OptimisticContext
    if (!mountedRef.current) return;
    setIsPending(false);
  },
  (err: unknown) => {
    onRollback?.();                   // always runs — cleans up OptimisticContext
    if (!mountedRef.current) return;
    const error = err instanceof Error ? err : new Error(String(err));
    onError?.(error);
    setIsPending(false);
  },
);
```

### Requirement

**REQ-1**: `onSettled` SHALL be called when the action promise resolves, regardless of whether the initiating component is mounted at the time of resolution.

**REQ-2**: `onRollback` SHALL be called when the action promise rejects, regardless of whether the initiating component is mounted at the time of rejection.

**REQ-3**: `setIsPending(false)` SHALL only be called when `mountedRef.current` is `true` (existing behavior, unchanged).

**REQ-4**: `onError` SHALL only be called when `mountedRef.current` is `true` (avoid stale toast notifications from unmounted components).

---

## New E2E Test — `sidebar-window-sync.spec.ts`

New file: `app/frontend/tests/e2e/sidebar-window-sync.spec.ts`

Follows existing E2E conventions: `TMUX_SERVER = process.env.E2E_TMUX_SERVER ?? "rk-e2e"`, `execSync` for tmux operations, port via `RK_PORT ?? "3333"`.

### Scenario 1 — External window creation appears without page reload

**REQ-5**: When a new tmux window is created externally on the monitored server, the sidebar MUST reflect the new window within 5000ms without any page reload.

```
GIVEN a tmux session exists on the rk-e2e server
  AND the browser is navigated to /{TMUX_SERVER}
  AND the Connected indicator is visible (SSE established)
WHEN tmux new-window is called externally on that session
THEN the new window name appears in the sidebar nav within 5000ms
 AND no page reload occurred
```

Implementation note: after `execSync("tmux -L rk-e2e new-window -t <session> -n <name>")`, assert `sidebar.locator("text=<name>")` is visible with `timeout: 5000`. The 5000ms window covers at least two full SSE poll cycles (2 × 2500ms).

### Scenario 2 — External window rename reflects without page reload

**REQ-6**: When a tmux window is renamed externally, the sidebar MUST reflect the new name within 5000ms without any page reload.

```
GIVEN a tmux session with a known window name exists on rk-e2e
  AND the browser is at /{TMUX_SERVER}
  AND SSE is connected
WHEN tmux rename-window is called externally for that window
THEN the new window name appears in the sidebar within 5000ms
 AND the old name no longer appears
 AND no page reload occurred
```

Implementation note: rename via `execSync("tmux -L rk-e2e rename-window -t <session>:<index> <new-name>")`.

### Scenario 3 — Kill-then-create at same index does not suppress new window

**REQ-7**: After a window is killed via the run-kit sidebar and a new window is created at the same index externally, the new window MUST appear in the sidebar.

This scenario directly exercises the `use-optimistic-action` fix. Killing via sidebar triggers `markKilled`; the fix ensures `unmarkKilled` is called in `onSettled` regardless of mount state.

```
GIVEN a session with exactly one window at index 0 named "win-original"
  AND the browser is at /{TMUX_SERVER}
  AND SSE is connected
WHEN the window is killed via the sidebar kill button (with confirmation)
 AND a new window is immediately created externally: tmux new-window -t <session> -n "win-new"
THEN "win-new" appears in the sidebar within 5000ms
 AND "win-original" does not appear
```

Implementation note: after clicking kill and confirming, use `execSync` to create the replacement window. The `killed` set entry for the old window index must be cleared by `onSettled` before the new window arrives in the next SSE poll.

---

## Assumptions (cumulative)

| # | Grade | Decision | Rationale | Scores | Artifact |
|---|-------|----------|-----------|--------|----------|
| 1 | Certain | SSE polling (2500ms) is the real-time update path | Observable in `session-context.tsx` | S:5 R:5 A:5 D:5 | intake |
| 2 | Certain | Page refresh works because `addClient` sends `previousJSON` immediately | Observable in `sse.go` | S:5 R:5 A:5 D:5 | intake |
| 3 | Certain | E2E suite uses port 3333 (`RK_PORT`) and server `rk-e2e` (`E2E_TMUX_SERVER`) | Confirmed in `playwright.config.ts` and all existing E2E specs | S:5 R:5 A:5 D:5 | intake |
| 4 | Certain | E2E test uses `execSync("tmux -L rk-e2e new-window ...")` and 5000ms assertion timeout | Consistent with existing E2E patterns; covers ≥2 poll cycles | S:5 R:5 A:5 D:5 | intake |
| 5 | Certain | Root cause: `use-optimistic-action.ts` skips `onSettled`/`onRollback` when component unmounts, leaving stale `killed` entries | Code-confirmed: `if (!mountedRef.current) return` gates both callbacks | S:5 R:5 A:5 D:5 | spec |
| 6 | Certain | Fix: move `onSettled` and `onRollback` before the `mountedRef` guard; keep `setIsPending` and `onError` behind it | `onSettled`/`onRollback` only mutate root-level OptimisticContext (always mounted); `setIsPending` is local state | S:5 R:5 A:5 D:5 | spec |
| 7 | Confident | This is a regression from a recent change | User said "no longer in sync"; `use-optimistic-action` was modified in a recent PR | S:4 R:4 A:4 D:4 | intake |
| 8 | Tentative | Scenario 3 (kill-then-create at same index) is the primary real-world trigger | tmux reuses window indices after kill; the user's `wt create` workflow typically creates windows right after kill | S:3 R:4 A:3 D:3 | spec |

8 assumptions (6 certain, 1 confident, 1 tentative, 0 unresolved).
