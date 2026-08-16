# Plan: Unclip Bottom-Bar Safe Floor

**Change**: 260816-4v2o-unclip-bottom-bar-safe-floor
**Intake**: `intake.md`

## Requirements

### Bottom Bar: Frame Height

#### R1: The frame MUST accommodate the safe floor
The bottom-bar frame (`bottom-bar.tsx`, the div wrapping the toolbar row) MUST NOT clip the toolbar row's bottom padding: it SHALL use `min-h-[48px]` (content growth) instead of the fixed `h-[48px]`, so the coarse-pointer raised floor (`--bottom-bar-floor` = 1rem while the keyboard is collapsed) renders as visible screen gap below the chips. The frame stays inside `BottomBar` behind the single `if (!coarse || composeFocused) return null` predicate (the PR #598 no-reserved-height property is unchanged).

- **GIVEN** a coarse-pointer device with the on-screen keyboard collapsed
- **WHEN** the bottom bar renders
- **THEN** the frame is 61px tall (3px seam + 6px pt + 36px chips + 16px floor) and the chips' bottom edge sits ≥ 16px above the viewport bottom
- **AND** with `html.kb-open` set the frame relaxes to 51px (6px floor), never below 48px

#### R2: The e2e MUST assert rendered geometry, not only computed style
`bottom-bar-safe-floor.spec.ts` SHALL keep its computed `padding-bottom` assertions and ADD bounding-box assertions in the touch describe: keyboard collapsed → the gap between the toolbar's last chip's bottom edge and the viewport bottom is ≥ 16px; under `html.kb-open` → the gap is ≥ 6px and < 16px. This is the assertion class that detects frame clipping.

- **GIVEN** the touch describe (hasTouch, 375×812) on `/${TMUX_SERVER}`
- **WHEN** the geometry assertion measures `812 - boundingBox.bottom` of the last chip
- **THEN** it is ≥ 16 with the keyboard collapsed and in [6, 16) with `kb-open` set

#### R3: The `.spec.md` companion MUST document the new tests
Per the constitution's Test Companion Docs rule, `bottom-bar-safe-floor.spec.md` SHALL be updated in the same commit: what the geometry assertions prove (the floor is visible screen gap — a fixed frame height can silently swallow computed padding) and steps mirroring the test body.

- **GIVEN** the modified `.spec.ts`
- **WHEN** a reviewer reads the sibling `.spec.md`
- **THEN** every test's intent and steps match the spec file

### Design Decisions

#### Min-height frame over bare content sizing
**Decision**: Replace `h-[48px]` with `min-h-[48px]` on the frame.
**Why**: Pins today's 48px minimum so no state renders shorter than the current bar; the inner row's paddings already define the geometry, and the Shell `bottombar` grid row is `auto` so the terminal column absorbs the growth (xterm FitAddon re-fits on resize).
**Rejected**: Bare auto height (loses the 48px floor for no benefit); `h-[calc(...)]` mirroring the padding expression (duplicates the geometry in two places — drift-prone, the exact failure mode being fixed).
*Introduced by*: 260816-4v2o-unclip-bottom-bar-safe-floor

### Non-Goals

- No change to the floor values, the `kb-open` signal, or the `max(floor, env())` expression — they are correct; only the clipping frame is wrong.
- No change to fine-pointer behavior (the bar does not render there, 260814-ldbs).

## Tasks

### Phase 2: Core Implementation

- [x] T001 In `app/frontend/src/components/bottom-bar.tsx` change the frame class `h-[48px]` → `min-h-[48px]` (line ~376) and rewrite the frame comment (lines ~365–375) to state the min-height + content-growth contract and that a fixed height clips the safe floor <!-- R1 -->
- [x] T002 In `app/frontend/src/components/bottom-bar.test.tsx` update the coarse-pointer frame assertion (`toContain("h-[48px]")` → `toContain("min-h-[48px]")`, line ~371) and its comment <!-- R1 -->
- [x] T003 In `app/frontend/tests/e2e/bottom-bar-safe-floor.spec.ts` add bounding-box gap assertions to the touch describe: last-chip bottom vs viewport bottom ≥ 16 (collapsed), ≥ 6 and < 16 (`kb-open`); keep the computed-padding assertions <!-- R2 -->

### Phase 3: Integration & Edge Cases

- [x] T004 Update `app/frontend/tests/e2e/bottom-bar-safe-floor.spec.md` to document the geometry assertions (what they prove + steps), per the constitution's Test Companion Docs rule <!-- R3 -->
- [x] T005 [P] Sweep stale "48px frame" wording implying fixed height: call-site comments in `app/frontend/src/app.tsx` (~line 3666 area) and `app/frontend/src/components/board/board-page.tsx` (~line 991); leave `compose-strip.spec.ts`/`.spec.md` if their meaning (bar owns its frame) still holds <!-- R1 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: The frame uses `min-h-[48px]`; no fixed `h-[48px]` remains on the bottom-bar frame
- [x] A-002 R2: The touch describe asserts the rendered chip-to-viewport-bottom gap in both keyboard states
- [x] A-003 R3: `bottom-bar-safe-floor.spec.md` documents every test in the modified spec file with intent + steps

### Behavioral Correctness

- [x] A-004 R1: On coarse/collapsed the chips render ≥ 16px above the viewport bottom (verified by the new e2e assertion passing)

### Scenario Coverage

- [x] A-005 R1: `bottom-bar.test.tsx` and `bottom-bar-safe-floor.spec.ts` pass (unit via `just test-frontend`-scoped run, e2e via `just test-e2e "bottom-bar-safe-floor"`)

### Code Quality

- [x] A-006 Pattern consistency: comment updates state constraints (why fixed height must not return), no narration; existing test structure and helpers reused
- [x] A-007 No unnecessary duplication: geometry constants (RAISED_FLOOR/BASE_FLOOR) reused in the new assertions, not re-hardcoded

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)

## Deletion Candidates

- None — the fix replaces `h-[48px]` with `min-h-[48px]` in place on the one frame div; no existing file, symbol, branch, or config is left redundant or unused.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | The kb-open geometry band is asserted as `>= 6 && < 16` (chips 36px + 6px floor inside a 48px min frame leaves up to ~9px visible gap, still under the raised floor) | Derived from the box math; tolerant band avoids brittleness on sub-pixel rendering | S:70 R:90 A:80 D:75 |
| 2 | Confident | `compose-strip.spec.ts`'s dead-space assertion is unaffected (it measures footer-bottom minus strip-bottom while the bar is hidden) | Read the assertion; the bar's height is irrelevant when the bar is unmounted | S:75 R:90 A:85 D:85 |

2 assumptions (0 certain, 2 confident, 0 tentative).
