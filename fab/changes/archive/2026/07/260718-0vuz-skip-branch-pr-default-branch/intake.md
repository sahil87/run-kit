# Intake: Skip Branch-PR Derivation on Default Branch

**Change**: 260718-0vuz-skip-branch-pr-default-branch
**Created**: 2026-07-18

## Origin

Promptless dispatch (synthesized from a live debugging conversation; `{questioning-mode} = promptless-defer` — no user questions asked at intake). The user diagnosed the bug against live `gh` data and made the scoping decision explicitly before dispatch.

> **Problem observed**: run-kit's PANE panel shows `pr #480 · merged` for a pane whose cwd is `~/code/sahil87/fab-kit` on branch `main`. fab-kit PR #480 merged on 2026-07-16, yet the status keeps reappearing indefinitely.
>
> **Root cause (verified against live gh data)**: The branch→PR derivation in `app/backend/internal/prstatus/prstatus_branch.go` registers each pane's `(repoDir, branch)` pair and, on a 30s background refresher, resolves it via `gh pr list --head <branch> --state all --limit 100 --json number,url,state,updatedAt` run in the repo. `gh pr list --head main` filters by head branch NAME only — it also matches fork PRs. PR sahil87/fab-kit#480 is a fork PR (`mcclawd:main` → `sahil87/fab-kit:main`) whose head ref name is `main`, so it matches the pane's local `main` even though that branch never had its own PR. `pickBranchPR` ranks open > merged > closed; #480 (merged) is the only candidate and wins every refresh. The `--state all` durable-merged design (status-pyramid.md D2 revised — merged PRs keep resolving positive statelessly, no grace clock, restart-proof) makes it permanent. Verified: running the exact query in fab-kit returns exactly `[{number: 480, state: MERGED, headRefName: main, url: https://github.com/sahil87/fab-kit/pull/480}]`.
>
> **Decision made (by the user)**: Implement ONLY the default-branch exclusion — do NOT derive a branch-PR for a pane sitting on the repo's DEFAULT branch. A pane parked on `main`/`master` should show no `pr` line at all; the branch→PR feature is meant for feature branches.

Key decisions from the conversation:

- **Scope**: default-branch exclusion only. The alternative — filtering cross-repo/fork PRs via `isCrossRepository` in the `--json` fields — was explicitly rejected ("just 2"). The default-branch exclusion removes the degenerate case entirely, including same-repo historical PRs whose head was the default branch.
- **Detection mechanism**: determine the repo's default branch locally, without network — `git symbolic-ref refs/remotes/origin/HEAD` (yields `refs/remotes/origin/main`).
- **Placement**: the detection is still a subprocess, so it MUST NOT run on the SSE hot path — `Register()` is called from the sessions enrichment loop, which has a documented zero-subprocess invariant. The exclusion belongs on the background refresher goroutine (with an in-memory cached per-repo lookup), never inline in `Register`/`Snapshot`.
- **Fallback**: when `refs/remotes/origin/HEAD` is not set locally (common in clones where it was never initialized), fail-open — derive normally, i.e. current behavior (recorded as an assumption; proposed in the dispatch, not user-confirmed).

## Why

1. **The pain point**: any pane parked on a repo's default branch can permanently display a PR it has nothing to do with. `gh pr list --head <branch>` matches by head ref *name* only, so a fork PR whose head is named `main` (or any historical same-repo PR whose head was the default branch) resolves as "this pane's PR". Because the derivation is deliberately stateless and durable (`--state all`, open > merged > closed precedence, no grace clock — status-pyramid.md D2 revised), the wrong PR re-resolves positive on every 30s refresh, forever. Restarting rk does not clear it; it is restart-proof by design.

2. **The consequence if unfixed**: the PANE panel's `pr` register and the StatusDot's PR tier show permanently wrong state for default-branch panes — a `merged` done-square/`pr #NNN · merged` line that never had anything to do with the pane. This actively misleads the operator (it looks like completed work is associated with the pane) and erodes trust in the PR tier, which sits at the *top* of the status pyramid's precedence ladder.

3. **Why this approach**: the branch→PR feature exists to link *feature branches* to *their* PRs. A default branch never "has its own PR" in this sense — every match for it is degenerate (a fork PR sharing the name, or an old PR whose head happened to be the default branch). Excluding the default branch removes the entire degenerate class in one move, with no per-PR heuristics. The rejected alternative (`isCrossRepository` filtering) would only remove fork PRs, leaving the same-repo-historical-PR variant of the bug in place, and adds a fragile field dependency for a partial fix.

## What Changes

