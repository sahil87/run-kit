# Intake: Fix Sidebar Fab State Display

**Change**: 260417-5nok-fix-sidebar-fab-state
**Created**: 2026-04-17
**Status**: Draft

## Origin

User ran `/fab-new` with the observation:

> fab states are not captured correctly in the left pane. I have almost never seen a line there saying 'fab' - I am pretty certain this feature doesn't work

One-shot intake — no prior conversation. The user reported a symptom; investigation during intake generation confirmed a concrete root cause backed by code reading, commit history, and runtime verification against the live dev server.

## Why

The sidebar `Pane` panel (`app/frontend/src/components/sidebar/status-panel.tsx`) is designed to surface a `fab <id> <slug> · <stage>` line whenever the selected window is bound to a fab change. It falls back to a plain `run <command>` line otherwise. The user's observation that the `fab` line "almost never" appears is correct and fully explained by a broken backend dependency lookup — the enrichment data is never populated, so every window falls through to the `run` branch.

**Concrete problem**: `app/backend/internal/sessions/sessions.go` hard-codes a relative path to the `fab-go` binary that was removed from the repo over a month ago:

- `sessions.go:43` — `bin := filepath.Join(repoRoot, "fab/.kit/bin/fab-go")`
- `sessions.go:120-134` — `findRepoRoot()` walks up from `WindowInfo.WorktreePath` looking for the same `fab/.kit/bin/fab-go` file, returning `""` when it isn't found.
- Commit `4a98547` ("Removing go", 2026-03-05) deleted `fab/.kit/bin/fab-go` (7MB binary) from the repo. Since then `fab-go` has lived exclusively under `~/.fab-kit/versions/{fab_version}/kit/bin/fab-go`, resolved by the `fab` router on PATH based on `fab_version` in `fab/project/config.yaml`.

**Consequence**: `findRepoRoot()` always returns `""` → `repoRoot` is empty → the `if repoRoot != ""` guard at `sessions.go:337` skips `fetchPaneMapCached()` entirely → `paneMap` stays `nil` → the enrichment join at `sessions.go:357-362` never runs → `FabChange`, `FabStage`, `AgentState`, and `AgentIdleDuration` stay empty strings on every `WindowInfo`.

**Why tests didn't catch it**: `sessions_test.go` tests the enrichment _join_ (`TestPaneMapJoinPopulatesPerWindowFabFields`) and the parsing of pane-map JSON (`TestPaneMapEntryParsing`) using pre-constructed `paneMap` values. `TestFetchPaneMapNonexistentBinary` only verifies that a missing binary returns an error — it does not verify that a correctly-installed `fab-go` is discoverable. No test exercises `findRepoRoot()` or the end-to-end path from an active tmux session through to populated `fabChange`/`fabStage` fields. The mock-heavy suite masked the regression.

**Runtime verification** (performed during this intake):

1. `fab pane map --all-sessions --json` executed from `/home/sahil/code/sahil87/run-kit` returns correct per-window `change`/`stage`/`agent_state` fields for all fab worktrees — the CLI itself works.
2. The live dev backend on `localhost:3000` returns session JSON where every window omits `fabChange`/`fabStage` (they are absent, not null — `omitempty` drops zero values). Example: `curl -s http://localhost:3000/api/sessions | jq '.[0].windows[0]'` shows no fab fields.
3. `fab/.kit/bin/fab-go` does not exist in the main repo, the agile-orca worktree, or any other worktree — verified via `find /home/sahil/code/sahil87/run-kit -name "fab-go"` which returned no matches.

**Consequence of inaction**: The sidebar loses its primary differentiator for fab-managed windows — users cannot tell at a glance which window belongs to which change, the stage it is in, or whether its agent is active/idle. The `window-row.tsx:154-158` stage badge on each row of the sidebar list is also broken (same root cause — `win.fabStage` never populated). Features layered on top of this enrichment (e.g., the `agt` agent-state row in `status-panel.tsx:199-205`) are silently dead code.

**Why this approach over alternatives**: The cleanest fix is to invoke the `fab` router on PATH (`exec.CommandContext(ctx, "fab", "pane", "map", "--json", "--all-sessions")`) rather than trying to locate `fab-go` directly. The router is the documented entry point (`docs/memory/run-kit/architecture.md:73` already describes the subprocess as `fab-go pane-map --json --all-sessions`; updating to call `fab pane map` is a minor adjustment). The router reads `fab_version` from `fab/project/config.yaml` and dispatches to the correct per-version `fab-go` — this isolates the backend from future kit layout changes.

## What Changes

### 1. Replace hardcoded `fab-go` path with `fab` router invocation

`app/backend/internal/sessions/sessions.go`:

**Before** (lines 39-75, `fetchPaneMap`):

```go
func fetchPaneMap(repoRoot string) (map[string]paneMapEntry, error) {
    ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
    defer cancel()

    bin := filepath.Join(repoRoot, "fab/.kit/bin/fab-go")
    cmd := exec.CommandContext(ctx, bin, "pane-map", "--json", "--all-sessions")
    ...
}
```

**After** (proposed):

```go
func fetchPaneMap(repoRoot string) (map[string]paneMapEntry, error) {
    ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
    defer cancel()

    cmd := exec.CommandContext(ctx, "fab", "pane", "map", "--json", "--all-sessions")
    cmd.Dir = repoRoot
    var stderr bytes.Buffer
    cmd.Stderr = &stderr
    out, err := cmd.Output()
    ...
}
```

Key points:
- Use the `fab` system binary on PATH (installed via Homebrew per `_cli-fab` SKILL).
- Set `cmd.Dir = repoRoot` so the router can locate `fab/project/config.yaml` for version resolution.
- Command-line shape changes from `pane-map` (legacy `fab-go` subcommand) to `pane map` (router `fab pane map`). The JSON schema is unchanged.

