# Plan: Status-Bar Segment Reorder + `out` Register Removal

**Change**: 260816-499u-status-bar-reorder-drop-out
**Intake**: `intake.md`

## Requirements

### Status Bar: Left-cluster relevance order

#### R1: Relevance-descending segment order
The `WindowCluster` left cluster in `app/frontend/src/components/status-bar.tsx` SHALL render its segments in the order **⑂ git → pr → fab → agt → tmx → cwd**. Each segment MUST keep its existing markup, conditional guards, and breakpoint class verbatim (`cwd` `hidden xl:flex`, `tmx` `hidden lg:flex`, `⑂ git` `hidden md:flex` + `gitBranch &&` guard; `agt` with its leading `StatusDot`, `fab`, and `pr` open-first anchor unchanged, never dropping) — only DOM order moves.

- **GIVEN** a terminal-route window with all signal layers present (branch, PR, fab change, agent state)
- **WHEN** the desktop status bar renders at ≥1280px
- **THEN** the left cluster reads left-to-right: `⑂ <branch>`, `pr #N · …`, `fab …`, `agt …`, `tmx pane a/b %id`, `cwd <basename>`
- **AND** the drop thresholds are unchanged (cwd <xl, tmx <lg, git <md; agt/fab/pr never drop) — display order now matches survival order, so droppable segments die right-to-left

#### R2: `out` segment deleted outright
The `out` register MUST be removed from `status-bar.tsx` entirely: the strip `<Segment label="out">` (`hidden min-[900px]:flex`), the overflow-menu `out` `textRow` (`min-[900px]:hidden`), the `const nowSeconds = useNow()` clock and `outLine` resolution in `WindowCluster`, and the now-unused `useNow` / `getOutputLine` imports. `getOutputLine` MUST remain untouched in `app/frontend/src/components/sidebar/registers.ts` (its other consumers: `status-panel.tsx`, `row-flyout-card.tsx`).

- **GIVEN** any window record
- **WHEN** the status bar renders at any width, and when the `…` overflow menu opens
- **THEN** no `out` segment or menu row exists, no `min-[900px]` breakpoint remains in the file, and `WindowCluster` holds no per-second clock subscription
- **AND** `registers.ts` is byte-identical (no code change)

#### R3: Overflow menu mirrors the new strip order
The `OverflowMenu` window rows SHALL be reordered to mirror the new strip order — **git → tmx → cwd** — each keeping its inverse breakpoint class (`git` `md:hidden`, `tmx` `lg:hidden`, `cwd` `xl:hidden`), so a row still renders exactly while its segment is dropped and the menu reads as the strip's continuation.

