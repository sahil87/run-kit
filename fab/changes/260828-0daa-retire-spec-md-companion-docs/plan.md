# Plan: Retire `.spec.md` Companion Docs for In-File Test Intent Comments

**Change**: 260828-0daa-retire-spec-md-companion-docs
**Intake**: `intake.md`

## Requirements

### Governance: Constitution amendment

#### R1: Test Intent Comments replaces Test Companion Docs
`fab/project/constitution.md` MUST replace the `### Test Companion Docs (\`.spec.md\`)` constraint under `## Additional Constraints` with the `### Test Intent Comments` constraint, using the wording drafted in `intake.md` § 1 verbatim. The Governance line MUST read **Version** `1.11.0`, **Last Amended** `2026-08-28`.

- **GIVEN** the constitution at 1.10.0 carries the Test Companion Docs constraint
- **WHEN** the amendment is applied
- **THEN** `grep -c 'Test Companion Docs' fab/project/constitution.md` is 0, `grep -c 'Test Intent Comments'` is ≥ 1, and the Governance line carries 1.11.0 / 2026-08-28
- **AND** no other constitution section changes

### Tests: Per-file migration of `app/frontend/tests/e2e/*.spec.ts`

#### R2: Every e2e `test()` carries a Proves/Steps JSDoc block
Every `test(`, `test.skip(`, `test.fixme(`, and `test.only(` call in `app/frontend/tests/e2e/*.spec.ts` MUST be immediately preceded (allowing blank lines only) by a `/** … */` block containing a `Proves:` line and a `Steps:` numbered list, folded from the sibling `.spec.md`'s matching `### <title>` section. Where the md section and the test body disagree, the test body is the source of truth.

- **GIVEN** a spec file with N `test(` calls and a sibling md
- **WHEN** the migration runs
- **THEN** N JSDoc blocks with `Proves:` and `Steps:` sit directly above the N `test(` lines
- **AND** `test.describe(` blocks receive no block of their own

#### R3: File-header comment carries shared setup
Each spec file MUST open (after imports is acceptable when a header already sits there) with exactly one header comment covering the md's `## Shared setup` facts — `beforeAll`/`beforeEach`, fixtures, viewport, `page.route` stubs, saved/restored host-global state. Existing header comments are merged (constraints kept, setup facts added), never duplicated. Every `See X.spec.md …` / `sibling .spec.md` pointer sentence (22 files listed in intake § 2) MUST be removed.

- **GIVEN** `top-bar-refresh.spec.ts` with an existing header ending `// top-bar-refresh.spec.md for intent + steps.`
- **WHEN** migrated
- **THEN** one header remains, containing the mock/route facts from the md's Shared setup, with no `.spec.md` mention

#### R4: Folded text carries no provenance narration
Comment text introduced by this change MUST NOT contain change-ID citations (`2[0-9]{5}-[a-z0-9]{4}`), PR numbers, or "Since <id>…" / "pre-<id>" history narration. Only constraints the code cannot show (why a stub is shaped so, why a wait exists, cross-file contracts) are kept.

- **GIVEN** an md paragraph "Since 260715-h1ck the right cluster is registry-driven …"
- **WHEN** folded
- **THEN** the comment states the present-truth constraint ("the right cluster is registry-driven; ordering is asserted by document position") with no ID

#### R5: Comment-only diff; no test body changes
No `test()` title, body, fixture, helper, import, or constant MAY change. The `.spec.ts` diff MUST consist solely of comment lines (`/**`, ` *`, ` */`, `//`) and blank-line churn, plus the removed pointer sentences.

- **GIVEN** `git diff -U0 origin/main -- 'app/frontend/tests/e2e/*.spec.ts'`
- **WHEN** filtered with `grep '^[-+]' | grep -v -E '^[-+]{3}|^[-+]\s*(/\*\*|\*|\*/|//|$)'`
- **THEN** the output is empty

#### R6: Companion files deleted
All 86 `app/frontend/tests/e2e/*.spec.md` MUST be removed via `git rm`.

- **GIVEN** the migration is complete
- **WHEN** `ls app/frontend/tests/e2e/*.spec.md` runs
- **THEN** it matches nothing

### Docs: Memory pointer sweep

