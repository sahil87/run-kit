# Plan: Skip Branch-PR Derivation on Default Branch

**Change**: 260718-0vuz-skip-branch-pr-default-branch
**Intake**: `intake.md`

## Requirements

### Branch→PR Derivation: Default-Branch Exclusion

#### R1: Exclude default-branch pairs from branch→PR derivation
The `BranchRefresher` refresher pass SHALL exclude any registered `(repoDir, branch)` pair whose `branch` equals the repo's default branch — such a pair MUST resolve to a confirmed negative (`pr = nil`) and MUST NOT trigger a `gh pr list` call.

- **GIVEN** a pane registered on a repo whose default branch is `main`, and the pane's branch is `main`
- **WHEN** the refresher pass runs
- **THEN** no `branchPRExec` (`gh pr list`) call is made for that pair
- **AND** `Snapshot`/`SnapshotBranchPR` returns `(nil, false)` for the pair

#### R2: An excluded pair clears any stale positive entry (the live-bug regression)
An excluded pair SHALL be treated as an authoritative negative, not a transient error — so an entry already holding a positive PR (e.g. a stale fork-PR match cached before exclusion applied) MUST be cleared within one refresh pass, never stale-kept by the stale-while-revalidate rule.

- **GIVEN** an entry for `(repo, main)` already holds a positive PR (e.g. #480 merged) from a prior pass
- **WHEN** a refresh pass runs and recognizes `main` as the repo's default branch
- **THEN** the entry is cleared to a confirmed negative (`pr = nil`)
- **AND** `Snapshot` returns `(nil, false)` for the pair on that same pass

#### R3: Exclusion is branch-scoped, not repo-scoped
A pair on a feature branch in the same repo SHALL continue to resolve normally — the exclusion applies only to the pair whose branch matches the default branch.

- **GIVEN** two registered pairs in the same repo: `(repo, main)` and `(repo, feat)`, where `main` is the default branch
- **WHEN** the refresher pass runs
- **THEN** `(repo, main)` is excluded (confirmed negative, no `gh` call)
- **AND** `(repo, feat)` resolves normally via `gh pr list` and serves its PR from the snapshot

#### R4: Local, network-free default-branch detection via an injectable seam
The default branch SHALL be determined locally (no network) via `git symbolic-ref refs/remotes/origin/HEAD` run in the repo, using `exec.CommandContext` with an explicit argv slice and a timeout (Constitution §I), exposed as a new injectable seam mirroring `branchPRExec`/`branchPRAvailable` so tests can stub it. Output `refs/remotes/origin/main` MUST parse to `main` (strip the `refs/remotes/origin/` prefix and trailing whitespace); unparseable output is a lookup failure.

- **GIVEN** a repo where `git symbolic-ref refs/remotes/origin/HEAD` yields `refs/remotes/origin/main\n`
- **WHEN** the refresher resolves the repo's default branch
- **THEN** the resolved default branch is `main`
- **AND** the command runs with `cmd.Dir = repoDir`, an explicit argv slice, and a bounded context timeout — no shell string, no user input in argv

#### R5: Fail-open on default-branch lookup failure
When the default branch cannot be determined (`refs/remotes/origin/HEAD` unset, no `origin` remote, git absent/error, or unparseable output), the refresher SHALL fail open — the pair resolves normally (current behavior, `gh pr list` runs). The failure verdict SHALL be cached like a positive one to avoid a per-pass retry storm.

- **GIVEN** a repo whose default-branch lookup returns an error (e.g. `origin/HEAD` unset)
- **WHEN** the refresher pass runs for a pair in that repo
- **THEN** the pair resolves via `gh pr list` exactly as it does today
- **AND** the fail-open verdict is cached (no repeated `git symbolic-ref` probe within the TTL window)

#### R6: Per-repo, in-memory, TTL-cached default-branch lookup on the refresher only
The default-branch lookup SHALL run on the refresher goroutine only and be cached in-memory keyed by `repoDir`, so each repo costs at most one `git symbolic-ref` per TTL window regardless of how many pairs it has — mirroring the existing `branchPRAvailabilityTTL` availability-cache pattern (positive and failure verdicts both cached with a taken-at timestamp, re-probed only when stale). No persistent state (Constitution §II). A minutes-range TTL is appropriate (default branches essentially never change).

- **GIVEN** N registered pairs in one repo across one refresh pass (and further passes within the TTL window)
- **WHEN** the refresher resolves the default branch for each pair
- **THEN** `git symbolic-ref` is invoked at most once per repo per TTL window (call-count assertion), not once per pair per pass
- **AND** the lookup never runs on the SSE hot path (`Register`/`Snapshot` stay zero-subprocess)

### Non-Goals

- Fork-PR / cross-repository filtering via `isCrossRepository` — explicitly rejected by the user in favor of the default-branch exclusion, which removes the whole degenerate class in one move.
- Any change to `internal/sessions/sessions.go` (`enrichWindowPR`) — it is a call-site reader only; an excluded pair simply misses the snapshot join and renders no `pr` row, indistinguishable from "no PR exists". Only touch it if implementation reveals a genuine need.
- Any frontend / Playwright change — the pane panel and StatusDot already handle the no-PR case.

### Design Decisions

1. **Exclusion recognized in the refresher, registration unchanged**: `Register` stays a dumb, cheap set-touch (zero subprocess) for all pairs including default-branch ones; the *refresher* recognizes and excludes each pass. — *Why*: the SSE hot path has a documented zero-subprocess invariant; the detection is a subprocess so it must live on the background goroutine. — *Rejected*: filtering at `Register`/`Snapshot` time (would run a subprocess on the hot path).
2. **Excluded ⇒ authoritative negative, not skip**: an excluded pair is resolved to `pr = nil` exactly like a genuinely-empty parsed result, overwriting any stale positive. — *Why*: the observed bug is a stale PR *reappearing*; a transient/skip treatment would keep serving the cached wrong PR forever. — *Rejected*: skipping the pair (leaves the stale positive in place).
3. **Fail-open, verdict cached**: a missing local ref must not silently disable a working feature repo-wide; the fail-open verdict is cached to avoid a retry storm. — *Why*: consistent with the module's fail-soft/stale-while-revalidate posture. — *Rejected*: fail-closed (would over-suppress PR lines on clones that never initialized `origin/HEAD`).

## Tasks

### Phase 2: Core Implementation

- [x] T001 Add the `branchDefaultExec` package-var seam in `app/backend/internal/prstatus/prstatus_branch.go` — `func(ctx context.Context, repoDir string) ([]byte, error)` running `git symbolic-ref refs/remotes/origin/HEAD` via `exec.CommandContext` (explicit argv, `cmd.Dir = repoDir`, bounded timeout reusing `ghTimeout`), plus a `parseDefaultBranch([]byte) (string, bool)` helper that strips the `refs/remotes/origin/` prefix + trailing whitespace and reports parse failure. <!-- R4 -->
- [x] T002 Add a per-repo default-branch cache to `BranchRefresher` in `app/backend/internal/prstatus/prstatus_branch.go` — a `map[string]defaultBranchEntry` (keyed by `repoDir`, holding the resolved branch name, an `ok`/found flag for fail-open, and a taken-at timestamp) guarded by `mu`; a `defaultBranch(ctx, now, repoDir) (string, bool)` method that returns the cached verdict when fresh (within a new `branchDefaultBranchTTL` const in the minutes range) and otherwise re-probes via the `exec` seam and caches the result (positive AND failure). Add the `exec`-style field to the struct + wire the default in `NewBranchRefresher`, mirroring the availability-cache pattern. <!-- R6 -->
- [x] T003 Wire the exclusion into `BranchRefresher.refresh()` in `app/backend/internal/prstatus/prstatus_branch.go` — for each pending pair, resolve the repo's default branch (cached); when the pair's branch equals it, set the entry's `pr = nil` (authoritative negative, clearing any stale positive) without calling `r.exec`; otherwise resolve normally. On lookup failure, fall through to the normal `gh pr list` path (fail-open). Keep the resolution loop off the lock as today (default-branch resolution may exec, so run it outside the `mu` critical section like `r.exec`). <!-- R1 R2 R3 R5 -->

### Phase 3: Tests

- [x] T004 [P] Add a `newTestRefresher`-compatible way to inject the default-branch seam and add tests in `app/backend/internal/prstatus/prstatus_branch_test.go` covering: (a) a default-branch pair is excluded — no `branchPRExec` call, `Snapshot` returns `(nil, false)`; (b) live-bug regression — an entry already holding a positive PR is cleared to a confirmed negative once its branch is recognized as the default branch; (c) a feature-branch pair in the same repo still resolves normally (branch-scoped exclusion); (d) default-branch lookup failure ⇒ fail-open (the pair resolves via `gh pr list` as today); (e) caching — N pairs in one repo cost one default-branch lookup per pass/TTL window (call-count assertion); (f) TTL re-probe after the window elapses. Follow the existing injected-seam + fixed-clock style. <!-- R1 R2 R3 R5 R6 -->
- [x] T005 [P] Add a `parseDefaultBranch` unit test in `app/backend/internal/prstatus/prstatus_branch_test.go` — `refs/remotes/origin/main\n` → (`main`, true); trailing whitespace trimmed; unrelated/empty/unparseable input → ("", false). <!-- R4 -->

## Execution Order

- T001 → T002 → T003 (sequential: T002 uses the seam from T001; T003 wires the cache method from T002 into `refresh`).
- T004 and T005 depend on T001–T003 and may run in parallel with each other (both edit the test file — coordinate as a single edit pass).

## Acceptance

### Functional Completeness

- [x] A-001 R1: A registered pair whose branch equals the repo's default branch is excluded — no `gh pr list` call is made for it and `Snapshot` returns `(nil, false)`, verified by a Go test.
- [x] A-002 R4: The `branchDefaultExec` seam runs `git symbolic-ref refs/remotes/origin/HEAD` with `exec.CommandContext`, explicit argv, `cmd.Dir = repoDir`, and a bounded timeout; `parseDefaultBranch` correctly strips the `refs/remotes/origin/` prefix and trailing whitespace, verified by a Go test.
- [x] A-003 R6: The default-branch lookup is per-repo TTL-cached in-memory on the refresher; N pairs in one repo cost at most one lookup per TTL window, verified by a call-count Go test; the SSE hot path (`Register`/`Snapshot`) issues no subprocess.

### Behavioral Correctness

- [x] A-004 R2: An entry already holding a positive PR is cleared to a confirmed negative on the first refresh pass that recognizes its branch as the default branch (the #480 live-bug regression), verified by a Go test.
- [x] A-005 R3: A feature-branch pair in the same repo still resolves normally when a sibling default-branch pair is excluded, verified by a Go test.

### Edge Cases & Error Handling

- [x] A-006 R5: When the default-branch lookup fails (unset `origin/HEAD`, no origin, git error, unparseable), the pair resolves via `gh pr list` exactly as today (fail-open) and the failure verdict is cached (no per-pass retry storm), verified by a Go test.

### Code Quality

- [x] A-007 Pattern consistency: The new seam, cache, and struct fields follow the existing `branchPRExec` / `branchPRAvailable` / availability-cache conventions in `prstatus_branch.go` (package-var seam + per-instance field defaulted in `NewBranchRefresher`, `mu`-guarded cache with taken-at timestamps, fixed-clock testability).
- [x] A-008 No unnecessary duplication: Existing helpers/constants are reused where applicable (`ghTimeout` for the timeout, the `checkAvailable`/availability-cache pattern for the TTL cache); no new subprocess construction outside `exec.CommandContext` with an argv slice (Constitution §I).
- [x] A-009 Hot-path purity: The default-branch subprocess runs only on the refresher goroutine — `Register`/`Snapshot` remain zero-subprocess and `sessions.go` is untouched (Constitution §II, §X; code-quality "no in-memory caches unless justified" — this cache is justified by the documented zero-subprocess hot-path invariant).

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

None — this change adds new functionality without making existing code redundant (the exclusion is purely additive inside the existing refresher loop; no existing symbol, branch, or config became unused).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Reuse `ghTimeout` (10s) as the `git symbolic-ref` timeout rather than adding a new constant | Intake §2 explicitly permits "reuse `ghTimeout` or an equivalent short constant"; git symbolic-ref is near-instant so the exact bound is immaterial, and reusing the existing const avoids a magic number | S:85 R:90 A:90 D:85 |
| 2 | Confident | `branchDefaultBranchTTL = 5 * time.Minute` for the per-repo default-branch cache | Intake §3/assumption 5 specify a minutes-range TTL (default branches essentially never change) but leave the exact value a plan detail; 5m matches the existing `branchPRObservedTTL` minutes-scale const and is comfortably longer than the 30s refresh tick | S:70 R:90 A:80 D:70 |
| 3 | Confident | The default-branch seam is a package var (`branchDefaultExec`) plus a per-instance `defaultExec` field defaulted in `NewBranchRefresher`, exactly mirroring `branchPRExec`→`exec` and `branchPRAvailable`→`available` | Intake §2 shows the package-var form and says "the new default-branch resolver becomes a third injectable seam"; the existing two seams establish the package-var + per-instance-field convention verbatim | S:80 R:90 A:90 D:85 |
| 4 | Confident | Default-branch resolution runs OUTSIDE the `mu` critical section in `refresh` (in the same off-lock resolution loop as `r.exec`), then the entry is updated under the lock | The existing `refresh` deliberately runs `r.exec` off the lock so `Register`/`Snapshot` never block on a hung subprocess; `git symbolic-ref` is likewise a subprocess and must follow the same discipline | S:75 R:85 A:90 D:80 |

4 assumptions (1 certain, 3 confident, 0 tentative).
