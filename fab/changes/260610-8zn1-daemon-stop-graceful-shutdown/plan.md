# Plan: Fix daemon restart aborting on healthy graceful shutdown

**Change**: 260610-8zn1-daemon-stop-graceful-shutdown
**Status**: In Progress
**Intake**: `intake.md`

## Requirements

### Daemon: Stop graceful-shutdown semantics

#### R1: Stop must allow time for the inner serve's worst-case graceful shutdown
`Stop()` SHALL bound its send-C-c-then-poll wait with a dedicated `stopGracePeriod`
that is `>=` the inner `rk serve`'s combined graceful-shutdown budget
(supervisor stop 5s + `server.Shutdown` 5s, run sequentially in `cmd/rk/serve.go`,
~10s worst case) plus margin for C-c keystroke delivery and tmux round-trips. The
general `cmdTimeout` (5s) for one-shot probes SHALL remain unchanged. `stopGracePeriod`
and `stopPollInterval` SHALL be package `var`s (not `const`s) so tests can shrink them
to deterministically drive `Stop()`'s timeout/kill branch — mirroring the existing
`serverSocket` test seam.

- **GIVEN** a daemon whose graceful shutdown takes longer than 5s but completes within ~10s
- **WHEN** `Stop()` sends C-c and polls for the session to disappear
- **THEN** `Stop()` SHALL wait up to `stopGracePeriod` (12s) for the session to vanish before considering a forced kill
- **AND** one-shot probes (`runningSessionCtx`, `sessionExistsCtx`, the kill) SHALL keep their own short budgets

#### R2: A vanished session at kill-time is a successful stop
When the post-timeout branch of `Stop()` runs, if the daemon session no longer exists
the function SHALL return `nil` (success) rather than reporting a kill failure. The
daemon exiting on its own (C-c worked) is the success outcome, not a failure.

- **GIVEN** a daemon whose C-c-driven shutdown finishes after the poll budget expires
- **WHEN** `Stop()` reaches the post-timeout kill branch
- **THEN** `Stop()` SHALL re-probe and, finding the session gone, return `nil`
- **AND** it SHALL NOT issue a `kill-session` against an already-absent session nor surface a `can't find session` error

#### R3: Every liveness probe runs under a fresh, live context — no shared expiring context
`Stop()` SHALL NOT bound its whole operation with a single `stopGracePeriod` context.
The grace deadline SHALL be an independent timer (`time.NewTimer(stopGracePeriod)`), and
every tmux command — initial lookup, C-c send, each liveness poll, and the kill — SHALL
run under its own fresh `cmdTimeout`-bounded context (via the `sessionExists` helper for
probes). This eliminates the prior defect where a probe could inherit a near-expired
deadline and fail on `context deadline exceeded`, misread as "session gone". After a
`kill-session` error, `Stop()` SHALL re-confirm liveness; a now-absent session SHALL be
treated as success, while a session that still exists after a failed kill SHALL surface a
wrapped error.

- **GIVEN** the grace timer has just fired at the deadline boundary
- **WHEN** `Stop()` decides whether to kill the session and issues the kill
- **THEN** every liveness probe and the kill SHALL run under its own fresh `cmdTimeout` context, never a shared expiring one
- **AND** a `kill-session` error followed by a confirmed-absent session SHALL return `nil`
- **AND** a session that still exists after a failed kill SHALL return a wrapped `killing daemon session after timeout` error

#### R4: Regression tests that actually reproduce the bug (fail pre-fix, pass post-fix)
Regression tests SHALL drive `Stop()` through its timeout/kill branch deterministically
(by shrinking `stopGracePeriod` via the test seam) and SHALL be empirically verified to
FAIL against the pre-fix logic and PASS against the fix — a test that passes against buggy
code does not guard the regression. Two cases SHALL be covered:
- **Vanished-at-kill (R2):** a C-c-honoring session that tears down during the wait → `Stop()` returns `nil`, `IsRunning()` is `false`.
- **Stuck-but-killable (R3 inverse):** a session that ignores C-c and is still alive when the grace timer fires → `Stop()` kills it and returns `nil`; a restart round-trip then brings a fresh session back up. This guards against an over-broad "always return nil" regression.

