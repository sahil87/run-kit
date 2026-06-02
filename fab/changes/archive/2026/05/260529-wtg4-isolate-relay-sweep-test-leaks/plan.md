# Plan: Isolate Relay Sweep & Stop Test Artifact Leaks

**Change**: 260529-wtg4-isolate-relay-sweep-test-leaks
**Status**: In Progress
**Intake**: `intake.md`
**Spec**: `spec.md`

## Tasks

<!-- Sequential work items for the apply stage. Checked off [x] as completed. -->

### Phase 1: Core tmux helpers (internal/tmux)

<!-- Foundational helpers the sweep and relay handler depend on. -->

- [x] T001 Add `SetSessionOwnerPID(ctx, server, session string, pid int) error` to `app/backend/internal/tmux/tmux.go`, mirroring `SetSessionColor` — session-scoped `set-option -t <session> @rk_owner_pid <pid>` via `tmuxExecServer` with a context timeout. Add the `OwnerPIDOption = "@rk_owner_pid"` named constant alongside `SessionOrderOption`. <!-- A-001 -->
- [x] T002 Add `GetSessionOwnerPID(ctx, server, session string) (string, error)` to `app/backend/internal/tmux/tmux.go`, mirroring `GetSessionOrder`'s unset/no-server handling — `show-options -v -t <session> @rk_owner_pid` via `tmuxExecRawServer`, returning `""` (no error) when the option is unset or the server is unreachable; trims whitespace. <!-- A-002 -->

### Phase 2: pidAlive predicate + sweep scoping (cmd/rk)

<!-- The owner-PID liveness predicate and the sweep that consumes it. -->

- [x] T003 Add `pidAlive(pid int) bool` to `app/backend/cmd/rk/serve_sweep.go` using `syscall.Kill(pid, 0)`: `nil` → true (alive); `ESRCH` → false (dead); `EPERM` → true (spare); any other error → true (bias to spare, leak-not-kill). Note in a comment that it differs from `daemon_portowner.go:processAlive` (which treats EPERM as dead) by design. <!-- A-003, A-005 -->
- [x] T004 [P] Add `app/backend/cmd/rk/serve_sweep_test.go` unit-testing the `pidAlive` mapping: live PID (`os.Getpid()`) → true; a known-dead PID → false. Document the EPERM-spare bias in a comment (EPERM not reliably reproducible in-test). <!-- A-005 -->
- [x] T005 In `sweepOrphanedRelaySessions` (`app/backend/cmd/rk/serve_sweep.go`): keep iterating all servers, the `RelaySessionPrefix` guard, the `_rk-ctl` anchor guard, the 30s ctx, per-server error accumulation, and slog behavior. For each `rk-relay-*` session read `@rk_owner_pid` via `tmux.GetSessionOwnerPID`; reap (`KillSessionCtx`) only when owner is `""` OR not `pidAlive(parsedPid)`. A non-integer/malformed owner is treated as orphan (reap), defensively. A read error is logged + accumulated per-server without aborting. <!-- A-004, A-006, A-007, A-008, A-009 -->

### Phase 3: Relay stamp at creation (api)

<!-- Stamp owner PID before the ephemeral becomes attachable; abort-clean on failure. -->

- [x] T006 In `handleRelay` (`app/backend/api/relay.go`): AFTER `NewGroupedSession` succeeds and the `defer KillSessionCtx` is registered, and BEFORE `SelectWindowInSession`, stamp the ephemeral via `s.tmux.SetSessionOwnerPID(r.Context(), server, ephemeral, os.Getpid())`. On stamp FAILURE: `slog.Warn`, write a WebSocket close with a 4001-style relay-allocation close code, and `return` — the already-registered defer reaps the half-owned ephemeral. <!-- A-010, A-011 -->

### Phase 4: e2e teardown prefix-complete (scripts/, app/frontend)

<!-- Reap every rk-e2e* socket, not just the literal rk-e2e. -->

