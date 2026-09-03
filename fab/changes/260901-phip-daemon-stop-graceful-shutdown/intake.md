# Intake: Daemon Stop Graceful Shutdown

**Change**: 260901-phip-daemon-stop-graceful-shutdown
**Created**: 2026-09-01

## Origin

One-shot `/fab-new` invocation:

> rk daemon stop: graceful C-c shutdown path always fails with 'client is read-only' and falls through to the full grace-timeout + force-kill fallback, so daemon stop never exits quickly via graceful shutdown. See app/backend/internal/daemon/daemon.go Stop() around the C-c send-keys call (~line 445) and its surrounding comments explaining the read-only control-bridge client issue. Fix the C-c delivery so graceful shutdown actually succeeds instead of always degrading to the kill fallback.

Pre-intake code investigation (this session) established the concrete facts recorded under What Changes. No prior conversational design discussion existed; the fix direction below is agent-derived and graded in Assumptions.

## Why

1. **The pain point**: `daemon.Stop()` (`app/backend/internal/daemon/daemon.go:429`) is documented as "C-c → wait grace → kill", but the graceful leg reportedly never works: the C-c delivery is rejected with tmux's `client is read-only` error, so every stop waits out the full `stopGracePeriod` (12s) and then force-kills the session. PR #546f6f52 (#360, "Daemon Stop — Copy-Mode Read-Only Fix") added a `copy-mode -q` pre-cancel to fix the known copy-mode wedge, yet the symptom persists — the graceful path still always degrades.

2. **The consequence if unfixed**:
   - The inner `rk serve` never gets its graceful shutdown (supervisor stop + `server.Shutdown`, ~10s budget in `cmd/rk/serve.go`) — `kill-session` SIGHUPs it instead. In-flight HTTP/SSE/WebSocket teardown and supervisor cleanup are skipped on every stop.
   - Every consumer layered on `Stop()` eats the full 12s grace burn: `rk daemon stop`, `rk daemon restart`, `rk update`'s auto-restart (`Restart(RestartOptions{Binary: …})`), and `POST /api/restart`. A healthy daemon that would exit in ~1s takes >12s to stop, always.

