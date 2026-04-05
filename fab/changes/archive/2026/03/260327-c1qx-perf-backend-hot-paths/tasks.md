# Tasks: Performance Phase 1 — Backend Hot Paths

**Change**: 260327-c1qx-perf-backend-hot-paths
**Spec**: `spec.md`
**Intake**: `intake.md`

## Phase 1: Context Propagation

<!-- Signature changes first — they ripple through all call sites. -->

- [x] T001 Add `ctx context.Context` parameter to `ListSessions()` and `ListWindows()` in `app/backend/internal/tmux/tmux.go`. Replace `withTimeout()` calls with `context.WithTimeout(ctx, TmuxTimeout)`. Retain `withTimeout()` helper for other functions.
- [x] T002 Add `ctx context.Context` parameter to `ListServers()` in `app/backend/internal/tmux/tmux.go`. Each goroutine probe derives timeout from parent ctx via `context.WithTimeout(ctx, 2*time.Second)`.
- [x] T003 Add `ctx context.Context` parameter to `FetchSessions()` in `app/backend/internal/sessions/sessions.go`. Pass ctx through to `tmux.ListSessions()` and `tmux.ListWindows()` calls.
- [x] T004 Update `SessionFetcher` interface in `app/backend/api/router.go` to `FetchSessions(ctx context.Context, server string)`. Update `prodSessionFetcher` to pass ctx through.
- [x] T005 Update `TmuxOps` interface in `app/backend/api/router.go`: `ListServers(ctx context.Context)` and `ListWindows(ctx context.Context, session, server string)`. Update `prodTmuxOps` methods.
- [x] T006 Update HTTP handlers in `app/backend/api/sessions.go` and `app/backend/api/servers.go` to pass `r.Context()` to updated interface methods.

## Phase 2: Parallel ListServers

- [x] T007 Rewrite `ListServers()` probe loop in `app/backend/internal/tmux/tmux.go` to use bounded goroutine pool (semaphore channel cap 10, sync.WaitGroup, mutex-protected results slice). Add `"sync"` to imports.

## Phase 3: Caching

- [x] T008 [P] Add pane-map cache to `app/backend/internal/sessions/sessions.go`: package-level `sync.RWMutex`-protected cache vars (`paneMapCache`, `paneMapCacheTime`, `paneMapCacheTTL = 5s`). Implement `fetchPaneMapCached(repoRoot string)` with double-check TTL pattern. Update `FetchSessions()` to call `fetchPaneMapCached()`.
- [x] T009 [P] Add SSE session cache to `sseHub` in `app/backend/api/sse.go`: `cachedResult` struct with `data` and `fetchedAt` fields, `cache map[string]*cachedResult` field on sseHub. Update `poll()` to check cache TTL (500ms) before calling `FetchSessions()`. Initialize cache map in `newSSEHub()`. Pass `context.Background()` to `FetchSessions()` from poll loop.

## Phase 4: Test Updates

- [x] T010 [P] Update mock types in `app/backend/api/sessions_test.go`: `mockSessionFetcher.FetchSessions()` and `mockTmuxOps.ListServers()`, `mockTmuxOps.ListWindows()` to match new signatures with `context.Context` parameter. Update `slowSessionFetcher` in `app/backend/api/sse_test.go` similarly.
- [x] T011 [P] Run `cd app/backend && go test ./...` to verify all tests pass with the updated signatures and new caching logic.

---

## Execution Order

- T001 → T002 are independent of each other but both block T003
- T003 blocks T004, T005
- T004 + T005 block T006
- T007 depends on T002 (ListServers already has ctx parameter)
- T008, T009 are independent of each other, both depend on T003/T006 (ctx propagation complete)
- T010 depends on T004, T005 (interface changes)
- T011 depends on all prior tasks
