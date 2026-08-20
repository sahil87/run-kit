# Plan: Hover Card — Change Only

**Change**: 260817-kabi-hover-card-change-only
**Intake**: `intake.md`

## Requirements

### Registers: Data Shape

#### R1: `fab` and `pr` SHALL expose structured parts alongside their joined forms

`registers.ts` SHALL gain `getFabParts` and `getPrParts`. `getFabLine` and `getPrSegments` SHALL remain, reimplemented over the parts so their output is byte-identical. `getOutputLine` and `getAgentLine` SHALL NOT be modified.

- **GIVEN** a window whose `getFabLine` returns `"n927 branch-channel-draft-flag · review · active"`
- **WHEN** the parts resolver and the formatter are both in place
- **THEN** `getFabLine` returns that exact string
- **AND** `getFabParts` returns `{ id, slug, stage, displayState }` separately
- **AND** `getPrParts` returns null unless `win.prNumber` is set

#### R2: The PANE panel SHALL render byte-identically

`status-panel.tsx` is the other consumer and is out of scope for any visual change.

- **GIVEN** the PANE panel rendering a window with all four registers
- **WHEN** this change is applied
- **THEN** its rendered text is unchanged, character for character
- **AND** `status-panel.tsx` has no markup, class or import change

### Hover Card: Content

#### R3: The card SHALL render `fab` and `pr` only

`WindowFlyoutContent` SHALL no longer render the `dotLabel` line, the `out` register, or the `agt` register. The `dotLabel` and `statusDotState` imports SHALL be removed if unused. `dotLabel` SHALL remain exported and remain the status dot's accessible name.

- **GIVEN** a window with an agent, a fab change and a PR
- **WHEN** the card opens
- **THEN** the body contains only the `fab` and `pr` registers and their continuation lines
- **AND** no line restates the status dot's label
- **AND** the status dot's `aria-label` is unchanged

#### R4: The card SHALL use no group headings

- **GIVEN** any window
- **WHEN** the card opens
- **THEN** no heading element separates the body's lines

#### R5: Critical tokens SHALL lead; long values SHALL continue on an indented line

A `ContinuationLine` element SHALL render at `pl-[4ch]` in `text-text-secondary`.

- **GIVEN** a fab change `n927`, slug `branch-channel-draft-flag`, stage `review`, display state `active`
- **WHEN** the card renders it in a 320&nbsp;px card (~42 characters)
- **THEN** the first line reads `n927 · review · active` and is not truncated
- **AND** the slug renders on a continuation line indented to the prefix column

#### R6: The PR register SHALL split identity from health

- **GIVEN** a PR that is open, draft, checks pending, changes requested
- **WHEN** the card renders it
- **THEN** the identity line reads `#540 · open (draft) ↗` and the health segments render on a continuation line as plain text
- **AND** the identity line remains one anchor with its existing `href`, `target`, `rel`, `title`, `aria-label`, segment colours and `stopPropagation`

#### R7: Freshness SHALL render only inside the PR group

- **GIVEN** a window with `prFetchedAt` and no `prNumber`
- **WHEN** the card opens
- **THEN** no freshness line renders
- **GIVEN** a window with both
- **THEN** freshness renders as a continuation line under the PR block

#### R8: The card SHALL render no body when there is no change and no PR

- **GIVEN** a plain shell pane — no fab change, no PR
- **WHEN** the card opens
- **THEN** the card contains its title bar and its action rows and no body block
- **GIVEN** an agent window with no change and no PR
- **THEN** the same — no body

#### R9: A bare PR URL SHALL NOT count as content

- **GIVEN** a window with `prUrl` set and no `prNumber`
- **WHEN** the card opens
- **THEN** no `pr` line renders, and if there is also no fab change the card renders no body

#### R10: Session and server card tiers SHALL be unaffected

- **GIVEN** the coarse-pointer session and server cards
- **WHEN** this change is applied
- **THEN** their content renders exactly as before

### Verification

#### R11: Tests SHALL cover the new shape without running the e2e suite

Unit coverage SHALL be added. The e2e spec SHALL be updated so it does not assert on removed content, and its sibling `.spec.md` SHALL be updated in the same commit. The e2e suite SHALL NOT be executed in this environment.

- **GIVEN** the change is applied
- **WHEN** `npx tsc --noEmit` and `just test-frontend` run
- **THEN** both pass
- **AND** `row-flyout.spec.ts` contains no assertion on the removed lines
- **AND** `row-flyout.spec.md` matches it

### Non-Goals

- The PANE panel's appearance, layout, or its `260723-fm08` prefix tooltips.
- `getOutputLine` / `getAgentLine` — untouched; the card simply stops calling them.
- The status dot and `dotLabel`'s export.
- Chips or a stage rail.
- The card's surface, elevation, action rows or tray (shipped in #643).
- Running the e2e suite — the harness backend currently 502s on board API calls and fails ~91 unrelated specs.

