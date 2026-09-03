# Plan: Test-Socket Sweep Scoping

**Change**: 260903-np2w-test-socket-sweep-scoping
**Intake**: `intake.md`

## Requirements

### Go test sweep: e2e-family exclusion

#### R1: The dead-PID sweep skips the e2e socket family
Both existing copies of `sweepDeadTestSockets` (`app/backend/internal/tmux/main_test.go`, `app/backend/api/main_test.go`) MUST skip any socket whose name carries the prefix `rk-test-e2e-` **before** the PID parse. The exclusion prefix SHALL be a shared const (`testSocketE2EPrefix = "rk-test-e2e-"`) declared per test-support file, mirroring the duplicated `testSocketName`/`testSocketPrefix` convention (Go `_test.go` symbols are package-private). Go-test residue (`rk-test-unit-*`, `rk-test-relay-*`, …) MUST keep today's sweep behavior byte-identically.

- **GIVEN** a socket `rk-test-e2e-<token>-multi-<deadpid>-<epoch>` in `/tmp/tmux-<uid>/` whose embedded PID is dead (a respawned Playwright worker)
- **WHEN** any package's `TestMain` post-sweep runs
- **THEN** the socket is spared — the e2e family's own teardown chain (`test-e2e.sh` trap, `global-teardown.ts`) owns it
- **AND** a `rk-test-unit-<deadpid>-<ns>` socket in the same directory is still reaped

### Go test sweep: per-package post-sweep coverage

