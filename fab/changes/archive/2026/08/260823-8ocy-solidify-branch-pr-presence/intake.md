# Intake: Solidify Branch→PR Presence Pipeline

**Change**: 260823-8ocy-solidify-branch-pr-presence
**Created**: 2026-08-23

## Origin

Promptless dispatch from `/fab-proceed`, synthesizing a `/fab-discuss` investigation (2026-08-23) in which the root cause was verified in code and the user approved an exact 3-item fix plan.

> Solidify the branch→PR presence pipeline — the sidebar PR glyph (and every PR surface fed by `WindowInfo.PrURL`/`PrNumber`/`PrState`) intermittently disappears. Fix backend-side: (1) key the PR register/join on `(gitRoot, branch)` instead of `(paneCwd, branch)`, (2) treat detached HEAD as "unknown" (serve the last-known branch for a grace window) instead of negative-caching "no branch", (3) add a short backend presence hold at the join level as a backstop for transient misses, while authoritative negatives still clear immediately.

**How the decision was reached**: the investigation traced the full derivation chain live in code, ranked four disappearance vectors, and the user approved the 3-item plan verbatim. Frontend-side hysteresis was explicitly rejected (fix belongs backend-side in one place so all surfaces benefit); keeping pane-cwd keying with a bigger hold was rejected (masks rather than fixes key churn).

## Why

**Problem**: The sidebar PR glyph — and every other PR surface (session tiles, flyout, status panel) fed by `WindowInfo.PrURL`/`PrNumber`/`PrState` — intermittently blanks out and reappears. The glyph is gated frontend-side on `prNumber && prState ∈ {open, merged, closed}` (`prOwnsGlyph`, `app/frontend/src/components/pr-status-model.ts:170`), and those fields are recomputed from scratch on every ~2.5s SSE tick as a conjunction of live lookups with **no hold or hysteresis anywhere**:

pane cwd (tmux) → per-cwd git-branch TTL cache (`resolveGitBranches`, `app/backend/internal/sessions/sessions.go:260` — 30s positive / **15s negative** TTL, `.git/HEAD` read at `resolveGitBranchFromHead` :199, 250ms `git rev-parse` fallback) → `enrichWindowPR` (sessions.go:517) registers + joins on the key `(paneCwd, branch)` via `prstatus.Register`/`SnapshotBranchPR` → `internal/prstatus.BranchRefresher` entry (30s tick + first-sight wake, 5-min `branchPRObservedTTL`, three resolvers: default-branch exclusion → viewer head-index join → `gh pr list --head --state all` fallback) → `api/sse.go attachPRStatus` URL-join for colors.

One missing link for one tick ⇒ fields omitted ⇒ glyph vanishes immediately.

**Disappearance vectors (verified, ranked)**:

1. **Detached HEAD during rebase/checkout** — `resolveGitBranchFromHead` returns `""` when `.git/HEAD` isn't `ref:`-prefixed (sessions.go:231-233); `resolveGitBranchWithGit` likewise maps `HEAD` → `""` (:252-254); `""` is negative-cached for 15s (`gitBranchNegativeTTL`, :115); `enrichWindowPR` early-returns on empty branch ⇒ blank for the whole rebase plus up to 15s after. This workflow (git-pr, fab pipelines, agents) rebases constantly — the **dominant** vector.
2. **Join key is the pane's cwd, not the git root** — `windowBranchRepo` (sessions.go:472) returns `Panes[i].Cwd`; an agent `cd`-ing into a subdirectory creates a new `(cwd, branch)` pair ⇒ snapshot miss ⇒ blank until the first-sight wake pass resolves (~1.5–2s best case, up to 30s+ via the gh fallback). Note `deriveGitRoot` (sessions.go:446) already computes the stable git root per window in the same FetchSessions loop (`w.GitRoot`, set at sessions.go:631, just before `enrichWindowPR` at :635).
3. **Active-pane preference flapping** — `windowBranchRepo` prefers the active pane; switching panes in a split flips the key.
4. **5-min `branchPRObservedTTL` age-out** while no dashboard is open ⇒ blank-until-wake on reopen.