- [x] T007 [P] In `scripts/test-e2e.sh` `cleanup()`: in addition to `kill 0`, iterate `/tmp/tmux-$(id -u)/${E2E_TMUX_SERVER}*` and `tmux -L "$(basename "$sock")" kill-server` for each socket whose basename starts with `$E2E_TMUX_SERVER`, best-effort (swallow errors). Keep `trap cleanup EXIT`. <!-- A-012, A-013 -->
- [x] T008 [P] In `app/frontend/tests/e2e/global-teardown.ts`: read the socket dir `/tmp/tmux-<uid>/` (uid via `process.getuid()`) with node `fs`, and for every basename starting with `E2E_TMUX_SERVER` (default `rk-e2e`) run `execSync('tmux -L <name> kill-server')` in a per-socket try/catch, best-effort. <!-- A-014 -->

### Phase 5: TestMain dead-PID pre-sweep (internal/tmux, api)

<!-- Self-heal SIGKILL/panic residue before tests run; never touch live-PID or fixed-name sockets. -->

- [x] T009 Add `app/backend/internal/tmux/main_test.go` with `TestMain(m *testing.M)` that, before `m.Run()`, scans `/tmp/tmux-<uid>/` for sockets matching `rk-test-*` and `rk-relay-test-*`, parses the embedded PID (strip the known prefix, take the leading numeric run of the remainder), and kill-servers (`exec.CommandContext` + timeout) only when the PID parses AND is dead per a local `pidAlive`. Never touch fixed-name `rk-daemon-test` / `rk-tmuxctl-test` (no parseable trailing `-<pid>-<ns>`). Never reap a live-PID socket. <!-- A-015, A-016, A-017, A-019 -->
- [x] T010 Add `app/backend/api/main_test.go` with the same `TestMain` dead-PID pre-sweep logic (parse + `pidAlive`, `exec.CommandContext` + timeout). Keep a small duplicated helper rather than exporting test-only production code, per spec guidance. <!-- A-015, A-016, A-017, A-019 -->
- [x] T011 [P] Add a unit test for the PID-parse-from-socket-name logic (in `internal/tmux/main_test.go` or a sibling `*_test.go`): `rk-test-<pid>-<ns>` and `rk-relay-test-<pid>-<ns>` parse the correct PID; `rk-daemon-test` / `rk-tmuxctl-test` parse to "no PID"; non-numeric/malformed → no PID. <!-- A-018, A-019 -->

### Phase 6: Verification

- [x] T012 Run `just test-backend` (after `just setup` if needed); fix root-cause failures and iterate to green. <!-- A-020 --> <!-- All changed packages (api, cmd/rk, internal/tmux) pass. The only failure is pre-existing, environment-induced: internal/sessions/TestFetchPaneMapIntegration fails because the sandbox has no default tmux server (confirmed identical on baseline HEAD with changes stashed); untouched by this change. -->

## Execution Order

- T001, T002 (helpers) block T005 (sweep reads/uses them) and T006 (relay stamps).
- T003 (pidAlive) blocks T004 (its test) and T005 (sweep uses it).
- T009/T010/T011 are independent of the sweep/relay work and of each other (T011 [P] tests the parser used by T009/T010).
- T012 runs last, after all Go code lands.

## Acceptance

### Functional Completeness

- [x] A-001 Stamp setter: `tmux.SetSessionOwnerPID` exists, session-scoped `set-option -t <session> @rk_owner_pid <pid>` via `exec.CommandContext` with timeout, mirroring `SetSessionColor`; `@rk_owner_pid` is a named constant. <!-- tmux.go:914 via tmuxExecServer + context.WithTimeout(ctx, TmuxTimeout); OwnerPIDOption const tmux.go:26 -->
- [x] A-002 Option reader: `tmux.GetSessionOwnerPID` reads `@rk_owner_pid` via `show-options`/`show-option -v` and returns `""` (no error) when unset or server unreachable, mirroring `GetSessionOrder`'s tolerance. <!-- tmux.go:929, show-options -v, swallows invalid/unknown option + no-server/failed-to-connect -->
- [x] A-003 pidAlive semantics: `syscall.Kill(pid,0)` → `nil`=alive, `ESRCH`=dead, `EPERM`=alive(spare), other=alive(spare); biased to spare on ambiguity. <!-- serve_sweep.go:29-35: nil→true, else !errors.Is(ESRCH) → ESRCH false, all others (EPERM incl.) true -->
- [x] A-004 Sweep scoping: `sweepOrphanedRelaySessions` reaps an `rk-relay-*` session only when `@rk_owner_pid` is empty/unstamped OR the owner PID is dead; spares live-owner relays. <!-- serve_sweep.go:106 relayOwnerIsDead gate before KillSessionCtx -->
- [x] A-005 pidAlive test: a unit test asserts live-PID→true and dead-PID→false. <!-- serve_sweep_test.go:15 TestPidAlive (self→true, deadPID→false, PID 1 EPERM→true) -->
- [x] A-010 Relay stamp: `handleRelay` stamps `@rk_owner_pid = os.Getpid()` after `NewGroupedSession`/defer-register and before `SelectWindowInSession`. <!-- relay.go:120 NewGroupedSession → 129 defer KillSessionCtx → 147 SetSessionOwnerPID → 160 SelectWindowInSession (order verified) -->

