# Spec: Daemon Lifecycle for `run-kit serve`

**Change**: 260320-hkm8-daemon-lifecycle-serve
**Created**: 2026-03-20
**Affected memory**: `docs/memory/run-kit/architecture.md`

## Non-Goals

- Crash recovery / auto-restart loop — if the server dies, the user restarts manually or re-runs `run-kit serve -d`
- Health check polling after restart — `--restart` starts the new process and exits; it does not verify the server is healthy
- Supporting non-Homebrew update flows in `run-kit update` — manual installs (`just build`) use `just restart` directly

## CLI: Daemon Flag (`-d`)

### Requirement: Start daemon in dedicated tmux session

`run-kit serve -d` (alias: `--daemon`) SHALL create a tmux session on a dedicated server and run `run-kit serve` inside it. The CLI process SHALL exit 0 after confirming the session started.

#### Scenario: Start daemon when none exists
- **GIVEN** no tmux session exists on the `rk-daemon` server
- **WHEN** the user runs `run-kit serve -d`
- **THEN** a tmux session is created: server `rk-daemon`, session `rk`, window `serve`
- **AND** the command `run-kit serve` is sent to the pane
- **AND** stdout prints `run-kit daemon started (rk-daemon/rk/serve)`
- **AND** the process exits 0

#### Scenario: Start daemon when one already exists
- **GIVEN** a tmux session `rk` exists on the `rk-daemon` server
- **WHEN** the user runs `run-kit serve -d`
- **THEN** stdout prints `run-kit daemon already running (rk-daemon/rk/serve)`
- **AND** the process exits 1

### Requirement: Tmux session layout

The daemon tmux session SHALL use server socket `rk-daemon` (`-L rk-daemon`), session name `rk`, and window name `serve`. This is separate from the `runkit` server used for agent sessions.

#### Scenario: Daemon does not pollute agent tmux server
- **GIVEN** the `runkit` tmux server has existing agent sessions
- **WHEN** the user runs `run-kit serve -d`
- **THEN** the daemon session is created on the `rk-daemon` server
- **AND** `tmux -L runkit list-sessions` output is unchanged

## CLI: Restart Flag (`--restart`)

### Requirement: Idempotent daemon restart

`run-kit serve --restart` SHALL stop any existing daemon and start a new one. If no daemon exists, it SHALL start one (equivalent to `-d`).

#### Scenario: Restart when daemon is running
- **GIVEN** a tmux session `rk` exists on the `rk-daemon` server with `run-kit serve` running
- **WHEN** the user runs `run-kit serve --restart`
- **THEN** `C-c` is sent to the `rk:serve` pane
- **AND** the command waits up to 5 seconds for the process to exit
- **AND** `run-kit serve` is sent to the pane
- **AND** stdout prints `Restarting run-kit daemon...` followed by `run-kit daemon started (rk-daemon/rk/serve)`

#### Scenario: Restart when no daemon exists
- **GIVEN** no tmux session exists on the `rk-daemon` server
- **WHEN** the user runs `run-kit serve --restart`
- **THEN** behavior is identical to `run-kit serve -d`
- **AND** stdout prints `run-kit daemon started (rk-daemon/rk/serve)`

#### Scenario: Restart after Homebrew upgrade
- **GIVEN** `run-kit` was upgraded via `brew upgrade` (new binary at Homebrew symlink)
- **AND** a daemon was running the old binary
- **WHEN** `run-kit serve --restart` is executed
- **THEN** the old process is stopped via `C-c`
- **AND** the new `run-kit serve` command in the tmux pane resolves to the new binary (via Homebrew symlink)

## CLI: Stop Flag (`--stop`)

### Requirement: Stop daemon gracefully

`run-kit serve --stop` SHALL send `C-c` to the daemon pane to trigger graceful shutdown. If no daemon exists, it SHALL print a message and exit 0.

#### Scenario: Stop a running daemon
- **GIVEN** a tmux session `rk` exists on the `rk-daemon` server
- **WHEN** the user runs `run-kit serve --stop`
- **THEN** `C-c` is sent to the `rk:serve` pane
- **AND** stdout prints `run-kit daemon stopped`

#### Scenario: Stop when no daemon exists
- **GIVEN** no tmux session exists on the `rk-daemon` server
- **WHEN** the user runs `run-kit serve --stop`
- **THEN** stdout prints `run-kit daemon not running`
- **AND** the process exits 0

## CLI: Daemon Detection

### Requirement: Detect daemon via tmux has-session

Daemon existence SHALL be determined by `tmux -L rk-daemon has-session -t rk`. Exit code 0 means running; non-zero means not running.

#### Scenario: Daemon running
- **GIVEN** the `rk-daemon` server has session `rk`
- **WHEN** daemon detection runs
- **THEN** `tmux -L rk-daemon has-session -t rk` exits 0
- **AND** the daemon is considered running

#### Scenario: Daemon not running
- **GIVEN** the `rk-daemon` server does not exist or has no session `rk`
- **WHEN** daemon detection runs
- **THEN** `tmux -L rk-daemon has-session -t rk` exits non-zero
- **AND** the daemon is considered not running

## CLI: Flag Mutual Exclusivity

### Requirement: Flags are mutually exclusive

`-d`, `--restart`, and `--stop` SHALL be mutually exclusive. If more than one is provided, the command SHALL print an error and exit 1. When none of `-d`, `--restart`, `--stop` are provided, `run-kit serve` runs the HTTP server in the foreground (existing behavior unchanged).