**If not fixed**: the PR glyph remains an unreliable signal — users learn to distrust it, and every surface built on `PrURL`/`PrNumber`/`PrState` inherits the flicker. The status pyramid puts PR at the top of the precedence ladder (`docs/specs/status-pyramid.md`), so a flapping top tier degrades the whole status vocabulary.

**Why this approach**: the flicker is a backend identity/continuity problem — the frontend correctly renders what it is given. Fixing keying (item 1) and detached-HEAD semantics (item 2) removes the two dominant vectors at their root; a bounded join-level hold (item 3) is the belt-and-braces backstop for the residual transient misses (vectors 3 and 4), placed backend-side so every surface benefits in one place.

## What Changes

### 1. Key the PR register/join on `(gitRoot, branch)` instead of `(paneCwd, branch)`

In `app/backend/internal/sessions/sessions.go`:

- `enrichWindowPR` takes the window's already-derived `w.GitRoot` as the `repoDir` for `prstatus.Register` / `prstatus.SnapshotBranchPR`, falling back sensibly (e.g. to the pane cwd from `windowBranchRepo`) when `GitRoot` is empty. Ordering inside `FetchSessions` already supports this: `GitRoot` is derived at sessions.go:631 just before `enrichWindowPR` at :635.
- `windowBranchRepo` continues to supply the branch (active pane preferred, first pane with a branch as fallback); only the repoDir half of the key changes.

Effect: the `BranchRefresher` entry key becomes stable per worktree — `cd`-churn inside a repo and most pane-flap no longer create new `(repoDir, branch)` pairs, eliminating snapshot misses from key churn and shrinking the entry map. The refresher's per-repo origin/default-branch caches and `gh pr list` `cmd.Dir` work identically with a git root as repoDir (a git root is a valid cwd for all three resolvers).

### 2. Treat detached HEAD as "unknown", not "no branch"

In the git-branch resolution layer of `internal/sessions` (`resolveGitBranchFromHead` / `resolveGitBranchWithGit` / `resolveGitBranches` and the `gitBranchCache`):

