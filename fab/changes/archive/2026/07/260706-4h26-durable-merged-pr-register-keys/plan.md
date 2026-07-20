# Plan: Durable Merged-PR Dot + 3-Char Register Keys

**Change**: 260706-4h26-durable-merged-pr-register-keys
**Intake**: `intake.md`

## Requirements

<!-- Derived from intake.md. Design authority: docs/specs/status-pyramid.md
     (facts item 6 "[target — D2 revised]", § Open Decisions D2 row, § Row
     Minimalism register-key note). Spec wins over intake on divergence. -->

### Backend: State-All Branch→PR Derivation

#### R1: Query all PR states, not just open
The branch→PR derivation (`app/backend/internal/prstatus/prstatus_branch.go`) SHALL query
`gh pr list` across **all** PR states (`--state all`) and request the `state` field in the
`--json` set, replacing the current `--state open` lookup.

- **GIVEN** a pane on a branch whose only PR is merged
- **WHEN** the background refresher resolves that (repo, branch) pair
- **THEN** the merged PR's number and URL ARE returned in the snapshot (they were dropped by the open-only query before)

#### R2: Selection precedence — open > merged > closed
When a branch resolves to more than one PR, `pickBranchPR` SHALL choose by precedence:
an **open** PR (most recently updated) wins; else the most recent **merged** PR; else the
most recent **closed** PR. Within a state class, most-recently-updated wins. A URL-less node
is skipped (it can never key the live-status join). An empty/all-URL-less result is a valid
negative.

- **GIVEN** a branch with both an open PR (older `updatedAt`) and a merged PR (newer `updatedAt`)
- **WHEN** `pickBranchPR` selects
- **THEN** the **open** PR is chosen (state precedence outranks recency across classes) — the branch-reuse edge (an open PR always outranks an older merged one on the same branch)
- **GIVEN** a branch with a merged PR and a closed PR (no open)
- **WHEN** `pickBranchPR` selects
- **THEN** the **merged** PR is chosen (merged outranks closed)
- **GIVEN** a branch with only closed PRs
- **WHEN** `pickBranchPR` selects
- **THEN** the most-recently-updated **closed** PR is returned (still derived for the register/tip; the frontend `prOwnsDot` excludes it from dot ownership)

#### R3: Merged durability is stateless and restart-proof
A merged PR SHALL keep being served for as long as the pane sits on that branch, derived
freshly from `gh` every pass — WITHOUT any in-memory grace clock or negative-stamp retention.
The `branchPRMergedGrace` constant, the `wentNegativeAt` field, and the grace/negative-stamp
retention branch in `refresh` SHALL be deleted.

- **GIVEN** a **cold** `BranchRefresher` (fresh process state — no prior positive entry, no grace clock; models an rk restart)
- **WHEN** it resolves a branch whose PR is merged, using the same gh response a warm collector would see
- **THEN** the merged PR is served from the snapshot on the first refresh (durability does not depend on having previously observed the PR open)
- **GIVEN** a merged PR being served
- **WHEN** an arbitrary number of refresh passes elapse (no wall-clock grace window)
- **THEN** the PR is still served (statelessly durable) — never cleared by a grace-expiry

#### R4: Preserve unchanged derivation invariants
The change SHALL preserve: the 30s refresher cadence, per-(repo, branch) observed-TTL age-out,
cached gh-availability verdict (positive AND negative), stale-while-revalidate on transient exec
errors and malformed JSON, empty-input ignore, hot-path purity of `Snapshot`/`Register` (zero
subprocess), and gh-absent graceful degradation. The viewer-wide URL-keyed collector (which already
queries OPEN/MERGED/CLOSED and supplies the merged `prState` via the URL join in `attachPRStatus`)
is UNCHANGED. No `WindowInfo`/API surface change.

- **GIVEN** a transient exec error after a good resolution
- **WHEN** the refresher runs
- **THEN** the last-good PR is retained (stale-while-revalidate — unchanged)
- **GIVEN** gh is unavailable
- **WHEN** the refresher runs
- **THEN** no branch-list exec runs and the negative availability verdict is cached (unchanged)

### Frontend: 3-Char Register Keys

#### R5: Normalize L0/L1 register prefixes to 3 chars
In `app/frontend/src/components/sidebar/status-panel.tsx`, the L0 register prefix `output`
SHALL become `out` and the L1 register prefix `agent` SHALL become `agt`, matching the
fixed-width 3-char vocabulary of `tmx`/`cwd`/`git`/`fab`. The trailing single-space advance
after the 3-char prefix is kept consistent with the other registers. The `PR` prefix
(2-char + NBSP-padded advance) is UNCHANGED.

