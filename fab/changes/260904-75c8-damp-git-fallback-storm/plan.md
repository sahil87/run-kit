# Plan: Damp the Serial Git-Fallback Storm in FetchSessions

**Change**: 260904-75c8-damp-git-fallback-storm
**Intake**: `intake.md`

## Requirements

### Sessions: Git-Branch Resolution Classification

#### R1: No-repo cwds are classified by a pure stat walk and never spawn a subprocess
`resolveGitBranches` MUST classify each cache-missed cwd by walking to the filesystem root looking for a `.git` entry (the `config.FindGitRoot` walk, already imported by `sessions.go`). A cwd with no `.git` ancestor MUST be treated as an authoritative negative: no `git rev-parse` subprocess runs for it.

- **GIVEN** a pane cwd of `~` or `/tmp` (no `.git` anywhere up the tree)
- **WHEN** `resolveGitBranches` resolves it (cache miss)
- **THEN** the result carries no branch for that cwd
- **AND** no `git` subprocess is spawned (resolution succeeds even when any exec would fail)

#### R2: Authoritative no-repo negatives cache on a long TTL
A no-repo negative (R1) MUST be cached with a new constant `gitBranchNoRepoTTL = 5 * time.Minute` in the constants block at `sessions.go:158-172`, replacing the 15s re-probe for this shape. The entry construction MUST preserve the `lastGood`/`lastGoodAt` carry-through pattern of the existing `default:` arm.

- **GIVEN** a non-repo cwd just resolved as a no-repo negative
- **WHEN** the cache entry is written
- **THEN** its `expiresAt` lands on the `gitBranchNoRepoTTL` horizon (5m), not `gitBranchNegativeTTL` (15s)
- **AND** subsequent `resolveGitBranches` calls within the TTL are pure cache hits (no stat walk, no subprocess)

#### R3: Repo-subdirectory cwds resolve via direct HEAD read at the walk-found root
When the walk finds a `.git` at an ancestor, the branch MUST be resolved by the direct-read parse (`resolveGitBranchFromHead` semantics) applied at that root — including the worktree `gitdir:` file indirection — so a pane cwd in a repo subdirectory gets its branch from file reads alone, where today it burns a subprocess.

- **GIVEN** a repo at `<root>` with `.git/HEAD` = `ref: refs/heads/main` and a pane cwd of `<root>/sub/dir`
- **WHEN** `resolveGitBranches` resolves the cwd
- **THEN** the result maps the cwd to `main` without any subprocess
- **AND** the same holds when `<root>/.git` is a worktree pointer file (`gitdir: <path>`) whose target HEAD carries the ref

#### R4: Subprocess fallback is reserved for unparseable `.git` shapes
The `resolveGitBranchWithGit` fallback (`git -C <cwd> rev-parse --abbrev-ref HEAD`, 250ms cap) MUST run only when the walk FOUND a `.git` but the direct parse could not produce a branch or a detached signal (unreadable HEAD, malformed `gitdir:` file, unrecognized ref shape). Such negatives keep today's `gitBranchNegativeTTL = 15s` re-probe cadence.

- **GIVEN** a cwd whose ancestor `.git` is a file containing garbage (not `gitdir:`-prefixed)
- **WHEN** `resolveGitBranches` resolves it
- **THEN** the subprocess fallback is attempted (existing behavior contract)
- **AND** a failed fallback caches a negative on the 15s cadence, not the 5m no-repo TTL

### Sessions: Miss-Resolution Concurrency

#### R5: Misses resolve with bounded concurrency
The miss-resolution loop in `resolveGitBranches` (`sessions.go:366-396`) MUST fan out over the missed cwds with a concurrency bound — new constant `gitBranchResolveConcurrency = 4` — instead of resolving serially. Workers MUST stop taking new work once `ctx` is done (in-flight 250ms subprocess caps still bound the tail). The collected entries MUST still be written to `gitBranchCache` under the single batched write-lock section, and the whole function MUST be race-clean under `-race`.

- **GIVEN** 16 cache-missed cwds whose resolution each takes up to 250ms
- **WHEN** `resolveGitBranches` runs
- **THEN** total wall time is bounded by ~`ceil(16/4) × 250ms` rather than `16 × 250ms`
- **AND** with a canceled ctx, no new per-cwd resolution starts

#### R6: Existing resolution behavior is preserved
The change MUST NOT alter: the detached-HEAD grace serve (`gitBranchDetachedGraceTTL = 5m`, lastGoodAt never re-stamped by a grace serve), the positive TTL (`gitBranchPositiveTTL = 30s`), the per-fetch resolve limit (`gitBranchResolveLimit = 16`), the per-cwd cache keying, or the `WindowInfo` branch enrichment contract consumed by `enrichWindowPR`.