- Distinguish "detached HEAD" (HEAD exists but isn't `ref:`-prefixed, and/or `rebase-merge`/`rebase-apply` exists in the gitdir) from "not a repo / unreadable".
- On detached HEAD, serve the **last-known branch** for that cwd/root for a grace window instead of negative-caching `""` — a rebase ends on the branch it started on; blanking mid-rebase is pure noise.
- Genuine "no repo" / never-seen-a-branch cases keep today's behavior (negative cache, `enrichWindowPR` skip).

Effect: rebases/checkouts (vector 1, the dominant one) no longer blank the glyph at all.

### 3. Short presence hold at the join level (backstop)

On a transient join miss (NOT an authoritative negative), keep serving the last-good PR for that window/key for roughly one refresher interval (~30s), backend-side, so every surface (sidebar row, session tiles, flyout, status panel) benefits. Likely home: `enrichWindowPR` and/or the `internal/prstatus` snapshot layer (`prstatus_branch.go`).

**Authoritative negatives must still clear immediately** — the default-branch exclusion and a successfully parsed empty `gh pr list` result are real "no PR" answers, not misses. The hold covers identity/key churn and transient misses only (vectors 3 and 4, plus anything items 1–2 don't catch).

### 4. Tests

New behavior includes tests per `fab/project/code-quality.md`: the `prstatus` package (`prstatus_branch_test.go`) and `sessions` package (`sessions_test.go`) already have table-driven tests with exec seams to stub `gh`/`git` — extend alongside. Cover at minimum: gitRoot-keyed register/join with empty-GitRoot fallback; detached-HEAD grace (mid-rebase serve, grace expiry, genuine no-repo unchanged); hold serve-then-expire; authoritative-negative immediate clear.

### Constraints (from constitution + existing design)

- **SSE hot path stays zero-subprocess/zero-network** — documented invariant in `enrichWindowPR` (sessions.go) and `prstatus_branch.go`; all three items must preserve it (holds and grace are in-memory reads).
- **Constitution §II (No Database)**: no new persistent state store; last-good holds are in-memory, consistent with the existing stale-while-revalidate posture. The existing `$XDG_STATE_HOME` seed cache (`prstatus_disk.go`) is unchanged in role.
- **Constitution §I (Security First)**: any new subprocess via `exec.CommandContext` with timeout + argv slices (existing seams; none expected to be needed).
- **No frontend changes**: `prOwnsGlyph` and the rest of `pr-status-model.ts` are untouched — the fix is entirely in what the backend serves.

**Expected outcome**: items 1+2 remove the large majority of observed flicker; item 3 is the backstop.

## Affected Memory

- `run-kit/architecture`: (modify) prstatus/BranchRefresher description — entry keying becomes `(gitRoot, branch)`, detached-HEAD grace and join-level presence hold added to the branch→PR derivation story
- `run-kit/ui/status-signals`: (modify) PR presence contract — note that PR fields now have backend-side continuity (hold + detached-HEAD grace); glyph semantics themselves unchanged

## Impact

- `app/backend/internal/sessions/sessions.go` — `windowBranchRepo` / `enrichWindowPR` / `resolveGitBranches` / `resolveGitBranchFromHead` + `gitBranchCache` (detached-HEAD grace, gitRoot keying)
- `app/backend/internal/prstatus/prstatus_branch.go` — entry keying semantics, possibly the presence hold
- `app/backend/internal/sessions/sessions_test.go`, `app/backend/internal/prstatus/prstatus_branch_test.go` — new table-driven cases
- Consumers unchanged in contract: `api/sse.go attachPRStatus` (URL join), `app/frontend/src/components/pr-status-model.ts` (`prOwnsGlyph`), all PR surfaces
- Consistency check during hydrate: `docs/specs/status-pyramid.md` (PR tier contract) and `docs/memory/run-kit/ui/status-signals.md`

## Open Questions

- None — the 3-item plan was user-approved with specific values; remaining sizing choices (grace-window length, hold scope) are graded assumptions below.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Fix backend-side; no frontend hysteresis (`pr-status-model.ts` untouched) | Discussed — user rejected frontend hysteresis so all surfaces benefit in one place | S:90 R:85 A:90 D:95 |
| 2 | Certain | Key register/join on `(gitRoot, branch)` using already-derived `w.GitRoot`, falling back when empty | Discussed — user approved item 1 verbatim; `deriveGitRoot` precedes `enrichWindowPR` in FetchSessions | S:90 R:80 A:90 D:90 |
| 3 | Certain | Detached HEAD serves last-known branch for a grace window instead of 15s negative-caching `""`; genuine no-repo unchanged | Discussed — user approved item 2 verbatim; a rebase ends on the branch it started on | S:90 R:80 A:85 D:90 |
| 4 | Certain | Join-level hold ~one refresher interval (~30s) on transient misses; authoritative negatives (default-branch exclusion, parsed-empty `gh pr list`) clear immediately | Discussed — user approved item 3 verbatim including the negative/miss distinction | S:90 R:80 A:85 D:85 |
| 5 | Confident | Grace-window length for detached-HEAD serve is a plan-time constant (order of the existing positive TTL to a few minutes), tuned to cover a typical rebase | Duration not pinned in discussion; easily changed later, bounded by design (grace must expire so deliberate long-term detached checkouts eventually blank) | S:55 R:85 A:65 D:55 |
| 6 | Confident | Presence hold is keyed per `(repoDir, branch)` entry (not per window), so a genuine branch switch changes the key and never serves the old branch's PR | Discussion said "window/key"; key-scoped avoids cross-branch bleed and item 2 already covers window continuity through rebases | S:45 R:80 A:55 D:55 |
| 7 | Confident | Exact home of the hold (enrichWindowPR join vs prstatus snapshot layer) decided at plan/apply time | Discussion flagged "possibly the hold" in prstatus_branch.go; both preserve the zero-exec hot path and are equivalent for consumers | S:50 R:85 A:70 D:60 |
| 8 | Confident | Vectors 3 (active-pane flap) and 4 (5-min age-out) get no dedicated mechanism beyond items 1+3; `branchPRObservedTTL` stays 5 min | Discussed — approved plan scopes them to the backstop; changing the TTL was not part of the approved plan | S:60 R:85 A:75 D:70 |
| 9 | Certain | New behavior ships with table-driven tests using the existing exec seams (`gh`/`git` stubs) in prstatus + sessions packages | code-quality.md mandates tests; both packages already carry the seams | S:80 R:90 A:95 D:95 |

9 assumptions (5 certain, 4 confident, 0 tentative, 0 unresolved).