3. **Why this approach**: the tmux key-dispatch path has now failed twice (the original wedge, then the residue after #360's pre-cancel). The daemon pane runs the serve binary **directly** — `startSession` passes `exe serve` as the `new-session` command with no shell wrapper (`daemon.go:373-377`) — so tmux's `pane_pid` *is* the serve process, and `InnerServePID()` (`daemon.go:519`) already derives it. Delivering SIGINT straight to that PID is exactly what a terminal C-c does (tty ISIG → SIGINT), but bypasses tmux key dispatch — and therefore the read-only `-CC` control-bridge client rejection — entirely. It also stays inside the documented "graceful interrupt → grace wait → kill" contract; only the delivery mechanism changes.

## What Changes

### 1. Root-cause diagnosis (first task, feeds the rest)

Reproduce against a live daemon and capture **which tmux command fails and with what exact stderr**. The in-code comment (`daemon.go:439-453`) explains the *copy-mode* rejection path: a pane in a mode dispatches C-c through the mode key table, and that dispatch resolves against the session's only attached client — run-kit's own read-only `-CC` control bridge (`tmuxctl.productionDial` attaches with `-CC attach-session -t =<bootstrap> -r`, `internal/tmuxctl/client.go:426`) — which tmux rejects with `client is read-only`. The `copy-mode -q` pre-cancel was verified idempotent on tmux 3.6a, yet the failure reportedly persists on every stop. Candidate explanations to confirm or eliminate:

- the pane sits in a mode other than copy-mode, or re-enters a mode between the pre-cancel and the send;
- the `copy-mode -q` pre-cancel itself fails (it is only `slog.Debug`-logged, so a persistent failure is invisible at default log level);
- tmux resolves the one-shot `send-keys` command's target client to the read-only bridge under some condition unrelated to modes (version-dependent dispatch behavior);
- the rejection happens on a different command in the sequence than assumed.

The diagnosis outcome is recorded in the plan/memory; the fix below is robust to *any* of these because it stops depending on tmux key dispatch for the primary path.

### 2. Signal-first graceful delivery in `Stop()`

Replace the primary graceful-delivery mechanism in `Stop()` (`daemon.go:429-511`):

1. Resolve the inner serve PID via the existing `innerServePIDFn` seam (`daemon.go:540`), generalized or paralleled to accept the resolved session (Stop targets `targetFor(session)` so the legacy `rk` session name keeps working — today `InnerServePID()` hard-codes `target()`).
2. Send SIGINT directly: `syscall.Kill(pid, syscall.SIGINT)` (behind a test seam). The serve process's existing signal handling (`cmd/rk/serve.go` interrupt handling) takes over — identical semantics to a delivered C-c.
3. Only when PID resolution or the kill fails, fall back to the current tmux path: `copy-mode -q` pre-cancel + `send-keys … C-c`, best-effort, `slog.Warn` on failure — exactly today's behavior.
4. The grace-timer → poll → `kill-session` fallback (`daemon.go:477-510`) is untouched. The poll loop already returns as soon as the session vanishes (`stopPollInterval` 200ms), so a working graceful delivery makes `Stop()` exit in ~1-2s with no further changes.

Elevate the visibility of graceful-delivery failure: the fallback-taken path should log at Warn (the pre-cancel's current Debug hides the persistent failure this change exists to fix).

### 3. Tests

Per `fab/project/code-quality.md`, the changed behavior needs tests in `internal/daemon`:

- signal-first path: with a stubbed PID seam and a stubbed kill seam, `Stop()` sends SIGINT and does not touch send-keys when the signal succeeds;
- fallback path: PID resolution failure falls through to the tmux send-keys path, then the existing grace/kill machinery (existing tests for the grace/kill branch keep passing — `stopGracePeriod`/`stopPollInterval`/`serverSocket` test seams are already in place);
- legacy-session targeting: PID lookup uses the resolved session name, not just `SessionName`.

An integration-style verification against a real tmux socket (mirroring the existing socket-seam tests) proves a live `rk serve` exits within a couple of poll intervals on `Stop()`.

### 4. Documentation

- `docs/memory/run-kit/architecture.md` § Daemon Lifecycle documents the full `Stop()` sequence in three places (the `internal/daemon` row, the `rk daemon stop`/`restart` CLI rows, and the dedicated **`Stop()` sequence** block) — all rewritten to the signal-first sequence at hydrate.
- The constitution's **Self-Improvement Safety** section says restart "sends `C-c` to the daemon tmux pane". This change treats that as describing the graceful-interrupt contract (interrupt → grace wait → kill), not binding the keystroke mechanism; the wording is flagged for human amendment rather than edited by the pipeline. <!-- assumed: constitution wording "sends C-c" read as the graceful-interrupt contract, not a binding delivery mechanism — amendment left to humans -->

## Affected Memory

- `run-kit/architecture`: (modify) Daemon Lifecycle — `Stop()` sequence becomes signal-first (SIGINT to `InnerServePID`) with the tmux C-c path demoted to fallback; the `internal/daemon` row, CLI `rk daemon stop`/`restart` rows, and the `Stop()` sequence block all describe the current C-c-first sequence and need rewriting.

## Impact

- `app/backend/internal/daemon/daemon.go` — `Stop()`, `InnerServePID()`/`innerServePIDFn` (session-parameterized lookup), a new kill seam. Primary edit site.
- `app/backend/internal/daemon/daemon_test.go` (and siblings) — new signal-path tests; existing grace/kill tests unchanged.
- No CLI surface change: `rk daemon stop|restart`, `rk update`, `POST /api/restart` keep their contracts and get faster/actually-graceful stops for free (`cmd/rk/daemon_stop.go`, `internal/daemon/restart.go` untouched unless diagnosis demands otherwise).
- `docs/memory/run-kit/architecture.md` at hydrate.
- Constitution wording flag (human-owned, no pipeline edit).

## Open Questions

- Should the constitution's Self-Improvement Safety wording ("sends `C-c` to the daemon tmux pane") be amended to "delivers a graceful interrupt (SIGINT)" once this lands? Human-owned; non-blocking for implementation.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Keep the documented "graceful interrupt → grace wait → kill-session" contract; only the graceful-delivery mechanism changes. Grace timer, poll loop, and kill fallback untouched. | The contract is documented in memory and constitution; the user asked to fix delivery, not redesign stop. | S:85 R:90 A:95 D:90 |
| 2 | Confident | Primary fix is signal-first delivery: SIGINT to the inner serve PID via the existing `InnerServePID`/`innerServePIDFn` seam (pane runs the binary directly, so `pane_pid` is the serve process). | Codebase gives a clear answer (helper exists, no shell wrapper); bypasses the read-only-client rejection regardless of which tmux dispatch path causes it; SIGINT ≡ what C-c produces. Root cause of the residual tmux failure not yet verified live, so not Certain. | S:70 R:75 A:80 D:65 |
| 3 | Confident | Keep the tmux `copy-mode -q` + `send-keys C-c` path as a fallback when PID resolution/kill fails, ahead of the grace/kill fallback. | Cheap, preserves today's behavior as the degradation path, and covers hosts where the PID query fails; removal would narrow the delivery ladder for no gain. | S:60 R:85 A:75 D:60 |
| 4 | Certain | Live diagnosis (which command fails, exact stderr) is the first task and its findings are recorded in plan + memory. | The user's "always fails" contradicts the in-code copy-mode-only theory; implementing without confirming risks repeating #360's partial fix. | S:80 R:90 A:85 D:85 |
| 5 | Tentative | Constitution "sends `C-c`" wording is read as the graceful-interrupt contract, not a binding keystroke mechanism; flagged for human amendment, not edited by this change. | Constitution interpretation is human territory; reading is plausible but not confirmed. Flagged in Open Questions. | S:45 R:70 A:35 D:40 |
| 6 | Certain | New behavior ships with `internal/daemon` tests via seams (PID lookup, signal send), mirroring the existing `serverSocket`/`stopGracePeriod` seam idiom. | code-quality.md mandates tests for changed behavior; the seam idiom is established in this file. | S:75 R:90 A:90 D:85 |

6 assumptions (3 certain, 2 confident, 1 tentative, 0 unresolved).
