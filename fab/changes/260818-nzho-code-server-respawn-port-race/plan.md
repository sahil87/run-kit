# Plan: Code-Server Respawn Port Race

**Change**: 260818-nzho-code-server-respawn-port-race
**Intake**: `intake.md`

## Requirements

### Daemon: Kill Signal

#### R1: KillCodeServerSession reports whether it killed a session
`daemon.KillCodeServerSession` SHALL return `(killed bool, err error)`: `(true, nil)` when the rk-code-server session existed and `kill-session` succeeded, `(false, nil)` when no session existed (the existing no-op), and `(false, err)` on a kill failure. The `codeServerKillFn` seam in `cmd/rk` adopts the new signature.

- **GIVEN** the rk-code-server session exists on the daemon socket
- **WHEN** `KillCodeServerSession` is called
- **THEN** it returns `(true, nil)` after the exact-match `kill-session` succeeds

- **GIVEN** no rk-code-server session exists
- **WHEN** `KillCodeServerSession` is called
- **THEN** it returns `(false, nil)` without running any tmux kill command

### CLI: Respawn Waits for the Port to Free

#### R2: respawnCodeServerSession waits for the freed port before restarting
`respawnCodeServerSession` (`app/backend/cmd/rk/code_server.go`) SHALL, **only when the kill reported `killed == true`**, poll until the resolved code-server port stops accepting connections before calling `codeServerStartFn()` — bounded at ~5s budget, ~200ms cadence. When the kill reported `killed == false` (no session existed), no wait runs and start is called immediately. The port probe and the budget/cadence live behind test seams (a `codeServerPortBusyFn` var plus shrinkable duration vars, the `internal/remote` readiness-poll idiom); the probe itself reuses the daemon package's loopback dial via a new exported `daemon.CodeServerPortInUse(port int) bool` wrapper rather than duplicating dial logic. An unresolvable port (0) probes as free, so the wait exits immediately.

- **GIVEN** the respawn killed rk's own session and the dying process still holds the port
- **WHEN** the port unbinds within the budget
- **THEN** the wait returns and `codeServerStartFn()` runs against a free port (no externally-managed misclassification)

- **GIVEN** the respawn found no session to kill (`killed == false`)
- **WHEN** the respawn proceeds
- **THEN** the port probe is never consulted and start is called immediately

#### R3: Budget expiry falls through unchanged
On budget expiry with the port still bound, the wait SHALL return normally and the respawn SHALL fall through to `codeServerStartFn()` unchanged — the ensure path's externally-managed classification and its existing truthful message are the outcome. No new error path, no new outcome value.

- **GIVEN** the killed instance never unbinds the port within the ~5s budget
- **WHEN** the wait expires
- **THEN** `codeServerStartFn()` runs, classifies `EnsureExternallyManaged`, and the existing "Port already serving — respecting the externally managed code-server" note prints

#### R4: The ensure path is untouched
`ensureCodeServerCore`'s skip order (session-exists → unresolvable-port → externally-managed-port → binary ladder) and the externally-managed carve-out SHALL remain byte-identical. Both respawn consumers (`runCodeServerUpdateFlow`, `migrateForeignCodeServerSession`) inherit the fix solely through the shared `respawnCodeServerSession` helper — no per-caller logic.

- **GIVEN** a genuinely external code-server serving the port with no rk session (nothing killed)
- **WHEN** any ensure/start path runs
- **THEN** the carve-out fires exactly as today and the instance is respected

### Tests: Race-Window Coverage

#### R5: The race window and its edges are covered by seam-driven tests
`cmd/rk` tests SHALL cover: (a) killed session → port busy then freed → respawn proceeds with start called after the port frees; (b) killed session → port never frees within a shrunken budget → falls through to start (externally-managed outcome when the start seam reports it); (c) no session existed → no wait, start called immediately; (d) genuinely external instance (no kill) → carve-out preserved. Daemon tests SHALL pin the new `(killed bool)` return for both the absent and present session branches.

- **GIVEN** the wait vars are shrunk and `codeServerPortBusyFn` scripted busy-busy-free
- **WHEN** the respawn runs after a `killed == true` kill
- **THEN** start is called exactly once, after the probe reported free

### Non-Goals

- No change to `ensureCodeServerCore`, its outcomes, or the daemon-boot ensure path — the fix is respawn-seam-only.
- No new config knobs for the wait budget/cadence (vars exist for tests, not users).
- No retry of the start after an externally-managed fall-through — today's truthful degradation stands.

### Design Decisions

#### Kill signal via return value, not a pre-kill probe
**Decision**: `KillCodeServerSession` gains a `killed bool` return derived from its existing internal session-existence check.
**Why**: The function already probes session existence to implement its no-op; returning that fact adds zero tmux commands, keeps the signal atomic with the kill, and the seam var propagates the signature naturally.
**Rejected**: A separate pre-kill `codeServerSessionExists` check in `respawnCodeServerSession` — a second tmux probe, a TOCTOU gap between probe and kill, and a new seam for the same fact.
*Introduced by*: 260818-nzho-code-server-respawn-port-race

