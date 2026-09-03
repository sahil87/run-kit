# Plan: Daemon Stop Graceful Shutdown

**Change**: 260901-phip-daemon-stop-graceful-shutdown
**Intake**: `intake.md`

## Requirements

### Daemon Lifecycle: Graceful-Stop Delivery

#### R1: Signal-first graceful delivery
`Stop()` MUST deliver the graceful interrupt by sending SIGINT directly to the inner serve process (tmux `pane_pid` of the resolved daemon session's `serve` window) as the primary mechanism, before any tmux key dispatch. On successful signal delivery, `Stop()` SHALL skip the tmux `copy-mode -q` / `send-keys C-c` path entirely and proceed to the existing grace-wait loop.

- **GIVEN** a running daemon session whose inner process honors SIGINT
- **WHEN** `Stop()` is called
- **THEN** the process receives SIGINT and exits, the session vanishes, and `Stop()` returns nil well before the grace deadline (within a few poll intervals)
- **AND** no `send-keys` is attempted

#### R2: Fallback ladder preserved
When PID resolution fails or the signal send fails, `Stop()` MUST fall back to the current tmux path (`copy-mode -q` pre-cancel, then `send-keys … C-c`, both best-effort), and from there to the unchanged grace-timeout → `kill-session` fallback. Entering the tmux fallback MUST log at `slog.Warn` naming the reason (the current Debug-only visibility is what hid this bug).

- **GIVEN** a running daemon session where the inner PID cannot be resolved (or the kill syscall errors)
- **WHEN** `Stop()` is called
- **THEN** a Warn log records the fallback, the tmux C-c path is attempted, and the grace/kill machinery still guarantees the session ends
- **AND** `Stop()` never early-returns on a graceful-delivery failure (both delivery mechanisms are best-effort)

#### R3: Session-parameterized PID lookup
The inner-serve PID lookup MUST be parameterized by session name so `Stop()` can signal a legacy-named daemon (`LegacySessionName` "rk"). `InnerServePID()` keeps its current signature and semantics (current session only) for its existing consumers (`OwnerIsDaemon`, `cmd/rk/daemon_status.go`).

- **GIVEN** a daemon running under the legacy session name `rk`
- **WHEN** `Stop()` is called
- **THEN** the PID lookup targets `=rk:=serve` and SIGINT reaches that session's process

#### R4: Grace/kill machinery unchanged
The independent grace-deadline timer, per-command fresh-context discipline, poll loop, vanished-session success semantics, and `kill-session` fallback MUST remain byte-identical in behavior. Existing tests for the timeout/kill and send-failure branches SHALL pass without modification of their assertions.

- **GIVEN** a session whose process ignores SIGINT and C-c
- **WHEN** `Stop()` is called
- **THEN** the grace period elapses and `kill-session` removes it, exactly as today

#### R5: Root-cause diagnosis recorded
The change MUST attempt a live reproduction of the reported rejection — an isolated tmux socket with a read-only control client attached (`tmux -CC attach-session -t =<session> -r` via a PTY, the `tmuxctl.productionDial` shape) — and record the confirmed or eliminated mechanism in this plan's Design Decisions. The reproduction setup SHALL be kept as a regression test proving `Stop()` succeeds quickly with the read-only `-CC` client attached and the pane in copy-mode.

- **GIVEN** a test session with a read-only `-CC` control client attached and its pane in copy-mode
- **WHEN** `Stop()` is called
- **THEN** the session stops via the signal path well before the grace deadline

### Non-Goals

- No change to `Restart()` sequencing, `KillServer()`, the CLI surface, or `POST /api/restart` — they inherit the faster stop for free.
- No constitution edit (the "sends `C-c`" wording flag is human-owned — see intake).
- No change to the read-only `-r` posture of the tmuxctl control bridge (deliberate safety property).

### Design Decisions

#### Signal-first delivery via pane_pid
**Decision**: Deliver the graceful interrupt as `syscall.Kill(pane_pid, SIGINT)` — the daemon pane runs the serve binary directly (`startSession` passes `exe serve` to `new-session`, no shell wrapper), so `pane_pid` is the serve process itself.
**Why**: SIGINT is exactly what a delivered C-c produces via the tty; signaling the PID bypasses tmux key dispatch entirely, so the read-only control-bridge rejection cannot occur regardless of which dispatch path triggers it.
**Rejected**: Fixing the tmux key-dispatch path itself (detaching the bridge around stops, or deeper mode pre-cancels) — it has already failed once (#360's pre-cancel), depends on tmux-version dispatch internals, and dropping the bridge's read-only `-r` flag would trade a stop-latency bug for a safety regression.
*Introduced by*: 260901-phip-daemon-stop-graceful-shutdown

#### Diagnosis finding: the read-only rejection is not mode-scoped on tmux ≥3.7
**Decision**: Treat key-based delivery as non-viable whenever a read-only client is attached, not merely when the pane is in a mode — confirmed live (T001) on tmux 3.7c with a PTY-attached `tmux -CC attach-session -r` client: `send-keys … C-c` exits 1 with `client is read-only` both in copy-mode (`pane_in_mode=1`) and after `copy-mode -q` (`pane_in_mode=0`), while `kill -INT <pane_pid>` ends the session immediately in the same state.
**Why**: This eliminates the #360 copy-mode-only theory as the full mechanism (it held on tmux 3.6a) and explains the "always fails" symptom: tmux 3.7 resolves the read-only bridge as the target client for `send-keys` itself and rejects the command outright.
**Rejected**: Version-gating the fix to tmux ≥3.7 — signal-first is strictly more robust on every version and needs no version probe.
*Introduced by*: 260901-phip-daemon-stop-graceful-shutdown

#### Keep the tmux C-c path as fallback
**Decision**: On PID-resolution or signal failure, fall back to the existing `copy-mode -q` + `send-keys C-c` sequence before the grace/kill fallback.
**Why**: Cheap, preserves today's behavior as the degradation path, and covers a pane where the PID query fails.
**Rejected**: Deleting the tmux path — narrows the delivery ladder for no gain.
*Introduced by*: 260901-phip-daemon-stop-graceful-shutdown

## Tasks

### Phase 2: Core Implementation

- [x] T001 Diagnosis/reproduction: on an isolated tmux socket, attach a read-only `-CC` control client via PTY (creack/pty, mirroring `internal/tmuxctl/client.go` productionDial), drive the pane into copy-mode, run the current C-c send, and capture the exact failing command + stderr; record confirmed/eliminated mechanism in this plan's Design Decisions <!-- R5 -->
- [x] T002 Generalize PID lookup in `app/backend/internal/daemon/daemon.go`: extract `innerServePIDFor(session string)` (session-parameterized, `targetFor(session)` target), re-express `InnerServePID()` over it, and add the signal seam (`var` func over `syscall.Kill(pid, syscall.SIGINT)`) <!-- R3 -->
- [x] T003 Rewrite `Stop()` graceful delivery in `app/backend/internal/daemon/daemon.go`: signal-first via the new seams; on PID/signal failure log `slog.Warn` and fall back to the existing `copy-mode -q` + `send-keys C-c` sequence; grace/poll/kill loop untouched <!-- R1 -->

### Phase 3: Integration & Edge Cases

- [x] T004 Tests in `app/backend/internal/daemon/daemon_test.go`: signal-first quick stop (int-honoring fixture, elapsed ≪ grace, no send-keys dependence), PID-failure fallback (stubbed lookup seam → tmux path still stops gracefully), signal-failure fallback (stubbed kill seam), legacy `rk` session signal targeting <!-- R2 -->
- [x] T005 Regression test for the reported bug: session with a read-only `-CC` control client attached (PTY) and pane in copy-mode → `Stop()` returns quickly via the signal path; assert elapsed well under grace (the pre-fix behavior burned the full grace) <!-- R5 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: `Stop()` resolves the inner serve PID and sends SIGINT before any tmux key dispatch; on success no `send-keys` runs
- [x] A-002 R3: PID lookup is session-parameterized; `InnerServePID()` public contract unchanged for `OwnerIsDaemon`/`daemon_status.go`

### Behavioral Correctness

- [x] A-003 R1: A SIGINT-honoring daemon stops within a few poll intervals — `Stop()` returns nil well before the grace deadline (test asserts elapsed bound)
- [x] A-004 R2: PID-resolution failure and signal failure each degrade to the tmux C-c path with a Warn log, then to grace/kill — no early return

### Scenario Coverage

- [x] A-005 R3: Legacy `rk`-named session stops gracefully via the signal path (test)
- [x] A-006 R5: With a read-only `-CC` client attached and the pane in copy-mode, `Stop()` stops the session quickly (regression test for the reported always-degrade bug)

### Edge Cases & Error Handling

- [x] A-007 R4: SIGINT-ignoring session still killed after grace; existing timeout/kill and send-failure fall-through tests pass with unchanged assertions

### Code Quality

- [x] A-008 Pattern consistency: new seams follow the established `var`-func seam idiom (`innerServePIDFn`, `stopGracePeriod`); comments state constraints, not narration
- [x] A-009 No unnecessary duplication: PID lookup reuses `runTmuxOutput`/`targetFor`; no inline tmux command construction outside `runTmux*`
- [x] A-010 Subprocess discipline: all tmux calls remain `exec.CommandContext` with `cmdTimeout` via `runTmux*`; the signal path introduces no subprocess
- [x] A-011 Tests cover the added/changed behavior (code-quality mandate); `cd app/backend && go test ./...` green

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- `app/backend/internal/daemon/daemon.go:63 target()` — its last production call site (`InnerServePID`) now routes through `innerServePIDFor`/`targetFor`; the symbol survives only for `TestTarget` (`daemon_test.go:92`) and could be inlined away

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | SIGINT (not SIGTERM) is the graceful signal | Matches C-c tty semantics and the serve interrupt handler contract documented in memory; keeps the constitution's "graceful interrupt" meaning | S:70 R:85 A:80 D:70 |
| 2 | Certain | `syscall.Kill` (unix-only) is acceptable — no build-tag split | The daemon is tmux-hosted; the whole package is de-facto unix-only already | S:75 R:90 A:90 D:85 |
| 3 | Confident | Signal the pane_pid only, not its process group | `startSession` runs the binary directly so pane_pid IS serve; group signaling adds risk (tmux's own group membership) for no need | S:65 R:80 A:80 D:65 |
| 4 | Confident | Warn fires on fallback entry (signal path unavailable/failed); the pre-cancel's own failure stays Debug | Intake asks for fallback-taken visibility; per-command noise below that remains diagnostic | S:60 R:90 A:75 D:70 |

4 assumptions (1 certain, 3 confident, 0 tentative).
