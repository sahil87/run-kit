# Plan: Delete Inert WindowHeading Prefix-Flip Replay Machinery

**Change**: 260719-a2ss-delete-inert-prefix-flip-replay
**Intake**: `intake.md`

## Requirements

### Frontend: WindowHeading sweep choreography

#### R1: The inert prefix-flip replay machinery MUST be removed
The `prevPrefixRef` declaration (with its explanatory comment block) and the prefix-keyed `useEffect` (with its comment) in `WindowHeading` (`app/frontend/src/components/top-bar.tsx`) SHALL be deleted. They implement a lens-switch replay path that can never fire — the sole call site passes the module constant `WINDOW_PREFIX` (`const WINDOW_PREFIX = "Window:"`), so `prefix !== prevPrefixRef.current` is unsatisfiable after mount.

- **GIVEN** `WindowHeading` is only ever rendered with `prefix={WINDOW_PREFIX}` (a compile-time constant)
- **WHEN** the component mounts and re-renders
- **THEN** `prevPrefixRef` and the prefix-keyed effect are absent from the source
- **AND** no other reader of `prevPrefixRef` remains (compile-proven by `tsc --noEmit`)

#### R2: The `prefix` prop and `WINDOW_PREFIX` constant MUST be retained
The `prefix` prop on `WindowHeading` and the module-level `WINDOW_PREFIX` constant SHALL remain — they feed `useBootSweep(prefix, name, ...)` rendering and the `HeadingPrefix`/caret composition. Only the flip-*replay* machinery is inert.

- **GIVEN** the boot sweep runs over `prefix + " " + name`
- **WHEN** the component renders
- **THEN** `prefix` is still a declared prop consumed by `useBootSweep`, and `WINDOW_PREFIX` is still passed at the call site
- **AND** the rendered heading is byte-identical to before (no behavior change)

#### R3: The stale `prefix` prop docstring MUST be corrected to present truth
The `prefix` prop's docstring (currently claiming it "follows the active lens (spec R4)" and that a prefix change "replays the sweep just like a name change") SHALL be replaced with a docstring reflecting present truth: the prefix is the static `Window:` constant in every lens (the lens-following prefix was retired by 260714-uco1), and the boot sweep renders over `prefix + " " + name`. No replay-on-change claim.

- **GIVEN** the lens-following `Terminal:`/`Web:`/`Chat:` prefix was retired by 260714-uco1
- **WHEN** a future reader reads the `prefix` prop docstring
- **THEN** the docstring describes a static `Window:` prefix and the `prefix + " " + name` render, with no replay-on-flip claim

### Non-Goals

- The name-keyed effect, identity-change guard, mount-replay seeding, and all other sweep choreography — untouched.
- Any test edits — no test passes `prefix=` or exercises a prefix flip; existing sweep/rename tests must keep passing unchanged.
- Removing the `prefix` prop or `WINDOW_PREFIX` constant — explicitly retained (R2).

## Tasks

### Phase 1: Core Implementation

- [x] T001 Delete the `prevPrefixRef` declaration and its comment block (~:1394-1400) in `app/frontend/src/components/top-bar.tsx` <!-- R1 -->
- [x] T002 Delete the prefix-keyed `useEffect` and its comment (~:1451-1461) in `app/frontend/src/components/top-bar.tsx` <!-- R1 -->
- [x] T003 Correct the stale `prefix` prop docstring (~:1358-1360) in `app/frontend/src/components/top-bar.tsx` to present truth (static `Window:` constant; boot sweep over `prefix + " " + name`; no replay-on-change claim) <!-- R3 -->

### Phase 2: Verification

- [x] T004 Confirm the `prefix` prop and `WINDOW_PREFIX` constant remain (retained per R2) <!-- R2 -->
- [x] T005 Run `cd app/frontend && pnpm exec tsc --noEmit` (compile-proves `prevPrefixRef` had no other readers) <!-- R1 -->
- [x] T006 Run `just test-frontend` (WindowHeading sweep/rename suite in `top-bar.test.tsx` must pass unchanged) <!-- R1 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: `prevPrefixRef` and the prefix-keyed effect (plus their comments) are absent from `top-bar.tsx`; no `prevPrefixRef` references remain
- [x] A-002 R2: The `prefix` prop is still declared and consumed by `useBootSweep`; `WINDOW_PREFIX` is still defined and passed at the sole call site
- [x] A-003 R3: The `prefix` prop docstring reflects present truth (static `Window:`, `prefix + " " + name` render, no replay-on-flip claim)

### Behavioral Correctness

- [x] A-004 R2: No behavior change — the deleted path was unreachable; the rendered heading is unchanged

### Removal Verification

- [x] A-005 R1: `tsc --noEmit` passes, compile-proving `prevPrefixRef` had no other readers (no dead references)

### Scenario Coverage

- [x] A-006 R1: `just test-frontend` passes — the WindowHeading sweep/rename suite in `top-bar.test.tsx` is green unchanged (no test edits)

### Code Quality

- [x] A-007 Pattern consistency: The remaining sweep effects and comments read coherently after the deletion (no orphaned references, no misleading comments left behind)
- [x] A-008 **N/A**: deletion-only change, no new code introduced

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | The prefix-keyed effect is unreachable; delete ref + effect + comments | Sole call site passes the module constant `WINDOW_PREFIX`; grep confirms `prevPrefixRef` is only read by the effect being deleted; 260714-uco1 retired the lens-following prefix | S:90 R:90 A:95 D:95 |
| 2 | Certain | Keep the `prefix` prop and `WINDOW_PREFIX` constant | They feed `useBootSweep` rendering and the caret composition — only the flip-replay machinery is dead | S:85 R:90 A:95 D:90 |
| 3 | Confident | Correct the stale prop docstring in the same change | The docstring describes the exact behavior being deleted; leaving it recreates the misleading-comment problem the deletion solves; trivially reversible | S:70 R:95 A:90 D:85 |

3 assumptions (2 certain, 1 confident, 0 tentative).
