# Intake: Performance Phase 1 — Backend Hot Paths

**Change**: 260327-c1qx-perf-backend-hot-paths
**Created**: 2026-03-27
**Status**: Draft

## Origin

> Performance Phase 1 — Backend Hot Paths: (1) Parallelize ListServers() socket probing with bounded goroutine pool in internal/tmux/tmux.go, (2) Cache SSE session fetches with 500ms TTL in api/sse.go, (3) Cache fetchPaneMap() with 5s TTL in internal/sessions/sessions.go, (4) Propagate HTTP request context to tmux calls. See fab/plans/performance-improvements.md Phase 1 for full details.

One-shot from user with a detailed performance plan already in the repo (`fab/plans/performance-improvements.md`). All four items are Phase 1 — highest single-user impact, backend-only changes.

## Why

The backend hot path spawns tmux subprocesses on every SSE poll tick (every 2.5s) and probes tmux sockets sequentially on page load. Under steady state:

1. **ListServers sequential probing** — dead/stale socket files cause multi-second page-load stalls. Each dead socket blocks for the full 2s timeout before the next is tried. With 3 stale sockets, that's 6+ seconds of blocking.
2. **Redundant session fetches** — `FetchSessions()` runs on every SSE tick, spawning `tmux list-sessions`, `tmux list-windows` (per session), and `fab-go pane-map` subprocesses. When data hasn't changed (the common case), these are wasted subprocess calls.
3. **fetchPaneMap on every tick** — `fab-go pane-map --json --all-sessions` runs as a subprocess on every SSE poll even though pane-map data changes far less frequently than the 2.5s poll interval.
4. **context.Background() in tmux calls** — when an HTTP client disconnects, in-flight tmux subprocesses continue running because they use `context.Background()` instead of inheriting the request context. Under concurrent load this wastes resources.

Without these fixes, the backend remains the primary bottleneck for UI responsiveness and wastes subprocess resources on redundant work.

## What Changes

### 1. Parallelize `ListServers()` socket probing (`internal/tmux/tmux.go`)

Currently lines 514–523 probe sockets sequentially:

```go
for _, name := range candidates {
    ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
    cmd := exec.CommandContext(ctx, "tmux", "-L", name, "list-sessions")
    err := cmd.Run()
    cancel()
    if err == nil {
        servers = append(servers, name)
    }
}
```

**Change**: Fan out probes into a bounded goroutine pool (cap at 10 concurrent probes). Use `sync.WaitGroup` to join. Collect results via mutex-protected slice. The per-probe timeout stays at 2s but probes now run in parallel, so N dead sockets cost ~2s total instead of 2*N seconds.

```go
// Bounded concurrency pattern:
sem := make(chan struct{}, 10)
var mu sync.Mutex
var wg sync.WaitGroup

for _, name := range candidates {
    wg.Add(1)
    sem <- struct{}{} // acquire semaphore slot
    go func(name string) {
        defer wg.Done()
        defer func() { <-sem }() // release
        ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
        defer cancel()
        cmd := exec.CommandContext(ctx, "tmux", "-L", name, "list-sessions")
        if cmd.Run() == nil {
            mu.Lock()
            servers = append(servers, name)
            mu.Unlock()
        }
    }(name)
}
wg.Wait()
```

Sort order preserved via `sort.Strings(servers)` after joining.

### 2. Cache SSE session fetches with 500ms TTL (`api/sse.go`)

The SSE poll loop (line 83) calls `h.fetcher.FetchSessions(server)` on every tick. Under steady state most ticks return unchanged data.

**Change**: Add a module-level `sync.RWMutex`-protected cache in the `sseHub` struct keyed by server name. Before fetching, check if the cached result is younger than 500ms. If so, skip the fetch entirely.

```go
type cachedResult struct {
    data      []ProjectSession
    fetchedAt time.Time
}

// In sseHub:
cache map[string]*cachedResult  // keyed by server name
```

The cache lives inside `sseHub` (not package-level) since the hub already owns the polling lifecycle. On each poll tick, for each server:
- Read-lock the cache; if entry exists and `time.Since(fetchedAt) < 500ms`, skip fetch
- Otherwise, call `FetchSessions()`, write-lock and update cache entry
- The diff-check (`jsonStr != h.previousJSON[server]`) remains — the cache prevents redundant subprocess spawning, not redundant broadcasts

### 3. Cache `fetchPaneMap()` with 5s TTL (`internal/sessions/sessions.go`)

`fetchPaneMap()` spawns `fab-go pane-map --json --all-sessions` on every `FetchSessions()` call. Pane-map data (fab change, stage, agent state) changes infrequently relative to the 2.5s poll interval.

**Change**: Add a package-level cache with `sync.RWMutex` protection:

```go
var (
    paneMapCache     map[string]paneMapEntry
    paneMapCacheTime time.Time
    paneMapCacheMu   sync.RWMutex
    paneMapCacheTTL  = 5 * time.Second
)
```

New function `fetchPaneMapCached(repoRoot string)` wraps `fetchPaneMap()`:
- Read-lock: if cache exists and `time.Since(paneMapCacheTime) < paneMapCacheTTL`, return cached value
- Write-lock: double-check TTL (avoid thundering herd), call `fetchPaneMap()`, update cache
- `FetchSessions()` calls `fetchPaneMapCached()` instead of `fetchPaneMap()` directly

