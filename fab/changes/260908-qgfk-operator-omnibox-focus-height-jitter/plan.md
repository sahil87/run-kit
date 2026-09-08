# Plan: Operator Omnibox Focus Height Jitter

**Change**: 260908-qgfk-operator-omnibox-focus-height-jitter
**Intake**: `intake.md`

## Requirements

### Operator Console: Top-Bar Omnibox Sizing

#### R1: Fixed box height across rest and engaged states
The `OperatorOmnibox` standing box MUST render at the same height whether the
console machine is at `rest` or `engaged` (focused/open), so focusing or
blurring it never reflows the shared top-bar row.

- **GIVEN** the box is at rest (not focused, machine `rest`)
- **WHEN** the user presses ⌘J or otherwise focuses the box (machine transitions to `engaged`)
- **THEN** the box's rendered height is unchanged, and the top-bar row does not resize

#### R2: Compact context-chip fits the fixed box height
The `OperatorContextChip`'s dismiss (`✕`) control MUST NOT force the omnibox
box taller than its fixed height (R1) when a chat-subject context is attached
and the chip mounts inside the box.

- **GIVEN** a chat subject is attached and the console engages (the chip mounts via `compact`)
- **WHEN** the chip renders inside the fixed-height box
- **THEN** the chip (including its dismiss button) fits within the box's interior without visual overflow
- **AND** the chip's non-`compact` mount (the compose-strip route) keeps its existing fine-pointer tap-target floor unchanged

### Design Decisions

#### Fix at the box level, not the row level
**Decision**: Pin the omnibox box's own height to the existing shared bar
control-height convention (`h-[28px]`, matching `--ctl-h-bar` in
`src/globals.css` / `components/control.tsx`) rather than inflating the row or
the rest-state box to match the occasional chip-attached case.
**Why**: The top bar already has an established fixed-height vocabulary used
by crumbs and icon buttons; reusing it keeps the box visually consistent with
its row neighbors without introducing a second sizing convention, and avoids
permanently taller idle chrome for the common case where no chat-subject chip
is attached.
**Rejected**: Growing the *rest* state to match the tallest possible
engaged-with-chip height — this would add ~8px of empty vertical space around
the box in its far more common (no chip) idle appearance, and would sit
awkwardly against the crumbs' own 28px box height (whose box height is
independent of the row).
*Introduced by*: 260908-qgfk-operator-omnibox-focus-height-jitter

#### Compact-only dismiss-button floor
**Decision**: Scope the `OperatorContextChip` dismiss button's fine-pointer
`min-w-[24px] min-h-[24px]` floor to the non-`compact` mount only; the
`compact` (omnibox) mount drops the floor and sizes to content (matching the
box's other 16px-line-height children). The `coarse:` 40px touch floor is
unchanged in both mounts.
**Why**: `compact` already exists on this component specifically to
distinguish the slim omnibox mount from the roomier compose-strip mount, so
scoping the floor removal to it is a natural, minimal extension of an
existing seam rather than a new mechanism. Fine-pointer users (mouse/trackpad)
lose no real affordance — the button still renders at the same visual size as
its icon/input siblings — and real touch/coarse-pointer accessibility is
untouched.
**Rejected**: Growing the box's fixed height to accommodate the 24px floor
unconditionally (would require ~30-36px, taller than the row's other
controls) — rejected per the Design Decision above.
*Introduced by*: 260908-qgfk-operator-omnibox-focus-height-jitter

## Tasks

### Phase 2: Core Implementation

- [x] T001 Fix `OperatorOmnibox` box wrapper className in `app/frontend/src/components/operator-omnibox.tsx`: replace `py-0.5` with `h-[28px]`, applied identically in both the `engaged` and rest branches <!-- R1 -->
- [x] T002 Scope `OperatorContextChip`'s dismiss button fine-pointer floor to non-`compact` mounts in `app/frontend/src/components/operator-context-chip.tsx`, leaving `coarse:min-w-[40px] coarse:min-h-[40px]` unconditional <!-- R2 -->

### Phase 3: Integration & Edge Cases

- [x] T003 Add a test assertion in `app/frontend/src/components/operator-omnibox.test.tsx` (`≥ lg rung` rest test and the chord-engage/focus tests) that the box className contains `h-[28px]` in both rest and engaged states <!-- R1 -->
- [x] T004 Add a test in the "templated chat lane" describe block of `app/frontend/src/components/operator-omnibox.test.tsx` asserting the chip's dismiss button className does not contain `min-h-[24px]`/`min-w-[24px]` when rendered inside the (compact) omnibox <!-- R2 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: `OperatorOmnibox`'s box renders `h-[28px]` in both `rest` and `engaged` states (verified by test and by a throwaway Playwright box-model harness — row/box height held constant at 28px across states)
- [x] A-002 R2: `OperatorContextChip`'s dismiss button drops its 24px fine-pointer floor only when `compact`; the compose-strip (non-compact) mount is unaffected

### Behavioral Correctness

- [x] A-003 R1: Focusing/blurring the omnibox (⌘J open/close, or plain focus/blur) no longer changes the box's rendered height — confirmed via box-model arithmetic and a Playwright harness reproducing the exact Tailwind classes (28px held constant; chip content 22px and dismiss button 16px fit inside the interior with no overflow)

### Edge Cases & Error Handling

- [x] A-004 R2: With a chat-subject attached (the chip-mounted case — the scenario that originally exposed the jitter), the box still holds at 28px with no visual overflow of the chip or its dismiss button

### Code Quality

- [x] A-005 Pattern consistency: The fix reuses the existing `--ctl-h-bar` (28px) shared bar control-height convention already used by top-bar crumbs/icon buttons, rather than introducing a new sizing constant
- [x] A-006 No unnecessary duplication: No new component, constant, or utility introduced — both edits are className-only changes to existing elements
- [x] A-007 Tests cover the changed behavior: `operator-omnibox.test.tsx` asserts the fixed height in both states and the chip's narrowed dismiss-button floor (T003, T004)

## Notes

- Check items as you review: `- [x]`
- Implementation was written and verified (existing suites green: `operator-omnibox.test.tsx` 19, `compose-strip.test.tsx` 127, `top-bar.test.tsx` 120) before this plan/intake were generated; T003/T004 add the two missing regression assertions guarding the specific fix.

## Deletion Candidates

- None — this change fixes existing layout behavior without making existing code redundant.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Add regression assertions (T003/T004) to the existing `operator-omnibox.test.tsx` rather than a new test file | The file already has both the rest/engaged rendering harness and a "templated chat lane" describe block with a chat-subject fixture — extending it is the natural, minimal-footprint place for these assertions | S:75 R:95 A:100 D:95 |

1 assumption (1 certain, 0 confident, 0 tentative).
