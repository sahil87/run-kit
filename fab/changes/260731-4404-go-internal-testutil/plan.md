# Plan: Go internal/testutil Test Scaffolding Consolidation

**Change**: 260731-4404-go-internal-testutil
**Intake**: `intake.md`

## Requirements

### Backend Testing: Shared Test Scaffolding Package

#### R1: Stub-executable fixture in `internal/testutil`
A new package `app/backend/internal/testutil` (import path `rk/internal/testutil`, regular `.go` files importable from `_test.go` files in other packages) SHALL provide the layered stub-executable API:

- `WriteStub(t *testing.T, dir, name, script string)` — writes `script` as an executable (0o755) file `name` into `dir`; `t.Helper()`; `t.Fatalf("WriteFile stub %s: %v", name, err)` on error (the exact body of the current duplicated helper).
- `StubOnPath(t *testing.T, name, script string) string` — composes `t.TempDir()` + `WriteStub` + PATH **prepend** preserving the original (`t.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))`); returns the dir. PATH-prepend is the opt-in layer — PATH-*replacing* callers keep calling `WriteStub` + their own `t.Setenv("PATH", dir)`.

- **GIVEN** a test needing a fake executable on disk
- **WHEN** it calls `testutil.WriteStub(t, dir, "wt", script)`
- **THEN** `dir/wt` exists with mode 0o755 and the script bytes, and a write error fails the test
- **GIVEN** a test needing a fake executable resolvable via PATH without clobbering the rest of PATH
- **WHEN** it calls `testutil.StubOnPath(t, "brew", script)`
- **THEN** `brew` resolves to the stub, the original PATH entries remain resolvable, and PATH is restored after the test via `t.Setenv` cleanup

#### R2: Deadline-poll helpers in `internal/testutil`
The same package SHALL provide the two poll-loop variants (both `t.Helper()`, fixed ~50ms poll interval, timeout a per-call argument):

- `WaitUntil(t *testing.T, timeout time.Duration, cond func() bool) bool` — polls `cond` until true or timeout; returns whether `cond` succeeded (fall-through variant — caller asserts after).
- `MustWaitUntil(t *testing.T, timeout time.Duration, cond func() bool, msg string, args ...any)` — fail-on-expiry variant: `t.Fatalf(msg, args...)` when `WaitUntil` returns false.

- **GIVEN** a condition that becomes true within the timeout
- **WHEN** `WaitUntil` is called
- **THEN** it returns `true` promptly (cond is checked before the first sleep)
- **GIVEN** a condition that never becomes true
- **WHEN** `MustWaitUntil` is called with a 100ms timeout
- **THEN** the test fails via `t.Fatalf` with the given message after ~100ms

#### R3: Cluster-4 migration (stub-executable call sites)
The five stub-fixture members SHALL be migrated to `testutil` with **zero behavior change**:

- `internal/riff/riff_test.go` — local `writeStub` (:435) deleted; its 6 call sites become `testutil.WriteStub(...)`; `stubFab` (:425) stays as a thin local convenience delegating to `testutil.WriteStub` (fixed name `"fab"`, returns the `t.TempDir()`).
- `internal/wt/wt_test.go` — local `writeStub` (:81) deleted; its 5 call sites become `testutil.WriteStub(...)`; call-site PATH handling (`t.Setenv("PATH", dir)` — replacement) unchanged.
- `cmd/rk/upgrade_test.go` — `installFakeBrew` (:364) becomes a thin local wrapper over `testutil.StubOnPath(t, "brew", script)` (it has two callers — `withFakeBrew` and a direct call at :428 — so the wrapper reads better than inlining); `withFakeBrew` printf-formatting convenience stays local.
- `internal/daemon/daemon_test.go:834` — inline fake-serve `os.WriteFile(..., 0o755)` becomes `testutil.WriteStub(t, dir, "fake-serve", "#!/bin/sh\nsleep 300\n")` with `script := filepath.Join(dir, "fake-serve")` preserved for `startSession(script)`.

- **GIVEN** the migrated test files
- **WHEN** `go test ./...` runs in `app/backend`
- **THEN** all tests pass with identical semantics (same stub bytes, same modes, same PATH replacement/prepend behavior per site)

