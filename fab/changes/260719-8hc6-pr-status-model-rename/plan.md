# Plan: Rename pr-status-line to pr-status-model

**Change**: 260719-8hc6-pr-status-model-rename
**Intake**: `intake.md`

## Requirements

### Module: pr-status-line → pr-status-model rename

#### R1: The status-dot model module is renamed to a truthful name and extension
The module `app/frontend/src/components/pr-status-line.tsx` SHALL be renamed to `app/frontend/src/components/pr-status-model.ts` via `git mv` (dropping `.tsx`, since the file contains no JSX and no React import). Its exported symbols (`isFailish`, `PR_STATE_COLORS`, `PR_CHECKS_COLORS`, `PR_REVIEW_COLORS`, `PrDotState`, `prDotState`, `DotShape`, `DotPhase`, `StatusDotState`, `fabPhase`, `fabShape`, `prShape`, `PHASE_HUE`, `statusDotState`) SHALL be unchanged. No logic changes.

- **GIVEN** the module is pure model code with a retired `PrStatusLine` component (only NOTE comments remain)
- **WHEN** the rename is applied
- **THEN** `pr-status-model.ts` exists with identical exports and `pr-status-line.tsx` no longer exists
- **AND** git records it as a rename (`git mv`)

#### R2: The sibling test file is renamed in lock-step
`app/frontend/src/components/pr-status-line.test.tsx` SHALL be renamed to `app/frontend/src/components/pr-status-model.test.ts` via `git mv` (pure model tests, no renders), and its import of the module under test SHALL point at the new module path.

- **GIVEN** the test file exercises only `prDotState` (no JSX renders)
- **WHEN** the rename is applied
- **THEN** `pr-status-model.test.ts` exists and imports from `./pr-status-model`
- **AND** the test suite passes unchanged

#### R3: All import sites are updated to the new module path
Every module-path reference to `pr-status-line` (both `@/components/pr-status-line` and relative `./pr-status-line` forms) SHALL be updated to the corresponding `pr-status-model` path across the 7 consumer files: `status-dot.tsx`, `status-dot-tip.tsx`, `status-dot-label.ts`, `sidebar/status-panel.tsx`, `status-dot.test.tsx`, `status-dot-tip.test.tsx`, and the self-import in the renamed test file. TypeScript compilation (`just check`) SHALL succeed with no unresolved-module errors.

