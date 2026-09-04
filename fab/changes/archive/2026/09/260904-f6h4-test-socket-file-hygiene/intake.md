# Intake: Test-Socket File Hygiene

**Change**: 260904-f6h4-test-socket-file-hygiene
**Created**: 2026-09-04

## Origin

One-shot `/fab-new` invocation executing **Change E** of the daemon blocking & reliability plan (`fab/plans/sahil/26-09-04-daemon-blocking-reliability.md`, authored 2026-09-04 from a live incident diagnosis + two code audits). Change E is one of five wave-1 changes (A, B, D, E, F — disjoint files, parallel pickup).

> Daemon reliability - Change E: test-socket file hygiene. Read and follow fab/plans/sahil/26-09-04-daemon-blocking-reliability.md, Change E section exactly. Files: scripts/test-e2e.sh, the Go test TestMain sweeps, optionally rk mux reap. Constitution II is untouched - socket files are tmux state not rk state. Re-verify all line numbers against current HEAD before editing - plan numbers are as of fd16e6b4.

All plan facts were re-verified against current HEAD (`b53e0cad`) during intake — the cited code is unchanged; verified locations are recorded below.

## Why

1. **The pain point**: every test-teardown path in the repo kills tmux servers with `kill-server` but never removes the socket **file** — tmux does not unlink the socket of a killed server. During the 2026-09-04 incident, `/tmp/tmux-1001/` held **2,682 socket files, 2,675 of them stale `rk-test-*`** (2,084 from a single day of test runs).

2. **The consequence**: `/api/servers` probes the graveyard on every request — `ScanSocketDir` (`internal/tmux/tmux.go`, ~`:2992` as of fd16e6b4) enumerates every socket file and probes each (10-concurrent) — producing the observed **~350ms flat floor** on `/api/servers` while `/api/sessions` answered in 8ms. The pile regrows continuously (a `go test ./cmd/rk/` run creates several test servers **per second**), so the operator-prelude manual sweep only buys time.

3. **Why this approach**: the test-socket hide filter in `/api/servers` was deliberately deleted (`servers.go:55-58` comment; memory: "the reaper is the sole mechanism that keeps this list clean" — `docs/memory/run-kit/test-sockets.md` § `/api/servers` Lists Every Server). Hiding files is off the table; the fix is to stop leaking them: **whoever kills a server removes its socket file**, and the janitor (`rk mux reap`) finishes the job for residue. Constitution II is untouched — socket files are tmux's state, not rk's; no rk state store is introduced or consulted.

## What Changes

Verified current state (HEAD `b53e0cad`): three teardown families kill servers and leave files; `rk mux reap` already removes **dead** sockets (`ReapActionRemove` → `os.Remove`, `internal/tmux/reaper.go:287-295`) but leaves the file of a **live server it just killed** (`ReapActionKill` → `KillServer` only, `:280-286`).

### E.1 — `scripts/test-e2e.sh` `cleanup()`: unlink after every kill

The EXIT-trap `cleanup()` (`scripts/test-e2e.sh:30-71`) kills servers in two branches and removes no files:

