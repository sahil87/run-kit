# Spec: rk daemon CLI Restructure

**Change**: 260528-5zvv-rk-daemon-cli-restructure
**Created**: 2026-05-28
**Affected memory**: `docs/memory/run-kit/architecture.md`

## Non-Goals

- `rk daemon logs` subcommand (tail of `~/.cache/rk/daemon.log`) — deferred; the log is already greppable.
- JSON output for the mutating subcommands (`start`/`stop`/`restart`) — `--json` is added to `status` only, where scripting/monitoring earns its keep.
- Renaming or otherwise modifying the existing `rk status` (tmux session summary) subcommand — the naming collision with `rk daemon status` is documented but not resolved.
- Windows-platform port-owner lookup — project targets Linux/macOS only; `lsof`/`ss` cover both.
- Deprecation forwarders or aliases for the removed `rk serve -d`/`--restart`/`--stop` flags — hard break, by explicit user decision.
- Changes to the brew-upgrade auto-restart flow (`upgrade.go` calling `daemon.RestartWithBinary`) — that path operates at the Go API layer, not the CLI surface.

## CLI Surface: Top-Level `rk daemon` Command Tree

### Requirement: Top-level `rk daemon` parent command
The CLI MUST expose `rk daemon` as a top-level cobra command, registered as a sibling of `rk serve` (not nested under it). The parent command SHALL have no `RunE` of its own; invoking `rk daemon` with no subcommand MUST print cobra's standard subcommand help (listing `start`, `stop`, `restart`, `status`). The parent's `Long` description SHALL document the four subcommands and the daemon's relationship to `rk serve`.

