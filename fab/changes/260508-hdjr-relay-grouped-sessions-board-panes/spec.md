# Spec: Relay Grouped Sessions for Board Panes

**Change**: 260508-hdjr-relay-grouped-sessions-board-panes
**Created**: 2026-05-09
**Affected memory**: `docs/memory/run-kit/architecture.md`, `docs/memory/run-kit/tmux-sessions.md`

## Non-Goals

- **Cross-server interference fixes** — boards spanning multiple tmux servers are already isolated by socket boundaries; this change is strictly per-server.
- **Frontend WebSocket URL changes** — the URL contract `/relay/{session}/{window}?server={server}` remains untouched. Ephemeral session names are internal to the backend.
- **Replacing or extending PR #178 (terminal multiplexing engine)** — that change is a frontend pool optimization and is orthogonal to this fix.
- **Redesigning the AppShell single-pane relay path** — single-pane gets the same ephemeral treatment for uniformity, but no behavioral redesign is intended (a latent multi-tab focus-stealing bug is fixed as a side effect).
- **Re-architecting `pipe-pane` / `capture-pane`** — interactivity must be preserved, ruling out read-only stream alternatives.
- **Limiting board pane count or batching `new-session` calls** — N-pane thundering-herd at typical board sizes (≤16) is not a concern; future optimization is out of scope.

## Relay: Per-WebSocket Ephemeral Grouped Session

### Requirement: Per-Connection Ephemeral Session

The relay handler (`app/backend/api/relay.go`) MUST create a unique ephemeral tmux session per WebSocket connection on the same tmux server as the real session, using `tmux new-session -d -s <ephemeral> -t <real>`. Each ephemeral SHALL belong to the same session group as the real session — sharing window membership but maintaining independent active-window state. The relay SHALL attach to the ephemeral, not the real session.

#### Scenario: Single relay connection
- **GIVEN** a real tmux session `agent` with windows `0..3` on server `runkit`
- **WHEN** the frontend opens a WebSocket to `/relay/agent/2?server=runkit`
- **THEN** the backend invokes `tmux -L runkit new-session -d -s rk-relay-<rand> -t agent`
- **AND** invokes `tmux -L runkit select-window -t rk-relay-<rand>:2`
- **AND** spawns `tmux -L runkit attach-session -t rk-relay-<rand>` via PTY
- **AND** the PTY shows window 2 of session `agent`

#### Scenario: Two relay connections to the same session, different windows
- **GIVEN** session `agent` with windows `0..3` on server `runkit`
- **AND** WebSocket A is open targeting `agent` window `1`
- **AND** WebSocket B is open targeting `agent` window `2`
- **WHEN** PTY output streams from both ephemerals
- **THEN** WebSocket A continuously shows window 1 content
- **AND** WebSocket B continuously shows window 2 content
- **AND** neither relay's `select-window` call affects the other's active window

#### Scenario: Ephemeral creation fails on missing real session
- **GIVEN** the frontend opens a WebSocket to `/relay/missing/0?server=runkit`
- **AND** session `missing` does not exist on server `runkit`
- **WHEN** the relay calls `NewGroupedSession`
- **THEN** the call returns an error
- **AND** the relay closes the WebSocket with code `4004` and reason `"Session not found"`
- **AND** no orphan ephemeral is created

### Requirement: Ephemeral Session Naming Convention

Ephemeral sessions MUST be named with the prefix `rk-relay-` followed by 8 lowercase hex characters generated from a cryptographically random source. The prefix `rk-relay-` is reserved by run-kit and SHALL NOT be used for any other purpose. The 8-hex suffix yields a 4 billion-entry namespace, sufficient for collision-free concurrent allocation under any realistic load.

#### Scenario: Name format
- **WHEN** the relay generates an ephemeral name
- **THEN** the name matches the regex `^rk-relay-[0-9a-f]{8}$`

#### Scenario: Concurrent allocation
- **GIVEN** N concurrent WebSocket connections opened simultaneously (N ≤ 16)
- **WHEN** each relay generates its ephemeral name
- **THEN** all N names are distinct with overwhelming probability
- **AND** `tmux new-session` succeeds for every connection

### Requirement: Ephemeral Cleanup on WebSocket Close

