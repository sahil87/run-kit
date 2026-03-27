# Spec: Performance Phase 1 — Backend Hot Paths

**Change**: 260327-c1qx-perf-backend-hot-paths
**Created**: 2026-03-27
**Affected memory**: `docs/memory/run-kit/architecture.md`

## Non-Goals

- Frontend changes — SSE event format and API response shapes remain identical
- SSE hub mutex upgrade to `sync.RWMutex` (Phase 2 item 2.1)
- SSE client channel buffer increase (Phase 2 item 2.2)
- Adding context propagation to mutation functions (CreateSession, KillSession, etc.) — these represent user-initiated actions that should complete regardless of client disconnect

## Tmux: Parallel Server Discovery

### Requirement: Parallel Socket Probing

`ListServers()` SHALL probe tmux sockets concurrently using a bounded goroutine pool. The concurrency limit MUST be 10 goroutines. Each probe SHALL retain its existing 2-second timeout. Results MUST be collected via a mutex-protected slice and sorted alphabetically after all probes complete.

#### Scenario: Multiple sockets with mix of live and dead servers
- **GIVEN** 5 socket files exist in `/tmp/tmux-{uid}/`, 2 are live servers and 3 are stale
- **WHEN** `ListServers()` is called
- **THEN** all 5 probes run concurrently (up to the pool cap)
- **AND** the function returns within ~2 seconds (one timeout period) instead of ~6 seconds
- **AND** only the 2 live server names are returned, sorted alphabetically

#### Scenario: No socket files exist
- **GIVEN** the socket directory is empty or does not exist
- **WHEN** `ListServers()` is called
- **THEN** it returns `nil, nil` without spawning any goroutines

#### Scenario: More sockets than pool cap
- **GIVEN** 15 socket files exist
- **WHEN** `ListServers()` is called
- **THEN** at most 10 probes run concurrently
- **AND** the remaining 5 are probed as slots become available

### Requirement: Context Propagation for ListServers

`ListServers()` SHALL accept a `context.Context` parameter as its first argument. Each probe SHALL derive its timeout from the parent context via `context.WithTimeout(ctx, 2*time.Second)`. If the parent context is cancelled, all in-flight probes SHOULD be cancelled.

#### Scenario: Client disconnects during server discovery
- **GIVEN** an HTTP handler calls `ListServers(r.Context())`
- **WHEN** the client disconnects mid-discovery
- **THEN** the parent context cancellation propagates to in-flight probes
- **AND** probes terminate early rather than waiting for their full 2s timeout

## Tmux: Context-Aware Session and Window Queries

### Requirement: Context Parameter for Read-Path Functions

`ListSessions()` and `ListWindows()` SHALL accept a `context.Context` parameter as their first argument. The timeout SHALL be applied via `context.WithTimeout(ctx, TmuxTimeout)` instead of `context.WithTimeout(context.Background(), TmuxTimeout)`.

#### Scenario: SSE poll with active context
- **GIVEN** the SSE poll loop calls `ListSessions(ctx, server)`
- **WHEN** the poll context is active
- **THEN** `ListSessions` creates a child context with `TmuxTimeout` and executes the tmux command
- **AND** the behavior is identical to current behavior when context is not cancelled

#### Scenario: Cancelled context before tmux command
- **GIVEN** the parent context has been cancelled
- **WHEN** `ListSessions(ctx, server)` is called
- **THEN** `context.WithTimeout` returns an already-cancelled context
- **AND** the tmux command fails immediately without spawning a subprocess

### Requirement: withTimeout Retained for Non-Context Functions

The existing `withTimeout()` helper SHALL be retained for functions that do not accept a parent context (mutation functions). It SHALL continue to use `context.Background()`.

#### Scenario: Mutation function uses withTimeout
- **GIVEN** `CreateSession()` is called
- **WHEN** it creates a context via `withTimeout()`
- **THEN** the context is derived from `context.Background()` with `TmuxTimeout`
- **AND** the session creation completes regardless of HTTP client state

## Sessions: Pane-Map Caching

### Requirement: Cached Pane-Map Fetches

`fetchPaneMap()` results SHALL be cached at the package level with a 5-second TTL. A new function `fetchPaneMapCached(repoRoot string)` SHALL wrap `fetchPaneMap()` and be the sole caller path from `FetchSessions()`.