### Behavioral Correctness

- [x] A-011 Stamp-failure abort-clean: on stamp failure `handleRelay` logs `slog.Warn`, writes a 4001-style relay-allocation WebSocket close, returns, and the already-registered `defer KillSessionCtx` reaps the ephemeral — no unstamped relay survives. <!-- relay.go:147-152: slog.Warn + FormatCloseMessage(4001,...) + return; defer at 129 reaps. Implementation correct, but the abort branch has NO test (mockTmuxOps.setSessionOwnerPIDErr is plumbed but never set by any test) — see A-024 caveat -->
- [x] A-006 Sweep read scope unchanged: the sweep still iterates every server from `tmux.ListServers`; no socket/prefix filter added to the read path (`ListServers`/`/api/servers` untouched). <!-- serve_sweep.go:74 ListServers + 82 ListRawSessionNames unchanged; no read-path filter added -->

### Scenario Coverage

- [x] A-012 Secondary socket reaped on normal completion: shell `cleanup()` kills `rk-e2e` and `rk-e2e-multi-*`/`rk-e2e-coupling-*` secondaries. <!-- test-e2e.sh:15-17 globs /tmp/tmux-$(id -u)/${E2E_TMUX_SERVER}* and kill-servers each -->
- [x] A-013 Secondary socket reaped on interrupt: the `trap cleanup EXIT` glob reaps secondaries even when a spec's `afterAll` never ran (Ctrl-C/SIGINT path). <!-- test-e2e.sh:19 trap cleanup EXIT retained; fires on any exit cause -->
- [x] A-014 Playwright teardown prefix-complete: `global-teardown.ts` kills every `rk-e2e*` socket, best-effort, swallowing already-gone errors. <!-- global-teardown.ts:13-31 readdirSync + startsWith(prefix) + per-socket try/catch -->
- [x] A-015 Dead-PID test socket removed: `TestMain` pre-sweep kills `rk-test-<dead-pid>-*` / `rk-relay-test-<dead-pid>-*` before `m.Run()` in both `internal/tmux` and `api`. <!-- main_test.go (both pkgs): sweepDeadTestSockets() before m.Run(); parseTestSocketPID + testPIDAlive gate -->
- [x] A-016 Live-PID test socket preserved: `TestMain` pre-sweep does NOT reap a `rk-test-<live-pid>-*` socket (no interference with concurrent `go test`). <!-- main_test.go: `if !ok || testPIDAlive(pid) { continue }` skips live PIDs -->
- [x] A-017 Fixed-name sockets untouched: pre-sweep never parses/reaps `rk-daemon-test` / `rk-tmuxctl-test`. <!-- parseTestSocketPID returns ok=false (no prefix match → no parseable PID); covered by socketsweep_test.go TestParseTestSocketPID -->

### Edge Cases & Error Handling