#### Scenario: `rk daemon` lists subcommands
- **GIVEN** the user runs `rk daemon` with no subcommand
- **WHEN** cobra dispatches the parent command
- **THEN** the output SHALL list `start`, `stop`, `restart`, `status` as available subcommands
- **AND** the exit code SHALL be 0 (or cobra's default for "help shown")

#### Scenario: Parent is registered in rootCmd
- **GIVEN** the rootCmd init() block
- **WHEN** the process starts
- **THEN** `rootCmd.AddCommand(daemonCmd)` SHALL be present alongside the existing `serveCmd`, `updateCmd`, `doctorCmd`, `statusCmd`, `initConfCmd`, `contextCmd`, `riffCmd`, and `newShellInitCmd()` registrations

### Requirement: File layout — one file per subcommand
The new CLI surface SHALL live under `app/backend/cmd/rk/` in the following files: `daemon.go` (parent + AddCommand wiring), `daemon_start.go`, `daemon_stop.go`, `daemon_restart.go`, `daemon_status.go`, and `daemon_portowner.go` (shared port-owner helper). This mirrors the one-file-per-subcommand convention already in `cmd/rk/` (`serve.go`, `doctor.go`, `status.go`, `upgrade.go`).

#### Scenario: File-per-subcommand layout
- **GIVEN** a developer browses `app/backend/cmd/rk/`
- **WHEN** they look for the implementation of `rk daemon stop`
- **THEN** they SHALL find `daemon_stop.go` containing `daemonStopCmd`

## CLI Surface: `rk daemon start [--force]`

### Requirement: `rk daemon start` without `--force` matches today's `rk serve -d`
Without `--force`, `rk daemon start` MUST behave equivalently to the current `rk serve -d`: it calls `daemon.Start()`, prints `rk daemon started (<socket>/<session>/<window>)` on success using `daemon.ServerSocket`, `daemon.SessionName`, `daemon.WindowName`, and returns the underlying error on failure. The port-probe refusal added in PR #197 (with the substrings `already serving on`, `not under the rk-daemon`, `RK_PORT`) MUST continue to surface unchanged.

#### Scenario: Happy path — port free, daemon not running
- **GIVEN** the configured port is free
- **AND** no `rk-daemon` tmux session exists
- **WHEN** the user runs `rk daemon start`
- **THEN** `daemon.Start()` SHALL be invoked
- **AND** the CLI SHALL print `rk daemon started (rk-daemon/rk-daemon/serve)`
- **AND** the exit code SHALL be 0

#### Scenario: Port held by foreground `rk serve`, no `--force`
- **GIVEN** the configured port is held by a non-daemon process
- **WHEN** the user runs `rk daemon start`
- **THEN** `daemon.Start()` SHALL return the port-in-use error
- **AND** the CLI SHALL exit non-zero with the error containing `already serving on`, `not under the rk-daemon`, and `RK_PORT`

#### Scenario: Daemon already running
- **GIVEN** an `rk-daemon` tmux session already exists
- **WHEN** the user runs `rk daemon start`
- **THEN** `daemon.Start()` SHALL return `daemon already running`
- **AND** the CLI SHALL exit non-zero

### Requirement: `rk daemon start --force` reclaims the port lazily on the port-in-use error path
With `--force`, `rk daemon start` MUST first attempt `daemon.Start()` exactly as the non-forced path does. ONLY when that returns the port-in-use error MUST the command then look up the port owner via the shared helper, refuse to kill if the holder identifies as the rk daemon, otherwise SIGTERM the owner (with the poll-for-exit + SIGKILL fallback defined under the port-owner section), and retry `daemon.Start()`. The proactive "always probe and kill on `--force`" alternative MUST NOT be implemented.

#### Scenario: --force reclaims a non-daemon port owner
- **GIVEN** the configured port is held by a non-daemon process (PID P)
- **WHEN** the user runs `rk daemon start --force`
- **THEN** the first `daemon.Start()` call SHALL fail with the port-in-use error
- **AND** the port-owner helper SHALL identify PID P
- **AND** PID P SHALL receive SIGTERM (followed by SIGKILL if it does not exit within the poll window)
- **AND** the CLI SHALL print `Killed port owner: PID <P> (<command>)`
- **AND** the second `daemon.Start()` call SHALL succeed
- **AND** the CLI SHALL print `rk daemon started (rk-daemon/rk-daemon/serve)`

#### Scenario: --force refuses to kill our own daemon
- **GIVEN** the port-owner helper identifies the holder as the rk daemon (matches the inner serve PID derived from tmux `pane_pid`)
- **WHEN** the user runs `rk daemon start --force`
- **THEN** the CLI MUST NOT send any signal to that PID
- **AND** the CLI SHALL exit non-zero with an error message stating that it refuses to `--force`-kill itself

#### Scenario: --force is a no-op on the happy path
- **GIVEN** the configured port is free
- **WHEN** the user runs `rk daemon start --force`
- **THEN** the first `daemon.Start()` SHALL succeed
- **AND** the port-owner helper MUST NOT be invoked

## CLI Surface: `rk daemon stop [--force]`

### Requirement: `rk daemon stop` without `--force` matches today's `rk serve --stop`
Without `--force`, `rk daemon stop` MUST behave equivalently to the current `rk serve --stop`. If the daemon is running (per `daemon.IsRunning()` which already consults both `SessionName` and `LegacySessionName`), the command SHALL call `daemon.Stop()` and print `rk daemon stopped`. If the daemon is not running, the command SHALL print `rk daemon not running` and exit 0. The command MUST NOT probe or touch the port when `--force` is absent.

#### Scenario: Stop a running daemon
- **GIVEN** an `rk-daemon` tmux session exists
- **WHEN** the user runs `rk daemon stop`
- **THEN** `daemon.Stop()` SHALL be invoked
- **AND** the CLI SHALL print `rk daemon stopped`
- **AND** the exit code SHALL be 0

#### Scenario: Stop when no daemon is running
- **GIVEN** no daemon session exists
- **WHEN** the user runs `rk daemon stop`
- **THEN** the CLI SHALL print `rk daemon not running`
- **AND** the exit code SHALL be 0
- **AND** the port MUST NOT be probed

### Requirement: `rk daemon stop --force` ensures the port is free at exit
With `--force`, `rk daemon stop` MUST: (a) if the daemon is running, stop it first via `daemon.Stop()`; (b) regardless of whether step (a) ran, then probe the configured port via the shared helper. If the port is still held and the holder is NOT the rk daemon, the command MUST SIGTERM the owner with the standard graceful-then-forceful escalation. If after `daemon.Stop()` the port is still held by what appears to be the rk daemon itself, the command MUST exit non-zero with a "manual investigation needed" error (defensive — `daemon.Stop()` should have torn it down). If the port is free at probe time, the command MUST exit 0 silently (the `--force` was a no-op for the "extra" kill).

#### Scenario: --force stops daemon then frees a leftover port owner
- **GIVEN** the daemon is running on port P
- **AND** an unrelated process P2 is also bound somewhere on port P (pathological case left after a crash)
- **WHEN** the user runs `rk daemon stop --force`
- **THEN** `daemon.Stop()` SHALL run first and print `rk daemon stopped`
- **AND** the port-owner helper SHALL identify P2
- **AND** P2 SHALL receive SIGTERM
- **AND** the CLI SHALL print `Killed port owner: PID <P2> (<command>)`

#### Scenario: --force frees a foreground `rk serve` when no daemon is running
- **GIVEN** no daemon session exists
- **AND** a foreground `rk serve` (PID P) is holding the port
- **WHEN** the user runs `rk daemon stop --force`
- **THEN** the daemon-stop step SHALL be skipped (no daemon to stop)
- **AND** the port-owner helper SHALL identify PID P
- **AND** PID P SHALL receive SIGTERM
- **AND** the CLI SHALL print `Killed port owner: PID <P> (<command>)`

#### Scenario: --force is a silent no-op when port is already free
- **GIVEN** no daemon is running and the port is free
- **WHEN** the user runs `rk daemon stop --force`
- **THEN** the CLI MUST NOT print `Killed port owner`
- **AND** the exit code SHALL be 0

## CLI Surface: `rk daemon restart [--force]`

### Requirement: `rk daemon restart` without `--force` matches today's `rk serve --restart`
Without `--force`, `rk daemon restart` MUST behave equivalently to the current `rk serve --restart`: if a daemon is running, stop it via `daemon.Stop()`; then start a new daemon via `daemon.Start()`. If the port is held by a non-daemon process at the start step, the underlying port-probe refusal from PR #197 MUST surface (the command does not implicitly reclaim).

#### Scenario: Restart a running daemon
- **GIVEN** the daemon is running
- **WHEN** the user runs `rk daemon restart`
- **THEN** the CLI SHALL print `Restarting rk daemon...`
- **AND** `daemon.Stop()` SHALL be invoked
- **AND** `daemon.Start()` SHALL be invoked
- **AND** the CLI SHALL print `rk daemon started (rk-daemon/rk-daemon/serve)`

#### Scenario: Restart when no daemon is running
- **GIVEN** no daemon session exists
- **AND** the port is free
- **WHEN** the user runs `rk daemon restart`
- **THEN** the stop step SHALL be skipped
- **AND** `daemon.Start()` SHALL be invoked
- **AND** the CLI SHALL print `rk daemon started (rk-daemon/rk-daemon/serve)`

### Requirement: `rk daemon restart --force` proactively clears non-daemon port holders before starting
With `--force`, `rk daemon restart` MUST stop the daemon if running, then probe the port via the shared helper BEFORE attempting `daemon.Start()`. If the port is held by a non-daemon process, the command MUST SIGTERM that owner with the standard graceful-then-forceful escalation. If the port is held by what identifies as our own daemon (defensive — should not happen after `daemon.Stop()`), the command MUST NOT signal it. Then `daemon.Start()` runs.

#### Scenario: --force kills foreground port holder during restart
- **GIVEN** the daemon is running
- **AND** a foreground `rk serve` (PID P) somehow also has port-adjacent state interfering with restart
- **WHEN** the user runs `rk daemon restart --force`
- **THEN** `daemon.Stop()` SHALL run first
- **AND** the port-owner helper SHALL probe the port
- **AND** if PID P is still bound to the port, it SHALL receive SIGTERM
- **AND** the CLI SHALL print `Killed port owner: PID <P> (<command>)`
- **AND** `daemon.Start()` SHALL run and print `rk daemon started (rk-daemon/rk-daemon/serve)`

## CLI Surface: `rk daemon status [--json]`

### Requirement: `rk daemon status` is read-only and reports daemon state plus port owner
`rk daemon status` MUST report two pieces of information with no side effects: (1) whether the daemon is running (via `daemon.IsRunning()`), including the socket, session name, window name, and exact-match tmux target when running; (2) the current port owner — `free`, `held by the rk daemon (PID <P>)`, or `held by PID <P> (<command>, foreground)`. The command MUST NOT signal any process and MUST NOT mutate any tmux state.

#### Scenario: Daemon running, port owned by the daemon
- **GIVEN** the daemon is running
- **AND** the configured port is held by the daemon's inner serve PID
- **WHEN** the user runs `rk daemon status`
- **THEN** the output SHALL contain `Daemon:    running`
- **AND** the output SHALL contain `Socket:  rk-daemon`
- **AND** the output SHALL contain `Session: rk-daemon (window: serve)`
- **AND** the output SHALL contain `Target:  =rk-daemon:=serve`
- **AND** the output SHALL contain `Port:` followed by the host:port and `held by the rk daemon (PID <P>)`

#### Scenario: Daemon not running, port held by a foreground process
- **GIVEN** the daemon is not running
- **AND** a foreground process (PID P, command `rk`) is bound to the configured port
- **WHEN** the user runs `rk daemon status`
- **THEN** the output SHALL contain `Daemon:    not running`
- **AND** the output SHALL contain the port followed by `held by PID <P> (<command>, foreground)`
- **AND** the output SHOULD include a hint line referencing `rk daemon stop --force` or `kill <P>`

#### Scenario: Daemon not running, port free
- **GIVEN** the daemon is not running
- **AND** the configured port has no listener
- **WHEN** the user runs `rk daemon status`
- **THEN** the output SHALL contain `Daemon:    not running`
- **AND** the output SHALL contain the port followed by `— free`

#### Scenario: No side effects
- **GIVEN** any combination of daemon-state and port-owner conditions
- **WHEN** the user runs `rk daemon status`
- **THEN** no SIGTERM, SIGKILL, or tmux mutation SHALL be issued
- **AND** the only tmux interactions SHALL be the read-only queries used by `daemon.IsRunning()` and the holder-identity check

### Requirement: `--force` flag MUST NOT exist on `rk daemon status`
`rk daemon status` MUST NOT accept a `--force` flag. Adding it MUST fail cobra's unknown-flag check.

#### Scenario: --force is rejected on status
- **GIVEN** the user runs `rk daemon status --force`
- **WHEN** cobra parses the flags
- **THEN** the command SHALL exit non-zero with the standard `unknown flag: --force` cobra error

### Requirement: `rk daemon status --json` emits a structured machine-readable form
`rk daemon status --json` MUST emit a JSON object with at minimum: `daemon` (object with `running` boolean and, when running, `socket`, `session`, `window`, `target`, `pid` fields), and `port` (object with `host`, `port`, `state` enum [`free`, `held-by-daemon`, `held-by-other`], and when held: `holder_pid`, `holder_command`). The JSON form MUST be valid JSON parseable by `json.Unmarshal` and MUST NOT include trailing diagnostic text on stdout. Diagnostic warnings (e.g., port-owner lookup partial failure) MAY go to stderr.

#### Scenario: --json on a running daemon
- **GIVEN** the daemon is running and owns the port
- **WHEN** the user runs `rk daemon status --json`
- **THEN** stdout SHALL be valid JSON
- **AND** the JSON SHALL contain `"daemon": { "running": true, "socket": "rk-daemon", "session": "rk-daemon", "window": "serve", "target": "=rk-daemon:=serve", "pid": <P> }`
- **AND** the JSON SHALL contain `"port": { "host": ..., "port": ..., "state": "held-by-daemon", "holder_pid": <P>, "holder_command": ... }`

#### Scenario: --json on a stopped daemon, free port
- **GIVEN** the daemon is not running and the port is free
- **WHEN** the user runs `rk daemon status --json`
- **THEN** stdout SHALL be valid JSON
- **AND** the JSON SHALL contain `"daemon": { "running": false }`
- **AND** the JSON SHALL contain `"port": { "host": ..., "port": ..., "state": "free" }`

### Requirement: `rk daemon status --help` distinguishes itself from `rk status`
The `Long` description (or equivalent help text) of `rk daemon status` MUST include a one-line note indicating that this is the daemon status command, NOT to be confused with the existing top-level `rk status` (which summarises tmux sessions on the `runkit` server).

#### Scenario: Help text mentions rk status
- **GIVEN** the user runs `rk daemon status --help`
- **WHEN** cobra prints the help
- **THEN** the help output SHALL contain a reference to `rk status` and clarify the difference (daemon vs session summary)

## Removal: `rk serve` Flag Surface

### Requirement: The three daemon flags on `rk serve` are REMOVED with no deprecation
The boolean flags `-d`/`--daemon`, `--restart`, and `--stop` on `serveCmd` MUST be deleted from `app/backend/cmd/rk/serve.go`. The mutual-exclusivity check and the dispatch `switch` block in `serveCmd.RunE` MUST be deleted. After this change, `rk serve` SHALL only perform foreground HTTP serving. There MUST NOT be any deprecation alias, forwarder, hidden flag, or warning message — invoking `rk serve -d`, `rk serve --restart`, or `rk serve --stop` MUST fail with cobra's standard `unknown flag` error.

#### Scenario: rk serve -d errors
- **GIVEN** the user runs `rk serve -d`
- **WHEN** cobra parses the flags
- **THEN** the command SHALL exit non-zero with `unknown flag: -d` (or cobra's equivalent message)

#### Scenario: rk serve --stop errors
- **GIVEN** the user runs `rk serve --stop`
- **WHEN** cobra parses the flags
- **THEN** the command SHALL exit non-zero with `unknown flag: --stop`

#### Scenario: rk serve --restart errors
- **GIVEN** the user runs `rk serve --restart`
- **WHEN** cobra parses the flags
- **THEN** the command SHALL exit non-zero with `unknown flag: --restart`

### Requirement: `rk serve` retains foreground-serve behavior intact
After the flag removal, `rk serve` MUST continue to perform: configuration load via `config.Load()`, `tmux.EnsureConfig()`, orphan relay sweep via `sweepOrphanedRelaySessions`, slog setup via `setupSlog`, and `ListenAndServe` with graceful SIGINT/SIGTERM shutdown. The default `rootCmd` runE forwarder (`rk` with no args → `serveCmd.RunE`) MUST continue to work.

#### Scenario: Bare `rk` invocation still serves
- **GIVEN** the user runs `rk` with no subcommand
- **WHEN** rootCmd dispatches
- **THEN** `serveCmd.RunE` SHALL be invoked
- **AND** the server SHALL bind to `cfg.Host:cfg.Port` and listen

## Port-Owner Lookup Helper

### Requirement: Shared port-owner helper in `daemon_portowner.go`
A package-private helper `findPortOwner(ctx context.Context, host string, port int) (*PortOwner, error)` MUST live in `app/backend/cmd/rk/daemon_portowner.go` and be used by all three mutating subcommands plus `status`. The `PortOwner` struct MUST expose at minimum `PID int`, `Command string` (basename of the executable), and `Source string` (`"lsof"` or `"ss"`). The helper MUST return `(nil, nil)` when no process is listening (no error, no owner). The helper MUST return `(nil, error)` only when both `lsof` and `ss` are unavailable or both error.

#### Scenario: lsof returns a PID
- **GIVEN** `lsof -ti:<port>` returns a single PID line
- **WHEN** `findPortOwner` is called
- **THEN** the result SHALL contain that PID
- **AND** `Command` SHALL be populated via `/proc/<pid>/comm` on Linux or `ps -p <pid> -o comm=` on macOS
- **AND** `Source` SHALL equal `"lsof"`

#### Scenario: lsof unavailable, ss fallback succeeds
- **GIVEN** `lsof` is not on PATH
- **WHEN** `findPortOwner` is called
- **THEN** the helper SHALL invoke `ss -tlnp '( sport = :<port> )'`
- **AND** parse the `users:(...,pid=N,...)` field
- **AND** `Source` SHALL equal `"ss"`

#### Scenario: No listener on port
- **GIVEN** nothing is bound to the port
- **WHEN** `findPortOwner` is called
- **THEN** the result SHALL be `(nil, nil)` (no error)

#### Scenario: Both lsof and ss unavailable
- **GIVEN** neither `lsof` nor `ss` is on PATH
- **WHEN** `findPortOwner` is called
- **THEN** the result SHALL be `(nil, error)` with a descriptive message

### Requirement: Port-owner lookup uses port only (host is display-only)
The `host` argument to `findPortOwner` MUST be passed through for display purposes only. The underlying `lsof -ti:<port>` and `ss -tlnp '( sport = :<port> )'` queries MUST use the port only — both tools correctly cover loopback and wildcard binds without a host filter.

#### Scenario: Wildcard bind is detected via port-only query
- **GIVEN** a process is listening on `0.0.0.0:<port>`
- **WHEN** `findPortOwner(ctx, "127.0.0.1", port)` is called
- **THEN** the helper SHALL still locate the owner
- **AND** the host argument SHALL NOT affect the lookup

### Requirement: All subprocess execution uses `exec.CommandContext` with bounded timeout
All `lsof`, `ss`, `ps`, and signal-related subprocess invocations in `daemon_portowner.go` MUST use `exec.CommandContext` with a 5-second timeout per Constitution §I and Constitution Additional Constraints "Process Execution". Shell-string construction MUST NOT be used. User-controllable input MUST NOT flow into any argument (the port is project-validated; the holder PID returned by the tool is not user-controllable).

#### Scenario: No shell strings in port-owner code
- **GIVEN** code review inspects `daemon_portowner.go`
- **WHEN** the reviewer searches for `exec.Command(` (without context) or shell-string patterns
- **THEN** no such usages SHALL be found
- **AND** every subprocess call SHALL use `exec.CommandContext` with a 5s `context.WithTimeout`

### Requirement: `terminateOwner` mirrors `daemon.Stop`'s graceful escalation
The helper that terminates a port owner MUST send SIGTERM first, poll for up to 5 seconds for the process to exit, and SIGKILL on timeout. Signal delivery MUST use `syscall.Kill(pid, syscall.SIGTERM)` / `syscall.SIGKILL` — never a shell `kill` invocation.

#### Scenario: Owner exits gracefully on SIGTERM
- **GIVEN** an owner PID that handles SIGTERM
- **WHEN** `terminateOwner` is invoked
- **THEN** SIGTERM SHALL be sent
- **AND** the process SHALL be polled for exit
- **AND** no SIGKILL SHALL be sent

#### Scenario: Owner ignores SIGTERM, escalates to SIGKILL
- **GIVEN** an owner PID that does not exit within 5 seconds of SIGTERM
- **WHEN** `terminateOwner` polls past the deadline
- **THEN** SIGKILL SHALL be sent
- **AND** the helper SHALL return after a final poll for exit

## Holder-Identity Check (Daemon Self-Recognition)

### Requirement: `daemon.InnerServePID()` helper exposes the inner serve PID
The `internal/daemon` package SHALL add a small public helper `InnerServePID() (int, error)` that returns the PID of the `rk serve` process running inside the daemon tmux pane. The helper MUST be implemented via tmux's `pane_pid` format spec — specifically a single `tmux -L rk-daemon list-panes -t =rk-daemon:=serve -F '#{pane_pid}'` invocation via `runTmux` (or an equivalent existing daemon-package internal). The helper MUST return `(0, error)` when the daemon session is absent.

#### Scenario: Helper returns inner serve PID
- **GIVEN** the daemon is running
- **WHEN** `daemon.InnerServePID()` is invoked
- **THEN** the helper SHALL run `tmux -L rk-daemon list-panes -t =rk-daemon:=serve -F '#{pane_pid}'`
- **AND** parse the integer PID from stdout
- **AND** return `(pid, nil)`

#### Scenario: Helper errors when daemon not running
- **GIVEN** no daemon session exists
- **WHEN** `daemon.InnerServePID()` is invoked
- **THEN** the helper SHALL return `(0, error)` indicating the session is absent

### Requirement: `--force` paths and `status` use `InnerServePID` to recognize self
Every code path in `start --force`, `stop --force`, `restart --force`, and `status` that would consult the port owner's identity MUST call `daemon.InnerServePID()` and compare the returned PID with the port-owner's PID. When the PIDs match (and `daemon.InnerServePID()` returned a non-error result), the code path MUST classify the port owner as "the rk daemon" — never as a foreign process.

#### Scenario: Foreign holder is correctly recognized as non-daemon
- **GIVEN** the daemon is running with inner serve PID 12345
- **AND** the port-owner lookup also returns 12345
- **WHEN** the `--force` self-check runs
- **THEN** the holder SHALL be classified as the daemon
- **AND** the `--force` kill MUST be refused

## Integration: Existing API Surface Preserved

### Requirement: `internal/daemon`'s public API is preserved (additive only)
The existing exported names in `internal/daemon` — `IsRunning`, `Start`, `Stop`, `Restart`, `StartWithBinary`, `RestartWithBinary`, `ServerSocket`, `SessionName`, `WindowName`, `LegacySessionName`, `LogEnvVar` — MUST continue to exist with the same signatures and semantics. The only addition to `internal/daemon` SHALL be the `InnerServePID()` helper.

#### Scenario: upgrade.go compiles unchanged
- **GIVEN** `app/backend/cmd/rk/upgrade.go` calls `daemon.RestartWithBinary(brewBinPath)` and reads `daemon.ServerSocket`, `daemon.SessionName`, `daemon.WindowName`
- **WHEN** the build runs after this change
- **THEN** `upgrade.go` SHALL compile without modification
- **AND** the brew-upgrade auto-restart flow SHALL function as it does today

### Requirement: Existing `rk status` subcommand is untouched
The existing `rk status` subcommand (in `app/backend/cmd/rk/status.go`, summarising tmux sessions on the `runkit` server) MUST NOT be modified, renamed, or removed. The naming proximity to `rk daemon status` is intentional but documented (see help-text requirement above).

#### Scenario: rk status still summarises tmux sessions
- **GIVEN** there are sessions on the `runkit` tmux server
- **WHEN** the user runs `rk status`
- **THEN** the existing summary (one line per session with window count) SHALL be printed
- **AND** the output SHALL NOT include daemon state or port-owner information

## Testing

### Requirement: CLI subcommand tests use `RootCmd.SetArgs` with stdout/stderr capture
Each new subcommand (`start`, `stop`, `restart`, `status`) MUST have a corresponding `_test.go` file under `app/backend/cmd/rk/` that exercises the cobra command via `RootCmd.SetArgs([]string{...})` plus stdout/stderr capture (e.g., `rootCmd.SetOut(buf)`, `rootCmd.SetErr(buf)`). The port-owner lookup MUST be injectable via a package-level function variable so tests do not actually invoke `lsof` or `ss`. This mirrors the existing test pattern in `app/backend/internal/daemon/daemon_test.go` where `serverSocket` (a package-level `var`) is swapped to a test socket via the `withServerSocket(t, socket)` helper.

#### Scenario: Port-owner lookup is injected in tests
- **GIVEN** a CLI test for `rk daemon start --force`
- **WHEN** the test sets the package-level lookup function variable to a stub returning a fixed `*PortOwner`
- **THEN** the test SHALL drive the `--force` branch without spawning `lsof` or `ss`

#### Scenario: Cobra args set programmatically
- **GIVEN** a CLI test for any subcommand
- **WHEN** the test calls `rootCmd.SetArgs([]string{"daemon", "status"})` and `rootCmd.Execute()`
- **THEN** stdout/stderr captured via `SetOut`/`SetErr` SHALL contain the expected output
- **AND** no production tmux server SHALL be touched

### Requirement: Removed-flag tests do not exist
Any existing tests in `app/backend/cmd/rk/` that exercise `rk serve -d`, `rk serve --restart`, or `rk serve --stop` MUST be removed in the same change. New tests MAY assert that those flags produce cobra's unknown-flag error.

#### Scenario: No stale daemon-flag tests on serve
- **GIVEN** the post-change repository
- **WHEN** `grep -r "BoolP.*daemon" app/backend/cmd/rk/serve_*` runs
- **THEN** no matches SHALL be found
- **AND** no test SHALL invoke `rk serve -d` expecting it to start a daemon

## Documentation

### Requirement: `docs/memory/run-kit/architecture.md` Daemon Lifecycle section reflects the new CLI
During the hydrate stage, `docs/memory/run-kit/architecture.md`'s `## Daemon Lifecycle` section MUST be updated so the CLI surface inventory replaces the three `rk serve` flags with `rk daemon start|stop|restart|status`. `--force` semantics MUST be documented across the three mutating subcommands. A brief subsection on the port-owner lookup mechanism (`lsof` → `ss` fallback, location of the helper, signal escalation) MUST be added. If the `internal/daemon` row in the Backend Libraries table changes shape because of `InnerServePID()`, that row MUST be updated.

#### Scenario: Hydrate updates the daemon lifecycle section
- **GIVEN** the apply stage has landed the new CLI
- **WHEN** the hydrate stage runs
- **THEN** `docs/memory/run-kit/architecture.md` `## Daemon Lifecycle` SHALL no longer mention `rk serve -d`/`--restart`/`--stop` as the lifecycle surface
- **AND** `## Daemon Lifecycle` SHALL document `rk daemon start|stop|restart|status` with their `--force` semantics
- **AND** the port-owner lookup mechanism SHALL be documented

## Deprecated Requirements

### `rk serve -d`/`--restart`/`--stop` flag dispatch
**Reason**: The flag-on-serve shape forced runtime mutual-exclusivity checking, mixed orthogonal concerns (foreground HTTP serving vs background lifecycle management), and made `--force` semantics awkward to document. Sub-commands carry their own help text and own flag set cleanly.

**Migration**:
- `rk serve -d` → `rk daemon start`
- `rk serve --restart` → `rk daemon restart`
- `rk serve --stop` → `rk daemon stop`

Hard break — no deprecation forwarder, no warning message. Operators will see cobra's `unknown flag` on invocation.

## Design Decisions

1. **`rk daemon` is a top-level sibling of `rk serve`, not nested under `rk serve daemon`**
   - *Why*: `serve` is "run this HTTP process here"; `daemon` is "manage the background lifecycle of an `rk serve` instance". Two concepts, shared target binary, different job descriptions. Follows `systemctl` / `launchctl` / `kubectl pod` precedent.
   - *Rejected*: `rk serve daemon start` — nests lifecycle under the verb being managed, conflating verb with target.

2. **Hard break on the three removed flags — no deprecation forwarders**
   - *Why*: User decision. The daemon flag surface has only ever been documented to project insiders; there is no public script-level contract to preserve; deprecation forwarders carry permanent help-text noise.
   - *Rejected*: `rk serve -d` as a hidden forwarder to `rk daemon start` — keeps the flag-dispatch code path alive forever; defeats the consolidation.

3. **`--force` over a bespoke `--include-port-owner` flag**
   - *Why*: `--force` is a noun-verb pattern operators already know ("override the safety check"). Consistent across `start`/`stop`/`restart`.
   - *Rejected*: `--include-port-owner` — more self-documenting in isolation, but uglier in help output and harder to extend if a second safety check is ever added.

4. **`rk daemon start --force` is lazy (on-error), not proactive**
   - *Why*: Keeps the happy path identical to the non-forced path — `daemon.Start()`'s existing port-probe is the single source of truth for "port held?". `--force` only modifies what happens AFTER the refusal.
   - *Rejected*: Always probe the port first under `--force` — duplicates the port check, adds a `lsof` round-trip on every `--force start` even when the port is free.

5. **Port-owner lookup: `lsof -ti:<port>` primary, `ss -tlnp` fallback**
   - *Why*: `lsof` is universal on macOS, common on Linux; `ss` is the Linux-native safety net when `lsof` is absent. Both via `exec.CommandContext` per Constitution §I.
   - *Rejected*: Pure-Go `/proc/net/tcp` parsing — Linux-only, verbose, requires `/proc` mount; pulls in protocol-state decoding code that has no other use in this binary.

6. **Holder-identity check via tmux `pane_pid` (option (a)) — new `daemon.InnerServePID()` helper**
   - *Why*: Single deterministic tmux query, stays inside the existing `internal/tmux`-rooted abstraction, mirrors how the daemon package already inspects its own tmux state.
   - *Rejected*: `/proc/<pid>/cmdline` walking — Linux-only, fragile to argv changes (e.g., binary path drift after brew upgrade); no daemon self-check.
   - *Rejected*: No-check (trust that the port owner is never us) — defensible in steady state but fails defensively when something else races us.

7. **`--json` for `status` only, not for the mutating commands**
   - *Why*: Status output earns its keep immediately for CI/monitoring scripts; mutating commands produce a single success line that scripts can already check via exit code.
   - *Rejected*: `--json` for all four subcommands — premature; can be added incrementally if a use case appears.

8. **One file per subcommand under `cmd/rk/`**
   - *Why*: Parity with existing `cmd/rk/` convention (`serve.go`, `doctor.go`, `status.go`, `upgrade.go` each own one subcommand). A reader looking for `rk daemon stop` will find `daemon_stop.go` predictably.
   - *Rejected*: Single `daemon.go` containing all four subcommands — convenient for the writer, slightly less predictable for the reader.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Change type is `refactor` (spec gate threshold 3.0) | Confirmed from intake #1; restructures CLI surface without net-new daemon capabilities (port-owner reporting was a deferred slice of PR #197) | S:80 R:80 A:85 D:75 |
| 2 | Certain | `rk daemon` is a top-level sibling of `rk serve`, not nested under it | Confirmed from intake #2; user explicit pre-intake decision | S:95 R:75 A:95 D:90 |
| 3 | Certain | Hard break: `rk serve -d/--restart/--stop` removed with no deprecation forwarders | Confirmed from intake #3; user explicit pre-intake decision | S:95 R:50 A:90 D:90 |
| 4 | Certain | `--force` lives on `start`, `stop`, `restart` only (NOT on read-only `status`) | Confirmed from intake #4; `status` has no safety check to override | S:90 R:75 A:90 D:85 |
| 5 | Certain | `--force` semantics: override port-claim safety by SIGTERMing port owner with poll-then-SIGKILL escalation | Confirmed from intake #5; mirrors existing `daemon.Stop` graceful-then-forceful pattern | S:90 R:70 A:85 D:80 |
| 6 | Certain | Port-owner lookup: `lsof -ti:<port>` primary, `ss -tlnp` fallback, via `exec.CommandContext` | Confirmed from intake #6 | S:90 R:75 A:85 D:80 |
| 7 | Certain | `rk daemon status` is read-only and owns the port-owner report | Confirmed from intake #7 | S:90 R:85 A:90 D:85 |
| 8 | Certain | Existing `rk status` subcommand stays untouched — naming collision documented in help text only | Confirmed from intake #8; resolving the collision (renaming `rk status`) is a separate change | S:85 R:75 A:80 D:80 |
| 9 | Certain | `internal/daemon` public API preserved; sole addition is `InnerServePID()` helper | Confirmed from intake #9; verified by reading `internal/daemon/daemon.go` — existing `Start`/`Stop`/`Restart`/`IsRunning`/`StartWithBinary`/`RestartWithBinary` map cleanly to new CLI | S:85 R:80 A:85 D:75 |
| 10 | Certain | `upgrade.go` brew-upgrade auto-restart flow is unaffected — operates at Go API layer | Confirmed from intake #10; verified by reading `upgrade.go:99-104` — `daemon.RestartWithBinary` call has no CLI dependency | S:95 R:90 A:95 D:90 |
| 11 | Certain | CLI tests use `rootCmd.SetArgs` + stdout/stderr capture, with port-owner lookup injected via package-level function variable | Confirmed from intake #11; pattern verified in `daemon_test.go` (`serverSocket` swap via `withServerSocket` helper) | S:95 R:80 A:85 D:75 |
| 12 | Certain | Six new files under `cmd/rk/`: `daemon.go`, `daemon_start.go`, `daemon_stop.go`, `daemon_restart.go`, `daemon_status.go`, `daemon_portowner.go` (+ matching `_test.go`) | Confirmed from intake #12; mirrors one-file-per-subcommand convention in `cmd/rk/` | S:95 R:85 A:80 D:70 |
| 13 | Certain | `--json` output is in scope for `rk daemon status` (not deferred) | Confirmed from intake #13; small (~30 lines), removes future round-trip | S:95 R:85 A:75 D:65 |
| 14 | Certain | Holder-identity check uses tmux `pane_pid` via `daemon.InnerServePID()` (option (a) from intake open questions) | Confirmed from intake #14 | S:95 R:75 A:80 D:70 |
| 15 | Certain | Port-owner lookup ignores `host` argument (port-only query); host is display-only | Confirmed from intake #15 | S:95 R:80 A:80 D:75 |
| 16 | Certain | `rk daemon start --force` only triggers port-owner reclaim on the port-in-use error path (lazy/on-error) | Confirmed from intake #16 | S:95 R:80 A:75 D:70 |
| 17 | Certain | `rk daemon status --help` includes a one-line note distinguishing it from `rk status` | Confirmed from intake #17 | S:95 R:90 A:85 D:80 |
| 18 | Certain | Constitution touchpoints: §I (subprocess hygiene for lsof/ss/kill — all `exec.CommandContext`-bounded), §III (re-uses existing daemon helpers), §IV (net flag-surface reduction) | Confirmed from intake #18 | S:95 R:75 A:90 D:80 |
| 19 | Certain | Out of scope: `rk daemon logs`, Windows port-owner lookup, replacing `rk status`, `--json` on mutating commands, deprecation forwarders | Confirmed from intake #19 | S:95 R:75 A:80 D:70 |
| 20 | Certain | `terminateOwner` signal escalation uses `syscall.Kill` (SIGTERM → 5s poll → SIGKILL), never a shell `kill` invocation | Inferred from intake assumption #5 + Constitution §I; new spec-level operational detail | S:85 R:75 A:90 D:80 |
| 21 | Certain | `rk daemon status --json` emits a structured JSON object on stdout with no trailing diagnostic text; warnings go to stderr | Inferred from intake assumption #13 (`--json` in scope) + standard CLI convention for machine-readable output | S:80 R:80 A:80 D:75 |
| 22 | Certain | Bare `rk` (no subcommand) continues to dispatch to `serveCmd.RunE` as foreground serve | Inferred from `root.go` — RunE forwarder is unchanged by this change; explicitly preserved for backwards compat | S:90 R:85 A:90 D:85 |

22 assumptions (22 certain, 0 confident, 0 tentative, 0 unresolved).
