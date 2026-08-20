# Plan: Unify Daemon Restart Sequencing

**Change**: 260818-gs6y-unify-daemon-restart-sequencing
**Intake**: `intake.md`

## Requirements

### Daemon: Release-synchronous kill primitives

#### R1: KillCodeServerSession waits for port release
`daemon.KillCodeServerSession` MUST, after a successful kill (`killed == true`), block — bounded — until the code-server port stops accepting connections, then return. The wait bounds are package vars in `internal/daemon` (`codeServerPortFreeTimeout` = 5s, `codeServerPortFreePoll` = 200ms — the `stopGracePeriod`/`stopPollInterval` test-seam idiom). Expiry is non-fatal: the function returns normally and the caller's externally-managed classification fires exactly as today. An unresolvable code-server port (0) MUST skip the wait entirely. `killed == false` (no session existed) MUST never wait.

- **GIVEN** an `rk-code-server` session exists and its port is bound by the dying process
- **WHEN** `KillCodeServerSession()` is called
- **THEN** it returns `(true, nil)` only after the port stops accepting connections (or the 5s budget expires)

- **GIVEN** no `rk-code-server` session exists
- **WHEN** `KillCodeServerSession()` is called
- **THEN** it returns `(false, nil)` immediately without probing the port

#### R2: KillServer waits for port release, conditionally
`daemon.KillServer` MUST probe `rk-code-server` session existence BEFORE the kill; after a successful kill it MUST run the same bounded port-free wait as R1 — but ONLY when the session existed pre-kill. When the session never existed, a busy code-server port belongs to a genuinely externally managed instance that will not release it, and no wait runs. Dead-server tolerance (`tmux.IsServerGone` ⇒ nil) is unchanged; the gone-server path performs no wait.

- **GIVEN** the rk-daemon tmux server is up with an `rk-code-server` sibling session
- **WHEN** `KillServer()` is called
- **THEN** it returns nil only after the code-server port is free (or the budget expires)

- **GIVEN** the rk-daemon server is up but no `rk-code-server` session exists (externally managed editor on the port)
- **WHEN** `KillServer()` is called
- **THEN** it returns without any port wait

#### R3: The CLI-side wait is deleted
`cmd/rk/code_server.go` MUST no longer contain `waitForCodeServerPortFree` or its seams (`codeServerPortFreeTimeout`, `codeServerPortFreePoll`, `codeServerPortBusyFn`). The `respawnCodeServerSession` kill→start sequence MUST rely on the now-synchronous `KillCodeServerSession` (via `codeServerKillFn`) with no explicit wait between kill and start. The race-window behavior tests (wait-then-start, budget-expiry fall-through, no-session-no-wait) move to `internal/daemon` against the kill primitive.

- **GIVEN** `rk code-server update` respawns a killed session
- **WHEN** the kill returns
- **THEN** the port is already free (or the budget expired) and `codeServerStartFn` runs immediately with today's outcome classification unchanged

### Daemon: One restart sequencer

#### R4: daemon.Restart(RestartOptions) owns the sequencing
`internal/daemon` MUST export `Restart(opts RestartOptions) error` with `RestartOptions{Force bool, Full bool, Binary string}`, sequencing in this exact order:
1. **Full guard**: when `opts.Full`, refuse if invoked from inside the rk-daemon server (`insideDaemonServer` moves from `cmd/rk/daemon_restart.go` into `internal/daemon`, reading `tmux.OriginalTMUX` through a package-var seam).
2. `Stop()` when `IsRunning()`.
3. When `opts.Full`: `KillServer()` (release-synchronous per R2).
4. When `opts.Force`: port-owner lookup + graceful-then-forceful termination of a non-daemon holder — same semantics as today's restart `--force` block: lookup errors are surfaced (not swallowed), and a holder identified as the daemon itself (`InnerServePID` match) is never signaled.
5. `Start()`, or `StartWithBinary(opts.Binary)` when `opts.Binary` is non-empty.

The niladic `Restart()` and `RestartWithBinary(path)` MUST be folded into the options form (no compatibility wrappers; only module-internal callers exist).

- **GIVEN** a running daemon and `RestartOptions{Full: true}`
- **WHEN** `Restart(opts)` is called from a pane inside the rk-daemon server
- **THEN** it returns the refusal error before stopping anything