The relay handler MUST kill the ephemeral session when the WebSocket connection terminates, regardless of termination cause (client disconnect, PTY failure, server shutdown). Cleanup MUST use `context.Background()` rather than the request context, because the request context may already be cancelled at cleanup time. Cleanup is best-effort — failures SHALL be logged but not surfaced to the client.

#### Scenario: Normal client disconnect
- **GIVEN** an open WebSocket relay with ephemeral `rk-relay-deadbeef`
- **WHEN** the client closes the WebSocket
- **THEN** the relay invokes `tmux kill-session -t rk-relay-deadbeef` on the correct server
- **AND** `rk-relay-deadbeef` no longer appears in `tmux list-sessions`

#### Scenario: PTY start failure after ephemeral creation
- **GIVEN** the relay successfully creates ephemeral `rk-relay-cafebabe`
- **AND** the subsequent `pty.StartWithSize` call fails
- **WHEN** the relay returns
- **THEN** the deferred `KillSession` runs against `rk-relay-cafebabe`
- **AND** the ephemeral does not leak

#### Scenario: Cleanup with cancelled request context
- **GIVEN** the relay handler's request context (`r.Context()`) is cancelled
- **WHEN** the deferred kill runs
- **THEN** the kill is invoked with a fresh `context.Background()` (with `TmuxTimeout`)
- **AND** the kill completes within the timeout

#### Scenario: Cleanup failure logging
- **GIVEN** the deferred `KillSession` returns an error (e.g., session already gone)
- **WHEN** cleanup runs
- **THEN** the error is logged at debug level
- **AND** no error response is written to the (already-closed) WebSocket

## Tmux Helper: NewGroupedSession

### Requirement: NewGroupedSession Helper

A new function `NewGroupedSession(ctx context.Context, server, realSession, ephemeral string) error` MUST be added to `app/backend/internal/tmux/tmux.go`. The function SHALL invoke `tmux new-session -d -s <ephemeral> -t <realSession>` via the existing `tmuxExecServer` helper, scoped to the given server. The function MUST wrap the context with `context.WithTimeout(ctx, TmuxTimeout)` (10s), consistent with sibling tmux helpers.

#### Scenario: Successful grouped session creation
- **GIVEN** session `real` exists on server `runkit-test`
- **WHEN** `NewGroupedSession(ctx, "runkit-test", "real", "rk-relay-aaaa1111")` is called
- **THEN** `tmux -L runkit-test new-session -d -s rk-relay-aaaa1111 -t real` is invoked
- **AND** `rk-relay-aaaa1111` appears in `tmux -L runkit-test list-sessions`
- **AND** the new session shares windows with `real` (verifiable via `list-windows`)

#### Scenario: Real session does not exist
- **WHEN** `NewGroupedSession(ctx, "runkit-test", "missing", "rk-relay-bbbb2222")` is called against a server where `missing` does not exist
- **THEN** the function returns a non-nil error
- **AND** no `rk-relay-bbbb2222` session is created

#### Scenario: Context timeout enforcement
- **GIVEN** the parent context has no deadline
- **WHEN** `NewGroupedSession` is called
- **THEN** the wrapped context applies a 10-second timeout to the underlying `tmuxExecServer` call

### Requirement: TmuxOps Interface Extension

The `TmuxOps` interface in `app/backend/api/router.go` MUST be extended with the `NewGroupedSession(ctx context.Context, server, realSession, ephemeral string) error` method. The `prodTmuxOps` adapter SHALL delegate to `tmux.NewGroupedSession`. Test mocks (e.g., `mockTmuxOps`) MUST implement the new method.

#### Scenario: Production adapter
- **WHEN** `prodTmuxOps.NewGroupedSession(ctx, "runkit", "agent", "rk-relay-c0ffee01")` is called
- **THEN** it delegates to `tmux.NewGroupedSession(ctx, "runkit", "agent", "rk-relay-c0ffee01")`

## Startup Sweep: Orphaned Ephemeral Reclamation

### Requirement: Synchronous Sweep at Server Start

`rk serve` MUST sweep orphaned `rk-relay-*` sessions across all known tmux servers before binding HTTP listeners. The sweep enumerates servers via `tmux.ListServers(ctx)`, lists sessions on each server, and kills any session whose name starts with `rk-relay-`. The sweep SHALL be synchronous to eliminate races with new relays creating ephemerals at startup. Sweep failures MUST NOT prevent server startup — failures SHALL be logged and execution SHALL continue.

