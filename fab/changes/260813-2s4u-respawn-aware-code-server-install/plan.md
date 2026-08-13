# Plan: Respawn-aware `rk code-server install`

**Change**: 260813-2s4u-respawn-aware-code-server-install
**Intake**: `intake.md`

## Requirements

### CLI: shared daemon-gated respawn

#### R1: One respawn helper, daemon gate inside, used by update and install
The kill+start sequence in `runCodeServerUpdateFlow` (`app/backend/cmd/rk/code_server.go:231-245`) SHALL be extracted into one helper whose FIRST action is a daemon-liveness check (`daemon.IsRunning` behind a package seam): daemon down ⇒ **zero tmux commands** — no kill, and no `KillCodeServerSession` has-session probe either (any tmux command on a dead socket births a server). The helper carries the kill → gated start → `EnsureExternallyManaged` respectful-note sequence; both the update flow and install's new migration respawn call it. Callers print their own daemon-down guidance (R3/R4).

- **GIVEN** the daemon down and a surviving `rk-code-server` session
- **WHEN** `rk code-server update` finds a new version
- **THEN** the install/flip happens, no tmux command runs, the session is left alive, and the exit is 0
- **AND GIVEN** a fully dead rk-daemon socket, no tmux server is birthed

#### R2: Foreign-session detection via `pane_start_command`
A new exported `daemon.CodeServerSessionCommand() (cmd string, exists bool, err error)` SHALL read the running session's spawn command with `list-panes -t =rk-code-server:=code-server -F '#{pane_start_command}'` (list-panes, NOT display-message — display-message silently falls back to the active window on a missing target, the 260812-anac bug class; first line wins, tolerating manual splits), behind a package seam per the `jobWindowState` idiom. Classification (in the CLI): the session is **ours** when the command string contains the home-resolved managed binary path (`codeserver.ManagedBinary(home)` — managed-rung spawns embed the `current`-symlink path in argv); otherwise **foreign** (brew/PATH-era). A query error on an existing session SHALL skip the respawn with a note — never kill on uncertain evidence.

- **GIVEN** a session spawned pre-#582 from brew's PATH binary
- **WHEN** the detection runs
- **THEN** it classifies foreign (start command lacks `~/.rk/code-server-bin/current/bin/code-server`)
- **AND GIVEN** a managed-rung session, it classifies ours and no respawn fires

#### R3: `rk code-server install` migrates a foreign session
After a successful install flow — **both** outcomes, version-changed and already-current — `runCodeServerInstall` SHALL: check the daemon gate; when up, run the R2 detection; on a foreign session, respawn via the R1 helper and print a data line (`Respawned code-server onto the managed v<ver> (was running a non-managed binary).`). No session ⇒ nothing extra (this keeps the `rk-jobs` chain `install && start` a strict no-op at the install step, since the job only fires when nothing was spawned). Daemon down ⇒ a data line naming the converging recovery: run `rk code-server install` again once the daemon is up (`rk serve -d`). The install `Long:` prose documents the migration respawn.

- **GIVEN** brew's 4.112.0 session running and no managed install
- **WHEN** `rk code-server install` runs with the daemon up
- **THEN** the latest release is installed AND the session is respawned onto the managed binary — the full brew-era migration in one command
- **AND GIVEN** the same but already-current managed install (a re-run), the foreign session is still detected and respawned

