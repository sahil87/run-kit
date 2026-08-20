# Plan: Daemon Restart Full Flag

**Change**: 260818-lqcf-daemon-restart-full-flag
**Intake**: `intake.md`

## Requirements

### Daemon: Full restart of the rk-daemon tmux server

#### R1: `--full` flag on `rk daemon restart`
`rk daemon restart` SHALL accept a `--full` flag. With the flag, the command MUST run: (1) graceful `daemon.Stop()` when `daemon.IsRunning()`, (2) audited kill-server on the rk-daemon socket (R2), (3) `daemon.Start()`. Without the flag, behavior MUST be byte-identical to today (including `--force` semantics). `--full` and `--force` MAY combine — the `--force` port-owner step runs unchanged between kill-server and start.

- **GIVEN** a running daemon with sibling sessions on the rk-daemon socket
- **WHEN** `rk daemon restart --full` runs from a shell outside that socket
- **THEN** the daemon stops gracefully, the whole rk-daemon tmux server is killed, and a fresh server is birthed by the normal start path
- **AND** `rk daemon restart` without the flag never touches the server or its sibling sessions

#### R2: Audited, idempotent `daemon.KillServer`
`internal/daemon` SHALL export `KillServer()` as a thin wrapper over the existing `tmux.KillServer(serverSocket)` (Constitution III — that helper already emits the `killAudit` teardown line with a caller chain and runs under its own timeout), widening its dead-server tolerance: any error matching `tmux.IsServerGone` MUST be success, not an error. Using the package's `serverSocket` var (not the constant) preserves the existing test seam.

- **GIVEN** the rk-daemon socket has no live server
- **WHEN** `KillServer` runs
- **THEN** it returns nil and the audit line was still emitted before the attempt

#### R3: Refusal guard inside the rk-daemon server
With `--full`, the command MUST refuse — before any stop/kill/start action — when the invoking pane lives on the rk-daemon tmux server: parse `tmux.OriginalTMUX` (the pre-strip `$TMUX`; format `socketpath,pid,session`), and refuse when the socket path's basename equals `daemon.ServerSocket`. The error MUST say the pane would die mid-restart and to re-run from a shell outside that server. An empty `OriginalTMUX` (not inside tmux) passes the guard.

- **GIVEN** a shell pane inside the rk-daemon server (e.g. an rk-jobs window)
- **WHEN** `rk daemon restart --full` runs there
- **THEN** it exits non-zero with the guard message and no tmux command has run

#### R4: Remote-tunnel capture and reconnect
With `--full`, before the kill the command SHALL derive the set of registered remotes whose tunnels are currently up (intersect `remote.Load(remotesPathFn())` entry names with `remote.ListTunnels(ctx)` true entries). After a successful start it SHALL re-run `remote.Connect` for exactly those remotes (same wiring as `rk remote connect`: store path, `displayVersion()`, progress printer). A per-remote reconnect failure MUST be reported and MUST NOT fail the command (the restart itself succeeded); remotes whose tunnels were already down are left alone. No registered remotes ⇒ the whole step is a silent no-op (a store-load error with `--full` is reported as a warning and treated as no remotes).

- **GIVEN** two registered remotes, one with its tunnel up, one down
- **WHEN** `rk daemon restart --full` completes
- **THEN** `remote.Connect` ran only for the previously-up remote
- **AND** a reconnect failure prints a warning while the command still exits 0

#### R5: Standards-conformant surface
The new flag's help text SHALL be reflected in the command's `Long`/flag descriptions (picked up by `rk help-dump`), and output SHALL follow the existing `daemon restart` print style (progress lines on stdout, matching the sibling daemon verbs).

- **GIVEN** the built binary
- **WHEN** `rk daemon restart -h` runs
- **THEN** `--full` is documented alongside `--force`

### Non-Goals

- No change to `reapStaleDaemonSocket`, `rk daemon stop`, or plain `restart` (the 260813 session-scoped reap fix is untouched).
- No wiring of `--full` into the auto-update chain — manual verb only.
- No `--full`-specific code-server respawn logic (daemon-boot `ensureCodeServer` covers it; the respawn port race is change 260818-nzho).
- No snapshot-tombstone work: the Snapshotter lives in the serve process, which is stopped before the kill; the audit slog line is the required trail.

### Design Decisions

#### Guard reads `tmux.OriginalTMUX`, not `os.Getenv("TMUX")`
**Decision**: The R3 guard parses `tmux.OriginalTMUX`.
**Why**: `internal/tmux.init()` strips `TMUX` from the environment at process start; `OriginalTMUX` is the captured pre-strip value — the established idiom (`cmd/rk/agent_hook.go`).
**Rejected**: Reading the env var directly (always empty after init; the guard would never fire).
*Introduced by*: 260818-lqcf-daemon-restart-full-flag