#### Scenario: No orphans
- **GIVEN** no `rk-relay-*` sessions exist on any known tmux server
- **WHEN** `rk serve` starts
- **THEN** the sweep completes without killing any sessions
- **AND** the HTTP listener binds normally

#### Scenario: Orphans from a crashed prior instance
- **GIVEN** sessions `rk-relay-deadbeef` (server `runkit`) and `rk-relay-cafebabe` (server `runkit-other`) exist as orphans from a prior crashed `rk serve` instance
- **WHEN** the new `rk serve` instance starts
- **THEN** the sweep invokes `tmux -L runkit kill-session -t rk-relay-deadbeef`
- **AND** invokes `tmux -L runkit-other kill-session -t rk-relay-cafebabe`
- **AND** neither session appears in any subsequent `list-sessions` call
- **AND** the HTTP listener binds after the sweep completes

#### Scenario: User session unaffected
- **GIVEN** a user session named `agent-work` exists on server `runkit`
- **WHEN** the sweep runs
- **THEN** `agent-work` is preserved (does not match the `rk-relay-` prefix)

#### Scenario: ListServers failure
- **GIVEN** `tmux.ListServers(ctx)` returns an error (e.g., `/tmp/tmux-{uid}/` unreadable)
- **WHEN** the sweep runs
- **THEN** the error is logged
- **AND** the sweep returns without killing any sessions
- **AND** `rk serve` continues to bind the HTTP listener

#### Scenario: Per-server enumeration failure
- **GIVEN** server `broken` is listed by `ListServers` but `ListSessions` fails for it
- **AND** server `runkit` lists normally
- **WHEN** the sweep runs
- **THEN** the failure for `broken` is logged
- **AND** orphans on `runkit` are still killed
- **AND** the sweep does not abort on the first failing server

### Requirement: Sweep Ordering Before HTTP Bind

The sweep MUST run before HTTP listeners bind. Specifically, in `app/backend/cmd/rk/serve.go`, the sweep call SHALL be placed after `tmux.EnsureConfig()` and before `http.Server.ListenAndServe()`. The sweep timeout SHALL be bounded (default 30s total budget) so a misbehaving tmux server cannot stall startup indefinitely.

#### Scenario: Sweep blocks listener bind
- **WHEN** `rk serve` enters its startup sequence
- **THEN** the sweep completes (or times out) before the goroutine that calls `ListenAndServe` runs

## Session List Filtering: Hide rk-relay-* from User-Facing Views

### Requirement: Filter rk-relay-* in ListSessions

`tmux.ListSessions(ctx, server)` MUST exclude any session whose name starts with `rk-relay-` from its returned slice. This is the single chokepoint — every user-facing session list (`/api/sessions` REST handler, SSE `sessions` event, board session-derivation in `app/backend/api/boards.go`, server-aggregate `/api/servers`) consumes `ListSessions` directly or transitively, so a single filter at the data layer covers every consumer.

#### Scenario: rk-relay-* session present
- **GIVEN** server `runkit` has sessions `agent`, `dev`, `rk-relay-deadbeef`
- **WHEN** `ListSessions(ctx, "runkit")` is called
- **THEN** the returned slice contains `agent` and `dev`
- **AND** does not contain `rk-relay-deadbeef`

#### Scenario: Only rk-relay-* sessions present
- **GIVEN** server `runkit` has only `rk-relay-aaaa1111` and `rk-relay-bbbb2222`
- **WHEN** `ListSessions(ctx, "runkit")` is called
- **THEN** the returned slice is empty (or nil)
- **AND** no error is returned

#### Scenario: Group leader filtering still applies
- **GIVEN** server `runkit` has `devshell` (grouped, leader), `devshell-82` (grouped copy), `rk-relay-cafebabe`
- **WHEN** `ListSessions` is called
- **THEN** the returned slice contains `devshell`
- **AND** does not contain `devshell-82` (existing group-copy filter)
- **AND** does not contain `rk-relay-cafebabe` (new ephemeral filter)

### Requirement: Filter Application Site

The filter MUST be applied inside `parseSessions` (or `ListSessions`) in `app/backend/internal/tmux/tmux.go`. The filter SHALL be a fixed-prefix check (`strings.HasPrefix(name, "rk-relay-")`), not a regex. No new options or configuration knobs SHALL be introduced — the prefix is a hardcoded internal constant.

