# Plan: e2e harness — per-worktree exclusive lock before the stale-kill

**Change**: 260913-osy0-e2e-per-worktree-lock
**Intake**: `intake.md`

## Requirements

### E2E Harness: Run serialization

#### R1: One `just test-e2e` run per worktree at a time
`scripts/test-e2e.sh` SHALL take an exclusive `flock` on `/tmp/rk-e2e-wt-<uid>-${E2E_TOKEN}.lock` immediately after sourcing `e2e-env.sh`, before `mktemp`, `kill_triple`, the tmux primary, and the dev-server launch, and SHALL hold it until process exit (no explicit unlock, no `flock -u` in `cleanup()`). It SHALL probe with `flock -n` first; on contention it SHALL print exactly one stderr line `e2e lock: another run holds this worktree's rig — waiting (up to 30m)` then block with `flock -w 1800`; on timeout it SHALL print an ERROR naming the lock file and exit 1 having touched nothing. It SHALL NOT kill a sibling run.

- **GIVEN** a `just test-e2e` run in flight in this worktree
- **WHEN** a second `just test-e2e` starts in the same worktree
- **THEN** the second prints the waiting line, touches no port or socket, starts only after the first exits, and both pass

#### R2: The lock belongs to the harness process alone
No long-lived child SHALL inherit the lock fd: the tmux primary `new-session`, the detached dev-server `bash -c … &`, and the Playwright run SHALL be launched with the lock fd closed (`{_wt_lock_fd}>&-`, guarded for the unlocked case where the variable is empty). The `set -m` PGID capture and verification block SHALL stay intact.

- **GIVEN** a run whose harness bash is `kill -9`'d after `both servers ready`
- **WHEN** the orphan e2e tmux primary is still alive
- **THEN** `flock -n <lockfile> -c true` succeeds immediately and the next run takes the lock without waiting

#### R3: Degrade like the slot throttle
Without `flock(1)` the harness SHALL print `e2e lock: flock(1) not found — running unlocked` and run; an unopenable lock file SHALL print `e2e lock: cannot open <file> — running unlocked` and run. Both opens SHALL use the grouped form `{ exec {fd}>>file; } 2>/dev/null` so the redirect scopes to the open.

- **GIVEN** a PATH without `flock`
- **WHEN** `just test-e2e` runs
- **THEN** it prints the unlocked warning and the run proceeds

#### R4: Slot semaphore unchanged in semantics; ordering documented
The `RK_E2E_SLOTS` semaphore SHALL keep its files, count, and placement (before the Playwright phase). Its comment SHALL point at the worktree lock as the correctness lock and state the ordering `worktree lock → stale-kill + server start → slot → Playwright` with the no-deadlock reasoning. The two slot-file opens SHALL use the grouped redirect form so the script's stderr is no longer swallowed from the first open onward (behavior of the locks unchanged).

- **GIVEN** slot files that cannot be opened
- **WHEN** the throttle degrades
- **THEN** its `cannot open slot files` warning is actually visible on stderr

#### R5: `just dev` warns, never blocks
`scripts/dev.sh` SHALL, after sourcing `e2e-env.sh`, probe the same lock non-blockingly (`flock -n <file> -c true`, only when the file exists and `flock` is available) and print one WARNING line when held; it SHALL skip the probe when `E2E_HARNESS` is set. `test-e2e.sh` SHALL pass `E2E_HARNESS=1` in the dev-server child env. `just pw` and the justfile recipes SHALL be unchanged except the `test-e2e` recipe comment gaining a clause.

- **GIVEN** a `just test-e2e` in flight
- **WHEN** `just dev` starts in the same worktree
- **THEN** it prints the warning and still starts; the harness's own run output never contains that warning

### Non-Goals
- Changing the slot semaphore's count, files, or placement; fixing the slot fd's inheritance into Playwright secondaries (noted as a follow-up observation).
- Locking `just dev` or `just pw`.
- Auto-killing an older run.
- Exporting `E2E_TOKEN` from `e2e-env.sh` (it sets without exporting by contract; `test-e2e.sh` sources it).

### Design Decisions