### 1. Default-branch exclusion in the branch→PR refresher

`app/backend/internal/prstatus/prstatus_branch.go` — `BranchRefresher.refresh()` gains a per-pair exclusion: before (or instead of) running `branchPRExec` for a pair, resolve the repo's default branch; when the pair's branch equals the repo's default branch, the pair is **excluded** — it is treated as a confirmed no-PR result.

Exact behavior for an excluded pair:

- **No `gh pr list` call** is made for it (saves a subprocess per pass and guarantees no degenerate match).
- **The entry resolves to a confirmed negative** (`pr = nil`), exactly like a genuinely-empty parsed result today. This matters for the live-bug case: an entry that already holds the stale PR (e.g. fab-kit `main` → #480 cached before the fix deploys or before `origin/HEAD` resolution succeeds) must be *cleared* on the next refresh pass, not stale-kept by the stale-while-revalidate rule. Excluded ⇒ authoritative negative, not a transient error.
- `Snapshot`/`SnapshotBranchPR` then returns `(nil, false)` for the pair, so `enrichWindowPR` in `app/backend/internal/sessions/sessions.go` leaves `PrURL`/`PrNumber`/`PrState` unset — the pane panel renders no `pr` row and the StatusDot falls through to the lower tiers (fab/agent/tmux). **No change to `sessions.go` is expected** — the join simply misses; only touch it if implementation reveals a genuine need.
- `Register`/`Snapshot` signatures and hot-path behavior are unchanged: registration of default-branch pairs still happens (Register stays a dumb, cheap set-touch with zero subprocess work); the *refresher* is where the pair is recognized as excluded each pass.

### 2. Local default-branch detection (new seam)

A new resolver on the refresher, following the existing seam pattern:

```go
// package var / instance field, mirroring branchPRExec / branchPRAvailable
var branchDefaultExec = func(ctx context.Context, repoDir string) ([]byte, error) {
    queryCtx, cancel := context.WithTimeout(ctx, <timeout>)
    defer cancel()
    cmd := exec.CommandContext(queryCtx, "git", "symbolic-ref", "refs/remotes/origin/HEAD")
    cmd.Dir = repoDir
    return cmd.Output()
}
```

- Output parsing: `refs/remotes/origin/main` → strip the `refs/remotes/origin/` prefix (and trailing newline) → `main`. Anything unparseable ⇒ lookup failure.
- Constitution §I: `exec.CommandContext`, explicit argv slice, timeout (reuse `ghTimeout` or an equivalent short constant — this is a local, near-instant command). `repoDir` is set as `cmd.Dir`, not interpolated; no user input in argv at all.
- **No network**: `git symbolic-ref` reads a local ref file only.

### 3. Per-repo in-memory caching on the refresher

The default-branch lookup runs on the **refresher goroutine only**, and its result is cached in-memory per `repoDir` so each repo costs at most one `git symbolic-ref` per TTL window — not one per pair per pass. Pattern mirrors the existing `availValid`/`availAt` gh-availability cache (`branchPRAvailabilityTTL`): cache both positive results (the branch name) and failures (fail-open verdicts), each with a taken-at timestamp, re-probed only when stale. Constitution §II: in-memory only, derived at refresh time, no persistent state. Exact TTL and cache-map shape are plan-level details; a TTL in the minutes range is appropriate (default branches essentially never change).

### 4. Failure fallback: fail-open

When the default branch cannot be determined for a repo — `refs/remotes/origin/HEAD` unset (never initialized locally), no `origin` remote, git absent/error, unparseable output — the refresher **fails open**: the pair is resolved normally (current behavior, `gh pr list` runs). Rationale: consistent with the module's fail-soft/stale-while-revalidate posture; a missing local ref should not silently disable a working feature for the whole repo. The fail-open verdict is cached like a positive one (no per-pass retry storm). This was proposed in the dispatch but not user-confirmed — recorded as a Confident assumption below.

### 5. Tests

Go tests in `app/backend/internal/prstatus/` following the existing seam pattern in `prstatus_branch_test.go` (`newTestRefresher` with injected `exec`/`available`/`now`; the new default-branch resolver becomes a third injectable seam). Cover at least:

- A pair on the default branch is excluded: no `branchPRExec` call for it, `Snapshot` returns `(nil, false)`.
- **The live-bug regression**: an entry already holding a positive PR is cleared (confirmed negative) once its branch is recognized as the default branch.
- A pair on a feature branch in the same repo still resolves normally (exclusion is branch-scoped, not repo-scoped).
- Default-branch lookup failure ⇒ fail-open: the pair resolves via `gh pr list` exactly as today.
- Caching: N pairs in one repo cost one default-branch lookup per pass/TTL window (call-count assertion, mirroring the availability-cache test style).

No frontend changes and no Playwright coverage needed — an excluded pair yields no PR join and the pane panel already renders without a `pr` row when no PR is derived.

## Affected Memory

- `run-kit/architecture`: (modify) the branch→PR derivation entry (prstatus_branch.go — `--state all` lookup + `pickBranchPR` precedence + stateless merged durability) gains the default-branch exclusion: pairs whose branch is the repo's default branch (local `git symbolic-ref refs/remotes/origin/HEAD`, per-repo cached on the refresher, fail-open on lookup failure) resolve to a confirmed negative — no branch-PR is ever derived for a default-branch pane.

## Impact

- **Backend**: `app/backend/internal/prstatus/prstatus_branch.go` — the whole change surface (new resolver seam + per-repo cache + exclusion in `refresh()`); `app/backend/internal/prstatus/prstatus_branch_test.go` — new tests. `app/backend/internal/sessions/sessions.go` (`enrichWindowPR`) is a call-site *reader* only — expected untouched.
- **Frontend**: none. The pane panel and StatusDot already handle the no-PR case; an excluded pair is indistinguishable from "no PR exists".
- **Behavioral**: panes on a repo's default branch lose their `pr` line/PR dot-tier entirely (including any previously-legitimate case of a same-repo PR whose head was the default branch — accepted and intended per the user's scoping decision). Feature-branch behavior, including D2 durable-merged, is unchanged.
- **Ops/perf**: one extra local `git symbolic-ref` subprocess per repo per cache-TTL window on the refresher goroutine; the SSE hot path stays zero-subprocess. Excluded pairs *save* a `gh pr list` network call per pass.