#### Scenario: Multiple daemon flags
- **GIVEN** the user runs `run-kit serve -d --stop`
- **WHEN** the command parses flags
- **THEN** stderr prints an error about mutually exclusive flags
- **AND** the process exits 1

## Update: Auto-restart After Upgrade

### Requirement: Auto-restart daemon after brew upgrade

`run-kit update` SHALL automatically restart the daemon after a successful `brew upgrade` by invoking the same logic as `run-kit serve --restart`. If no daemon is running, the restart is a no-op (starts a daemon).

#### Scenario: Update with running daemon
- **GIVEN** a daemon is running and a new version is available
- **WHEN** the user runs `run-kit update`
- **THEN** `brew upgrade wvrdz/tap/run-kit` completes successfully
- **AND** the daemon is restarted (old process stopped, new binary started)
- **AND** stdout shows the version transition and restart confirmation

#### Scenario: Update when already up to date
- **GIVEN** the installed version matches the latest
- **WHEN** the user runs `run-kit update`
- **THEN** stdout prints `Already up to date (v{version}).`
- **AND** no daemon restart occurs

#### Scenario: Update with no daemon running
- **GIVEN** no daemon is running and a new version is available
- **WHEN** the user runs `run-kit update`
- **THEN** `brew upgrade` completes successfully
- **AND** the daemon restart starts a new daemon
- **AND** stdout shows the version transition and daemon start confirmation

## Removals: Supervisor and Signal File

### Requirement: Remove supervisor.sh

`scripts/supervisor.sh` SHALL be deleted. No polling loop, no `.restart-requested` signal file, no inode checking.

#### Scenario: Supervisor file removed
- **GIVEN** the change is applied
- **WHEN** the repository is inspected
- **THEN** `scripts/supervisor.sh` does not exist

### Requirement: Update justfile recipes

The justfile `up`, `down`, and `restart` recipes SHALL be updated to use the new CLI commands.

#### Scenario: Justfile recipes use CLI
- **GIVEN** the change is applied
- **WHEN** the justfile is inspected
- **THEN** `up` runs `run-kit serve -d`
- **AND** `down` runs `run-kit serve --stop`
- **AND** `restart` runs `run-kit serve --restart`

### Requirement: Update constitution

The constitution's references to `.restart-requested` and signal-based restart SHALL be updated to describe the tmux-based kill-and-restart approach.

#### Scenario: Constitution reflects new approach
- **GIVEN** the change is applied
- **WHEN** `fab/project/constitution.md` is inspected
- **THEN** the Self-Improvement Safety section describes tmux-based daemon restart
- **AND** no reference to `.restart-requested` remains

## Internal: Daemon Package

### Requirement: Shared daemon helpers

Daemon operations (detect, start, stop, restart) SHALL be implemented in `internal/daemon/` to be shared between `serve.go` and `upgrade.go`.

#### Scenario: Both commands use shared helpers
- **GIVEN** `serve.go` uses `--restart` and `upgrade.go` calls restart after upgrade
- **WHEN** the implementation is inspected
- **THEN** both import `internal/daemon` for tmux session management
- **AND** no daemon logic is duplicated between files

## Deprecated Requirements

### Supervisor Script

**Reason**: Replaced by direct tmux daemon management via `run-kit serve -d/--restart/--stop`
**Migration**: `just up` → `run-kit serve -d`, `just down` → `run-kit serve --stop`, `just restart` → `run-kit serve --restart`

### `.restart-requested` Signal File

**Reason**: Supervisor polling loop eliminated; restart is now an imperative tmux operation
**Migration**: N/A — no replacement needed

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Kill-and-restart via tmux, not supervisor loop | Confirmed from intake #1 — user explicitly chose approach | S:95 R:90 A:95 D:95 |
| 2 | Certain | `--restart` is idempotent (start if not running) | Confirmed from intake #2 — "ensure the latest binary is serving" | S:95 R:85 A:90 D:95 |
| 3 | Certain | Separate tmux server `rk-daemon` for daemon | Confirmed from intake #3 — isolation from `runkit` agent server | S:80 R:80 A:90 D:85 |
| 4 | Certain | `supervisor.sh` and `.restart-requested` removed | Confirmed from intake #4 | S:90 R:85 A:90 D:95 |
| 5 | Certain | Daemon detection via `tmux has-session` | Confirmed from intake #5 — user confirmed | S:95 R:90 A:85 D:80 |
| 6 | Certain | Stop via `C-c` (SIGINT) to tmux pane | Confirmed from intake #6 — matches serve.go graceful shutdown | S:95 R:85 A:90 D:80 |
| 7 | Certain | `-d` errors if daemon already running | Confirmed from intake #7 — `-d` = start, `--restart` = ensure | S:95 R:85 A:95 D:95 |
| 8 | Certain | `run-kit update` auto-restarts after upgrade | Confirmed from intake #8 — no explicit flag needed | S:95 R:80 A:95 D:95 |
| 9 | Certain | `internal/daemon/` package for shared helpers | Codebase convention — `internal/` packages for shared logic; avoids duplication between serve.go and upgrade.go | S:85 R:90 A:90 D:90 |
| 10 | Certain | 5-second wait timeout after sending C-c | Matches existing graceful shutdown timeout in serve.go (5s `context.WithTimeout`) | S:80 R:90 A:90 D:85 |
| 11 | Certain | Flags `-d`/`--restart`/`--stop` are mutually exclusive | Standard CLI pattern — each flag triggers a distinct operation mode | S:85 R:95 A:95 D:90 |

11 assumptions (11 certain, 0 confident, 0 tentative, 0 unresolved).