- **GIVEN** the existing `TestResolveGitBranchesDetachedGrace` and `TestResolveGitBranchFromHeadDetachedSignal` suites
- **WHEN** the change lands
- **THEN** they pass unmodified except where a test asserted the old no-repo 15s cadence (that single assertion updates to the new two-tier negative)

### Non-Goals

- No change to `enrichWindowPR`, `windowPRKey`, or the PR-status refresher — they consume the branch this function supplies and are untouched.
- No change to the poll loop structure (`api/sse.go`) — that is Change C of the plan, disjoint by design.
- No cache schema change and no persistence — the TTL cache remains in-memory damping (Constitution II posture unchanged).

### Design Decisions

#### Classify with FindGitRoot before parsing, rather than teaching the reader to walk
**Decision**: `resolveGitBranches` calls `config.FindGitRoot(cwd)` first; `""` short-circuits to the no-repo negative, otherwise the existing `resolveGitBranchFromHead` parse runs against the found root.
**Why**: the walk primitive is already proven on this exact hot path (`windowPRKey`, `deriveGitRoot` both use it); classification-then-parse keeps `resolveGitBranchFromHead`'s signature and its direct tests untouched.
**Rejected**: embedding the walk inside `resolveGitBranchFromHead` — it would conflate "no repo" with "unparseable" in the `(ok, detached)` signal, precisely the ambiguity this change exists to remove.
*Introduced by*: 260904-75c8-damp-git-fallback-storm

#### Two-tier negative TTL instead of one longer negative TTL
**Decision**: only the walk-proven no-repo negative gets `gitBranchNoRepoTTL = 5m`; unparseable-shape and grace-expiry negatives keep `gitBranchNegativeTTL = 15s`.
**Why**: a clean walk is authoritative (git would find nothing either — re-probing buys nothing), while an unparseable `.git` is a transient/ambiguous shape that can heal quickly and deserves the fast re-probe; the detached grace serve is documented design (260823-8ocy) built on the 15s cadence.
**Rejected**: raising `gitBranchNegativeTTL` globally — it would slow branch reappearance after rebases and repo-shape healing for no gain.
*Introduced by*: 260904-75c8-damp-git-fallback-storm

#### Semaphore fan-out with batched cache write
**Decision**: fan the per-cwd resolution out over a `gitBranchResolveConcurrency = 4` semaphore; collect entries into the `updates` map under a local mutex; keep the single terminal `gitBranchCacheMu.Lock()` batch write.
**Why**: bounds fork pressure (residual subprocess bursts ≈1s worst case, not 4s) while keeping the cache mutation pattern — and its lock ordering — exactly as today.
**Rejected**: unbounded goroutine-per-miss (fork storms are the disease being treated); per-entry cache writes (more lock churn, no benefit).
*Introduced by*: 260904-75c8-damp-git-fallback-storm

## Tasks

### Phase 2: Core Implementation

- [x] T001 Restructure per-cwd resolution in `resolveGitBranches` (`app/backend/internal/sessions/sessions.go`): classify via `config.FindGitRoot(cwd)` — `""` ⇒ authoritative no-repo negative with new `gitBranchNoRepoTTL = 5 * time.Minute` constant (constants block `:158-172`); found root ⇒ `resolveGitBranchFromHead(root)`; subprocess fallback only on unparseable shapes, keeping 15s negative cadence and all `lastGood` carry-through / detached-grace arms <!-- R1, R2, R3, R4 -->
- [x] T002 Add bounded-concurrency miss resolution to `resolveGitBranches` (`app/backend/internal/sessions/sessions.go`): `gitBranchResolveConcurrency = 4` semaphore over the per-cwd body, ctx-aware work issuance, local-mutex `updates` collection, single batched cache write preserved <!-- R5 -->

### Phase 3: Integration & Edge Cases (tests)

- [x] T003 [P] Tests: repo-subdirectory cwd resolves `main` via direct read (no subprocess — assert resolution succeeds where an exec cannot run, e.g. expired ctx), and worktree `gitdir:` indirection resolves from a subdirectory (`app/backend/internal/sessions/sessions_test.go`) <!-- R3 -->
- [x] T004 [P] Tests: no-repo cwd caches on the `gitBranchNoRepoTTL` horizon with no subprocess; unparseable `.git` (garbage pointer file) still takes the fallback and caches on the 15s cadence; update the existing "non-repo cwd keeps plain negative behavior" subtest to the two-tier contract (`sessions_test.go`) <!-- R1, R2, R4 -->
- [x] T005 Tests: concurrent miss batch is race-clean (`go test -race ./internal/sessions/`), respects the bound, and a canceled ctx stops new work; confirm detached-grace/positive-TTL/resolve-limit suites pass unmodified (`sessions_test.go`) <!-- R5, R6 -->
- [x] T006 Verification gates: `cd app/backend && go test -race ./internal/sessions/ && go test ./...`, then `just build` <!-- R6 -->