#### R2: Every tmux-spawning test package post-sweeps its own residue
`cmd/rk`, `internal/daemon`, `internal/tmuxctl`, `internal/snapshot`, and `internal/remote` MUST each gain the standard post-sweep `TestMain` — `m.Run()` first, sweep after, never a pre-sweep (recorded design decision in `docs/memory/run-kit/test-sockets.md`) — duplicating `sweepDeadTestSockets` + `parseTestSocketPID` + `testPIDAlive` + the two prefix consts into a new per-package test-support file (`main_test.go`; `cmd/rk`'s is `package main`). None of the five packages has a `TestMain` today (verified by grep), so all five files are new — the intake's append-to-existing clause is a vacuous no-op. The new copies carry the R1 e2e exclusion from birth. `testSocketName` is NOT part of the duplicated set — the sweep does not call it, and `internal/daemon`/`internal/tmuxctl` already define it in their existing test files (a second definition would fail compilation).

- **GIVEN** a `go test ./internal/snapshot` run whose test binary was SIGKILLed on a previous run, leaving a dead-PID `rk-test-snaproundtrip-*` socket
- **WHEN** the next `go test` run of that package exits
- **THEN** its `TestMain` post-sweep reaps the dead-PID socket without any sibling package's sweep being load-bearing

### socketsweep_test isolation

#### R3: The sweep test exercises classify/kill logic with zero shared-namespace exposure
`sweepDeadTestSockets` in `internal/tmux` SHALL gain an injectable socket-dir seam: an unexported variant `sweepDeadTestSocketsIn(socketDir string)` holding the loop body, with the `TestMain`-called wrapper `sweepDeadTestSockets()` defaulting to the real `/tmp/tmux-<uid>/` (wrapper behavior byte-identical). `TestSweepDeadTestSockets_*` MUST birth its fixture servers under a per-test temp dir (`t.Setenv("TMUX_TMPDIR", t.TempDir())` — tmux places `-L` sockets at `$TMUX_TMPDIR/tmux-<uid>/<name>`) and invoke `sweepDeadTestSocketsIn` against that dir, so the mid-run sweep never enumerates the shared namespace and never fires cross-worktree. The seam lives ONLY in the `internal/tmux` copy — the other six copies keep the single-function shape (the sweep test is the seam's only consumer). A new test case MUST prove the R1 exclusion: a dead-PID socket named under `rk-test-e2e-` survives the sweep.

- **GIVEN** the sweep test running while a sibling worktree's Go/Playwright suites are live
- **WHEN** its fixtures are created and the mid-run sweep is invoked
- **THEN** both operate on the per-test temp dir only — no shared `/tmp/tmux-<uid>/` fixture servers, no worktree-agnostic mid-run sweep
- **GIVEN** a dead-PID fixture socket named `rk-test-e2e-fixture-<deadpid>-<ns>` in the temp dir
- **WHEN** `sweepDeadTestSocketsIn` runs against it
- **THEN** the socket survives (e2e-family exclusion) while a sibling `rk-test-sweepspare-<deadpid>-<ns>` is reaped

### E2E teardown: bare-anchor guard

#### R4: A token-less family anchor refuses the teardown sweep
`app/frontend/tests/e2e/global-teardown.ts` MUST refuse its prefix-scan sweep — printing a warning naming the refused anchor — when the resolved anchor (`family ?? server`) is one of the bare defaults `rk-test-e2e` or `rk-test-e2e-` (a preset `E2E_TMUX_SERVER=rk-test-e2e` with no preset family collapses `E2E_TMUX_FAMILY` to the server name as-is in `scripts/e2e-env.sh`, making the anchor a strict prefix of every derived family). The `scripts/test-e2e.sh` cleanup trap MUST apply the same guard to its family glob (skip the socket loop, print a warning; the port/PGID cleanup still runs). Derived anchors (`rk-test-e2e-<token>-`) are unaffected. `_tmux.ts`'s own fallback default stays unchanged — the guard at the two sweep sites is the fix, not the constant.

- **GIVEN** a run launched with `E2E_TMUX_SERVER=rk-test-e2e` and no `E2E_TMUX_FAMILY`
- **WHEN** `global-teardown.ts` or the `test-e2e.sh` EXIT trap fires
- **THEN** the family sweep is refused with a printed warning, and no cross-worktree `rk-test-e2e-*` server is killed

### Non-Goals

- No change to `rk mux reap` (the manual janitor keeps covering crashed e2e residue by hand).
- No change to the e2e family's own teardown breadth for derived anchors.
- No production (non-test) code path is touched — the seam lands inside `_test.go` files.

### Design Decisions

#### E2E exclusion by family prefix, not per-worktree token matching
**Decision**: `sweepDeadTestSockets` skips the whole `rk-test-e2e-` family by prefix.
**Why**: The e2e family has its own owners-and-teardown chain (`test-e2e.sh` trap glob, `global-teardown.ts` prefix scan, `rk mux reap` by hand); Go tests never need to janitor it, and prefix exclusion closes the worker-PID-respawn hole completely.
**Rejected**: Per-worktree token matching — more moving parts for no added safety; the Go sweep would need the worktree token, which it has no reason to know.
*Introduced by*: 260903-np2w-test-socket-sweep-scoping

#### Injectable-dir seam over TMUX_TMPDIR-only isolation
**Decision**: The sweep gains `sweepDeadTestSocketsIn(socketDir)`; the test sets `TMUX_TMPDIR` per-test for fixture creation AND passes the derived temp dir to the seam.
**Why**: Keeps the `TestMain` wrapper's behavior byte-identical (hardcoded `/tmp/tmux-<uid>` default) while the test gets a fully private namespace; the seam is the direct, deterministic handle for the enumeration dir.
**Rejected**: `TMUX_TMPDIR` alone with the wrapper reading it — changes the production wrapper's enumeration behavior for all callers.
*Introduced by*: 260903-np2w-test-socket-sweep-scoping

## Tasks

### Phase 1: Setup

*(none — no scaffolding needed)*

### Phase 2: Core Implementation

- [x] T001 In `app/backend/internal/tmux/main_test.go`: add `testSocketE2EPrefix = "rk-test-e2e-"` const; split `sweepDeadTestSockets` into the wrapper (default dir `/tmp/tmux-<uid>`) + `sweepDeadTestSocketsIn(socketDir string)` holding the loop; add the e2e-prefix skip before the PID parse <!-- R1, R3 -->
- [x] T002 [P] In `app/backend/api/main_test.go`: add `testSocketE2EPrefix` const + the e2e-prefix skip before the PID parse (single-function shape retained) <!-- R1 -->
- [x] T003 In `app/backend/internal/tmux/socketsweep_test.go`: point fixtures + sweep at a per-test temp dir (`t.Setenv("TMUX_TMPDIR", ...)`, invoke `sweepDeadTestSocketsIn` with the derived `<tmpdir>/tmux-<uid>` path); add a dead-PID `rk-test-e2e-*` fixture case asserting it is spared <!-- R3 -->
- [x] T004 [P] New `app/backend/cmd/rk/main_test.go` (`package main`): `TestMain` post-sweep + `sweepDeadTestSockets`/`parseTestSocketPID`/`testPIDAlive` + both consts (with e2e exclusion) <!-- R2 -->
- [x] T005 [P] New `app/backend/internal/daemon/main_test.go`: same post-sweep set, WITHOUT `testSocketName` (already in `daemon_test.go`) <!-- R2 -->
- [x] T006 [P] New `app/backend/internal/tmuxctl/main_test.go`: same post-sweep set, WITHOUT `testSocketName` (already in `integration_test.go`) <!-- R2 -->
- [x] T007 [P] New `app/backend/internal/snapshot/main_test.go`: same post-sweep set <!-- R2 -->
- [x] T008 [P] New `app/backend/internal/remote/main_test.go`: same post-sweep set (defensive — remote currently stubs its tmux seams, but the intake enumerates it and the post-sweep is inert without residue) <!-- R2 -->

### Phase 3: Integration & Edge Cases

- [x] T009 In `app/frontend/tests/e2e/global-teardown.ts`: refuse the sweep with a printed warning when the resolved anchor is `rk-test-e2e` or `rk-test-e2e-` <!-- R4 -->
- [x] T010 In `scripts/test-e2e.sh` `cleanup()`: skip the family socket glob (warning printed) when `E2E_TMUX_FAMILY` is `rk-test-e2e` or `rk-test-e2e-`; keep PGID/port cleanup running <!-- R4 -->
- [x] T011 Run verification: `cd app/backend && go test ./internal/tmux ./api ./cmd/rk ./internal/daemon ./internal/tmuxctl ./internal/snapshot ./internal/remote`, then `cd app/frontend && npx tsc --noEmit` <!-- R1 -->

## Execution Order

- T001 blocks T003 (the seam must exist before the test targets it).
- T002, T004–T008 are independent of each other and of T001/T003.
- T009/T010 are independent of the Go tasks. T011 runs last.

## Acceptance

### Functional Completeness

- [x] A-001 R1: Both `internal/tmux` and `api` sweep copies skip `rk-test-e2e-`-prefixed sockets before the PID parse, via a per-file `testSocketE2EPrefix` const
- [x] A-002 R2: All five packages (`cmd/rk`, `internal/daemon`, `internal/tmuxctl`, `internal/snapshot`, `internal/remote`) have a `TestMain` post-sweep (`m.Run()` first, sweep after) and compile with no duplicate-symbol errors
- [x] A-003 R3: `sweepDeadTestSocketsIn(socketDir)` exists in `internal/tmux/main_test.go`; the exported wrapper's default-dir behavior is unchanged
- [x] A-004 R4: `global-teardown.ts` and the `test-e2e.sh` trap both refuse a bare `rk-test-e2e`/`rk-test-e2e-` anchor with a printed warning

### Behavioral Correctness

- [x] A-005 R1: A dead-PID `rk-test-e2e-*` socket survives the sweep while a dead-PID non-e2e `rk-test-*` socket is reaped (asserted by the new test case)
- [x] A-006 R3: `TestSweepDeadTestSockets_*` fixtures no longer touch the shared `/tmp/tmux-<uid>/` and the mid-run sweep enumerates only the per-test dir

### Scenario Coverage

- [x] A-007 R3: The new e2e-exclusion test case runs green alongside the existing three-way own/other-live/dead invariant
- [x] A-008 R2: `go test` passes in all seven affected packages

### Edge Cases & Error Handling

- [x] A-009 R4: Guard fires for both bare spellings (`rk-test-e2e` and `rk-test-e2e-`); derived anchors (`rk-test-e2e-<token>-`) sweep exactly as before
- [x] A-010 R2: Sweep remains best-effort in every copy — enumeration/kill failures ignored, never blocking tests

### Code Quality

- [x] A-011 All kills use `exec.CommandContext` with a 5s timeout and argument slices — no shell strings (constitution I)
- [x] A-012 Pattern consistency: new per-package copies mirror the existing `main_test.go` shape, comments state constraints (not narration), no change IDs cited in code comments
- [x] A-013 No unnecessary duplication beyond the documented per-package `_test.go` convention; no production code touched

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- `app/backend/internal/remote/main_test.go` (whole file, 112 lines) — `internal/remote` spawns no real tmux server anywhere in its tests (`tunnel_test.go:21` `stubTmux` swaps `tmuxRunFn`/`tmuxOutputFn`; the only other `tmux` hits are string literals in `store_test.go:91` / `ssh_test.go:73`), so this post-sweep can never have residue of its own to reap — it only sweeps other packages' leftovers, which is the cross-package janitoring R2 exists to end.
- `sweepDeadTestSockets`/`parseTestSocketPID`/`testPIDAlive` + `testSocketPrefix`/`testSocketE2EPrefix` in `app/backend/cmd/rk/main_test.go:34-112`, `app/backend/internal/daemon/main_test.go:34-112`, `app/backend/internal/remote/main_test.go:34-112`, `app/backend/internal/snapshot/main_test.go:34-112`, `app/backend/internal/tmuxctl/main_test.go:34-112` — five byte-identical copies of one ~78-line block, collapsible to a single exported helper in the existing `internal/testutil` package (`internal/testutil/stub.go:1-4`: "a regular (non-`_test`) package so helpers are importable from `_test.go` files across packages"), which `cmd/rk`, `internal/daemon`, `internal/tmuxctl` and `api` already import.
- `app/backend/internal/tmux/socketsweep_test.go:15` — the comment "Matches `cmd/rk/serve_sweep_test.go`'s convention" cites a file that does not exist in the tree (`cmd/rk` has `serve.go`, `code_server_test.go`, no `serve_sweep_test.go`); the stale reference should be dropped.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Seam shape (`sweepDeadTestSocketsIn`) only in `internal/tmux`; the other six copies keep the single-function shape | The sweep test is the seam's only consumer; minimal diff beats uniform-but-unexercised seams | S:70 R:85 A:80 D:70 |
| 2 | Certain | All five `TestMain`s are new files — the intake's append-to-existing clause is a no-op | Verified by grep: no `TestMain` exists in any of the five packages today | S:85 R:90 A:95 D:90 |
| 3 | Confident | `internal/remote` gains the post-sweep despite stubbing its tmux seams today | Intake enumerates it explicitly; the sweep is inert without residue and future-proofs real-server tests | S:70 R:90 A:80 D:75 |
| 4 | Confident | Fixture isolation via `t.Setenv("TMUX_TMPDIR", t.TempDir())` + passing the derived dir to the seam | Resolves the intake's Tentative row per its inline marker (seam preferred — wrapper stays byte-identical) | S:65 R:80 A:80 D:70 |
| 5 | Confident | `_tmux.ts` fallback default (`rk-test-e2e`) unchanged; the guard lives at the two sweep sites only | Direct Playwright runs are fail-closed anyway; guarding the sweeps closes the hazard without touching the constant's other consumers | S:65 R:85 A:80 D:70 |
| 6 | Certain | New per-package files exclude `testSocketName` from the duplicated set | The sweep never calls it, and `internal/daemon`/`internal/tmuxctl` already define it — a second copy fails compilation | S:85 R:90 A:95 D:90 |

6 assumptions (2 certain, 4 confident, 0 tentative).