#### Scenario: parseSessions filters by prefix
- **GIVEN** raw `list-sessions` output containing a line for `rk-relay-aaaa1111`
- **WHEN** `parseSessions(lines)` runs
- **THEN** the returned slice does not include any entry named `rk-relay-aaaa1111`

## Backwards Compatibility & Frontend Contract

### Requirement: WebSocket URL Stability

The frontend WebSocket URL MUST remain `/relay/{session}/{window}?server={server}`. Ephemeral session names SHALL NOT appear in any URL, request body, response, or SSE payload visible to the frontend. The frontend (TypeScript/React) SHALL require zero changes for this fix.

#### Scenario: URL contract unchanged
- **WHEN** the frontend opens a WebSocket via `TerminalClient`
- **THEN** the URL constructed is identical to the pre-fix URL
- **AND** the response/relay behavior is opaque to the frontend (just a working PTY stream)

### Requirement: AppShell Single-Pane Uniformity

The single-pane AppShell relay path MUST receive the same ephemeral-session treatment as board panes. There SHALL be no dispatch logic in the relay handler that special-cases boards — every WebSocket connection gets its own ephemeral. As a side effect, two browser tabs viewing different windows of the same session SHALL no longer interfere with each other's active window state.

#### Scenario: Two tabs, one session, different windows
- **GIVEN** browser tab A is at `/runkit/agent/1` (single-pane AppShell)
- **AND** browser tab B is at `/runkit/agent/2` (single-pane AppShell)
- **WHEN** both tabs are open simultaneously
- **THEN** tab A's terminal continuously shows window 1 content
- **AND** tab B's terminal continuously shows window 2 content
- **AND** tab activity in either does not change the other's displayed window

## Test Coverage

### Requirement: Tmux Helper Integration Test

`app/backend/internal/tmux/tmux_test.go` MUST add an integration test for `NewGroupedSession` following the existing `withSessionOrderTmux(t)` pattern (isolated tmux server `rk-test-<pid>-<nano>`, `t.Cleanup` kills the server). The test SHALL verify: (a) creation succeeds against an existing real session, (b) the new session is listed by `tmux list-sessions`, (c) `tmux list-windows -t <ephemeral>` returns the same window set as the real session, (d) creation against a non-existent real session returns a non-nil error.

#### Scenario: Round-trip creation
- **GIVEN** an isolated tmux test server with session `real` (windows `0..2`)
- **WHEN** `NewGroupedSession(ctx, server, "real", "rk-relay-test1234")` is called
- **THEN** the call returns nil
- **AND** `list-sessions` includes `rk-relay-test1234`
- **AND** `list-windows -t rk-relay-test1234` returns 3 windows matching `real`

#### Scenario: Non-existent real session
- **WHEN** `NewGroupedSession(ctx, server, "ghost", "rk-relay-test5678")` is called against a server where `ghost` does not exist
- **THEN** the call returns a non-nil error

### Requirement: Relay End-to-End Test

`app/backend/api/relay_test.go` MUST be created with at least one end-to-end test that opens two simultaneous WebSocket relay connections to the same real session targeting different windows, and asserts that the PTY output streams differ. The test SHALL skip cleanly if `tmux` is not on the test host's PATH (matching `withSessionOrderTmux` style). The test MUST verify that no `rk-relay-*` sessions remain after both WebSockets close.

#### Scenario: Two windows, two relays, two distinct outputs
- **GIVEN** an isolated tmux server with session `real` (windows `0` and `1`)
- **AND** window 0 was created with shell command `echo WINDOW_ZERO; sleep 30`
- **AND** window 1 was created with shell command `echo WINDOW_ONE; sleep 30`
- **WHEN** WebSocket A is opened to window 0 and WebSocket B is opened to window 1
- **THEN** A's received PTY bytes contain `WINDOW_ZERO` (within a reasonable read window)
- **AND** B's received PTY bytes contain `WINDOW_ONE`
- **AND** A's received bytes do not contain `WINDOW_ONE`
- **AND** B's received bytes do not contain `WINDOW_ZERO`

#### Scenario: Cleanup verification
- **GIVEN** the two-window two-relay scenario above
- **WHEN** both WebSockets are closed
- **THEN** within the cleanup window, `tmux list-sessions` for that server contains zero `rk-relay-*` entries

