# Intake: SSE Infrastructure Performance

**Change**: 260327-5mlg-sse-infrastructure-perf
**Created**: 2026-03-27
**Status**: Draft

## Origin

> Performance Phase 2 — SSE Infrastructure: (1) Upgrade SSE hub mutex to sync.RWMutex + index clients by server in api/sse.go, (2) Increase SSE client channel buffer to 32 + add slog.Warn on first drop per client (debounced) in api/sse.go, (3) Fix relay goroutine race on close — remove conn.Close() from reader goroutine, use context cancellation in api/relay.go. See fab/plans/performance-improvements.md Phase 2 for full details.

One-shot invocation with detailed description referencing the performance improvements plan.

## Why

The SSE hub and WebSocket relay in `app/backend/api/` have three scalability and correctness issues:

1. **Lock contention in SSE hub**: The hub's `poll()` function takes an exclusive `Lock()` for every broadcast, even though most operations (checking client count, iterating clients) are read-only. Additionally, it iterates *all* clients to find those matching a given server — O(N) per server per tick. With multiple concurrent SSE clients across multiple servers, this creates unnecessary contention.

2. **Silent event drops**: The SSE client channel buffer is 8. Under burst conditions (e.g., rapid session creation/deletion), the buffer fills and events are silently dropped (lines 102-106 in `sse.go`). There is no logging or observability when drops occur, making it impossible to diagnose missed UI updates.

3. **Relay goroutine race on close**: In `relay.go`, the PTY reader goroutine calls `conn.Close()` (line 161) when PTY read fails. Meanwhile, the main goroutine may be blocked in `conn.ReadMessage()` (line 172). This is a data race on the WebSocket connection — the gorilla/websocket docs explicitly state that connections are not safe for concurrent read/write after close.

If unfixed, issue 1 limits scalability under concurrent clients, issue 2 causes invisible UI staleness, and issue 3 causes rare but real panics or undefined behavior on connection teardown.

## What Changes

### 2.1 Use RLock for read-only operations + index clients by server

**File**: `app/backend/api/sse.go`

The `sseHub.mu` field is already declared as `sync.RWMutex` (line 23), but the code only ever calls `Lock()`/`Unlock()` — never `RLock()`/`RUnlock()`. Fix by using `RLock()` where appropriate.

Restructure the `clients` map from:
```go
clients map[*sseClient]struct{}
```
to:
```go
clients map[string][]*sseClient  // keyed by server name
```

Changes to `poll()`:
- Collecting distinct servers: use `RLock()` + read the map keys directly (no iteration over all clients)
- Broadcasting: acquire `Lock()` only for the target server's slice (write lock needed since we're sending to channels)
- The check for `len(h.clients) == 0` should count total clients across all server slices

Changes to `addClient()` / `removeClient()`:
- `addClient`: append to the server's slice
- `removeClient`: remove from the server's slice (swap-delete for O(1)); if slice becomes empty, delete the map key

Changes to `newSSEHub()`:
- Initialize with `make(map[string][]*sseClient)`

### 2.2 Increase SSE client channel buffer to 32 + log drops

**File**: `app/backend/api/sse.go`

- Change `make(chan []byte, 8)` to `make(chan []byte, 32)` in `handleSSE`
- Add a `dropped` boolean field to `sseClient` for debounce tracking
- In the broadcast loop's `default` case (buffer full), check `!c.dropped`, and if so, emit `slog.Warn("SSE event dropped", "server", server)` and set `c.dropped = true`
- Reset `c.dropped = false` on successful send (so the next drop after a recovery also logs)

### 2.3 Fix relay goroutine race on close

**File**: `app/backend/api/relay.go`

Remove `conn.Close()` (line 161) from the PTY reader goroutine. Instead, call `cleanup()` which already handles cancellation and resource teardown via `sync.Once`. The `cleanup()` function cancels the context, closes the PTY, and kills the process. The main goroutine's `conn.ReadMessage()` will unblock when `defer conn.Close()` (line 73) fires on function return.

Specifically:
- Replace `conn.Close()` on line 161 with `cleanup()` — this cancels the context and closes the PTY
- The main goroutine loop (`for { conn.ReadMessage() }`) will see a read error when the PTY writer encounters an error (since cleanup closes ptmx), and will break out naturally
- `defer cleanup()` on line 150 ensures all resources are freed regardless of which goroutine exits first
- `defer conn.Close()` on line 73 ensures the WebSocket connection is closed after function return

## Affected Memory

- `run-kit/architecture`: (modify) Update SSE hub internal structure description (client indexing, lock strategy)

## Impact

- **`app/backend/api/sse.go`**: SSE hub data structure change (clients map), locking strategy change, buffer size increase, drop logging
- **`app/backend/api/relay.go`**: Reader goroutine cleanup path change
- **Existing tests**: Any tests that directly construct `sseClient` or `sseHub` will need updating for the new map type
- **No API changes**: External behavior (SSE event format, endpoints) is unchanged
- **No frontend changes**: This is purely backend infrastructure

## Open Questions

None — the performance plan specifies exact changes and the source code confirms the issues exist as described.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Channel buffer size is 32 | Explicitly specified in the performance plan and user description | S:95 R:90 A:95 D:95 |
| 2 | Certain | Client map keyed by server name (string) | Performance plan specifies `map[string][]*sseClient` | S:95 R:85 A:95 D:95 |
| 3 | Certain | Remove conn.Close() from reader goroutine, use cleanup() | Explicitly specified — only safe teardown path | S:95 R:80 A:90 D:95 |
| 4 | Certain | Drop logging uses slog.Warn with per-client debounce | Specified in plan: "slog.Warn on first drop per client (debounced)" | S:90 R:90 A:90 D:90 |
| 5 | Confident | Use boolean field on sseClient for drop debounce | Simplest debounce mechanism; reset on successful send so next burst also logs. Alternative: atomic counter or time-based debounce — boolean is sufficient for "first drop" semantics | S:75 R:90 A:80 D:70 |
| 6 | Confident | Broadcast still acquires write Lock() (not RLock) | Sending to channels is a write-path operation; RLock is only for read-only map iteration. The plan says "write lock only for the target server's slice" | S:80 R:85 A:80 D:75 |
| 7 | Certain | poll() client-count check counts across all server slices | Must check total clients == 0 to stop polling, not just one server's slice | S:85 R:85 A:90 D:90 |

7 assumptions (5 certain, 2 confident, 0 tentative, 0 unresolved).
