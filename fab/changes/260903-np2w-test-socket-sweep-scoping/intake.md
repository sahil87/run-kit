# Intake: Test-Socket Sweep Scoping

**Change**: 260903-np2w-test-socket-sweep-scoping
**Created**: 2026-09-03

## Origin

> Scope the Go dead-PID test-socket sweep away from sibling worktrees' e2e servers and add TestMain post-sweeps to the five uncovered packages

Conversational: from the same `/fab-discuss` cross-worktree test-interference analysis as 260903-y60c. A hazard sweep found the Go `sweepDeadTestSockets` post-sweep is PID-scoped but **not worktree-scoped**, and identified both the demand side (a reachable kill of a sibling's live e2e server) and the supply side (five packages spawn real tmux servers with `t.Cleanup`-only teardown, so SIGKILL residue accumulates and makes the broad sweep "necessary"). The user approved fixing both sides.

## Why

1. **The pain point (demand side)**: `sweepDeadTestSockets()` (`app/backend/internal/tmux/main_test.go:107-129`, duplicated in `app/backend/api/main_test.go:87-108`) enumerates the **shared** `/tmp/tmux-<uid>/` and `kill-server`s every `rk-test-*` socket whose embedded PID (second-to-last hyphen field) parses AND is dead — regardless of which worktree created it. Sibling worktrees' e2e **secondary** servers are named `rk-test-e2e-<token>-<role>-<pid>-<epoch>` where `<pid>` is the **Playwright worker** PID; `playwright.config.ts` sets `retries: 1`, and a worker respawn mid-run leaves a still-in-use tmux server owned by a dead PID. Any sibling worktree's `go test` run exiting at that moment kills the e2e run's live server. (The e2e **primary** `rk-test-e2e-<token>-0` is already safe: the `wt`-prefix guard in `scripts/e2e-env.sh:38-41` keeps its second-to-last field non-numeric.)
2. **The pain point (supply side)**: only `internal/tmux` and `api` carry the `TestMain` post-sweep. `cmd/rk`, `internal/daemon`, `internal/tmuxctl`, `internal/snapshot`, and `internal/remote` all spawn real tmux servers with `t.Cleanup`-only teardown — a SIGKILL/panic/OOM there leaks sockets that only a **later or sibling** run's sweep collects, which is exactly why the sweep was made worktree-agnostic.
3. **Secondary hazard**: `socketsweep_test.go` births its 3 fixture servers in the real shared `/tmp/tmux-<uid>/` (`app/backend/internal/tmux/socketsweep_test.go:82-93`) and invokes the full worktree-agnostic sweep **mid-run** (`:147`), firing the cross-worktree breadth while sibling runs are live.
4. **The consequence if unfixed**: rare, hard-to-reproduce mid-run kills of e2e servers when parallel agents run Go and Playwright suites concurrently across worktrees — precisely the flake class prompting this work.

## What Changes

### 1. Exclude the e2e family from the Go dead-PID sweep

Both copies of `sweepDeadTestSockets` skip any socket whose name has the prefix `rk-test-e2e-` before the PID parse. Rationale: the e2e family has its **own** owners-and-teardown chain — `scripts/test-e2e.sh`'s family-anchored EXIT-trap glob and `global-teardown.ts`'s family prefix-scan — so Go tests never need to janitor it, and the worker-PID-respawn hole closes. Go-test residue (`rk-test-unit-*`, `rk-test-relay-*`, …) keeps today's sweep behavior unchanged. The `rk mux reap` manual janitor still covers crashed e2e residue by hand (unchanged).

The exclusion prefix is a shared const per test-support file (mirroring the duplicated `testSocketName` convention — Go `_test.go` symbols are package-private).

### 2. Add the `TestMain` post-sweep to the five uncovered packages

`cmd/rk`, `internal/daemon`, `internal/tmuxctl`, `internal/snapshot`, `internal/remote` each gain the standard post-sweep `TestMain` (run `m.Run()` first, sweep after — never a pre-sweep), duplicating `sweepDeadTestSockets` + `parseTestSocketPID` + `testPIDAlive` into each package's test-support file per the existing duplication convention. Packages that already have a `TestMain` (e.g. `internal/daemon`'s package-level socket setup) get the sweep appended to their existing one rather than a second `TestMain` (Go forbids two).

