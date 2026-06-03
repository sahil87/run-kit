# Plan: Reap Dead Tmux Servers from SSE Poll Set

**Change**: 260603-gs2t-reap-dead-tmux-servers-sse
**Status**: In Progress
**Intake**: `intake.md`

## Requirements

### Backend: Shared Dead-Server Detection

#### R1: Exported `IsServerGone(err error) bool` in `internal/tmux/`
The `internal/tmux/` package SHALL expose an exported `IsServerGone(err error) bool` that reports whether an error indicates the tmux server's socket is gone (killed, never started, or unreachable). It MUST match tmux's known stderr phrasings: `"no server running"`, `"failed to connect"`, and `"No such file or directory"`. A `nil` error MUST return `false`.

- **GIVEN** an error whose message contains `"no server running"` (or `"failed to connect"`, or `"No such file or directory"`)
- **WHEN** `IsServerGone(err)` is called
- **THEN** it returns `true`
- **AND** for a `nil` error it returns `false`
- **AND** for an error with none of the sentinel substrings it returns `false`

#### R2: `tmuxctl` delegates to the single shared sentinel definition
`internal/tmuxctl/client.go`'s `matchesServerDeadText` SHALL delegate to the shared sentinel list so there is exactly **one** definition of the dead-server substring set across the `tmux` and `tmuxctl` layers (Constitution III). The existing string-accepting call sites (`isServerDeadError`, `resolveBootstrap`) MUST continue to work unchanged, and all existing `tmuxctl` tests MUST still pass.

- **GIVEN** the `tmuxctl` package's dead-server detection
- **WHEN** `matchesServerDeadText(s)` is invoked with any of the three sentinel substrings
- **THEN** it returns `true`, producing identical results to the prior local implementation
- **AND** the sentinel substrings are defined in exactly one place (the shared `tmux` helper)

### Backend: Reap Dead Servers in the SSE Poll Loop

#### R3: Dead-server fetch error reaps the server from the poll set
In `sseHub.poll` (`app/backend/api/sse.go`), when `FetchSessions` returns an error matching `tmux.IsServerGone`, the loop SHALL collect that server into a loop-local `deadServers` slice and log at Info level (not Warn). Non-gone fetch errors MUST keep the existing `slog.Warn("SSE poll error", ...)` behavior. The server MUST then be removed from `h.clients` and all per-server maps so it is no longer polled.

- **GIVEN** an SSE client connected for a server whose tmux socket has been killed
- **WHEN** the poll loop calls `FetchSessions` and receives an `IsServerGone`-matching error
- **THEN** the server is collected for reaping (logged at Info), not re-polled with a Warn each tick
- **AND** after reaping, the poll loop no longer lists that server in its per-tick work-list
- **AND** a non-gone fetch error still logs `slog.Warn("SSE poll error", ...)` and the server is NOT reaped

#### R4: Reap emits a one-time `server-gone` SSE event and clears all per-server state
After the per-server loop completes (before the metrics broadcast), for each reaped server under a single `h.mu.Lock()`, the hub SHALL emit a one-time `event: server-gone\ndata: {}\n\n` to that server's currently-registered clients, then delete the server from `h.clients`, `h.cache`, `h.previousJSON`, `h.previousRealSessions`, `h.orderBootstrapAttempts`, `h.previousOrderJSON`, and the loop-local `perServerGen` / `eventDrivenServers` maps. The work-list MUST be read under `RLock` and all deletes performed after iteration under one write lock — never deleting from a map mid-range over its snapshot, never holding the write lock across `FetchSessions`.

- **GIVEN** a server has been collected into `deadServers` during a poll tick
- **WHEN** the post-loop reap block runs under `h.mu.Lock()`
- **THEN** each registered client for that server receives one `event: server-gone` frame with `data: {}`
- **AND** the server's entries are deleted from `clients`, `cache`, `previousJSON`, `previousRealSessions`, `orderBootstrapAttempts`, `previousOrderJSON`, `perServerGen`, and `eventDrivenServers`
- **AND** if its last client is reaped, the next poll iteration observes zero clients and the goroutine stops polling (re-registration via `addClient` re-spawns it)

### Frontend: React to `server-gone` and Disconnect

#### R5: `SessionProvider` handles the `server-gone` SSE event
In `app/frontend/src/contexts/session-context.tsx`, where named SSE event listeners are registered, an `es.addEventListener("server-gone", ...)` handler SHALL: clear the entry's disconnect timer, close the `EventSource`, remove the pool entry, delete the server's slice from state, and call `refreshServers()` — mirroring the existing pool-diff cleanup shape.