- **GIVEN** a running daemon and `RestartOptions{Full: true, Force: true}`
- **WHEN** `Restart(opts)` is called from outside the rk-daemon server
- **THEN** the observable order is stop → kill-server → port-owner force step → start

- **GIVEN** `RestartOptions{Binary: "/opt/homebrew/bin/run-kit"}`
- **WHEN** `Restart(opts)` is called
- **THEN** the start step resolves and launches that binary (the upgrade path)

#### R5: Callers become thin wrappers
`cmd/rk/daemon_restart.go`'s RunE MUST reduce to: parse flags, capture the up-tunnel set (only when `--full`, BEFORE calling), call `daemon.Restart(opts)`, print outcomes, run `reconnectRemotes` after. Remote reconnect stays in the CLI wrapper (`internal/remote` imports `internal/daemon` — cycle). `cmd/rk/upgrade.go`'s `restartDaemonFn` seam MUST route through the options form (`daemon.Restart(RestartOptions{Binary: path})`). `POST /api/restart` is untouched (it funnels into the CLI path via an rk-jobs window). CLI flag surface (`--force`, `--full`, help text semantics) is unchanged.

- **GIVEN** `rk daemon restart --full` with two registered remotes, one tunnel up
- **WHEN** the command runs
- **THEN** the up-tunnel set is captured before anything dies, `daemon.Restart` performs the restart, and only the previously-up remote is reconnected after

- **GIVEN** `rk update` completes a brew upgrade
- **WHEN** the daemon restart leg fires
- **THEN** it goes through `daemon.Restart(RestartOptions{Binary: brewBinPath})`

### Ports: Port-owner helpers move to internal/ports

#### R6: findPortOwner/terminateOwner/PortOwner live in internal/ports
`cmd/rk/daemon_portowner.go` (lookup via lsof/ss, `resolveCommand`, `terminateOwner`, `processAlive`, `PortOwner`) MUST move to `internal/ports` (which already owns lsof execution/parsing) with exported names (`FindPortOwner`, `TerminateOwner`, `PortOwner`), preserving behavior verbatim: lsof-then-ss fallback, `(nil, nil)` on no listener, hard error when a listener exists but the PID is unreadable, SIGTERM → 5s poll → SIGKILL escalation via `syscall.Kill`. Its tests move with it. `ownerIsDaemon` moves to `internal/daemon` as exported `OwnerIsDaemon(owner *ports.PortOwner) bool` (it needs `InnerServePID`), with a package-var seam for the PID lookup. The remaining CLI `--force`/status call sites (`daemon_start.go`, `daemon_stop.go`, `daemon_status.go`) import from the new locations through thin cmd-level seam vars so their tests keep stubbing at the cmd layer. `rk daemon start --force` start-catch-retry semantics are unchanged.

- **GIVEN** the move is complete
- **WHEN** `grep -r "findPortOwnerImpl\|terminateOwner(" app/backend/cmd/rk/` runs
- **THEN** no implementation remains in cmd — only seam-var references to `internal/ports`

- **GIVEN** `rk daemon stop --force` with a non-daemon port holder
- **WHEN** the command runs
- **THEN** behavior is identical to today (SIGTERM with escalation, same output lines)

### Non-Goals

- Identity-based externally-managed classification in `ensureCodeServerCore` (port-owner command inspection) — the kill-side wait is expected sufficient; explicitly out of scope per intake.
- Changing the ensure-path skip order or the `EnsureOutcome` surface.
- Changing `rk daemon start --force` semantics or the CLI flag surface of `rk daemon restart`.
- New supervisor/retry loops (Constitution VI — no supervisor manages tmux).

### Design Decisions

#### Kill primitives own the port-release invariant
**Decision**: The bounded port-free wait lives inside `KillCodeServerSession` and `KillServer` (`internal/daemon`), not at any call site.
**Why**: The hazard is created by the kill (tmux kill only SIGHUPs; node takes seconds to unbind) and suffered by the ensure path's port probe. Owning it at the source makes every present and future kill+ensure composition safe by construction — PR #648 recreated the race precisely because the invariant lived in one caller.
**Rejected**: Ensure-side wait (taxes genuinely externally-managed setups ~5s on every daemon start); per-call-site waits (the recurrence pattern this change exists to end).
*Introduced by*: 260818-gs6y-unify-daemon-restart-sequencing

