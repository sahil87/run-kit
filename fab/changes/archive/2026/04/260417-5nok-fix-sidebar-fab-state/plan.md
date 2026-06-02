# Plan: Fix Sidebar Fab State Display

**Change**: 260417-5nok-fix-sidebar-fab-state
**Status**: In Progress
**Intake**: `intake.md`
**Spec**: `spec.md`

## Tasks

## Phase 1: Setup

<!-- No scaffolding required — all changes live in existing files. -->

_(no tasks)_

## Phase 2: Core Implementation

- [x] T001 Update `findRepoRoot(dir)` in `app/backend/internal/sessions/sessions.go` (L120-134) to walk up looking for `fab/project/config.yaml` instead of `fab/.kit/bin/fab-go`. Update the doc comment to read: `// findRepoRoot walks up from dir until it finds a directory containing // fab/project/config.yaml (the fab-project identity marker), returning that // directory. Returns "" if not found.`

- [x] T002 Update `fetchPaneMap(repoRoot string)` in `app/backend/internal/sessions/sessions.go` (L39-75) to invoke `exec.CommandContext(ctx, "fab", "pane", "map", "--json", "--all-sessions")` (router on PATH) instead of `filepath.Join(repoRoot, "fab/.kit/bin/fab-go")`. Set `cmd.Dir = repoRoot` so the router can locate `fab/project/config.yaml` for version dispatch. Remove the now-unused `bin` variable. Preserve all other behavior: 10-second context timeout, stderr capture into `bytes.Buffer`, `fmt.Errorf("%w: %s", err, stderr.String())` wrapping on error, JSON unmarshal into `[]paneMapEntry`, map assembly keyed by `session:windowIndex`. Also refresh the now-stale references to `fab-go pane-map` / `fab/.kit/bin/fab-go` in the same file's comments so they stay coherent with the new invocation: (a) `paneMapEntry` doc comment at L24 (`matches the JSON output of \`fab-go pane-map --json\``), (b) cache comment at L78 (`Avoids re-running fab-go pane-map on every SSE tick`), (c) the in-line derivation comment in `FetchSessions` at L316-318 (`looking for a directory containing fab/.kit/bin/fab-go`). No behavior change — comments only. <!-- clarified: these stale comments are incidental to the invocation change and fit cohesively in T002 since they live in the same file; splitting into a separate task would fragment a trivial comment refresh. -->

## Phase 3: Integration & Edge Cases

- [x] T003 Update `TestFetchPaneMapNonexistentBinary` in `app/backend/internal/sessions/sessions_test.go` (starting at L276) so it still exercises the error path under the new invocation shape. Replace the `/nonexistent/path` repoRoot argument with a `t.Setenv("PATH", "")` call before invoking `fetchPaneMap("/tmp")`. Assert that the returned map is nil and the error is non-nil. Rename the test to `TestFetchPaneMapFabNotOnPath` so the name matches the new failure condition, and update any test-list comments referring to the old name.

- [x] T004 Add `TestFetchPaneMapIntegration` to `app/backend/internal/sessions/sessions_test.go`. The test MUST call `t.Skip("fab router not available on PATH")` when `exec.LookPath("fab")` returns an error. When fab is present: create a temp dir via `t.TempDir()`, write a minimal `fab/project/config.yaml` inside it (must include a `fab_version` key — to source a real version value the router can resolve, walk up from `os.Getwd()` using the same `findRepoRoot` logic to locate the running repo's `fab/project/config.yaml`, then read and reuse its `fab_version`). Go tests run with the package directory as CWD (`app/backend/internal/sessions/`), so a direct read without walking up will not find the file. Verify `findRepoRoot(tempDir)` returns the temp dir, then call `fetchPaneMap(tempDir)` and assert error is nil. The returned map may be empty — the test proves the subprocess invocation succeeds, not specific map contents. <!-- clarified: specified that the fab_version must be sourced by walking up from the test binary's CWD, because Go test CWD is the package dir (not the repo root). -->

- [x] T005 Verify `findRepoRoot` has no additional callers that need updating. Run a grep for `findRepoRoot(` in `app/backend/` — expected single caller at `sessions.go:323`. If other callers exist, either update them to match the new semantics or flag for a follow-up.

## Phase 4: Polish

<!-- Memory file update is done at hydrate stage per the workflow. Nothing to add here. -->

_(no tasks)_

---

## Execution Order

- T001 and T002 are independent edits within the same file — T001 SHOULD be done first for readability (top-down), but either order is correct. Neither has runtime dependency on the other.
- T003 and T004 depend on T001 + T002 being in place (they test the new behavior). Within Phase 3, T003 and T004 touch the same test file at different locations; do them sequentially to avoid merge conflicts.
- T005 is independent — can run at any point. Placed in Phase 3 because its outcome may expand the scope of T001.
- After all tasks: run `cd app/backend && go test ./internal/sessions/...` to confirm the full package passes.

## Clarifications

### Session 2026-04-17 (auto-mode)

| # | Action | Detail |
|---|--------|--------|
| T002 | Scope expanded | Added explicit instruction to refresh stale `fab-go pane-map` / `fab/.kit/bin/fab-go` comments elsewhere in `sessions.go` (L24, L78, L316-318). Ensures the file is self-consistent post-apply; prevents reviewer pushback on mixed old/new terminology. |
| T004 | Test setup clarified | Specified that the integration test must source `fab_version` by walking up from the test binary's CWD (package dir) using `findRepoRoot`, rather than assuming a direct read of `fab/project/config.yaml`. Go tests run with the package directory as CWD, so a direct read would fail. |

## Acceptance

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
