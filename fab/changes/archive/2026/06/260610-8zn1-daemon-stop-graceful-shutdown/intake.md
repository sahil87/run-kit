# Intake: Fix daemon restart aborting on healthy graceful shutdown

**Change**: 260610-8zn1-daemon-stop-graceful-shutdown
**Created**: 2026-06-10
**Status**: Draft

## Origin

Surfaced from a `/fab-discuss` investigation of repeated `rk update` failures. The
user reported that recent `rk update` runs upgrade the binary successfully but the
daemon never restarts. Observed terminal output:

```
==> Upgraded 1 outdated package
sahil87/tap/rk 2.2.4 -> 2.2.5
Updated to v2.2.5.
Restarting rk daemon...
2026/06/10 08:32:17 WARN tmux teardown audit=kill op=kill-session server=rk-daemon target=rk-daemon callers=daemon.Stop(timeout)
Error: restarting daemon after upgrade: stopping daemon: killing daemon session after timeout: exit status 1: can't find session: rk-daemon
```

Interaction mode: conversational. We traced the full control flow
(`rk update` → `daemon.RestartWithBinary` → `daemon.Stop` → C-c → poll → timeout →
`kill-session` → fatal error → restart aborts) by reading the actual source rather
than accepting a first-pass "race condition / 5s too aggressive" hypothesis. The
real defect is a **structural timeout mismatch plus mis-classification of a clean
shutdown as a failure**, confirmed against `internal/daemon/daemon.go` and
`cmd/rk/serve.go`.

## Why

**The problem.** After `rk update`, the daemon does not come back up. `rk update`
calls `daemon.RestartWithBinary(brewBinPath)`, which calls `Stop()` and only proceeds
to `StartWithBinary()` if `Stop()` returns `nil`. `Stop()` is returning a non-nil
error on a shutdown that *actually succeeded*, so the restart aborts before the new
binary is ever launched. The user is left with no running daemon and must start it
manually.

**Root cause — two compounding bugs in `daemon.Stop()` (`app/backend/internal/daemon/daemon.go:298–335`):**

1. **Stop's timeout is smaller than the inner serve's own shutdown budget.** `Stop()`
   bounds the entire send-C-c-then-poll operation with a single 5s context
   (`cmdTimeout`, `daemon.go:304`). But the inner `rk serve` graceful shutdown runs
   two **sequential** bounded phases: supervisor stop (5s, `cmd/rk/serve.go:143`)
   *then* `server.Shutdown` (5s, `cmd/rk/serve.go:149`) — a worst case of ~10s. A
   healthy shutdown that drains control-mode connections and in-flight HTTP/SSE
   requests can legitimately exceed 5s, so `Stop()` wrongly concludes the daemon is
   hung and enters the timeout/kill branch on a perfectly healthy shutdown.

2. **`kill-session` "session not found" is treated as fatal.** By the time the kill
   branch runs (`daemon.go:325`), the C-c-driven shutdown has finished and the tmux
   session is gone. `tmux kill-session` returns `can't find session: rk-daemon`, which
   `daemon.go:326` wraps as a hard error. A *missing session at kill time means the
   stop succeeded* — but the code reports it as a failure, which propagates through
   `RestartWithBinary` (`daemon.go:352`) and aborts the restart.

