# Plan: Scope the Daemon Socket Reap to the Daemon Session

**Change**: 260813-b41g-scope-daemon-socket-reap
**Intake**: `intake.md`

## Requirements

### Daemon Lifecycle: Startup Socket Reap Scoping

#### R1: Session-scoped reap, never server-scoped
`reapStaleDaemonSocket` (`app/backend/internal/daemon/daemon.go`) MUST NOT invoke `kill-server`. It SHALL instead issue an exact-match `kill-session` for each daemon session name — `SessionName` (`rk-daemon`) then `LegacySessionName` (`rk`), mirroring `runningSessionCtx`'s dual probe — as `runTmux(ctx, "kill-session", "-t", "="+session)` (argv slices, Constitution I; the `=` prefix forces exact-match so `rk-jobs`, `rk-code-server`, `rk-remotes`, and `_rk-ctl` can never be prefix-matched).

- **GIVEN** a live rk-daemon tmux server hosting sibling sessions (`rk-jobs`, `rk-code-server`, `rk-remotes`) and no `rk-daemon` session
- **WHEN** `Start()`/`StartWithBinary()` runs the reap on its way to `startSession`
- **THEN** every sibling session survives, and only a leftover `=rk-daemon`/`=rk` session (if any) is killed

#### R2: Best-effort posture preserved
The reap SHALL keep today's best-effort contract: each `kill-session` error (`can't find session`, `no server running on …`) is suppressed to `slog.Debug` and MUST never block startup. Call sites in `Start()`/`StartWithBinary()` are unchanged (same placement after the port guard, same `cmdTimeout`-bounded context).

- **GIVEN** a cold start with no tmux server on the `rk-daemon` socket
- **WHEN** the reap runs
- **THEN** both kill-session attempts error, both errors are Debug-logged, and `startSession` proceeds normally

#### R3: Audit line follows the op
The pre-kill teardown audit WARN SHALL reflect the new operation: `op=kill-session`, `target=<session>`, `callers=daemon.reapStaleDaemonSocket` — the same shape as `daemon.Stop(timeout)`'s existing kill-session audit (`daemon.go:419`). One WARN per session attempt, fired unconditionally (existing audit convention — no liveness gating).

- **GIVEN** the reap runs (live or dead socket)
- **WHEN** each kill-session is attempted
- **THEN** a `tmux teardown` WARN with `op=kill-session` and the session name as `target` precedes it

#### R4: Doc comment rewritten
`reapStaleDaemonSocket`'s doc comment SHALL be rewritten to state: (a) it is a race-window safety net — it runs only after `IsRunning()` returned false; (b) it kills only the exact-match daemon session(s), never the server, because the socket hosts sibling sessions (`rk-jobs`, `rk-code-server`, `rk-remotes`); (c) the historical `kill-server` destroyed those siblings on every restart — the 260813 auto-update bug where the update job SIGHUPed itself and code-server never returned.

- **GIVEN** a reader of `daemon.go`
- **WHEN** they read the function's doc comment
- **THEN** it no longer claims "orphaned socket" cleanup and documents the sibling-session constraint

#### R5: Tests prove the scoping
`internal/daemon` scratch-socket tests SHALL cover: sibling sessions survive the reap while stale `=rk-daemon` and legacy `=rk` sessions are killed; and the dead-socket no-op path stays silent (existing `TestReapStaleDaemonSocket_NoOp`, comment updated for the new op).

- **GIVEN** a scratch tmux socket (the `useTestSocket`/`withServerSocket` seams) hosting sessions named `rk-jobs`, `rk-code-server`, a prefix-collision `rk-daemon-x`, plus stale `rk-daemon` and `rk` sessions
- **WHEN** `reapStaleDaemonSocket(ctx)` runs
- **THEN** `rk-jobs`, `rk-code-server`, and `rk-daemon-x` still exist AND `rk-daemon` and `rk` are gone

### Non-Goals

- `Stop()` — already exact-match session-scoped and correct; untouched.
- No `list-sessions` probing before the kill (rejected option 2 — more machinery for the same coverage).
- No deletion of `reapStaleDaemonSocket` (rejected — the user chose the scoped safety net).
- No changes to `startSession`/`ensureCodeServer` ordering, `jobs.go`, or `codeserver.go`.

### Design Decisions

#### Scoped kill-session over kill-server
**Decision**: Replace the reap's `kill-server` with exact-match `kill-session` on `=rk-daemon` and `=rk`.
**Why**: The `rk-daemon` socket is now multi-tenant (`rk-jobs`, `rk-code-server`, `rk-remotes`); `kill-server`'s only live-fire case is a server alive with siblings but no daemon session — exactly the restart-via-job path, where it SIGHUPs the running update job and destroys code-server/tunnels. A session-scoped kill removes the collateral while keeping the race-window cleanup.
**Rejected**: (a) probing `list-sessions` and only `kill-server` at zero sessions — more machinery for the same coverage (a zero-session tmux server exits on its own); (b) deleting the reap entirely — user explicitly chose the scoped safety net.
*Introduced by*: 260813-b41g-scope-daemon-socket-reap

## Tasks

### Phase 2: Core Implementation

- [x] T001 Rewrite `reapStaleDaemonSocket` in `app/backend/internal/daemon/daemon.go`: loop `[]string{SessionName, LegacySessionName}`; per session emit the audit WARN (`op=kill-session`, `target=<session>`, `callers=daemon.reapStaleDaemonSocket`) then `runTmux(ctx, "kill-session", "-t", "="+session)` with the error suppressed to `slog.Debug` (include the session in the Debug attrs); rewrite the doc comment per R4. Call sites unchanged. <!-- R1, R2, R3, R4 -->

### Phase 3: Integration & Edge Cases

- [x] T002 Add `TestReapStaleDaemonSocket_SparesSiblings` to `app/backend/internal/daemon/daemon_test.go`: scratch socket via `useTestSocket`/`withServerSocket`; create detached sessions `rk-jobs`, `rk-code-server`, `rk-daemon-x`, `rk-daemon`, and `rk` on the test socket; run `reapStaleDaemonSocket(ctx)`; assert the three non-daemon sessions still exist and `rk-daemon`/`rk` are gone (exact-match `has-session -t =<name>` probes). <!-- R1, R5 -->
- [x] T003 Update `TestReapStaleDaemonSocket_NoOp`'s doc comment in `daemon_test.go` (kill-server → per-session kill-session; the "no server running" suppression claim stays true) and confirm the test still passes unchanged. <!-- R2, R5 -->
- [x] T004 Run verification gates: `cd app/backend && go test ./internal/daemon/...` then `go test ./...` and `just build`. <!-- R5 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: `reapStaleDaemonSocket` contains no `kill-server` invocation; it issues exact-match `kill-session -t "=rk-daemon"` and `kill-session -t "=rk"` via argv-slice `runTmux`.
- [x] A-002 R4: The doc comment documents the race-window safety net, the multi-tenant socket constraint, and the historical kill-server bug — no stale "orphaned socket" rationale.

### Behavioral Correctness

- [x] A-003 R1: With sibling sessions present on the socket, the reap kills only the daemon session(s) — proven by `TestReapStaleDaemonSocket_SparesSiblings`.
- [x] A-004 R2: On a dead socket the reap stays a silent no-op (errors Debug-suppressed, startup unblocked) — `TestReapStaleDaemonSocket_NoOp` passes.
- [x] A-005 R3: Each kill-session attempt is preceded by a `tmux teardown` WARN with `op=kill-session` and the session name as `target`, matching the `Stop(timeout)` audit shape.

### Scenario Coverage

- [x] A-006 R5: `go test ./internal/daemon/...` passes, including both reap tests.

### Code Quality

- [x] A-007 Pattern consistency: the rewrite follows the file's existing idioms (audit-WARN-then-runTmux, Debug-suppressed best-effort errors, `=`-anchored targets, cmdTimeout contexts).
- [x] A-008 No unnecessary duplication: reuses `SessionName`/`LegacySessionName` constants and the existing `runTmux` helper — no new helpers, no inline tmux command construction outside `internal/daemon`.

### Security

- [x] A-009 R1: All subprocess calls remain `exec.CommandContext` argv slices through `runTmux` (Constitution I) — no shell strings introduced.

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

None — this change modifies `reapStaleDaemonSocket` in place (kill-server → per-session kill-session) and orphans no existing symbol, helper, branch, or config.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Reap order `SessionName` then `LegacySessionName`, mirroring `runningSessionCtx` | Existing in-file precedent; order is behaviorally irrelevant (both are exact-match best-effort kills) | S:85 R:95 A:95 D:90 |
| 2 | Confident | Two unconditional audit WARN lines per reap (one per session name), even on cold start | Intake assumption 6 keeps the WARN unconditional; per-session emission matches the per-attempt audit convention at `Stop(timeout)` | S:60 R:90 A:80 D:70 |
| 3 | Confident | Sibling-survival test calls `reapStaleDaemonSocket` directly rather than full `Start()` | Direct call is the existing test's pattern (`TestReapStaleDaemonSocket_NoOp`) and avoids `Start()`'s port-guard env scaffolding; the call-site placement is unchanged by this change | S:65 R:90 A:85 D:75 |

3 assumptions (1 certain, 2 confident).
