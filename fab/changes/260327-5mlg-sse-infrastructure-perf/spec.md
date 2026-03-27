# Spec: SSE Infrastructure Performance

**Change**: 260327-5mlg-sse-infrastructure-perf
**Created**: 2026-03-27
**Affected memory**: `docs/memory/run-kit/architecture.md`

## Non-Goals

- Changing the SSE poll interval or event format — external behavior is unchanged
- Adding per-server locking granularity (single hub mutex is sufficient at current scale)
- Modifying the WebSocket relay I/O relay logic beyond the goroutine race fix

## SSE Hub: Server-Indexed Client Map

### Requirement: Client map keyed by server name

The `sseHub.clients` field SHALL be `map[string][]*sseClient` keyed by tmux server name. Each server key maps to a slice of clients subscribed to that server.

#### Scenario: Adding a client to the hub
- **GIVEN** a hub with no clients for server "runkit"
- **WHEN** `addClient()` is called with a client whose `server` field is "runkit"
- **THEN** `h.clients["runkit"]` contains that client
- **AND** the client slice has length 1

#### Scenario: Adding multiple clients to different servers
- **GIVEN** a hub with one client for server "runkit"
- **WHEN** `addClient()` is called with a client for server "default"
- **THEN** `h.clients["runkit"]` has 1 client and `h.clients["default"]` has 1 client

#### Scenario: Removing a client
- **GIVEN** a hub with two clients for server "runkit"
- **WHEN** `removeClient()` is called for one of them
- **THEN** `h.clients["runkit"]` has 1 client remaining
- **AND** the remaining client is the one that was not removed

#### Scenario: Removing the last client for a server
- **GIVEN** a hub with one client for server "runkit"
- **WHEN** `removeClient()` is called for that client
- **THEN** the key "runkit" is deleted from `h.clients`

### Requirement: Hub initialization with new map type

`newSSEHub()` SHALL initialize `clients` as `make(map[string][]*sseClient)`.

#### Scenario: Fresh hub creation
- **GIVEN** a new `SessionFetcher`
- **WHEN** `newSSEHub(fetcher)` is called
- **THEN** the returned hub has an empty `clients` map of type `map[string][]*sseClient`

## SSE Hub: Read-Write Lock Usage

### Requirement: RLock for read-only operations in poll()

The `poll()` function SHALL use `RLock()` when only reading from `h.clients` (collecting server keys and checking client count). It SHALL use `Lock()` when writing (updating `previousJSON` and sending to client channels).

#### Scenario: Collecting active servers
- **GIVEN** a hub with clients on multiple servers
- **WHEN** `poll()` collects the set of active servers
- **THEN** it acquires `RLock()` (not exclusive `Lock()`)
- **AND** reads the keys of `h.clients` directly without iterating all clients

#### Scenario: Broadcasting to a server's clients
- **GIVEN** a hub with clients on server "runkit" and new data from `FetchSessions`
- **WHEN** `poll()` broadcasts the data
- **THEN** it acquires `Lock()` for the write path (updating `previousJSON` and sending to channels)
- **AND** only iterates clients in `h.clients["runkit"]`, not all clients

#### Scenario: Checking if hub should stop polling
- **GIVEN** a hub with no clients in any server slice
- **WHEN** `poll()` checks client count at the top of its loop
- **THEN** it acquires `RLock()` and checks the total count across all server slices
- **AND** sets `h.polling = false` (upgrading to `Lock()` to write) and returns

### Requirement: addClient and removeClient use exclusive Lock

`addClient()` and `removeClient()` SHALL continue to use exclusive `Lock()` since they mutate the clients map.

#### Scenario: Concurrent add and poll
- **GIVEN** a hub that is actively polling
- **WHEN** `addClient()` is called concurrently
- **THEN** `addClient()` acquires `Lock()` and `poll()` waits for the lock release before proceeding

## SSE Hub: Increased Channel Buffer

### Requirement: Client channel buffer size of 32

The `sseClient` channel SHALL be created with a buffer size of 32 (previously 8) in `handleSSE`.

#### Scenario: Client channel creation
- **GIVEN** a new SSE connection request
- **WHEN** `handleSSE` creates the `sseClient`
- **THEN** `client.ch` is `make(chan []byte, 32)`

## SSE Hub: Drop Logging

### Requirement: Log first drop per client with debounce