## Execution Order

- T001 blocks T002 (same function body; classification lands first)
- T003/T004 depend on T001; T005 depends on T002
- T006 last

## Acceptance

### Functional Completeness

- [x] A-001 R1: A cwd with no `.git` ancestor resolves as a negative through the stat walk alone — no `git` subprocess is spawned for it
- [x] A-002 R2: `gitBranchNoRepoTTL = 5 * time.Minute` exists in the constants block and no-repo negatives cache on that horizon
- [x] A-003 R3: A repo-subdirectory cwd (and a worktree-subdirectory cwd) resolves its branch via direct HEAD read at the walk-found root
- [x] A-004 R5: Miss resolution fans out under `gitBranchResolveConcurrency = 4` with the batched cache write preserved

### Behavioral Correctness

- [x] A-005 R4: An unparseable `.git` shape still reaches `resolveGitBranchWithGit` and its negative caches on the 15s cadence, not 5m
- [x] A-006 R6: Detached-HEAD grace, positive TTL, and resolve-limit behavior are byte-for-byte preserved (existing suites pass, with only the documented no-repo subtest update)

### Scenario Coverage

- [x] A-007 R1: Test exists proving a non-repo cwd resolution completes with no subprocess (exec made impossible in-test)
- [x] A-008 R3: Tests exist for both the plain repo-subdirectory and worktree `gitdir:` subdirectory scenarios
- [x] A-009 R5: `-race` run on the package covers the concurrent miss path; ctx-cancellation test asserts no new work is issued

### Edge Cases & Error Handling

- [x] A-010 R2: Two-tier negatives — no-repo (5m) vs unparseable/grace-expiry (15s) — are distinguishable in the cache and both preserve `lastGood` carry-through
- [x] A-011 R5: A canceled ctx mid-batch leaves the cache consistent (only completed entries written) and the function returns without panic

### Code Quality

- [x] A-012 Pattern consistency: New code follows the file's existing cache/TTL idioms (constants block, RWMutex pattern, batched writes) and comment style (constraints, not narration)
- [x] A-013 No unnecessary duplication: The walk reuses `config.FindGitRoot` — no second stat-walk implementation is introduced
- [x] A-014 Subprocess discipline: The only exec remains `exec.CommandContext` with the 250ms timeout ctx (Constitution I; code-quality.md)
- [x] A-015 No new caches: Damping stays within the existing per-cwd TTL cache — no new package-level state beyond the two constants (code-quality.md: no in-memory caches unless justified)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change restructures miss resolution within `resolveGitBranches` (extracting the per-cwd body into `resolveGitBranch`) without making any existing code redundant.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Classification-then-parse shape: call `config.FindGitRoot` in `resolveGitBranches`, keep `resolveGitBranchFromHead`'s signature untouched | Keeps the `(ok, detached)` signal unambiguous and existing direct tests valid; walk primitive already on this hot path | S:70 R:85 A:85 D:75 |
| 2 | Confident | The "no subprocess" test seam is an impossible-exec assertion (e.g. already-expired ctx) rather than an injected exec hook | Avoids adding a test-only seam to production code; the 250ms-ctx subprocess deterministically fails under an expired ctx, so a successful resolution proves the direct path | S:60 R:80 A:75 D:65 |
| 3 | Certain | Existing "non-repo cwd keeps plain negative behavior" subtest updates to assert the new long-TTL contract | The subtest asserts exactly the behavior this change replaces; Test Integrity rule — tests conform to the spec | S:85 R:90 A:95 D:90 |
| 4 | Confident | The impossible-exec test seam is an emptied `PATH` (`t.Setenv`), not assumption 2's example of an already-expired ctx | T002's ctx-aware issuance makes an expired ctx stop ALL resolution work, so an expired-ctx test would resolve nothing and prove nothing; an empty PATH makes any exec fail while the walk/parse paths still run, which is the "resolution succeeds where an exec cannot run" assertion T003 names | S:60 R:80 A:75 D:65 |

3 assumptions (1 certain, 2 confident, 0 tentative) + 1 apply-time assumption (confident).
