# Plan: Top-Bar Left Cluster — Hamburger-First Reorder, Coarse Touch Target, RunKit Wordmark

**Change**: 260720-ap63-hamburger-first-runkit-wordmark
**Intake**: `intake.md`

## Requirements

### Top Bar: Left-Cluster Structure

#### R1: Hamburger-first, outside the breadcrumb nav
The sidebar/window-panel toggle (`aria-label="Toggle navigation"`, still gated on `hasSidebar`) MUST be the FIRST element of the top bar's left grid cell, rendered as a sibling BEFORE `<nav aria-label="Breadcrumb">` — outside the nav landmark. The brand anchor (logo + wordmark) MUST become the first element INSIDE the nav (the breadcrumb's root crumb), so the `BreadcrumbSeparator` (`›`) starts after the brand. The left grid cell MUST gain a flex wrapper so hamburger + nav sit side by side inside the `grid-cols-[1fr_auto_1fr]` left cell without disturbing the center heading's true centering. Behavior MUST be preserved: `onToggleSidebar` wiring, `HamburgerIcon isOpen={hamburgerOpen}` state, `rk-glint` on the hamburger, `rk-brand-glitch` on the brand.

- **GIVEN** a terminal/server/board route (`hasSidebar` true)
- **WHEN** the top bar renders
- **THEN** the hamburger button is the first element of the left cluster, precedes the breadcrumb nav in document order, and is NOT a descendant of `nav[aria-label="Breadcrumb"]`
- **AND** the brand anchor is the nav's first child

- **GIVEN** the Host page (`hasSidebar` false — no sidebar exists there)
- **WHEN** the top bar renders
- **THEN** no hamburger renders and the brand shifts left (~30px) relative to other routes — accepted, no ghost slot is reserved

