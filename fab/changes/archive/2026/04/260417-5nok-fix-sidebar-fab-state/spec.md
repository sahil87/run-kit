# Spec: Fix Sidebar Fab State Display

**Change**: 260417-5nok-fix-sidebar-fab-state
**Created**: 2026-04-17
**Affected memory**: `docs/memory/run-kit/architecture.md`

## Non-Goals

- Frontend rendering changes — the sidebar's `fab` line and window-row stage badge logic is correct; only the backend data supply is broken.
- Changes to the `/api/sessions` response schema — the JSON fields (`fabChange`, `fabStage`, `agentState`, `agentIdleDuration`) stay as-is.
- Changes to the pane-map cache (5s TTL, double-check pattern, graceful-degradation-on-error) — these characteristics are preserved.
- Changes to the `paneMap` join logic or `WindowInfo` struct fields.
- Changes to the SSE hot path or any top-bar component.

## Backend: Fab Enrichment Subprocess Invocation

### Requirement: Pane-map subprocess SHALL use the `fab` router on PATH

The backend MUST invoke the fab pane-map command via the `fab` router binary resolved through `$PATH`, not a hardcoded path to `fab-go` inside the repo. The router is the designed single entry point and handles per-project version resolution by reading `fab/project/config.yaml`.

The subprocess command SHALL be:

```
fab pane map --json --all-sessions
```

The subprocess `cmd.Dir` MUST be set to the resolved repo root so the router can locate `fab/project/config.yaml` for version dispatch.

#### Scenario: fab router is on PATH and repo is fab-managed

- **GIVEN** the `fab` binary is installed and reachable via `$PATH`
- **AND** the repo root contains `fab/project/config.yaml`
- **AND** there is at least one tmux window whose `WorktreePath` is inside that repo
- **WHEN** `FetchSessions` runs
- **THEN** `fetchPaneMap(repoRoot)` SHALL execute `fab pane map --json --all-sessions` with `cmd.Dir = repoRoot`
- **AND** the returned JSON SHALL be parsed into `map[string]paneMapEntry` keyed by `session:windowIndex`
- **AND** each `WindowInfo` whose key exists in the map SHALL have `FabChange`, `FabStage`, `AgentState`, and `AgentIdleDuration` populated from the matching entry

#### Scenario: fab router is not on PATH

- **GIVEN** the `fab` binary is not reachable via `$PATH`
- **WHEN** `FetchSessions` runs
- **THEN** the subprocess call SHALL fail with an `exec: "fab": executable file not found` error
- **AND** the error SHALL be returned from `fetchPaneMap` wrapped with any captured stderr (existing wrapping behavior preserved)
- **AND** the caller `FetchSessions` SHALL discard the error (existing graceful-degradation behavior preserved)
- **AND** every `WindowInfo` SHALL have empty `FabChange`/`FabStage`/`AgentState`/`AgentIdleDuration` strings

#### Scenario: subprocess exceeds timeout

- **GIVEN** `fab pane map` has been invoked
- **WHEN** it has not returned within 10 seconds
- **THEN** the 10-second `context.WithTimeout` SHALL cancel the subprocess
- **AND** the returned error SHALL propagate through `fetchPaneMap`
- **AND** the cache SHALL preserve any prior successful result (existing stale-cache behavior preserved)

### Requirement: Repo-root discovery SHALL use the fab-project identity marker

The `findRepoRoot(dir)` function MUST walk up from `dir` looking for the fab-project identity marker file `fab/project/config.yaml`. The prior marker `fab/.kit/bin/fab-go` is no longer valid because that binary was removed from the repo in commit `4a98547` (2026-03-05) and now lives under `~/.fab-kit/versions/{version}/kit/bin/fab-go`.

When the marker is found, the function SHALL return the directory containing `fab/project/config.yaml`. When walking up reaches the filesystem root without finding the marker, the function SHALL return the empty string.

#### Scenario: WorktreePath is the repo root

- **GIVEN** a tmux window with `WorktreePath = /home/user/code/proj` containing `fab/project/config.yaml`
- **WHEN** `findRepoRoot("/home/user/code/proj")` is called
- **THEN** it SHALL return `/home/user/code/proj`

#### Scenario: WorktreePath is a subdirectory of the repo

