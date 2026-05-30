# Plan: Unify Test Socket Reaping

**Change**: 260530-cf3g-unify-test-socket-reaping
**Status**: In Progress
**Intake**: `intake.md`
**Spec**: `spec.md`

## Tasks

### Phase 1: Setup

<!-- Shared helpers + identity-check rename that everything else depends on. -->

- [x] T001 Add exported `IsTestServerName(name string) bool { return strings.HasPrefix(name, "rk-test-") }` in `app/backend/internal/tmux/tmux.go`, replacing `IsGoTestServerName` and its 5-prefix allowlist (delete the old function + comment). Keep the `"rk-test-"` literal in this single place. <!-- A-001 A-012 -->
- [x] T002 [P] Add a shared test naming helper `testSocketName(role string) string` returning `fmt.Sprintf("rk-test-%s-%d-%d", role, os.Getpid(), time.Now().UnixNano())` to the `tmux` package test support (`app/backend/internal/tmux/main_test.go`) and a duplicate to the `api` package test support (`app/backend/api/main_test.go`). For `internal/tmuxctl` and `internal/daemon`, add a small local helper in their existing `_test.go` files (Go test-package privacy — match the duplicated-`parseTestSocketPID` precedent). <!-- A-002 A-006 -->

### Phase 2: Core Implementation

<!-- PID parsing, sweep timing, identity-check consumers, reaper rewrite. Order by dependency. -->

- [x] T003 Rewrite `parseTestSocketPID` (both copies: `app/backend/internal/tmux/main_test.go`, `app/backend/api/main_test.go`) to parse the PID as the SECOND-TO-LAST hyphen field: require `rk-test-` prefix, `strings.Split(name, "-")`, take element `len-2`, `strconv.Atoi`; return `ok=false` when prefix missing, fewer than 2 fields after prefix, or non-numeric. Update `testSocketPrefixes` (now just `rk-test-`) and the stale comments. <!-- A-004 A-013 A-014 -->
- [x] T004 Convert BOTH `TestMain` (`app/backend/internal/tmux/main_test.go`, `app/backend/api/main_test.go`) from pre-sweep to post-sweep: `code := m.Run(); sweepDeadTestSockets(); os.Exit(code)`. Drop the pre-sweep entirely. Keep `sweepDeadTestSockets` PID-scoped (dead owners only, `parseTestSocketPID` + `testPIDAlive`) and its `exec.CommandContext` + 5s timeout kill. Update the doc comments. <!-- A-007 A-008 A-016 A-017 A-022 -->
- [x] T005 Update `app/backend/internal/tmuxctl/supervisor.go` `isTmuxSocketCandidate` to call `tmux.IsTestServerName` instead of `tmux.IsGoTestServerName`; keep the resurrection guard and update the stale comment (drop the rk-e2e-not-skipped note since e2e is now `rk-test-e2e-*` and IS skipped as a resurrection guard). <!-- A-011 A-020 -->
- [x] T006 Delete the test-socket hide filter in `app/backend/api/servers.go` (~lines 20-37). `handleServersList` MUST return all servers: drop the `IsGoTestServerName` loop, use `rawNames` directly as `names`, keep the empty-list short-circuit + concurrent session-count fan-out + alphabetical sort. Remove the now-unused `tmux` import if it is no longer referenced. <!-- A-010 A-019 A-021 -->
- [x] T007 Rewrite the manual reaper classification in `app/backend/internal/tmux/reaper.go` to brute-force-by-prefix: add a `prefix string` and `dryRun bool` parameter path. New rules — match = `strings.HasPrefix(name, prefix)`; unconditional skips for `ControlAnchorSessionName` (`_rk-ctl`) and the production daemon server (`rk-daemon`, named const) even with the prefix matching; live server → Kill, socket file → Remove, `.lock` file → Remove. NO liveness probe, NO e2e exclusion, NO `.lock` inheritance. Delete `needsProbe`; classification decides kill-vs-remove by file kind (socket vs `.lock`/dead) not by PID probe. Update the doc comments and `ReapAction` const comments. <!-- A-003 A-009 A-015 A-018 A-023 -->
- [x] T008 Add the dangerous-prefix guard to `ReapTestServers` / its caller path: empty prefix or `len(prefix) <= 3` MUST error unless `force` is set. Surface `force` through the call signature. <!-- A-015 -->

### Phase 3: Integration & Edge Cases

<!-- Wire the cobra command, update the 7 naming sites, e2e naming, fix tests. -->