With every tmux-spawning package sweeping its own dead residue on the way out, cross-worktree janitoring stops being load-bearing.

### 3. Isolate `socketsweep_test.go` from the shared socket dir

Give the sweep an injectable socket-dir seam (an unexported variant taking the dir path, with the exported/`TestMain`-called wrapper defaulting to the real `/tmp/tmux-<uid>/`), and point `TestSweepDeadTestSockets_*` fixtures + the mid-run sweep invocation at a per-test temp dir (`t.TempDir()` or a per-test `TMUX_TMPDIR`-scoped server family — implementation's choice). Result: the test exercises the same classify/kill logic with zero shared-namespace exposure and no mid-run cross-worktree sweep.

### 4. Guard the e2e teardown's preset-collapse edge

`scripts/e2e-env.sh:62-68`: a preset `E2E_TMUX_SERVER` with no preset family sets `E2E_TMUX_FAMILY` to the server name AS-IS. Presetting `E2E_TMUX_SERVER=rk-test-e2e` (also `_tmux.ts`'s own fallback default) makes the anchor a strict prefix of **every** derived family, and `global-teardown.ts:41-47` then prefix-kills across worktrees. Add a guard in `global-teardown.ts` (and the `test-e2e.sh` trap glob): refuse the sweep with a printed warning when the family anchor is one of the bare defaults (`rk-test-e2e` / `rk-test-e2e-`) — a token-less anchor is never a valid single-worktree family. Derived anchors are unaffected.

## Affected Memory

- `run-kit/test-sockets`: (modify) sweep section gains the e2e-family exclusion + the now-universal per-package post-sweep coverage; teardown section gains the bare-anchor guard

## Impact

- `app/backend/internal/tmux/main_test.go`, `app/backend/api/main_test.go` — exclusion prefix
- `app/backend/internal/tmux/socketsweep_test.go` — fixture + seam isolation
- Test-support files in `app/backend/cmd/rk/`, `app/backend/internal/daemon/`, `app/backend/internal/tmuxctl/`, `app/backend/internal/snapshot/`, `app/backend/internal/remote/` — new/extended `TestMain`s
- `app/frontend/tests/e2e/global-teardown.ts`, `scripts/test-e2e.sh` (trap), possibly `app/frontend/tests/e2e/_tmux.ts` (fallback default) — bare-anchor guard
- Test-only change: no production code path touched except the injectable-dir seam if it lands in non-test code (keep it in test files if possible)

## Open Questions

- None blocking.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Exclude by `rk-test-e2e-` prefix rather than per-worktree token matching | Discussed — the e2e family has its own teardown owners; prefix exclusion is simpler and complete | S:75 R:85 A:85 D:75 |
| 2 | Certain | Post-sweep helpers duplicated per package | Matches the recorded `testSocketName` duplication convention (package-private `_test.go` symbols) | S:85 R:90 A:95 D:90 |
| 3 | Tentative | Socket-dir isolation mechanism for `socketsweep_test.go` (injectable dir seam vs `TMUX_TMPDIR`) | Two workable options; decided at apply against the actual code shape <!-- assumed: injectable-dir seam preferred — keeps the TestMain wrapper's behavior byte-identical --> | S:55 R:80 A:70 D:45 |
| 4 | Confident | Bare-anchor teardown guard added in this change (not a separate one) | Same theme (sweep scoping/safety); tiny surface; discussed as part of this fix set | S:60 R:85 A:80 D:65 |
| 5 | Certain | Post-sweep stays post-only (after `m.Run()`), never a pre-sweep | Recorded design decision in `docs/memory/run-kit/test-sockets.md` — each run reaps its OWN residue | S:90 R:90 A:95 D:95 |

5 assumptions (2 certain, 2 confident, 1 tentative, 0 unresolved).
