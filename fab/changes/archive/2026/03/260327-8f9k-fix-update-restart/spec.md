# Spec: Fix Update Restart

**Change**: 260327-8f9k-fix-update-restart
**Created**: 2026-03-27
**Affected memory**: `docs/memory/run-kit/architecture.md`

## Daemon: Binary Path Override for Start

### Requirement: StartWithBinary accepts explicit binary path

The `daemon` package SHALL expose a `StartWithBinary(binPath string) error` function that creates a daemon tmux session using the provided binary path instead of `os.Executable()`.

`StartWithBinary` SHALL:
1. Resolve `binPath` via `filepath.EvalSymlinks()` to follow symlinks to the real binary
2. Create a detached tmux session (`new-session -d`) running `{resolved} serve`
3. Return an error if a daemon is already running
4. Return an error if symlink resolution fails

The existing `Start()` function SHALL remain unchanged — it continues to use `os.Executable()` + `filepath.EvalSymlinks()`.

#### Scenario: Upgrade restart with brew bin symlink

- **GIVEN** the daemon is not running
- **AND** `binPath` is `/home/linuxbrew/.linuxbrew/bin/rk` (a symlink to `/home/linuxbrew/.linuxbrew/Cellar/rk/0.5.3/bin/rk`)
- **WHEN** `StartWithBinary(binPath)` is called
- **THEN** `filepath.EvalSymlinks(binPath)` resolves to the new Cellar path
- **AND** a tmux session is created running the resolved binary with `serve` argument

#### Scenario: StartWithBinary when daemon already running

- **GIVEN** the daemon tmux session already exists
- **WHEN** `StartWithBinary("/usr/local/bin/rk")` is called
- **THEN** an error containing "daemon already running" is returned
- **AND** no new session is created

#### Scenario: StartWithBinary with invalid path

- **GIVEN** `binPath` is `/nonexistent/path/rk`
- **WHEN** `StartWithBinary(binPath)` is called
- **THEN** an error containing "resolving executable symlinks" is returned

### Requirement: RestartWithBinary delegates to StartWithBinary

The `daemon` package SHALL expose a `RestartWithBinary(binPath string) error` function that stops any running daemon and then calls `StartWithBinary(binPath)`.

The existing `Restart()` function SHALL remain unchanged — it continues to call `Start()`.

#### Scenario: RestartWithBinary with running daemon

- **GIVEN** the daemon is currently running
- **WHEN** `RestartWithBinary("/home/linuxbrew/.linuxbrew/bin/rk")` is called
- **THEN** the existing daemon is stopped (C-c + wait)
- **AND** a new daemon is started using the provided binary path

#### Scenario: RestartWithBinary with no running daemon

- **GIVEN** the daemon is not running
- **WHEN** `RestartWithBinary(binPath)` is called
- **THEN** a new daemon is started using the provided binary path (no stop attempt)

## Update Command: Pass Brew Bin Path to Restart

### Requirement: upgrade.go uses RestartWithBinary after brew upgrade

The `rk update` command SHALL call `daemon.RestartWithBinary(exePath)` instead of `daemon.Restart()` after a successful `brew upgrade`, where `exePath` is the value from `os.Executable()` *before* symlink resolution.

On Homebrew installs, `os.Executable()` returns the symlink path (e.g., `/home/linuxbrew/.linuxbrew/bin/rk`), not the resolved Cellar path. After `brew upgrade`, this symlink points to the new version. Passing this unresolved symlink path to `RestartWithBinary` allows `filepath.EvalSymlinks` inside `StartWithBinary` to resolve to the new Cellar path.

#### Scenario: Successful update with daemon restart

- **GIVEN** rk v0.5.0 is installed via Homebrew
- **AND** v0.5.3 is available
- **WHEN** `rk update` runs
- **THEN** `brew upgrade wvrdz/tap/rk` succeeds
- **AND** `daemon.RestartWithBinary(exePath)` is called with the original `os.Executable()` path (the brew bin symlink)
- **AND** the daemon starts running v0.5.3

#### Scenario: Start() callers unaffected

- **GIVEN** `rk serve -d` or `rk serve --restart` is invoked
- **WHEN** the serve command calls `daemon.Start()` or `daemon.Restart()`
- **THEN** the existing behavior using `os.Executable()` is used
- **AND** no change in behavior from before this fix

## Design Decisions

1. **Additive API (`StartWithBinary` / `RestartWithBinary`) over modifying existing signatures**
   - *Why*: Existing callers (`serve.go` `-d`, `--restart`, `--stop`) work correctly with `os.Executable()` — their binary path is valid because they aren't upgrading themselves. Changing `Start()` to accept a parameter would require updating all callers for no benefit.
   - *Rejected*: Making `Start(binPath ...string)` variadic — adds optional parameter ambiguity without clarity gains over separate named functions.

2. **Use `os.Executable()` (unresolved symlink) as the binary path argument**
   - *Why*: `upgrade.go` already captures `exePath` via `os.Executable()` on line 25. On Homebrew installs, this returns the symlink in the brew prefix bin (e.g., `/home/linuxbrew/.linuxbrew/bin/rk`), which brew updates to point at the new Cellar version during upgrade. The symlink is the stable reference; the Cellar path changes with every version.
   - *Rejected*: Looking up `exec.LookPath("rk")` — depends on `$PATH` ordering and may find a different `rk` binary. Using `exePath` is deterministic.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Additive `StartWithBinary`/`RestartWithBinary` API — existing callers unchanged | Confirmed from intake #1 — constitution §III, non-breaking, serves.go callers have valid binary paths | S:90 R:95 A:90 D:90 |
| 2 | Certain | Use `os.Executable()` (unresolved) as bin path argument to restart | Confirmed from intake #2 — `upgrade.go` already captures `exePath` before resolving; brew symlink is the stable reference | S:85 R:90 A:95 D:90 |
| 3 | Certain | `Restart()` and `Start()` unchanged for serve.go callers | Confirmed from intake #3 — only upgrade path needs explicit binary | S:90 R:95 A:90 D:95 |
| 4 | Certain | Brew bin symlink points to new version after `brew upgrade` completes | Upgraded from intake Confident — verified: Homebrew atomically updates the symlink during `brew upgrade` before cleanup runs | S:85 R:90 A:90 D:90 |
| 5 | Certain | `StartWithBinary` reuses the same tmux session creation logic as `Start()` | Both functions create `new-session -d -s rk -n serve` with the same socket — only the binary path source differs | S:95 R:95 A:95 D:95 |

5 assumptions (5 certain, 0 confident, 0 tentative, 0 unresolved).
