# Intake: Damp the Serial Git-Fallback Storm in FetchSessions

**Change**: 260904-75c8-damp-git-fallback-storm
**Created**: 2026-09-04

## Origin

> Daemon reliability - Change F: damp the serial git-fallback storm in FetchSessions. Read and follow fab/plans/sahil/26-09-04-daemon-blocking-reliability.md, Change F section exactly. Files: app/backend/internal/sessions/sessions.go (+tests). Re-verify all line numbers against current HEAD before editing - plan numbers are as of fd16e6b4.

One-shot invocation via `/fab-new`. This is Change F of the six-change daemon blocking & reliability plan (`fab/plans/sahil/26-09-04-daemon-blocking-reliability.md`), authored from a live incident diagnosis on 2026-09-04. Wave 1, parallel with A/B/D/E (disjoint files). All plan line numbers were re-verified against current HEAD (`b53e0cad`) during this intake — they still hold.

The plan's one question for review: *does a pane in a real repo still get a correct branch promptly, and does a non-repo cwd no longer trigger subprocess fallbacks on a cycle?*

## Why

**The pain point.** `resolveGitBranches` (`app/backend/internal/sessions/sessions.go:329-404`) runs inside the SSE hub's poll goroutine on every `FetchSessions` (call site `sessions.go:707`). For each cache-missed pane cwd it first tries the direct `.git/HEAD` read (`resolveGitBranchFromHead`, `:257-303`), and on ANY `(ok=false, detached=false)` result falls back to a `git rev-parse --abbrev-ref HEAD` subprocess (`resolveGitBranchWithGit`, `:308-321`, 250ms cap via `gitBranchCmdTimeout` at `:162`). The misses are resolved **serially**, up to `gitBranchResolveLimit = 16` per fetch (`:161`) — worst case **4 seconds of serial execs inside the poll goroutine** per tick.

The direct reader stats only `<cwd>/.git` — no ancestor walk — so TWO very different shapes both land in the subprocess fallback:

1. **A pane cwd that is a repo subdirectory** (e.g. `~/code/repo/src/`): no `.git` there, but git itself walks up — the subprocess is currently the ONLY way these panes get a branch at all.
2. **A pane cwd not in any repo** (`~`, `/tmp`, …): the subprocess also fails, the result is cached as a negative for only `gitBranchNegativeTTL = 15s` (`:160`), and the 250ms exec re-fires **every 15 seconds, forever, for every non-repo pane**.

**The consequence.** During the 2026-09-04 incident these serial execs (compounded by Changes A–C's issues) contributed to the poll goroutine losing whole seconds per tick: `SSE poll error err="signal: killed"`, stale snapshots, the switch mask parked for seconds. tmux itself answered in ≤15ms throughout — the time is lost inside the daemon. Left unfixed, every non-repo pane is a permanent 250ms-per-15s tax on the poll loop, and heavy multi-pane servers re-arm the storm continuously.

**Why this approach.** The fix separates the two shapes: a clean "no `.git` ancestor anywhere up the tree" stat walk is an **authoritative negative** — git would find nothing either, so re-probing on a 15s cadence buys nothing — and gets a much longer TTL with no subprocess at all. The subprocess fallback is reserved for the genuinely ambiguous case: a `.git` that EXISTS somewhere on the walk but whose shape the direct reader couldn't parse. The repo already has the exact walk primitive on this same hot path: `config.FindGitRoot` (`app/backend/internal/config/gitroot.go:10`, a pure stat-walk used by `enrichWindowPR`'s `windowPRKey`), so this stays a zero-exec, hot-path-safe classification.

## What Changes