- **GIVEN** an 800px viewport (≥md, <900px, <lg, <xl)
- **WHEN** the `…` menu opens
- **THEN** the visible window rows are `tmx` then `cwd` (git's segment is visible in the strip so its row is hidden), with no `out` row, and focus enters on the first VISIBLE row (`tmx`)

#### R4: Comment framing updated
The three comment sites in `status-bar.tsx` that frame the order as status-pyramid-ordered MUST be rewritten to the new framing — display = descending relevance, **rightmost dies first**, survival semantics unchanged — and MUST drop every `out`/`useNow` reference: the file-header R5 ladder doc, the `WindowCluster` docstring ("Owns the leaf-scoped `useNow` clock…"), and the in-JSX survival-order comment. `docs/specs/status-pyramid.md` needs no edit (verified at intake: no status-bar display-order claim).

- **GIVEN** the updated file
- **WHEN** a reader consults the header doc, docstring, or JSX comment
- **THEN** the stated order matches the rendered order, no comment mentions `out` or a cluster clock, and the ladder is stated as "rightmost dies first"

#### R5: Tests conform to the new spec (same commit)
Unit `status-bar.test.tsx` and e2e `tests/e2e/status-bar.spec.ts` + its `.spec.md` companion MUST be updated in the same commit (Constitution: Test Companion Docs; Test Integrity — tests conform to spec): drop the `out` expectations (unit line ~86 `zsh`, menu-row assertion line ~240, ladder comment line ~262; e2e ~140 comment + any `out` menu expectations), retarget the e2e menu focus-walk to the new first-visible row order, and assert the new left-to-right strip order.

- **GIVEN** the updated implementation
- **WHEN** `just test-frontend` runs the status-bar unit suite and `just test-e2e "status-bar.spec.ts"` runs the e2e spec
- **THEN** both pass, with no assertion referencing an `out` segment or menu row

### Design Decisions

#### Branch-first left-edge anchor
**Decision**: The left cluster leads with the ⑂ git branch, then pr → fab → agt → tmx → cwd (relevance-descending).
**Why**: The branch is the stable anchor — always present in a worktree pane — so the left edge doesn't jump as the user switches between windows with and without a PR; it also pairs naturally with the PR segment beside it. Display order now equals survival order, collapsing the ladder to one rule: rightmost dies first.
**Rejected**: PR-first pure-relevance ordering — pr/fab/agt are volatile per-window segments (a window without a PR renders no `pr` segment), so leading with them makes the bar's left edge twitchy on window switches.
*Introduced by*: 260816-499u-status-bar-reorder-drop-out

#### `out` deleted, resolver retained
**Decision**: The `out` register leaves the status bar entirely (segment, menu row, and `WindowCluster`'s `useNow` clock); `getOutputLine` stays in `sidebar/registers.ts`.
**Why**: The line was not consulted in this compact surface and was the sole reason the whole cluster re-rendered every second. The PANE panel and row-flyout card remain the `out` surfaces, so the shared resolver stays.
**Rejected**: Demoting `out` (or `tmx`) to menu-only — the user explicitly kept `tmx` in the strip and deleted `out` outright rather than parking it one click away.
*Introduced by*: 260816-499u-status-bar-reorder-drop-out

## Tasks

### Phase 2: Core Implementation

- [x] T001 Reorder `WindowCluster` JSX in `app/frontend/src/components/status-bar.tsx` to ⑂ git → pr → fab → agt → tmx → cwd (markup/guards/breakpoint classes verbatim); delete the `out` `<Segment>`, the `useNow()` clock + `outLine` resolution, and the unused `useNow`/`getOutputLine` imports <!-- R1, R2 -->
- [x] T002 In `OverflowMenu` (`status-bar.tsx`): delete the `out` `textRow`; reorder the window rows to git → tmx → cwd keeping their inverse breakpoint classes <!-- R2, R3 -->
- [x] T003 Rewrite the three comment sites in `status-bar.tsx` (file-header R5 ladder doc, `WindowCluster` docstring, in-JSX survival comment) to the "display = descending relevance; rightmost dies first" framing with no `out`/`useNow` references <!-- R4 -->

### Phase 3: Integration & Edge Cases

- [x] T004 Update `app/frontend/src/components/status-bar.test.tsx`: drop the `out` expectations, rename/retarget the register-rendering test, assert the new strip order, fix the overflow-menu row expectations; run the suite via `just test-frontend` (scoped to status-bar) <!-- R5 -->
- [x] T005 Update `app/frontend/tests/e2e/status-bar.spec.ts` + `status-bar.spec.md`: drop `out` mentions, retarget the 800px menu focus-walk to the new first-visible row (`tmx`), keep the never-scroll assertion; run via `just test-e2e "status-bar.spec.ts"` <!-- R5 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: At ≥xl the left cluster renders ⑂ git → pr → fab → agt → tmx → cwd, each segment's guard and breakpoint class unchanged
- [x] A-002 R2: No `out` segment, menu row, `useNow` call, or `getOutputLine` import remains in `status-bar.tsx`; `sidebar/registers.ts` is unchanged
- [x] A-003 R3: Menu window rows are git → tmx → cwd with inverse breakpoint classes (`md:hidden`/`lg:hidden`/`xl:hidden`)

### Behavioral Correctness

- [x] A-004 R1: Drop thresholds preserved — cwd <xl, tmx <lg, git <md; agt/fab/pr never drop; right cluster untouched
- [x] A-005 R4: All three comment sites state the new order/framing; no comment claims status-pyramid display order or mentions `out`

### Scenario Coverage

- [x] A-006 R5: `status-bar.test.tsx` passes with order + absence assertions updated; no `out` expectation remains
- [x] A-007 R5: `status-bar.spec.ts` passes (never-scroll + menu focus-walk retargeted) and `status-bar.spec.md` mirrors the updated steps in the same commit

### Code Quality

- [x] A-008 Pattern consistency: New code follows naming and structural patterns of surrounding code; comments state constraints, not narration
- [x] A-009 No unnecessary duplication: Existing utilities reused; no re-derivation added (the bar stays a mirror, Constitution X)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change removed the `out` segment/menu-row/`useNow` clock itself; the shared symbols it stopped consuming (`useNow` in `app/frontend/src/hooks/use-now.ts`, `getOutputLine` in `app/frontend/src/components/sidebar/registers.ts`) remain live consumers via `status-panel.tsx` and `row-flyout-card.tsx`, so nothing else became redundant.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Menu row DOM order git → tmx → cwd means the 800px e2e focus-walk starts at `tmx` (git's row is breakpoint-hidden there) | Mechanical consequence of intake assumption #8 + the existing `checkVisibility()` filter; verified against the current spec's assertions | S:85 R:90 A:95 D:90 |
| 2 | Certain | Tests run through `just` recipes only (`just test-frontend`, `just test-e2e "status-bar.spec.ts"`), never raw runners | Project context mandates it (port isolation) | S:90 R:95 A:100 D:95 |
| 3 | Confident | The unit test's DOM-order assertion is added to the existing register-rendering test rather than a new test | Smallest diff satisfying R1's scenario; trivially reversible | S:60 R:90 A:80 D:75 |

3 assumptions (2 certain, 1 confident).
