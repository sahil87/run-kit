# Tasks: Pane Map Enrichment

**Change**: 260313-3vlx-pane-map-enrichment
**Spec**: `spec.md`
**Intake**: `intake.md`

## Phase 1: Setup

- [x] T001 Add `paneMapEntry` struct and `fetchPaneMap()` function to `app/backend/internal/sessions/sessions.go` — struct matches pane-map JSON output with `*string` for nullable fields. Function runs `fab/.kit/bin/fab-go pane-map --json --all-sessions` via `exec.CommandContext` with 10s timeout, parses JSON into `[]paneMapEntry`, returns `map[string]paneMapEntry` keyed by `"session:windowIndex"`. Accepts `repoRoot string` parameter.

## Phase 2: Core Implementation

- [x] T002 Integrate `fetchPaneMap()` into `FetchSessions()` in `app/backend/internal/sessions/sessions.go` — after fetching all windows in parallel, derive `repoRoot` from first available `WorktreePath`, call `fetchPaneMap(repoRoot)` once. In the result-building loop, look up each window by `"sessionName:windowIndex"` key and populate `FabChange`, `FabStage`, `AgentState`, `AgentIdleDuration` from pane-map entry (dereference `*string` to `string`, nil → empty).
- [x] T003 Remove `enrichSession()`, `hasFabKit()`, `runtimeCache sync.Map`, parallel enrichment goroutine block, and `projectRoot` derivation from `FetchSessions()` in `app/backend/internal/sessions/sessions.go`. Remove the `import "run-kit/internal/fab"` line and `"sync"` import if no longer needed.

## Phase 3: Integration & Edge Cases

- [x] T004 Delete entire `app/backend/internal/fab/` directory — `fab.go`, `fab_test.go`, `runtime.go`, `runtime_test.go` (4 files).
- [x] T005 Rewrite `app/backend/internal/sessions/sessions_test.go` — remove tests for `hasFabKit()`, `enrichSession()` (with all agent state variants). Add tests for: (a) `fetchPaneMap()` with mock JSON response, (b) pane-map join populates per-window fab fields, (c) missing pane-map entry leaves fab fields empty, (d) `fetchPaneMap()` error results in empty fab fields for all windows.
- [x] T006 Run `cd app/backend && go build ./...` and `cd app/backend && go test ./...` to verify clean compilation and passing tests.

---

## Execution Order

- T001 blocks T002 (fetchPaneMap must exist before integration)
- T002 blocks T003 (new enrichment must work before removing old)
- T003 blocks T004 (remove import before deleting package)
- T004 and T005 can run in parallel after T003
- T006 runs last (verification)