### 4. Propagate HTTP request context to tmux calls (`internal/tmux/tmux.go`)

Currently `withTimeout()` (line 172) creates a context from `context.Background()`. When HTTP clients disconnect, in-flight tmux subprocesses continue running.

**Change**: Modify tmux package functions that are called from HTTP handlers to accept a parent `context.Context` parameter. The timeout is applied via `context.WithTimeout(parent, TmuxTimeout)` so that both the parent cancellation and the timeout take effect.

Functions to change signatures:
- `ListSessions(server string)` → `ListSessions(ctx context.Context, server string)`
- `ListWindows(session, server string)` → `ListWindows(ctx context.Context, session, server string)`

Functions NOT changed (called from non-HTTP contexts or where request context isn't available):
- `CreateSession`, `CreateWindow`, `KillSession`, `KillWindow`, `RenameSession`, `RenameWindow`, `SendKeys`, `SelectWindow`, `SplitWindow`, `KillActivePane`, `KillPane`, `CapturePane`, `ListKeys`, `KillServer`, `ReloadConfig` — these are called from HTTP handlers but represent user-initiated actions where the command should complete regardless of navigation. `context.Background()` remains correct.

The `withTimeout()` helper is retained for functions that don't accept a parent context. A new `withParentTimeout(parent context.Context)` or inline `context.WithTimeout(ctx, TmuxTimeout)` is used for the updated functions.

Call sites to update:
- `sessions.FetchSessions()` — accept and pass context through to `tmux.ListSessions()` and `tmux.ListWindows()`
- `sseHub.poll()` — create a context for each poll iteration (or use a hub-level context)
- `ListServers()` — use parent context for probes (called from `api/sessions.go` handler)
- HTTP handlers in `api/sessions.go` that call `tmux.ListSessions()`, `tmux.ListWindows()`

## Affected Memory

- `run-kit/architecture`: (modify) Document the caching layer (SSE session cache, pane-map cache) and context propagation pattern as architectural decisions. The "no in-memory caches" convention gets an explicit carve-out for performance-justified caches.

## Impact

- **`internal/tmux/tmux.go`** — `ListServers()` rewritten with goroutine pool; `ListSessions()`, `ListWindows()` gain `ctx` parameter; `withTimeout()` usage partially replaced
- **`api/sse.go`** — `sseHub` gains cache field and TTL logic in poll loop
- **`internal/sessions/sessions.go`** — package-level pane-map cache added; `FetchSessions()` gains `ctx` parameter and calls `fetchPaneMapCached()`
- **`api/sessions.go`** — call sites updated to pass `r.Context()` to session/tmux functions
- **Test files** — `tmux_test.go` and `sessions_test.go` updated for new function signatures
- **No frontend changes** — SSE event format and API contract unchanged
- **No new dependencies** — uses only `sync`, `time`, `context` from stdlib

## Open Questions

None — the performance plan specifies all implementation details.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Goroutine pool cap of 10 for ListServers | Specified in performance plan; 10 is well above typical socket count (2-5) and prevents runaway goroutines | S:90 R:90 A:95 D:95 |
| 2 | Certain | 500ms TTL for SSE session cache | Specified in performance plan; balances freshness (< 1 poll interval) with subprocess reduction | S:90 R:95 A:90 D:95 |
| 3 | Certain | 5s TTL for pane-map cache | Specified in performance plan; pane-map changes infrequently relative to poll interval | S:90 R:95 A:90 D:95 |
| 4 | Certain | Only ListSessions and ListWindows get ctx parameter | These are the read-path functions called from SSE polling; mutation functions (Create/Kill/Rename) should complete regardless of client disconnect | S:85 R:85 A:90 D:90 |
| 5 | Certain | Cache lives in sseHub (not package-level) for SSE cache | sseHub already owns the polling lifecycle and client map; keeps cache co-located with its consumer | S:80 R:90 A:90 D:85 |
| 6 | Certain | Pane-map cache is package-level with sync.RWMutex | fetchPaneMap is called from FetchSessions which may be called from multiple goroutines; package-level cache with mutex is the simplest correct approach | S:80 R:90 A:85 D:85 |
| 7 | Confident | Double-check TTL pattern in pane-map cache to avoid thundering herd | Standard cache pattern; prevents multiple goroutines from re-fetching simultaneously when cache expires | S:70 R:85 A:80 D:80 |
| 8 | Confident | ListServers also gets ctx parameter for request context propagation | Listed in plan item 1.4; called from HTTP handler so should respect client disconnect | S:75 R:80 A:75 D:80 |
| 9 | Certain | No frontend changes needed | All changes are internal to the Go backend; SSE event format and API response shapes remain identical | S:95 R:95 A:95 D:95 |
| 10 | Certain | Caches are justified despite "no in-memory caches" convention | code-quality.md explicitly allows caches "justified by performance measurement"; this is a targeted performance improvement | S:90 R:90 A:95 D:95 |

10 assumptions (8 certain, 2 confident, 0 tentative, 0 unresolved).
