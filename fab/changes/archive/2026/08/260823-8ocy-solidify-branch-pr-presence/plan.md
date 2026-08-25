# Plan: Solidify Branch→PR Presence Pipeline

**Change**: 260823-8ocy-solidify-branch-pr-presence
**Intake**: `intake.md`

## Requirements

### Sessions: Branch→PR join keying

#### R1: PR register/join keys on the git root, not the pane cwd
`enrichWindowPR` (`app/backend/internal/sessions/sessions.go`) SHALL derive the `repoDir` half of the `(repoDir, branch)` key by resolving the **branch-supplying pane's cwd** to its git root via `config.FindGitRoot` (a pure stat-walk, no subprocess), falling back to that pane's raw cwd when no root is found. `windowBranchRepo` continues to choose the pane (active pane with a branch preferred, else first pane with a branch) and supply the branch.

- **GIVEN** a window whose branch-supplying pane sits in `/repo/sub/dir` on branch `b` with a resolved PR entry keyed `(/repo, b)`
- **WHEN** the pane `cd`s between `/repo`, `/repo/sub`, and `/repo/sub/dir` across SSE ticks
- **THEN** every tick registers and joins the same `(/repo, b)` key and `PrURL`/`PrNumber` never blank
- **AND** a pane whose cwd is not inside any git repo falls back to the raw cwd key (today's behavior)

- **GIVEN** a split window whose active pane and fallback pane are both inside the same worktree (any subdirectories)
- **WHEN** the active pane switches between them
- **THEN** the join key is unchanged and the PR fields do not flap

### Sessions: Detached-HEAD grace

#### R2: Detached HEAD serves the last-known branch for a grace window
The git-branch resolution layer (`resolveGitBranchFromHead` / `resolveGitBranchWithGit` / `resolveGitBranches`) SHALL distinguish **detached HEAD** (`.git/HEAD` readable but not `ref:`-prefixed, or `rev-parse` reporting `HEAD`) from "not a repo / unreadable". On detached HEAD, when the cache holds a last-known branch for that cwd whose last genuine positive resolution is within `gitBranchDetachedGraceTTL` (5 minutes), the resolver SHALL serve that branch, caching it with the short negative-TTL cadence (15s) so the real branch is picked up promptly after the rebase ends. Grace expiry or no last-known branch SHALL degrade to today's negative caching. Genuine non-repo cwds MUST behave exactly as today (they never reach the detached path — detection requires a readable HEAD).

- **GIVEN** a pane on branch `b` with a rendered PR glyph
- **WHEN** an agent runs a rebase that detaches HEAD for 90 seconds
- **THEN** every tick during the rebase resolves branch `b` (grace serve) and the PR fields never blank
- **AND** within ~15s of the rebase completing, the resolver re-reads the real HEAD and serves the live branch

- **GIVEN** a cwd deliberately parked on a detached checkout for longer than the grace window
- **WHEN** the grace TTL (measured from the last genuine positive resolution) expires
- **THEN** the branch resolves empty and the PR fields blank, as today

### Prstatus: Entry retention (presence hold)

#### R3: BranchRefresher retains unobserved entries past the resolution TTL
`BranchRefresher.refresh` (`app/backend/internal/prstatus/prstatus_branch.go`) SHALL split the single age-out into two windows: pairs unobserved for more than `branchPRObservedTTL` (5 min, unchanged) stop being **resolved** (no gh/git cost, and they no longer hold their repo's origin/default-branch cache entries live), but their entries are **retained** and served by `Snapshot` until unobserved for more than a new `branchPRRetainTTL` (30 min), at which point they are deleted as today. A retained entry re-registered by a returning dashboard serves its last-good PR immediately (presence held) and is re-resolved by the next tick (≤ 30s value staleness, then fresh). Authoritative negatives (default-branch exclusion; a successfully parsed empty `gh pr list`) MUST keep clearing `entry.pr` immediately — retention holds entries, never overrides a real "no PR" answer.

- **GIVEN** a dashboard closed for 10 minutes (pairs unobserved > 5 min, < 30 min)
- **WHEN** the dashboard reopens and the SSE loop re-registers the pairs
- **THEN** the first join tick serves each pair's last-good PR (no blank window) and the next refresher pass re-resolves values

- **GIVEN** a retained entry whose branch is the repo's default branch
- **WHEN** a refresh pass runs while the pair is observed
- **THEN** the default-branch exclusion clears its PR immediately (retention does not shield authoritative negatives)

- **GIVEN** a pair unobserved for more than `branchPRRetainTTL`
- **WHEN** the next refresh pass runs
- **THEN** the entry is deleted (memory stays bounded — Constitution §II)

### Cross-cutting: Invariants

#### R4: Hot-path and constitution invariants preserved
The SSE hot path (FetchSessions → enrichWindowPR → attachPRStatus) MUST remain zero-subprocess/zero-network: `FindGitRoot` is a pure stat-walk and the grace/retention mechanisms are in-memory cache reads. No new persistent state (Constitution §II); no new subprocess (Constitution §I); no frontend changes (`pr-status-model.ts` untouched); the wire contract (`PrURL`/`PrNumber`/`PrState`/`PrIsDraft` on `WindowInfo`) is unchanged.

- **GIVEN** the changed code paths
- **WHEN** reviewed against `enrichWindowPR`'s and `prstatus_branch.go`'s documented zero-exec hot-path invariants
- **THEN** no subprocess or network call was added to any per-tick path

#### R5: New behavior ships with table-driven tests
Tests SHALL cover, using the existing exec seams (`gh`/`git` stubs, `now` clock seams): gitRoot-keyed register/join with non-repo fallback (R1); detached-HEAD grace serve, grace expiry, prompt post-rebase recovery, and unchanged non-repo behavior (R2); retention serve-after-observed-TTL, deletion after retain-TTL, and authoritative-negative clear-through (R3).

- **GIVEN** `just test-backend`
- **WHEN** the suite runs
- **THEN** the new cases pass alongside the existing `sessions` and `prstatus` tables

### Non-Goals

- No change to `branchPRObservedTTL` (5 min), the 30s/90s tick cadences, the wake/debounce machinery, or the disk seed's role (intake assumption #8).
- No dedicated mechanism for cross-repo active-pane flips — a pane genuinely moving to another repo is a legitimate identity change.
- No frontend hysteresis (rejected in discussion).

### Design Decisions

#### RepoDir derives from the branch-supplying pane, not `w.GitRoot`
**Decision**: `enrichWindowPR` computes the key's repoDir as `config.FindGitRoot(cwd)` of the pane `windowBranchRepo` chose (falling back to that cwd), rather than reusing `w.GitRoot`.
**Why**: `w.GitRoot` follows the *active* pane; the branch can come from the *fallback* pane when the active pane has no branch. Root and branch must describe the same repo or a mismatched key attaches nothing. When the active pane supplies the branch (the common case) the two are identical.
**Rejected**: reusing `w.GitRoot` unconditionally — wrong repo for the fallback-pane case; threading a second derived field through `WindowInfo` — needless surface.
*Introduced by*: 260823-8ocy-solidify-branch-pr-presence

#### Detached detection is HEAD-shape only
**Decision**: detached = `.git/HEAD` readable but not `ref:`-prefixed (fast path) or `rev-parse --abbrev-ref HEAD` = `HEAD` (fallback); no probing of `rebase-merge`/`rebase-apply` directories.
**Why**: the HEAD shape alone is a complete detached signal, needs no extra stats on the resolution path, and works identically in worktree gitdirs. The grace TTL bounds deliberate detached checkouts without needing to know *why* HEAD is detached.
**Rejected**: rebase-dir probing — extra I/O for a distinction the grace expiry already handles.
*Introduced by*: 260823-8ocy-solidify-branch-pr-presence

#### The intake's "~30s window hold" is realized as refresher entry retention
**Decision**: item 3 lands as `branchPRRetainTTL` (30 min) in `BranchRefresher` — entries stop resolving at 5 min unobserved but keep serving until 30 min — with no separate window-level hold in `enrichWindowPR`.
**Why**: within the refresher, transient errors already keep last-good (stale-while-revalidate) and only authoritative negatives clear `pr` — existing entries never blank transiently. The one path that blanks presence is the age-out *deletion*; retention removes it (vector 4). A 30s window-level hold would duplicate what the refresher already guarantees while adding a second last-good store.
**Rejected**: a per-window ~30s hold in `enrichWindowPR` — covers nothing the entry store doesn't, and risks serving a PR across a genuine branch switch (intake assumption #6 explicitly keys the hold per entry to avoid cross-branch bleed).
*Introduced by*: 260823-8ocy-solidify-branch-pr-presence

## Tasks

### Phase 2: Core Implementation

- [x] T001 Detached-HEAD grace in `app/backend/internal/sessions/sessions.go`: tri-state branch resolvers (`resolveGitBranchFromHead` → `(branch, detached, ok)`, `resolveGitBranchWithGit` → detached on `HEAD`), extend `gitBranchCacheEntry` with `lastGood`/`lastGoodAt`, add `gitBranchDetachedGraceTTL = 5m`, grace-serve with 15s re-probe cadence in `resolveGitBranches` <!-- R2 -->
- [x] T002 GitRoot keying in `app/backend/internal/sessions/sessions.go`: `enrichWindowPR` resolves the branch-supplying pane's cwd via `config.FindGitRoot` (fallback to raw cwd) before `prstatus.Register`/`SnapshotBranchPR`; keep `windowBranchRepo` pane/branch selection unchanged <!-- R1 -->
- [x] T003 Retention window in `app/backend/internal/prstatus/prstatus_branch.go`: add `branchPRRetainTTL = 30m`; `refresh` deletes only entries unobserved > retain-TTL, resolves only entries observed ≤ `branchPRObservedTTL`, keeps `liveRepos` (origin/default-branch cache pruning) keyed to resolution-eligible pairs; `Snapshot` unchanged (serves retained entries by construction) <!-- R3 -->

### Phase 3: Integration & Edge Cases

- [x] T004 Table-driven tests: `sessions_test.go` (grace serve mid-rebase, grace expiry, post-rebase recovery within 15s cadence, non-repo unchanged; enrichWindowPR keys on root with subdir cwds, non-repo fallback) and `prstatus_branch_test.go` (retained entry serves after observed-TTL, deleted after retain-TTL, default-branch exclusion and parsed-empty gh still clear immediately) using the existing `gh`/`git`/clock seams <!-- R5 -->
- [x] T005 Verification gates: `cd app/backend && go test ./...`, `cd app/frontend && npx tsc --noEmit`, `just build`; targeted e2e `just test-e2e "pr-status-sidebar"` (wire contract unchanged — full e2e not warranted for a backend-internal continuity fix) <!-- R4 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: `enrichWindowPR` registers/joins on `(gitRoot-of-branch-supplying-pane, branch)`, with raw-cwd fallback for non-repo cwds
- [x] A-002 R2: detached HEAD within the grace window serves the last-known branch; PR fields hold through a rebase
- [x] A-003 R3: entries unobserved 5–30 min are served but not resolved; > 30 min deleted

### Behavioral Correctness

- [x] A-004 R1: `cd` into subdirectories and same-worktree active-pane flips no longer change the join key (no blank tick)
- [x] A-005 R2: grace expiry blanks (deliberate detached checkout eventually reads no-branch); post-rebase the live branch is re-resolved within the 15s re-probe cadence
- [x] A-006 R3: authoritative negatives (default-branch exclusion, parsed-empty `gh pr list`) clear the entry's PR immediately even while retained

### Scenario Coverage

- [x] A-007 R5: table-driven cases exist for every GIVEN/WHEN/THEN above in `sessions_test.go` and `prstatus_branch_test.go`, and `just test-backend` passes

### Edge Cases & Error Handling

- [x] A-008 R2: a genuinely non-repo cwd (no `.git`) never enters the grace path and keeps today's negative caching
- [x] A-009 R3: memory stays bounded — retained entries are deleted at retain-TTL; per-repo origin/default-branch caches prune on the resolution-eligible set

### Code Quality

- [x] A-010 Pattern consistency: new constants/fields follow the existing TTL-cache and seam idioms (`gitBranchCacheEntry`, `branchPR*` constants, `now` clock seams)
- [x] A-011 No unnecessary duplication: reuses `config.FindGitRoot`, existing cache structs, and existing exec seams; no new subprocess helpers
- [x] A-012 No caches beyond justified need: grace/retention are bounded in-memory reads consistent with derive-from-tmux/fs (Constitution §II); SSE hot path stays zero-exec (R4)
- [x] A-013 Comments state constraints (why grace/retention exist, TTL semantics), not narration; no change-ID citations in code comments

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change adds new continuity behavior (git-root keying, detached-HEAD grace, entry retention) without making existing code redundant. The old single-window age-out in `BranchRefresher.refresh` was replaced in place (not left alongside), `windowBranchRepo` remains the pane/branch selector under `windowPRKey`, and `w.GitRoot`/`deriveGitRoot` still serve the code lens unchanged.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | RepoDir = `FindGitRoot(branch-supplying pane cwd)` with raw-cwd fallback, not `w.GitRoot` | Refines intake wording to keep root and branch describing the same repo in the fallback-pane case; identical in the common case | S:70 R:85 A:85 D:75 |
| 2 | Confident | Detached detection via HEAD shape only; no rebase-dir probe | Complete signal, zero extra I/O; grace expiry bounds deliberate detached checkouts | S:60 R:85 A:80 D:70 |
| 3 | Confident | `gitBranchDetachedGraceTTL` = 5 min; grace re-probe cadence = existing 15s negative TTL | Intake assumption #5 latitude (positive-TTL-to-minutes); covers typical rebases, prompt recovery | S:55 R:90 A:75 D:65 |
| 4 | Confident | Item-3 hold = `branchPRRetainTTL` 30 min entry retention; no window-level hold | Intake assumptions #6/#7 latitude; the deletion path is the only transient-blank vector left inside the refresher | S:55 R:85 A:75 D:65 |
| 5 | Confident | E2E scoped to the `pr-status-sidebar` spec; full `just test` skipped | Wire contract and frontend untouched; backend unit tables carry the behavior burden | S:50 R:80 A:75 D:70 |

5 assumptions (0 certain, 5 confident, 0 tentative).