Tests SHALL follow existing conventions: `useTestSocket(t)`, `withServerSocket(t, testSocket)`,
the `withStopTiming(t, grace, poll)` seam, `hasTmux()` skip guard, `testing.Short()` skip.

- **GIVEN** a shrunken `stopGracePeriod` so `Stop()` deterministically enters the timeout/kill branch
- **WHEN** the inner session has vanished by kill-time (C-c honored) vs. is still alive (C-c ignored)
- **THEN** the vanished case SHALL return `nil` with `IsRunning()` false, and the stuck-but-killable case SHALL kill the session, return `nil`, and allow a fresh restart
- **AND** both tests SHALL fail against the pre-fix `Stop()` logic (verified by swapping in the old branch)

### Non-Goals

- Changing the kill-and-restart restart mechanism shape (no supervisor loop, signal file, or file watching — Constitution §Self-Improvement Safety)
- Changing the inner `rk serve` shutdown budget in `cmd/rk/serve.go`
- Any change to `Stop()` / `Restart()` / `RestartWithBinary()` public signatures
- Any frontend change

### Design Decisions

1. **Dedicated `stopGracePeriod` (12s) rather than overloading `cmdTimeout`**: one-shot probes keep `cmdTimeout` (5s) — *Why*: the inner serve's worst-case shutdown is ~10s, but one-shot probes (`has-session`) should stay snappy — *Rejected*: bumping `cmdTimeout` to 12s globally (would slow every probe and `IsRunning()`).
2. **Independent grace timer + per-command fresh contexts, NOT one shared `stopGracePeriod` context** (rework): the grace deadline is a `time.NewTimer`; lookup, C-c send, each poll, and the kill each get a fresh `cmdTimeout` context (via `sessionExists`) — *Why*: the original single-context design made every probe inherit a near-expired deadline as the grace period wound down, so a probe could fail on `context deadline exceeded` and be misread as "session gone" (the secondary defect from intake); it also coupled the wall-clock deadline to command execution, leaving no testable seam for the timeout branch. Decoupling fixes both root causes at once — *Rejected*: keeping the single context and patching only the post-timeout re-probe (left the expired-context-poll defect and the untestability in place).
3. **Re-probe over substring-matching the tmux "session not found" error**: detect a successful stop by re-probing liveness rather than string-matching `can't find session` — *Why*: robust to tmux message wording; distinguishes "gone" from "probe failed" — *Rejected*: blanket-swallowing every kill error (a genuinely stuck session must still surface).
4. **`stopGracePeriod`/`stopPollInterval` as `var` test seams + `withStopTiming` helper** (rework): mirrors the existing `serverSocket`/`withServerSocket` pattern — *Why*: lets the regression tests shrink the grace period to deterministically drive the timeout/kill branch in <1s instead of burning 12s of wall-clock; without this seam a meaningful test of the bug branch was impossible (this was the root cause of the first review failure — the original test passed against buggy code) — *Rejected*: a 12s real-time test (slow, and still racy on which select arm fires).

## Tasks

### Phase 1: Core Implementation

- [x] T001 Define `stopGracePeriod = 12 * time.Second` and move `stopPollInterval` out of the `const` block into package `var`s in `app/backend/internal/daemon/daemon.go`, each documented with the inner-serve budget rationale and the test-seam reason; keep `cmdTimeout = 5 * time.Second` as a `const` for one-shot probes <!-- R1 -->
- [x] T002 Restructure `Stop()` in `app/backend/internal/daemon/daemon.go` to use an independent `time.NewTimer(stopGracePeriod)` for the grace deadline rather than a single bounding context; give the initial lookup, the C-c send, and the kill each their own fresh `cmdTimeout` context; update the `Stop` doc comment to explain the decoupling and why <!-- R1 R3 -->
- [x] T003 Add a `sessionExists(name)` context-free helper (fresh `cmdTimeout` context per call) and use it for every poll/re-probe in `Stop()` so no liveness check inherits a near-expired deadline; re-probe before killing (return `nil` if gone) and re-confirm after a `kill-session` error (return `nil` if now absent, else wrap) <!-- R2 R3 -->

### Phase 2: Regression Tests

