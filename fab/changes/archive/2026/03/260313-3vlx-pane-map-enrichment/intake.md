# Intake: Pane Map Enrichment

**Change**: 260313-3vlx-pane-map-enrichment
**Created**: 2026-03-13
**Status**: Draft

## Origin

> Replace run-kit's direct `.fab-status.yaml` / `.fab-runtime.yaml` file reading with a single `fab pane-map --json --all-sessions` call per poll cycle, giving per-window fab state instead of per-session.

Discussion context: The sidebar shows tmux sessions and windows. The backend poller (every 2.5s via SSE hub) enriches each `WindowInfo` with fab state. Currently `enrichSession()` reads `.fab-status.yaml` from the first window's project root and applies the same change/stage to ALL windows. Fab worktree windows running different changes all show identical — or no — fab state. `fab pane-map --json --all-sessions` resolves per-pane, which is exactly what's needed.

## Why

1. **Per-window fab state**: Each fab worktree window should show its own change name, pipeline stage, and agent state — not inherit a session-level value from a single `.fab-status.yaml` symlink.

2. **Simpler code**: The current enrichment logic involves reading two YAML files, navigating nested maps, caching runtime state per project root, and applying state uniformly. Replacing it with a single subprocess call + JSON parse + map join is fewer lines and fewer failure modes.

3. **Decouples from internal file formats**: `.fab-runtime.yaml` is a fab-kit implementation detail. Using `pane-map` as the interface means run-kit doesn't break if fab-kit changes its internal state files.

## What Changes

### 1. Add pane-map caller

Create a new function (e.g., `fetchPaneMap()`) that:
- Runs `fab pane-map --json --all-sessions` via `exec.CommandContext` with a timeout
- Parses the JSON array output into a Go struct slice
- Builds and returns a lookup map keyed by `"session_name:window_index"` → fab fields

The struct for each pane-map entry:
```go
type paneMapEntry struct {
    Session           string  `json:"session"`
    WindowIndex       int     `json:"window_index"`
    Pane              string  `json:"pane"`
    Tab               string  `json:"tab"`
    Worktree          string  `json:"worktree"`
    Change            *string `json:"change"`             // null when no change
    Stage             *string `json:"stage"`               // null when no stage
    AgentState        *string `json:"agent_state"`         // null when not fab
    AgentIdleDuration *string `json:"agent_idle_duration"` // null when not idle
}
```

### 2. Integrate into FetchSessions()

In `FetchSessions()`, call `fetchPaneMap()` once at the top of the function. This replaces the per-session `enrichSession()` calls. In the window-building loop, look up each window by `"session:index"` key and populate `FabChange`, `FabStage`, `AgentState`, `AgentIdleDuration` from the pane-map data.

If `fetchPaneMap()` fails (e.g., `fab-go` not installed, no tmux), gracefully degrade — windows get empty fab fields, same as today for non-fab projects. No error propagation to the SSE layer.

### 3. Remove `internal/fab/` package

Delete the entire `internal/fab/` directory (4 files):
- `fab.go` — `ReadState()`, `statusFile` struct
- `fab_test.go` — tests for `ReadState()`
- `runtime.go` — `ReadRuntime()`, `ReadRuntimeWithNow()`, `FormatIdleDuration()`
- `runtime_test.go` — tests for runtime reading

### 4. Remove enrichment scaffolding from sessions.go

Remove from `internal/sessions/sessions.go`:
- `hasFabKit()` function
- `enrichSession()` function
- The `import "run-kit/internal/fab"` line
- The `runtimeCache sync.Map` and parallel enrichment goroutine block
- The `projectRoot` derivation logic (first window's `WorktreePath` used as project root)

### 5. Locate `fab-go` binary

The `fab pane-map` command is provided by `fab-go`, which is bundled with run-kit at `fab/.kit/bin/fab-go`. The backend knows its own repo root, so the path is deterministic: `filepath.Join(repoRoot, "fab/.kit/bin/fab-go")`. No `$PATH` discovery, no environment variables, no fallback logic.

## Affected Memory

- `run-kit/architecture`: (modify) Document pane-map as the fab state data source, removing references to direct file reading

## Impact

- **`app/backend/internal/sessions/sessions.go`** — main change: replace enrichment with pane-map call + join
- **`app/backend/internal/fab/`** — deleted entirely (4 files)
- **`app/backend/internal/sessions/sessions_test.go`** — update tests (if any) that reference enrichment
- **Frontend**: No changes — `WindowInfo` JSON shape is unchanged
- **Dependency**: Requires fab-kit `260313-wrt4-pane-map-json-session-flags` to be merged first

## Open Questions

- None — design was discussed and agreed upon.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Delete entire `internal/fab/` package | Discussed — all functionality replaced by pane-map | S:90 R:85 A:90 D:95 |
| 2 | Certain | Single `pane-map --json --all-sessions` call per poll cycle | Discussed — one call replaces N file reads | S:90 R:90 A:90 D:95 |
| 3 | Certain | Join key is `session_name + window_index` | Discussed — matches run-kit's existing window identification | S:90 R:90 A:90 D:95 |
| 4 | Certain | `WindowInfo` struct fields unchanged, only data source changes | Discussed — frontend contract preserved | S:90 R:95 A:90 D:95 |
| 5 | Confident | Graceful degradation when pane-map fails | Constitution says no database, state derived at request time — missing enrichment is acceptable | S:75 R:90 A:85 D:85 |
| 6 | Confident | Use `*string` (nullable) for pane-map JSON fields | Matches pane-map's null semantics for non-fab panes | S:80 R:85 A:80 D:85 |
| 7 | Certain | Use `fab/.kit/bin/fab-go` from run-kit's own repo root | Discussed — binary is bundled, path is deterministic, no discovery needed | S:90 R:90 A:90 D:95 |

7 assumptions (5 certain, 2 confident, 0 tentative, 0 unresolved).