### Requirement: E2E Board Test Extension

The Playwright spec covering boards (`app/frontend/tests/e2e/boards-pin-flow.spec.ts` or a new sibling spec) SHOULD be extended to cover the multi-window same-session board case. The test SHALL pin two windows from the same tmux session into one board and assert that each board pane displays its targeted window's content (e.g., distinct window titles or echo output). A companion `*.spec.md` file MUST be updated or created per the constitution's "Test Companion Docs" rule.

#### Scenario: Same-session multi-pane board
- **GIVEN** a tmux session `agent` with two distinct windows
- **WHEN** the user pins both windows to a board and views the board
- **THEN** each board pane shows its targeted window's distinct content (not duplicate content)

## Sweep Helper Function Surface

### Requirement: Sweep Function Signature

The startup sweep SHALL be implemented as `sweepOrphanedRelaySessions(ctx context.Context, ops TmuxOps) error` in `app/backend/cmd/rk/serve.go` (or an `internal/relay/` helper if cleaner) and invoked from the serve command before HTTP bind. The function SHALL accept the `TmuxOps` interface (or the concrete `tmux` package) so it is testable without a live tmux server. The return value is informational — the caller MAY log and ignore it.

#### Scenario: Function returns nil on success
- **GIVEN** a normal startup with zero orphans
- **WHEN** `sweepOrphanedRelaySessions(ctx, ops)` is called
- **THEN** it returns nil

#### Scenario: Function returns aggregate error on partial failure
- **GIVEN** one server returns a `ListSessions` error
- **AND** another server has orphans cleaned successfully
- **WHEN** the sweep runs
- **THEN** the function may return a non-nil error describing the per-server failures
- **AND** the caller (`serveCmd.RunE`) logs and continues startup

## Constitution Alignment

### Requirement: Security First (Constitution I)

The ephemeral session name format `rk-relay-<8 hex>` MUST be generated from a fixed format string, not from any user-controlled input. The 8 hex characters SHALL come from `crypto/rand`. No part of the URL path, query parameters, or WebSocket frames SHALL influence the ephemeral name. All `tmux new-session` and `tmux kill-session` invocations SHALL pass arguments as discrete slice elements (no shell strings).

#### Scenario: Random source
- **WHEN** the ephemeral name is generated
- **THEN** the 8-hex suffix is read from `crypto/rand.Read`
- **AND** is never derived from session name, window index, server name, or any HTTP header

#### Scenario: Argv safety
- **WHEN** any tmux command in this change is constructed
- **THEN** it is passed as `[]string{"new-session", "-d", "-s", ephemeral, "-t", real}` (or equivalent), not via shell-string concatenation

### Requirement: No Database (Constitution II)

The ephemeral session is itself transient tmux state. No file, database, or in-memory cache MUST be introduced to track ephemeral lifecycle. The lifecycle binding is `defer KillSession` in the relay handler plus the startup sweep — no separate registry.

### Requirement: Tmux Sessions Survive Server Restarts (Constitution VI)

The startup sweep MUST match only the `rk-relay-` prefix. User sessions, daemon sessions (`rk` on `rk-daemon` server), and all non-rk-relay sessions SHALL be unaffected by the sweep. The sweep is the inverse direction of Constitution VI's intent: it removes only run-kit's own orphans, never user work.

#### Scenario: Sweep does not touch user sessions
- **GIVEN** server `runkit` has `agent`, `dev`, `rk-daemon-host` (a hypothetical user-named session that happens to start with `rk-`), and `rk-relay-deadbeef`
- **WHEN** the sweep runs
- **THEN** only `rk-relay-deadbeef` is killed
- **AND** `rk-daemon-host` is preserved (does not match the full prefix `rk-relay-`)

## Design Decisions

1. **Use tmux session groups (`new-session -t <real>`) over re-architecting the relay**:
   - *Why*: tmux supports grouped sessions natively — sessions in a group share window membership but have independent active-window state. This is the exact tmux feature the bug needs; using it is one `new-session` call per WebSocket plus a `kill-session` on close.
   - *Rejected*: Re-architecting the relay to multiplex multiple windows onto one client (e.g., per-window terminal pool) would require coordinating active-window state across goroutines, fighting tmux's session-client model. Larger blast radius, no semantic gain.