#### Scenario: Cache hit within TTL
- **GIVEN** `fetchPaneMapCached()` was called successfully 3 seconds ago
- **WHEN** `fetchPaneMapCached()` is called again with the same `repoRoot`
- **THEN** the cached map is returned without spawning a subprocess
- **AND** no `fab-go pane-map` process is executed

#### Scenario: Cache miss after TTL expiry
- **GIVEN** the cache is 6 seconds old (past the 5s TTL)
- **WHEN** `fetchPaneMapCached()` is called
- **THEN** `fetchPaneMap()` is called to refresh the cache
- **AND** the new result is stored with the current timestamp

#### Scenario: Concurrent cache expiry (thundering herd prevention)
- **GIVEN** the cache has just expired
- **WHEN** two goroutines call `fetchPaneMapCached()` simultaneously
- **THEN** only one goroutine calls `fetchPaneMap()` (double-check after acquiring write lock)
- **AND** the second goroutine receives the freshly cached result

#### Scenario: Cache miss on first call
- **GIVEN** no cache entry exists (server just started)
- **WHEN** `fetchPaneMapCached()` is called
- **THEN** `fetchPaneMap()` is called and the result is cached

#### Scenario: fetchPaneMap returns error
- **GIVEN** the `fab-go` binary is missing or fails
- **WHEN** `fetchPaneMapCached()` is called with an expired or empty cache
- **THEN** the error is returned to the caller
- **AND** the stale cache entry is NOT updated (previous valid entry remains if one exists)

### Requirement: Context Propagation for FetchSessions

`FetchSessions()` SHALL accept a `context.Context` parameter as its first argument and pass it through to `tmux.ListSessions()` and `tmux.ListWindows()`.

#### Scenario: FetchSessions passes context to tmux calls
- **GIVEN** a handler calls `FetchSessions(r.Context(), server)`
- **WHEN** the request context is active
- **THEN** `tmux.ListSessions(ctx, server)` and `tmux.ListWindows(ctx, session, server)` are called with the same context

## SSE: Session Fetch Caching

### Requirement: TTL Cache for FetchSessions in SSE Hub

The `sseHub` SHALL cache `FetchSessions()` results per server with a 500ms TTL. The cache SHALL be a field on the `sseHub` struct (not package-level). When the cached result is younger than 500ms, the poll loop SHALL skip the `FetchSessions()` call entirely.

#### Scenario: Rapid consecutive polls for same server
- **GIVEN** the SSE poll loop fetched sessions for server "default" 200ms ago
- **WHEN** the next poll tick fires
- **THEN** the hub skips calling `FetchSessions()` for "default"
- **AND** uses the cached result for JSON diff comparison

#### Scenario: Cache expires between ticks
- **GIVEN** the SSE poll loop fetched sessions for server "default" 600ms ago
- **WHEN** the next poll tick fires
- **THEN** the hub calls `FetchSessions()` fresh
- **AND** updates the cache with the new result and timestamp

#### Scenario: Multiple servers with independent caches
- **GIVEN** two SSE clients connected to servers "default" and "dev"
- **WHEN** the poll loop iterates
- **THEN** each server's cache is checked independently
- **AND** server "default" may be cached while "dev" requires a fresh fetch

### Requirement: Existing Deduplication Preserved

The existing JSON diff-check (`jsonStr != h.previousJSON[server]`) SHALL remain unchanged. The session cache prevents redundant subprocess spawning; the JSON diff prevents redundant SSE broadcasts. These are separate concerns.

#### Scenario: Cached data matches previous broadcast
- **GIVEN** the session cache returns the same data as `previousJSON[server]`
- **WHEN** the poll loop evaluates the result
- **THEN** no SSE event is broadcast to clients

## API: Interface Updates

### Requirement: SessionFetcher Interface Update

The `SessionFetcher` interface SHALL be updated to include a `context.Context` parameter: `FetchSessions(ctx context.Context, server string)`. The `prodSessionFetcher` implementation SHALL pass the context through to `sessions.FetchSessions()`.