- **GIVEN** a tmux pane whose `cwd` (and thus the window's `WorktreePath`) is `/home/user/code/proj/app/frontend`
- **AND** `fab/project/config.yaml` exists at `/home/user/code/proj/fab/project/config.yaml`
- **WHEN** `findRepoRoot("/home/user/code/proj/app/frontend")` is called
- **THEN** it SHALL walk up until finding `/home/user/code/proj/fab/project/config.yaml`
- **AND** SHALL return `/home/user/code/proj`

#### Scenario: WorktreePath is outside any fab-managed repo

- **GIVEN** a tmux pane whose `cwd` is `/tmp/build` with no `fab/project/config.yaml` in any ancestor
- **WHEN** `findRepoRoot("/tmp/build")` is called
- **THEN** it SHALL walk up to the filesystem root without finding the marker
- **AND** SHALL return `""`

#### Scenario: empty repo root short-circuits pane-map fetch

- **GIVEN** `findRepoRoot` returned `""` for every tmux window
- **WHEN** `FetchSessions` runs
- **THEN** `repoRoot` SHALL be `""` at the `if repoRoot != ""` guard
- **AND** `fetchPaneMapCached` SHALL NOT be invoked
- **AND** every `WindowInfo` SHALL have empty fab fields (graceful degradation)

### Requirement: Subprocess error surface MUST preserve existing behavior

Changes to the subprocess invocation SHALL NOT alter the existing error propagation contract. Specifically:

- `fetchPaneMap` MUST continue to capture subprocess stderr in a `bytes.Buffer` and wrap it into the returned error on non-zero exit.
- `fetchPaneMapCached` MUST continue to preserve the stale cache entry on fetch error for graceful degradation.
- `FetchSessions` MUST continue to discard the pane-map error silently (fab fields stay empty — this is the documented graceful-degradation contract).

#### Scenario: subprocess exits non-zero with stderr output

- **GIVEN** `fab pane map --json --all-sessions` exits with code 1 and writes "ERROR: unable to read config" to stderr
- **WHEN** `fetchPaneMap` processes the failure
- **THEN** it SHALL return an error of the form `exit status 1: ERROR: unable to read config` (existing `fmt.Errorf("%w: %s", err, stderr.String())` format)
- **AND** no partial `map[string]paneMapEntry` SHALL be returned

## Testing: Coverage of Integration Path

### Requirement: A test SHALL exercise the end-to-end subprocess invocation when `fab` is available

The existing test suite covers `paneMapEntry` JSON parsing (`TestPaneMapEntryParsing`), the map join into `WindowInfo` (`TestPaneMapJoinPopulatesPerWindowFabFields`), nil-map handling (`TestPaneMapNilLeavesAllFieldsEmpty`), and the error path for a nonexistent binary (`TestFetchPaneMapNonexistentBinary`). It does NOT cover the success path — spawning the real `fab` router, verifying `findRepoRoot` discovers the marker, and confirming no error returns.

A new test `TestFetchPaneMapIntegration` SHALL be added to `app/backend/internal/sessions/sessions_test.go`. The test SHALL skip via `t.Skip` when `exec.LookPath("fab")` fails, so CI environments without fab-kit installed are not broken.

#### Scenario: fab is available on PATH

- **GIVEN** `exec.LookPath("fab")` returns a path to the fab router
- **AND** a temporary directory has been created with a valid `fab/project/config.yaml` referencing an installed `fab_version`
- **WHEN** `TestFetchPaneMapIntegration` runs
- **THEN** `findRepoRoot(tempDir)` SHALL return the temp directory
- **AND** `fetchPaneMap(tempDir)` SHALL return without error
- **AND** the returned map MAY be empty (no tmux panes inside the temp dir) — the test asserts absence of error, not specific map contents

#### Scenario: fab is not available on PATH

- **GIVEN** `exec.LookPath("fab")` returns an error
- **WHEN** `TestFetchPaneMapIntegration` runs
- **THEN** the test SHALL call `t.Skip("fab router not available on PATH")`

### Requirement: The nonexistent-binary test SHALL be updated to match the new invocation shape

`TestFetchPaneMapNonexistentBinary` currently passes `/nonexistent/path` as `repoRoot` and expects an error. With the new design, `fetchPaneMap` uses the `fab` router on PATH (not a path inside `repoRoot`), so the failure condition shifts. The test SHALL be updated to unambiguously exercise a failure: by setting `PATH=""` for the test (via `t.Setenv("PATH", "")`), OR by passing a repo root whose `fab/project/config.yaml` has an invalid `fab_version` the router cannot resolve. Either approach is acceptable — the test author SHALL pick the one with the clearest failure mode.

#### Scenario: fab not found due to empty PATH

- **GIVEN** the test clears `$PATH` via `t.Setenv("PATH", "")`
- **WHEN** `fetchPaneMap("/tmp")` is called
- **THEN** it SHALL return a non-nil error
- **AND** the returned `map[string]paneMapEntry` SHALL be nil

## Design Decisions

1. **Invoke `fab` router on PATH rather than locating `fab-go` directly**
   - *Why*: The router is the architectural entry point (`_cli-fab` SKILL, `fab-kit` Homebrew installation). It encapsulates version dispatch by reading `fab_version` from `fab/project/config.yaml`. Letting the backend call it keeps the backend ignorant of kit-internal layout, which is exactly the kind of coupling that just caused this regression.
   - *Rejected (option 2)*: Read `fab_version` from `fab/project/config.yaml` and exec `~/.fab-kit/versions/{version}/kit/bin/fab-go` directly. This reimplements what the router already does and keeps the backend tightly coupled to a path under `$HOME`.
   - *Rejected (option 3)*: Call `fab kit-path` first to resolve the kit root, then exec `{kit-path}/bin/fab-go`. Two subprocesses per call and still couples the backend to kit internals.

2. **Repo-root marker: `fab/project/config.yaml`**
   - *Why*: This file is the canonical fab-project identity marker. It is checked by `fab preflight` as a mandatory precondition and is guaranteed present in any fab-managed repo. It is unambiguous (no bare-folder collisions) and stable across fab-kit versions.
   - *Rejected*: Walking up for `fab/` as a directory — too permissive (any folder named `fab` would match). Walking up for `.git` — too restrictive (would return repo root rather than fab-project root, which may differ in non-trivial layouts).

3. **Integration test gated by `exec.LookPath("fab")`**
   - *Why*: The test exercises real subprocess invocation, which is exactly what was missing. Skipping when `fab` is absent keeps CI green for contributors without fab-kit, without degrading the test's value in environments where it can run.
   - *Rejected*: Pure unit test with `exec.Command` stubbed via interface — would not exercise the real integration and would not have caught this class of bug.

## Clarifications

### Session 2026-04-17 (auto-mode)

| # | Action | Detail |
|---|--------|--------|
| 10 | Upgraded to Certain | Verified via `grep -n "findRepoRoot" app/backend` — only two matches: the definition at `sessions.go:120/122` and the sole caller at `sessions.go:323`. No other callers exist, so the assumption is now factually confirmed rather than speculative. |

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Root cause is the stale `fab/.kit/bin/fab-go` lookup in `sessions.go` (L43, L124) | Confirmed from intake #1 via code reading, git log (`4a98547` deleted the binary 2026-03-05), and runtime verification against the live dev backend | S:95 R:80 A:95 D:95 |
| 2 | Certain | Fix: replace the hardcoded path with `exec.CommandContext(ctx, "fab", "pane", "map", "--json", "--all-sessions")` with `cmd.Dir = repoRoot` | Upgraded from intake Confident (#2) — the `_cli-fab` SKILL and router architecture unambiguously designate this as the supported invocation shape. The command name change (`pane-map` → `pane map`) is documented in `_cli-fab` | S:90 R:70 A:90 D:85 |
| 3 | Certain | `findRepoRoot` marker changes to `fab/project/config.yaml` | Upgraded from intake Confident (#3) — `fab preflight` validates this file as a mandatory precondition (see preflight output), making it the canonical identity marker. No bare-folder false positives possible | S:90 R:75 A:90 D:85 |
| 4 | Certain | No frontend changes required | Upgraded from intake Confident (#4) — explicitly verified: `status-panel.tsx:147-190` and `window-row.tsx:154-158` render correctly when fields are populated (existing tests pass with populated mock data). The bug is purely backend data-starvation | S:90 R:85 A:95 D:90 |
| 5 | Confident | Integration test `TestFetchPaneMapIntegration` SHALL skip when `fab` is not on PATH via `exec.LookPath` | Upgraded from intake Tentative (#5) — after checking `code-quality.md` (tests required for new features/bug fixes), an integration test is non-negotiable, and the skip gate is standard Go idiom for environment-dependent tests. The alternative (failing when fab is absent) would break CI for contributors without fab-kit | S:70 R:70 A:75 D:65 |
| 6 | Confident | `TestFetchPaneMapNonexistentBinary` SHALL be updated to exercise a failure via `t.Setenv("PATH", "")` | New (discovered during spec generation). The test's current premise (bad `repoRoot` → error) no longer holds since `repoRoot` is only used for `cmd.Dir`, not binary lookup. Clearing PATH is the cleanest way to force the expected failure | S:70 R:75 A:75 D:65 |
| 7 | Confident | Existing 10-second context timeout SHALL be preserved | New. Constitution requires timeouts on all `exec.CommandContext`; code-review rules mandate explicit timeouts. The existing 10s bound is appropriate (pane-map scans tmux panes — typically sub-second but can spike on large tmux servers) | S:75 R:80 A:80 D:75 |
| 8 | Confident | The 5-second pane-map cache TTL, double-check pattern, and stale-on-error fallback SHALL be preserved unchanged | New. These are orthogonal to the fix and justified by the "performance carve-out" in code-quality.md (documented in `architecture.md`). Touching them would expand scope | S:80 R:75 A:80 D:80 |
| 9 | Confident | Architecture memory at `docs/memory/run-kit/architecture.md` SHALL be updated to reflect the `fab pane map` invocation and new marker | Discovered during spec generation. Intake #9 (Affected Memory section) lists this update. Lines referencing `fab-go pane-map --json --all-sessions` and `fab/.kit/bin/fab-go` must be rewritten. Hydrate stage applies the change to memory | S:80 R:85 A:85 D:80 |
| 10 | Certain | No new `findRepoRoot` callers need to be added; only the existing caller in `FetchSessions` uses the result | <!-- clarified: verified in auto-mode via `grep -n findRepoRoot app/backend` — exactly one caller at sessions.go:323. No additional callers exist. --> Upgraded from Tentative — grep across `app/backend` confirms `findRepoRoot` has one and only one caller (`sessions.go:323`). No speculation remains | S:95 R:85 A:95 D:95 |

10 assumptions (5 certain, 5 confident, 0 tentative, 0 unresolved).
