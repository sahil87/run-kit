# Spec: Pane Map Enrichment

**Change**: 260313-3vlx-pane-map-enrichment
**Created**: 2026-03-13
**Affected memory**: `docs/memory/run-kit/architecture.md`

## Non-Goals

- Frontend changes — `WindowInfo` JSON shape is unchanged, the sidebar/top bar render the same fields
- Changing the SSE polling interval or hub architecture
- Adding new fields to `WindowInfo` beyond what already exists

## Backend: Pane Map Caller

### Requirement: fetchPaneMap function

The sessions package SHALL provide a `fetchPaneMap()` function that executes `fab/.kit/bin/fab-go pane-map --json --all-sessions` via `exec.CommandContext` with a 10-second timeout. The function SHALL parse the JSON array output into a Go struct slice and return a lookup map keyed by `"session_name:window_index"`.

The binary path SHALL be resolved as `filepath.Join(repoRoot, "fab/.kit/bin/fab-go")` where `repoRoot` is the run-kit repository root. The function SHALL accept `repoRoot` as a parameter.

#### Scenario: Successful pane-map call

- **GIVEN** `fab-go` is installed at `fab/.kit/bin/fab-go` and tmux is running
- **WHEN** `fetchPaneMap(repoRoot)` is called
- **THEN** it returns a map of `"session:windowIndex"` → pane-map entry with `Change`, `Stage`, `AgentState`, `AgentIdleDuration` fields populated from JSON
- **AND** null JSON values map to empty strings in the Go struct

#### Scenario: fab-go binary not found

- **GIVEN** `fab/.kit/bin/fab-go` does not exist at the resolved path
- **WHEN** `fetchPaneMap(repoRoot)` is called
- **THEN** it returns `nil, error`
- **AND** the error is not propagated to the SSE layer (caller handles graceful degradation)

#### Scenario: fab-go command times out

- **GIVEN** `fab-go pane-map` takes longer than 10 seconds
- **WHEN** `fetchPaneMap(repoRoot)` is called
- **THEN** the context deadline kills the process and returns an error

#### Scenario: fab-go returns invalid JSON

- **GIVEN** `fab-go pane-map --json` returns malformed output
- **WHEN** `fetchPaneMap(repoRoot)` is called
- **THEN** it returns `nil, error`

### Requirement: paneMapEntry struct

The pane-map entry struct SHALL match the JSON output of `fab pane-map --json`:

```go
type paneMapEntry struct {
    Session           string  `json:"session"`
    WindowIndex       int     `json:"window_index"`
    Pane              string  `json:"pane"`
    Tab               string  `json:"tab"`
    Worktree          string  `json:"worktree"`
    Change            *string `json:"change"`
    Stage             *string `json:"stage"`
    AgentState        *string `json:"agent_state"`
    AgentIdleDuration *string `json:"agent_idle_duration"`
}
```

Nullable JSON fields (change, stage, agent_state, agent_idle_duration) SHALL use `*string` to distinguish null from empty string.

#### Scenario: Non-fab pane in JSON output

- **GIVEN** a pane-map JSON entry has `"change": null, "stage": null, "agent_state": null`
- **WHEN** parsed into `paneMapEntry`
- **THEN** `Change`, `Stage`, `AgentState` are all `nil`
- **AND** the corresponding `WindowInfo` fields remain empty strings after join

## Backend: FetchSessions Integration

### Requirement: Replace enrichment with pane-map join

`FetchSessions()` SHALL call `fetchPaneMap()` once at the top of the function (after listing sessions, before building results). In the window-building loop, each window SHALL be looked up by `"sessionName:windowIndex"` key. When a match is found, `FabChange`, `FabStage`, `AgentState`, and `AgentIdleDuration` SHALL be populated from the pane-map entry.

The `repoRoot` for `fetchPaneMap()` SHALL be derived from the first session's first window's `WorktreePath` — walking up to find the repo root. However, since all run-kit instances serve from the same repo, `repoRoot` MAY be derived once from any available window.
<!-- clarified: repoRoot derived from first available window's WorktreePath — verified: sessions.go lines 105-108 already derive projectRoot from windows[0].WorktreePath, same pattern applies -->

#### Scenario: Normal enrichment via pane-map