- **GIVEN** the PANE panel renders the L0 register
- **WHEN** a window is selected
- **THEN** the prefix reads `out ` (not `output `)
- **GIVEN** a window with an agent
- **WHEN** the L1 register renders
- **THEN** the prefix reads `agt ` (not `agent `)

#### R6: Tests track the new prefixes
The register-view unit tests (`status-panel.test.tsx`) and the `pane-register-panel` e2e spec
(`.spec.ts`) AND its `.spec.md` companion SHALL be updated to the `out`/`agt` prefixes.

- **GIVEN** the unit test that asserts the L0 register is a non-button div
- **WHEN** it queries the prefix text
- **THEN** it queries `out` (not `output`) and passes
- **GIVEN** the e2e four-register test
- **WHEN** it verifies the register lines
- **THEN** it asserts the visible `out`/`agt` prefix text, and the `.spec.md` steps mirror it

### Docs: Alignment Sweep

#### R7: Align docs/site/status-dot.md
`docs/site/status-dot.md` SHALL be swept for grace-window and register-key wording invalidated
by this change and aligned: the § D2 subsection (currently "queries only *open* PRs … retains …
for a grace window"), the § Scope notes backend-touch bullet (currently "the D2 grace-window PR
retention"), and the Row Minimalism register-view example (currently `output`/`agent`) → `out`/`agt`.

- **GIVEN** a reader consulting status-dot.md § D2
- **WHEN** they read the retention rule
- **THEN** it describes the state-all + precedence (open > merged > closed) derivation and states merged durability is stateless/restart-proof — no grace window
- **GIVEN** the register-view code block in § Row Minimalism
- **WHEN** they read the register keys
- **THEN** they read `out`/`agt`/`fab`/`PR`

### Non-Goals

- No frontend ladder change: `statusDotState`/`prOwnsDot`/`prShape`/`fabPhase` are UNCHANGED — they already map merged→done-square and exclude closed from dot ownership; the bug was that derivation stopped supplying merged PRs (verified). `pr-status-line.tsx` needs NO change.
- No modification of `docs/specs/status-pyramid.md` — it belongs to PR #316 (untracked here); its `[target — follow-up PR]` markers flip to `[current]` in a #316 commit AFTER this PR merges, not here.
- No viewer-wide `Collector` change — it already returns merged/closed and keys by URL.

### Design Decisions

1. **Re-add `State` to `BranchPR`**: the struct dropped `State`/`IsDraft` in the y1ar rework because the open-only query made state redundant. Precedence selection now needs `State`, so re-add `State string` (parsed from the branch query's new `state` field) — `IsDraft` stays out (no consumer). *Why*: precedence is a pure function of state + updatedAt. *Rejected*: sorting by updatedAt alone (would let a newer closed PR outrank an older open one, violating R2).
2. **Case-insensitive state compare**: `gh pr list --json state` emits GitHub's uppercase enum (`OPEN`/`MERGED`/`CLOSED`) — same values the viewer-wide collector's `mapState` already handles. Normalize with `strings.ToUpper` in `pickBranchPR` so a future gh casing change doesn't silently mis-rank. *Why*: robustness at zero cost. *Rejected*: exact-match on `"OPEN"` (brittle).
3. **Delete grace machinery outright** (not keep as fallback): state-all makes it dead code; keeping it contradicts Minimal Surface Area + No-Database grain. *Why*: the fix deletes hidden mutable state. *Rejected*: guarding it behind a flag (dead complexity).

## Tasks

### Phase 1: Backend derivation

- [x] T001 In `app/backend/internal/prstatus/prstatus_branch.go`: change `branchPRExec` to query `--state all` (drop `--state open`) and add `state` to the `--json` field list (`number,url,state,updatedAt`). <!-- R1 -->
- [x] T002 Re-add `State string \`json:"state"\`` to the `BranchPR` struct; update its doc comment. <!-- R1 -->
- [x] T003 Rewrite `pickBranchPR` to select by precedence open (most-recent updated) > merged (most recent) > closed (most recent), skipping URL-less nodes, returning nil for an empty/all-skipped result; normalize state with `strings.ToUpper`. Update its doc comment. <!-- R2 -->
- [x] T004 Delete the `branchPRMergedGrace` const, the `wentNegativeAt` field on `branchEntry` (and its doc), and the grace/negative-stamp retention branch in `refresh` (the `else if e.pr != nil { ... }` block); simplify `refresh` so a parsed positive updates `e.pr` and a parsed negative clears `e.pr` directly. Update the surrounding doc comments (`branchEntry`, `refresh`, the file header) to describe state-all + stateless durability, removing all D2-grace references. <!-- R3 R4 -->

### Phase 2: Backend tests

- [x] T005 In `app/backend/internal/prstatus/prstatus_branch_test.go`: extend `branchNode` (or add a `branchNodeState` helper) to emit a `state` field; delete `TestBranchRefresher_MergedPRRetainedForGrace` (grace machinery gone). <!-- R3 -->
- [x] T006 [P] Add precedence tests: open-beats-merged (open older updatedAt still wins — branch-reuse edge), merged-beats-closed, closed-only-returns-closed, most-recent-within-class. <!-- R2 -->
- [x] T007 [P] Add `TestBranchRefresher_MergedPRDurableFromColdCollector`: a fresh `BranchRefresher` (no prior positive entry) resolving a branch whose PR is merged serves it on the first refresh AND after many further passes (statelessly durable, restart-proof — no grace clock). <!-- R3 -->
- [x] T008 [P] Update existing single-state tests (`SinglePR`, `MultiPRPicksMostRecent`, `NoPRNegativeEntry`, etc.) so their nodes carry a `state` field (open) and still pass under the new precedence path. <!-- R2 R4 -->

### Phase 3: Frontend prefixes + tests

- [x] T009 In `app/frontend/src/components/sidebar/status-panel.tsx`: change the L0 register prefix span from `output ` to `out ` and the L1 register prefix span from `agent ` to `agt `. Update the nearby doc comment(s) referencing the `output`/`agent` register names. <!-- R5 -->
- [x] T010 In `app/frontend/src/components/sidebar/status-panel.test.tsx`: update the L0 non-button assertion (`getByText("output")` → `getByText("out")`) and any other tests asserting the `output`/`agent` prefix text. <!-- R6 -->
- [x] T011 In `app/frontend/tests/e2e/pane-register-panel.spec.ts`: assert the visible `out`/`agt` prefix text on the L0/L1 registers (the current test relies only on test-ids); update the mock/comments if they name the old prefixes. <!-- R6 -->
- [x] T012 Update `app/frontend/tests/e2e/pane-register-panel.spec.md` (spec companion, constitution § Test Companion Docs): reflect the `out`/`agt` prefixes in the intent + steps in the same commit as the `.spec.ts`. <!-- R6 -->

### Phase 4: Docs alignment

- [x] T013 In `docs/site/status-dot.md`: rewrite § D2 to the state-all + precedence rule with stateless/restart-proof merged durability (no grace window); align the § Scope notes backend-touch bullet; change the Row Minimalism register-view example keys from `output`/`agent` to `out`/`agt` (and the trailing "shows only `output`" prose to `out`). <!-- R7 -->

## Execution Order

- T001–T004 (backend impl) before T005–T008 (backend tests reference the new `State` field + precedence).
- T009 before T010–T012 (frontend tests track the prefix change).
- T013 is independent (docs) — can run alongside any phase.

## Acceptance

### Functional Completeness

- [x] A-001 R1: `branchPRExec` queries `--state all` with `state` in the `--json` set; a merged PR's number/URL are returned by the refresher.
- [x] A-002 R2: `pickBranchPR` selects by precedence open > merged > closed, most-recent-within-class, skipping URL-less nodes.
- [x] A-003 R3: `branchPRMergedGrace`, `wentNegativeAt`, and the grace/negative-stamp retention branch are gone; merged PRs are served statelessly.
- [x] A-004 R5: L0 prefix is `out`, L1 prefix is `agt`; `tmx`/`cwd`/`git`/`fab`/`PR` unchanged.
- [x] A-005 R7: `docs/site/status-dot.md` § D2, § Scope notes, and the register-view example are aligned (state-all + precedence, `out`/`agt`).

### Behavioral Correctness

- [x] A-006 R2: an open PR with an older `updatedAt` still outranks a newer merged PR on the same branch (branch-reuse edge).
- [x] A-007 R3: a **cold** `BranchRefresher` serves a merged PR on the first refresh and after many further passes (restart-proof, no grace-expiry decay) — proven by a test.
- [x] A-008 R4: cadence, observed-TTL age-out, cached availability, stale-while-revalidate (exec error + malformed JSON), empty-input ignore, and `Snapshot`/`Register` hot-path purity are unchanged and still green.

### Removal Verification

- [x] A-009 R3: `TestBranchRefresher_MergedPRRetainedForGrace` is deleted and no test references the removed grace symbols; `grep` for `branchPRMergedGrace`/`wentNegativeAt` returns nothing in the package.

### Scenario Coverage

- [x] A-010 R2 R3: backend tests cover precedence (open>merged, merged>closed, closed-only, within-class recency) and cold-collector merged durability; `just test-backend` green.
- [x] A-011 R5 R6: `status-panel.test.tsx` and `pane-register-panel.spec.ts` assert `out`/`agt`; `just test-frontend` and `just test-e2e "pane-register-panel"` green.

### Edge Cases & Error Handling

- [x] A-012 R4: transient exec error and malformed JSON keep last-good (stale-while-revalidate) under the new precedence path.
- [x] A-013 R2: an all-URL-less or empty branch result is a valid negative (snapshot serves nothing), unchanged (empty tested directly; all-URL-less via the skip path + `pickBranchPR` nil return).

### Code Quality

- [x] A-014 Pattern consistency: backend uses `exec.CommandContext` with timeout + argv slice (no shell string, branch as discrete arg — Constitution §I); frontend prefix spans follow the existing register-span pattern.
- [x] A-015 No unnecessary duplication: state parsing reuses the existing GitHub enum convention (`mapState` casing); no new grace/retention machinery reintroduced.
- [x] A-016 R7 Test companion: the `.spec.md` is updated in the same commit as the `.spec.ts` (constitution § Test Companion Docs).

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- The merged done-square requires BOTH the branch refresher supplying the URL (this change) AND the viewer-wide collector supplying `prState: merged` via the URL join in `attachPRStatus` (unchanged) — the collector already queries OPEN/MERGED/CLOSED, so once derivation supplies the URL statelessly, the purple square is restart-proof end-to-end.

## Deletion Candidates

None — this change *is* a deletion (the `branchPRMergedGrace` const, `wentNegativeAt` clock, and the grace/negative-stamp retention branch in `refresh` are removed in-change, with their test); no further code became redundant or unused. `BranchPR.UpdatedAt` remains live (within-class tie-breaking), and the frontend `prOwnsDot` closed-exclusion remains load-bearing (spec rows 10/20).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | State-all query + precedence open (most-recent updated) > merged (most recent) > closed (most recent); delete grace machinery | User-confirmed after live decay-bug observation; encoded in revised spec D2 / facts item 6 on #316; intake assumptions 1 & 3 | S:90 R:80 A:90 D:90 |
| 2 | Certain | Register prefixes `output`→`out`, `agent`→`agt`; `PR` (2-char NBSP-padded) and tmx/cwd/git/fab unchanged | Explicit user instruction + spec § Row Minimalism 3-char note; intake assumption 2 | S:88 R:90 A:92 D:88 |
| 3 | Confident | Re-add `State string` to `BranchPR`, parse the branch query's `state` field; `IsDraft` stays out (no consumer) | Precedence needs state; matches the pre-rework shape the y1ar change trimmed; `IsDraft` had no reader | S:70 R:80 A:88 D:82 |
| 4 | Confident | `gh pr list --json state` emits uppercase `OPEN`/`MERGED`/`CLOSED`; compare case-insensitively (ToUpper) | Same enum the viewer-wide collector's `mapState` already maps from the GraphQL API; could not verify live (sandboxed network) so normalized defensively | S:65 R:80 A:80 D:78 |
| 5 | Confident | No frontend ladder / pr-status-line change; fix is derivation-side + prefixes only | Verified this session: `prOwnsDot` maps merged→owned/done, excludes closed; ladder was data-starved, not wrong; intake assumption 5 | S:72 R:78 A:88 D:82 |
| 6 | Confident | Cold-collector durability test = a fresh `BranchRefresher` resolving the same merged gh response (models restart via fresh process state, no prior positive/grace) | Intake requirement "durable from a COLD collector"; a BranchRefresher holds all cross-restart state, so a fresh instance is the faithful restart model | S:72 R:82 A:85 D:80 |
| 7 | Confident | Align the docs/site register-view example keys (output/agent → out/agt) in addition to the D2 grace sweep | Task 3 says "sweep for register-key OR grace-window wording invalidated"; the example still shows the old keys | S:70 R:85 A:85 D:78 |

7 assumptions (2 certain, 5 confident, 0 tentative).