#### Per-worktree exclusive lock precedes the stale-kill
**Decision**: One `flock` per `E2E_TOKEN` — the same identity the port triple and socket family derive from — taken before `kill_triple` and held to exit; contention waits (bounded at 30 m) and never kills.
**Why**: `kill_triple` reclaims "this worktree's own leftover"; without the lock a live sibling run in the same worktree IS that leftover, so the second run kills the first's dev server and both fight over one rig. The slot semaphore is a per-user load knob taken after the destructive step, so it cannot prevent this. `flock(2)` releases when the last descriptor closes, so a crashed run leaves no stale lock — provided no daemonizing child inherits the fd.
**Rejected**: A PID file (stale after a crash); making the slot semaphore per-worktree (N>1 by design, and it sits after the stale-kill); auto-killing the older run (may be the user's); locking `just dev` (interactive lane — a warning suffices).
*Introduced by*: 260913-osy0-e2e-per-worktree-lock

#### Close the lock fd on every long-lived child launch
**Decision**: The tmux primary, the detached dev server, and the Playwright run are launched with the lock fd closed.
**Why**: Verified at intake — a tmux server and a detached `bash -c … &` inherit the fd and keep the lock held after the harness exits, turning "no stale lock" into a 30-minute wait plus an error after any `kill -9`.
**Rejected**: Relying on `FD_CLOEXEC` (bash does not set it on `exec {fd}` opens); a cleanup-time `flock -u` (cleanup does not run on SIGKILL, and the lock must cover teardown).
*Introduced by*: 260913-osy0-e2e-per-worktree-lock

## Tasks

### Phase 2: Core Implementation

- [x] T001 `scripts/test-e2e.sh`: insert the lock block right after `RK_CODE_SERVER_PORT="$E2E_CODE_SERVER_PORT"` (probe → waiting line → `flock -w 1800` → ERROR+exit 1; degrade paths; grouped open); add `without_lock_fd()` and use it at the tmux primary `new-session` and inside `run_playwright`; prepend `${_wt_lock_fd:+exec $_wt_lock_fd>&-;}` to the dev-server `bash -c` string and add `E2E_HARNESS=1` to its env list; extend the header comment; update the slot-semaphore comment with the ordering/no-deadlock rationale. <!-- R1, R2, R3, R4 -->
- [x] T002 `scripts/test-e2e.sh`: convert the two slot-file opens to the grouped `{ exec {fd}>>…; } 2>/dev/null` form (stderr no longer swallowed; lock semantics unchanged). <!-- R4 -->
- [x] T003 `scripts/dev.sh`: add the non-blocking probe + WARNING after the `RK_HOST` export, gated on `E2E_HARNESS` being unset and `flock` present and the file existing; `justfile`: extend the `test-e2e` recipe comment by one clause. <!-- R5 -->

### Phase 3: Integration & Edge Cases

- [x] T004 Verification (manual recipe; no shell-test lane exists): (1) two concurrent `just test-e2e` runs in this worktree — second prints the waiting line once, starts after the first exits, both pass; (2) stale-lock property — `kill -9` the harness after `both servers ready`, confirm the orphan tmux primary does not pin the lock and the next run proceeds immediately; (3) `just dev` during a run prints the WARNING and starts; the harness's own output never contains it; (4) degrade path with a PATH lacking `flock` (or reasoning if the tool set cannot be reproduced); (5) `bash -n` on both scripts and one full `just test-e2e` green. Record results in `## Notes`. <!-- R1, R2, R3, R5 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: the lock block sits before `mktemp`, `kill_triple`, the tmux primary, and the dev-server launch; keyed on `E2E_TOKEN`; probe → one waiting line → `flock -w 1800` → ERROR naming the file + exit 1
- [x] A-002 R2: the tmux primary, the dev-server `bash -c`, and the Playwright run are launched with the lock fd closed; the unlocked case (empty `_wt_lock_fd`) is handled at all three sites
- [x] A-003 R3: missing `flock(1)` and an unopenable lock file both degrade with the specified warnings; opens use the grouped redirect
- [x] A-004 R4: slot semaphore count/files/placement unchanged; comment states the ordering and no-deadlock reasoning; slot opens use the grouped redirect
- [x] A-005 R5: `dev.sh` probes non-blockingly, warns only, skips under `E2E_HARNESS`; `test-e2e.sh` passes `E2E_HARNESS=1`; justfile recipes unchanged apart from the comment

### Behavioral Correctness

- [x] A-006 R1: a second same-worktree run waits and both pass (recipe 1 — results recorded in ## Notes)
- [x] A-007 R2: after `kill -9` of the harness the orphan tmux primary does not pin the lock (recipe 2 — results recorded in ## Notes)
- [x] A-008 R5: `just dev` during a run warns and starts; the harness's own output has no such warning (recipe 3 — results recorded in ## Notes)
- [x] A-009 R1: no `flock -u` of the worktree lock anywhere, including `cleanup()`; the `set -m` PGID capture/verification block is byte-identical

### Edge Cases & Error Handling

- [x] A-010 R3: the degrade paths never abort the run under `set -e`
- [x] A-011 R1: the timeout path exits before touching ports or sockets

### Code Quality

- [x] A-012 Pattern consistency: the new block mirrors the slot code's guarded-open style, stderr messaging (`e2e lock: …`), and `command -v flock` gate; Constitution VIII — no logic in the justfile
- [x] A-013 Comment discipline: comments state constraints (why before the stale-kill, why the fd is closed, why no deadlock), no narration, no change IDs
- [x] A-014 `bash -n scripts/test-e2e.sh scripts/dev.sh` clean; one full `just test-e2e` green

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`
- Verification results (2026-09-14, this worktree, token `mightymammothb2`): (1) run A `compose-strip.spec` in the background, run B `status-bar.spec` started 25 s later — B printed exactly one `e2e lock: another run holds this worktree's rig — waiting (up to 30m)` line, started after A exited, A 24 passed / B 9 passed, lock free afterwards. (2) `kill -9` of A's harness bash after `both servers ready`: the orphan tmux primary, the orphan `just dev`, and the orphan Playwright run were still alive, yet `flock -n <lock> -c true` succeeded immediately and no process held the lock file; the next run took the lock without waiting, its stale-kill reclaimed the orphan dev server, 9 passed. (3) `timeout 5 just dev` during A printed the `WARNING: a just test-e2e run owns this worktree's rig` line once; neither harness log contains it. (4) `PATH` built from `/usr/bin` minus `flock` plus the linuxbrew tools (`command -v flock` empty): both `e2e lock: flock(1) not found — running unlocked` and `e2e throttle: flock(1) not found — running unthrottled` printed, 9 passed. (5) `bash -n` clean on both scripts; full `just test-e2e` with the lock in place: 478 passed, 1 skipped, 1 flaky (the pre-existing status-bar overflow-menu first-attempt flake, passed on retry).
- Follow-up observation (out of scope): the slot fd is likewise inherited by Playwright's secondary tmux servers; an orphan secondary can pin a slot file and silently shrink the throttle.

## Deletion Candidates

None — this change adds new functionality without making existing code redundant.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | The lock block is placed before `mktemp -d`, so the timeout path leaves no temp dir behind | Simplest "touched nothing" guarantee; the intake allowed either placement | S:75 R:95 A:90 D:85 |
| 2 | Confident | `without_lock_fd()` is a tiny helper used at the two foreground sites; the `&` launch closes the fd inside its `bash -c` string | The `{var}>&-` redirect is a bash error when the variable is empty, so both arms need handling; a helper keeps that in one place | S:70 R:90 A:85 D:80 |
| 3 | Confident | Verification recipe 4 (no-flock degrade) is run with a filtered PATH only if `just`, `tmux`, `lsof`, `pnpm`, `go`, `air`, `curl` remain resolvable; otherwise the code-path reasoning is recorded | linuxbrew may own several of those on this box | S:55 R:90 A:75 D:70 |
| 4 | Confident | The plan groups the work into 4 tasks (light lane, inline) | Two script files, one comment, one manual verification pass | S:75 R:90 A:90 D:85 |

4 assumptions (0 certain, 4 confident, 0 tentative).