#### R4: Update keeps its contract; its respawn goes through the gated helper
`runCodeServerUpdateFlow` keeps the ownership gate (not-managed ⇒ skip) and the already-current short-circuit (no restart) byte-for-byte in spirit; only the version-changed respawn is rewired through the R1 helper. When the helper reports daemon-down, update prints the honest recovery for its edge (the flip already happened, so a surviving session is undetectable by R2's string match afterwards): after `rk serve -d`, respawn with `tmux -L rk-daemon kill-session -t '=rk-code-server' && rk code-server start` — exact-match, socket-scoped, the same command the helper itself runs.

- **GIVEN** the daemon down
- **WHEN** update installs a new version
- **THEN** exit 0, no tmux touched, and the data lines report both the install and the skipped respawn with the manual chain
- **AND GIVEN** the daemon up, behavior is the shipped kill→start→notes sequence unchanged

### Non-Goals

- No daemon-lifecycle change: `ensureCodeServer`'s session-exists skip and sibling survival across restarts are untouched (Constitution VI; the respawn stays an explicit user verb).
- No version marker in the spawn argv and no stale-version detection for managed-rung sessions: a session spawned from the managed path whose binary was flipped underneath while the daemon was down is not auto-detected (string-match can't see inodes) — R4's message documents the manual chain for that rare edge. Revisit only if it bites in practice.
- No new CLI commands or flags.

### Design Decisions

#### Detection stays the intake's path-string match, not a spawn-argv version marker
**Decision**: classify sessions by whether `pane_start_command` contains the managed `current` binary path — exactly the user-approved intake mechanism.
**Why**: it covers the entire migration class this change exists for (foreign brew/PATH sessions), with zero spawn-argv changes and no new state; the residual undetectable case (managed session flipped underneath while the daemon was down) is rare (update normally runs right after `rk update` restarted the daemon) and gets honest messaging instead of mechanism.
**Rejected**: embedding `RK_CODE_SERVER_VERSION=<ver>` in the spawn argv to compare against `InstalledVersion` (detects the residual edge too, but grows the spawn contract and the detection surface for a corner the messaging already covers — parsimony).
*Introduced by*: 260813-2s4u-respawn-aware-code-server-install

#### Caller-specific daemon-down copy, helper stays silent on the skip
**Decision**: the helper returns a distinct daemon-down outcome and prints nothing for it; each caller prints its own recovery line (install: "re-run install once the daemon is up" — which converges, since foreign detection re-fires; update: the manual kill-and-start chain — since after the flip, re-running either verb cannot detect the survivor).
**Why**: the truthful recovery differs by verb; one generic message would either mislead (implying self-heal) or name a tmux kill in the common install path where a simple re-run suffices.
**Rejected**: one shared skip message (wrong for one caller or the other); auto-respawning from the daemon's own start path (Constitution VI — an implicit editor teardown on daemon start is exactly what the sibling design forbids).
*Introduced by*: 260813-2s4u-respawn-aware-code-server-install

## Tasks

### Phase 1: Core Implementation

- [x] T001 `app/backend/internal/daemon/codeserver.go`: exported `CodeServerSessionCommand()` reading `list-panes -t =rk-code-server:=code-server -F '#{pane_start_command}'` (first line, error ⇒ exists=false) behind a `codeServerPaneCommand` package seam; unit tests for argv shape, absent-window mapping, and first-line parse <!-- R2 -->
- [x] T002 `app/backend/cmd/rk/code_server.go`: `respawnCodeServerSession(sink, version)` helper — `codeServerDaemonRunningFn` (seam over `daemon.IsRunning`) gate FIRST, then kill → start → `EnsureExternallyManaged` note; distinct daemon-down outcome; `runCodeServerUpdateFlow` rewired onto it with its R4 daemon-down copy; regression tests: daemon down ⇒ kill/start seams never called, daemon up ⇒ shipped sequence unchanged <!-- R1, R4 -->
- [x] T003 `app/backend/cmd/rk/code_server.go`: install migration respawn — after both install outcomes run gate → `codeServerSessionCommandFn` (seam) → classify against `codeserver.ManagedBinary(home)` → respawn foreign via the helper with the R3 data line; daemon-down and query-error notes; install `Long:` prose documents the migration <!-- R2, R3 -->

### Phase 2: Integration & Edge Cases

- [x] T004 CLI test matrix in `app/backend/cmd/rk/code_server_test.go`: install × {foreign session → respawn line, managed session → no respawn, no session → no-op (job-chain invariant), daemon down → skip line + zero tmux seams, query error → note + no kill, externally-managed start outcome → respectful note}; update daemon-down copy includes the manual chain <!-- R1, R2, R3, R4 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: One helper owns kill+start with the daemon gate before any tmux command; both callers route through it
- [x] A-002 R2: `CodeServerSessionCommand` uses list-panes on the exact-match target behind a seam; classification keys on `codeserver.ManagedBinary(home)`
- [x] A-003 R3: Install respawns a foreign session on both install outcomes and prints the respawn data line

### Behavioral Correctness

- [x] A-004 R4: Update's ownership gate and already-current short-circuit are unchanged; version-changed respawn now daemon-gated
- [x] A-005 R3: The brew-era machine converges with the single command `rk code-server install` (daemon up)

### Scenario Coverage

- [x] A-006 R1: Daemon-down tests prove zero tmux seam calls for both verbs
- [x] A-007 R2: Foreign vs managed vs absent vs query-error classification each has a test
- [x] A-008 R3: No-session install is a strict no-op at the respawn step (job-chain invariant test)

### Edge Cases & Error Handling

- [x] A-009 R2: Query error on an existing session skips with a note and never kills
- [x] A-010 R4: Update's daemon-down data line names the exact-match manual chain; install's names the re-run recovery

### Code Quality

- [x] A-011 Pattern consistency: package-seam test idiom (`codeServerLookPath`/`jobWindowState` precedents), sink data-vs-chatter split, exact-match `=` targets
- [x] A-012 No unnecessary duplication: exactly one kill+start sequence remains in `code_server.go`

### Security

- [x] A-013 R1: No tmux command reaches a dead socket (server-birth hazard); all tmux via `exec.CommandContext` argv slices

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

None — this change adds new functionality without making existing code redundant. The one duplication it found (the update flow's inline kill+start at old `code_server.go:231-245`) was folded into the new shared `respawnCodeServerSession` helper as part of the change itself, so nothing remains to delete.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Helper returns an outcome enum ({done, daemonDown, externallyManaged}) and prints only the shared notes; callers own the daemon-down copy | The truthful recovery differs by verb (Design Decision 2) | S:60 R:85 A:85 D:75 |
| 2 | Confident | Update's daemon-down copy names the exact-match tmux chain — the flip already happened, so no rk verb can detect the survivor afterwards | Honest edge messaging beats an undetectable-state mechanism; rare path (update normally follows a daemon restart) | S:55 R:80 A:80 D:70 |
| 3 | Confident | Install re-run convergence (foreign detection re-fires on already-current) is the install daemon-down recovery | Detection is state-free, so the re-run is guaranteed to see the same foreign session | S:60 R:85 A:85 D:80 |
| 4 | Confident | No spawn-argv version marker (Non-Goal) | Parsimony; intake's Certain detection spec is the user-approved mechanism | S:60 R:80 A:80 D:70 |

4 assumptions (0 certain, 4 confident, 0 tentative).
