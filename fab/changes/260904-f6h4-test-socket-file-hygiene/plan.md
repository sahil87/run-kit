# Plan: Test-Socket File Hygiene

**Change**: 260904-f6h4-test-socket-file-hygiene
**Intake**: `intake.md`

## Requirements

### Test Infrastructure: Socket-File Removal at Teardown

#### R1: `test-e2e.sh` cleanup removes the socket files of the servers it kills
The `cleanup()` EXIT trap in `scripts/test-e2e.sh` MUST remove the socket file of every server it kills, in both branches: the family-glob branch removes each `$sock` path after its `kill-server` attempt (`rm -f "$sock"`), and the refused-bare-anchor branch removes the primary's exact path (`/tmp/tmux-$(id -u)/$E2E_TMUX_SERVER`) after killing it. Removal MUST be best-effort and MUST NOT change the branch structure, the bare-anchor refusal semantics, or the `|| true` posture.

- **GIVEN** an e2e run whose family created a primary and N secondary servers (some possibly already dead from spec `afterAll` kills)
- **WHEN** the EXIT trap fires
- **THEN** every `${E2E_TMUX_FAMILY}*` socket file present in `/tmp/tmux-$(id -u)/` is removed after its kill attempt — including files of already-dead servers the loop visits
- **AND** no file outside the family glob is touched

- **GIVEN** a bare family anchor (`rk-test-e2e` / `rk-test-e2e-`)
- **WHEN** the trap fires
- **THEN** the glob sweep is still refused, the exact primary is killed, and only the primary's socket file is removed

#### R2: Playwright `global-teardown.ts` unlinks the socket files of the servers it kills
`app/frontend/tests/e2e/global-teardown.ts` MUST best-effort remove `/tmp/tmux-${uid}/${name}` after each per-socket `kill-server` attempt, in a try/catch so a missing file or unreadable dir never fails teardown. When `process.getuid?.()` is unavailable, file removal is skipped (kill-only, the pre-change behavior — the shell trap owns the file then). The bare-anchor refusal keeps its scan-skip and gains the exact-name removal for the primary.

- **GIVEN** a completed Playwright run with primary + secondaries in the kill set
- **WHEN** `globalTeardown()` runs with a derived (non-bare) anchor and a readable socket dir
- **THEN** each killed socket's file is unlinked after its kill attempt
- **AND** an unlink failure (already gone, perms) is swallowed

#### R3: The seven Go TestMain post-sweeps remove the socket files they reap
`sweepDeadTestSocketsIn` (and its six sibling copies in `api`, `cmd/rk`, `internal/daemon`, `internal/tmuxctl`, `internal/snapshot`, `internal/remote` `main_test.go` files) MUST call best-effort `os.Remove(filepath.Join(socketDir, name))` after the existing `kill-server` attempt for each socket it acts on. The e2e-family exclusion (checked before the PID parse), the PID gate (own-PID or dead-PID only; live-PID spared), the no-parse skip, and the best-effort posture MUST all be preserved exactly. All seven copies MUST be updated identically.

- **GIVEN** a socket dir holding an own-PID socket, a dead-PID socket, a live-other-PID socket, and a dead-PID `rk-test-e2e-*` socket
- **WHEN** the sweep runs
- **THEN** the own-PID and dead-PID socket files are removed (kill attempted first; a failed kill on an already-dead socket still removes the file)
- **AND** the live-other-PID socket and the e2e-family socket files remain on disk

#### R4: `rk mux reap` removes the socket file after a successful kill
In `reapCandidates` (`app/backend/internal/tmux/reaper.go`), the `ReapActionKill` arm MUST, after a **successful** `KillServer(name)`, best-effort remove `filepath.Join(dir, name)`, treating `ENOENT` as success (a tmux build that unlinks on exit is fine). A **failed** kill MUST leave the file untouched (the server may still be live). Dead-socket and `.lock` handling (`ReapActionRemove`), `classifyReap`/`probeNeeded` purity, the hard-skips, dry-run default, dangerous-prefix guard, and `--ephemeral` semantics MUST NOT change. The post-kill removal is not double-reported in `RemovedSockets` (a kill implies its file is gone); a non-`ENOENT` removal failure joins the existing partial-failure warn path without failing the kill entry.

- **GIVEN** a live matched `rk-test-*` server and `--yes`
- **WHEN** reap kills it successfully
- **THEN** its socket file is gone afterward and the server appears in `Killed`
- **GIVEN** a matched live server whose kill fails
- **WHEN** the kill error is recorded
- **THEN** the socket file is still present

### Non-Goals