#### Port probe exported from daemon, composed with config in one cmd/rk seam
**Decision**: Export `daemon.CodeServerPortInUse(port int) bool` (wrapping the unexported `portInUse(localhostAddr, port)`); `cmd/rk` wraps it plus `config.Load().ResolvedCodeServerPort()` in a single `codeServerPortBusyFn func() bool` seam.
**Why**: Reuses the one loopback-dial implementation (anti-pattern: duplicating utilities); a single boolean seam makes the race-window tests script busy/free sequences without sockets or clocks.
**Rejected**: A local `net.DialTimeout` copy in `cmd/rk` (duplicates `portInUse`, drifts from its probeHost/timeout discipline).
*Introduced by*: 260818-nzho-code-server-respawn-port-race

## Tasks

### Phase 2: Core Implementation

- [x] T001 `app/backend/internal/daemon/codeserver.go`: change `KillCodeServerSession() error` to `(killed bool, err error)` — `(false, nil)` on absent session, `(true, nil)` on successful kill, `(false, err)` on failure; route the kill's `runTmux` call through a package seam var (mirroring `codeServerSpawn`) so the present-session branch is unit-testable; export `CodeServerPortInUse(port int) bool` wrapping `portInUse(localhostAddr, port)` <!-- R1, R2 -->
- [x] T002 `app/backend/cmd/rk/code_server.go`: adopt the new kill-seam signature; add wait vars (`codeServerPortFreeTimeout = 5*time.Second`, `codeServerPortFreePoll = 200*time.Millisecond`) and the `codeServerPortBusyFn` seam (resolves `config.Load().ResolvedCodeServerPort()`, 0 ⇒ free, else `daemon.CodeServerPortInUse`); add `waitForCodeServerPortFree()`; in `respawnCodeServerSession` gate the wait on `killed == true` between kill and start <!-- R2, R3 -->

### Phase 3: Integration & Edge Cases

- [x] T003 `app/backend/internal/daemon/codeserver_test.go`: update `TestKillCodeServerSessionAbsentIsNoop` to assert `(false, nil)`; add a present-session case asserting `(true, nil)` and the exact-match kill argv via the new kill seam <!-- R1, R5 -->
- [x] T004 `app/backend/cmd/rk/code_server_test.go`: update `withCodeServerCLISeams`'s kill stub to the new signature (default `return true, nil` preserving existing kills=1/starts=1 assertions); add the race-window cases — (a) busy-then-free proceeds, (b) never-frees falls through to the externally-managed outcome under shrunken wait vars, (c) `killed == false` skips the probe entirely, (d) external-instance carve-out preserved (no kill → no wait → existing classification) <!-- R5, R4 -->
- [x] T005 Run `just test-backend` (Go tests) and fix any fallout; confirm no other `KillCodeServerSession` callers exist <!-- R1 -->

## Execution Order

- T001 blocks T002 (signature) and T003; T002 blocks T004; T005 last.

## Acceptance

### Functional Completeness

- [x] A-001 R1: `KillCodeServerSession` returns `(killed bool, err error)` with the documented truth table, and the `codeServerKillFn` seam compiles against it
- [x] A-002 R2: `respawnCodeServerSession` polls the resolved port free (bounded ~5s/~200ms, behind seams) only when the kill reported `killed == true`, before calling start
- [x] A-003 R3: budget expiry falls through to `codeServerStartFn()` with no new error path or outcome value

### Behavioral Correctness

- [x] A-004 R2: a version-changed update whose old instance unbinds within the budget respawns successfully (no "Port already serving" misclassification of rk's own dying instance)
- [x] A-005 R4: `ensureCodeServerCore`'s skip order and the externally-managed carve-out are unmodified (diff shows no edits inside `ensureCodeServerCore`)

### Scenario Coverage

- [x] A-006 R5: tests cover all four race-window cases — busy-then-free, never-frees, no-session no-wait, external-instance carve-out — plus both daemon-side kill-return branches

### Edge Cases & Error Handling

- [x] A-007 R2: an unresolvable port (0) probes as free so the wait exits immediately; a kill error still returns `respawnFailed` before any wait

### Code Quality

- [x] A-008 Pattern consistency: new seams follow the file's existing seam-var idiom (`codeServerSpawn`, `codeServerKillFn`) and the wait vars follow `internal/remote`'s shrinkable readiness-poll idiom
- [x] A-009 No unnecessary duplication: the port probe reuses `portInUse` via the exported wrapper — no second dial implementation

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

None — this change adds new functionality without making existing code redundant

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Kill signal implemented as the `killed bool` return (not a pre-kill probe in the caller) | Intake left the mechanism to apply; the function's existing internal existence check makes the return zero-cost and TOCTOU-free | S:70 R:80 A:85 D:75 |
| 2 | Confident | Port probe exported as `daemon.CodeServerPortInUse` and composed with config resolution in one `codeServerPortBusyFn` seam in cmd/rk | Reuses the single dial implementation per code-quality anti-pattern rules; one boolean seam keeps race tests socket-free | S:65 R:85 A:85 D:70 |
| 3 | Confident | The kill's `runTmux` call gains its own seam var so the `killed == true` branch is unit-testable | Matches the file's pervasive seam-var idiom; the present-session branch is currently untestable without live tmux | S:60 R:90 A:85 D:75 |

3 assumptions (0 certain, 3 confident, 0 tentative).