#### R4: Cluster-8 migration (deadline-poll loops)
The inline `deadline := time.Now().Add(...)` + sleep poll loops SHALL be replaced with `WaitUntil`/`MustWaitUntil`, choosing the variant matching each site's current expiry behavior:

- `internal/tmuxctl/supervisor_test.go` — 5 loops (:147, :251, :288, :299, :364; the intake counted 4 `deadline :=` declarations but :299 reassigns the :288 variable for a distinct second loop — all 5 migrate).
- `internal/tmuxctl/client_test.go` — 3 loops (:178, :233, :444). The :139 loop (`fakeSleep.triggerNext`) stays **bespoke**: it returns a value from inside the loop and uses a deliberately tight 2ms poll (permitted by intake assumption 5).
- `internal/tmuxctl/integration_test.go` — 1 loop (:67).
- `api/relay_test.go` — 2 loops (:506 fail-after-fall-through waiting for tmux clients, `clients` captured by the cond closure for the post-loop assertion; :551 fall-through with `t.Errorf` after).
- `api/terminals_ws_test.go` — 2 loops (:110 with loop-computed `echoIdx`/`aFramesBefore` captured by the cond closure; :206 fall-through with post-loop assertions).

Fail-on-expiry sites whose failure message embeds state computed inside the loop use `if !testutil.WaitUntil(...) { t.Fatalf(..., <fresh state>) }` so the diagnostic reflects the state at failure time (MustWaitUntil's `args` evaluate eagerly at call time); static-message fail sites use `MustWaitUntil`.

- **GIVEN** each migrated loop site
- **WHEN** the awaited condition is met / not met within its timeout
- **THEN** the test proceeds / fails exactly as before (Fatalf sites still Fatalf with an informative message; fall-through sites still run their post-loop assertions)

### Non-Goals

- `internal/desktop/installed_test.go:14` `writeFakeBundle` — writes a directory bundle, different behavior. NOT touched (explicit intake exclusion).
- No production (non-`_test.go`) code changes anywhere; no exported PATH-replacement convenience in testutil (replacement stays at call sites).
- No dedicated `_test.go` for testutil — the package is exercised by every migrated caller (per intake Impact).
- Timeout values stay per-site arguments (2s/3s today); no normalization.

#### R5: Verification gate
`cd app/backend && go test ./...` MUST be green after migration, and `git status` MUST show only test files plus the new `internal/testutil` package changed.

- **GIVEN** the completed migration
- **WHEN** `cd app/backend && go test ./...` runs
- **THEN** all packages pass
- **AND** no non-test production file is modified

## Tasks

### Phase 1: Setup

- [x] T001 Create `app/backend/internal/testutil/stub.go` — package doc comment, `WriteStub`, `StubOnPath` per R1 <!-- R1 -->
- [x] T002 [P] Create `app/backend/internal/testutil/wait.go` — `WaitUntil`, `MustWaitUntil` per R2 <!-- R2 -->

### Phase 2: Core Implementation (cluster-4 migration)

- [x] T003 Migrate `app/backend/internal/riff/riff_test.go`: delete local `writeStub`, delegate `stubFab` to `testutil.WriteStub`, convert 6 `writeStub` call sites; prune now-unused imports <!-- R3 -->
- [x] T004 [P] Migrate `app/backend/internal/wt/wt_test.go`: delete local `writeStub`, convert 5 call sites; prune now-unused imports <!-- R3 -->
- [x] T005 [P] Migrate `app/backend/cmd/rk/upgrade_test.go`: `installFakeBrew` body becomes `testutil.StubOnPath(t, "brew", script)`; prune now-unused imports <!-- R3 -->
- [x] T006 [P] Migrate `app/backend/internal/daemon/daemon_test.go:834`: inline fake-serve write becomes `testutil.WriteStub`; keep `script` path for `startSession` <!-- R3 -->

### Phase 3: Core Implementation (cluster-8 migration)

- [x] T007 Migrate `app/backend/internal/tmuxctl/supervisor_test.go` 5 loops (:147, :251, :288, :299, :364) to `WaitUntil`/`MustWaitUntil` per R4 variant mapping <!-- R4 -->
- [x] T008 [P] Migrate `app/backend/internal/tmuxctl/client_test.go` loops :178, :233, :444; leave :139 (`triggerNext`) bespoke with a brief comment <!-- R4 -->
- [x] T009 [P] Migrate `app/backend/internal/tmuxctl/integration_test.go:67` <!-- R4 -->
- [x] T010 [P] Migrate `app/backend/api/relay_test.go` loops :506, :551 <!-- R4 -->
- [x] T011 [P] Migrate `app/backend/api/terminals_ws_test.go` loops :110, :206 <!-- R4 -->

### Phase 4: Verification

- [x] T012 Run `cd app/backend && go test ./...`; fix any failures; confirm via `git status` that only test files + `internal/testutil` changed <!-- R5 -->

## Execution Order

- T001 blocks T003–T006 (they import `testutil.WriteStub`/`StubOnPath`)
- T002 blocks T007–T011 (they import `WaitUntil`/`MustWaitUntil`)
- T012 runs last

## Acceptance

### Functional Completeness

- [x] A-001 R1: `rk/internal/testutil` exports `WriteStub` (0o755 write, Fatalf on error) and `StubOnPath` (TempDir + PATH-prepend preserving original via `t.Setenv`, returns dir) — `stub.go:15,26`; probe-verified: mode is exactly 0o755, script bytes exact, PATH prefixed with stub dir and suffixed with the original
- [x] A-002 R2: `rk/internal/testutil` exports `WaitUntil` (returns bool, ~50ms poll, cond checked before first sleep) and `MustWaitUntil` (Fatalf on expiry); both call `t.Helper()` — `wait.go:15,33`; probe-verified including `t.Helper()` attribution (failure reported at the call site, not `wait.go`)
- [x] A-003 R3: No local `writeStub` remains in `riff_test.go`/`wt_test.go`; `stubFab` and `installFakeBrew` are thin delegates to testutil; the daemon fake-serve block uses `WriteStub` — repo-wide grep for `writeStub` returns zero definitions
- [x] A-004 R4: No inline `deadline := time.Now().Add` + sleep poll loop remains at the 13 listed sites except the noted bespoke `client_test.go` `triggerNext` loop — grep confirms exactly one remaining (`client_test.go:142`), carrying a justifying comment; 13 migrated call sites counted

### Behavioral Correctness

- [x] A-005 R3: PATH semantics preserved per site — riff/wt call sites still *replace* PATH (`t.Setenv("PATH", dir)`); upgrade_test still *prepends* (original PATH preserved) — the 10 riff/wt `t.Setenv("PATH", dir)` lines are untouched by the diff; `StubOnPath` prepend probe-verified
- [x] A-006 R4: Each migrated loop keeps its expiry behavior (Fatalf sites fail with informative messages evaluated at failure time; fall-through sites keep their post-loop assertions) and its original timeout value — all 13 timeouts diffed against HEAD and identical (2s ×11, 3s ×2); every `if !WaitUntil` site maps to an original Fatalf-on-expiry, every discarded-return site to an original fall-through

### Removal Verification

- [x] A-007 R3: The two verbatim `writeStub` copies and the inline daemon `os.WriteFile` fake-serve block are gone; no dead helpers remain in migrated files (unused imports pruned) — zero `os.WriteFile(..., 0o755)` remain in any `_test.go`; imports verified still-used (compilation would fail otherwise)

### Scenario Coverage

- [x] A-008 R5: `cd app/backend && go test ./...` passes green — full suite run with `-count=1` (uncached): all 20 packages ok; `go vet ./...` also clean

### Edge Cases & Error Handling

- [x] A-009 R1: `WriteStub` failure path fails the test (Fatalf), matching the original helper's error handling — `stub.go:17-19` retains the original body verbatim including the `"WriteFile stub %s: %v"` message
- [x] A-010 R4: `WaitUntil` with an immediately-true cond returns without sleeping (no added latency for fast-settling sites) — probe-verified: returns in <10ms with a 5s timeout; timeout path probe-verified at ~100ms for a never-true cond

### Code Quality

- [x] A-011 Pattern consistency: testutil follows surrounding Go test conventions (`t.Helper()`, doc comments per exported symbol, no magic values beyond the documented 0o755/50ms constants) — `waitPollInterval` is a named const; `gofmt` clean on both new files
- [x] A-012 No unnecessary duplication: all migrated sites use the shared helpers; `internal/desktop/installed_test.go` `writeFakeBundle` untouched (excluded by design, not duplication) — `git diff --stat internal/desktop/` is empty; the exclusion is substantively correct (MkdirAll of a bundle tree + 0o644 plist, not a 0o755 executable)
- [x] A-013 Tests-only scope: no production (non-`_test.go`, non-testutil) file modified; no behavior change to what the tests prove (constitution Test Integrity) — zero non-test `.go` files in `git status`; `go list -deps ./cmd/rk` confirms neither `rk/internal/testutil` nor `testing` is linked into the production binary

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- `cmd/rk/upgrade_test.go:365` `installFakeBrew` — now a 2-line pass-through (`t.Helper()` + one `testutil.StubOnPath` call). Deletable by having `withFakeBrew` and the `:423` caller invoke `testutil.StubOnPath(t, "brew", ...)` directly; kept per plan assumption 5 (two callers, preserves the `brew` domain name at both). Judgment call, not dead code.
- `cmd/rk/upgrade_test.go:439` `readyDeadline` poll loop — a `MustWaitUntil`-shaped loop (10ms poll on `os.Stat(ready)`, `t.Fatal` on 5s expiry, static message) that the cluster-8 sweep missed because the intake enumerated sites by the `deadline :=` identifier. The file already imports `testutil`, so this is a one-line follow-up; out of this change's declared scope.
- `api/relay_test.go:145,178,236` and `api/sse_subscriber_test.go:116,416` — NOT deletion candidates despite matching the `time.Now().Before(...)` grep: the relay three are blocking `conn.ReadMessage()` frame-readers (inexpressible as `cond func() bool`) and the sse two are fixed-duration drain loops that must not exit early. Recorded here so a future sweep does not mistake them for missed migrations.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Import path is `rk/internal/testutil` (module `rk` per `app/backend/go.mod`); importable from `cmd/rk` and `api` since `internal/` is rooted at the module | Read directly from go.mod; Go internal-package rule is deterministic | S:90 R:95 A:100 D:95 |
| 2 | Confident | `WaitUntil` uses a fixed ~50ms poll interval even though existing sites poll at 2–50ms (intake's "every site sleeps 50ms" is inaccurate — supervisor 5–10ms, client 5ms, terminals_ws 2ms) | Intake specifies ~50ms; all migrated conditions are monotonic with ≥2s deadlines, and cond is checked before the first sleep, so a coarser interval adds ≤48ms latency and no flakiness | S:70 R:90 A:85 D:75 |
| 3 | Confident | supervisor_test.go has 5 loops, not the intake's 4 — :299 reassigns the :288 `deadline` for a distinct second loop; all 5 migrated | The intake counted `deadline :=` declarations; migrating the reassigned loop is squarely within "replace each inline deadline-poll loop" intent | S:75 R:95 A:90 D:85 |
| 4 | Confident | Fail sites whose Fatalf message embeds loop-computed state (supervisor :147/:251, client :444) use `if !WaitUntil { t.Fatalf(fresh state) }` instead of `MustWaitUntil` | `MustWaitUntil` args evaluate eagerly at call time and would log stale (pre-wait) state; both forms are fail-on-expiry so intake behavior is preserved | S:70 R:95 A:90 D:80 |
| 5 | Confident | `installFakeBrew` kept as a local thin wrapper (not inlined) — it has two callers (`withFakeBrew` and a direct call at :428) | Intake offers "wrapper or delete, whichever reads better"; two call sites make the wrapper the better read | S:75 R:95 A:90 D:80 |
| 6 | Confident | `client_test.go:139` `triggerNext` stays bespoke | Explicitly permitted by intake assumption 5 (returns a value from inside the loop; tight 2ms poll is deliberate for a fixture invoked repeatedly) | S:80 R:95 A:90 D:85 |
| 7 | Confident | No dedicated `_test.go` for testutil; two files (`stub.go`, `wait.go`) | Intake Impact says "one or two small `.go` files" and that the package "is exercised by every migrated caller"; code-quality's test mandate targets features/fixes, and this is a tests-only refactor | S:75 R:90 A:85 D:80 |

7 assumptions (1 certain, 6 confident, 0 tentative).