- **GIVEN** tmux has 2 sessions with 3 windows each, some in fab worktrees
- **WHEN** `FetchSessions()` is called
- **THEN** each window's fab fields are populated per-window from pane-map data (not per-session)
- **AND** windows in different worktrees with different active changes show different `FabChange` values

#### Scenario: Pane-map call fails gracefully

- **GIVEN** `fetchPaneMap()` returns an error (binary missing, timeout, parse error)
- **WHEN** `FetchSessions()` is called
- **THEN** all windows have empty fab fields (FabChange, FabStage, AgentState, AgentIdleDuration are empty strings)
- **AND** no error is returned from `FetchSessions()` — sessions and windows are still returned normally

#### Scenario: Window not in pane-map

- **GIVEN** pane-map output does not contain an entry for a specific session:windowIndex
- **WHEN** `FetchSessions()` builds that window's result
- **THEN** the window's fab fields remain empty strings

### Requirement: Remove per-session enrichment

`FetchSessions()` SHALL NOT call `enrichSession()`. The `hasFabKit()` check, `projectRoot` derivation from window 0, `runtimeCache sync.Map`, and parallel enrichment goroutine block SHALL all be removed. The import of `run-kit/internal/fab` SHALL be removed from `sessions.go`.

#### Scenario: Sessions without fab-kit

- **GIVEN** a tmux session whose windows are in non-fab directories
- **WHEN** `FetchSessions()` is called and pane-map returns null fab fields for those windows
- **THEN** those windows have empty fab fields, same behavior as before

### Requirement: RepoRoot resolution

The sessions package SHALL provide a function to resolve the run-kit repository root. This MAY use `os.Executable()` to find the running binary's location and derive the repo root, OR it MAY accept the repo root as a configuration value. The simplest approach: since `FetchSessions()` already knows window paths, derive `repoRoot` from the first available `WorktreePath` by checking for the `fab/.kit/bin/fab-go` binary existence.
<!-- clarified: repoRoot derived by walking available WorktreePaths — verified: existing FetchSessions uses windows[0].WorktreePath for projectRoot; same pattern, no config changes needed -->

#### Scenario: No windows available for repo root

- **GIVEN** all sessions have zero windows or all windows have empty WorktreePaths
- **WHEN** `FetchSessions()` attempts to derive repoRoot
- **THEN** `fetchPaneMap()` is skipped (no repoRoot available) and all windows have empty fab fields

## Backend: Remove internal/fab package

### Requirement: Delete internal/fab

The entire `internal/fab/` directory SHALL be deleted:
- `fab.go` — `ReadState()`, `statusFile` struct, `stageOrder`
- `fab_test.go` — tests for `ReadState()`
- `runtime.go` — `ReadRuntime()`, `ReadRuntimeWithNow()`, `FormatIdleDuration()`
- `runtime_test.go` — tests for runtime reading

No other package in the codebase imports `internal/fab` (verified: only `internal/sessions/sessions.go`).

#### Scenario: Clean removal

- **GIVEN** `internal/fab/` is the only package providing `ReadState()` and `ReadRuntime()`
- **WHEN** the package is deleted and `sessions.go` no longer imports it
- **THEN** `go build ./...` succeeds with no compilation errors
- **AND** `go test ./...` passes (no dangling references)

## Backend: Remove enrichment scaffolding

### Requirement: Remove enrichment functions from sessions.go

