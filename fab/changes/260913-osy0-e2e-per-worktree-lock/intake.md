# Intake: E2E Harness — Per-Worktree Exclusive Lock Before the Stale-Kill

**Change**: 260913-osy0-e2e-per-worktree-lock
**Created**: 2026-09-14

## Origin

Promptless dispatch from `/fab-proceed` (create-new, `{questioning-mode} = promptless-defer`) carrying a fully-specified design decided in discussion on 2026-09-13/14 while change `260913-png4-compose-default-on` was in review-pr. The dispatcher's brief, condensed:

> Two `just test-e2e` runs started in the SAME worktree (the orchestrator's background run and a dispatched review worker's run) share the worktree's derived port triple and tmux socket family, so the second run's `kill_triple` killed the first run's dev server and both then fought over the rig: one run showed 299 failed / 76 passed within minutes; the other was "compromised". The slot semaphore did not help: it is keyed per user (not per worktree), taken only before the Playwright phase (after the destructive `kill_triple` + server start), and two runs from one worktree can hold slot 0 and slot 1 simultaneously.
>
> Design (implement as specified): a per-worktree exclusive `flock` on `/tmp/rk-e2e-wt-<uid>-<E2E_TOKEN>.lock` taken FIRST in `scripts/test-e2e.sh` (before `kill_triple`), held on a dedicated fd for the whole run; `flock -n` probe → one stderr line → `flock -w 1800`; on timeout exit non-zero naming the lock file; NEVER kill the other run. Slot semaphore unchanged. Degrade unlocked when `flock(1)` is missing. Lock keys on `E2E_TOKEN`, not the port. `scripts/dev.sh` does a non-blocking probe and prints a one-line warning when held (never blocks). `just pw` stays unlocked. No shell-test lane exists → manual verification recipe in the plan. Memory: the testing memory gains the lock; `fab/project/context.md` § Testing's flock sentence gains one clause. Rejected: PID file, per-worktree slot semaphore, auto-killing the older run, locking `just dev`.

Interaction mode: one-shot dispatch, no questions asked. The intake agent verified every claim against `scripts/test-e2e.sh`, `scripts/e2e-env.sh`, `scripts/dev.sh`, `scripts/pw.sh`, `justfile`, `.github/workflows/ci.yml`, `docs/memory/run-kit/architecture/testing.md`, `docs/memory/run-kit/test-sockets.md`, and `fab/project/context.md`, and ran one empirical `flock` probe (see § What Changes › Lock-fd hygiene) whose result adds a load-bearing detail to the design.

## Why

**The pain point.** `scripts/test-e2e.sh` derives a per-worktree identity by sourcing `scripts/e2e-env.sh`: `E2E_TOKEN` (worktree basename + 2-hex path hash), the port triple `E2E_PORT`/`+1`/`+2` in 3400–3699, and the tmux socket family `rk-test-e2e-<token>-` with primary `…-0`. The isolation design is "one rig per worktree": `just dev` shares the same triple (`scripts/dev.sh`: `RK_PORT="${RK_PORT:-$E2E_PORT}"`), and the harness's `kill_triple` (test-e2e.sh:100–108) deliberately kills whatever LISTENs on the triple as "this worktree's own leftover `just dev`/previous run". That self-claim is correct for a *leftover* but destructive for a *concurrent sibling*: a second `just test-e2e` in the same worktree kills the first run's dev server (its `air`/Vite/Go children), starts its own on the same ports, and both Playwright phases then drive one rig whose tmux primary `rk-test-e2e-<token>-0` they also share (test-e2e.sh:131 `new-session -d -s e2e-init` — the second run's create fails or piggybacks, and each run's EXIT trap kills the *whole* family, including the other run's secondaries). Observed 2026-09-13: 299 failed / 76 passed on one run within minutes, the other run unusable.

