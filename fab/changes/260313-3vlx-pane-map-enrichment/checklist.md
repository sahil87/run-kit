# Quality Checklist: Pane Map Enrichment

**Change**: 260313-3vlx-pane-map-enrichment
**Generated**: 2026-03-14
**Spec**: `spec.md`

## Functional Completeness

- [x] CHK-001 fetchPaneMap function: Runs `fab-go pane-map --json --all-sessions` with 10s timeout and returns parsed map
- [x] CHK-002 paneMapEntry struct: Matches JSON output with `*string` for nullable fields (change, stage, agent_state, agent_idle_duration)
- [x] CHK-003 FetchSessions pane-map integration: Calls fetchPaneMap once, joins by `session:windowIndex`, populates per-window fab fields
- [x] CHK-004 internal/fab deletion: Entire directory removed (fab.go, fab_test.go, runtime.go, runtime_test.go)
- [x] CHK-005 Enrichment scaffolding removal: hasFabKit(), enrichSession(), runtimeCache, projectRoot derivation, fab import all removed from sessions.go

## Behavioral Correctness

- [x] CHK-006 Per-window enrichment: Windows in different worktrees with different active changes show different FabChange values (not session-level)
- [x] CHK-007 Graceful degradation: fetchPaneMap failure results in empty fab fields, no error propagation to SSE layer

## Removal Verification

- [x] CHK-008 internal/fab package: No remaining imports of `run-kit/internal/fab` anywhere in codebase
- [x] CHK-009 enrichSession function: Not referenced anywhere after removal
- [x] CHK-010 hasFabKit function: Not referenced anywhere after removal

## Scenario Coverage

- [x] CHK-011 Successful pane-map call: Test verifies parsed map with correct key format and field population
- [x] CHK-012 Missing pane-map entry: Test verifies window fab fields remain empty strings
- [x] CHK-013 fetchPaneMap error: Test verifies all windows get empty fab fields
- [x] CHK-014 Non-fab pane null fields: Null JSON values map to nil pointers, then empty strings in WindowInfo

## Edge Cases & Error Handling

- [x] CHK-015 No windows available: fetchPaneMap skipped when no WorktreePath available for repoRoot
- [x] CHK-016 Timeout handling: 10-second context deadline kills fab-go process

## Code Quality

- [x] CHK-017 Pattern consistency: exec.CommandContext with argument slices (not shell strings), matches existing tmux package patterns
- [x] CHK-018 No unnecessary duplication: Existing tmux.TmuxTimeout constant reused or equivalent 10s timeout applied
- [x] CHK-019 No shell injection: fab-go path constructed via filepath.Join, no user input in command arguments
- [x] CHK-020 No database/ORM imports: Change does not introduce persistent state

## Security

- [x] CHK-021 Subprocess safety: fab-go invoked via exec.CommandContext with explicit argument slice and timeout context

## Notes

- Check items as you review: `- [x]`
- All items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] CHK-008 **N/A**: {reason}`
