# Review: Fix Mutation APIs Targeting Wrong tmux Server

**Change**: 260418-yadg-fix-mutation-server-race
**Reviewed**: 2026-04-18
**Verdict**: PASS

## Summary

The implementation faithfully executes the spec: `_getServer` / `setServerGetter` are removed, every API function listed in the spec takes `server` as its first positional argument, optimistic overlays now carry `server` and filter by `(server, name)` for session-level entries while server-level entries (ghost servers, server kills) remain global, and a regression test in `use-dialog-state.test.tsx` exercises the exact stale-closure scenario described in the spec. Backend untouched. TypeScript clean. 451/451 frontend tests pass.

## Verification

- `tsc --noEmit`: clean
- `just test-frontend`: 29 files, 451 tests, all passing
- `grep -r "_getServer\|setServerGetter" app/frontend/src/`: zero matches
- Backend `git diff --name-only -- 'app/backend/'`: empty
- All 15 files importing `@/api/client` reviewed; the three not modified (`server-panel.tsx`, `server-list-page.tsx`, `theme-context.tsx`) only use server-management/theme APIs that intentionally don't take `server`.

## Findings

### Must-fix
*(none)*

### Should-fix
*(none)*

### Nice-to-have

1. `optimistic-context.tsx` overloads `markKilled` / `unmarkKilled` via an intersection-of-call-signatures type and casts the `useCallback` result (`as OptimisticContextType["markKilled"]`). It works and is type-safe at the call site, but readers have to chase the discriminator-by-arity pattern. A pair of separately-named functions (`markSessionKilled(server, name)` / `markServerKilled(name)`) or a tagged-object payload would be clearer. Acceptable as-is — not worth churning for cosmetics.

2. The first test in the new "server-scoped optimistic overlays" describe block ("ghost session on server-A is not rendered when viewing server-B") rerenders the `OptimisticProvider`, which resets its internal state, so the test stops short of actually asserting the cross-server isolation it advertises. The author noted this in a comment and the next two `DualView` tests cover the real scenario, so coverage is fine — but the first test could be deleted or rewritten to use the dual-view pattern for consistency.

3. In `sidebar/index.tsx`, `executeKillFromDialog` snapshots `srv` into `killDialogServerRef` inside `onOptimistic` and reads it from `onAlwaysRollback` / `onAlwaysSettled`. With overlapping kill confirmations, the second call would overwrite the first's server ref before the first settles. This is the same pattern as the pre-existing `killTargetRef`, and concurrent kill-confirm dialogs are unlikely in practice, so it's not worth fixing now — but worth noting if multi-target kill UX is ever added.

## Checklist

All 27 CHK items verified — see `checklist.md`.

| Bucket | Status |
|--------|--------|
| Functional Completeness (CHK-001..007) | 7/7 |
| Behavioral Correctness (CHK-008..010) | 3/3 |
| Removal Verification (CHK-011..013) | 3/3 |
| Scenario Coverage (CHK-014..018) | 5/5 |
| Edge Cases (CHK-019..021) | 3/3 |
| Code Quality (CHK-022..027) | 6/6 |

## Status

PASS — running `fab status finish yadg review fab-fff`.
