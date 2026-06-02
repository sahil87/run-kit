# Spec: Deterministic Daemon Lifecycle

**Change**: 260527-901h-deterministic-daemon-lifecycle
**Created**: 2026-05-28
**Affected memory**: `docs/memory/run-kit/architecture.md`

## Non-Goals

- **Killing a foreground `rk serve` via `rk serve --stop`** — Out of scope. Reaching across shells to SIGTERM an interactive process is a blast-radius increase that warrants its own change and explicit user consent. The port-probe refusal added by this spec already prevents the confusing double-start that motivated the investigation.
- **Replacing the tmux-based supervision model** — No supervisor loop, watcher, or signal file. Constitution §VI (tmux sessions survive server restarts) and Self-Improvement Safety constraint are preserved unchanged.
- **Changing the `runkit` agent-session tmux server** — All reaping is scoped strictly to the `rk-daemon` socket (`-L rk-daemon`). The agent-session `runkit` server and its sessions are never touched.
- **PID files, lock files, or any persistent liveness store** — Constitution §II (No Database). Liveness is derived at request time from (1) the bound port and (2) tmux-session presence.

## Daemon Lifecycle: Port-Based Liveness Detection

### Requirement: Daemon refuses to start when the configured port is already in use

Before `daemon.Start(...)` and `daemon.StartWithBinary(...)` create the tmux session, the daemon SHALL probe whether the configured `RK_HOST:RK_PORT` is already accepting TCP connections, using `net.DialTimeout` with a 400ms timeout. If the dial succeeds, the daemon MUST refuse to start and return an error whose message distinguishes a daemon-managed serve from a foreground serve. The probe MUST run AFTER the existing `IsRunning()` check, so the "daemon already running" message is preferred when a live daemon session exists.

The probe host SHALL be derived from `cfg.Host` (loaded via `config.Load()`), with the following substitution rules applied:

- `cfg.Host == ""` → probe `127.0.0.1`
- `cfg.Host == "0.0.0.0"` → probe `127.0.0.1`
- `cfg.Host == "::"` → probe `127.0.0.1`
- Otherwise → probe `cfg.Host` literally

The probe error returned from `Start`/`StartWithBinary` MUST propagate to `serveCmd.RunE` so cobra exits non-zero, allowing scripts and automation to detect the refusal.

#### Scenario: Foreground serve already holds the port
- **GIVEN** a foreground `rk serve` is running and listening on `127.0.0.1:3000`
- **AND** no `rk-daemon` tmux session exists (so `IsRunning()` returns false)
- **WHEN** the user runs `rk serve -d`
- **THEN** `daemon.Start()` SHALL dial `127.0.0.1:3000`, observe the connection succeeds, and return an error containing the substrings `already serving on 127.0.0.1:3000`, `not under the rk-daemon`, and `RK_PORT`
- **AND** the cobra `RunE` exit code SHALL be non-zero
- **AND** no new tmux session SHALL be created on the `rk-daemon` socket

#### Scenario: Port is free, daemon starts normally
- **GIVEN** nothing is listening on `127.0.0.1:3000`
- **AND** no `rk-daemon` tmux session exists
- **WHEN** the user runs `rk serve -d`
- **THEN** the port probe SHALL fail (refused / timeout) within 400ms
- **AND** `daemon.Start()` SHALL proceed to `startSession`
- **AND** the user SHALL see `rk daemon started (rk-daemon/rk-daemon/serve)`