### Design Decisions

#### The card says only what the row cannot

**Decision**: render `fab` and `pr` only; drop the status label, `out` and `agt`.
**Why**: the row already carries the window name, the status dot (idle / active / waiting / stage), the PR glyph and the colour label. The dropped lines restate the dot; the two facts they add — the command name and an exact duration — are not worth a panel on their own, and they were pushing the two registers that carry information the row cannot into truncation.
**Rejected**: keeping `out`/`agt` but trimming their wording (still repetition, just shorter); a single merged line (loses the register vocabulary the PANE panel shares).
*Introduced by*: 260817-kabi-hover-card-change-only

#### Parts resolvers for two registers, not four

**Decision**: add `getFabParts` and `getPrParts` only; leave `getOutputLine` and `getAgentLine` untouched.
**Why**: `registers.ts` serves this card and the PANE panel, and its module doc commits to one source, no drift. The card composes only two registers now, so only those two need structured forms. Adding parts forms for the other two would be unused code and would put a second surface at risk for no gain.
**Rejected**: parts forms for all four (unused code, needless blast radius); reordering the joined strings directly (silently restyles the PANE panel).
*Introduced by*: 260817-kabi-hover-card-change-only

#### Continuation lines rather than truncation

**Decision**: long values move to an indented `pl-[4ch]` line in `text-text-secondary`.
**Why**: the card is ~42 characters wide; the fab line needs 43 and the widest PR line 68. Truncation is unavoidable somewhere, so the layout should choose what gets cut — decisive tokens first, expendable text on its own line where cutting is harmless. `4ch` matches the existing 4-advance prefix column, keeping the monospace grid intact.
**Rejected**: widening the card (the coarse arm caps width against the 56&nbsp;px status rail); a smaller font (breaks the grid shared with the terminal).
*Introduced by*: 260817-kabi-hover-card-change-only

## Tasks

### Phase 1: Data shape

- [x] T001 Add `getFabParts` + `FabParts` and `getPrParts` + `PrParts` to `app/frontend/src/components/sidebar/registers.ts`; `getPrParts` returns null unless `win.prNumber` <!-- R1 -->
- [x] T002 Reimplement `getFabLine` and `getPrSegments` as formatters over the parts, preserving byte-identical output; leave `getOutputLine` / `getAgentLine` untouched <!-- R1 -->
- [x] T003 Extend `registers.test.ts` to pin formatter output against the current strings and cover both parts resolvers <!-- R1 -->

### Phase 2: Card content

- [x] T004 Add a `ContinuationLine` element to `row-flyout-card.tsx` (`pl-[4ch]`, `text-text-secondary`, truncating) <!-- R5 -->
- [x] T005 Remove the `dotLabel` body line, the `out` register and the `agt` register from `WindowFlyoutContent`; drop `dotLabel` / `statusDotState` / `getOutputLine` / `getAgentLine` imports if unused <!-- R3 -->
- [x] T006 Recompose `fab` as `id · stage · displayState` with the slug on a continuation line <!-- R5 -->
- [x] T007 Recompose `pr` as an anchored identity line with health segments on a plain-text continuation line, preserving all anchor attributes and colours <!-- R6 -->
- [x] T008 Gate `FreshnessLine` on the `pr` register and render it as a continuation line <!-- R7 -->
- [x] T009 Render no body block when `getFabParts` and `getPrParts` are both null, and treat a bare `prUrl` with no `prNumber` as no content <!-- R8 -->

### Phase 3: Verification

- [x] T010 Confirm `status-panel.tsx` is unmodified and its register text is byte-identical <!-- R2 -->
- [x] T011 Confirm the session and server card tiers render unchanged <!-- R10 -->
- [x] T012 Extend `row-flyout-card.test.tsx`: no-body case, removed lines, continuation lines, freshness gating, bare-`prUrl` suppression, widest PR state <!-- R11 -->
- [x] T013 Update `tests/e2e/row-flyout.spec.ts` so no assertion references removed content, and update `tests/e2e/row-flyout.spec.md` in the same commit. **Do not run the e2e suite.** <!-- R11 -->

### Phase 4: Gates

- [x] T014 Run `npx tsc --noEmit`, `PNPM_CONFIG_STRICT_DEP_BUILDS=false just test-frontend`, and `npx vite build`. No e2e. <!-- R11 -->

## Execution Order

- T001 blocks T002; T002 blocks T003
- T004 blocks T006–T009
- T010 and T011 verify untouched surfaces and may run alongside T012
- T014 runs last

## Acceptance

### Functional Completeness

