# Plan: Breadcrumb Coarse-Pointer Touch Height Fix

**Change**: 260907-ibst-breadcrumb-coarse-touch-height
**Intake**: `intake.md`

## Requirements

### TopBar: Breadcrumb Coarse-Pointer Height Parity

#### R1: Breadcrumb crumb boxes MUST match the app's 40px coarse-touch floor
`CRUMB_BOX_CLASS` in `app/frontend/src/components/top-bar.tsx` SHALL use the
same coarse-pointer minimum height as every other top-bar control constant
(`TOP_BAR_BUTTON_BASE`, `TOP_BAR_BUTTON_H`, `TOP_BAR_SEGMENT_H`, `WIDE_BTN_BASE`
in `app/frontend/src/components/control.tsx`), which is `40px` — the value of
`--ctl-h-bar-coarse` (`app/frontend/src/globals.css:99`) and the value
documented as canonical in `docs/memory/run-kit/ui/visual-design.md:111`.

- **GIVEN** a coarse-pointer (touch) device such as an iPad
- **WHEN** the top bar renders its breadcrumb (brand "RunKit" crumb, server
  crumb, session crumb — all three share `CRUMB_BOX_CLASS`)
- **THEN** each crumb box's rendered height is 40px, matching the sidebar
  toggle and history back/forward arrows rendered in the same row
- **AND** on a fine pointer (mouse), the crumb box height remains unchanged
  at 28px (no regression to the fine-pointer path)

#### R2: The doc comment above `CRUMB_BOX_CLASS` MUST accurately state the coarse height and follow the lockstep-comment convention
The comment block directly above `CRUMB_BOX_CLASS` (currently `top-bar.tsx:280-283`)
incorrectly states "28px fine / 30px coarse". It SHALL be corrected to state
"28px fine / 40px coarse", and the constant's own trailing line SHALL carry the
same `// lockstep: --ctl-h-bar (fine) / --ctl-h-bar-coarse` marker every other
constant sharing this token carries in `control.tsx` (`TOP_BAR_BUTTON_BASE`,
`TOP_BAR_BUTTON_H`, `TOP_BAR_SEGMENT_H`, `WIDE_BTN_BASE`) — `top-bar.tsx` is the
one file in this token's fan-out with no lockstep marker, which is the likely
reason the 30px drift went unnoticed.

- **GIVEN** a future edit to `--ctl-h-bar-coarse` in `globals.css`
- **WHEN** a developer greps for `--ctl-h-bar-coarse` to find every constant
  that must change in lockstep
- **THEN** `CRUMB_BOX_CLASS` in `top-bar.tsx` is one of the results (it
  currently is not)

### Non-Goals

- No change to the fine-pointer crumb height (`min-h-[28px]`) — only the
  coarse value is wrong.
- No change to `control.tsx`'s constants — they already correctly mirror
  `--ctl-h-bar-coarse`; this change brings `CRUMB_BOX_CLASS` into alignment
  with them, not the reverse.
- No change to the center `WindowHeading`/`PageHeadingDisplay` heading's
  `coarse:min-h-[30px]` (`top-bar.tsx:2068`, `2145`, `2163`) — that is a
  separate, explicitly-commented design choice for the center "mobile leaf"
  heading (confirmed against `fab/project/context.md`'s Mobile Responsive
  Design section, which documents it as intentional), not part of this bug
  report. Changing it is out of scope for this fix and was not what the user
  reported (the top-LEFT breadcrumb specifically).
- No change to crumb width/truncation/collapse logic (`max-w-[16ch]`,
  `max-w-[6ch]` probe floor, `lib/crumb-collapse.ts` hysteresis) — verified
  correct at all real iPad breakpoints during investigation (Chromium +
  WebKit, 656-1366px, both orientations); unrelated to the height regression.
- No update to `fab/project/context.md`'s stale "top-bar button controls ...
  30x30px on coarse" paragraph — it predates the current `control.tsx`
  Control-primitive token architecture (which now docs correctly, at
  `docs/memory/run-kit/ui/visual-design.md:111`, as 40px) and is a
  pre-existing documentation-debt item unrelated to this bug's fix; touching
  it is a separate, larger doc-consolidation task outside this change's
  narrow scope.

### Design Decisions

#### Fix only the value + comment, not the structure
**Decision**: Change exactly one Tailwind arbitrary-value token
(`coarse:min-h-[30px]` → `coarse:min-h-[40px]`) and correct/extend the
adjacent doc comment; leave `CRUMB_BOX_CLASS`'s other properties (fine height,
border, padding, color) untouched.
**Why**: The constant's structure and every other value are already correct
and already consistent with the rest of the top bar — only the one coarse
value drifted from the documented `--ctl-h-bar-coarse` token. A minimal,
mechanical fix is lower-risk than any restructuring and directly addresses
the reported symptom (a visibly short breadcrumb on iPad).
**Rejected**: Introducing a new shared constant/token that both `control.tsx`
and `top-bar.tsx` import, to structurally prevent future drift. Rejected as
out of scope for a bug-fix change — the lockstep-comment convention already
exists precisely to make this kind of drift greppable/catchable in review,
and adding a new shared abstraction is a refactor, not this fix.
*Introduced by*: 260907-ibst-breadcrumb-coarse-touch-height

## Tasks

### Phase 2: Core Implementation