#### Scenario: Wildcard host triggers loopback substitution
- **GIVEN** `RK_HOST=0.0.0.0` (the repo's default `.env`)
- **AND** a foreground `rk serve` is bound to `0.0.0.0:3000` (reachable on loopback)
- **WHEN** the user runs `rk serve -d`
- **THEN** the daemon SHALL substitute `127.0.0.1` for `0.0.0.0` and dial `127.0.0.1:3000`
- **AND** the dial SHALL succeed
- **AND** `Start()` SHALL return the port-in-use error

#### Scenario: Daemon already running shortcuts the port probe
- **GIVEN** a live `rk-daemon` tmux session exists holding the port
- **WHEN** the user runs `rk serve -d`
- **THEN** `IsRunning()` SHALL return true BEFORE the port probe runs
- **AND** `Start()` SHALL return the existing `daemon already running` error from `serve.go`
- **AND** the new port probe SHALL NOT execute

#### Scenario: StartWithBinary inherits the port guard
- **GIVEN** the upgrade path `cmd/rk/upgrade.go` calls `daemon.RestartWithBinary(brewBinPath)`
- **AND** between `Stop()` and `StartWithBinary()` the port becomes occupied by some other process
- **WHEN** `StartWithBinary` runs its port probe
- **THEN** it SHALL refuse with the same port-in-use error
- **AND** the upgrade flow SHALL surface the error rather than silently spawning a dead daemon

#### Scenario: Probe timeout is bounded
- **GIVEN** the configured host:port is unreachable (no listener, no RST — e.g., a firewall blackhole)
- **WHEN** `Start()` runs the port probe
- **THEN** the probe SHALL complete within 400ms ± typical scheduling jitter
- **AND** `Start()` SHALL treat the timeout as "port free" and proceed to `startSession`

## Daemon Lifecycle: Stale-Socket Reaping

### Requirement: Daemon reaps an orphaned `rk-daemon` socket before creating a new session

When `Start()` / `StartWithBinary()` determine that no live daemon session exists (`IsRunning()` returns false) AND the port probe indicates the port is free, the daemon SHALL invoke `tmux -L rk-daemon kill-server` (via the existing `runTmux` helper) before calling `startSession`. This reap MUST:

- Stay entirely within the `internal/tmux/`-rooted abstraction — no direct `os.Remove` of socket files, no manual socket-path resolution from `${TMUX_TMPDIR}` or `/tmp/tmux-$(id -u)/`.
- Be idempotent and non-fatal — when no server runs on the socket, `tmux kill-server` is a no-op (it errors with "no server running on …" which the reap MUST treat as success). Any reap error MUST be logged at `slog.Debug` and MUST NOT block the subsequent `startSession` call.
- Run on the `serverSocket` package variable (`rk-daemon` in production; overridable to `rk-daemon-test` for tests) — NEVER on the agent-session `runkit` server or any other tmux server.
- Inherit the existing `cmd.CommandContext` + `cmdTimeout` (5s) enforcement from `runTmux`.

### Requirement: Reap is scoped strictly to the daemon socket

The reap MUST NOT touch any tmux server other than the one named by `serverSocket`. In particular, the agent-session `runkit` server, the user's default tmux server, and any other named socket MUST be unaffected. The reap function MUST construct its tmux invocation through `runTmux` (which prepends `-L serverSocket`) — it MUST NOT call bare `tmux kill-server` (which would target the user's default server).

#### Scenario: Orphaned socket present, port free, daemon starts cleanly
- **GIVEN** a stale `rk-daemon` socket exists at `/tmp/tmux-1001/rk-daemon` (server-behind-it dead, leftover from a prior crashed inner serve)
- **AND** `tmux -L rk-daemon list-sessions` reports "no server running on …"
- **AND** the configured port is free
- **WHEN** the user runs `rk serve -d`
- **THEN** `Start()` SHALL invoke `tmux -L rk-daemon kill-server` via `runTmux`
- **AND** the orphan socket SHALL be removed as a side effect of `kill-server`
- **AND** `startSession` SHALL create a fresh session on a clean socket
- **AND** the user SHALL see `rk daemon started`