#### One options-driven restart sequencer
**Decision**: `daemon.Restart(RestartOptions{Force, Full, Binary})` owns stop → kill-server → force-reclaim → start ordering and the `--full` inside-server guard; the CLI RunE and the upgrade seam become thin wrappers.
**Why**: Three sequencers each held a different subset of the invariants; the CLI re-implemented orchestration inline. A single state machine makes a forgotten invariant structurally impossible for new callers, and guard-in-primitive means no future caller can bypass it.
**Rejected**: Keeping niladic `Restart`/`RestartWithBinary` as deprecation wrappers (only module-internal callers exist — upgrade.go and tests); moving remote reconnect into the sequencer (import cycle: `internal/remote` imports `internal/daemon`).
*Introduced by*: 260818-gs6y-unify-daemon-restart-sequencing

#### Port-owner helpers as an untagged internal/ports file
**Decision**: Move `daemon_portowner.go` to `internal/ports/portowner.go` without build tags, preserving today's no-tag posture.
**Why**: `internal/daemon.Restart`'s force step (untagged) must reference these symbols on every platform the daemon package builds for; the release matrix is linux/darwin only and `cmd/rk` already uses `syscall.Kill` untagged, so no supported build regresses.
**Rejected**: `//go:build linux || darwin` + an `_other` stub (new surface the intake scoped out — this is a move, not a redesign; the collector's platform split exists for genuinely divergent implementations, not for this self-contained unix helper).
*Introduced by*: 260818-gs6y-unify-daemon-restart-sequencing

## Tasks

### Phase 2: Core Implementation

- [x] T001 In `app/backend/internal/daemon/codeserver.go`: add `codeServerPortFreeTimeout`/`codeServerPortFreePoll` vars and an internal `waitForCodeServerPortFree()` (port-0 skip, bounded poll via `portInUse`, probe behind a `codeServerPortBusy`-style seam var); make `KillCodeServerSession` call it after a successful kill (`killed == true` only) <!-- R1 -->
- [x] T002 In `app/backend/internal/daemon/daemon.go`: `KillServer` probes `rk-code-server` session existence before `tmux.KillServer`, and runs the R1 wait after a successful kill only when the session pre-existed (no wait on the `IsServerGone` ⇒ nil path) <!-- R2 -->
- [x] T003 Add `internal/daemon` tests for R1/R2: adapt the three race-window tests from `cmd/rk/code_server_test.go` (wait-then-return, budget-expiry non-fatal, no-session-no-wait) against `KillCodeServerSession`, plus KillServer's conditional-wait branches (sibling-existed vs never-existed), using shrunken wait vars <!-- R1 -->
- [x] T004 In `app/backend/cmd/rk/code_server.go`: delete `waitForCodeServerPortFree`, `codeServerPortFreeTimeout`, `codeServerPortFreePoll`, `codeServerPortBusyFn`; drop the `if killed { wait }` block in `respawnCodeServerSession`; remove the now-moved race-window tests and `shrinkPortFreeWait` from `cmd/rk/code_server_test.go`, keeping the respawn outcome-classification tests green <!-- R3 -->
- [x] T005 Move `app/backend/cmd/rk/daemon_portowner.go` → `app/backend/internal/ports/portowner.go` (package ports, exported `PortOwner`/`FindPortOwner`/`TerminateOwner`, behavior verbatim, no build tags); move its unit tests to `internal/ports`; add `daemon.OwnerIsDaemon(owner *ports.PortOwner) bool` in `internal/daemon` with an `innerServePIDFn` seam <!-- R6 -->
- [x] T006 Rewire the remaining cmd call sites: `daemon_start.go`, `daemon_stop.go`, `daemon_status.go` use cmd-level seam vars over `ports.FindPortOwner`/`ports.TerminateOwner`/`daemon.OwnerIsDaemon`; delete cmd's `ownerIsDaemon` + `innerServePIDFn`; update `cmd/rk/daemon_test.go` helpers (`withPortOwnerStub` et al.) to stub the new seams <!-- R6 -->
- [x] T007 In `app/backend/internal/daemon/daemon.go` (or a new `restart.go`): add `RestartOptions` + `Restart(opts)` with the 5-step sequencing from R4 (guard via moved `insideDaemonServer` + `originalTMUX` seam; force step via `ports.FindPortOwner`/`OwnerIsDaemon`/`ports.TerminateOwner` behind seam vars); fold/delete niladic `Restart` and `RestartWithBinary`; add sequencing tests (order assertions, guard-refusal, force self-recognition, binary path) migrated from `cmd/rk/daemon_restart_test.go` <!-- R4 -->

### Phase 3: Integration & Edge Cases

- [x] T008 Thin `app/backend/cmd/rk/daemon_restart.go`: RunE = flags → capture tunnels (`--full` only) → `daemon.Restart(opts)` → outcome prints → `reconnectRemotes`; replace the `daemonIsRunningFn`/`daemonStopFn`/`daemonStartFn`/`daemonKillServerFn`/`restartOriginalTMUXFn` seams with a single `daemonRestartFn = daemon.Restart`; move `insideDaemonServer` + its test out; keep tunnel-capture/reconnect/malformed-store CLI tests green against the new seam <!-- R5 -->
- [x] T009 Update `app/backend/cmd/rk/upgrade.go`: `restartDaemonFn` routes through `daemon.Restart(RestartOptions{Binary: path})` (keep the seam's `func(string) error` signature); adjust `upgrade_test.go` if the seam shape changed <!-- R5 -->
- [x] T010 Verification gates: `cd app/backend && go test ./...`, then `just build` <!-- R4 -->

## Execution Order

- T001 → T002 (KillServer reuses T001's wait) → T003 → T004
- T005 → T006; T005 also blocks T007 (force step imports ports)
- T007 blocks T008 and T009
- T010 last

## Acceptance

### Functional Completeness

- [x] A-001 R1: `KillCodeServerSession` blocks after a successful kill until the code-server port is free or the 5s budget expires; port-0 and killed==false paths never wait
- [x] A-002 R2: `KillServer` waits for the port only when `rk-code-server` existed pre-kill; the never-existed and dead-server paths return without waiting
- [x] A-003 R4: `daemon.Restart(RestartOptions)` exists with the exact guard → stop → kill-server → force → start ordering, and the niladic `Restart`/`RestartWithBinary` are gone
- [x] A-004 R5: `daemon_restart.go` RunE contains no sequencing (no direct Stop/KillServer/Start calls); tunnel capture and reconnect remain CLI-side
- [x] A-005 R6: `FindPortOwner`/`TerminateOwner`/`PortOwner` live in `internal/ports` with behavior verbatim; `OwnerIsDaemon` lives in `internal/daemon`

### Behavioral Correctness

- [x] A-006 R2: the reported bug's mechanism is closed — after `--full`'s kill-server, `Start()`'s `ensureCodeServer` cannot observe the dying instance's still-bound port (proven by the R2 conditional-wait test, not a live daemon restart)
- [x] A-007 R3: `rk code-server update`'s respawn behavior (wait-then-start, expiry fall-through to externally-managed, no-session-no-wait) is preserved with the wait now inside the kill
- [x] A-008 R5: `rk update`'s daemon restart leg still resolves the brew bin symlink path via `EvalSymlinks` inside the start step

### Removal Verification

- [x] A-009 R3: `waitForCodeServerPortFree` and its three seams are absent from `cmd/rk/code_server.go`; no dead references remain
- [x] A-010 R6: `cmd/rk/daemon_portowner.go` is deleted; no port-owner implementation code remains under `cmd/rk/`
- [x] A-011 R4: no caller anywhere invokes a niladic `daemon.Restart()` or `daemon.RestartWithBinary`

### Scenario Coverage

- [x] A-012 R4: sequencing tests cover plain, `--force`, `--full`, `--full --force`, guard refusal, and binary-path restart orders (migrated to `internal/daemon`)
- [x] A-013 R1: race-window tests (busy-then-free, never-frees, no-session) exist in `internal/daemon` with shrunken wait vars
- [x] A-014 R5: CLI tests still prove tunnel capture happens before the restart call and per-remote reconnect failures warn without failing the command

### Edge Cases & Error Handling

- [x] A-015 R4: force-step lookup errors are surfaced (not swallowed), and a holder matching `InnerServePID` is never signaled
- [x] A-016 R2: `KillServer` on an already-dead socket still returns nil (IsServerGone tolerance) with no wait

### Code Quality

- [x] A-017 Pattern consistency: new seams follow the package-var idiom (`stopGracePeriod`/`codeServerSpawn` style); moved code keeps `exec.CommandContext` + timeout discipline (Constitution I)
- [x] A-018 No unnecessary duplication: one port-free wait implementation (internal/daemon), one port-owner lookup (internal/ports), one restart sequencer
- [x] A-019 No comment narration: comments state invariants (why the wait is conditional, why reconnect stays CLI-side), not change provenance
- [x] A-020 Tests conform to the requirements, not to fixtures (Test Integrity constraint); no implementation bent to accommodate test scaffolding

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`
- Do NOT run `rk daemon restart --full` (or any daemon restart) on this machine to verify — the operator's live daemon and sibling sessions must not be touched; unit tests are the proof.

## Deletion Candidates

None — this change is itself the deletion: the CLI-side `waitForCodeServerPortFree` + seams, `cmd/rk/daemon_portowner.go`, `daemon.CodeServerPortInUse`, and the niladic `Restart`/`RestartWithBinary` were all removed in the diff (verified absent by grep), and every newly added symbol (`Restart`, `RestartOptions`, `ports.FindPortOwner`/`TerminateOwner`/`ResolveCommand`, `daemon.OwnerIsDaemon`) has live call sites.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | The moved portowner file carries no build tags (matching its current cmd/rk posture) rather than adopting the collector's `linux||darwin` split + `_other` stub | Release matrix is linux/darwin only; `internal/daemon`'s untagged force step must see the symbols; a stub is new surface the intake scoped out | S:70 R:85 A:85 D:70 |
| 2 | Confident | `OwnerIsDaemon` is exported from `internal/daemon` (not kept in cmd), and CLI call sites stub it via cmd-level seam vars | The sequencer's force step needs it internally; duplicating a predicate across layers is the anti-pattern this change removes; cmd tests keep their stubbing layer | S:65 R:80 A:85 D:75 |
| 3 | Confident | The CLI restart seams collapse to a single `daemonRestartFn`; order-sequencing tests migrate to `internal/daemon` where the sequencing now lives | Testing sequencing through the CLI would re-couple the layers the change decouples; CLI tests keep what stays CLI-owned (tunnels, reconnect, output) | S:60 R:85 A:85 D:80 |
| 4 | Confident | `upgrade.go`'s `restartDaemonFn` keeps its `func(string) error` shape, wrapping `daemon.Restart(RestartOptions{Binary: path})` | Intake explicitly allows "wrapped to preserve the seam signature"; smallest diff in upgrade.go and its tests | S:60 R:90 A:85 D:70 |
| 5 | Certain | No live-daemon manual verification on this host; unit tests carry A-006 | Restarting the operator box's daemon kills live sibling sessions (documented death vectors); the mechanism is fully provable via the conditional-wait seams | S:85 R:60 A:90 D:90 |
| 6 | Confident | `daemon.CodeServerPortInUse` is deleted rather than kept as unused exported surface | It existed solely for the CLI respawn wait ("exported for the CLI's respawn wait" per its own doc); the wait now lives in-package and probes `portInUse` directly — keeping it would be dead API | S:65 R:80 A:80 D:75 |
| 7 | Confident | `resolveCommand` is exported as `ports.ResolveCommand` (beyond R6's named trio) | `cmd/rk/agent_hook.go`'s `processCommImpl` already reuses it cross-concern; the move must not sever that reuse, and an unexported symbol would force a duplicate implementation | S:60 R:75 A:85 D:70 |
| 8 | Confident | The restart CLI drops the intermediate progress prints ("Restarting run-kit daemon...", "Killed the rk-daemon tmux server...") and keeps only the final "run-kit daemon started" outcome line | Those prints keyed on per-step outcomes (IsRunning, KillServer) that now live inside `daemon.Restart`; re-deriving them CLI-side would require a richer return surface the plan does not specify — R5's "print outcomes" is satisfied by the start outcome + reconnect lines | S:55 R:80 A:75 D:60 |
| 9 | Confident | cmd's `innerServePIDFn` seam survives but moves to `daemon_status.go`; start/stop stub `ownerIsDaemonFn` instead | `daemon status` still needs the raw PID for its report/held-by-daemon classification (not covered by `OwnerIsDaemon`); the `--force` refusal tests pin the predicate, not the PID lookup | S:60 R:80 A:80 D:70 |

9 assumptions (1 certain, 8 confident, 0 tentative).