- **GIVEN** 7 grep-verified module-path references exist (up from the backlog's stale count of 5)
- **WHEN** each is repointed to `pr-status-model`
- **THEN** `just check` passes with zero import-resolution errors

#### R4: Retirement provenance comments are preserved; only self-referencing paths change
The `260715-jykd` retirement NOTE comments in the renamed files SHALL be kept (they explain why no component lives there). Only literal old-filename self-references (`pr-status-line.tsx`) inside those comments SHALL be updated to `pr-status-model.ts`. Non-path historical mentions of the `PrStatusLine` component name (e.g. the `window-row.test.tsx` line-161 comment) and the DOM testid string `"pr-status-line"` in `window-row.test.tsx` SHALL NOT be changed — they are not module paths.

- **GIVEN** comments carrying retirement history and a DOM testid literal
- **WHEN** the rename is applied
- **THEN** provenance comments remain, self-referencing filename paths in them are updated, and the `queryByTestId("pr-status-line")` string is left intact

### Non-Goals

- No change to any exported symbol name or signature — path-only rename.
- No backend, route, or e2e surface changes.
- No change to the DOM `data-testid="pr-status-line"` contract (it is a rendered-attribute string, unrelated to the module filename).

## Tasks

### Phase 1: Rename files

- [x] T001 `git mv app/frontend/src/components/pr-status-line.tsx app/frontend/src/components/pr-status-model.ts` <!-- R1 -->
- [x] T002 `git mv app/frontend/src/components/pr-status-line.test.tsx app/frontend/src/components/pr-status-model.test.ts` <!-- R2 -->

### Phase 2: Update self-referencing content in the renamed files

- [x] T003 In `pr-status-model.ts`, update the `260715-jykd` NOTE comment's self-reference to the module (keep the retirement provenance) <!-- R4 -->
- [x] T004 In `pr-status-model.test.ts`, change the module-under-test import to `./pr-status-model` and update the NOTE comment's `pr-status-line.tsx` self-reference to `pr-status-model.ts` (keep provenance) <!-- R2 R4 -->

### Phase 3: Update the 6 external import sites

- [x] T005 [P] `app/frontend/src/components/status-dot.tsx`: `@/components/pr-status-line` → `@/components/pr-status-model` <!-- R3 -->
- [x] T006 [P] `app/frontend/src/components/status-dot-tip.tsx`: `@/components/pr-status-line` → `@/components/pr-status-model` <!-- R3 -->
- [x] T007 [P] `app/frontend/src/components/status-dot-label.ts`: `@/components/pr-status-line` → `@/components/pr-status-model` <!-- R3 -->
- [x] T008 [P] `app/frontend/src/components/sidebar/status-panel.tsx`: import `@/components/pr-status-line` → `@/components/pr-status-model`, and update the line-102 comment's `pr-status-line.tsx` self-reference to `pr-status-model.ts` <!-- R3 R4 -->
- [x] T009 [P] `app/frontend/src/components/status-dot.test.tsx`: `./pr-status-line` → `./pr-status-model` <!-- R3 -->
- [x] T010 [P] `app/frontend/src/components/status-dot-tip.test.tsx`: `./pr-status-line` → `./pr-status-model` <!-- R3 -->

### Phase 4: Verify

- [x] T011 Run `just check` (typecheck) and `just test-frontend` (Vitest); confirm the renamed test suite passes and no import-resolution errors remain. Re-sweep with `grep -a` for any residual `pr-status-line` module-path reference (only the DOM testid string in `window-row.test.tsx` should remain). <!-- R1 R2 R3 R4 -->

## Execution Order

- T001, T002 (renames) must run before T003, T004 (edits to renamed files).
- T005–T010 are independent of each other and of the renamed-file edits; parallelizable.
- T011 runs last.

## Acceptance

### Functional Completeness

- [x] A-001 R1: `pr-status-model.ts` exists with all original exports and no logic change; `pr-status-line.tsx` is gone; git records a rename (100% similarity — byte-identical content).
- [x] A-002 R2: `pr-status-model.test.ts` exists, imports the module under test from `./pr-status-model`, and the suite passes.
- [x] A-003 R3: All 7 module-path references updated; `just check` passes with zero import-resolution errors.
- [x] A-004 R4: `260715-jykd` provenance comments retained; self-referencing filename paths updated to `pr-status-model.ts` (test file + status-panel.tsx:102; the module file's own NOTE never contained a filename self-reference — `/api/pr-status/refresh` at line 5 is an API path, correctly untouched — so T003 was a verified no-op).

### Behavioral Correctness

- [x] A-005 R1: No runtime behavior change — `just test-frontend` passes (85 files, 1489 tests).

### Removal Verification

- [x] A-006 R4: A `grep -a` sweep for `pr-status-line` finds no remaining module-path reference in source; only the DOM testid string `"pr-status-line"` in `window-row.test.tsx:175` remains (intentionally unchanged).

### Code Quality

- [x] A-007 Pattern consistency: Import forms (`@/`-absolute vs `./`-relative) preserved per site — each site's existing style is kept, only the module segment changed.
- [x] A-008 No unnecessary duplication: No new files or symbols introduced; pure rename.

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)

## Deletion Candidates

- `app/frontend/src/components/pr-status-model.test.ts:2,11-13` — the `@testing-library/react` `cleanup` import + `afterEach(cleanup)` block is render-test scaffolding left over from the retired `PrStatusLine` render cases; the file renders nothing (the very rationale for the `.tsx`→`.ts` rename), so the hook is a no-op.
- `app/frontend/src/components/sidebar/window-row.test.tsx:164-176` — the tombstone test asserting `queryByTestId("pr-status-line")` is null now guards a testid no code in the repo renders (vacuously true since `260715-jykd`); redundancy predates this change — keep only if valued as a regression tombstone.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Target name `pr-status-model.ts` (drop `.tsx`) | Backlog/intake name it explicitly; grep-verified no JSX/React import | S:90 R:90 A:95 D:90 |
| 2 | Certain | Update all 7 current module-path import sites | Grep is authoritative over the stale count; compile gate catches any miss | S:75 R:90 A:95 D:90 |
| 3 | Certain | The `queryByTestId("pr-status-line")` string in window-row.test.tsx is a DOM testid, not a module path — leave unchanged | It is a rendered-attribute literal; the intake explicitly scopes changes to module-path references only | S:85 R:85 A:95 D:90 |
| 4 | Confident | Retirement NOTE comments kept; only literal old-filename self-references updated | History-explaining comments remain useful; renaming should not erase provenance | S:55 R:85 A:80 D:70 |

4 assumptions (3 certain, 1 confident, 0 tentative).