#### Scenario: Handler passes request context
- **GIVEN** `handleSessionsList` calls `s.sessions.FetchSessions(r.Context(), server)`
- **WHEN** the request is active
- **THEN** the context propagates through `prodSessionFetcher` to `sessions.FetchSessions()`

### Requirement: TmuxOps Interface Update

The `TmuxOps` interface SHALL update `ListServers` to accept a context: `ListServers(ctx context.Context) ([]string, error)`. `ListWindows` SHALL also be updated: `ListWindows(ctx context.Context, session, server string)`. The `prodTmuxOps` implementation SHALL pass the context through to the tmux package functions.

#### Scenario: Server list handler passes context
- **GIVEN** `handleServersList` calls `s.tmux.ListServers(r.Context())`
- **WHEN** the client disconnects
- **THEN** the context cancellation propagates to `tmux.ListServers()`

## Design Decisions

1. **SSE cache on sseHub struct, pane-map cache at package level**
   - *Why*: SSE cache is only used by the hub's poll loop — co-locating keeps lifecycle simple. Pane-map cache serves `FetchSessions()` which may be called from multiple goroutines via different code paths (SSE poll and REST handler).
   - *Rejected*: Package-level SSE cache — would outlive the hub and require separate cleanup logic.

2. **Only read-path functions get context parameter**
   - *Why*: Mutation functions (create, kill, rename) represent intentional user actions that should complete even if the user navigates away. Cancelling a "create session" mid-way would leave orphaned state.
   - *Rejected*: Adding context to all functions — adds signature churn without benefit for mutations.

3. **Pane-map cache preserves stale entry on fetch error**
   - *Why*: A transient `fab-go` failure shouldn't immediately degrade the UI. Serving a slightly stale pane-map is better than returning nil and losing all fab enrichment.
   - *Rejected*: Clear cache on error — would cause UI flicker when `fab-go` has brief hiccups.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Goroutine pool cap of 10 for ListServers | Confirmed from intake #1 — specified in performance plan; 10 is well above typical socket count | S:90 R:90 A:95 D:95 |
| 2 | Certain | 500ms TTL for SSE session cache | Confirmed from intake #2 — specified in performance plan | S:90 R:95 A:90 D:95 |
| 3 | Certain | 5s TTL for pane-map cache | Confirmed from intake #3 — specified in performance plan | S:90 R:95 A:90 D:95 |
| 4 | Certain | Only ListSessions, ListWindows, ListServers get ctx parameter | Confirmed from intake #4 — read-path only; mutation functions keep context.Background() | S:85 R:85 A:90 D:90 |
| 5 | Certain | SSE cache lives in sseHub struct | Confirmed from intake #5 — co-located with polling lifecycle | S:80 R:90 A:90 D:85 |
| 6 | Certain | Pane-map cache is package-level with sync.RWMutex | Confirmed from intake #6 — simplest correct approach for concurrent callers | S:80 R:90 A:85 D:85 |
| 7 | Certain | Double-check TTL in pane-map cache write path | Upgraded from intake #7 (Confident → Certain) — standard cache pattern, well-understood | S:80 R:90 A:90 D:85 |
| 8 | Certain | ListServers gets ctx parameter | Upgraded from intake #8 (Confident → Certain) — confirmed call site in handleServersList passes r.Context() | S:85 R:85 A:85 D:85 |
| 9 | Certain | No frontend changes needed | Confirmed from intake #9 — verified SSE event format and API shapes unchanged | S:95 R:95 A:95 D:95 |
| 10 | Certain | Caches justified despite convention | Confirmed from intake #10 — code-quality.md explicit carve-out for performance-justified caches | S:90 R:90 A:95 D:95 |
| 11 | Certain | SessionFetcher and TmuxOps interfaces updated for ctx | New — interfaces must match new function signatures; mock implementations in tests need updating | S:85 R:80 A:90 D:90 |
| 12 | Certain | Pane-map cache preserves stale entry on fetch error | New — graceful degradation over UI flicker; consistent with existing nil-map fallback pattern | S:80 R:85 A:85 D:85 |
| 13 | Certain | SSE hub poll loop creates per-iteration context | New — hub has no parent context; use context.Background() for each poll iteration, cancelled on hub shutdown | S:75 R:85 A:85 D:80 |

13 assumptions (13 certain, 0 confident, 0 tentative, 0 unresolved).