**Why the existing throttle cannot fix it.** The flock counting semaphore at test-e2e.sh:238–278 (`/tmp/rk-e2e-slot-<uid>-{0..N-1}`, `RK_E2E_SLOTS` default 2) is a cross-worktree **load** knob, documented as "load, not correctness — the derived identity already isolates". It is (a) keyed per user, so two runs from one worktree hold slot 0 and slot 1 at once; (b) taken only immediately before `run_playwright`, i.e. *after* `kill_triple`, the tmux-server creation, and the dev-server launch have already collided; (c) N>1 by design. Making it per-worktree or N=1 would throw away the cross-worktree parallelism it exists to provide and would still sit after the destructive step.

**Consequence of not fixing.** The orchestrator-plus-worker pattern (a background `just test-e2e` in the change worktree while a dispatched review worker runs its own gate in the same worktree) is now routine in fab pipelines here; every such overlap produces a false-red run and, worse, a "compromised" run whose verdict cannot be trusted either way. The failure mode also masquerades as spec flakiness.

**Why this approach.** A kernel `flock(2)` on a per-worktree file keyed on the same `E2E_TOKEN` the ports and sockets derive from gives one lock per rig identity with zero bookkeeping: the lock is released when the holder's last open descriptor closes, so a crashed or `kill -9`'d run leaves nothing stale; no PID file, no cleanup step, no liveness check. Taking it *before* `kill_triple` is the whole point — the destructive step then only ever runs when no sibling holds the rig. Waiting (bounded, with a message) rather than failing fast matches how the slot throttle already behaves and lets the background-run + worker-run pattern simply serialize. The harness never kills a sibling run: the older run may be the user's.

## What Changes

### 1. `scripts/test-e2e.sh` — per-worktree exclusive lock, taken first

Insert a new block **immediately after** `source "$SCRIPT_DIR/e2e-env.sh"` / `RK_CODE_SERVER_PORT="$E2E_CODE_SERVER_PORT"` (lines 10–11) and **before** everything that touches the derived identity — before `mktemp -d` is fine either way, but it MUST precede `trap cleanup EXIT` side effects that matter, the `kill_triple` call (line 108), the `tmux -L "$E2E_TMUX_SERVER" new-session` (line 131), and the dev-server launch (line 179). Recommended placement: directly after line 11, so the lock is the first thing the run does after deriving who it is.

```bash
# Per-worktree exclusive lock — the rig identity (port triple + socket
# family) derives from E2E_TOKEN, so one lock per token is one lock per rig.
# Taken BEFORE kill_triple: the stale-kill below reclaims "this worktree's
# own leftover", and without this lock a concurrent sibling run in the same
# worktree IS that leftover — the second run kills the first run's dev server
# and both then fight over one rig (observed: 299 failed / 76 passed within
# minutes). flock(2) releases when the holder's last descriptor closes, so a
# crashed or SIGKILLed run leaves no stale lock — no PID file, no cleanup step.
#
# Ordering with the slot semaphore below: worktree lock → stale-kill + server
# start → slot → Playwright. No deadlock is possible: worktree locks are
# independent of each other (a run holds exactly one, its own token's) and
# every slot holder finishes and releases regardless of any worktree lock, so
# a run waiting on a slot while holding its worktree lock is waiting on
# something that always completes. The harness never kills a sibling run —
# the older run may be the user's — so contention waits, bounded.
#
# The lock belongs to THIS process alone: every long-lived child launch below
# closes the fd ({_wt_lock_fd}>&-). A tmux server daemonizes with inherited
# descriptors and outlives a SIGKILLed harness; a dev server runs in its own
# process group for the same reason. Either would pin the lock indefinitely,
# turning the "no stale lock" property into a 30-minute wait plus an error.
_wt_lock_fd=""
if command -v flock >/dev/null 2>&1; then
  _wt_lock_file="/tmp/rk-e2e-wt-$(id -u)-${E2E_TOKEN}.lock"
  # Grouped so the 2>/dev/null scopes to the open: a bare `exec {fd}>>f
  # 2>/dev/null` redirects the SHELL's stderr permanently.
  if { exec {_wt_lock_fd}>>"$_wt_lock_file"; } 2>/dev/null; then
    if ! flock -n "$_wt_lock_fd"; then
      echo "e2e lock: another run holds this worktree's rig — waiting (up to 30m)" >&2
      if ! flock -w 1800 "$_wt_lock_fd"; then
        echo "ERROR: e2e lock: timed out after 30m waiting for $_wt_lock_file — another just test-e2e in this worktree is still running (or a process it started is holding the lock); this run did not touch the rig." >&2
        exit 1
      fi
    fi
  else
    echo "e2e lock: cannot open $_wt_lock_file — running unlocked" >&2
    _wt_lock_fd=""
  fi
