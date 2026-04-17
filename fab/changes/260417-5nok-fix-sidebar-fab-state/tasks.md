# Tasks: Fix Sidebar Fab State Display

**Change**: 260417-5nok-fix-sidebar-fab-state
**Spec**: `spec.md`
**Intake**: `intake.md`

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