- [x] T009 Rewrite the cobra command in `app/backend/cmd/rk/reaper.go`: add `--prefix <p>` flag (default `rk-test`), add `--yes`/`--force` action flag (dry-run is the DEFAULT when neither is passed). Keep `--dry-run` as an explicit alias for the default preview. Wire `ReapTestServers(ctx, prefix, dryRun, force)`. Update `Long` help text per Domain F (brute-force-by-prefix, no liveness protection, dry-run default + `--yes` to act, "do not run rk reaper while tests are running"). Update `renderDryRun`/`renderReapSummary` if signatures shift. <!-- A-005 A-024 A-018 -->
- [x] T010 Update all 7 Go test naming sites to call `testSocketName(role)`: `tmux_test.go:967` `withSessionOrderTmux` (`unit`), `tmux_test.go:1115` `withGroupedSessionTmux` (`unit`), `board_test.go` (delegates, no change beyond delegate), `api/relay_test.go:28` `withRelayTmux` (`relay`), `cmd/rk/serve_sweep_test.go:76` (`unit`), `internal/tmuxctl/integration_test.go` const→`testSocketName("tmuxctl")`, `internal/daemon/daemon_test.go` const→`testSocketName("daemon")`. No inline `fmt.Sprintf("rk-test-...")` literal remains. <!-- A-002 A-006 -->
- [x] T011 Rewrite `app/backend/internal/tmux/reaper_test.go`: delete the `.lock`-inheritance + e2e-skip cases; add cases for brute-force prefix match, dry-run-default (no `--yes` → no mutation), unconditional `_rk-ctl`/`rk-daemon` skip even with force, dangerous-prefix refusal (empty + `rk-`), short-prefix permitted with force, and `--prefix` targeting a custom prefix. <!-- A-009 A-015 A-018 A-023 -->
- [x] T012 Invert the `app/backend/api/servers_test.go` fixture: rename/rewrite `TestHandleServersList_HidesGoTestServers` to assert ALL servers (including `rk-test-*` orphans and `rk-e2e-*`/`rk-test-e2e-*`) are returned — the former hide-assertion is inverted. <!-- A-010 A-019 -->
- [x] T013 Add a concurrent-sparing post-sweep test (in `app/backend/internal/tmux` and/or `api` test support area, e.g. `socketsweep_test.go`) that proves `sweepDeadTestSockets` spares a live-PID `rk-test-*` socket while reaping a dead-PID `rk-test-*` orphan, using a temp socket dir and `os.Getpid()` (live) vs a known-dead PID. <!-- A-007 A-016 -->
- [x] T014 [P] Rename the e2e TS harness: `scripts/test-e2e.sh` `E2E_TMUX_SERVER="rk-test-e2e"` (was `rk-e2e`) + update trap glob comment; `app/frontend/tests/e2e/global-teardown.ts` default prefix `rk-test-e2e` (was `rk-e2e`). <!-- A-025 -->
- [x] T014b Fix the `kill 0` process-group grenade in `scripts/test-e2e.sh`: launch the dev server detached via `setsid bash -c "RK_PORT=$E2E_PORT exec just dev" &`, capture `DEV_PID=$!` then `DEV_PGID=$DEV_PID` (setsid → `$!` == PGID), and in `cleanup` replace `kill 0` with a guarded `kill -- "-$DEV_PGID"`. Keep the `rk-test-e2e*` socket reap loop. Document WHY in the cleanup comment (a non-detached `kill 0` signals the caller's group → SIGTERMs live tmux servers/`-CC` clients sharing it; proven root cause of kit/abbb/runWork dying mid-session). Verified: `bash -n` passes, `$! == PGID`, negative-PGID kill spares the parent group. <!-- A-027 -->
- [x] T014c [rework, review cycle 1] Eliminate ALL remaining `rk-e2e` (non-`rk-test-e2e`) literals surfaced by review: `justfile` `pw` recipe default `E2E_TMUX_SERVER` `rk-e2e`→`rk-test-e2e` (MUST-FIX — `just pw` would otherwise create an un-swept, resurrection-prone `rk-e2e` orphan); the `?? "rk-e2e"` fallback in 13 e2e specs → `rk-test-e2e`; stale `rk-e2e` mentions in companion `.spec.md` docs and the `global-teardown.ts` comment. Verified: zero bare `rk-e2e` references remain in app/frontend/tests, scripts, justfile; `tsc --noEmit` passes. <!-- A-028 -->
- [x] T015 [P] Rename secondary servers in `app/frontend/tests/e2e/boards-multi-server.spec.ts` (`rk-test-e2e-multi-${process.pid}-${suffix}`) and `app/frontend/tests/e2e/sidebar-server-coupling.spec.ts` (`rk-test-e2e-coupling-${process.pid}-${suffix}`), keeping a single hyphen-free `${suffix}` token and `process.pid` as the second-to-last field; update the default `TMUX_SERVER_A` fallback to `rk-test-e2e`. <!-- A-006 A-025 A-026 -->

### Phase 4: Polish

<!-- Companion docs + verification. -->

- [x] T016 [P] Update the companion `.spec.md` files (`app/frontend/tests/e2e/boards-multi-server.spec.md`, `app/frontend/tests/e2e/sidebar-server-coupling.spec.md`) to reflect the new `rk-test-e2e-*` primary + secondary server names (constitution Test Companion Docs). <!-- A-026 -->
- [x] T017 Run verification gates: `just test-backend` (primary), `cd app/frontend && npx tsc --noEmit`; fix failures. <!-- A-007 A-016 A-022 A-023 -->

## Execution Order

- T001, T002 (Setup) block everything else (identity helper + naming helper).
- T003 blocks T004 (sweep uses parseTestSocketPID) and T013 (sparing test uses the parser).
- T007 blocks T008, T009, T011 (reaper core before guard, cobra wiring, tests).
- T002 blocks T010 (naming sites use the helper).
- T010, T014, T015 are independent file edits ([P] within phase 3 where marked).
- T017 runs last.

## Acceptance

### Functional Completeness

- [x] A-001 Unified socket naming: every Go test socket follows `rk-test-<role>-<pid>-<ns>`; the prefixes `rk-relay-test-`, fixed `rk-tmuxctl-test`, fixed `rk-daemon-test` no longer appear. Verified: no live usage of old fixed names; all helpers emit `rk-test-%s-%d-%d`.
- [x] A-002 Shared helper: `testSocketName(role)` returns `rk-test-<role>-<pid>-<ns>` and all seven Go naming sites route through it (or a package-local equivalent) — no inline `fmt.Sprintf("rk-test-...")` socket literal remains. The only inline `rk-test-` literals are (a) the helper definitions themselves and (b) `socketsweep_test.go:107,109` which intentionally constructs live-vs-dead-PID sockets for the sparing test (cannot use the helper, which always embeds the live PID) — neither is a "naming site" per the spec.
- [x] A-003 Brute-force reaper: bare `rk reaper` ≡ `--prefix rk-test`; matches every `rk-test*` server, socket, and `.lock`; `--prefix <p>` applies the same to `<p>*`; no `parseTestSocketPID`/`testPIDAlive`/e2e-skip/`.lock`-inheritance in the reap path. Verified in `reaper.go` `classifyReap` (name + file-kind only) and `TestClassifyReap`/`TestReapCandidates_*`.
- [x] A-004 PID parse: `parseTestSocketPID` extracts the second-to-last hyphen field (`fields[len-2]`), requires the `rk-test-` prefix, and returns `ok=false` for missing-prefix / too-few-fields (`< 5`) / non-numeric. Verified in `TestParseTestSocketPID` (both packages).
- [x] A-005 Reaper CLI: `--prefix` (default `rk-test`), `--yes`/`--force` action gate (`act := (reaperYes || reaperForce) && !reaperDryRun`), dry-run default, `--dry-run` retained as explicit alias that always wins.
- [x] A-006 E2E PID embedding: secondary Playwright servers are `rk-test-e2e-multi-${process.pid}-${suffix}` / `rk-test-e2e-coupling-${process.pid}-${suffix}` with a hyphen-free `slice(-6)` suffix; primary stays fixed `rk-test-e2e`. (Also caught a third site `multi-server-sidebar.spec.ts` → `rk-test-e2e-msb-${process.pid}-...` not enumerated in the plan.)
- [x] A-007 Sweep timing: both `TestMain` run the post-sweep shape `code := m.Run(); sweepDeadTestSockets(); os.Exit(code)`; `TestSweepDeadTestSockets_sparesLivePIDReapsDead` proves live-PID sparing / dead-PID reaping.

### Behavioral Correctness

- [x] A-008 Post-sweep, not pre-sweep: no `sweepDeadTestSockets()` call exists before `m.Run()` in either package. Verified in both `main_test.go` TestMain bodies.
- [x] A-009 Dry-run default mutates nothing: bare reaper / `--prefix` with no `--yes`/`--force` prints kill/remove labels and touches no file or server. Verified in `TestReapCandidates_dryRunDefaultMutatesNothing`.
- [x] A-010 `/api/servers` lists everything: the hide filter is gone; orphan `rk-test-*` and `rk-e2e-*`/`rk-test-e2e-*` servers are returned alongside real servers. Verified in `servers.go` (uses `ListServers` output directly) and `TestHandleServersList_ReturnsAllServersIncludingTestSockets`.
- [x] A-011 Single-prefix identity: `IsTestServerName` returns true for `rk-test-*` (including `rk-test-e2e-multi-*`) and false for `runkit`; tmuxctl supervisor uses it and keeps the resurrection guard. Verified in `tmux.go:1162`, `supervisor.go:38`, `TestIsTestServerName`, `TestSupervisor_SkipsGoTestSockets`.
- [x] A-012 Hyphenated-role parse: `rk-test-e2e-coupling-48213-<ns>` yields PID 48213; `rk-test-unit-48213-<ns>` yields 48213. Verified in `TestParseTestSocketPID` (both packages).

### Removal Verification

- [x] A-013 `IsGoTestServerName` and its 5-prefix allowlist are deleted; no references remain in production or test code. Verified by grep: only `IsTestServerName` exists.
- [x] A-014 Old left-index PID parse is gone; `testSocketPrefixes` no longer lists `rk-relay-test-`. Verified: replaced by a single `testSocketPrefix = "rk-test-"` const + `fields[len-2]` parse.
- [x] A-015 Reaper PID-probe (`classifyReap` liveness branch), `rk-e2e-*` skip, and `.lock`-inherits-base-server logic are removed; `needsProbe` deleted. Verified: `needsProbe` is gone; `classifyReap` is a pure name/file-kind function; the new `probeNeeded` helper only gates the kill-vs-remove subprocess (not a liveness *match* gate).
- [x] A-016 The `TestMain` pre-sweep is removed in both packages. Verified in both TestMain bodies.
- [x] A-017 Epoch-suffix e2e naming (`Date.now().toString().slice(-6)`) is replaced by `process.pid` for secondary servers. (`slice(-6)` is retained only as the trailing hyphen-free `<ns>` token; the PID is now `process.pid`.)
- [x] A-028 No bare `rk-e2e` (non-`rk-test-e2e`) literal remains anywhere in `app/frontend/tests/`, `scripts/`, or `justfile` — including the `just pw` recipe default and the 13 spec `?? "rk-e2e"` fallbacks. Verified by grep (zero matches) + `tsc --noEmit` passes. Closes the `just pw` resurrection-leak the first review found.

### Scenario Coverage

- [x] A-018 Reaper unconditional skips: `_rk-ctl` and live `rk-daemon` survive even under `rk reaper --prefix rk --yes` (covered by `TestReapCandidates_skipsControlAnchorAndDaemon`). Both `classifyReap` and `probeNeeded` short-circuit on `ControlAnchorSessionName || productionDaemonServer` before the prefix check.
- [x] A-019 servers_test.go fixture asserts all servers (including `rk-test-*`) are returned — the prior hide-assertion is inverted. Verified in `TestHandleServersList_ReturnsAllServersIncludingTestSockets`.
- [x] A-020 Orphan `rk-test-*` sockets are excluded by `IsTestServerName` in the supervisor candidate filter (no resurrection on bootstrap). Verified in `supervisor.go:38` + `TestSupervisor_SkipsGoTestSockets` (e2e now skipped too).

### Edge Cases & Error Handling

- [x] A-021 Concurrent live socket spared: `sweepDeadTestSockets` reaps a dead-PID `rk-test-*` orphan and spares a live-PID one (asserted by `TestSweepDeadTestSockets_sparesLivePIDReapsDead`).
- [x] A-022 `testPIDAlive` keeps the biased-alive interpretation (ESRCH = dead, any other error = alive/spare). Verified in both `main_test.go` copies + `TestTestPIDAlive`.
- [x] A-023 Dangerous-prefix guard: empty prefix or `len(prefix) <= 3` is refused unless `--force`; refused path reaps nothing. Verified in `ReapTestServers` (`len(prefix) <= minSafePrefixLen && !force`) + `TestReapTestServers_dangerousPrefixGuard` — including the security-critical case that `--yes` (act=true) alone does NOT bypass the guard, only `--force` does.
- [x] A-024 Reaper help text states brute-force-by-prefix + no liveness protection + dry-run default + "do not run rk reaper while tests are running". Verified in `reaperCmd.Long`.
- [x] A-027 E2E teardown isolation: `scripts/test-e2e.sh` contains no `kill 0`; the dev server is launched via `setsid` into its own process group and cleanup kills only `kill -- "-$DEV_PGID"`, so a tmux server in the caller's process group survives the e2e teardown. Root cause documented in the cleanup comment.

### Code Quality

- [x] A-007Q Pattern consistency: new code follows naming/structure of surrounding tmux + cmd/rk code (helpers, error wrapping, slog warnings). The reaper mirrors `sweepOrphanedRelaySessions`'s log-and-continue + aggregate-error pattern.
- [x] A-008Q No unnecessary duplication: the production `"rk-test-"` literal lives in one place (`IsTestServerName`); existing `KillServer`, `ScanSocketDir`, `socketDirPath`, `probeServerAlive` are reused, not reimplemented. (Cross-package test-helper duplication of `testSocketName`/`parseTestSocketPID`/`testPIDAlive` is forced by Go `_test.go` privacy and explicitly sanctioned by the spec/plan.)
- [x] A-009Q No magic strings: `rk-daemon` skip uses the named const `productionDaemonServer`; the dangerous-prefix length uses `minSafePrefixLen`. The `"rk-test"` reaper default lives as the cobra flag default literal (a reasonable flag-default site, "where practical").
- [x] A-010Q Inline tmux construction avoided: all tmux teardown in the reaper goes through `KillServer`; the post-sweep's `exec.CommandContext(ctx, "tmux", "-L", name, "kill-server")` is in `_test.go` support code (test-only), consistent with sibling test helpers.

### Security

- [x] A-Sec1 All kill/teardown in the reap and sweep paths use `exec.CommandContext` with an explicit timeout and argument slices (via `KillServer` / context-timed exec) — no shell strings anywhere in the reaper or sweep. Verified: reaper kills via `KillServer`; sweep uses `exec.CommandContext(ctx, "tmux", "-L", name, "kill-server")` with a 5s timeout.
- [x] A-Sec2 Socket/`.lock` removal uses `os.Remove` (no shell), and the dangerous-prefix guard prevents an over-broad match from being acted upon without explicit `--force`. Verified in `reapCandidates` (`os.Remove`) and the guard test. Security note: `--yes` does NOT bypass the guard — only `--force` does, so an operator who only confirms (`--yes`) is still protected from a typo'd short prefix.

### Test Companion Docs

- [x] A-026 The modified `.spec.ts` files ship updated sibling `.spec.md` files reflecting the new `rk-test-e2e-*` naming (constitution Test Companion Docs). Note: THREE `.spec.ts` files were modified (`boards-multi-server`, `sidebar-server-coupling`, AND `multi-server-sidebar` — the third was not enumerated in the plan); all three companion `.spec.md` files were updated in the same change, satisfying the constitution.

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- The `rk-daemon` production-skip literal is duplicated in the reaper rather than importing `internal/daemon` (no existing import edge between `internal/tmux` and `internal/daemon`; avoids a needless dependency).

## Deletion Candidates

- `app/frontend/tests/e2e/*.spec.ts` (`?? "rk-e2e"` fallback, 13 files: sse-connection, boards-pin-flow, mobile-layout, mobile-touch-scroll, boards-same-session-multi-pane, sidebar-panels, shell-rotation, session-reorder, api-integration, server-panel-grid, boards-mobile, sync-latency, sidebar-window-sync) — the `process.env.E2E_TMUX_SERVER ?? "rk-e2e"` default is now stale: the harness (`scripts/test-e2e.sh`) always exports `E2E_TMUX_SERVER="rk-test-e2e"`, so the fallback is dead in CI. If one of these specs is ever run standalone (no harness), it creates an `rk-e2e` server that the new `rk-test-e2e*` teardown glob will NOT reap — a latent standalone-run leak. Candidate to retarget the fallback to `rk-test-e2e` for consistency. (Out of this change's spec scope — flagged for the human; do not auto-delete.)
- `docs/memory/run-kit/tmux-sessions.md` (§ `rk reaper`, § Discovery comment line 88, Decision Log rows for `260529-fww2`/`260529-wtg4`) — describes the now-removed `IsGoTestServerName` 5-prefix allowlist, the `TestMain` pre-sweep, `--dry-run`-only reaper, 2nd-field PID parse, the `rk-e2e-*`-excluded-for-free behavior, and the `/api/servers` visibility note. These descriptions are superseded by this change but are intentionally NOT edited here — memory is rewritten in the hydrate stage (spec Domain F "Memory documents the contract"). Flagged so the hydrate step replaces rather than appends.
