# Quality Checklist: Performance Phase 1 — Backend Hot Paths

**Change**: 260327-c1qx-perf-backend-hot-paths
**Generated**: 2026-03-27
**Spec**: `spec.md`

## Functional Completeness
- [x] CHK-001 Parallel Socket Probing: `ListServers()` uses bounded goroutine pool with cap 10
- [x] CHK-002 Context Propagation — ListSessions: accepts `context.Context` parameter, derives timeout from parent
- [x] CHK-003 Context Propagation — ListWindows: accepts `context.Context` parameter, derives timeout from parent
- [x] CHK-004 Context Propagation — ListServers: accepts `context.Context` parameter, probes derive timeout from parent
- [x] CHK-005 Context Propagation — FetchSessions: accepts `context.Context` parameter, passes to tmux calls
- [x] CHK-006 Pane-Map Cache: `fetchPaneMapCached()` wraps `fetchPaneMap()` with 5s TTL
- [x] CHK-007 SSE Session Cache: sseHub caches FetchSessions results per server with 500ms TTL
- [x] CHK-008 Interface Updates: SessionFetcher and TmuxOps interfaces updated with context parameter
- [x] CHK-009 Handler Updates: HTTP handlers pass `r.Context()` to updated functions

## Behavioral Correctness
- [x] CHK-010 Mutation functions unchanged: CreateSession, KillSession, etc. still use `context.Background()` via `withTimeout()`
- [x] CHK-011 SSE deduplication preserved: JSON diff-check still prevents redundant broadcasts
- [x] CHK-012 ListServers sort order: results sorted alphabetically after parallel collection
- [x] CHK-013 Pane-map graceful degradation: nil paneMap still leaves all fab fields empty

## Scenario Coverage
- [x] CHK-014 Thundering herd: pane-map cache uses double-check pattern after write lock acquisition
- [x] CHK-015 Cache error handling: stale pane-map cache preserved on fetch error
- [x] CHK-016 Empty socket directory: ListServers returns nil without spawning goroutines
- [x] CHK-017 SSE multi-server: independent cache entries per server name

## Edge Cases & Error Handling
- [x] CHK-018 Cancelled context: tmux commands fail fast when parent context already cancelled
- [x] CHK-019 Cache cold start: first call to `fetchPaneMapCached()` fetches fresh data
- [x] CHK-020 Client disconnect during poll: SSE poll loop handles context cancellation gracefully

## Code Quality
- [x] CHK-021 Pattern consistency: new code follows existing naming and structural patterns (mutex naming, error handling, function signatures)
- [x] CHK-022 No unnecessary duplication: uses existing `tmuxExecServer`, `serverArgs` helpers
- [x] CHK-023 exec.CommandContext with argument slices: all new subprocess calls use argument slices, never shell strings
- [x] CHK-024 No inline tmux command construction: all tmux interaction goes through internal/tmux/ package

## Security
- [x] CHK-025 exec.CommandContext with timeout: all new subprocess calls include context with timeout

## Notes

- Check items as you review: `- [x]`
- All items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] CHK-008 **N/A**: {reason}`