- [x] T004 Add the `withStopTiming(t, grace, poll)` test seam to `app/backend/internal/daemon/daemon_test.go` (saves/restores `stopGracePeriod`/`stopPollInterval` via `t.Cleanup`, mirroring `withServerSocket`); add the `startSelfExitingOn(socket, session, delaySec)` helper — a session that honors C-c AND self-exits at a fixed delay, so teardown timing is decoupled from C-c-delivery latency (removes the wall-clock race) — distinct from the `sleep 300` `startOn` helper that ignores C-c <!-- R4 -->
- [x] T005 Add `TestStop_TimeoutThenSessionVanished` (vanished-at-kill → `nil`, R2) and `TestStop_TimeoutStuckSessionIsKilled` (live stuck session → killed + restart round-trip, R3 inverse) to `app/backend/internal/daemon/daemon_test.go`, both using `withStopTiming` to drive the timeout branch deterministically. The vanished test uses a 2s grace ≫ the session's fixed 200ms self-exit (huge poll interval so only the grace timer fires) → no event-ordering race even under load. EMPIRICALLY VERIFIED: both fail against pre-fix `Stop()` logic, pass against the fix; vanished test passes 20/20 under 8 busy-loop load generators (flakiness fix). Follow `useTestSocket`/`withServerSocket`/`hasTmux`/`testing.Short()` conventions <!-- R4 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: `daemon.go` defines `stopGracePeriod = 12 * time.Second` (as a `var` test seam) with a doc comment, `cmdTimeout` remains a `5 * time.Second` const, and `Stop()`'s grace deadline uses `stopGracePeriod` — verified daemon.go:81 (`var stopGracePeriod` + doc), :35 (cmdTimeout const unchanged), `Stop()` uses `time.NewTimer(stopGracePeriod)`
- [x] A-002 R2: `Stop()`'s timeout branch returns `nil` when the session is already gone instead of issuing a kill or returning a `can't find session` error — re-probe `if !sessionExists(session) { return nil }` before the kill
- [x] A-003 R3: No shared expiring context — the grace deadline is an independent `time.NewTimer`; lookup, C-c send, every poll (`sessionExists`), and the kill each get a fresh `cmdTimeout` context; post-kill-error re-confirm also uses a fresh context — verified daemon.go (lookupCtx/sendCtx/killCtx + `sessionExists` helper)
- [x] A-004 R4: Regression tests drive `Stop()` through the timeout/kill branch deterministically (via `withStopTiming`) and assert the correct outcomes — `TestStop_TimeoutThenSessionVanished` (vanished → nil, IsRunning false) and `TestStop_TimeoutStuckSessionIsKilled` (stuck → killed + restart round-trip). EMPIRICALLY RE-VERIFIED by the rework re-review (fresh inward agent, cycle 1): with the pre-fix `Stop()` body reconstructed in place (single shared `stopGracePeriod` context, no pre-kill re-probe, no post-kill re-confirm) BOTH tests FAIL — vanished: `Stop() = killing daemon session after timeout: exit status 1: no server running ...`; stuck: `IsRunning() = true after Stop()` + failed restart round-trip (the shared 1ns context corrupts the initial `runningSessionCtx` lookup → bogus early `nil`, session left alive). Against the fix BOTH PASS, 5/5 loop runs + `-count=10` + `-race -count=3` all green (deterministic). They genuinely guard the regression. CYCLE-2 FLAKINESS FIX: the cycle-1 vanished test used a 200ms grace that raced tmux teardown under load (outward agent observed 3 consecutive failures under contention); rewritten to a 2s grace ≫ the session's fixed 200ms self-exit (`startSelfExitingOn`), with a huge poll interval so only the grace timer fires — no event-ordering race. Re-verified 20/20 passes under 8 concurrent busy-loop load generators.

### Behavioral Correctness

- [x] A-005 R2: After C-c-driven shutdown completes past the grace budget, `Stop()` returns `nil` (was: returned a wrapped `killing daemon session after timeout: ... can't find session` error) — now test-covered by `TestStop_TimeoutThenSessionVanished`, which shrinks the grace period so the timeout/kill branch is actually exercised (the happy-path poll is bypassed) and the re-probe finds the session gone. Verified to fail pre-fix, pass post-fix.
- [x] A-006 R3: A session still alive when the grace timer fires is killed (and a genuinely stuck session that survives a failed kill would surface a wrapped error) — `TestStop_TimeoutStuckSessionIsKilled` drives a C-c-ignoring `sleep 300` session into the timeout branch and asserts it is killed and the restart round-trip succeeds, guarding against an over-broad "always return nil" regression. The still-stuck-and-kill-fails sub-branch (daemon.go re-confirm → wrap) remains correct by inspection (hard to provoke a kill failure on a live session in a unit test without process injection).
- [x] A-007 R4: `just test-backend` passes, including both new regression tests — verified: all backend packages `ok`; `rk/internal/daemon` passes (1.403s).

