# Performance Improvements Plan

> Triaged from a full-codebase performance review (2026-03-27).
> Covers high and medium ROI items across backend, frontend, and real-time layers.

---

## Phase 1 — Backend Hot Paths (highest single-user impact)

### 1.1 Parallelize `ListServers()` socket probing
- **File:** `internal/tmux/tmux.go:515-523`
- **Problem:** Probes each tmux socket sequentially with a 2s timeout. Dead sockets stall page load for seconds.
- **Fix:** Fan out probes into a bounded goroutine pool (cap at 10). Collect results via mutex-protected slice, `sync.WaitGroup` to join.
- **Impact:** Eliminates multi-second page-load stalls when stale socket files exist.
- **Effort:** Small (single function change).

### 1.2 Cache SSE session fetches (500ms TTL)
- **File:** `api/sse.go:82-87`
- **Problem:** Every 2.5s poll tick calls `FetchSessions()` even when data is unchanged. Each call spawns multiple tmux subprocesses.
- **Fix:** Module-level `sync.RWMutex`-protected cache keyed by server. Skip fetch if cached result is younger than 500ms.
- **Impact:** Reduces tmux subprocess calls by ~5-10x under steady state.
- **Effort:** Small.

### 1.3 Cache `fetchPaneMap()` (5s TTL)
- **File:** `internal/sessions/sessions.go:36-74`
- **Problem:** `fab-go pane-map` subprocess spawned on every session fetch (every SSE tick), even when repo state hasn't changed.
- **Fix:** Same pattern as 1.2 — module-level cache with 5s TTL. `paneMap` changes infrequently relative to poll frequency.
- **Impact:** Eliminates most `fab-go` subprocess calls.
- **Effort:** Small.

### 1.4 Propagate HTTP request context to tmux calls
- **File:** `internal/tmux/tmux.go:171-174`
- **Problem:** `withTimeout()` creates `context.Background()`. When a client disconnects, in-flight tmux subprocesses keep running.
- **Fix:** Change tmux functions to accept a parent `context.Context` parameter. Handlers pass `r.Context()`. Keep the timeout via `context.WithTimeout(parent, TmuxTimeout)`.
- **Impact:** Cancelled requests stop wasting subprocess resources. Important under concurrent load.
- **Effort:** Medium (signature change ripples through call sites).

---

## Phase 2 — SSE Infrastructure (server scalability)

### 2.1 Upgrade SSE hub mutex to `sync.RWMutex` + index clients by server
- **File:** `api/sse.go:38-50, 95-111`
- **Problem:** `sync.Mutex` held during broadcast loop that iterates all clients. Lock contention scales linearly with client count.
- **Fix:** Switch to `sync.RWMutex`. Restructure `clients` from `map[*sseClient]struct{}` to `map[string][]*sseClient` (keyed by server). Broadcast acquires write lock only for the target server's slice.
- **Impact:** Reduces lock contention with multiple concurrent SSE clients.
- **Effort:** Medium.