- **GIVEN** a `SessionProvider` with an open `EventSource` for a server
- **WHEN** that stream emits a `server-gone` event
- **THEN** the entry's disconnect timer is cleared, the `EventSource` is closed, the pool entry is removed, the server's slice is deleted from `slicesByServer`, and `refreshServers()` is called
- **AND** the now-absent server drops out of `/api/servers`, shrinking the servers list so `resolveServerView` renders the existing `not-found` view when that server is being viewed

#### R6: Disconnect path also re-queries the server list as a fallback
The disconnect path (`markDisconnected`, reached via `es.onerror`'s 3s timer) SHALL also call `refreshServers()` so a catastrophic socket death the backend could not signal still eventually flips the route guard via the list-shrink path. Both the event path and the onerror fallback MUST be idempotent.

- **GIVEN** a server's socket dies so abruptly the backend never emits `server-gone` (or the daemon is mid-restart)
- **WHEN** `es.onerror` fires and the 3s `markDisconnected` timer elapses
- **THEN** the slice's `isConnected` is set to `false` AND `refreshServers()` is called
- **AND** if the server is genuinely gone, the refreshed list no longer contains it and the route guard flips to `not-found`

### Non-Goals

- No backoff/quiesce of dead servers — they are reaped entirely (intake decision 1).
- No new HTTP endpoints or verbs — `server-gone` is an additive SSE event on the existing `GET /api/sessions/stream` channel (Constitution IX).
- No new UI component — the existing `ServerNotFound` / `resolveServerView` guard is reused (intake §3).

### Design Decisions

1. **Reap, not quiesce**: A dead socket is removed from the poll set entirely — *Why*: no socket = no polling; a reconnecting client re-registers naturally via `addClient` — *Rejected*: backoff/quiesce (keeps chasing a corpse, user-rejected).
2. **One-time `server-gone` event + onerror fallback**: Fast path is the SSE event (sub-second); guaranteed-eventual path is the onerror→`refreshServers()` (~3s) — *Why*: belt-and-suspenders, both idempotent, first to fire wins — *Rejected*: silent refresh-only (≈3s latency, relies solely on onerror).
3. **`IsServerGone(err error)` placed in `tmux.go` near `ListKeys`/`KillServer`**: those functions already key off the same three sentinels — *Why*: single source of truth, co-located with related dead-server handling — *Rejected*: a new file (unnecessary; the helper is small and thematically adjacent).

## Tasks

### Phase 1: Backend — shared sentinel helper

- [x] T001 Add exported `IsServerGone(err error) bool` to `app/backend/internal/tmux/tmux.go` (near `ListKeys`/`KillServer`), matching the three sentinel substrings; `nil` → `false` <!-- R1 -->
- [x] T002 Add `TestIsServerGone` to `app/backend/internal/tmux/tmux_test.go` covering all three sentinels + nil + non-matching error <!-- R1 -->
- [x] T003 Refactor `matchesServerDeadText` in `app/backend/internal/tmuxctl/client.go` to delegate to `tmux.IsServerGone` (single sentinel definition); keep `isServerDeadError`/`resolveBootstrap` string call sites working <!-- R2 -->

### Phase 2: Backend — SSE poll reap

- [x] T004 In `app/backend/api/sse.go` `sseHub.poll`, declare a loop-local `deadServers` slice each tick; in the `FetchSessions` error branch, when `tmux.IsServerGone(err)` log at Info and append to `deadServers`, else keep `slog.Warn("SSE poll error", ...)`; `continue` either way <!-- R3 -->
- [x] T005 In `app/backend/api/sse.go` after the per-server loop and before the metrics broadcast, add the reap block under a single `h.mu.Lock()`: for each dead server emit one `event: server-gone\ndata: {}\n\n` to its clients, then delete from `h.clients`, `h.cache`, `h.previousJSON`, `h.previousRealSessions`, `h.orderBootstrapAttempts`, `h.previousOrderJSON`, `perServerGen`, `eventDrivenServers` <!-- R4 -->
- [x] T006 Add a Go test to `app/backend/api/sse_test.go` proving the poll loop reaps an `IsServerGone` server: it emits `server-gone` to the registered client, removes the server from `h.clients`, and stops polling when it was the last client <!-- R3 R4 -->

### Phase 3: Frontend — react to server-gone + disconnect fallback

- [x] T007 In `app/frontend/src/contexts/session-context.tsx`, add `markDisconnected` to also call `refreshServers()` (i.e. `fetchServers()`), and ensure `fetchServers` is in the pool effect's dependency array <!-- R6 -->
- [x] T008 In `app/frontend/src/contexts/session-context.tsx`, register `es.addEventListener("server-gone", ...)` that clears `entry.disconnectTimer`, closes `entry.es`, deletes the pool entry, deletes the server's slice from `slicesByServer`, and calls `fetchServers()` — mirroring the pool-diff cleanup <!-- R5 -->
- [x] T009 Add frontend unit tests to `app/frontend/src/contexts/session-context.test.tsx`: (a) `server-gone` closes the ES, clears the slice, and re-queries `listServers`; (b) `onerror`→timer triggers `refreshServers` (`listServers` re-called). Extend `MockEventSource` only if needed (e.g. a tracked-close + onerror trigger) <!-- R5 R6 -->

## Execution Order

- T001 blocks T002, T003, T004, T005 (the helper must exist before tests and consumers reference it)
- T004 blocks T005 (the reap block consumes the `deadServers` slice populated in T004) and T006
- T007 and T008 both edit the same effect region in `session-context.tsx` — apply sequentially (T007 then T008); T009 follows both

## Acceptance

### Functional Completeness

- [x] A-001 R1: `tmux.IsServerGone(err error) bool` exists, is exported, returns `true` for each of the three sentinel substrings, and `false` for `nil`
- [x] A-002 R2: `tmuxctl.matchesServerDeadText` delegates to the shared `tmux` helper — the three sentinel substrings are defined in exactly one place
- [x] A-003 R3: `sseHub.poll` collects `IsServerGone` servers into `deadServers` (logged at Info) and leaves non-gone errors logging `slog.Warn`
- [x] A-004 R4: the post-loop reap block emits `event: server-gone` and deletes the server from all listed per-server maps under a single write lock
- [x] A-005 R5: `SessionProvider` registers a `server-gone` listener that closes the ES, removes the pool/slice entries, and calls `refreshServers()`
- [x] A-006 R6: `markDisconnected` calls `refreshServers()` in addition to setting `isConnected: false`

### Behavioral Correctness

- [x] A-007 R3: after an `IsServerGone` error, the dead server stops appearing in the poll work-list (no Warn-per-tick drumbeat)
- [x] A-008 R4: reaping the last client for a server lets the poll goroutine observe zero clients and stop; a later `addClient` re-spawns it

### Scenario Coverage

- [x] A-009 R3 R4: a Go test in `sse_test.go` proves the poll loop reaps an `IsServerGone` server, emits `server-gone`, and removes it from `h.clients`
- [x] A-010 R5: a frontend test proves the `server-gone` handler closes the ES, clears the slice, and re-queries `listServers`
- [x] A-011 R6: a frontend test proves `onerror`→timer triggers `refreshServers`
- [x] A-012 R1: `TestIsServerGone` exercises all three sentinels + nil + non-matching error

### Edge Cases & Error Handling

- [x] A-013 R4: deletes happen after the snapshot iteration under one `h.mu.Lock()` — no mid-range map mutation, no write lock held across `FetchSessions`
- [x] A-014 R6: the `server-gone` event path and the onerror fallback are both idempotent (whichever fires first wins; the other is a no-op)

### Code Quality

- [x] A-015 Pattern consistency: new code follows naming and structural patterns of surrounding code (sentinel comment style, slog usage, effect cleanup shape)
- [x] A-016 No unnecessary duplication: dead-server sentinels defined once (Constitution III); `refreshServers` reuses the existing `fetchServers` callback
- [x] A-017 No new HTTP endpoints/verbs (Constitution IX); `server-gone` is an additive SSE event on the existing stream
- [x] A-018 No regressions: all `exec.CommandContext` subprocess calls keep their timeouts (no subprocess code added here, but verify no regression)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | `IsServerGone` lives in `tmux.go` next to `ListKeys`/`KillServer` rather than a new file | Those functions already key off the identical three sentinels; co-location is the minimal, thematically-correct placement | S:90 R:85 A:90 D:85 |
| 2 | Certain | `tmuxctl`'s local sentinel constants are removed and `matchesServerDeadText` delegates to `tmux.IsServerGone` (constructing/forwarding the error) | Constitution III mandates one definition; intake §1 explicitly requests delegation | S:95 R:80 A:92 D:90 |
| 3 | Confident | In the frontend effect, the underlying `fetchServers` useCallback is called directly (the context exposes it as `refreshServers`); `fetchServers` is added to the effect deps | `refreshServers` is just the public alias for the stable `fetchServers` (line 414); calling it inside the provider uses the local binding | S:88 R:88 A:90 D:85 |
| 4 | Confident | The Go reap test drives the hub directly (constructing `sseHub` + a fetcher returning an `IsServerGone` error), mirroring existing `sse_test.go` hub-level tests rather than via HTTP | Existing tests (`TestSSEHubStopsPollingWhenNoClients`, etc.) drive the hub directly; same approach localizes the assertion | S:85 R:85 A:88 D:82 |
| 5 | Confident | The frontend test uses fake timers to advance the 3s onerror→`markDisconnected` timer, asserting `listServers` is re-called | The mock has no real timer; vitest fake timers is the standard way to exercise a `setTimeout`-gated path | S:82 R:85 A:85 D:80 |

5 assumptions (2 certain, 3 confident, 0 tentative).