#### R7: Memory files no longer reference companion docs
The 14 memory files listed in `intake.md` § Affected Memory MUST drop every `(+ .spec.md)` / `(+ sibling .spec.md)` / `+ companion .spec.md` parenthetical (keeping the `.spec.ts` pointer) and reword the six prose references ("documented in the `.spec.md`", "Test Companion Docs rule") to the intent-comment / "Test Intent Comments" form. `log.md`, `log.seed.md`, `fab/backlog.md`, `fab/changes/**`, `fab/plans/**`, and `.claude/skills/**` MUST NOT be edited.

- **GIVEN** the sweep is complete
- **WHEN** `grep -rn 'spec\.md' docs/memory --include='*.md' | grep -v '/log'` runs
- **THEN** it matches nothing

### Non-Goals
- No `just` skim recipe (intake Assumption 13 — optional follow-up)
- No purge of pre-existing change-ID citations inside `.spec.ts` comments that the fold does not touch (Assumption 11)
- No edits to `.claude/skills/_generation` / `_cli-fab` (their `spec.md` is fab's legacy change artifact; upstream copies)

### Design Decisions

#### Intent lives in a JSDoc block above each test
**Decision**: Per-`test()` `/** Proves: … Steps: … */` block plus one file-header comment; companion files deleted.
**Why**: The intent text moves in the same diff hunk as the test, so drift is visible in review; nothing consumed the mds (no CI/script/skill), and they had become a shadow memory layer (291 change-ID citations).
**Rejected**: A CI drift-check over the mds (tooling to protect an unread artifact); mds only for long specs (two conventions).
*Introduced by*: 260828-0daa-retire-spec-md-companion-docs

### Deprecated Requirements

#### Test Companion Docs (`.spec.md`)
**Reason**: ~50% documentation tax on a parallel artifact with no consumer; drift and provenance bleed.
**Migration**: R1–R6 — intent comments in the spec file itself.

## Tasks

### Phase 1: Setup

- [x] T001 Amend `fab/project/constitution.md`: replace `### Test Companion Docs (\`.spec.md\`)` with `### Test Intent Comments` (wording verbatim from `intake.md` § 1); Governance → Version 1.11.0, Last Amended 2026-08-28 <!-- R1 -->

### Phase 2: Core Implementation

Per-batch procedure (identical for T002–T009; batches are disjoint file sets and MAY run in parallel via sub-agents off this shared brief): for each `X` in the batch — (1) read `X.spec.md` and `X.spec.ts`; (2) fold the md `## Shared setup` + intro into ONE file-header comment (merge with an existing header; delete any `See X.spec.md` sentence); (3) above every `test(`/`test.skip(`/`test.fixme(`/`test.only(` insert a `/** Proves: … Steps: 1. … */` block from the matching `### <title>` section, rewriting from the test body where the md has drifted; (4) drop change-ID citations, PR numbers and "Since <id>…" narration while folding; (5) `git rm app/frontend/tests/e2e/X.spec.md`; (6) verify `git diff -U0 -- X.spec.ts | grep '^[-+]' | grep -v -E '^[-+]{3}|^[-+]\s*(/\*\*|\*|\*/|//|$)'` is empty and every `test(` line's nearest preceding non-blank line is `*/`.

- [x] T002 [P] Migrate batch B1 in `app/frontend/tests/e2e/`: `agent-next-waiting`, `api-integration`, `board-autofit`, `board-close-and-unpin`, `board-list-reorder`, `board-reorder`, `boards-desktop-suspend`, `boards-mobile`, `boards-multi-server`, `boards-pin-flow`, `boards-same-session-multi-pane` <!-- R2 R3 R4 R5 R6 -->
- [x] T003 [P] Migrate batch B2: `bottom-bar-chip-size`, `bottom-bar-safe-floor`, `chat-view` (2 drifted titles — write from test body), `code-folder-latch`, `code-surface`, `compose-strip`, `connection-budget`, `create-server-waiting`, `echo-latency`, `focus-restore`, `host-health-home` <!-- R2 R3 R4 R5 R6 -->
- [x] T004 [P] Migrate batch B3: `host-system-card`, `legacy-color-sweep`, `legacy-scope-sweep`, `macro-riff-bindings` (1 drifted title), `mobile-keyboard-refit`, `mobile-layout`, `mobile-touch-scroll`, `multi-server-sidebar`, `new-window-unnamed`, `open-in-app`, `operator-compose` <!-- R2 R3 R4 R5 R6 -->
- [x] T005 [P] Migrate batch B4: `operator-digest`, `operator-pinned-row`, `operator-session-promotion`, `pane-register-panel`, `pr-status-sidebar`, `present-auto-expand`, `protected-kill-confirm`, `pwa-assets`, `recovery-section`, `right-panel`, `row-flyout` <!-- R2 R3 R4 R5 R6 -->
- [x] T006 [P] Migrate batch B5: `row-identity-tips`, `row-minimalism`, `server-panel-grid`, `server-reorder`, `session-name-prompt`, `session-reorder` (describe-only file — header comment carries the md's intent; no `test(` present), `session-tiles`, `sessions-scope-toggle`, `settings-dialog`, `shell-rotation`, `shortcut-registry` (1 drifted title) <!-- R2 R3 R4 R5 R6 -->
- [x] T007 [P] Migrate batch B6: `sidebar-autoscroll`, `sidebar-footer`, `sidebar-keyboard-nav`, `sidebar-multiselect`, `sidebar-panels`, `sidebar-section-rail`, `sidebar-window-sync`, `smoke`, `sort-windows`, `spawn-agent`, `sse-connection` <!-- R2 R3 R4 R5 R6 -->
- [x] T008 [P] Migrate batch B7: `status-bar`, `surface-focus-chords`, `surface-layout`, `sync-latency` (2 drifted step titles), `terminal-export`, `terminal-tile-find`, `tooltips`, `top-bar-overflow`, `top-bar-overlap`, `top-bar-persistence`, `top-bar-refresh` <!-- R2 R3 R4 R5 R6 -->
- [x] T009 [P] Migrate batch B8: `tty-progress`, `web-tile-chrome`, `web-tile-find`, `web-tile-zoom`, `web-view-lens`, `window-heading` (1 drifted title), `window-marker-gutter`, `window-switch-transition`, `zen-mode` <!-- R2 R3 R4 R5 R6 -->

### Phase 3: Integration & Edge Cases

- [x] T010 Memory pointer sweep across the 14 files in `docs/memory/run-kit/` listed in `intake.md` § Affected Memory (line numbers there are approximate — re-grep `spec\.md`): drop the companion parentheticals, reword the six prose references; leave `log.md`/`log.seed.md` untouched; then `grep -rn 'spec\.md' docs/memory --include='*.md' | grep -v '/log'` → empty. Run `fab memory-index` afterwards <!-- R7 -->
- [x] T011 Whole-tree verification: `ls app/frontend/tests/e2e/*.spec.md` empty; `grep -rn 'spec\.md' app/frontend/tests/e2e` empty; the R5 comment-only diff filter over all `*.spec.ts` is empty; an awk pass confirms every `test(`/`test.skip(`/`test.fixme(` line in `app/frontend/tests/e2e/*.spec.ts` has `*/` as its nearest preceding non-blank line and that block contains `Proves:`; `grep -nE '2[0-9]{5}-[a-z0-9]{4}' $(git diff --name-only origin/main -- 'app/frontend/tests/e2e/*.spec.ts')` shows only pre-existing lines (compare against `origin/main`) <!-- R2 R4 R5 R6 -->
- [x] T012 Test gates: `just test-frontend` (type-check + Vitest) green; `just test-e2e "zen-mode"`, `just test-e2e "chat-view"`, `just test-e2e "smoke"` green (pre-existing flakes per `docs/memory` are not caused by this change — re-run once before blaming) <!-- R5 -->

## Execution Order

- T001 is independent of T002–T009
- T002–T009 are pairwise independent (disjoint files) — fan out
- T010 after T002–T009 (so the memory grep reflects the final tree)
- T011 after T002–T010; T012 after T011

## Acceptance

### Functional Completeness

- [x] A-001 R1: `fab/project/constitution.md` has `### Test Intent Comments` with the intake § 1 wording, no `Test Companion Docs`, Version 1.11.0, Last Amended 2026-08-28; no other section changed
- [x] A-002 R2: every `test(`/`test.skip(`/`test.fixme(`/`test.only(` in `app/frontend/tests/e2e/*.spec.ts` is immediately preceded (blank lines allowed) by a `*/` closing a block containing `Proves:` and `Steps:`
- [x] A-003 R3: each spec file has exactly one header comment carrying its shared-setup facts; zero `spec.md` mentions remain in `app/frontend/tests/e2e/`
- [x] A-004 R6: `ls app/frontend/tests/e2e/*.spec.md` matches nothing; the 86 deletions are staged via `git rm`
- [x] A-005 R7: `grep -rn 'spec\.md' docs/memory --include='*.md' | grep -v '/log'` is empty; `log.md`/`log.seed.md`, `fab/backlog.md`, `fab/plans/**`, `.claude/skills/**` untouched

### Behavioral Correctness

- [x] A-006 R5: `git diff -U0 origin/main -- 'app/frontend/tests/e2e/*.spec.ts' | grep '^[-+]' | grep -v -E '^[-+]{3}|^[-+]\s*(/\*\*|\*|\*/|//|$)'` is empty — no test body, title, helper, import, or constant changed
- [x] A-007 **N/A**: the dispatched review worker's contract explicitly prohibits re-running the e2e suite; the type gate `cd app/frontend && npx tsc --noEmit` (the contract's permitted substitute) exits 0, and A-006 proves no body/title/helper/import changed, so the e2e subset cannot regress

### Removal Verification

- [x] A-008 R1: the phrase "Test Companion Docs" appears nowhere in `fab/project/constitution.md`, `docs/memory/**` (excluding `log*.md`), or `app/frontend/tests/e2e/**`

### Scenario Coverage

- [x] A-009 R2: the 7 drifted titles (`chat-view` ×2, `macro-riff-bindings`, `shortcut-registry`, `sync-latency` ×2, `window-heading`) have comments that describe the current test body, not the stale md text
- [x] A-010 R3: `top-bar-refresh.spec.ts` (and the other 21 pointer files) have a single merged header with the md's route/mock facts and no `.spec.md` sentence

### Edge Cases & Error Handling

- [x] A-011 R4: no change-ID (`2[0-9]{5}-[a-z0-9]{4}`), PR number, or "Since <id>" / "pre-<id>" phrase appears in comment lines added by this change (new lines vs `origin/main`)
- [x] A-012 R2: `session-reorder.spec.ts` (describe-only, skipped test) carries the md intent in its header; `test.skip`/`test.fixme` entries elsewhere are documented like live tests

### Code Quality

- [x] A-013 Pattern consistency: JSDoc blocks follow one shape (`Proves:` paragraph, blank ` *`, `Steps:` list) across all 86 files; header comments match the existing `//`/`/** */` style of each file
- [x] A-014 No unnecessary duplication: setup facts stated once in the header, not repeated in every per-test block
- [x] A-015 Comment narration rule (`code-quality.md` § Anti-Patterns): comments state constraints the code can't show; none narrate the next line or cite change IDs / PR numbers

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before hydrate
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Constitution wording is the intake § 1 draft verbatim; minor version bump | Intake Assumptions 12/14 defaulted these; a one-line governance edit is trivially revisable | S:80 R:95 A:85 D:85 |
| 2 | Confident | Migration split into 8 disjoint alphabetical batches of ≤ 11 files, parallelizable | Pure sequencing choice — any partition works; batches keep each unit within one focused session | S:60 R:95 A:90 D:80 |
| 3 | Confident | `session-reorder.spec.ts` (describe block, no `test(`) gets header-only treatment; `test.skip`/`fixme` get full blocks | Intake says skipped tests are documented like others; a describe with no test has nothing to attach a block to | S:65 R:90 A:85 D:75 |
| 4 | Confident | Verification e2e subset is `zen-mode`, `chat-view`, `smoke`; full e2e rides CI | Comment-only edits cannot alter behavior; the subset proves no accidental body edit slipped through type-check | S:70 R:90 A:85 D:80 |
| 5 | Confident | Pre-existing change-ID citations in `.spec.ts` comments are left unless the fold touches that comment | Intake Assumption 11; a purge is adjacent scope | S:55 R:90 A:80 D:70 |

5 assumptions (1 certain, 4 confident, 0 tentative).