- **Family-glob branch** (`:64-68`): after `tmux -L "$(basename "$sock")" kill-server`, add `rm -f "$sock"`. The loop already iterates exact socket paths (`"/tmp/tmux-$(id -u)/${E2E_TMUX_FAMILY}"*` with `[ -S "$sock" ]`), so removal is scoped to exactly the files whose servers were just killed — the family-anchor cross-worktree safety argument carries over unchanged to the `rm`. Note the loop also visits **already-dead** family sockets (a socket file persists after its server dies and still passes `-S`); the kill fails best-effort and the `rm -f` then cleans the file — this is desired (it sweeps residue from secondaries a spec's `afterAll` killed earlier in the run).
- **Refused-bare-anchor branch** (`:60-63`): after killing the exact primary `$E2E_TMUX_SERVER`, add `rm -f "/tmp/tmux-$(id -u)/$E2E_TMUX_SERVER"`. Exact name, never a prefix — the refusal semantics (no glob under a bare anchor) are preserved.

Best-effort throughout (`|| true` posture unchanged); the trap must never fail the run over hygiene.

### E.2 — Playwright `global-teardown.ts`: unlink after every kill

`app/frontend/tests/e2e/global-teardown.ts` mirrors the shell trap (prefix-scan of `/tmp/tmux-${uid}` + unconditional primary) and has the same gap: `execSync("tmux -L <name> kill-server")` per socket, no `unlinkSync`. After each kill attempt, best-effort `unlinkSync`/`rmSync` of `/tmp/tmux-${uid}/${name}` in a try/catch. When `uid` is unavailable (the primary-only fallback path already handles this), skip file removal for the primary rather than guessing a path — kill-only there is the pre-change behavior and the shell trap covers the file. The bare-anchor refusal (scan skipped, primary killed by exact name) gains the same exact-name `rm` as E.1's refused branch.

The plan's Files line names `scripts/test-e2e.sh` + the Go sweeps; its body says "(a) **every teardown path** after `kill-server`" — `global-teardown.ts` is the third such path and is included. The spec-level `_tmux.ts` `killServer` helper (`:123-127`, scratch secondaries in `afterAll`) is **deliberately not changed**: its servers' files are inside the family glob/prefix-scan, so E.1/E.2 remove them at run end.

### E.3 — Go TestMain post-sweeps: unlink after kill

`sweepDeadTestSocketsIn` (canonical copy `internal/tmux/main_test.go:124-150`; the duplicated ~78-line set exists in seven packages — `internal/tmux`, `api`, `cmd/rk`, `internal/daemon`, `internal/tmuxctl`, `internal/snapshot`, `internal/remote`, each in its own `main_test.go`) currently ends each iteration with `kill-server` (`:147`) and leaves the file. Add, after the kill attempt, a best-effort `os.Remove(filepath.Join(socketDir, name))`.

Semantics preserved exactly:
- The **e2e-family exclusion** (`testSocketE2EPrefix` prefix check before the PID parse) is untouched — no e2e file is ever removed by a Go sweep.
- The **PID gate** is untouched — only own-PID and dead-PID sockets reach the kill+remove; live-PID sockets (concurrent `go test` packages) are spared, so no concurrent run loses a socket file out from under it.
- For a dead-PID socket the `kill-server` fails (server already gone) and the `os.Remove` then cleans the residue file — this is the case the incident's 2,084-file/day accumulation is made of.
- Best-effort: removal failures are ignored (a leaked file is harmless residue; never blocking tests is the priority). Constitution I holds — the kill remains `exec.CommandContext` + 5s timeout; `os.Remove` is not a subprocess.

All seven copies are updated identically (Go `_test.go` symbols are package-private; the duplication is the documented pattern — memory § Automatic Test-Socket Sweep "The duplicated set").

Tests: `socketsweep_test.go`'s existing fixtures (`TestSweepDeadTestSockets_reapsOwnAndDeadSparesOtherLive`, `TestSweepDeadTestSockets_sparesE2EFamily`) extend to assert **file absence** for reaped sockets and **file presence** for spared ones (live-PID sibling, e2e family) — the injectable-dir seam (`sweepDeadTestSocketsIn`) already gives the test a private namespace to assert against.

### E.4 — `rk mux reap`: unlink the socket file after a successful kill

`reapCandidates` (`internal/tmux/reaper.go:279-295`): the `ReapActionKill` arm calls `KillServer(name)` and records `Killed` — the just-killed server's socket file survives until a *second* reap run classifies it as a dead socket. Add, after a **successful** kill, a best-effort `os.Remove(filepath.Join(dir, name))` (ignore `ENOENT` — a tmux build that does unlink on exit must not surface an error). A failed kill leaves the file untouched (the server may still be live).

Already-correct behavior kept as-is: dead sockets and `.lock` files → `ReapActionRemove` → `os.Remove` (this is the plan's "(b) … clean files for already-dead servers" — verified already implemented). `classifyReap`/`probeNeeded` purity, the hard-skips (`_rk-ctl`, `rk-daemon`, live protected), the dry-run default, the dangerous-prefix guard, and `--ephemeral` semantics are all untouched — this change adds one file-removal step to the kill arm's success path only. Whether the removed-after-kill file is reported in `ReapResult.RemovedSockets` or only implied by `Killed` is an apply-time call (lean: don't double-report; a kill implies its file is gone).

Reaper unit tests (`reaper_test.go` / the `reapCandidates` temp-dir + fake-prober seam) extend to assert the kill arm removes the file on success and leaves it on kill failure.

### Explicit non-goals

- No change to `ScanSocketDir`, `probeServerAlive`, `/api/servers`, or any listing/probing behavior (that is Change D's file territory — `servers.go` / `tmux.go` probe logic; E only shrinks the graveyard those probe).
- No test-socket hide filter resurrection.
- No pre-sweep in TestMain (post-sweep-only contract stands).
- No change to `_tmux.ts` spec-level teardown (covered by E.1/E.2 as argued above).
- No new state, options, or config — Constitution II untouched.

## Affected Memory

- `run-kit/test-sockets`: (modify) § Automatic Test-Socket Sweep gains the kill+unlink semantics and the extended sweep-test assertions; § `rk mux reap` records the kill-arm file removal; the teardown-chain descriptions (`test-e2e.sh` trap, `global-teardown.ts`) gain the rm-after-kill step.

## Impact

- **Files**: `scripts/test-e2e.sh` (cleanup trap), `app/frontend/tests/e2e/global-teardown.ts`, seven `main_test.go` sweep copies + `internal/tmux/socketsweep_test.go` (assertions), `app/backend/internal/tmux/reaper.go` + reaper tests.
- **Behavior**: socket files stop accumulating; `/api/servers`' ~350ms probe-the-graveyard floor decays to proportional cost as the pile stops regrowing. One-time existing residue is cleared by the operator prelude (already documented in the plan) or the first post-change `rk mux reap --yes`.
- **Blast radius**: teardown/janitor paths only — no daemon, API, or frontend runtime code. Disjoint from sibling changes A/B/C/D/F by design (wave-1 parallel pickup); D touches `tmux.go` probe logic but E touches only `reaper.go` within `internal/tmux`.
- **Review question (from the plan)**: does teardown remove exactly the socket files whose servers it just killed, and does `rk mux reap` clean files for already-dead servers? (Second half verified pre-existing; the review re-confirms it survives.)

## Open Questions

- None — the plan section is prescriptive, all line references were re-verified against HEAD, and the one ambiguity found (reap's dead-socket removal already existing) resolved in favor of "keep it, add the kill-arm unlink".

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Scope includes `global-teardown.ts` alongside the plan's named files | Plan body says "every teardown path after `kill-server`"; the Files line is an abbreviation. Verified it has the identical kill-no-rm gap | S:70 R:85 A:80 D:75 |
| 2 | Confident | `rk mux reap` work item = add unlink to the **kill** arm; dead-socket removal already exists | Verified `ReapActionRemove` → `os.Remove` at `reaper.go:287-295`; the plan's "(b) clean files for already-dead servers" is already shipped, leaving the kill-arm gap as the only actionable delta | S:75 R:85 A:90 D:80 |
| 3 | Certain | Go sweeps keep the e2e-family exclusion and PID gate exactly; file removal rides only the existing kill path | Documented contract (memory § Automatic Test-Socket Sweep); loosening either would reintroduce the cross-run kill hazard the design exists to prevent | S:85 R:80 A:95 D:90 |
| 4 | Certain | All seven duplicated sweep copies updated identically; no shared-helper extraction | The ~78-line duplication across `main_test.go` files is the documented pattern (package-private `_test.go` symbols); extraction is out of scope | S:80 R:85 A:95 D:90 |
| 5 | Certain | All removals are best-effort (failures ignored/logged, never block tests or fail teardown) | Matches the existing posture of every touched path ("never blocking tests is the priority"; trap `|| true`; reaper partial-failure contract) | S:85 R:90 A:95 D:90 |
| 6 | Confident | `_tmux.ts` spec-level `killServer` unchanged — family glob/prefix-scan removes those files at run end | Secondaries' dead socket files still match the family glob (`-S` true for dead sockets) and the teardown scans, so E.1/E.2 cover them; touching a fourth site adds surface for no coverage gain | S:65 R:85 A:80 D:70 |
| 7 | Confident | Reap kill-arm removal ignores `ENOENT` and is not double-reported in `RemovedSockets` (kill implies file gone); final reporting shape decided at apply | Cosmetic/reporting detail, easily changed; lean default avoids double-counting in the summary the operator reads | S:60 R:90 A:80 D:65 |

7 assumptions (3 certain, 4 confident, 0 tentative, 0 unresolved).