## Open Questions

None — the scoping and mechanism decisions were made explicitly in the originating conversation; remaining sub-decisions are recorded as graded assumptions below.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Scope is the default-branch exclusion ONLY; fork-PR filtering via `isCrossRepository` is rejected | Discussed — user explicitly chose "just 2" (exclusion only), rejecting the cross-repo filter as a partial fix | S:95 R:85 A:95 D:95 |
| 2 | Certain | The exclusion check (a subprocess) runs on the background refresher goroutine, never inline in `Register`/`Snapshot` | Documented zero-subprocess hot-path invariant in prstatus_branch.go + user-stated constraint; constitution-consistent | S:90 R:80 A:95 D:90 |
| 3 | Certain | Default branch is determined locally via `git symbolic-ref refs/remotes/origin/HEAD` with `exec.CommandContext`, explicit argv, timeout | Discussed constraint (no network); Constitution §I dictates the execution style | S:90 R:75 A:90 D:85 |
| 4 | Confident | On failure to determine the default branch (origin/HEAD unset, no origin remote, git error), fail open — derive normally (current behavior), with the failure verdict cached | Proposed in the dispatch as the reasonable default but not user-confirmed; consistent with the module's fail-soft stale-while-revalidate posture and avoids silently disabling the feature repo-wide | S:60 R:85 A:70 D:60 |
| 5 | Confident | Default-branch lookups are cached in-memory per-repo on the refresher (TTL-style, mirroring the `branchPRAvailabilityTTL` availability cache); exact TTL/shape is a plan detail | Constitution §II (in-memory only) + the existing refresher caching pattern gives the shape; minutes-range TTL since default branches essentially never change | S:70 R:90 A:85 D:65 |
| 6 | Confident | An excluded pair resolves to a confirmed NEGATIVE (entry cleared), not a skipped/stale-kept entry — a live cached stale PR (the #480 case) disappears within one refresh tick | The observed bug is the stale line *reappearing*; treating exclusion as transient would keep serving the cached wrong PR indefinitely, defeating the fix | S:60 R:85 A:85 D:80 |
| 7 | Certain | Tests follow the existing injected-seam pattern in prstatus_branch_test.go (exec/available/now + a new default-branch seam); Go tests only, no frontend/e2e | code-quality.md mandates tests for bug fixes; the deterministic seam pattern already exists in this exact package | S:85 R:90 A:95 D:90 |
| 8 | Certain | No frontend change — an excluded pair yields no PR join and the pane panel already renders without a `pr` row when no PR is derived | Discussed — stated in the dispatch and confirmed by the existing no-PR render path (`enrichWindowPR` leaves fields nil on snapshot miss) | S:90 R:90 A:90 D:90 |

8 assumptions (5 certain, 3 confident, 0 tentative, 0 unresolved).