#### R2: Coarse touch target on the hamburger
The hamburger button MUST carry `coarse:min-h-[30px] coarse:min-w-[30px]` in addition to its existing `min-w-[24px] min-h-[24px]`, matching the top-bar button-control vocabulary (24px fine / 30px coarse — NOT the bottom-bar's 36px).

- **GIVEN** a coarse-pointer device (`@media (pointer: coarse)`)
- **WHEN** the hamburger renders
- **THEN** its minimum hit target is 30×30px (24×24px on fine pointers)

#### R3: Breadcrumb nav min-width floor reassessed
With the hamburger moved outside the nav, the nav's `min-w-[76px] sm:min-w-[180px]` floor MUST be reassessed: the below-`sm` floor now only guarantees the bare logo icon; the hamburger sibling carries its own `shrink-0` + min sizes outside the nav. The left cell's TOTAL floor SHOULD stay equivalent to today's (the hamburger + gap width moves out of the nav floor, not added on top). The degradation ladder (crumbs truncate → server crumb hides below `md` → nav clips at its floor) MUST be preserved, and the comment block above the nav MUST be updated to match the new structure. Nothing may clip or wrap at 375px (single-line top-bar budget) on routes where `hasSidebar` is true.

- **GIVEN** the 375/640/700/768/1024 viewport sweep with a long window name (top-bar-overlap e2e)
- **WHEN** the top bar renders with the new floor values
- **THEN** the nav never overlaps the center heading and the page never overflows horizontally

### Branding: RunKit Wordmark

#### R4: User-visible "Run Kit" → "RunKit" sweep
All remaining user-visible "Run Kit" strings MUST become "RunKit", matching `document.title` / `index.html` / `manifest.json` (all already "RunKit"):

- `src/components/top-bar.tsx` — wordmark span text and `aria-label="Run Kit home"` → `"RunKit home"`
- `src/components/top-bar-overflow-menu.tsx` — version-row `versionText` (both branches: `RunKit ${displayVersion(...)}` / `"RunKit"`) and the `aria-label` fallback `"Run Kit"` → `"RunKit"`
- Adjacent code comments referencing the old spelling updated for consistency

NOT in scope: `singleRunKit` identifiers (internal variable names), backend strings, README/docs.

- **GIVEN** any route
- **WHEN** the top bar and its overflow menu render
- **THEN** the wordmark reads `RunKit`, the brand's accessible name is `RunKit home`, and the overflow version row reads `RunKit` / `RunKit v{version}`

### Tests: Same-Commit Updates

#### R5: Unit + e2e assertions and `.spec.md` companions updated
All tests asserting the renamed strings or left-cluster structure MUST be updated in the same commit (constitution § Test Integrity, § Test Companion Docs):

- `src/components/top-bar.test.tsx` — `"Run Kit home"` label sites, wordmark text test, overflow version-row texts; the ordering test ("renders the brand as the left-most root crumb…") extended to also assert the new invariant: the hamburger is the first element of the left cluster, rendered before (and outside) the breadcrumb nav, when `hasSidebar` is true
- `src/components/top-bar-overflow-menu.test.tsx`, `src/components/update-chip.test.tsx`, `src/components/host-overview-page.test.tsx` — version-row / brand-label string sites (they assert the same rendered strings and would fail or go stale otherwise)
- `tests/e2e/top-bar-persistence.spec.ts` (`getByLabel("Run Kit home")`) + `.spec.md`; `tests/e2e/top-bar-overflow.spec.ts` (space-sensitive `/Run Kit/` and `/^Run Kit v/` regexes) + `.spec.md`; `tests/e2e/top-bar-overlap.spec.ts`/`.spec.md` comment references to the old floor values
- Hamburger e2e selectors (`"Toggle navigation"`) are unaffected — aria-label unchanged

- **GIVEN** the full frontend unit suite and the touched e2e specs
- **WHEN** run via `just test-frontend` and `just test-e2e "<spec>"`
- **THEN** all pass with the new spelling and structure asserted

### Non-Goals

- No ghost/placeholder hamburger slot on the Host page — the ~30px brand shift is accepted (standard pattern)
- No rename of internal identifiers (`singleRunKit`), backend strings, or README/docs
- No change to the hamburger's `aria-label` (`"Toggle navigation"`) or `onToggleSidebar` behavior

## Tasks

### Phase 1: Core Implementation

- [x] T001 Restructure the left cluster in `app/frontend/src/components/top-bar.tsx`: wrap the left grid cell in a flex container (`flex items-center gap-1.5 min-w-0`), render the `hasSidebar`-gated hamburger button as its first child (before the nav), make the brand anchor the nav's first child, and update the structural comments <!-- R1 -->
- [x] T002 Add `coarse:min-h-[30px] coarse:min-w-[30px]` to the hamburger button's className in `app/frontend/src/components/top-bar.tsx` (keep `min-w-[24px] min-h-[24px]`) <!-- R2 -->
- [x] T003 Reassess the nav's min-width floor in `app/frontend/src/components/top-bar.tsx` (subtract the hamburger+gap width that moved outside: `min-w-[76px] sm:min-w-[180px]` → `min-w-[46px] sm:min-w-[150px]`), preserving the degradation ladder and updating the comment block <!-- R3 -->
- [x] T004 [P] Rename user-visible "Run Kit" → "RunKit" in `app/frontend/src/components/top-bar.tsx` (wordmark span, `aria-label="RunKit home"`) and `app/frontend/src/components/top-bar-overflow-menu.tsx` (`versionText` both branches, aria-label fallback, adjacent comments) <!-- R4 -->

### Phase 2: Tests

- [x] T005 Update unit tests: `app/frontend/src/components/top-bar.test.tsx` (label/wordmark/version-row strings; extend the brand-order test with the hamburger-first-outside-nav invariant + coarse-class assertion), `top-bar-overflow-menu.test.tsx`, `update-chip.test.tsx`, `host-overview-page.test.tsx` (renamed strings) <!-- R5 -->
- [x] T006 [P] Update e2e specs + companions: `app/frontend/tests/e2e/top-bar-persistence.spec.ts` + `.spec.md` (brand label), `top-bar-overflow.spec.ts` + `.spec.md` (version-row regexes), `top-bar-overlap.spec.ts` + `.spec.md` (floor-value comment references) <!-- R5 -->

### Phase 3: Verification

- [x] T007 Run `just test-frontend`, then `just test-e2e` for the touched specs (top-bar-persistence, top-bar-overflow, top-bar-overlap, mobile-layout) and fix any failures <!-- R5 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: On sidebar routes the hamburger is the first left-cluster element, rendered before and outside `nav[aria-label="Breadcrumb"]`; the brand is the nav's first child and the `›` separator starts after it
- [x] A-002 R2: The hamburger carries `coarse:min-h-[30px] coarse:min-w-[30px]` alongside `min-w-[24px] min-h-[24px]`
- [x] A-003 R3: The nav floor no longer budgets for the hamburger; the degradation ladder and comment block match the new structure
- [x] A-004 R4: No user-visible "Run Kit" string remains in `app/frontend/src/` (wordmark, brand aria-label, overflow version row all read "RunKit")

### Behavioral Correctness

- [x] A-005 R1: `onToggleSidebar`, `HamburgerIcon isOpen` state, `rk-glint` (hamburger) and `rk-brand-glitch` (brand) are preserved; the Host page renders no hamburger and reserves no ghost slot
- [x] A-006 R3: At 375px the single-line top-bar budget holds on sidebar routes (no clip/wrap regression from the 30px coarse hamburger)

### Scenario Coverage

- [x] A-007 R1: A unit test asserts the hamburger-first-outside-nav invariant when `hasSidebar` is true
- [x] A-008 R3: The top-bar-overlap 375/640/700/768/1024 sweep passes with the new floor values
- [x] A-009 R5: Touched e2e specs pass and their `.spec.md` companions are updated in the same commit

### Code Quality

- [x] A-010 Pattern consistency: New structure follows existing top-bar conventions (coarse: variant vocabulary, comment style, flex/grid patterns)
- [x] A-011 No unnecessary duplication: No new utilities introduced; existing classes and components reused

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

None — this change reorders existing DOM (moving the hamburger out of the nav), retunes an existing min-width floor, and sweeps a user-visible string. It removes no code paths, symbols, or files and makes nothing redundant (the wrapper `div` and coarse classes reuse existing patterns; no utilities were added).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Nav floor becomes `min-w-[46px] sm:min-w-[150px]` — the 30px (24px hamburger + 6px gap) that moved outside is subtracted so the left cell's total floor stays equivalent; verified by the top-bar-overlap e2e sweep | Intake assumption #6 fixed no value; keeping the total budget unchanged is the least-risk choice and the sweep is the designated harness | S:70 R:90 A:85 D:70 |
| 2 | Certain | Tests beyond the intake's list (`top-bar-overflow-menu.test.tsx`, `update-chip.test.tsx`, `host-overview-page.test.tsx`) are also updated to the new spelling | They assert the same rendered strings — grep-verified; constitution § Test Integrity requires same-commit conformance | S:90 R:95 A:95 D:95 |
| 3 | Certain | Left-cell wrapper is a plain `div` with `flex items-center gap-1.5 min-w-0` (gap matches the nav's existing `gap-1.5`; `min-w-0` lets the nav shrink inside the `1fr` column) | Matches surrounding flex/grid patterns in top-bar.tsx; one obvious implementation | S:85 R:95 A:95 D:90 |

3 assumptions (2 certain, 1 confident, 0 tentative).