else
  # Stock macOS has no flock(1) — degrade to unlocked (mirrors the slot throttle).
  echo "e2e lock: flock(1) not found — running unlocked" >&2
fi
```

Exact behaviors:

- **Probe, then wait.** `flock -n` first; only on failure print exactly one line to stderr: `e2e lock: another run holds this worktree's rig — waiting (up to 30m)`. Then block with `flock -w 1800`. `flock -w` exits 1 on timeout (verified with util-linux 2.42.2) → print the ERROR line naming the lock file and `exit 1`. Nothing has been touched at that point (no `kill_triple`, no tmux server, no dev server, and the `E2E_STATE_HOME` mktemp has not run if the block sits at line 12 — if placed after mktemp, the EXIT trap removes it; either is acceptable, but placing the lock before `mktemp -d` is simplest).
- **Hold for the whole run.** The fd is never explicitly unlocked (unlike the slot fd's `flock -u` at the end): process exit releases it. Do NOT add a `flock -u` in `cleanup()` — cleanup kills the tmux family and dev process group, and the lock must cover that teardown too (a sibling must not start its `kill_triple` while this run's cleanup is mid-flight).
- **Degrade exactly like today** when `flock(1)` is missing: one stderr warning in the existing style (`e2e lock: flock(1) not found — running unlocked`), run unlocked. An unopenable lock file (perms, fd exhaustion) likewise degrades with a warning, mirroring the slot code's guarded `exec {fd}>>` pattern (`set -e` would otherwise abort the run over lock plumbing).
- **Explicit `RK_E2E_PORT` override**: the lock keys on `E2E_TOKEN`, which `e2e-env.sh` derives from the checkout regardless of `RK_E2E_PORT` / preset `E2E_TMUX_SERVER`. Two runs in one worktree with different `RK_E2E_PORT` values still serialize (they share the socket family unless `E2E_TMUX_SERVER` is also preset) — accepted; the token IS the worktree identity.
- **`E2E_TOKEN` availability**: `e2e-env.sh` deliberately *sets without exporting* (header comment, lines 4–6: "consumers pass the values into child envs explicitly") and `test-e2e.sh` **sources** it, so `E2E_TOKEN` is already a shell variable in `test-e2e.sh` — no `export` is added anywhere (adding one would break the header's contract for no gain; the lock path never needs to reach a child).

#### Lock-fd hygiene at the three child-launch sites (load-bearing — empirically verified)

An intake-time probe (bash script: open fd + `flock -n`, then `tmux -L probe new-session -d`, then exit) showed the tmux server **inherits the lock fd and keeps the lock held after the script exits** (`ls -l /proc/<tmux-pid>/fd` lists the lock file; `flock -n lockfile -c true` fails). The same holds for a detached `bash -c … &` child; a child launched with `{fd}>&-` does not hold it. Therefore, without hygiene, a `kill -9`'d harness leaves its e2e tmux primary alive (nothing runs the trap) and that server pins the worktree lock until someone kills it — the next run waits 30 minutes and errors. Fix: close the lock fd on every long-lived child launch (bash's `{varname}>&-` closes the fd named by the variable; when `_wt_lock_fd` is empty on the degrade path, guard the redirection — simplest is a tiny helper or an `if` on `_wt_lock_fd`; a literal `{_wt_lock_fd}>&-` with an empty variable is a bash error, so the three sites MUST handle the unlocked case):