- [x] T001 Fix `CRUMB_BOX_CLASS` in `app/frontend/src/components/top-bar.tsx` (currently line 289): change `coarse:min-h-[30px]` to `coarse:min-h-[40px]`. <!-- R1 -->
- [x] T002 Correct the doc comment above `CRUMB_BOX_CLASS` (currently `top-bar.tsx:280-283`): change "28px fine / 30px coarse" to "28px fine / 40px coarse", and append the `// lockstep: --ctl-h-bar (fine) / --ctl-h-bar-coarse` trailing marker to the `CRUMB_BOX_CLASS` constant line itself (matching the convention on `TOP_BAR_BUTTON_BASE`/`TOP_BAR_BUTTON_H`/`TOP_BAR_SEGMENT_H`/`WIDE_BTN_BASE` in `control.tsx`). <!-- R2 -->

### Phase 3: Integration & Edge Cases

- [x] T003 Update the existing test `"renders the session crumb as a static boxed chip — no caret, no menu (260813-kvk7)"` in `app/frontend/src/components/top-bar.test.tsx` (currently around line 713-733): the assertion at line 724 (`expect(chip).toHaveClass("rounded", "border", "border-border", "min-h-[28px]")`) SHALL also assert `"coarse:min-h-[40px]"`, mirroring the existing coarse-height assertion pattern used for the sidebar toggle (`top-bar.test.tsx:438-439`) and the settings gear (`top-bar.test.tsx:517`). This is the regression test for R1 — it fails against the pre-fix `coarse:min-h-[30px]` value and passes once T001 lands. <!-- R1 -->

## Execution Order

- T001 and T002 both edit the same few lines in `top-bar.tsx` — do them together in one pass, not as separately-committed steps.
- T003 depends on T001 (the class value the test asserts must exist first, or the test is written against the not-yet-fixed code and would need re-running anyway); run T001+T002 before T003.

## Acceptance

### Functional Completeness

- [x] A-001 R1: `CRUMB_BOX_CLASS`'s coarse minimum height is `40px` (`coarse:min-h-[40px]`), verified by reading `app/frontend/src/components/top-bar.tsx`.
- [x] A-002 R2: The doc comment above `CRUMB_BOX_CLASS` states "28px fine / 40px coarse" (not "30px coarse"), and the constant carries the `// lockstep: --ctl-h-bar (fine) / --ctl-h-bar-coarse` trailing comment.

### Behavioral Correctness

- [x] A-003 R1: The fine-pointer crumb height is unchanged at `min-h-[28px]` — no regression to non-touch rendering.
- [x] A-004 R1: `npx tsc --noEmit` passes in `app/frontend/` (per code-quality.md's verification gate) — a Tailwind arbitrary-value string edit cannot itself break type-checking, but this confirms no adjacent syntax error was introduced.

### Scenario Coverage

- [x] A-005 R1: `app/frontend/src/components/top-bar.test.tsx`'s updated session-crumb test (T003) passes, asserting `coarse:min-h-[40px]` on the crumb chip.
- [x] A-006 R1: The full `top-bar.test.tsx` suite passes (`cd app/frontend && npx vitest run src/components/top-bar.test.tsx`), confirming no other test's assumptions about `CRUMB_BOX_CLASS`'s coarse height (e.g., the existing fine-pointer-only assertion this change extends) regress.

### Code Quality

- [x] A-007 Pattern consistency: The fixed `CRUMB_BOX_CLASS` and its comment follow the exact lockstep-marker convention already used by `TOP_BAR_BUTTON_BASE`/`TOP_BAR_BUTTON_H`/`TOP_BAR_SEGMENT_H`/`WIDE_BTN_BASE` in `control.tsx`.
- [x] A-008 No unnecessary duplication: No new constant or abstraction introduced — the existing `CRUMB_BOX_CLASS` constant is corrected in place, reusing the app's existing `--ctl-h-bar-coarse` token semantics rather than inventing a new one.

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change corrects a class value and its doc comment in place plus one test assertion; no existing file, symbol, or block is made redundant or unused.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Scope the fix to `CRUMB_BOX_CLASS` only, excluding the center heading's own `coarse:min-h-[30px]` (top-bar.tsx:2068/2145/2163) | The center heading's 30px is separately, explicitly commented as intentional ("matches the top-bar control convention") and documented in fab/project/context.md as a deliberate choice for the mobile-leaf rename affordance; the user's report was specifically about the top-LEFT breadcrumb, not the center heading | S:90 R:95 A:90 D:85 |
| 2 | Certain | Add the missing lockstep trailing comment to `CRUMB_BOX_CLASS` as part of this fix (T002) rather than a separate change | It is a one-line addition directly adjacent to the value being fixed, and its absence is plausibly why the drift went unnoticed for however long CRUMB_BOX_CLASS predated the 40px migration; bundling it costs nothing and closes the gap that let this bug happen | S:85 R:95 A:90 D:85 |
| 3 | Certain | Do not update `fab/project/context.md`'s stale 30px-era paragraph in this change | It's pre-existing documentation debt describing an architecture that predates the current `control.tsx` Control-primitive tokens (confirmed stale against live-measured 40px behavior and against docs/memory's canonical 40px); fixing it is a larger doc-consolidation task, not a "single class constant" bug fix | S:80 R:90 A:80 D:80 |

3 assumptions (3 certain, 0 confident, 0 tentative).