- [x] A-001 R1: `getFabParts` and `getPrParts` exist; `getFabLine` and `getPrSegments` are formatters over them
- [x] A-002 R3: The card body contains no status label, no `out` and no `agt`
- [x] A-003 R5: The fab register leads with `id · stage · displayState` and carries the slug on a continuation line
- [x] A-004 R6: The PR register splits identity from health, anchor behaviour and colours preserved
- [x] A-005 R7: Freshness renders only when the `pr` register renders
- [x] A-006 R8: A window with no change and no PR renders no body block
- [x] A-007 R9: A bare `prUrl` with no `prNumber` renders no `pr` line

### Behavioral Correctness

- [x] A-008 R2: The PANE panel's rendered register text is byte-identical, with `status-panel.tsx` unmodified
- [x] A-009 R1: `getOutputLine` and `getAgentLine` are unchanged in `registers.ts`
- [x] A-010 R3: `dotLabel` is still exported and still the status dot's `aria-label`
- [x] A-011 R10: Session and server cards render unchanged
- [x] A-012 R5: With a 25-character slug the fab first line is not truncated at 320&nbsp;px

### Scenario Coverage

- [x] A-013 R8: A unit test covers the plain-shell case and asserts no body block
- [x] A-014 R6: A unit test covers the widest PR state (open, draft, checks pending, changes requested)
- [x] A-015 R11: `tsc --noEmit`, `just test-frontend` and the production build pass (e2e spec updated by reading, not executed — harness 502s, per plan)

### Edge Cases & Error Handling

- [x] A-016 R7: `prFetchedAt` with no `prNumber` renders no freshness line
- [x] A-017 R9: `prUrl` with no `prNumber` and no fab change renders no body at all
- [x] A-018 R5: A fab change with no slug renders no empty continuation line
- [x] A-019 R8: On the coarse arm, where `size()` caps width against the 56&nbsp;px rail, a body-less card still renders correctly (the no-body branch lives in the shared `WindowFlyoutContent` both arms render; the width-capping shell is untouched)

### Code Quality

- [x] A-020 Pattern consistency: new elements follow the card's existing composition and Tailwind idiom
- [x] A-021 No unnecessary duplication: the card composes from the shared resolvers rather than re-deriving facts
- [x] A-022 Tests accompany the change: every changed behaviour has unit coverage
- [x] A-023 No comment narration: comments state constraints the code cannot show; none narrates the next line, addresses the reviewer, or cites a change ID or PR number
- [x] A-024 Test companion docs: `row-flyout.spec.md` is updated in the same commit as `row-flyout.spec.ts`
- [x] A-025 Render performance: no new clock, subscription or lifted state; the card still mounts only while open
- [x] A-026 Dead code: no unused imports or resolvers left behind after the card stops calling them

## Notes

- Check items as you review: `- [x]`
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`
- `just test-frontend` needs the `PNPM_CONFIG_STRICT_DEP_BUILDS=false` prefix under pnpm 11
- **Do not run the e2e suite.** Its backend currently 502s and fails ~91 unrelated specs. Update the spec; do not execute it.
- Go is not on PATH; use `npx vite build` for the production check and do not install a toolchain

## Deletion Candidates

- None — the card stopped calling `getOutputLine` / `getAgentLine` / `dotLabel` / `statusDotState`, but every one of them retains a live consumer (the PANE panel and `status-dot.tsx`), so this change makes no existing code redundant

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Only `fab` and `pr` gain parts resolvers | They are the only registers the card composes; parts forms for the other two would be unused code touching a second surface for no gain | S:80 R:85 A:90 D:85 |
| 2 | Certain | A body-less card renders no wrapper element, not an empty one | An empty flex container would still contribute the card's `gap`, leaving a visible dead strip between title bar and actions | S:75 R:90 A:90 D:90 |
| 3 | Confident | Continuation lines indent to `pl-[4ch]` | Matches the existing 4-advance prefix column so the monospace grid holds | S:65 R:90 A:85 D:80 |
| 4 | Confident | The PR anchor wraps the identity line only | Keeps the click target one visual row; a two-row anchor is unpredictable to click and to focus | S:60 R:85 A:80 D:75 |
| 5 | Confident | The e2e spec is updated but not run | The user asked for no e2e, and the harness fails ~91 unrelated specs on a 502 backend. Leaving the spec asserting removed content would be worse than either | S:80 R:80 A:85 D:80 |
| 6 | Confident | The card's health line drops the register's `review: ` lead (`checks pending · changes requested`) | The intake's worked examples — the shape the user approved — read without the prefix; the PANE panel keeps the full `review: …` segment text via the unchanged formatter, so only the card's plain-text rendering abbreviates | S:60 R:80 A:80 D:75 |

6 assumptions (2 certain, 4 confident, 0 tentative).