1. **tmux primary** (line 131): `tmux -L "$E2E_TMUX_SERVER" new-session -d -s e2e-init -x 80 -y 24` — the only tmux call that *creates a server*; the later `set-option`/`display-message` calls are short-lived clients against the existing server and need nothing.
2. **dev server** (line 179): the `bash -c "… exec just dev" &` launch — it is in its own process group by design and survives a harness that died without its trap; `kill_triple` on the next run reclaims it (today's semantics), which only works if it is not pinning the lock.
3. **Playwright** (`run_playwright`, line 235): Playwright workers spawn spec-secondary tmux servers (`rk-test-e2e-<token>-<role>-<pid>-<epoch>`) that daemonize and inherit descriptors; a `kill -9`'d harness's orphan secondary would pin the lock the same way.

Recommended shape (the requirement — no long-lived child inherits the lock fd — is fixed; the form is the apply agent's, provided the `set -m` PGID capture and verification block at lines 178–201 stay intact):

- Sites 1 and 3 (a plain foreground command): a tiny wrapper `without_lock_fd() { if [ -n "$_wt_lock_fd" ]; then "$@" {_wt_lock_fd}>&-; else "$@"; fi; }` and call `without_lock_fd tmux -L … new-session …` / `without_lock_fd pnpm exec playwright test "$@"` (inside `run_playwright`, after the `cd`).
- Site 2 (the `&` launch under `set -m`): the child does not know the fd number, so pass it into the string: build `_close_lock="${_wt_lock_fd:+exec $_wt_lock_fd>&-;}"` (empty when unlocked) and prepend it — `bash -c "$_close_lock RK_PORT=… exec just dev" &` — keeping `DEV_PID=$!` and everything after it unchanged. (`{_wt_lock_fd}>&-` with an EMPTY variable is a bash error, so both arms must be handled at every site.)

The existing slot-fd inheritance into Playwright (same class of issue for the load throttle — an orphan secondary tmux server can pin a slot file and silently shrink the throttle) is **out of scope** — the slot semaphore's semantics stay unchanged per the design; note it in the plan as a follow-up observation, not a task.

### 2. `scripts/test-e2e.sh` — header comment + slot-open stderr hygiene

Extend the header comment (lines 4–8) with one sentence: the run holds the per-worktree lock `/tmp/rk-e2e-wt-<uid>-<token>.lock` from before the stale-kill until exit, so sibling runs in the same worktree queue instead of colliding. Update the slot-semaphore comment (lines 238–246) with one clause pointing up at the ordering rationale ("the per-worktree lock above is the correctness lock; this is the load knob").

**Slot-open stderr hygiene (found at intake, two-token fix, semantics unchanged).** The two slot-file opens — line 258 `if ! exec {fd}>>"/tmp/rk-e2e-slot-$(id -u)-$i" 2>/dev/null; then continue; fi` and line 263 `if exec {fd}>>"/tmp/rk-e2e-slot-$(id -u)-0" 2>/dev/null; then` — use `exec` with only redirections, so the `2>/dev/null` applies to the **script's own stderr permanently** (verified: `bash -c 'exec {fd}>>f 2>/dev/null; echo ERR >&2'` prints nothing). From the first slot open onward, the script's stderr — the `e2e throttle: cannot open slot files` warning at line 268 and the **entire Playwright child's stderr** — goes to `/dev/null`. Wrap both in a group so the redirect scopes to the open: `if ! { exec {fd}>>"…"; } 2>/dev/null; then …`. The semaphore's locking behavior is untouched; only stderr stops being swallowed. The new lock block uses the grouped form from the start. If the reviewer or user wants the slot code literally byte-identical, this hunk is separable — it is listed as its own task in the plan.

### 3. `scripts/dev.sh` — non-blocking probe, warning only

After `source …/e2e-env.sh` (line 25) and the `RK_PORT`/`RK_HOST` exports, add:

```bash
# An in-flight `just test-e2e` owns this worktree's rig (it holds the
# per-worktree lock from before its stale-kill until exit); its kill_triple
# would take this dev server down, and this dev server would collide with its
# ports. Warn — never block or exit: `just dev` is the interactive lane.
# E2E_HARNESS is set only by test-e2e.sh on its own dev-server launch, where
# the lock holder is the caller and the warning would be noise.
if [[ -z "${E2E_HARNESS:-}" ]] && command -v flock >/dev/null 2>&1; then
  _wt_lock_file="/tmp/rk-e2e-wt-$(id -u)-${E2E_TOKEN}.lock"
  if [[ -e "$_wt_lock_file" ]] && ! flock -n "$_wt_lock_file" -c true 2>/dev/null; then
    echo "WARNING: a just test-e2e run owns this worktree's rig (lock: $_wt_lock_file) — its stale-kill will stop this dev server; wait for it or use another worktree." >&2
  fi
fi
```

- `flock -n <file> -c true` is the probe form (opens its own descriptor, exits 1 when the lock is held, releases immediately on success) — it never blocks and never holds anything past the probe.
- The `-e` guard avoids creating the lock file from `just dev` (probing a nonexistent file would create it; harmless, but the harness owns the file).
- **`E2E_HARNESS=1`** is a new harness→child marker that `test-e2e.sh` adds to the dev-server `bash -c` env list (line 179, alongside `RK_PORT=… RK_SERVER_ALLOWLIST=… E2E_TMUX_FAMILY=…`). Without it every e2e run would print the warning against itself (the harness holds the lock when it launches `just dev`). It follows the existing `E2E_*` convention for variables only the harness sets (like `E2E_PORT`, `E2E_TMUX_FAMILY`); it is not an `rk` configuration key (Constitution IV's env-key rule governs the binary's config, not harness plumbing). `dev.sh` does not export or forward it.
- No flock / `just dev` on a box without `flock(1)`: the probe is skipped silently (no warning about the missing tool — `just dev` is not the place for harness tooling notices).

### 4. `justfile` — no recipe change

`test-e2e`, `pw`, and `dev` remain one-liners delegating to scripts (Constitution VIII). Only the `test-e2e` recipe's comment (justfile:102–103) gains a clause: "…serialized per worktree by a flock". `just pw` stays unlocked and unthrottled — it requires a running rig by design and never runs `kill_triple`.

### 5. Memory and project context (hydrate)

- **`docs/memory/run-kit/architecture/testing.md` § Playwright E2E Tests** (the paragraph at line 46 that documents the harness env and the derived triple): add the run-lifecycle sentence(s) — the per-worktree exclusive lock (`/tmp/rk-e2e-wt-<uid>-<token>.lock`, keyed on `E2E_TOKEN`, taken before the stale-kill, held to exit, probe → one waiting line → 30 m bounded wait → error naming the file; degrade unlocked without `flock(1)`; fd closed on every long-lived child launch), the ordering `worktree lock → stale-kill + server start → slot → Playwright`, and — since no memory file currently documents it — the `RK_E2E_SLOTS` slot semaphore (`/tmp/rk-e2e-slot-<uid>-{0..N-1}`, default 2, 1 = strict series, load not correctness, taken before the Playwright phase). Also the `just dev` probe warning and `E2E_HARNESS`.
- **`docs/memory/run-kit/test-sockets.md` § Design Decisions**: add a sibling to "Step-forward port fallback only on an unkillable foreign owner" (line 259): **"Per-worktree exclusive lock precedes the stale-kill"** — Decision / Why / Rejected (PID file; per-worktree slot semaphore; auto-kill the older run; locking `just dev`) / *Introduced by*: 260913-osy0-e2e-per-worktree-lock. Extend the port-fallback decision's Decision line by one clause: the self-claim kill now runs only under the worktree lock, so "this worktree's own leftover" can no longer be a live sibling run. Update the file's frontmatter `description` to mention the lock.
- **`fab/project/context.md` § Testing** (line 68): extend the flock sentence — "A per-worktree exclusive flock (`/tmp/rk-e2e-wt-<uid>-<token>.lock`, taken before the stale-kill) serializes `just test-e2e` runs started in the SAME worktree (the second waits, up to 30 m, and never kills the first), and a flock throttle (`RK_E2E_SLOTS`, …) bounds concurrent Playwright phases across worktrees." One clause added, nothing removed.
- The user's private memory note about this incident lives outside the repo and is **not** this change's job.

### 6. Verification (no shell-test lane exists — manual recipe recorded in the plan)

The repo has no `scripts/*_test.sh`, no bats, no `just test-scripts` (verified). The plan records this manual recipe as acceptance, run from one worktree:

1. Shell A: `just test-e2e compose-strip.spec`. Shell B (same worktree, a few seconds later): `just test-e2e status-bar.spec`. Expect B to print exactly one line `e2e lock: another run holds this worktree's rig — waiting (up to 30m)` on stderr and print nothing else (no `waiting for frontend…`) until A exits; then B runs its own `kill_triple`, starts its rig, and passes. Both runs pass. `ls /tmp/rk-e2e-wt-$(id -u)-*.lock` shows the file; `flock -n <file> -c true` succeeds after both exit.
2. Stale-lock property: start `just test-e2e compose-strip.spec`, wait for `both servers ready`, then `kill -9` the harness bash pid (not its children). Confirm the e2e tmux primary is still alive (`tmux -L rk-test-e2e-<token>-0 ls`) AND `flock -n /tmp/rk-e2e-wt-$(id -u)-<token>.lock -c true` succeeds immediately (the orphan does not pin the lock). Then `just test-e2e compose-strip.spec` again: it takes the lock without waiting, its `kill_triple` reclaims the orphan dev server, and the run passes. Clean up any leftover `rk-test-e2e-<token>-*` sockets with `rk mux reap --prefix rk-test-e2e-<token>- --force` if the `new-session` collides on `e2e-init`.
3. `just dev` probe: with a `just test-e2e` running, `just dev` in the same worktree prints the `WARNING: a just test-e2e run owns this worktree's rig …` line and continues to start (then Ctrl-C it). With no run in flight, no warning. Grep the harness's own run output for `WARNING: a just test-e2e run owns` — must be absent (the `E2E_HARNESS=1` marker suppresses it).
4. Degrade path (macOS has no `flock(1)`): the only `flock` on this box is `/home/linuxbrew/.linuxbrew/bin/flock` (util-linux 2.42.2), so run once with a PATH that omits that directory but keeps `just`, `tmux`, `lsof`, `pnpm`, `air`, `go`, `curl` reachable — e.g. build it with `printf '%s' "$PATH" | tr ':' '\n' | grep -v linuxbrew | paste -sd:` and pass it via `env PATH=… just test-e2e status-bar.spec`; confirm first that `command -v flock` is empty under that PATH. Expect both `e2e lock: flock(1) not found — running unlocked` and the existing `e2e throttle: flock(1) not found — running unthrottled` on stderr, and a passing run. If the tool set cannot be reproduced without linuxbrew (e.g. `just` also lives there), record the reasoning from the code path instead: both degrade branches are `command -v flock` guards with no other dependency.
5. Regression gate: `just test-e2e` (full) once, from this worktree, green; `just test-backend` and `just test-frontend` unaffected (no Go/TS touched) — run `just test-frontend` only if the plan touches `app/frontend` (it should not).

## Affected Memory

- `run-kit/architecture/testing`: (modify) § Playwright E2E Tests — the per-worktree lock (path, keying, ordering, wait/timeout, degrade, child-fd hygiene), the previously undocumented `RK_E2E_SLOTS` semaphore, the `just dev` probe + `E2E_HARNESS`
- `run-kit/test-sockets`: (modify) new Design Decision "Per-worktree exclusive lock precedes the stale-kill" with Rejected alternatives; one-clause extension of "Step-forward port fallback only on an unkillable foreign owner"; frontmatter description
- `run-kit/log`: (modify) hydrate appends the change row per the domain's log convention

Also (not memory): `fab/project/context.md` § Testing — one clause on the flock sentence.

## Impact

- **`scripts/test-e2e.sh`** — the only behavioral change of substance: ~35 new lines near the top, plus `{_wt_lock_fd}>&-` hygiene at the three child launches (tmux `new-session`, the dev-server `bash -c`, `run_playwright`), plus `E2E_HARNESS=1` on the dev-server env list, plus comment updates. The `set -m` / PGID verification block (lines 178–201), `cleanup()`, `kill_triple`/`triple_busy`, the step-forward loop, and the slot semaphore are untouched in logic (the semaphore's two `exec` opens gain only the `{ …; } 2>/dev/null` grouping — § 2 — which restores the script's and Playwright's stderr after the first slot open).
- **`scripts/dev.sh`** — ~10 lines: a non-blocking probe + warning after the `e2e-env.sh` source; nothing else.
- **`scripts/e2e-env.sh`** — untouched (no `export` added; `E2E_TOKEN` is already visible to the sourcing script).
- **`scripts/pw.sh`**, **`justfile`** recipes — untouched (justfile comment only).
- **CI** (`.github/workflows/ci.yml`) — each of the 4 e2e shards is its own runner/checkout, so the lock is always uncontended there; `flock` exists on ubuntu runners; no workflow change. If a future CI topology ran two shards in one checkout they would serialize rather than collide — a strict improvement.
- **Behavioral risk**: a run that previously *silently* clobbered a sibling now *waits* up to 30 minutes. A user who intentionally wanted to preempt their own stuck run must now kill it (or its lock holder) themselves — by design (the harness never kills a sibling). The ERROR line names the lock file and the likely cause so the remedy is discoverable (`fuser`/`lsof` on the lock file).
- **No Go, TypeScript, or Playwright spec changes.** `test_paths` untouched; `true_impact_exclude` (`fab/`, `docs/`) covers the hydrate edits.

## Open Questions

- None blocking. The design was fully specified by the dispatcher; the one design refinement discovered at intake (long-lived children must not inherit the lock fd) has a single correct answer and is recorded as a Confident assumption below rather than a question.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Lock file `/tmp/rk-e2e-wt-<uid>-<E2E_TOKEN>.lock`, exclusive `flock` on a dedicated fd, taken before `kill_triple`, held to process exit, no PID file, no `flock -u` in cleanup | Specified verbatim by the dispatcher (design item 1); mirrors the existing slot-file naming and the `exec {fd}>>` pattern in test-e2e.sh:258 | S:95 R:85 A:95 D:95 |
| 2 | Certain | Probe with `flock -n`; on failure exactly one stderr line `e2e lock: another run holds this worktree's rig — waiting (up to 30m)`, then `flock -w 1800`; on timeout `exit 1` with an ERROR naming the lock file; never kill the sibling | Design item 2; `flock -w` exit code 1 on timeout verified against util-linux 2.42.2 on this box | S:95 R:90 A:95 D:90 |
| 3 | Certain | Slot semaphore semantics unchanged (same files, same N, same position before Playwright); ordering worktree lock → stale-kill + server start → slot → Playwright, with the no-deadlock reasoning as a code comment | Design item 3; worktree locks are per-token and independent, slot holders always finish | S:95 R:85 A:95 D:95 |
| 4 | Certain | Missing `flock(1)` → one stderr warning in the existing `e2e throttle:` style and run unlocked; unopenable lock file → same degrade | Design item 4 plus the slot code's guarded-open precedent (test-e2e.sh:251–269) | S:90 R:90 A:95 D:90 |
| 5 | Certain | No `export E2E_TOKEN` is added to `e2e-env.sh` — sourcing already makes it visible in test-e2e.sh and dev.sh, and the header's "sets without exporting" contract stays intact | Verified: test-e2e.sh:10 and dev.sh:25 `source` the file; e2e-env.sh:4–6 states the contract | S:90 R:95 A:100 D:95 |
| 6 | Certain | `just pw` stays unlocked and unthrottled; `justfile` recipes stay one-line delegations (comment-only edit) | Design item 7; Constitution VIII | S:95 R:95 A:100 D:95 |
| 7 | Confident | Every long-lived child launch (tmux `new-session`, the dev-server `bash -c`, `run_playwright`) closes the lock fd via `{_wt_lock_fd}>&-` (guarded for the unlocked case) | Empirical probe: a tmux server and a detached `bash -c` child both inherit the fd and keep the lock held after the harness exits; a `kill -9`'d harness would otherwise pin the lock for 30 m. Not in the dispatcher's brief (which assumed process exit alone suffices); the requirement is fixed, the exact redirection form at the `set -m` launch is left to apply (§ 1 "Recommended shape") | S:50 R:90 A:85 D:65 |
| 8 | Certain | `scripts/dev.sh` probes with `flock -n <file> -c true` (guarded by `-e`) and prints one `WARNING:` line to stderr when held; never blocks or exits; skipped silently when `flock(1)` is absent | Design item 6 (warning only); the `-c true` form is the standard non-holding probe; silent skip because `just dev` is not the place for harness tooling notices | S:80 R:95 A:85 D:80 |
| 9 | Confident | The harness passes `E2E_HARNESS=1` in the dev-server child env so dev.sh does not warn against its own caller; follows the harness-only `E2E_*` naming, not an `rk` config key | Without it every e2e run prints the warning (the harness holds the lock when it runs `just dev`). Alternatives (reuse `E2E_TMUX_FAMILY` or preset `RK_CODE_SERVER_PORT` as the marker) are heuristics a user preset can trip; a dedicated marker is explicit; the name itself is a free choice the brief did not make | S:50 R:95 A:85 D:65 |
| 10 | Confident | Memory lands in `run-kit/architecture/testing.md` § Playwright E2E Tests (mechanics, plus the previously undocumented `RK_E2E_SLOTS` throttle) and `run-kit/test-sockets.md` § Design Decisions (decision + rejected alternatives); `fab/project/context.md` § Testing gains one clause | No memory file documents `RK_E2E_SLOTS` today (grep); testing.md:46 owns the harness-env paragraph and test-sockets.md:259 owns the stale-kill/step-forward decision, so each new fact sits beside its nearest existing prose; the brief named one "testing memory file", the derivation is documented in two | S:70 R:90 A:80 D:70 |
| 11 | Certain | Verification is the manual recipe in § 6 (two same-worktree runs serialize and both pass; SIGKILL-orphan does not pin the lock; `just dev` warns; degrade path via a `flock`-less PATH) — no new shell-test lane | Design item 8's fallback; verified the repo has no `scripts/*_test.sh`, bats, or `just test-scripts`; introducing a test lane is out of scope | S:85 R:85 A:85 D:80 |
| 12 | Certain | Two same-worktree runs with different explicit `RK_E2E_PORT` values still serialize (lock keys on the token) | Design item 5; they share the socket family unless `E2E_TMUX_SERVER` is also preset, so serializing is the safe default | S:80 R:90 A:85 D:80 |
| 13 | Certain | CI needs no change: the 4 shards are separate runners (`ci.yml:139–142`), so the lock is uncontended | Verified in `.github/workflows/ci.yml` | S:85 R:95 A:95 D:90 |
| 14 | Confident | The two slot-file `exec` opens are wrapped in `{ …; } 2>/dev/null` so the script's stderr (and Playwright's) is no longer swallowed from the first slot open onward; locking semantics untouched; separable hunk, its own plan task | Not in the dispatcher's brief, found while writing the lock block (verified: bare `exec {fd}>>f 2>/dev/null` redirects the shell's stderr permanently). Two tokens per site, trivially reverted, adjacent to the code being changed; the design's "unchanged" is read as semantics, with the byte-identical reading left to the reviewer | S:45 R:95 A:80 D:70 |

14 assumptions (10 certain, 4 confident, 0 tentative, 0 unresolved).