The following SHALL be removed from `internal/sessions/sessions.go`:
- `hasFabKit()` function
- `enrichSession()` function
- The `import "run-kit/internal/fab"` line
- The `runtimeCache sync.Map` and parallel enrichment goroutine block in `FetchSessions()`
- The `projectRoot` derivation logic (window 0's WorktreePath used as project root)

#### Scenario: Removed functions no longer referenced

- **GIVEN** `hasFabKit()` and `enrichSession()` are removed
- **WHEN** `go vet ./...` is run
- **THEN** no "declared and not used" or "undefined" errors

### Requirement: Update sessions_test.go

Tests that reference `hasFabKit()` and `enrichSession()` SHALL be replaced with tests for the new pane-map integration. Tests SHALL verify:
- Pane-map lookup populates per-window fab fields
- Missing pane-map entries leave fab fields empty
- Failed `fetchPaneMap()` results in empty fab fields for all windows

#### Scenario: New test coverage

- **GIVEN** the new `fetchPaneMap()` and pane-map join logic
- **WHEN** `go test ./internal/sessions/...` is run
- **THEN** tests cover: successful join, missing entries, parse errors, and graceful degradation

## Deprecated Requirements

### Per-session fab enrichment via direct file reading

**Reason**: Replaced by per-window enrichment via `fab pane-map --json --all-sessions` subprocess call. The old model read `.fab-status.yaml` from window 0's project root and applied the same change/stage to all windows in a session. The new model resolves per-pane/per-window via the pane-map CLI.

**Migration**: `fetchPaneMap()` replaces `enrichSession()`, `hasFabKit()`, `ReadState()`, and `ReadRuntime()`.

### internal/fab package (ReadState, ReadRuntime)

**Reason**: All functionality replaced by pane-map subprocess. Direct `.fab-status.yaml` and `.fab-runtime.yaml` reading is no longer needed.

**Migration**: Deleted entirely. No other consumers.

## Design Decisions

1. **Subprocess call to `fab-go pane-map` over direct file reading**: The new approach calls `fab-go pane-map --json --all-sessions` once per SSE tick instead of reading `.fab-status.yaml` + `.fab-runtime.yaml` per session.
   - *Why*: Decouples from internal file formats (`.fab-runtime.yaml` structure, `.fab-status.yaml` stage parsing). Provides per-window resolution instead of per-session. Single call replaces N file reads + N runtime reads.
   - *Rejected*: Keeping direct file reading with per-window logic — would require run-kit to understand worktree-to-change mapping, duplicating logic already in `fab-go`.

2. **Join key `session_name:window_index`**: The pane-map output includes `session` and `window_index` fields. The join key concatenates these to match run-kit's existing `SessionInfo.Name` + `WindowInfo.Index`.
   - *Why*: Direct 1:1 mapping to existing data model. No additional lookups needed.
   - *Rejected*: Joining by pane ID — run-kit doesn't track pane IDs, only session:window pairs.

3. **`*string` for nullable pane-map JSON fields**: Fields like `change`, `stage`, `agent_state` are null in JSON for non-fab panes.
   - *Why*: `*string` is idiomatic Go for nullable JSON strings. Distinguishes "no value" (null → nil) from "empty string".
   - *Rejected*: Using `string` with empty-string convention — loses null semantics, though functionally equivalent for this use case.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Delete entire `internal/fab/` package | Confirmed from intake #1 — discussed, all functionality replaced by pane-map | S:90 R:85 A:90 D:95 |
| 2 | Certain | Single `pane-map --json --all-sessions` call per poll cycle | Confirmed from intake #2 — one call replaces N file reads | S:90 R:90 A:90 D:95 |
| 3 | Certain | Join key is `session_name:window_index` | Confirmed from intake #3 — matches run-kit's existing window identification | S:90 R:90 A:90 D:95 |
| 4 | Certain | `WindowInfo` struct fields unchanged, only data source changes | Confirmed from intake #4 — frontend contract preserved | S:90 R:95 A:90 D:95 |
| 5 | Confident | Graceful degradation when pane-map fails | Confirmed from intake #5 — constitution says state derived at request time, missing enrichment acceptable | S:75 R:90 A:85 D:85 |
| 6 | Confident | Use `*string` (nullable) for pane-map JSON fields | Confirmed from intake #6 — matches pane-map null semantics | S:80 R:85 A:80 D:85 |
| 7 | Certain | Use `fab/.kit/bin/fab-go` from run-kit's own repo root | Confirmed from intake #7 — binary bundled, path deterministic | S:90 R:90 A:90 D:95 |
| 8 | Confident | RepoRoot derived from first available WorktreePath | Similar to existing projectRoot derivation from window 0; simpler than `os.Executable()` or config | S:75 R:80 A:75 D:80 |
| 9 | Certain | 10-second timeout for pane-map subprocess | Matches existing `TmuxTimeout` constant used for all tmux operations | S:90 R:90 A:90 D:95 |

9 assumptions (6 certain, 3 confident, 0 tentative, 0 unresolved).
