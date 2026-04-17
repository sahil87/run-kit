# Quality Checklist: Fix Sidebar Fab State Display

**Change**: 260417-5nok-fix-sidebar-fab-state
**Generated**: 2026-04-17
**Spec**: `spec.md`

## Functional Completeness

- [x] CHK-001 Pane-map subprocess invocation: `fetchPaneMap` in `sessions.go` calls `exec.CommandContext(ctx, "fab", "pane", "map", "--json", "--all-sessions")` with `cmd.Dir = repoRoot`. No remaining reference to `fab/.kit/bin/fab-go` in `sessions.go`.
- [x] CHK-002 Repo-root discovery marker: `findRepoRoot` walks up looking for `fab/project/config.yaml` (not `fab/.kit/bin/fab-go`). Doc comment updated to match.
- [x] CHK-003 Error surface preserved: `fetchPaneMap` still captures stderr into a `bytes.Buffer` and returns `fmt.Errorf("%w: %s", err, stderr.String())` on non-zero exit. `fetchPaneMapCached` still preserves stale cache on fetch error.

## Behavioral Correctness

- [x] CHK-004 **N/A**: Requires live dev-server curl verification; covered transitively by `TestFetchPaneMapIntegration` which exercises the same subprocess path end-to-end.
- [x] CHK-005 **N/A**: Frontend rendering — spec non-goal (frontend code is correct; only backend data supply was broken).
- [x] CHK-006 Graceful degradation when fab router unavailable: `TestFetchPaneMapFabNotOnPath` verifies error return; `FetchSessions` at sessions.go:343 discards the error (`paneMap, _ = fetchPaneMapCached(repoRoot)`), leaving fab fields empty.

## Scenario Coverage

- [x] CHK-007 Scenario "fab router is on PATH and repo is fab-managed": Covered by new `TestFetchPaneMapIntegration` (passes locally).
- [x] CHK-008 Scenario "fab router is not on PATH": Covered by updated `TestFetchPaneMapFabNotOnPath` (clears PATH via `t.Setenv`).
- [x] CHK-009 Scenario "WorktreePath is a subdirectory of the repo": `findRepoRoot` walks up via `filepath.Dir` loop at sessions.go:126-138. Exercised indirectly by `TestFetchPaneMapIntegration` which walks up from the test package dir.
- [x] CHK-010 Scenario "WorktreePath is outside any fab-managed repo": `findRepoRoot` returns `""` via `parent == dir` guard; caller short-circuits at sessions.go:342.

## Edge Cases & Error Handling

- [x] CHK-011 10-second context timeout still applies: `context.WithTimeout(context.Background(), 10*time.Second)` preserved at sessions.go:43.
- [x] CHK-012 Stale cache fallback on fetch error: `fetchPaneMapCached` at sessions.go:110-114 preserves stale cache; double-check pattern at sessions.go:101-107 preserved.
- [x] CHK-013 Subprocess non-zero exit with stderr: sessions.go:51-55 matches `fmt.Errorf("%w: %s", err, stderr.String())` format.

## Code Quality

- [x] CHK-014 Pattern consistency: sessions.go:46 follows project convention (context with timeout, argument slices, no shell strings).
- [x] CHK-015 No unnecessary duplication: grep confirms `findRepoRoot` has only one caller (sessions.go:328).
- [x] CHK-016 exec timeout present (project review rule): sessions.go:43 uses `context.WithTimeout`.
- [x] CHK-017 No shell strings (project review rule): sessions.go:46 uses argument slice form.
- [x] CHK-018 Test for new/changed behavior: `TestFetchPaneMapIntegration` added; `TestFetchPaneMapFabNotOnPath` updated. `go test -count=1 ./internal/sessions/...` → PASS.
- [x] CHK-019 Stale comments refreshed: sessions.go:24, 81, 320-323 all reference `fab pane map` / `fab/project/config.yaml`. Grep confirms zero `fab-go` / `fab/.kit` references remain in `app/backend/`.

## Notes

- Check items as you review: `- [x]`
- All items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] CHK-008 **N/A**: {reason}`