**Secondary defect (feeds bug #2).** The poll-loop liveness check at `daemon.go:330`
reuses the *same expired* `ctx` (`sessionExistsCtx(ctx, session)`). Per
`daemon.go:109–111`, `sessionExistsCtx` returns `false` on *any* tmux error —
including `context deadline exceeded`. So at the deadline boundary the final
liveness check can't distinguish "session genuinely gone" from "my probe failed
because my context just expired," making the decision to kill unreliable exactly
when it matters most.

**What happens if we don't fix it.** Every `rk update` whose graceful shutdown takes
longer than 5s deterministically fails to restart the daemon. As the server accretes
more control-mode connections / SSE clients, shutdown gets slower and the failure
becomes more frequent, not less. The self-update path — a core run-kit workflow —
is effectively broken.

**Why this approach.** The fix targets the three independent defects directly: (a)
treat a vanished session at kill-time as success, (b) re-probe liveness with a fresh
context before killing, and (c) raise Stop's budget to cover the inner serve's
worst-case shutdown. Each is small, local to `Stop()` (plus one constant), and
independently correct. We rejected the "just bump the timeout" single-lever fix
because even with a larger budget, bugs #2 and the secondary defect still mis-handle
the boundary case (a shutdown that completes right at the deadline) — all three are
needed for a robust stop.

## What Changes

### 1. Treat a vanished session at kill-time as a successful stop

In the timeout/kill branch of `Stop()` (`daemon.go:320–328`), when `kill-session`
fails because the session no longer exists, return `nil` instead of an error. The
daemon stopping on its own (C-c worked) is the *success* outcome, not a failure.

Detection should be specific — match the tmux "session not found" condition rather
than blanket-swallowing every kill error (a genuinely stuck session that fails to
die for another reason should still surface). The existing tmux error wrapping in
`runTmux` (`daemon.go:79–84`) appends stderr (e.g. `can't find session: rk-daemon`)
to the returned error, so the not-found condition is detectable from the error text.
Prefer a re-probe (see change #2) over substring-matching where possible:

```go
case <-ctx.Done():
    killCtx, killCancel := context.WithTimeout(context.Background(), 2*time.Second)
    defer killCancel()
    // If the daemon already exited on its own (C-c worked, shutdown just took
    // longer than our poll budget), there is nothing to kill — that's success.
    if !sessionExistsCtx(killCtx, session) {
        return nil
    }
    slog.Warn("tmux teardown", "audit", "kill", "op", "kill-session", "server", serverSocket, "target", session, "callers", "daemon.Stop(timeout)")
    if err := runTmux(killCtx, "kill-session", "-t", "="+session); err != nil {
        // Lost a race: the session exited between our re-probe and the kill.
        // Re-confirm; a now-absent session means the stop succeeded.
        if !sessionExistsCtx(killCtx, session) {
            return nil
        }
        return fmt.Errorf("killing daemon session after timeout: %w", err)
    }
    return nil
```

### 2. Re-check liveness with a FRESH context before killing

The fresh `killCtx` (2s) already exists in the current code for the kill itself
(`daemon.go:322`). Use it for the pre-kill liveness re-probe shown above, so the
"is the session still there?" decision is made under a live context rather than the
expired `ctx`. This eliminates the expired-context misfire at the deadline boundary
without changing the poll-loop's normal-path behavior (the in-loop poll at
`daemon.go:329–332` continues to use `ctx`; only the post-timeout decision switches
to the fresh context).

### 3. Raise the Stop graceful-shutdown timeout to cover the inner serve worst case

The daemon's stop budget MUST be `>=` the inner serve's combined graceful-shutdown
budget. Inner serve: supervisor stop (5s) + `server.Shutdown` (5s) sequential = ~10s
worst case, plus a small margin for the C-c keystroke delivery and tmux round-trips.

Introduce a dedicated stop-timeout constant rather than overloading `cmdTimeout`
(which is the general 5s budget for one-shot tmux commands like `has-session` and
should stay short). Proposed:

```go
const (
    // cmdTimeout is the default timeout for one-shot tmux commands.
    cmdTimeout = 5 * time.Second
    // stopGracePeriod bounds Stop()'s wait for the inner `rk serve` to exit after
    // C-c. It must exceed the inner serve's combined graceful-shutdown budget —
    // supervisor stop (5s) + server.Shutdown (5s) in cmd/rk/serve.go, run
    // sequentially — plus margin for keystroke delivery and tmux round-trips.
    stopGracePeriod = 12 * time.Second
    stopPollInterval = 200 * time.Millisecond
)
```

`Stop()` uses `stopGracePeriod` for its top-level context (`daemon.go:304`); all the
short one-shot probes (`runningSessionCtx`, `sessionExistsCtx`, the kill) keep their
own short budgets. Exact value (10–12s) is a Tentative detail — 12s gives a ~2s
margin over the 10s worst case.

### 4. Regression test closing the C-c-honoring gap

The existing `TestStop_LegacySessionName` (`daemon_test.go:239`) starts a helper that
runs `sleep 300` (`daemon_test.go:100`), which **ignores** C-c. It therefore always
hits the kill path with a live session to kill — exactly the case that works today —
and never exercises the real failure mode (a process that *honors* C-c and exits
during the wait, leaving nothing to kill).

Add a regression test that:
- Starts a daemon-shaped tmux session whose inner command **traps/honors SIGINT and
  exits after a short delay** (e.g. a shell that installs a SIGINT trap and exits, or
  sleeps briefly then exits, so the session disappears mid-`Stop()`).
- Calls `Stop()` and asserts it returns `nil` (the bug: it currently returns a
  `can't find session` error).
- Asserts `IsRunning()` is `false` afterward.
- Optionally extends to assert the full restart succeeds (`RestartWithBinary` /
  `Restart` brings a fresh session back up) to pin the end-to-end `rk update` path.

Follow the existing test conventions in `daemon_test.go`: `useTestSocket(t)`,
`withServerSocket(t, testSocket)`, `hasTmux()` skip guard, and `testing.Short()` skip
for integration tests. Tests run via `just test-backend` per project convention —
never `go test` directly.

## Affected Memory

- `run-kit/architecture`: (modify) The daemon lifecycle / restart-mechanism description
  references `daemon.Stop()` and the kill-and-restart flow. Update to reflect the
  corrected stop semantics: stop budget covers the inner serve's worst-case graceful
  shutdown, and a session that exits on its own counts as a successful stop (no
  fatal kill error). Confirm during hydrate whether the architecture memory currently
  documents the Stop timeout/kill path at a level of detail that this change alters;
  if the daemon stop internals aren't currently described there, this may be a no-op.

## Impact

- **`app/backend/internal/daemon/daemon.go`** — `Stop()` function (timeout branch +
  liveness re-probe), new `stopGracePeriod` constant. Core of the change.
- **`app/backend/internal/daemon/daemon_test.go`** — new regression test; possibly a
  new test helper that starts a C-c-honoring inner command.
- **No API surface change** — `Stop()` / `Restart()` / `RestartWithBinary()`
  signatures are unchanged; only internal behavior and timing.
- **No frontend impact.**
- **Constitution — Self-Improvement Safety**: this change is squarely within the
  governed restart mechanism (tmux-based kill-and-restart, atomic rollback). The fix
  keeps the kill-and-restart shape; it does not introduce a supervisor loop, signal
  file, or file watching. ✓ compliant.
- **Constitution — Process Execution**: all tmux calls remain `exec.CommandContext`
  with explicit timeouts (`stopGracePeriod`, `killCtx`, `cmdTimeout`). ✓ compliant.

## Open Questions

- None blocking. Two low-stakes details resolved to their obvious front-runners
  (recorded as Confident assumptions below): `stopGracePeriod = 12s` (10s worst case
  + ~2s margin) and the regression test extends to a full restart round-trip. Both
  are single-constant / single-test-shape decisions, trivially reversible at apply.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Root cause is the trio of defects in `daemon.Stop()` (5s budget < ~10s inner shutdown; kill-on-vanished-session treated as fatal; expired-ctx liveness misfire), not a generic race | Verified by reading `daemon.go:298–335` and `serve.go:99–157` directly during /fab-discuss; the sequential 5s+5s inner budget vs 5s Stop budget is structural, not probabilistic | S:95 R:80 A:90 D:90 |
| 2 | Certain | Fix part 1 — treat a vanished session at kill-time as a successful stop (return nil) | Discussed and agreed; a missing session at kill time is definitionally a successful stop. Unblocks the restart with the smallest correct change | S:95 R:85 A:90 D:90 |
| 3 | Certain | Fix part 2 — re-probe liveness with the fresh `killCtx` before killing, not the expired `ctx` | Discussed and agreed; fixes the deadline-boundary misfire; `killCtx` already exists in the code | S:90 R:85 A:90 D:90 |
| 4 | Confident | Fix part 3 — introduce a dedicated `stopGracePeriod` constant `>= ` inner serve's combined shutdown budget, used only for Stop's top-level context | Discussed; separating from `cmdTimeout` keeps one-shot probes snappy while giving Stop the budget it needs. New constant vs overloading cmdTimeout is the one obvious design | S:80 R:80 A:85 D:75 |
| 5 | Confident | `stopGracePeriod = 12s` (10s inner-serve worst case + ~2s margin for keystroke/tmux round-trip) | One obvious front-runner: the budget must exceed 10s, and 12s is the conventional small-margin choice. Trivially reversible — single constant. Resolved to front-runner; no push-back in discussion | S:80 R:90 A:80 D:78 |
| 6 | Confident | Add a regression test driving `Stop()` against a C-c-honoring process that exits mid-wait; existing TestStop_LegacySessionName (sleep 300) masks the bug | Discussed; the test gap is the reason the bug shipped. Exact helper shape (SIGINT-trap shell vs short-sleep) is an implementation detail | S:80 R:90 A:85 D:70 |
| 7 | Confident | Regression test extends to a full restart round-trip (RestartWithBinary/Restart), not just Stop()-returns-nil | The round-trip is the actual user-facing behavior that broke, so it's the obvious coverage target; added test complexity (port guard, binary path) is routine here. Resolved to front-runner | S:75 R:90 A:78 D:75 |
| 8 | Confident | `run-kit/architecture` memory is the only affected domain, and may be a no-op if it doesn't document Stop internals | Daemon lifecycle lives in architecture.md per the memory index; verify exact wording at hydrate | S:75 R:85 A:80 D:70 |

8 assumptions (3 certain, 5 confident, 0 tentative, 0 unresolved).