- No change to `ScanSocketDir`, `probeServerAlive`, `/api/servers`, or any listing/probe behavior (Change D's territory).
- No test-socket hide filter; no TestMain pre-sweep; no `_tmux.ts` spec-level teardown change (family sweeps cover those files).
- No new state, options, config keys, or reporting fields.

### Design Decisions

#### Whoever kills a server removes its socket file
**Decision**: File removal rides each existing kill site (teardown traps, sweeps, the reaper's kill arm) rather than a new cleanup pass or filter.
**Why**: tmux does not unlink the socket of a killed server; the kill site is the one place that knows exactly which file its dead server owned, so removal there is precisely scoped by construction.
**Rejected**: resurrecting the `/api/servers` hide filter (deliberately deleted — the list must show what reap will reap); a periodic daemon sweep (new state/behavior in rk for what is tmux's own artifact — Constitution II posture).
*Introduced by*: 260904-f6h4-test-socket-file-hygiene

#### Kill-arm removal is `ENOENT`-tolerant and not double-reported
**Decision**: The reaper's post-kill `os.Remove` ignores `ENOENT` and does not append to `RemovedSockets`; `DryRunPlan` output is unchanged (a `kill` entry implies its file goes too).
**Why**: Future tmux builds may unlink on exit; the operator-facing summary should not count one server twice.
**Rejected**: a new `ReapResult` field — reporting surface for no operator value.
*Introduced by*: 260904-f6h4-test-socket-file-hygiene

## Tasks

### Phase 2: Core Implementation

- [x] T001 [P] `scripts/test-e2e.sh`: add `rm -f "$sock"` after the family-glob kill and `rm -f "/tmp/tmux-$(id -u)/$E2E_TMUX_SERVER"` after the refused-anchor primary kill, keeping best-effort posture <!-- R1 -->
- [x] T002 [P] `app/frontend/tests/e2e/global-teardown.ts`: best-effort `unlinkSync`/`rmSync` of `/tmp/tmux-${uid}/${name}` after each kill attempt inside try/catch; skip file removal when uid is unavailable <!-- R2 -->
- [x] T003 [P] Add best-effort `os.Remove(filepath.Join(socketDir, name))` after the kill in all seven sweep copies: `app/backend/internal/tmux/main_test.go` (`sweepDeadTestSocketsIn`), plus the copies in `api/main_test.go`, `cmd/rk/main_test.go`, `internal/daemon/main_test.go`, `internal/tmuxctl/main_test.go`, `internal/snapshot/main_test.go`, `internal/remote/main_test.go` — identical edit, comments updated where they say "kill-servers" <!-- R3 -->
- [x] T004 [P] `app/backend/internal/tmux/reaper.go`: in `reapCandidates`'s `ReapActionKill` success path, best-effort `os.Remove(filepath.Join(dir, name))` ignoring `ENOENT`; non-`ENOENT` failure → existing `slog.Warn` + errs join without unwinding the successful kill <!-- R4 -->

### Phase 3: Integration & Edge Cases

- [x] T005 Extend tests: `app/backend/internal/tmux/socketsweep_test.go` (reaped sockets' files absent; spared live-PID and e2e-family files present) and `app/backend/internal/tmux/reaper_test.go` (kill success removes file; kill failure keeps file; dead-socket removal unchanged), then run `cd app/backend && go test ./...` <!-- R3 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: Both `cleanup()` branches remove exactly the socket files of the servers they kill; family-glob scoping and bare-anchor refusal semantics unchanged
- [x] A-002 R2: `global-teardown.ts` unlinks each killed socket's file best-effort; uid-unavailable path skips removal; bare-anchor branch removes only the primary's file
- [x] A-003 R3: All seven sweep copies carry the identical post-kill `os.Remove`; e2e exclusion, PID gate, no-parse skip preserved byte-for-byte in semantics
- [x] A-004 R4: Reap's kill arm removes the file only on kill success, `ENOENT`-tolerant, no `RemovedSockets` double-report; `ReapActionRemove`, guards, hard-skips, dry-run all unchanged

### Behavioral Correctness

- [x] A-005 R3: A dead-PID socket whose `kill-server` fails still has its file removed (the accumulation case); a live-other-PID socket keeps kill-free AND file intact

### Scenario Coverage

- [x] A-006 R3: `socketsweep_test.go` asserts file absence for reaped and presence for spared (live-PID sibling and e2e family) via the injectable-dir seam
- [x] A-007 R4: `reaper_test.go` covers kill-success→file-gone and kill-failure→file-kept through the `reapCandidates` temp-dir + fake-prober seam

### Edge Cases & Error Handling

- [x] A-008: Every removal is best-effort — no removal failure can fail a test run, the EXIT trap, Playwright teardown, or unwind a successful reap kill

### Code Quality

- [x] A-009 Pattern consistency: edits match each site's local idiom (shell `|| true`; TS try/catch-ignore; Go best-effort `_ =` / warn-and-continue); comment updates state constraints, no narration
- [x] A-010 No unnecessary duplication beyond the documented seven-copy sweep pattern; no helper extraction attempted
- [x] A-011 Subprocess posture unchanged: no new subprocesses anywhere; existing `exec.CommandContext` + timeout kills untouched (Constitution I)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

None — this change adds file-removal steps to existing kill sites without making existing code redundant.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Non-`ENOENT` reap unlink failure joins the partial-failure errs (warn + aggregate) rather than being silently dropped | Matches the reaper's existing partial-failure contract; the kill itself still counts as done | S:65 R:85 A:85 D:70 |
| 2 | Confident | `DryRunPlan` rendering unchanged — a `kill` entry implies its file removal, no new plan entry kind | Keeps the operator summary stable; intake #7 delegated the reporting shape here | S:60 R:90 A:85 D:70 |
| 3 | Certain | Go sweep removal uses `filepath.Join(socketDir, name)` with the injected dir, keeping the seam the sweep test drives | The injectable-dir seam is the documented test contract; any other path resolution would bypass it | S:80 R:85 A:95 D:90 |

3 assumptions (1 certain, 2 confident).