All changes in `app/backend/internal/sessions/sessions.go` + `sessions_test.go`. No API surface, no frontend, no other packages (reuses `internal/config.FindGitRoot`, already imported by the package's sibling code path).

### 1. Ancestor walk in the direct reader — repo-subdirectory cwds resolve without a subprocess

`resolveGitBranchFromHead` (or a thin wrapper used by `resolveGitBranches`) walks up from the pane cwd to the filesystem root looking for `.git` — the `config.FindGitRoot` walk shape — instead of statting only `<cwd>/.git`:

- **`.git` found at an ancestor** → parse it exactly as today (dir → `<gitdir>/HEAD`; file → `gitdir:` indirection for worktrees; `ref: refs/heads/X` → branch; raw SHA → detached). A pane in `~/code/repo/src/deep/dir` now resolves its branch via file reads alone — faster AND correct, where today it burns a subprocess.
- **Clean walk, no `.git` anywhere** → a new distinct outcome: **authoritative no-repo negative** (see §2). No subprocess.
- **`.git` found but unparseable** (unreadable HEAD, malformed `gitdir:` file, unrecognized ref shape) → keep today's `(ok=false, detached=false)` → subprocess fallback still runs, `git -C <cwd> rev-parse --abbrev-ref HEAD` unchanged.

The walk is bounded by path depth (same termination as `FindGitRoot`: stop when `filepath.Dir(dir) == dir`) and costs one `os.Stat` per level — hot-path safe, same posture as the existing `enrichWindowPR` usage.

### 2. Authoritative no-repo negative with a long TTL

A clean no-`.git`-ancestor walk caches a negative entry with a new, much longer TTL — new constant `gitBranchNoRepoTTL = 5 * time.Minute` alongside the existing constants at `sessions.go:158-172` <!-- assumed: 5m TTL value — plan says only "much longer"; 5m matches the sibling gitBranchDetachedGraceTTL scale --> — instead of `gitBranchNegativeTTL = 15s`. Consequence: a pane parked in `~` costs a handful of stats once per 5 minutes instead of a 250ms serial exec every 15 seconds.

The 15s `gitBranchNegativeTTL` **remains** for the still-ambiguous negatives: unparseable-`.git` shapes whose subprocess fallback also failed, and grace-expired detached entries. Those genuinely can change shape quickly and keep the fast re-probe cadence. The cache entry needs no schema change — only the `expiresAt` chosen at write time differs; `lastGood`/`lastGoodAt` carry-through in the `default:` arm of the `switch` at `:378-394` is preserved (a no-repo cwd has no lastGood to carry anyway, but the code path stays uniform).

Staleness trade-off accepted: `git init`/`git clone` INTO a previously non-repo pane cwd shows its branch within ≤5 minutes rather than ≤15 seconds. (The detached-grace behavior at `:382-387` is untouched: a detached repo is a *found* `.git`, never a no-repo negative.)

### 3. Bounded-concurrency miss resolution

The miss-resolution loop (`:366-396`) currently runs serially. Resolve misses concurrently with a small bound — `gitBranchResolveConcurrency = 4` <!-- assumed: bound value 4 — plan says "a small bound"; misses are dominated by stats after §1-2, subprocess residue is rare --> — so the worst case for a burst of unparseable-shape cwds is `ceil(16/4) × 250ms ≈ 1s` instead of 4s, and stat-only misses complete near-instantly in parallel. Mechanics: fan the per-cwd body (HEAD read/walk + optional subprocess + entry construction) out over a semaphore or worker pool, collect `updates` under a local mutex or per-goroutine slices, keep the single batched `gitBranchCache` write-lock section at `:398-402` as today. The existing `ctx.Err()` early-break (`:367-369`) must remain effective (workers check ctx; in-flight 250ms caps still bound the tail). `gitBranchResolveLimit = 16` stays.

### 4. Tests (`sessions_test.go`)

Regression coverage for the plan's review question, alongside whatever table tests exist today:

- **Repo-subdirectory cwd resolves via direct read**: a temp repo with a real `.git/HEAD` (`ref: refs/heads/main`), pane cwd at `<repo>/sub/dir` → branch `main`, and no subprocess needed (verifiable by making the fallback impossible, e.g. an unparseable-only seam or asserting resolution succeeds with a canceled/expired ctx that would kill any exec).
- **Worktree subdirectory** (`.git` file with `gitdir:` at the walk-found root) resolves correctly.
- **Non-repo cwd is an authoritative negative**: temp dir with no `.git` ancestor (guard against the tmpdir itself living under a repo) → negative cached with the long TTL — assert `expiresAt` lands on the `gitBranchNoRepoTTL` horizon, not 15s, and that no `git` subprocess runs.
- **Unparseable `.git` still falls back**: a `.git` file with garbage content → subprocess path taken (observable via the existing behavior contract), negative cached on the 15s cadence.
- **Concurrency**: a batch of misses resolves without data races (`-race` on the package per the plan's verification note) and respects the bound; ctx cancellation stops issuing new work.
- **Existing behavior preserved**: detached-HEAD grace serve, positive TTL, resolve limit truncation — keep/extend existing tests.

## Affected Memory

- `run-kit/architecture.md`: (modify) the `internal/sessions` row (§ Go Backend Libraries) — branch resolution now walks to the `.git` ancestor, no-repo cwds are long-TTL authoritative negatives, misses resolve with bounded concurrency; subprocess fallback narrowed to unparseable-`.git` shapes.
- `run-kit/daemon-lifecycle.md`: (modify) the Branch→PR hot-path passage stating "non-repo cwds keep plain negative behavior" and describing `resolveGitBranches`' 15s negative cadence — update to the two-tier negative (authoritative no-repo 5m vs probing 15s).

## Impact

- **Code**: `app/backend/internal/sessions/sessions.go` (`resolveGitBranchFromHead`, `resolveGitBranches`, constants block), `app/backend/internal/sessions/sessions_test.go`. Possible tiny import addition (`internal/config` or an inlined walk).
- **Behavioral surface**: `WindowInfo` branch enrichment consumed by `GET /api/sessions`, the SSE hub tick, and the Branch→PR derivation (`enrichWindowPR` keys off the branch this function supplies). Branch coverage IMPROVES for repo-subdirectory panes (no longer subject to subprocess flakiness/timeout); non-repo panes gain up-to-5m staleness on repo *creation* only.
- **Performance**: poll-goroutine worst case for branch resolution drops from ~4s serial to ~1s bounded-parallel, and the steady-state non-repo re-probe storm (250ms × N panes every 15s) disappears entirely.
- **Constitution**: I — all subprocess use stays `exec.CommandContext` with timeout (unchanged fallback); II — still derived state, TTL caches remain non-authoritative in-memory damping (existing pattern).
- **Interaction with sibling changes**: none share files. Change C restructures the poll loop that *calls* `FetchSessions`; F reduces the per-call cost independently. Safe to land in any order.
- **Verification gates**: `cd app/backend && go test ./...` (with `-race` on this package), then the standard `just test` / `just build` gates.

## Open Questions

- None — the plan section is prescriptive, and the two open values (no-repo TTL, concurrency bound) are low-stakes tunables recorded as Tentative assumptions below.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | A clean no-`.git`-ancestor walk is an authoritative negative — no subprocess, long TTL; subprocess fallback reserved for unparseable `.git` shapes | Stated verbatim in the plan's Change F fix direction | S:95 R:85 A:95 D:95 |
| 2 | Confident | Add the ancestor walk to the direct reader (reusing the `config.FindGitRoot` walk shape) so repo-subdirectory panes resolve via file reads | Required for correctness of #1 — without it, every repo-subdirectory pane would misclassify as no-repo and lose its branch; the plan's review question ("a pane in a real repo still gets a correct branch promptly") pins this; walk primitive already proven on this hot path | S:80 R:75 A:90 D:85 |
| 3 | Tentative | `gitBranchNoRepoTTL = 5 * time.Minute` | Plan says only "much longer TTL"; 5m matches the sibling `gitBranchDetachedGraceTTL` scale; trivially tunable one-constant change | S:45 R:90 A:60 D:50 |
| 4 | Confident | Also implement bounded-concurrency miss resolution (the plan's "and/or" second lever) | Plan offers it explicitly; defense in depth for residual subprocess bursts; cache mutation pattern already batched so the concurrency seam is contained | S:65 R:80 A:75 D:60 |
| 5 | Tentative | Concurrency bound `gitBranchResolveConcurrency = 4` | Plan says "a small bound" without a value; 4 keeps worst-case subprocess wall time ≈1s while bounding fork pressure; one-constant change | S:40 R:90 A:55 D:50 |
| 6 | Confident | Keep `gitBranchNegativeTTL = 15s` for unparseable-shape negatives and grace-expiry, keep `gitBranchResolveLimit = 16`, leave detached-grace and positive-TTL behavior untouched | Plan scopes the fix to the no-repo storm; detached-grace is a deliberate documented design (memory DD, 260823-8ocy) this change must not disturb | S:70 R:85 A:85 D:80 |

6 assumptions (1 certain, 3 confident, 2 tentative, 0 unresolved).
