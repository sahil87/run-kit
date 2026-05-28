# Spec: Active Window Sync — tmux truth, URL as bookmark

**Change**: 260528-nvlp-active-window-sync
**Created**: 2026-05-28
**Affected memory**: `docs/memory/run-kit/architecture.md`, `docs/memory/run-kit/tmux-sessions.md`, `docs/memory/run-kit/ui-patterns.md`

## Non-Goals

- **Replacing the `IsActiveWindow` field on `WindowInfo`** — the field stays; this change makes it authoritative at the UI rather than incidental. SSE payload shape is preserved.
- **Removing the 2.5s SSE poll entirely** — the poll is *demoted* to a 12s safety-net backstop, not deleted. Unmanaged scenarios (PTY unavailable, control-mode reconnect gap, tmux versions older than this contract) MUST still converge eventually.
- **A new SSE event type** — control-mode notifications are translated into existing `sessions` / `session-order` / `board-changed` SSE events. No new frontend event handlers.
- **Per-client (browser tab) current-window state** — explicitly rejected in intake §Origin step 4. All clients on the same server converge on the same window.
- **Synchronizing across tmux servers** — clients viewing different rk-managed tmux servers stay independent. This is a per-server invariant only.
- **Auto-following terminal-user window switches *and* a separate "tmux active" indicator badge in the sidebar** — there's one notion of "current"; the URL follows it. No secondary indicator.
- **Configuring which tmux servers `rk serve` subscribes to** — auto-discovery is the only mode (intake assumption #19, #23).
- **Pin-popover or board interaction changes** — boards' interaction model is unchanged. Only board cleanup latency improves as a free side effect.
- **`rk notify` CLI subcommand / `/notify` HTTP endpoint / per-socket lockfile** — explicitly removed from the intake's initial proposal after PR #197's Non-Goal on lockfiles. The control-mode connection replaces all three.

## Backend: tmuxctl Subscriber Package

### Requirement: `internal/tmuxctl/Client` opens a long-running tmux control-mode connection per tmux server

A new package `app/backend/internal/tmuxctl/` SHALL be created. The package's `Client` type MUST manage a single `tmux -CC -L <socket> attach-session -t <bootstrap> -r` subprocess via `creack/pty`. The Client SHALL:

- Allocate a PTY via `pty.Start(cmd)` (`creack/pty` v1.1.24, already on `go.mod`).
- Use `exec.CommandContext` with no overall timeout (the connection is long-lived; per-write timeouts are not appropriate). The context is cancelled by the Client's `Close()` method.
- Use the **stable** `=`-anchored target form `attach-session -t =<bootstrap-name>` to avoid prefix-match collisions (consistent with PR #196's anchored-target convention).
- Spawn one goroutine reading lines from the PTY via `bufio.Scanner`, dispatching each line into the parser.

The Client MUST expose:

```go
type Client struct {
    // ... internal state
}

// Open begins the control-mode subscription on the given socket. Non-blocking;
// the read loop runs in a goroutine. Returns an error only if the initial
// PTY allocation or process start fails — subsequent disconnects are handled
// by reconnect, not surfaced as errors.
func Open(ctx context.Context, socket string, sink EventSink) (*Client, error)

// Close terminates the subscription. Idempotent.
func (c *Client) Close() error

// Generation returns the per-server generation counter. Each handled
// notification increments it; readers compare against a previous value
// to detect change. Atomic.
func (c *Client) Generation() int64

// Wait returns a channel that's closed when the generation counter has
// advanced past the value passed in. Used by the SSE loop. The waiter
// is single-use; callers re-call Wait after each event consumed.
func (c *Client) Wait(after int64) <-chan struct{}
```

The `EventSink` interface receives parsed notifications:

```go
type EventSink interface {
    OnSessionWindowChanged(sessionID, windowID string)
    OnWindowAdd(windowID string)
    OnWindowClose(windowID string)
    OnWindowRenamed(windowID, name string)
    OnSessionsChanged()
    OnLayoutChange(windowID string)
    OnConnectionLost()
    OnConnectionEstablished()
}
```

<!-- clarified: EventSink callback concurrency contract — single-goroutine dispatch, sink must not block; matches existing internal/ patterns -->
EventSink callbacks SHALL all be invoked from a single goroutine (the Client's read loop). Sink implementations MUST NOT block — handlers SHALL complete quickly (e.g., atomic counter increment + channel close) and offload any non-trivial work to their own goroutine. Callback ordering reflects the order of notifications received from tmux.

#### Scenario: Open succeeds against a tmux server with at least one existing session
- **GIVEN** tmux server `-L kits` is running with at least one session
- **AND** `/dev/ptmx` is available
- **WHEN** `tmuxctl.Open(ctx, "kits", sink)` is called
- **THEN** a `tmux -CC -L kits attach-session -t =<bootstrap> -r` subprocess SHALL be spawned via `pty.Start`
- **AND** the bootstrap target SHALL be the first session returned by `tmux -L kits list-sessions -F '#{session_name}'`
- **AND** the read goroutine SHALL begin scanning lines from the PTY
- **AND** the first `%begin` line SHALL be recognised and the response parsed
- **AND** `sink.OnConnectionEstablished()` SHALL be called once the initial output block completes

<!-- clarified: anchor-creation race — if another rk instance creates _rk-ctl first, treat "duplicate session" as benign and continue (per assumption #7 multi-rk by construction) -->
#### Scenario: Open against a tmux server with zero sessions creates `_rk-ctl` anchor
- **GIVEN** tmux server `-L my-new` exists but has zero sessions
- **WHEN** `tmuxctl.Open(ctx, "my-new", sink)` is called
- **THEN** the Client SHALL first run `tmux -L my-new new-session -d -s _rk-ctl` to create a detached anchor session
- **AND** if the `new-session` command fails because `_rk-ctl` already exists (e.g., a concurrent `rk serve` created it first), the Client SHALL treat the error as benign and proceed to the attach step
- **AND** the anchor session SHALL have option `@rk_ctl_keepalive=1` set via `set-option -t =_rk-ctl @rk_ctl_keepalive 1` (the option is idempotent and safe to re-set if another rk already created the anchor)
- **AND** the subsequent `tmux -CC attach -t =_rk-ctl -r` SHALL succeed
- **AND** the `_rk-ctl` session SHALL NOT appear in user-facing SSE `sessions` payloads (see § Sessions API: `_rk-ctl` Filtering)

#### Scenario: Open without `/dev/ptmx` degrades gracefully
- **GIVEN** the host has no `/dev/ptmx` (e.g., a restricted container)
- **WHEN** `tmuxctl.Open(ctx, socket, sink)` is called
- **THEN** the PTY allocation SHALL fail and `Open` SHALL return an error wrapping the underlying `pty.Open` error
- **AND** the caller (Supervisor) SHALL log one `slog.Warn("tmuxctl: PTY unavailable, control-mode disabled", "socket", socket, "err", err)` per socket
- **AND** no retry SHALL be attempted for that socket
- **AND** the SSE safety-net poll SHALL continue serving updates with the existing 12s cadence

### Requirement: Client reconnects with exponential backoff on read error or EOF

When the PTY read loop encounters EOF or any error other than a context cancellation triggered by `Close()`, the Client MUST:

1. Call `sink.OnConnectionLost()` exactly once.
2. Tear down the subprocess (`cmd.Process.Kill()` if still running; `cmd.Wait()` to reap).
3. Wait `backoff` duration (initial 250ms).
4. Attempt a fresh `pty.Start` of the same `tmux -CC` command.
5. On successful first `%begin` parse, call `sink.OnConnectionEstablished()` and reset `backoff = 250ms`.
6. On retry failure, double `backoff` up to a cap of 5 seconds: 250ms → 500ms → 1s → 2s → 5s → 5s …
7. Continue retrying indefinitely until `Close()` is called.

Reconnect MUST NOT block any caller — the read loop owns reconnect state.

#### Scenario: Tmux server restart triggers reconnect
- **GIVEN** an open `tmuxctl.Client` connected to `-L kits`
- **WHEN** `tmux -L kits kill-server` runs externally
- **THEN** the PTY read loop SHALL observe EOF
- **AND** `sink.OnConnectionLost()` SHALL be called exactly once
- **AND** the Client SHALL wait 250ms then attempt `pty.Start` again
- **AND** because no tmux server is running on `-L kits`, the new subprocess SHALL exit immediately and the read loop SHALL observe EOF again
- **AND** subsequent waits SHALL follow the 500ms / 1s / 2s / 5s / 5s sequence
- **AND** when the user runs `tmux -L kits new-session` later, the next retry SHALL succeed
- **AND** `sink.OnConnectionEstablished()` SHALL be called and the backoff SHALL reset to 250ms

#### Scenario: Reconnect resets backoff after one successful read
- **GIVEN** an open `tmuxctl.Client` with current `backoff = 5s` after multiple failures
- **AND** a reconnect attempt succeeds and emits a `%begin` line
- **WHEN** the first non-`%begin` event arrives (e.g., a heartbeat or notification)
- **THEN** the Client SHALL reset `backoff` to the initial 250ms
- **AND** the next disconnect SHALL start a fresh backoff sequence

### Requirement: Parser handles control-mode notifications and framing markers as pure functions

A `ParseLine(line string) Event` function MUST be implemented as a pure function (no I/O, no time dependence). It SHALL recognise:

- `%begin <epoch> <cmdnum> <flags>` → `BeginEvent`
- `%end <epoch> <cmdnum> <flags>` → `EndEvent`
- `%error <epoch> <cmdnum> <flags>` → `ErrorEvent`
- `%session-window-changed <session-id> <window-id>` → `SessionWindowChangedEvent{SessionID, WindowID}`
- `%window-add <window-id>` → `WindowAddEvent{WindowID}`
- `%window-close <window-id>` → `WindowCloseEvent{WindowID}`
- `%window-renamed <window-id> <name>` → `WindowRenamedEvent{WindowID, Name}` (Name is the rest of the line, may contain spaces)
- `%sessions-changed` → `SessionsChangedEvent{}`
- `%layout-change <window-id> <window-layout> <visible-layout> <window-flags>` → `LayoutChangeEvent{WindowID}` (other fields parsed but discarded for v1)
- `%output <pane-id> <value>` → silently dropped (control mode's normal pane-output stream; not relevant to subscription)
- `%unlinked-window-*` → silently dropped (out of scope)
- All other lines (other `%`-prefixed notifications, content lines inside `%begin`/`%end` blocks) → silently dropped

Parsing MUST NOT panic on malformed input. Unknown notification names SHALL be returned as `UnknownEvent{Raw: line}` and logged at `slog.Debug` exactly once per unique notification name (to surface tmux protocol additions without spamming logs).

#### Scenario: Standard notification parses to typed event
- **GIVEN** the parser is called with `%session-window-changed $3 @42`
- **WHEN** `ParseLine` returns
- **THEN** the result SHALL be `SessionWindowChangedEvent{SessionID: "$3", WindowID: "@42"}`

#### Scenario: Window-renamed with spaces in name
- **GIVEN** the parser is called with `%window-renamed @42 my new window name`
- **WHEN** `ParseLine` returns
- **THEN** the result SHALL be `WindowRenamedEvent{WindowID: "@42", Name: "my new window name"}`
- **AND** Name SHALL preserve all whitespace except the single leading space after the window id

#### Scenario: Unknown notification is logged once and dropped
- **GIVEN** tmux emits a hypothetical `%future-feature foo bar`
- **WHEN** `ParseLine` is called repeatedly with this line
- **THEN** the first call SHALL emit `slog.Debug("tmuxctl: unknown notification", "name", "future-feature")`
- **AND** subsequent calls SHALL NOT log
- **AND** every call SHALL return `UnknownEvent{Raw: "%future-feature foo bar"}`

#### Scenario: Malformed input does not panic
- **GIVEN** the parser is called with `%session-window-changed` (missing arguments) or `` (empty string)
- **WHEN** `ParseLine` returns
- **THEN** the result SHALL be `MalformedEvent{Raw: line}` or `UnknownEvent`
- **AND** no panic SHALL occur

### Requirement: Supervisor discovers tmux sockets via fsnotify and manages per-socket Clients

The `internal/tmuxctl/Supervisor` type MUST own a `map[socket]*Client` and SHALL:

- On `Start(ctx)`: enumerate the watch directory (`$TMUX_TMPDIR` if set, else `/tmp/tmux-<uid>/`), open a `Client` for every regular file (socket) found, and register an `fsnotify.Watcher` on the directory.
- On every fsnotify `Create` event: if the new file is a regular file under the watch directory, call `Open` and insert into the map. Idempotent — re-creating a socket of the same name (close-then-reopen during the same Supervisor lifetime) SHALL Close the prior Client before opening a new one.
- On every fsnotify `Remove` event: look up the matching `Client` and call `Close()`. Remove from the map.
- On `Stop()` (or `ctx.Done()`): Close every Client in the map and stop the watcher.

Concurrency: the map MUST be protected by a `sync.Mutex`. Per-Client `Open`/`Close` calls MAY run while the lock is held — they do not block (they return immediately after starting the goroutine and process).

The watch directory resolution rules:

- If `TMUX_TMPDIR` env var is set and non-empty → use that.
- Else → use `/tmp/tmux-<euid>/` where `<euid>` is `os.Geteuid()`.
- If the directory does not exist at `Start` time → log `slog.Warn("tmuxctl: socket directory missing", "path", dir)` and create the directory with `os.MkdirAll(dir, 0o700)`. fsnotify will then receive `Create` events as sockets appear.

#### Scenario: Cold start with three existing tmux sockets
- **GIVEN** `/tmp/tmux-1001/` contains three socket files: `kits`, `t2`, `t3`
- **WHEN** `Supervisor.Start(ctx)` is called
- **THEN** the Supervisor SHALL register an fsnotify watch on `/tmp/tmux-1001/`
- **AND** SHALL open a `Client` for each of `kits`, `t2`, `t3`
- **AND** the map SHALL contain three entries after `Start` returns

#### Scenario: New tmux server is auto-discovered at runtime
- **GIVEN** a running `Supervisor` with two open Clients (`kits`, `t2`)
- **WHEN** the user runs `tmux -L my-new new-session` from another shell
- **THEN** fsnotify SHALL emit a `Create` event for `/tmp/tmux-1001/my-new`
- **AND** the Supervisor SHALL call `Open(ctx, "my-new", sink)` within 100ms
- **AND** the map SHALL contain three entries

#### Scenario: Killed tmux server is auto-unsubscribed
- **GIVEN** a running `Supervisor` with an open Client for `-L kits`
- **WHEN** the user runs `tmux -L kits kill-server`
- **THEN** fsnotify SHALL emit a `Remove` event for `/tmp/tmux-1001/kits`
- **AND** the Supervisor SHALL call `kitsClient.Close()` within 100ms
- **AND** the map SHALL no longer contain the `kits` entry
- **NOTE**: The Client itself would also detect EOF independently and begin reconnect; the Supervisor's explicit `Close` takes precedence and prevents reconnect (Close cancels the Client's context, terminating the reconnect loop).

#### Scenario: Watch directory missing at Start
- **GIVEN** `/tmp/tmux-1001/` does not exist (fresh boot, no tmux ever started)
- **WHEN** `Supervisor.Start(ctx)` is called
- **THEN** one `slog.Warn("tmuxctl: socket directory missing", "path", "/tmp/tmux-1001/")` SHALL be emitted
- **AND** the directory SHALL be created via `os.MkdirAll("/tmp/tmux-1001/", 0o700)`
- **AND** the fsnotify watcher SHALL register on the now-existing directory
- **AND** subsequent `tmux -L foo new-session` SHALL create the socket and trigger the standard Create-event path

#### Scenario: TMUX_TMPDIR override
- **GIVEN** `TMUX_TMPDIR=/run/user/1001/tmux` is set in the environment of `rk serve`
- **WHEN** `Supervisor.Start(ctx)` is called
- **THEN** the watch directory SHALL be `/run/user/1001/tmux` (not the default `/tmp/tmux-1001/`)
- **AND** all socket-creation events SHALL be observed under that directory

## Backend: SSE Loop Refactor

### Requirement: SSE snapshot loop is event-driven with a safety-net ticker

`app/backend/api/sse.go` SHALL refactor its per-server poll goroutine to drive snapshot rebuilds from a `select` over (a) the `tmuxctl.Client.Wait(after)` channel for the server and (b) a `time.NewTicker(safetyPollInterval)` backstop.

- `safetyPollInterval` SHALL be `12 * time.Second` (replacing the existing `ssePollInterval = 2500 * time.Millisecond`).
- The existing `ssePollInterval` constant MAY be removed once all references are migrated.
- On every signal (control-mode-driven OR ticker-driven), the goroutine SHALL: invalidate the per-server snapshot cache, call `sessions.FetchSessions(ctx, server)`, run the `detectKilledWindowIDs` diff (see next requirement), broadcast `event: sessions`, broadcast any resulting `event: board-changed { change: "cleanup" }` events.
- If the tmuxctl Client for the server is unavailable (PTY-unavailable case from Requirement above), the goroutine SHALL run on the ticker only.
- The SSE goroutine MUST NOT block on a slow Client's channel — it uses `Wait(after)` which is closed-on-event and never blocks longer than needed.

#### Scenario: Control-mode push triggers immediate snapshot
- **GIVEN** an SSE client is connected to `?server=kits`
- **AND** a `tmuxctl.Client` for `kits` is open
- **WHEN** `tmux -L kits select-window -t my-session:3` runs externally
- **THEN** the Client SHALL receive `%session-window-changed $X @Y`
- **AND** the Client's generation counter SHALL increment by 1
- **AND** the `Wait(prevGen)` channel SHALL be closed
- **AND** the SSE goroutine SHALL build a fresh snapshot via `FetchSessions`
- **AND** SHALL broadcast `event: sessions` to all clients on `?server=kits` within 200ms of the `tmux select-window` call (target latency; 500ms hard upper bound for the integration test)

#### Scenario: Safety-net ticker fires when no control-mode events arrive
- **GIVEN** an SSE client is connected to `?server=kits`
- **AND** no notifications have arrived for 12 seconds
- **WHEN** the safety ticker fires
- **THEN** the SSE goroutine SHALL build a snapshot and broadcast `event: sessions`
- **AND** the snapshot freshness SHALL be no worse than 12 seconds

#### Scenario: PTY-unavailable falls back cleanly to ticker-only
- **GIVEN** a tmux server `-L kits` exists but PTY allocation failed at Open time
- **AND** no `tmuxctl.Client` is in the Supervisor map for `kits`
- **WHEN** an SSE client connects to `?server=kits`
- **THEN** the SSE goroutine SHALL still run, driven only by the 12s safety ticker
- **AND** `event: sessions` payloads SHALL still be broadcast with the same shape as the control-mode-driven case
- **AND** no error SHALL be raised to the SSE client

### Requirement: Killed-window-id diff moves into the snapshot builder

The board stale-entry cleanup logic that currently lives inline in the SSE poll loop (`app/backend/api/sse.go` lines around 428–455 per the intake's reference) SHALL be extracted into a pure function and called from the snapshot-build entry point:

```go
// detectKilledWindowIDs returns the set of window ids that were present in
// `prev` but are absent in `current`. Pure function; no I/O.
func detectKilledWindowIDs(prev, current map[string]struct{}) []string
```

The snapshot builder SHALL maintain `prev` and `current` per server, compute the killed set on every snapshot bump (whether control-mode-driven or ticker-driven), and for each killed window id:

1. Call `tmux.RemoveAllByWindowID(ctx, server, windowID)` (existing helper).
2. Broadcast one `event: board-changed { change: "cleanup", server, windowId }` per affected board.

`prev` MUST be initialised from `current` on the first snapshot after a Supervisor restart (no synthetic cleanup events on cold start).

#### Scenario: Window killed externally triggers board cleanup within control-mode latency
- **GIVEN** a window `@42` on server `kits` is pinned to board `dev`
- **AND** the SSE loop is event-driven via tmuxctl
- **WHEN** `tmux -L kits kill-window -t my-session:5` (where window 5 has id `@42`) runs externally
- **THEN** the tmuxctl Client SHALL receive `%window-close @42`
- **AND** the generation counter SHALL increment
- **AND** the snapshot builder SHALL include the killed id in `detectKilledWindowIDs`
- **AND** `tmux.RemoveAllByWindowID(ctx, "kits", "@42")` SHALL run
- **AND** one `event: board-changed { board: "dev", change: "cleanup", server: "kits", windowId: "@42" }` SHALL be broadcast
- **AND** end-to-end latency (kill-window → broadcast) SHALL be < 500ms

#### Scenario: First snapshot does not emit synthetic cleanup events
- **GIVEN** `rk serve` has just started and the snapshot builder runs for the first time on server `kits`
- **WHEN** the first snapshot completes
- **THEN** `detectKilledWindowIDs(prev: empty, current: {...})` SHALL return an empty slice (no synthetic deletes)
- **AND** zero `event: board-changed { change: "cleanup" }` events SHALL be broadcast as a result of this initial snapshot

## Backend: `_rk-ctl` Session Filtering

### Requirement: The `_rk-ctl` anchor session is hidden from user-facing surfaces

The `_rk-ctl` session created by `tmuxctl.Client` (when needed to anchor a control-mode connection) MUST NOT appear in:

- The SSE `event: sessions` payload
- The REST `GET /api/sessions?server=<name>` response
- The `Board: Switch to <name>` and other UI surfaces derived from session enumeration

`parseSessions` in `app/backend/internal/tmux/tmux.go` already early-skips lines whose `#{session_name}` starts with `RelaySessionPrefix` ("`rk-relay-`"). This requirement adds a parallel skip for the literal name `_rk-ctl`:

- A new exported constant `tmux.ControlAnchorSessionName = "_rk-ctl"` SHALL be introduced.
- `parseSessions` SHALL skip any line whose `#{session_name}` equals `ControlAnchorSessionName`.
- The startup sweep `sweepOrphanedRelaySessions` SHALL NOT touch `_rk-ctl` sessions (they are owned by `tmuxctl`, not the relay).

#### Scenario: `_rk-ctl` does not appear in SSE sessions
- **GIVEN** a fresh tmux server `-L my-new` with zero pre-existing sessions
- **AND** `rk serve` opens a tmuxctl Client that creates the `_rk-ctl` anchor
- **AND** the user then runs `tmux -L my-new new-session -s real-work`
- **WHEN** an SSE client connects to `?server=my-new`
- **THEN** the `event: sessions` payload SHALL contain exactly one ProjectSession: `real-work`
- **AND** `_rk-ctl` SHALL NOT appear

#### Scenario: `_rk-ctl` does not get reaped by the relay sweep
- **GIVEN** an `_rk-ctl` anchor exists on `-L my-new` (created by tmuxctl)
- **AND** no `rk-relay-*` sessions exist
- **WHEN** `sweepOrphanedRelaySessions(ctx)` runs at `rk serve` startup
- **THEN** the sweep SHALL NOT call `KillSessionCtx` on `_rk-ctl`
- **AND** the `_rk-ctl` session SHALL remain after the sweep

### Requirement: Anchor session is keepalive-tagged and never auto-promoted to a user session

The anchor session created by `tmuxctl.Client` SHALL be tagged with the server-scoped tmux user-option `@rk_ctl_keepalive 1` (set on the anchor session via `set-option -t =_rk-ctl @rk_ctl_keepalive 1` immediately after `new-session -d`).

The tag is purely a defensive marker — if a future agent or user accidentally renames the `_rk-ctl` session, the tag remains and allows future code to identify the orphan. v1 does NOT consume the tag (no fallback logic depends on it), but the marker is set so future fixes can.

#### Scenario: Anchor session carries the keepalive tag
- **GIVEN** a tmuxctl Client just created the `_rk-ctl` anchor on `-L my-new`
- **WHEN** `tmux -L my-new show-options -t =_rk-ctl @rk_ctl_keepalive` runs
- **THEN** the output SHALL be `@rk_ctl_keepalive 1`

## Backend: `rk serve` Wiring

### Requirement: `rk serve` starts the Supervisor before HTTP bind and tears it down on shutdown

`app/backend/cmd/rk/serve.go` SHALL instantiate a `tmuxctl.Supervisor` and call `Supervisor.Start(ctx)` after `tmux.EnsureConfig()` and after `sweepOrphanedRelaySessions(ctx)`, but BEFORE the `server.ListenAndServe()` goroutine launches. The Supervisor's `EventSink` SHALL route events into the SSE hub's per-server generation counters.

On shutdown (SIGINT/SIGTERM handler), the Supervisor SHALL be stopped before the HTTP server is closed, with a 5-second bounded context for clean teardown. Stop errors SHALL be logged at `slog.Warn` and SHALL NOT block shutdown.

#### Scenario: Supervisor starts after existing prerequisites
- **GIVEN** `rk serve` invoked with default args
- **WHEN** the `serveCmd.RunE` runs
- **THEN** the order SHALL be: (1) `tmux.EnsureConfig()`, (2) `sweepOrphanedRelaySessions(ctx)`, (3) `tmuxctl.NewSupervisor(...).Start(ctx)`, (4) `go server.ListenAndServe()`
- **AND** the Supervisor's `Start` SHALL be synchronous (returns when the initial socket enumeration completes), so the SSE hub never races against an empty Client map for sockets that already exist on disk
- **AND** any per-socket `Open` failures (e.g., PTY unavailable on one socket but not others) SHALL be logged and SHALL NOT abort startup

#### Scenario: Graceful shutdown stops Supervisor first
- **GIVEN** `rk serve` is running with an active Supervisor and at least one open Client
- **WHEN** the process receives SIGTERM
- **THEN** the signal handler SHALL call `supervisor.Stop(ctx5s)` before `httpServer.Shutdown(ctx)`
- **AND** all Clients SHALL be closed (PTYs released, subprocesses reaped)
- **AND** the HTTP server SHALL then shut down normally

## Backend: Constitution Compliance

### Requirement: No persistent state introduced

This change MUST NOT introduce any file under `~/.run-kit/`, `~/.cache/rk/`, or anywhere else on disk that represents subscription state, liveness, or rk-instance discovery. Subscription state lives in process memory (the Supervisor's `map[socket]*Client`) and in the live tmux process (the open PTY + control-mode connection). When `rk serve` dies, every Client's PTY closes, every tmux server observes the disconnection, and there is nothing on disk to clean up.

This requirement is the explicit successor to the intake's original §C ("`rk serve` writes a per-socket lockfile"), which was withdrawn after PR #197 added port-probe liveness and listed "PID files, lock files, or any persistent liveness store" as a Non-Goal under Constitution §II.

#### Scenario: No lockfile under ~/.run-kit/run/
- **GIVEN** `rk serve` is running with an active Supervisor
- **WHEN** `find ~/.run-kit ~/.cache/rk -name '*.json' -newer <start-time>` runs
- **THEN** the result SHALL NOT contain any tmuxctl-related state file
- **AND** the existing `~/.cache/rk/daemon.log` (from PR #197) SHALL be the only diagnostic artifact

### Requirement: Loopback-only by construction

The control-mode connection is a local subprocess (`tmux -CC` via PTY). No network listener is added, no new HTTP endpoint is exposed, no port is opened. The existing `POST /api/sessions/{session}/windows/{index}/select` endpoint (which the frontend uses to request `tmux select-window`) is unchanged.

#### Scenario: Network surface is unchanged
- **GIVEN** `rk serve` is running with the new tmuxctl Supervisor active
- **WHEN** `ss -tlnp | grep rk` runs
- **THEN** the only listening port SHALL be the existing HTTP server (per `RK_PORT`, default 3000)
- **AND** no additional ports SHALL be bound by tmuxctl

## Frontend: URL as Resumable Bookmark

### Requirement: Sidebar highlight is derived from `currentSession.windows.find(w => w.isActiveWindow)`, not from the URL

`app/frontend/src/app.tsx` and `app/frontend/src/components/sidebar/window-row.tsx` SHALL render the sidebar selection based on the server-reported `isActiveWindow` for the focused session, NOT based on URL path matching. The existing `isSelected` computation in `sidebar/index.tsx` (`currentSessionName === session.name && currentWindowIndex === String(win.index)`) MUST be replaced with a comparison against `currentSession.windows.find(w => w.isActiveWindow)?.index`.

The `currentSession` value flows from the SSE `event: sessions` payload via the existing `SessionProvider`.

#### Scenario: Sidebar follows tmux active across an external select-window
- **GIVEN** a browser is on `/$server/$session/2` showing window 2 as selected in the sidebar
- **AND** tmux's `window_active` for `$session` is currently window 2
- **WHEN** `tmux select-window -t $session:5` runs externally
- **THEN** the tmuxctl Client SHALL emit `%session-window-changed`
- **AND** the SSE `event: sessions` payload SHALL update with `windows[5].isActiveWindow = true` and `windows[2].isActiveWindow = false`
- **AND** the sidebar SHALL render window 5 as selected (within 500ms of the `tmux select-window` call)

#### Scenario: `rk riff` immediately reflects in the sidebar
- **GIVEN** a browser is on `/$server/$session/1`
- **WHEN** the user runs `rk riff` from within the active tmux session
- **THEN** tmux SHALL create a new window (e.g., index 4, named `riff-clever-crab`)
- **AND** tmux's `new-window` (without `-d`) SHALL select the new window
- **AND** the tmuxctl Client SHALL emit `%window-add @<new-id>` followed by `%session-window-changed $<sid> @<new-id>`
- **AND** the SSE snapshot SHALL include the new window and its `isActiveWindow = true`
- **AND** the sidebar SHALL render `riff-clever-crab` as selected (within 500ms)
- **AND** the URL SHALL navigate from `/$server/$session/1` to `/$server/$session/4` via `navigate({ replace: true })`

### Requirement: URL is the source of truth ONLY on initial mount

On the first `currentSession` value received after the route mounts, `app.tsx` SHALL check whether the URL's `$window` parameter matches the server's `isActiveWindow`. If they differ, it SHALL fire exactly one `selectWindow(server, session, Number(urlWindow))` call to align tmux with the URL.

This mount-time reconciliation MUST run exactly once per route mount, guarded by a `hasAlignedToUrlRef` boolean ref. After this single call, the URL is treated as derived state, not input. The `userNavTimestampRef` mechanism (3s debounce) MUST be deleted.

#### Scenario: Reload restores the URL's window
- **GIVEN** the user is viewing `/$server/$session/3` and tmux's active window for `$session` is currently window 3
- **WHEN** the browser is reloaded
- **THEN** on mount, `currentSession` arrives via SSE
- **AND** the URL's `$window=3` MATCHES the server's active window
- **AND** `hasAlignedToUrlRef.current` SHALL be set to `true` without firing `selectWindow`
- **AND** the sidebar SHALL render window 3 as selected

#### Scenario: Deep-link from stale URL aligns tmux to URL on mount
- **GIVEN** a user has a bookmarked link `/$server/$session/3`
- **AND** tmux's active window for `$session` is currently window 1
- **WHEN** the user opens the bookmark in a fresh tab
- **THEN** on mount, `currentSession` arrives via SSE with `windows[1].isActiveWindow = true`
- **AND** the URL's `$window=3` does NOT match
- **AND** exactly one `selectWindow(server, session, 3)` SHALL be fired
- **AND** `hasAlignedToUrlRef.current` SHALL be set to `true`
- **AND** the tmuxctl Client SHALL observe `%session-window-changed $<sid> @<id-of-window-3>`
- **AND** the next SSE snapshot SHALL show `windows[3].isActiveWindow = true`
- **AND** the sidebar SHALL render window 3 as selected
- **AND** any other browser tabs viewing `?server=<same>` SHALL also yank to window 3 (per multi-client convergence)

#### Scenario: Subsequent route changes (within the same mount) do not fire mount-time alignment
- **GIVEN** `hasAlignedToUrlRef.current` is `true` (mount-time alignment already ran)
- **AND** the user navigates from `/$server/$session/3` to `/$server/$session/7` by clicking in the sidebar
- **WHEN** the route changes
- **THEN** the mount-time reconciler SHALL NOT fire again
- **AND** the click-driven path (Requirement: Sidebar clicks are pure mutations) is the sole driver

### Requirement: Sidebar clicks are pure mutations; the URL follows the snapshot

`navigateToWindow(session, windowIdx)` in `app.tsx` SHALL be simplified to call only `selectWindow(server, session, windowIdx)`. It MUST NOT call `navigate(...)` directly. The URL update happens on the next SSE-driven snapshot, when `currentSession.windows.find(w => w.isActiveWindow).index` changes and the URL-write effect fires `navigate({ replace: true })`.

The `userNavTimestampRef` and all uses of `elapsed < 3000` MUST be deleted.

#### Scenario: Sidebar click triggers tmux mutation, then URL follows
- **GIVEN** a user is on `/$server/$session/1` and the sidebar shows window 1 selected
- **WHEN** the user clicks window 3 in the sidebar
- **THEN** `selectWindow(server, session, 3)` SHALL be called
- **AND** no `navigate(...)` SHALL be called at click time
- **AND** the tmuxctl Client SHALL receive `%session-window-changed`
- **AND** the SSE snapshot SHALL update with `windows[3].isActiveWindow = true`
- **AND** the URL-write effect SHALL call `navigate({ to: "/$server/$session/$window", params: { server, session, window: "3" }, replace: true })`
- **AND** the sidebar SHALL render window 3 as selected
- **AND** end-to-end latency (click → sidebar update) SHALL be < 500ms (Playwright e2e bound)

#### Scenario: Server-side override during click resolves to server truth
- **GIVEN** a user clicks window 3 in the sidebar at time T
- **AND** at time T+50ms, an external `tmux select-window -t $session:5` happens (e.g., another agent or a hook)
- **WHEN** both mutations land
- **THEN** the FINAL state SHALL reflect whichever mutation tmux processed last
- **AND** there SHALL be no client-side timer or debounce mechanism that prefers the click's intent over the external event — truth wins, always
- **AND** the sidebar and URL SHALL both reflect the final tmux state

### Requirement: Optimistic pending state on sidebar click (polish)

The sidebar MAY render a transient "pending" highlight on a window row immediately after click, before the SSE-driven snapshot lands. The pending state is purely visual; it MUST NOT participate in URL or selection state. The pending row SHALL revert (or commit) on the next snapshot.

This is a polish-tier requirement — implementations MAY ship the base architecture without it if the perceived gap is tolerable. The decision is gated on Playwright e2e measurements: if the median click-to-snapshot latency exceeds 150ms on a representative dev machine, the pending state SHOULD ship. Otherwise it MAY be deferred.

#### Scenario: Pending state appears and confirms within snapshot latency
- **GIVEN** the pending-state feature is enabled
- **WHEN** the user clicks window 3 in the sidebar (current active: window 1)
- **THEN** within one React commit, window 3 SHALL receive the existing selected styling (with `aria-current="page"`) and window 1 SHALL lose it (or retain a "subtle pending" treatment — implementation choice)
- **AND** when the next SSE snapshot arrives showing `windows[3].isActiveWindow = true`, the styling SHALL be reaffirmed (no flicker)
- **AND** if the next snapshot instead shows a different window active (truth-wins override), the pending styling SHALL be cleared and the correct window SHALL be highlighted

## Frontend: Multi-Client Convergence

### Requirement: All clients viewing the same server's session/window route converge on the same window

When the SSE `event: sessions` payload changes which window is `isActiveWindow` for the currently-viewed session, every browser tab connected to `?server=<same>` and viewing `/$server/$session/$window` SHALL navigate to the new window (`navigate({ replace: true })`).

Clients viewing `/board/$name` SHALL NOT navigate — the board route does not subscribe its URL to `isActiveWindow`. The SSE payload still arrives and `BoardPane` rendering still receives the updated `isActiveWindow` data, but the route stays on `/board/$name`.

Clients viewing different `?server=` values are independent — each server's SSE stream drives its own clients.

#### Scenario: Two tabs on the same server converge after external select-window
- **GIVEN** Tab A is on `/kits/my-session/2` and Tab B is on `/kits/my-session/2`
- **WHEN** `tmux -L kits select-window -t my-session:5` runs externally
- **THEN** both tabs SHALL receive the SSE update with `windows[5].isActiveWindow = true`
- **AND** both tabs SHALL navigate (via `replace: true`) to `/kits/my-session/5`
- **AND** the sidebar in both tabs SHALL render window 5 as selected

#### Scenario: Board route ignores yank
- **GIVEN** Tab A is on `/kits/my-session/2`, Tab B is on `/board/dev`
- **AND** the board `dev` contains a pinned window from a different session
- **WHEN** `tmux -L kits select-window -t my-session:5` runs externally
- **THEN** Tab A SHALL navigate to `/kits/my-session/5`
- **AND** Tab B SHALL remain on `/board/dev`
- **AND** Tab B's `BoardPane` rendering MAY receive updated `isActiveWindow` data via SSE but SHALL NOT navigate

#### Scenario: Different-server tabs are independent
- **GIVEN** Tab A is on `/kits/my-session/2`, Tab B is on `/t2/other-session/0`
- **WHEN** `tmux -L kits select-window -t my-session:5` runs externally
- **THEN** Tab A SHALL navigate to `/kits/my-session/5`
- **AND** Tab B SHALL be unaffected (its SSE stream is `?server=t2`, which did not receive the notification)

### Requirement: Stale-URL tab yanks other tabs on mount

When a new tab opens with a URL whose `$window` differs from tmux's current active for that session, the mount-time alignment (Requirement: URL is the source of truth ONLY on initial mount) fires `selectWindow` to align tmux to the URL. As a side effect, any other tabs viewing the same server's session/window route SHALL yank to the new window (per the convergence rule).

This behavior was explicitly confirmed acceptable in the intake's Origin step 4 ("yanking is OK") — the new tab represents user intent to view that window, and the other tabs collectively reflect "what tmux is now doing."

#### Scenario: New tab with stale URL yanks existing tab
- **GIVEN** Tab A is on `/kits/my-session/2` and tmux's active is window 2
- **WHEN** Tab B opens at `/kits/my-session/7` (a different window)
- **THEN** Tab B's mount-time alignment SHALL fire `selectWindow(kits, my-session, 7)`
- **AND** the SSE snapshot SHALL update with `windows[7].isActiveWindow = true`
- **AND** Tab A SHALL navigate (via `replace: true`) to `/kits/my-session/7`
- **AND** Tab B SHALL remain on `/kits/my-session/7`

## Boards: Free Wins

### Requirement: Board cleanup latency tracks snapshot latency

The board stale-entry cleanup that happens via `detectKilledWindowIDs` (see § SSE Loop Refactor) SHALL fire on every snapshot bump, including control-mode-driven snapshots. This means killing a pinned window via `tmux kill-window` SHALL result in a `board-changed { change: "cleanup" }` SSE broadcast within the same latency window as a `sessions` broadcast (target 200ms, hard upper bound 500ms).

The previous behavior (cleanup runs only on the 2.5s poll tick) is replaced.

#### Scenario: Killing a pinned window emits cleanup within control-mode latency
- **GIVEN** window `@42` on server `kits` is pinned to board `dev`
- **WHEN** `tmux -L kits kill-window -t my-session:5` (where window 5 is `@42`) runs
- **THEN** within 500ms, an SSE `event: board-changed { board: "dev", change: "cleanup", server: "kits", windowId: "@42" }` SHALL be broadcast
- **AND** all SSE-connected clients on `?server=kits` SHALL receive it
- **AND** the `useBoardEntries("dev")` hook SHALL refetch and the `BoardPage` SHALL no longer show the pane for `@42`

### Requirement: BoardEntry includes isActiveWindow (optional polish)

This is a follow-up enhancement that MAY ship in the same change or a follow-up. When implemented:

- The `BoardEntry` returned from `GET /api/boards/{name}` SHALL include an `isActiveWindow: boolean` field reflecting tmux's `window_active` for the entry's window in its session at fetch time.
- `BoardPane` MAY render a subtle "tmux-active" indicator (e.g., a 1px accent ring) when `isActiveWindow === true`.

This requirement is graded as Confident in intake assumption #18 — implementation may be deferred without affecting the core fix. If shipped in v1, it adds one struct field to `BoardEntry` and one CSS rule.

#### Scenario: BoardPane reflects tmux active
- **GIVEN** the board `dev` has three pinned windows
- **AND** window `@42` (one of the pinned ones) is the tmux active window in its session
- **WHEN** `useBoardEntries("dev")` returns
- **THEN** the entry for `@42` SHALL have `isActiveWindow: true`
- **AND** the corresponding `BoardPane` SHALL render with the active indicator (subtle ring)
- **AND** the other two panes SHALL render without the indicator

## Testing

### Requirement: Backend tests cover parser, reconnect, and integration paths

Backend test coverage SHALL include:

1. **`internal/tmuxctl/parser_test.go`** — golden-file fixtures of real `tmux -CC` notification streams. At minimum: one fixture per notification name in § Parser Requirement above. Fixtures captured from `tmux 3.6a` on the development machine; parser tests are pure function calls (no tmux subprocess required).

2. **`internal/tmuxctl/client_test.go`** — reconnect FSM tests using stubbed I/O. Cover: clean EOF → reconnect, dial error → backoff (assert 250ms / 500ms / 1s / 2s / 5s sequence with a fake clock), successful read resets backoff, `Close()` cancels reconnect.

3. **`internal/tmuxctl/supervisor_test.go`** — fsnotify event-driven Open/Close lifecycle. Use a temp directory with fake socket files (regular files are fine — the watcher fires on Create/Remove regardless of file type). Verify map mutations and Close ordering.

4. **`internal/tmuxctl/integration_test.go`** — spins up a temporary `tmux -L rk-tmuxctl-test new-session -d`, opens a `Supervisor` watching `$TMUX_TMPDIR`, triggers `tmux select-window`, asserts the corresponding `Client.Generation()` advances within **200ms**.

5. **`app/backend/api/sse_test.go`** — assert the event-driven path: feed a mock `tmuxctl.Client.Wait()` channel, verify `event: sessions` broadcasts within bounded time; assert the safety-net ticker path fires at 12s ± scheduler jitter.

#### Scenario: Integration test passes on tmux 3.6a
- **GIVEN** the integration test runs against a real tmux server
- **WHEN** the test triggers `select-window`
- **THEN** the assertion `assert.LessOrEqual(t, gen, prevGen+1, ...)` MAY be relaxed to `assert.Eventually(t, ..., 200*time.Millisecond, 10*time.Millisecond)`
- **AND** the test SHALL pass deterministically in CI

#### Scenario: CI flake budget allows raising integration latency
- **GIVEN** the 200ms integration bound proves flaky in CI
- **WHEN** the team observes >5% flake rate over 100 runs
- **THEN** the bound MAY be raised to 500ms via a single constant change in the test file
- **AND** the spec is not violated (200ms is the *target*, 500ms is the *hard upper bound* per intake assumption #22)

### Requirement: Frontend tests cover URL-write and click-mutation paths

Frontend test coverage SHALL include:

1. **`app/frontend/src/app.test.tsx`** — Vitest tests for the simplified reconciler:
   - URL follows `isActiveWindow` (no debounce, no timer).
   - Mount-time alignment fires exactly once per mount.
   - Sidebar click fires `selectWindow` without `navigate`.

2. **`app/frontend/src/components/sidebar/window-row.test.tsx`** — assert `aria-current="page"` follows the `isActiveWindow`-derived selection, not the URL.

3. **`app/frontend/tests/active-window-sync.spec.ts` + `.spec.md`** — Playwright e2e (per Constitution Test Companion Docs):
   - Open a session with two windows; click window 2 in the sidebar; assert window 2 becomes selected within **500ms**.
   - Trigger `tmux select-window` directly (via a backend test endpoint or `just test-e2e`'s isolated tmux server); assert the sidebar follows within **500ms**.

#### Scenario: Playwright e2e under just test-e2e
- **GIVEN** `just test-e2e` runs with the isolated `rk-e2e` tmux server
- **WHEN** the spec test triggers a `tmux -L rk-e2e select-window` call (via an API helper or directly via `child_process.exec`)
- **THEN** the test SHALL assert the sidebar highlight updates within 500ms
- **AND** the test SHALL clean up any sessions it created in a `test.afterEach` hook

## Design Decisions

1. **Tmux control mode chosen over hooks + `rk notify`**
   - *Why*: After PR #197 landed with lockfiles explicitly listed as a Non-Goal under Constitution §II, the hook-driven design lost its discovery substrate. Multi-rk scenario surfaced the deeper structural problem: hooks running inside tmux can't cleanly fan out to multiple live `rk serve` subscribers. Control mode is tmux's canonical multi-subscriber channel — each subscriber opens its own connection, tmux fans out internally.
   - *Rejected*: (a) Hooks + per-socket lockfile — rejected by PR #197's Non-Goal. (b) Hooks + tmux user-options-based subscriber discovery — adds stale-cleanup complexity for marginal benefit over control mode. (c) Hooks + config + port-probe — fails under multi-rk because hook subprocess env may carry only one rk's port.

2. **fsnotify auto-discovery over explicit configuration**
   - *Why*: Single-person tool; magical "every tmux on the box appears in the UI" matches Constitution §VII (Convention over Configuration). The intake explicitly chose this over explicit-config and named-prefix opt-in.
   - *Rejected*: Explicit config (`RK_TMUX_SERVERS`) — adds new config surface for a behavior the user explicitly wants automatic. Named-prefix opt-in (e.g., subscribe only to `kits` / `rk-*`) — middle ground that doesn't solve the underlying multi-rk concern any better than full auto-discovery.

3. **Read-only PTY attachment (`-r` flag)**
   - *Why*: `tmux -CC attach -r` restricts input only; notifications still emit to the client. Defensive default — future refactors that accidentally wire commands through the control-mode connection won't change tmux state.
   - *Rejected*: Drop `-r` — couples two responsibilities (subscriber + mutator) that should stay separate.

4. **PTY-unavailable graceful degradation**
   - *Why*: Matches PR #197's daemon-log graceful-degradation pattern (single `slog.Warn`, never block startup). The 12s safety-net poll preserves correctness in degraded mode; only latency is affected.
   - *Rejected*: Fail loudly on PTY-unavailable — would prevent rk from starting in restricted containers where it could still function (poll-only).

5. **12s safety-net poll interval**
   - *Why*: Discussed 10–15s range; 12s is the midpoint. The safety-net's job is to heal missed events during reconnect gaps, not to be the primary latency story. With reconnect backoff capping at 5s, a 12s interval guarantees at most ~17s worst-case staleness (5s reconnect gap + 12s next poll).
   - *Rejected*: 2.5s (current value) — preserves the latency story but wastes resources when control mode is the primary driver. 60s — too long to feel reliable when control mode is degraded.

6. **`_rk-ctl` hidden anchor session over attaching to an arbitrary user session**
   - *Why*: Decouples control-mode lifecycle from any user session's lifetime. If we attached to the user's first session and that session was killed, the control-mode connection would die. The `_` prefix follows the project's internal-entity naming convention.
   - *Rejected*: Attach to an arbitrary existing user session — coupling concern above. Don't anchor at all (use `new-session -d` without attach) — `tmux -CC` requires an attached session to emit notifications.

7. **URL as write-only after mount (vs. URL as source of truth ongoing)**
   - *Why*: Resolves the two-master race structurally. URL = bookmark (used on mount). tmux = live truth (drives URL on every change). No client-owned selection state that can diverge.
   - *Rejected*: URL as ongoing source of truth (client-as-truth) — explicitly rejected in the intake because the user wants the open browser to follow tmux-side switches (dashboard model).

8. **Yank semantics across multi-client (vs. per-client current)**
   - *Why*: Per-server convergence is the simplest invariant. Different tmux servers stay independent (separate SSE streams). For a single-person tool, the "yank" is expected — opening a new tab with a deep-link is intentional.
   - *Rejected*: Per-tab current — reintroduces a second writer; requires server-side per-client state; doesn't match the dashboard model.

9. **Move `detectKilledWindowIDs` diff into the snapshot builder (vs. keep in poll loop)**
   - *Why*: Snapshots are now event-driven. Any transition-dependent logic must live at the snapshot-build site, not where snapshots used to be triggered. Without this refactor, board cleanup would track the 12s safety interval, not the control-mode latency.
   - *Rejected*: Keep diff in poll loop — would leave board cleanup latency at 12s in normal operation, contradicting the intake's "two free wins" claim.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | tmux is the sole source of truth for "current window" per server; URL is a resumable bookmark used only on initial mount | Confirmed from intake #1 — user explicitly chose tmux-as-truth in discuss session | S:95 R:90 A:90 D:95 |
| 2 | Certain | All clients viewing the same server converge ("yank" behavior); clients on different servers stay independent | Confirmed from intake #2 — user confirmed yank acceptable; per-server isolation falls out of multi-server topology | S:95 R:85 A:90 D:95 |
| 3 | Certain | Push channel is tmux control mode (`tmux -CC`) opened per tmux server by each `rk serve` | Confirmed from intake #3 — chosen over hooks after multi-rk scenario surfaced | S:95 R:80 A:90 D:95 |
| 4 | Certain | No lockfile, no `rk notify` CLI, no `/notify` endpoint, no hooks in `~/.rk/tmux.conf` for active-window sync | Confirmed from intake #4 — Constitution §II compliance per PR #197 | S:95 R:80 A:95 D:95 |
| 5 | Certain | 3-second `userNavTimestamp` debounce is deleted entirely (not tuned) | Confirmed from intake #5 — structural problem, not a tuning issue | S:95 R:85 A:95 D:95 |
| 6 | Certain | On initial mount, fire one `select-window` to align tmux with the URL (gated by `hasAlignedToUrlRef`) | Confirmed from intake #6 — supports reload/deep-link semantics | S:95 R:90 A:90 D:95 |
| 7 | Certain | Multi-rk is supported by construction — each `rk serve` opens its own control-mode connection per tmux server | Confirmed from intake #7 — tmux's `-CC attach` is independent per client | S:95 R:85 A:95 D:95 |
| 8 | Certain | New package `app/backend/internal/tmuxctl/` owns Client, parser, Supervisor, reconnect FSM | Confirmed from intake #8 — aligns with existing `internal/tmux/` boundary | S:95 R:85 A:90 D:85 |
| 9 | Certain | `creack/pty` allocates the PTY for `tmux -CC` (already a dep) | Confirmed from intake #9 — verified empirically that control mode fails on plain pipes | S:95 R:90 A:90 D:90 |
| 10 | Certain | Six relevant notifications: session-window-changed, window-add, window-close, window-renamed, sessions-changed, layout-change | Confirmed from intake #10 — direct mapping from tmux 3.6a man page | S:95 R:90 A:95 D:95 |
| 11 | Certain | `safetyPollInterval = 12 * time.Second` | Confirmed from intake #11 — midpoint of discussed 10-15s range | S:95 R:80 A:75 D:65 |
| 12 | Certain | Reconnect FSM: 250ms → 500ms → 1s → 2s → 5s exponential backoff, reset on successful read | Confirmed from intake #12 — standard supervisor pattern with bounded worst case below safety-net interval | S:95 R:80 A:80 D:75 |
| 13 | Certain | Control-mode latency is sub-ms once connected — faster than ~78µs hooks (no fork+exec) | Confirmed from intake #13 — per tmux man page, notifications use same internal hooks but pipe-emit instead of fork | S:95 R:90 A:85 D:80 |
| 14 | Certain | Bootstrap session is a hidden `_rk-ctl` created if none exist; filtered from UI via parseSessions | Confirmed from intake #14 — cleaner separation than coupling to user session lifetime | S:95 R:80 A:85 D:75 |
| 15 | Certain | Boards are orthogonal — board route ignores `isActiveWindow`; board cleanup gets faster as a free win | Confirmed from intake #15 — verified via Explore agent of board data flow | S:95 R:85 A:90 D:85 |
| 16 | Certain | Board-cleanup `detectKilledWindowIDs` diff moves from poll loop into snapshot builder | Confirmed from intake #16 — architectural requirement of event-driven snapshots | S:95 R:75 A:90 D:90 |
| 17 | Certain | Optimistic pending state on sidebar click is polish, decision gated on measured click-to-snapshot latency (ship if median > 150ms) | Confirmed from intake #17 — control-mode turnaround may be fast enough that polish is unnecessary | S:95 R:85 A:80 D:75 |
| 18 | Certain | `BoardEntry.isActiveWindow` + subtle "tmux-active" ring on `BoardPane` is optional follow-up | Confirmed from intake #18 — does not affect core desync fix | S:95 R:90 A:85 D:80 |
| 19 | Certain | rk auto-discovers tmux servers via `fsnotify` watch on `$TMUX_TMPDIR` (Linux: `inotify`, macOS: `kqueue`); both at startup and at runtime | Confirmed from intake #19 — user chose auto-discover over explicit config or prefix opt-in | S:95 R:75 A:80 D:75 |
| 20 | Certain | `tmux -CC attach -r` (read-only mode) — restricts input only; notifications still emit | Confirmed from intake #20 — verified semantics from tmux man page | S:95 R:80 A:65 D:60 |
| 21 | Certain | PTY-unavailable fallback: per-Client `slog.Warn`, fall back to safety-net poll, never block startup | Confirmed from intake #21 — matches PR #197 daemon-log graceful-degradation pattern | S:95 R:80 A:65 D:55 |
| 22 | Certain | Test strategy: parser golden-files + reconnect FSM stub tests + integration with 200ms latency bound (500ms hard upper bound) + Vitest reconciler tests + Playwright 500ms e2e bound | Confirmed from intake #22 — specific assertions committed; CI can adjust within hard upper bound | S:95 R:75 A:65 D:60 |
| 23 | Certain | fsnotify-based auto-discovery uses idempotent connection management; closed-socket events remove from active subscriber map; reopened socket of same name closes prior Client first | Confirmed from intake #23 — necessary follow-on for transient socket events | S:95 R:75 A:80 D:75 |
| 24 | Certain | `_rk-ctl` filtering parallels existing `rk-relay-*` filtering — single chokepoint in `parseSessions` via new exported `tmux.ControlAnchorSessionName` constant | Spec-level decision — extends existing precedent for hiding internal sessions; single source of truth via exported constant | S:95 R:85 A:90 D:85 |
| 25 | Certain | `_rk-ctl` is tagged with server-scoped option `@rk_ctl_keepalive=1` as defensive marker (no runtime consumer in v1) | Spec-level decision — cheap to add, allows future code to identify orphans without depending on the literal name | S:90 R:90 A:85 D:80 |
| 26 | Certain | `rk serve` Supervisor start order: tmux.EnsureConfig → sweepOrphanedRelaySessions → tmuxctl.Supervisor.Start → server.ListenAndServe | Spec-level decision — preserves PR #197's ordering for daemon liveness, sweeps before subscribing so the sweep doesn't observe the `_rk-ctl` anchor as an "orphan" | S:90 R:85 A:90 D:85 |
| 27 | Certain | Graceful shutdown: Supervisor.Stop(ctx5s) before httpServer.Shutdown(ctx); Stop errors logged at slog.Warn, never block shutdown | Spec-level decision — bounded teardown matches existing tmux.cmdTimeout=5s precedent; matches PR #197's never-block-shutdown posture | S:90 R:85 A:90 D:80 |
| 28 | Certain | Watch directory resolution: `TMUX_TMPDIR` env if set, else `/tmp/tmux-<euid>/`; create with `os.MkdirAll(dir, 0o700)` if missing | Spec-level decision — matches tmux's own resolution rules; 0o700 protects against other-user reads of the socket dir | S:90 R:80 A:85 D:80 |
| 29 | Certain | Unknown notifications are logged once per name at slog.Debug and surfaced as UnknownEvent — surfaces tmux protocol additions without log noise | Spec-level decision — defensive future-proofing; debug level so production logs are unaffected | S:90 R:90 A:85 D:85 |
| 30 | Certain | First snapshot after Supervisor start does NOT emit synthetic cleanup events (prev initialized from current on first run) | Spec-level decision — prevents spurious `board-changed { cleanup }` broadcasts on rk restart | S:90 R:85 A:90 D:85 |

30 assumptions (30 certain, 0 confident, 0 tentative, 0 unresolved).