#### Scenario: No socket present (cold start), reap is a no-op
- **GIVEN** no `rk-daemon` socket file exists on disk
- **AND** the configured port is free
- **WHEN** the user runs `rk serve -d`
- **THEN** the reap call SHALL execute and complete without error (tmux's "no server running" surface is treated as success)
- **AND** the daemon SHALL proceed to `startSession` normally
- **AND** the reap SHALL NOT create a socket file as a side effect

#### Scenario: Reap never touches the agent-session tmux server
- **GIVEN** the `runkit` tmux server has active agent sessions
- **AND** an orphan `rk-daemon` socket also exists
- **WHEN** the daemon reap runs
- **THEN** `runTmux(ctx, "kill-server")` SHALL prepend `-L rk-daemon` (via the existing socket arg in `runTmux`)
- **AND** the `runkit` server's sessions SHALL remain untouched
- **AND** no other tmux socket SHALL be removed

#### Scenario: Live daemon session, reap does not run
- **GIVEN** a live `rk-daemon` tmux session exists
- **WHEN** the user runs `rk serve -d`
- **THEN** `IsRunning()` SHALL return true
- **AND** `Start()` SHALL return the "daemon already running" error
- **AND** the reap MUST NOT execute (preventing collateral kill of the live session)

#### Scenario: Reap failure does not block startup
- **GIVEN** `runTmux(ctx, "kill-server")` returns an unexpected error (not "no server running" — e.g., tmux binary error)
- **WHEN** the reap runs
- **THEN** the error SHALL be logged at `slog.Debug` with the reap context
- **AND** `Start()` SHALL still proceed to `startSession`
- **AND** if `startSession` fails for an unrelated reason, that error is what surfaces — the reap error is informational only

## Daemon Lifecycle: Startup Logging

### Requirement: Daemonized serve writes startup output to a durable log file

When `rk serve` is invoked as the inner process of `daemon.startSession(...)`, the serve process SHALL write its slog output to a durable log file in addition to `os.Stderr`. The inner serve learns it is the daemon via the environment variable `RK_DAEMON_LOG`, set by `startSession` when it spawns the inner `<exe> serve`. The serve startup SHALL:

- Read `RK_DAEMON_LOG` at startup. When unset or empty, the serve runs with its current slog destination (`os.Stderr`-only) — no behavior change.
- When `RK_DAEMON_LOG` is set, resolve the parent directory of the path and create it via `os.MkdirAll(dir, 0o755)` if absent (consistent with existing `os.MkdirAll` usage in `internal/settings/settings.go` and `cmd/rk/initconf.go`).
- Open the log file with `os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)` — APPEND mode so successive daemon starts accrete history.
- Construct an `io.MultiWriter(os.Stderr, file)` and pass it to `slog.NewTextHandler` so all subsequent slog output is teed to both stderr (preserved for `tmux attach` visibility) AND the file (durable record).
- If opening or creating the log file fails, slog SHALL fall back to stderr-only and the failure SHALL be logged once at `slog.Warn` — the daemon MUST NOT abort startup because logging setup failed.

`startSession` SHALL resolve the daemon log path at session-creation time via `os.UserCacheDir()` → `<cache>/rk/daemon.log` (e.g. `~/.cache/rk/daemon.log` on Linux, `~/Library/Caches/rk/daemon.log` on macOS). The resolved path SHALL be passed as the `RK_DAEMON_LOG` env var on the `tmux new-session` invocation. If `os.UserCacheDir()` itself fails, `startSession` SHALL log at `slog.Warn` and proceed without the env var (daemon runs without file logging) — this MUST NOT block daemon creation.

The log MUST capture at minimum: the bind address (existing `slog.Info("server starting", "addr", addr)`) and any bind/startup error (existing `slog.Error("server error", "err", err)` at the `ListenAndServe` failure path) — so that a port collision inside the daemonized inner serve is greppable post-mortem.

### Requirement: Daemon log is a passive artifact

The log file MUST NOT be read by any other run-kit subsystem. It is a write-only diagnostic artifact. No supervisor, no log-tailing watcher, no `.restart-requested`-style signaling on log content. State derivation continues to rely on the bound port and tmux-session presence — never on log file contents. This preserves Constitution §VI (tmux sessions survive server restarts) and the Self-Improvement Safety constraint.

#### Scenario: Daemon launches, log file is created with both stderr and file output
- **GIVEN** `os.UserCacheDir()` resolves to `~/.cache` and `~/.cache/rk/daemon.log` does not exist
- **WHEN** `daemon.Start()` invokes `startSession`
- **THEN** `tmux new-session -d ...` SHALL be invoked with env `RK_DAEMON_LOG=/home/sahil/.cache/rk/daemon.log` (or platform-equivalent)
- **AND** the inner serve SHALL read `RK_DAEMON_LOG`, `os.MkdirAll(~/.cache/rk, 0o755)`, open the file with O_APPEND|O_CREATE|O_WRONLY (mode 0o644)
- **AND** slog output SHALL be teed to both stderr and the file
- **AND** the file SHALL contain at least one entry matching `server starting addr=`

#### Scenario: Daemonized port collision is greppable post-mortem
- **GIVEN** the foreground `rk serve` is already bound to port 3000
- **AND** the user runs `rk serve -d` (assume #1 / #2 are NOT yet in effect, e.g., before this change is shipped — the log is independently useful)
- **WHEN** the inner serve hits `bind: address already in use` and `os.Exit(1)`s
- **THEN** the slog.Error line SHALL be flushed to `~/.cache/rk/daemon.log` before the process exits
- **AND** `grep "address already in use" ~/.cache/rk/daemon.log` SHALL match a line
- **AND** the tmux session SHALL close as before (no behavior change at the tmux layer)

> NOTE: After this change ships, the port-probe refusal in fix #1 will prevent the daemon from reaching the bind attempt in this scenario. The log entry will instead capture the error path from `Start()` returning the port-in-use error if logged by the launcher; but the inner-serve log path is exercised by any future startup failure (e.g., a tmux quirk, a different bind error on a foreign network) — the log earns its keep beyond the specific scenario that motivated it.

#### Scenario: RK_DAEMON_LOG unset, behavior is unchanged
- **GIVEN** `rk serve` is invoked directly (not via the daemon)
- **AND** `RK_DAEMON_LOG` is not present in the environment
- **WHEN** the serve startup configures slog
- **THEN** slog SHALL output to `os.Stderr` only (no MultiWriter)
- **AND** no log file SHALL be created
- **AND** behavior SHALL be identical to the pre-change `slog.NewTextHandler(os.Stderr, ...)` path

#### Scenario: Log open fails, daemon still starts
- **GIVEN** `RK_DAEMON_LOG=/var/restricted/daemon.log` is set
- **AND** the directory is not writable by the user
- **WHEN** the inner serve attempts `os.MkdirAll` + `os.OpenFile`
- **THEN** the open SHALL fail with a permission error
- **AND** slog SHALL fall back to stderr-only (no MultiWriter wrap)
- **AND** a single `slog.Warn("daemon log unavailable", "path", path, "err", err)` SHALL be emitted
- **AND** the HTTP server SHALL still start normally

#### Scenario: UserCacheDir fails on host, daemon still starts (env var absent)
- **GIVEN** `os.UserCacheDir()` returns an error on the host
- **WHEN** `startSession` resolves the log path
- **THEN** it SHALL log `slog.Warn("daemon log path unavailable", "err", err)`
- **AND** spawn the inner serve WITHOUT `RK_DAEMON_LOG` in its environment
- **AND** the inner serve SHALL run with stderr-only slog (same as the unset case)
- **AND** the daemon tmux session SHALL be created normally

## Daemon Lifecycle: Documentation Drift

### Requirement: Architecture memory reflects the constants currently in `daemon.go`

`docs/memory/run-kit/architecture.md` § "Daemon Lifecycle" currently states the daemon runs as "session `rk`" — this is the legacy name. The current production constants are `SessionName = "rk-daemon"` and `LegacySessionName = "rk"` (the legacy is consulted only for transparent stop/restart of pre-rename daemons). Hydration of this change SHALL update the architecture memory to reflect:

- Current session name `rk-daemon` (window `serve`, socket `rk-daemon`).
- The legacy-name fallback in `Stop`/`Restart` paths.
- The new port-based liveness detection added by Requirement 1.
- The new stale-socket reaping behavior added by Requirement 2.
- The new daemon log file at `os.UserCacheDir()/rk/daemon.log` with tee-to-stderr behavior, added by Requirement 3.

This is a documentation update — no scenarios needed beyond `/fab-archive`'s hydration verification.

## Design Decisions

1. **Liveness via port probe, not PID file or process scan**:
   - *Why*: The port is the one resource that is true regardless of launch method (foreground vs daemon). It detects the actual collision the user would experience. PID files reintroduce persistent state the No-Database principle discourages and can themselves go stale. `ps`-scanning for `rk serve` processes is brittle, platform-specific, and racy.
   - *Rejected*: PID file at `~/.rk/daemon.pid` (stale-file problem, write-race on concurrent starts), and `ps`-grep (brittle across platforms, can false-positive on `rk serve --help` etc.).

2. **Loopback substitution for wildcard hosts**:
   - *Why*: Dialing `0.0.0.0` is platform-inconsistent and does not reliably detect a process bound to `0.0.0.0`. A `0.0.0.0` bind IS reachable on loopback, so probing `127.0.0.1` is the most reliable and pragmatic detection. The same applies to empty string and `::` (IPv6 unspecified).
   - *Rejected*: Literal-host dialing (e.g., dial `0.0.0.0:3000`) — works inconsistently across OSes; refused as too unreliable for a safety guard.

3. **Reap via `tmux -L rk-daemon kill-server`, not `os.Remove`**:
   - *Why*: Stays inside the `internal/tmux/`-rooted abstraction per code-quality rule "all tmux interaction goes through `internal/tmux/`". Inherits the existing `cmd.CommandContext`+timeout enforcement from `runTmux`. Idempotent — no-op when no server is running. Removes the socket file as a side effect of clean tmux exit.
   - *Rejected*: Direct `os.Remove` of `${TMUX_TMPDIR:-/tmp/tmux-$(id -u)}/rk-daemon` — bypasses the tmux abstraction, requires manual platform-specific path resolution, more code for a marginal-or-zero benefit.

4. **Env var (`RK_DAEMON_LOG`) over hidden cobra flag for daemon detection**:
   - *Why*: Keeps the public flag surface of `rk serve` minimal. `serve --help` is already explicit about `-d`/`--restart`/`--stop`; adding a hidden `--log-file` is discoverable in source but adds cobra wiring for no user-facing benefit. The env var is set only by `startSession` (single producer) and read only by the serve startup (single consumer) — a closed loop.
   - *Rejected*: A hidden `--log-file` cobra flag (additional flag surface; same outcome).

5. **Tee log to stderr AND file (`io.MultiWriter`) over file-only when daemonized**:
   - *Why*: Tee preserves the existing `tmux attach -t rk-daemon` debugging affordance (live stderr in the tmux pane) while guaranteeing a durable record. File-only would silently lose live visibility for users who attach to debug.
   - *Rejected*: File-only (loses attach-debug visibility), stderr-only (the original broken behavior — vanishes when tmux closes).

6. **Cobra exit code propagation for port-in-use refusal**:
   - *Why*: Scripts and automation (e.g., systemd timers, deployment runners) MUST be able to detect the refusal. Returning the error from `RunE` is the idiomatic cobra pattern and consistent with the existing `daemon already running` path in `serve.go`.
   - *Rejected*: Print-and-return-nil pattern — defeats automation.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Change type is `fix` | Confirmed from intake #1 — concrete defect (orphaned socket + silent daemon death from split-brain detection) | S:95 R:90 A:95 D:95 |
| 2 | Certain | Liveness anchored to bound port via `net.DialTimeout`, not tmux-session presence | Confirmed from intake #2 — empirically verified port is the only launch-method-independent signal | S:95 R:70 A:90 D:90 |
| 3 | Certain | Socket reaping scoped strictly to `rk-daemon` socket, never the agent-session `runkit` server | Confirmed from intake #3 — Constitution §VI and §I non-negotiable; spec encodes this as a dedicated requirement | S:95 R:60 A:95 D:90 |
| 4 | Certain | Reap uses `tmux -L rk-daemon kill-server` via `runTmux` | Confirmed from intake #4 (clarified) — abstraction-consistency with code-quality | S:95 R:75 A:75 D:65 |
| 5 | Certain | Daemon log at `os.UserCacheDir()/rk/daemon.log`, append mode, 0o644 file mode, 0o755 dir mode | Confirmed from intake #5 (clarified) — matches existing `os.MkdirAll` conventions in repo | S:95 R:80 A:75 D:70 |
| 6 | Certain | Daemon log is passive (no supervisor/watcher/signal file) | Confirmed from intake #6 (clarified) — Constitution §VI compliance | S:95 R:75 A:90 D:75 |
| 7 | Certain | `rk serve --stop` killing a foreground serve is OUT of scope | Confirmed from intake #7 (clarified) — encoded as explicit Non-Goal in spec | S:95 R:65 A:80 D:70 |
| 8 | Certain | Both `Start` and `StartWithBinary` gain the port guard + reap | Confirmed from intake #8 (clarified) — `StartWithBinary` is the upgrade path (`upgrade.go:100`); explicit scenario added | S:95 R:75 A:85 D:75 |
| 9 | Certain | Loopback substitution for wildcard/empty/`::` host | Confirmed from intake #9 (clarified) — encoded as explicit substitution rules in Requirement 1 | S:95 R:70 A:55 D:50 |
| 10 | Certain | Env var `RK_DAEMON_LOG` + `io.MultiWriter` tee (file + stderr) | Confirmed from intake #10 (clarified) — explicit env-var contract in spec | S:95 R:65 A:55 D:45 |
| 11 | Certain | Port-in-use refusal returns non-zero error (cobra exits non-zero) | Confirmed from intake #11 (clarified) — idiomatic cobra `RunE` pattern | S:95 R:80 A:85 D:80 |
| 12 | Certain | Port probe runs AFTER `IsRunning()` check (not before) | Spec-level decision — keeps the "daemon already running" message intact for the common case; the new probe is for the specific case `IsRunning()` is false but the port is held | S:90 R:70 A:90 D:85 |
| 13 | Certain | Port probe timeout is 400ms (single shot, no retries) | Spec-level decision — long enough to absorb scheduler jitter on a loaded host; short enough to keep `rk serve -d` snappy. No retry — a transient connection failure on first probe means the port is effectively free | S:80 R:75 A:80 D:75 |
| 14 | Certain | Reap log failures at `slog.Debug` (not `slog.Warn`/`Error`) and never block startup | Spec-level decision — a benign reap noop ("no server running") is the common case; surfacing it at higher levels would create log noise on every healthy start. Real failures still surface via `startSession` if anything is actually broken | S:80 R:80 A:80 D:75 |
| 15 | Certain | Log file open/create failure falls back to stderr-only with one `slog.Warn`, never aborts daemon | Spec-level decision — logging is diagnostic; a broken log MUST NOT prevent the HTTP server from starting (the user's primary intent) | S:85 R:80 A:90 D:80 |
| 16 | Confident | `os.UserCacheDir()` failure path: `startSession` proceeds without `RK_DAEMON_LOG` rather than aborting | Same reasoning as #15 — daemon creation MUST NOT be blocked by a logging-path failure. Inferred from existing conventions; not previously called out in intake | S:75 R:80 A:85 D:75 |
| 17 | Confident | The legacy session-name fallback (`SessionName=rk-daemon`, `LegacySessionName=rk`) remains untouched — the reap targets `serverSocket` (which is `rk-daemon`); a legacy daemon under socket `rk-daemon` socket-but-session-`rk` is reaped identically | The pre-rename daemons used the same socket name `rk-daemon` (`daemon.go:13-23`) — the rename was at the session level, not the socket level; so reap-by-socket cleans both eras' orphans | S:75 R:75 A:80 D:70 |
| 18 | Confident | Tests use the existing overridable `serverSocket` package variable (`rk-daemon-test`) to exercise port-probe + reap behavior in isolation | The daemon test file (`daemon_test.go`) already documents this override pattern — extends naturally; no new test infrastructure | S:75 R:85 A:80 D:75 |

18 assumptions (15 certain, 3 confident, 0 tentative, 0 unresolved).
