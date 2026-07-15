# Plan: Daemon Stop — Copy-Mode Read-Only Fix

**Change**: 260715-3zwr-daemon-stop-copy-mode-readonly
**Intake**: `intake.md`

## Requirements

<!-- Derived from intake.md. Scope is deliberately narrow: two localized edits to
     internal/daemon/daemon.go Stop() plus two integration tests in daemon_test.go.
     No CLI/API/frontend surface changes. -->

### Daemon Stop: Copy-Mode Pre-Cancel

#### R1: Pre-cancel any pane mode before sending C-c
`Stop()` SHALL run `copy-mode -q -t targetFor(session)` against the resolved daemon session before the existing `send-keys ... C-c`, so a pane left in a tmux mode (e.g. copy-mode) is returned to normal mode before the interrupt is sent. The pre-cancel MUST go through the existing `runTmux` helper under its own fresh `cmdTimeout`-bounded context (matching `Stop()`'s established per-command-context pattern) and MUST target `targetFor(session)` using the session name `Stop()` already resolved via `runningSessionCtx` (so the legacy `rk`-named daemon path keeps working — never the `target()` constant form).

- **GIVEN** the daemon pane (`=<session>:=serve`) is in tmux copy-mode
- **WHEN** `Stop()` is invoked
- **THEN** `copy-mode -q` is run against the resolved session's window target first, exiting the mode
- **AND** the subsequent `send-keys C-c` reaches the serve process normally (SIGINT delivered), so graceful shutdown proceeds and the session is gone on completion

#### R2: Copy-mode pre-cancel is best-effort
A pre-cancel failure MUST NOT abort `Stop()`. On `copy-mode -q` error, `Stop()` SHALL log at `slog.Debug` and continue to the C-c send (and, on send failure, the grace/kill fall-through per R3). `copy-mode -q` is idempotent (exit 0 when the pane is not in a mode), so it is safe to run unconditionally on every `Stop()`.

- **GIVEN** `copy-mode -q` returns a non-zero error (e.g. transient tmux failure)
- **WHEN** `Stop()` runs the pre-cancel
- **THEN** the error is logged at `slog.Debug` and `Stop()` proceeds to the send-keys attempt rather than returning early

### Daemon Stop: Send-Keys Failure Fall-Through

#### R3: No early-return on send-keys failure — fall through to grace/kill
`Stop()` MUST NOT return early when `send-keys ... C-c` fails. It SHALL log the failure at `slog.Warn` (with the error) and fall through to the existing grace-timer → `kill-session` fallback loop, which is left unchanged. The full `stopGracePeriod` is still waited before the kill even when the send failed — no shortened-grace special case.

- **GIVEN** the `send-keys C-c` command returns a non-zero error (e.g. `client is read-only` dispatch rejection)
- **WHEN** `Stop()` handles the send failure
- **THEN** it logs a `slog.Warn` and does NOT return the send error
- **AND** it proceeds into the grace-timer/kill-session loop, which eventually kills the session and returns nil (the session is gone on completion)

### Non-Goals

- Direct SIGINT to `#{pane_pid}` — rejected in the intake (larger behavioral change to a load-bearing shutdown path); key-based C-c stays the primary graceful path.
- Shortened grace period on send-failure — the loop is kept untouched; full grace still applies.
- Any change to `Restart()` / `RestartWithBinary()` / `--force` / API / frontend — all route through `Stop()` unchanged.

### Design Decisions

1. **Pre-cancel via `copy-mode -q` before C-c**: run the mode-cancel through `runTmux` under a fresh `cmdTimeout` context, targeting `targetFor(session)`. — *Why*: a pane in a mode consumes C-c via the mode key table, and the mode binding (`copy-mode C-c` → `send-keys -X cancel`) dispatches through the read-only `-CC` bridge client, which tmux rejects with `client is read-only`; exiting the mode first lets the key reach the process. — *Rejected*: direct SIGINT to `pane_pid` (Non-Goals).
2. **Fall-through on send failure**: replace the early `return fmt.Errorf(...)` with a `slog.Warn` and continue to the grace/kill loop. — *Why*: the kill fallback is proven working (`TestStop_TimeoutStuckSessionIsKilled`) and was only unreachable; degrading to force-kill removes the wedge for any future graceful-delivery failure. — *Rejected*: keeping the early return (the compounding bug).

## Tasks

### Phase 2: Core Implementation

- [x] T001 In `app/backend/internal/daemon/daemon.go` `Stop()`, insert a `copy-mode -q -t targetFor(session)` pre-cancel via `runTmux` under a fresh `cmdTimeout` context, before the existing `send-keys ... C-c`; log at `slog.Debug` on failure and continue (best-effort). <!-- R1 --> <!-- R2 -->
- [x] T002 In `app/backend/internal/daemon/daemon.go` `Stop()`, replace the early `return fmt.Errorf("sending C-c to daemon: %w", err)` on send-keys failure with a `slog.Warn(..., "err", err)` fall-through so control reaches the unchanged grace-timer/kill-session loop. <!-- R3 -->

### Phase 3: Tests

- [x] T003 In `app/backend/internal/daemon/daemon_test.go`, add a copy-mode regression test: start a session on the isolated test socket, drive its pane into copy-mode via `tmux -L <testSocket> copy-mode -t <target>`, call `Stop()`, assert nil error and session gone. Follow the existing integration-test pattern (`useTestSocket` + `withServerSocket` + `withStopTiming` seams; `hasTmux`/`testing.Short` guards). <!-- R1 -->
- [x] T004 In `app/backend/internal/daemon/daemon_test.go`, add a send-failure fall-through test using a deterministic proxy: start the daemon session on the isolated test socket with its window named something OTHER than `serve` (e.g. `other`) so `send-keys -t =<session>:=serve` (and the `copy-mode -q` pre-cancel) fail with "can't find window: serve", while `has-session`/`kill-session -t =<session>` still resolve. With `withStopTiming(t, time.Nanosecond, time.Hour)` (tiny grace → immediate kill branch), assert `Stop()` does not return the send error and reaches the kill fallback (session gone, nil returned). Exact proxy mechanism recorded as a graded assumption. <!-- R3 --> <!-- R2 -->

### Phase 4: Verification

- [x] T005 Run `cd app/backend && go test ./internal/daemon/...` (scoped), then the package-affecting suite per code-quality gates; ensure all daemon tests pass and no production tmux server is touched (isolated test sockets only). <!-- R1 --> <!-- R3 -->

## Execution Order

- T001 and T002 both edit `Stop()` — apply sequentially in the same file (T001 first, then T002).
- T003 and T004 depend on T001+T002 being in place.
- T005 runs last.

## Acceptance

### Functional Completeness

- [x] A-001 R1: `Stop()` runs `copy-mode -q -t targetFor(session)` via `runTmux` under a fresh `cmdTimeout` context before the C-c send, targeting the resolved session (legacy `rk` name still handled).
- [x] A-002 R2: A `copy-mode -q` failure is logged at `slog.Debug` and does not abort `Stop()` (control proceeds to send-keys).
- [x] A-003 R3: `Stop()` no longer returns early on `send-keys C-c` failure; it logs `slog.Warn` and falls through to the existing grace-timer/kill-session loop.

### Behavioral Correctness

- [x] A-004 R1: From an in-copy-mode pane, `Stop()` succeeds gracefully — C-c reaches the serve process after the pre-cancel and the session is gone (copy-mode regression test).
- [x] A-005 R3: When the C-c send fails, `Stop()` still eventually succeeds via the kill fallback (session gone, nil returned) with the full grace period preserved (loop unchanged).

### Scenario Coverage

- [x] A-006 R1: Copy-mode regression test drives a pane into copy-mode on an isolated test socket and asserts `Stop()` returns nil with the session gone.
- [x] A-007 R3: Send-failure fall-through test forces a deterministic send-keys failure and asserts `Stop()` does not surface the send error and reaches the kill fallback.

### Edge Cases & Error Handling

- [x] A-008 R2: `copy-mode -q` is verified/relied-upon idempotent (exit 0 when not in a mode) and is run unconditionally without special-casing pane state.

### Code Quality

- [x] A-009 Pattern consistency: New code follows `Stop()`'s per-command fresh-`cmdTimeout`-context pattern, `runTmux` usage, and the file's high WHY-comment density.
- [x] A-010 No unnecessary duplication: Reuses `runTmux`, `targetFor`, and existing test seams (`useTestSocket`/`withServerSocket`/`withStopTiming`) rather than re-implementing.
- [x] A-011 Security (Constitution §I / Process Execution): The pre-cancel goes through `runTmux` (`exec.CommandContext` + argument slices + timeout) — no shell strings, no missing timeout.
- [x] A-012 Tests included: New/changed behavior is covered by Go tests colocated in `daemon_test.go` (code-quality: bug fixes MUST include tests).

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- `startOn` (app/backend/internal/daemon/daemon_test.go:109) — its body is now expressible as `startOnWithWindow(socket, session, WindowName)`; the new generalized helper repeats the same `new-session` invocation, leaving `startOn`'s inline body redundant. Optional: the file's established pattern is one self-documenting helper per fixture shape, so keeping both is also defensible.

No production code was made redundant — the fix adds a pre-cancel step and removes an early return without obsoleting any existing symbol, branch, or config.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Pre-cancel is `copy-mode -q -t targetFor(session)` via `runTmux` under a fresh `cmdTimeout` context, before the C-c send | Intake row 1 (Certain); chosen as primary in live diagnosis; `copy-mode -q` idempotency verified on tmux 3.6a; matches `Stop()`'s per-command-context pattern | S:90 R:85 A:90 D:90 |
| 2 | Certain | On send-keys failure, do NOT early-return — fall through to the existing grace-timer/kill-session loop (loop unchanged) | Intake row 2 (Certain); kill fallback is proven working (`TestStop_TimeoutStuckSessionIsKilled`), was only unreachable | S:90 R:85 A:90 D:90 |
| 3 | Confident | `copy-mode -q` failure is best-effort: log at `slog.Debug`, proceed to send-keys, never abort `Stop()` | Intake row 4 (Confident); forced by the fall-through principle — any pre-cancel failure is recovered by the now-reachable kill fallback | S:60 R:80 A:80 D:70 |
| 4 | Confident | Send-keys failure is logged at `slog.Warn` with the error when falling through | Intake row 5 (Confident); `Stop()` already `slog.Warn`s its teardown; a silent swallow would hide graceful-delivery regressions | S:55 R:85 A:80 D:75 |
| 5 | Confident | Full `stopGracePeriod` is still waited before kill even when the C-c send failed — no shortened-grace special case | Intake row 6 (Confident); intake says "fall through to the grace-timer/kill-session path" — simplest reading keeps the loop untouched | S:65 R:85 A:75 D:70 |
| 6 | Confident | Send-failure fall-through test uses a wrong-window-name proxy: the daemon session is started on the isolated test socket with its window named `other` (not `serve`), so `send-keys`/`copy-mode -q` to `=<session>:=serve` fail deterministically ("can't find window: serve") while `has-session`/`kill-session -t =<session>` still resolve; `withStopTiming(nanosecond grace)` forces the kill branch | Intake row 7 (Confident) leaves the exact mechanism as an apply-time decide-and-record. Chosen this over a dead-socket repoint because `serverSocket` is used by BOTH the initial `runningSessionCtx` lookup AND the kill — a dead socket would make the lookup return "" and `Stop()` no-op early. A wrong-window session on the live socket keeps lookup+kill working while failing only the window-targeted send; needs no attached `-CC -r` client and reuses existing seams. Verified on tmux 3.6a. | S:60 R:80 A:80 D:70 |

6 assumptions (2 certain, 4 confident, 0 tentative).