### 2. Replace `findRepoRoot` lookup marker

`sessions.go:120-134` must find the repo root via a marker that actually exists. Options (in order of preference):

- **Preferred**: Walk up looking for `fab/project/config.yaml`. This file is the fab-project identity marker and is guaranteed present in a fab-managed repo (per `fab preflight` validation).
- Alternative: Walk up looking for `fab/` directory.

**Proposed**:

```go
func findRepoRoot(dir string) string {
    for {
        candidate := filepath.Join(dir, "fab/project/config.yaml")
        if _, err := os.Stat(candidate); err == nil {
            return dir
        }
        parent := filepath.Dir(dir)
        if parent == dir {
            return ""
        }
        dir = parent
    }
}
```

Update the doc comment accordingly: "walks up from dir until it finds a directory containing fab/project/config.yaml (the fab-project identity marker)".

### 3. Error handling for missing `fab` on PATH

Currently an `exec` failure with a non-existent binary yields `exec: "fab-go": file does not exist`. After the change, the failure mode is `exec: "fab": executable file not found in $PATH`. The existing error wrapping in `fetchPaneMap` already surfaces stderr and wraps the error — no new error handling required. The caller (`FetchSessions`) already discards the error silently, producing empty fab fields on all windows (graceful degradation), which matches the current contract.

### 4. Add integration test exercising the full path

Add a new test (e.g., `TestFetchPaneMapIntegration`) that:

- Skips when `fab` is not on PATH (`if _, err := exec.LookPath("fab"); err != nil { t.Skip(...) }`).
- Creates a temporary repo with `fab/project/config.yaml` containing a known `fab_version`.
- Verifies `findRepoRoot` discovers it.
- Verifies `fetchPaneMap(repoRoot)` returns without error (even if the map is empty — the test only proves the subprocess invocation works).

This prevents silent regressions of the same class.

### 5. Update architecture memory

`docs/memory/run-kit/architecture.md` currently refers to the subprocess as `fab-go pane-map --json --all-sessions` (e.g., line 73, 82, 92, 93). Update these to `fab pane map --json --all-sessions` to reflect the router invocation.

## Affected Memory

- `run-kit/architecture.md`: (modify) update `fab-go pane-map` subprocess references to `fab pane map` and reflect the repo-root marker change (`fab/project/config.yaml` instead of `fab/.kit/bin/fab-go`).

## Impact

**Backend code**:
- `app/backend/internal/sessions/sessions.go` — `fetchPaneMap` (L39-75), `findRepoRoot` (L120-134), doc comments.
- `app/backend/internal/sessions/sessions_test.go` — update `TestFetchPaneMapNonexistentBinary` expectations if needed; add `TestFetchPaneMapIntegration`.

**Frontend code**: No changes. Existing rendering logic in `status-panel.tsx:147-190` and `window-row.tsx:154-158` already handles populated fields correctly — it was starved of data, not broken.

**Docs**: `docs/memory/run-kit/architecture.md` (see above).

**Dependencies / systems**:
- Runtime dependency on the `fab` router being present on PATH (already a practical prerequisite: `fab doctor` checks install, and the daemon is typically run in an environment with fab installed).
- 5-second TTL pane-map cache unchanged; performance characteristics preserved.
- API contract (`/api/sessions` response shape) unchanged.

**Out of scope**:
- SSE pub/sub path (doesn't touch pane-map).
- Top-bar rendering (separate component, uses the same enriched fields — will start working as a side effect).
- Frontend tests (they already mock populated fields).

## Open Questions

- Should the integration test be gated on `fab` availability (skip) or mark the test suite as requiring fab? Proposal: skip when absent, to avoid CI friction on contributor machines without fab-kit installed.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Root cause is the stale `fab/.kit/bin/fab-go` lookup in `sessions.go` | Confirmed by reading code (L43, L124), git log (commit `4a98547` deleted the binary on 2026-03-05), and runtime verification (live backend returns windows with no fab fields while `fab pane map` CLI works) | S:95 R:80 A:95 D:95 |
| 2 | Confident | Replace binary path lookup with a `fab` router invocation on PATH (option 1) over version-resolving `fab-go` directly (option 2) or invoking via `fab kit-path` (option 3) | Architecture docs (`_cli-fab` SKILL) designate the router as the sole entry point; this isolates the backend from future kit layout changes. Options 2 and 3 both reimplement logic the router already encapsulates | S:75 R:65 A:80 D:70 |
| 3 | Confident | Use `fab/project/config.yaml` as the new `findRepoRoot` marker | This file is the canonical fab-project identity marker (checked by `fab preflight`) and is guaranteed to exist in any fab-managed repo. Walking up looking for `fab/` alone is too permissive (any folder named fab would match) | S:75 R:70 A:80 D:75 |
| 4 | Confident | No frontend changes required | The rendering logic in `status-panel.tsx` and `window-row.tsx` correctly handles populated `fabChange`/`fabStage` fields; the bug is purely an upstream data-starvation issue. Empirical check: existing tests pass with populated mock data | S:85 R:80 A:90 D:80 |
| 5 | Tentative | Add a gated integration test (`TestFetchPaneMapIntegration`) that skips when `fab` is absent on PATH | Integration test would prevent regression of this exact class, but CI environment behavior for optional dependencies is unspecified and the skip approach is a judgment call. Alternative: a pure unit test that stubs `exec.LookPath` and `exec.Command`, but that would not exercise the real router invocation | S:50 R:70 A:60 D:55 |

5 assumptions (1 certain, 3 confident, 1 tentative, 0 unresolved).