#### Reconnect failures degrade to warnings
**Decision**: Per-remote `remote.Connect` failures print warnings; the command exits 0.
**Why**: The restart's contract is a fresh daemon server, which succeeded; a remote box being unreachable is an independent, externally-caused condition with its own recovery (`rk remote connect <name>`), and failing the whole command would misreport the restart.
**Rejected**: Non-zero exit on any reconnect failure (conflates two outcomes; breaks scripted use).
*Introduced by*: 260818-lqcf-daemon-restart-full-flag

## Tasks

### Phase 1: Core Implementation

- [x] T001 Add `KillServer() error` to `app/backend/internal/daemon/daemon.go` — thin wrapper over `tmux.KillServer(serverSocket)` with `tmux.IsServerGone(err)` ⇒ nil — and unit tests in `app/backend/internal/daemon/daemon_test.go` following the existing withServerSocket test idiom <!-- R2 -->
- [x] T002 Add `--full` flag, R3 guard (parse `tmux.OriginalTMUX`, basename == `daemon.ServerSocket` ⇒ error), and the stop → `KillServer` → (existing `--force` step) → start orchestration to `app/backend/cmd/rk/daemon_restart.go`, introducing seam vars for daemon/remote calls per the cmd/rk idiom (`codeServerDaemonRunningFn`-style) <!-- R1 -->

### Phase 2: Integration & Edge Cases

- [x] T003 Wire the tunnel capture/reconnect sweep in `app/backend/cmd/rk/daemon_restart.go`: pre-kill `remote.Load` ∩ `remote.ListTunnels` up-set, post-start `remote.Connect` loop with warning-only failure handling and silent no-op on empty set <!-- R4 -->
- [x] T004 Command tests in `app/backend/cmd/rk/daemon_restart_test.go` (new or extending `daemon_test.go`): guard refusal (stubbed `OriginalTMUX`), full sequence ordering via seams, reconnect only-previously-up + warning-not-error, no-remotes no-op, plain `restart` unchanged, `--full --force` combination <!-- R1 R3 R4 -->

### Phase 3: Polish

- [x] T005 Update `daemon_restart.go` `Long` text + flag help for `--full`; verify `rk help-dump` includes it and output stays consistent with sibling daemon verbs (Constitution Toolkit Standards) <!-- R5 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: `rk daemon restart --full` runs stop → audited kill-server → start; plain `restart` and `--force` behavior are byte-identical to before
- [x] A-002 R2: `daemon.KillServer` wraps `tmux.KillServer` (audit line + timeout for free) and treats any `IsServerGone` error as success
- [x] A-003 R3: invocation from a pane on the rk-daemon socket refuses before any tmux command, with actionable message
- [x] A-004 R4: previously-up tunnels are reconnected post-start; down/unregistered ones untouched; failures warn without failing the command

### Scenario Coverage

- [x] A-005 R1: test covers the full-flag sequence ordering (stop before kill, kill before start)
- [x] A-006 R3: test covers guard refusal with a stubbed rk-daemon `$TMUX` and pass-through with empty/foreign socket
- [x] A-007 R4: tests cover the two-remotes (one up, one down) selection and the warning-only failure path

### Edge Cases & Error Handling

- [x] A-008 R2: kill-server against an already-dead server returns success (idempotent re-run)
- [x] A-009 R4: store-load error under `--full` degrades to a warning + empty reconnect set, never a crash

### Code Quality

- [x] A-010 Pattern consistency: seam-var injection matches the cmd/rk idiom; audit line matches existing teardown audits byte-for-byte in shape
- [x] A-011 No unnecessary duplication: reuses `runTmux`, `remote.Load`/`ListTunnels`/`Connect`, `displayVersion()` — no new tmux or ssh plumbing
- [x] A-012 All subprocess work stays behind `exec.CommandContext` with timeouts (Constitution I / Process Execution)

### Security

- [x] A-013 R2: no user-provided input reaches the kill-server argv (fixed argument slice, socket from the package constant)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change adds new functionality without making existing code redundant

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | `--full` composes with `--force` (force step unchanged, between kill and start) rather than being mutually exclusive | Orthogonal concerns (server freshness vs port squatter); exclusivity would surprise scripted users | S:60 R:85 A:80 D:70 |
| 2 | Confident | Guard compares `filepath.Base` of the `OriginalTMUX` socket path against `daemon.ServerSocket` (named-socket layout `/tmp/tmux-<uid>/<name>`) | Matches how `-L` sockets materialize on disk; `-S` custom paths are out of scope for rk-owned sockets | S:65 R:80 A:75 D:70 |
| 3 | Confident | Reconnect progress rides the existing stdout print style of the daemon verbs (no `outputSink` retrofit of `daemon restart`) | Sibling daemon commands print with `fmt.Fprintln(cmd.OutOrStdout())`; retrofitting the sink is a separate cleanup | S:55 R:85 A:75 D:65 |
| 4 | Certain | Snapshot tombstones are out of scope (no Snapshotter is alive at kill time) | The Snapshotter runs inside the serve process, stopped in step 1; audit slog is the required trail per intake | S:80 R:85 A:90 D:85 |

4 assumptions (1 certain, 3 confident, 0 tentative).