The `sseClient` struct SHALL have a `dropped bool` field. When the broadcast loop's `default` case fires (buffer full), and `c.dropped` is `false`, the hub SHALL emit `slog.Warn("SSE event dropped", "server", server)` and set `c.dropped = true`. On successful send, `c.dropped` SHALL be reset to `false`.

#### Scenario: First event drop for a client
- **GIVEN** a client whose channel buffer is full and `dropped` is `false`
- **WHEN** the broadcast loop attempts to send and hits the `default` case
- **THEN** `slog.Warn("SSE event dropped", "server", server)` is emitted
- **AND** `c.dropped` is set to `true`

#### Scenario: Consecutive drops (debounced)
- **GIVEN** a client whose `dropped` is already `true`
- **WHEN** the broadcast loop hits the `default` case again
- **THEN** no log is emitted

#### Scenario: Recovery resets debounce
- **GIVEN** a client whose `dropped` is `true` (from a previous drop)
- **WHEN** a subsequent event is successfully sent to the channel
- **THEN** `c.dropped` is reset to `false`
- **AND** the next drop will trigger a new `slog.Warn`

## Relay: Goroutine Race Fix

### Requirement: No conn.Close() in reader goroutine

The PTY reader goroutine in `handleRelay` SHALL NOT call `conn.Close()`. Instead, it SHALL call `cleanup()` when the PTY read fails or reaches EOF. The `cleanup()` function (guarded by `sync.Once`) cancels the context, closes the PTY, and kills the process. The WebSocket connection is closed only by `defer conn.Close()` on line 73.

#### Scenario: PTY read failure triggers cleanup
- **GIVEN** a relay connection with an active PTY reader goroutine
- **WHEN** `ptmx.Read()` returns an error (including EOF)
- **THEN** the reader goroutine calls `cleanup()`
- **AND** `cleanup()` cancels the context and closes the PTY
- **AND** the reader goroutine returns

#### Scenario: Main goroutine exits after reader cleanup
- **GIVEN** the reader goroutine has called `cleanup()` (PTY closed)
- **WHEN** the main goroutine attempts `conn.ReadMessage()`
- **THEN** the read eventually fails (when `defer conn.Close()` fires or the connection is closed externally)
- **AND** the main goroutine breaks out of its loop
- **AND** `defer cleanup()` runs (no-op via `sync.Once`)

#### Scenario: Main goroutine exits first
- **GIVEN** an active relay connection
- **WHEN** the WebSocket client disconnects (main goroutine's `conn.ReadMessage()` returns error)
- **THEN** the main goroutine breaks and `defer cleanup()` fires
- **AND** the reader goroutine's next `ptmx.Read()` or `conn.WriteMessage()` fails and it returns
- **AND** no concurrent `conn.Close()` race occurs

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Channel buffer size is 32 | Confirmed from intake #1 — explicitly specified in performance plan | S:95 R:90 A:95 D:95 |
| 2 | Certain | Client map keyed by server name (string) | Confirmed from intake #2 — `map[string][]*sseClient` | S:95 R:85 A:95 D:95 |
| 3 | Certain | Remove conn.Close() from reader goroutine, use cleanup() | Confirmed from intake #3 — only safe teardown path per gorilla/websocket docs | S:95 R:80 A:90 D:95 |
| 4 | Certain | Drop logging uses slog.Warn with per-client debounce | Confirmed from intake #4 — "slog.Warn on first drop per client (debounced)" | S:90 R:90 A:90 D:90 |
| 5 | Confident | Use boolean field on sseClient for drop debounce, reset on successful send | Confirmed from intake #5 — simplest debounce; reset enables re-logging after recovery | S:75 R:90 A:80 D:70 |
| 6 | Confident | Broadcast acquires exclusive Lock() for write path | Confirmed from intake #6 — sending to channels + updating previousJSON is a write operation | S:80 R:85 A:80 D:75 |
| 7 | Certain | poll() checks total clients across all server slices to decide stop | Confirmed from intake #7 — must count all slices, not just one key | S:85 R:85 A:90 D:90 |
| 8 | Certain | removeClient uses swap-delete for O(1) removal from slice | Codebase convention: standard Go slice removal pattern, no ordering dependency in client slice | S:80 R:95 A:90 D:90 |
| 9 | Certain | poll() upgrades from RLock to Lock when stopping (needs to write h.polling) | Cannot write `h.polling = false` under RLock — must release RLock and acquire Lock | S:85 R:90 A:95 D:90 |

9 assumptions (7 certain, 2 confident, 0 tentative, 0 unresolved).