- [x] A-007 Legacy unstamped relay reaped: an `rk-relay-*` with no `@rk_owner_pid` (empty) is treated as orphan and reaped. <!-- relayOwnerIsDead("")→true (serve_sweep.go:43); covered by serve_sweep_test.go TestRelayOwnerIsDead + TestSweepOrphanedRelaySessions_scoping (unstamped case) -->
- [x] A-008 Control anchor never reaped: `_rk-ctl` is skipped by both the prefix guard and the explicit anchor guard. <!-- serve_sweep.go:89 prefix guard + 96 ControlAnchorSessionName guard; asserted in TestSweepOrphanedRelaySessions_scoping -->
- [x] A-009 Per-server isolation: a list/read/kill failure on one server is logged and accumulated; other servers are still processed and startup proceeds. <!-- serve_sweep.go:84/103/111 perServerErrs append + continue; aggregate returned without abort -->
- [x] A-018 Malformed owner/PID parse: a non-integer `@rk_owner_pid` is treated as orphan (reaped) defensively; a socket name with no parseable PID is skipped (not reaped) by the TestMain pre-sweep. <!-- relayOwnerIsDead: strconv.Atoi err→true (reap); parseTestSocketPID: Atoi err→ok=false (skip). Both covered by unit tests -->
- [x] A-019 EPERM bias: pidAlive treats EPERM as alive (spare) — documented as the benign-leak direction (single-uid socket model). <!-- serve_sweep.go:18-28 doc comment; !errors.Is(ESRCH) returns true for EPERM; TestPidAlive(1) asserts EPERM→true -->

### Code Quality

- [x] A-020 Backend tests green: `just test-backend` passes. <!-- affected pkgs api/cmd/rk/internal/tmux all PASS (-count=1); go vet clean. internal/sessions/TestFetchPaneMapIntegration fails — pre-existing env issue (no default tmux server), confirmed against baseline, out of scope -->
- [x] A-021 Pattern consistency: new tmux helpers follow `SetSessionColor`/`GetSessionOrder` naming, error handling, and context-timeout conventions; new code matches surrounding style. <!-- SetSessionOwnerPID mirrors SetSessionColor; GetSessionOwnerPID mirrors GetSessionOrder's unset/no-server tolerance verbatim -->
- [x] A-022 No god functions: `sweepOrphanedRelaySessions` and `handleRelay` stay focused; parse/sweep logic factored into small helpers rather than inlined into a bloated function. <!-- relayOwnerIsDead, pidAlive, parseTestSocketPID, testPIDAlive, sweepDeadTestSockets all small/focused; sweep body ~50 lines -->
- [x] A-023 No duplication: reuse `tmux.KillSessionCtx`, `tmux.ListServers`, `tmux.ListRawSessionNames`, existing constants; do not reimplement tmux interaction or the relay setup-failure close pattern. <!-- sweep reuses existing helpers; relay stamp reuses the 4001 FormatCloseMessage pattern. NOTE: TestMain pre-sweep logic duplicated across internal/tmux & api packages (forced by Go test-symbol isolation) — see Parsimony -->
- [x] A-024 Tests for new behavior: pidAlive mapping and PID-parse logic have unit tests; sweep scoping behavior is covered. <!-- TestPidAlive, TestRelayOwnerIsDead, TestSweepOrphanedRelaySessions_scoping, TestParseTestSocketPID, TestTestPIDAlive, TestSetSessionOwnerPID_roundTrip, TestGetSessionOwnerPID_unsetReturnsEmpty. CAVEAT: the relay stamp-failure abort-clean branch (A-011) has no test — mockTmuxOps.setSessionOwnerPIDErr is plumbed but unexercised (see Should-fix) -->

### Security

- [x] A-025 exec.CommandContext + timeout: every new subprocess call (stamp setter, option reader, TestMain pre-sweep kills) uses `exec.CommandContext` with a context timeout (constitution I / Process Execution). <!-- tmux helpers via tmuxExecServer/tmuxExecRawServer (TmuxTimeout); both main_test.go sweeps use exec.CommandContext + 5s ctx; serve_sweep_test.go tmuxL uses 5s ctx -->
- [x] A-026 No shell-string construction in Go: tmux interaction goes through `internal/tmux` helpers with argument slices; no shell string assembly. The relay name stays a `crypto/rand` 8-hex string — ownership lives in the option, not the name, preserving the injection-closed naming surface. <!-- All Go tmux calls use arg slices. The execSync template-string in global-teardown.ts is TS test-harness (exempt per review scope); shell glob in test-e2e.sh is test-harness (exempt). No shell-string Go subprocess -->

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

None — this change adds new functionality (the `@rk_owner_pid` ownership model, dead-PID pre-sweep, prefix-complete teardown) without making existing code redundant. The startup sweep, relay setup pipeline, and e2e teardown all still exist; they are made smarter/wider, not replaced. The unstamped-relay reap path is retained by design (legacy/orphan handling), so no branch is dead.