### Edge Cases & Error Handling

- [x] A-008 R3: At the deadline boundary, no liveness probe runs under a near-expired context — the grace deadline is decoupled from command execution and each probe uses a fresh `cmdTimeout` context, so an expired-context probe can no longer misfire as "session gone" — verified structurally (single-context design removed) and covered by the deterministic timeout-branch tests.

### Code Quality

- [x] A-009 Pattern consistency: New constant carries a doc comment matching the file's density; modified `Stop()` keeps the existing slog audit + `runTmux` + `exec.CommandContext` idiom; new test follows `daemon_test.go` conventions — verified
- [x] A-010 No unnecessary duplication: The new `sessionExists` helper wraps `sessionExistsCtx` (no logic duplication); reuses `runTmux`, `runningSessionCtx`, `targetFor`, and existing test helpers; `withStopTiming` mirrors `withServerSocket` — verified
- [x] A-011 Process Execution (Constitution): All tmux calls remain `exec.CommandContext` with explicit timeouts (each via a fresh `cmdTimeout` context); no shell strings introduced — verified (all calls route through `runTmux`/`runTmuxOutput`)
- [x] A-012 Self-Improvement Safety (Constitution): The fix preserves the tmux-based kill-and-restart shape — no supervisor loop, signal file, or file watching added — verified

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change adds new functionality (a constant, a re-probe branch, a test helper, and a regression test) and refines `Stop()`'s post-timeout branch in place. It does not supersede or orphan any existing code, function, branch, or config.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | `stopGracePeriod = 12 * time.Second` (10s inner-serve worst case + ~2s margin) | Carried from intake assumption #5; verified inner budget is 5s+5s sequential in `cmd/rk/serve.go:143,149`. Single value, trivially reversible | S:90 R:90 A:90 D:85 |
| 2 | Certain | Detect a successful stop via fresh-context re-probe (R2/R3) rather than substring-matching the tmux error | Intake §"What Changes" #1/#2 prescribes the re-probe approach; robust to message wording | S:95 R:85 A:90 D:90 |
| 3 | Certain | Decouple the grace deadline (`time.NewTimer`) from per-command contexts (REWORK) — every tmux op gets a fresh `cmdTimeout` context via `sessionExists` | The original single-`stopGracePeriod`-context design was the shared root of two intake-named defects: probes inheriting a near-expired deadline (misread as "gone"), and no testable seam for the timeout branch. Decoupling fixes both at the source rather than patching symptoms. Surfaced by review + empirical efficacy check | S:90 R:80 A:90 D:85 |
| 4 | Certain | `stopGracePeriod`/`stopPollInterval` as `var` test seams + `withStopTiming` helper (REWORK) | First review correctly found the original test passed against buggy code; a shrinkable grace period is the only way to deterministically drive the timeout/kill branch in a fast unit test. Mirrors the established `serverSocket`/`withServerSocket` seam | S:90 R:90 A:90 D:88 |
| 5 | Confident | Two regression tests: vanished-at-kill (R2) + stuck-but-killable (R3 inverse), both empirically verified to fail pre-fix / pass post-fix | A single test covers only the vanished path; the stuck-session test guards against an over-broad "always return nil" regression of the fix. Empirical fail-pre/pass-post is the bar for a real regression guard | S:85 R:90 A:85 D:80 |
| 6 | Confident | Restart round-trip in the stuck test uses `startOn` (not real `StartWithBinary`) to bring a fresh session back up | `StartWithBinary` requires a real rk binary + free port and would couple the unit test to build artifacts; `startOn` is the established daemon_test.go pattern and proves the post-stop "fresh session comes back up" outcome without binary coupling | S:75 R:88 A:80 D:72 |

6 assumptions (4 certain, 2 confident, 0 tentative, 0 unresolved).