### 2.2 Increase SSE client channel buffer + log drops
- **File:** `api/sse.go:129, 102-107`
- **Problem:** Buffer of 8 fills easily under burst. Events silently dropped.
- **Fix:** Increase to 32. Add a `slog.Warn` on first drop per client (debounced so it doesn't spam).
- **Impact:** Fewer missed UI updates; better observability.
- **Effort:** Small.

### 2.3 Fix relay goroutine race on close
- **File:** `api/relay.go:152-167`
- **Problem:** Reader goroutine calls `conn.Close()` while main thread may be in `conn.ReadMessage()`.
- **Fix:** Remove `conn.Close()` from reader goroutine — let `defer cleanup()` handle all resource teardown. Use context cancellation to signal both goroutines.
- **Impact:** Eliminates a rare but real race condition.
- **Effort:** Small.

---

## Phase 3 — Frontend Rendering (biggest UI responsiveness wins)

### 3.1 Diff SSE state before `setSessions()` + `startTransition()`
- **File:** `contexts/session-context.tsx:82-89`
- **Problem:** Every SSE event replaces the entire sessions array, triggering full-tree re-renders (Sidebar, Dashboard, TopBar, AppShell) even when nothing changed.
- **Fix:** Compare incoming JSON string against previous before parsing. Wrap `setSessions()` in `React.startTransition()` to keep input responsive.
- **Impact:** Eliminates redundant re-renders on ~90%+ of SSE ticks (most polls return unchanged data).
- **Effort:** Small.

### 3.2 Split `useChrome()` into state/dispatch hooks
- **File:** `contexts/chrome-context.tsx:97-102`
- **Problem:** Merged context forces dispatch-only consumers to re-render on every state change.
- **Fix:** Export `useChromeState()` and `useChromeDispatch()` as separate hooks. Update consumers to use the narrower hook where possible. Keep `useChrome()` as a convenience alias.
- **Impact:** Prevents cascading re-renders across components that only trigger actions.
- **Effort:** Medium (need to audit and update all `useChrome()` call sites).

### 3.3 Memoize palette actions
- **File:** `app.tsx:341-477`
- **Problem:** `paletteActions` useMemo has 11 dependencies and rebuilds 140+ lines of action objects on any SSE event.
- **Fix:** Split into stable action groups (navigation, session, window, theme) memoized independently. Compose them in a final `useMemo` with only the group refs as deps.
- **Impact:** Reduces work on the hot render path in AppShell.
- **Effort:** Medium.

### 3.4 Batch xterm.js writes with `requestAnimationFrame`
- **File:** `components/terminal-client.tsx:365-372`
- **Problem:** Each WebSocket message calls `terminal.write()` individually. Under fast output, this triggers many separate xterm renders.
- **Fix:** Accumulate incoming data in a string buffer. Flush on `requestAnimationFrame`. Handle binary by decoding to string before buffering, or maintain a separate binary buffer path.
- **Impact:** Smoother terminal rendering under high-throughput output (e.g., large builds, logs).
- **Effort:** Small.

---

## Phase 4 — Bundle & Loading (initial page load)

### 4.1 Lazy-load conditional components
- **File:** `app.tsx:12-16`
- **Problem:** CommandPalette, ThemeSelector, CreateSessionDialog loaded eagerly even though they render conditionally.
- **Fix:** Wrap with `React.lazy()` + `<Suspense fallback={null}>`.
- **Impact:** Smaller initial JS bundle; faster first paint.
- **Effort:** Small.

### 4.2 Add Vite manual chunks for vendor splitting
- **File:** `vite.config.ts`
- **Problem:** No explicit chunk splitting — xterm addons and router bundled into main chunk.
- **Fix:** Add `build.rollupOptions.output.manualChunks` to split xterm family and router into separate vendor chunks.
- **Impact:** Better caching (vendor chunks change less often than app code). Parallel loading.
- **Effort:** Small.

### 4.3 Add API request deduplication
- **File:** `api/client.ts`
- **Problem:** Concurrent callers to the same endpoint make duplicate HTTP requests.
- **Fix:** Maintain a `Map<string, Promise>` of in-flight requests. Return existing promise if key matches. Clear on resolve/reject.
- **Impact:** Eliminates redundant fetches during route transitions.
- **Effort:** Small.

---

## Execution Order

| Order | Item | Effort | Impact |
|-------|------|--------|--------|
| 1 | 1.1 Parallelize ListServers | Small | High |
| 2 | 3.1 Diff SSE state + startTransition | Small | High |
| 3 | 1.2 Cache SSE session fetches | Small | High |
| 4 | 1.3 Cache fetchPaneMap | Small | Medium |
| 5 | 3.2 Split useChrome hooks | Medium | High |
| 6 | 3.4 Batch xterm writes | Small | Medium |
| 7 | 2.2 Increase SSE buffer + log drops | Small | Medium |
| 8 | 2.3 Fix relay goroutine race | Small | Medium |
| 9 | 4.1 Lazy-load components | Small | Medium |
| 10 | 4.2 Vite manual chunks | Small | Medium |
| 11 | 4.3 API request deduplication | Small | Medium |
| 12 | 1.4 Propagate request context | Medium | Medium |
| 13 | 2.1 RWMutex + server-indexed clients | Medium | Medium |
| 14 | 3.3 Memoize palette actions | Medium | Medium |

Items 1-6 are quick wins with the highest ROI. Items 7-11 are small effort, medium payoff. Items 12-14 require more refactoring but improve scalability.