2. **Backend fix in the relay (not a frontend pool refactor like PR #178)**:
   - *Why*: The `SelectWindow + attach-session -t <session>` sequence in `relay.go` is the bug source. PR #178's frontend pool keeps that backend sequence intact, so the bug persists with or without it. The fix has to live where the tmux command sequence lives.
   - *Rejected*: Frontend pool optimization is orthogonal — it improves WebSocket reuse but does not change the relay's tmux interaction.

3. **Per-WebSocket ephemerals (not per-pane or per-tab caching)**:
   - *Why*: Each `attach-session` is one tmux client and contributes one set of "active window" state. The natural unit of isolation is one ephemeral session per WebSocket, lifetime-bound to the WS via `defer KillSession`.
   - *Rejected*: Per-tab caching (one ephemeral per browser tab, reused across panes) requires tracking tab identity across reconnects and complicates cleanup. Per-pane caching has the same issue at finer granularity. WebSocket lifetime is the cleanest binding.

4. **Random hex suffix (not deterministic per-pane name)**:
   - *Why*: 8 hex chars yield a 4B-entry namespace, eliminating collision concerns at all realistic scales. Random suffix avoids encoding any pane/connection metadata into the session name (keeps the surface inside the relay handler).
   - *Rejected*: Deterministic names like `rk-relay-<session>-<window>-<connID>` would be human-readable but require a connection counter or clock source and risk collisions on restart.

5. **Synchronous sweep before HTTP bind (not async best-effort)**:
   - *Why*: Eliminates the race between the sweep killing and a new relay creating an ephemeral with the same name (vanishingly unlikely with 8 hex chars but free to eliminate). Perf cost is tens of ms — acceptable for one-time startup work.
   - *Rejected*: Async sweep would let the HTTP listener bind sooner but introduces a window where new relays could conceivably collide with a sweep-in-progress. Not worth the complexity savings.

6. **Filter `rk-relay-*` inside `ListSessions` (single chokepoint, not per-consumer)**:
   - *Why*: Every user-facing session list ultimately consumes `tmux.ListSessions`. Filtering at the data layer guarantees no user-facing surface ever sees ephemerals, regardless of future consumers (the upcoming multi-server SessionProvider refactor included).
   - *Rejected*: Filtering per-consumer (in `/api/sessions` handler, SSE hub, board derivation, server-aggregate) would create N filter sites that must stay in sync. One missed filter would leak ephemerals into the UI.

7. **Apply ephemeral treatment uniformly (boards + AppShell single-pane)**:
   - *Why*: Avoids dispatch logic in the relay and fixes a latent bug where two tabs to the same session interfere with each other's active window. Uniform behavior is simpler.
   - *Rejected*: Special-casing boards would require the relay to know whether the request is from a board pane vs AppShell — leaking frontend context into the backend.

8. **`context.Background()` for cleanup (not `r.Context()`)**:
   - *Why*: Request context is cancelled on disconnect — the trigger for cleanup. Reusing it would ensure the kill is immediately cancelled. A fresh `context.Background()` with `TmuxTimeout` is the correct cleanup-context pattern.
   - *Rejected*: Reusing `r.Context()` is the bug — kills would never run.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Use tmux grouped sessions (`new-session -d -s <ephemeral> -t <real>`) per WebSocket — one ephemeral per relay connection | Confirmed from intake #1 — tmux's documented mechanism for "two clients in same windows but different active-window state"; matches root cause exactly | S:95 R:80 A:90 D:95 |
| 2 | Certain | Ephemeral session naming convention: `rk-relay-<8 hex chars>` | Confirmed from intake #2 — fixed prefix enables sweep matching; 8 hex = 4B namespace, collision-free at any realistic scale | S:90 R:90 A:85 D:85 |
| 3 | Certain | Cleanup is `defer KillSession` in the relay handler with `context.Background()` (not the request context) | Confirmed from intake #3 — request context cancellation is the trigger for cleanup, so reusing it would deadlock the kill | S:95 R:85 A:85 D:90 |
| 4 | Certain | Startup sweep iterates all servers from `ListServers()` and kills any session matching `rk-relay-*` | Confirmed from intake #4 — ephemerals are per-server; sweep prefix is fixed and unique to run-kit | S:90 R:80 A:85 D:90 |
| 5 | Certain | Sweep runs synchronously before HTTP listeners bind | Confirmed from intake #5 — eliminates race with new relays creating ephemerals at startup; perf cost is tens of ms | S:85 R:85 A:80 D:85 |
| 6 | Certain | Frontend contract unchanged: WebSocket URL stays `/relay/<session>/<window>?server=<server>` | Confirmed from intake #6 — ephemeral name is purely internal to the relay; no API surface change | S:95 R:95 A:95 D:95 |
| 7 | Certain | The AppShell single-pane route also gets ephemeral-session treatment (no special-case for boards) | Confirmed from intake #7 — fixes a latent bug (two tabs same session interfering) and avoids dispatch logic; uniform behavior is simpler | S:90 R:75 A:85 D:85 |
| 8 | Certain | Cross-server boards already work — fix is strictly per-server | Confirmed from intake #8 — each tmux server is its own Unix socket and process; sessions on different servers cannot interfere by construction | S:95 R:95 A:95 D:95 |
| 9 | Certain | PR #178 (terminal pool) does NOT address this bug and is orthogonal | Confirmed from intake #9 — PR #178 keeps `SelectWindow + attach-session -t <session>` in the relay; bug persists with or without it | S:95 R:95 A:90 D:95 |
| 10 | Certain | Filter `rk-relay-*` from user-facing session lists at the `tmux.ListSessions`/`parseSessions` chokepoint, not per-consumer | Upgraded from intake #10 — single chokepoint guarantees no user-facing leak across all current and future consumers (multi-server SessionProvider, board derivation, etc.) | S:95 R:85 A:95 D:95 |
| 11 | Certain | `select-window -t <ephemeral>:<windowIndex>` resolves to the same window as the real session at that index | Upgraded from intake #11 — verified by tmux's documented group semantics: grouped sessions share window list and indices; integration test will confirm at apply time | S:90 R:80 A:85 D:90 |
| 12 | Certain | When a window is killed mid-attach, the existing reconnect path (close code 4004) handles it cleanly without new code | Upgraded from intake #12 — group membership inheritance means the ephemeral inherits the window kill, PTY closes, existing close-code-4004 path runs; no new failure mode | S:85 R:85 A:80 D:85 |
| 13 | Certain | E2E + integration test coverage gap must be closed: relay test for two-relay-distinct-output, tmux test for `NewGroupedSession`, board e2e extension for same-session multi-pane | Confirmed from intake #13 — bug shipped because no test exercised same-session multi-pane; closing the gap is mandatory not optional | S:95 R:90 A:85 D:90 |
| 14 | Certain | `NewGroupedSession` is added as a new top-level function in `tmux.go`, mirroring sibling helpers (`KillSession`, `SelectWindow`) — not as a method on a new struct | Spec-stage analysis — `tmux.go` uses package-level functions throughout; introducing a struct would break the pattern. The function takes `(ctx, server, real, ephemeral)` mirroring `KillSession`/`SelectWindow` shapes | S:90 R:90 A:95 D:90 |
| 15 | Certain | The `TmuxOps` interface in `router.go` MUST be extended with `NewGroupedSession` so the relay handler dispatches through the interface (matching `SelectWindow`, `ListWindows`, etc.) — not by calling `tmux.NewGroupedSession` directly | Spec-stage analysis — the relay already uses `s.tmux.SelectWindow` and `s.tmux.ListWindows` via the interface; adding a direct-package call would create an inconsistency | S:95 R:90 A:95 D:90 |
| 16 | Certain | Sweep is implemented as `sweepOrphanedRelaySessions(ctx, ops)` in `cmd/rk/serve.go` and invoked from `serveCmd.RunE` after `tmux.EnsureConfig()` and before the goroutine starting `ListenAndServe` | Spec-stage analysis — co-locates with other startup-sequence steps; the existing `serve.go` structure has the right insertion point on line ~110 (before `router := api.NewRouter`) | S:90 R:85 A:90 D:90 |
| 17 | Certain | Filter is applied inside `parseSessions` (or the immediate post-parse step in `ListSessions`) using `strings.HasPrefix(name, "rk-relay-")` — not via a regex, not via a config option | Spec-stage analysis — `parseSessions` is already the canonical filter site for grouped-session copies; extending it keeps all session-list filtering in one function | S:95 R:90 A:95 D:95 |

17 assumptions (17 certain, 0 confident, 0 tentative, 0 unresolved).
