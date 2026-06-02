# Plan: Pane Panel Spinner Animations

**Change**: 260416-a5ug-pane-panel-spinner-animations
**Status**: In Progress
**Intake**: `intake.md`
**Spec**: `spec.md`

## Tasks

## Phase 1: Core Implementation

- [ ] T001 Create `app/frontend/src/components/braille-snake.tsx` — `BrailleSnake` component with frames `⣾⣽⣻⢿⡿⣟⣯⣷` at 80ms, same pattern as `block-pulse.tsx`
- [ ] T002 Add `BrailleSnake` import and render in `app/frontend/src/components/sidebar/status-panel.tsx` — insert spinner with `text-accent` class before agent state text in the `agt` line

## Phase 2: Verification

- [ ] T003 Run `cd app/frontend && npx tsc --noEmit` to verify no type errors
- [ ] T004 Run `just test-frontend` to verify no test regressions

---

## Execution Order

- T001 blocks T002
- T003 and T004 can run after T002

## Acceptance

## Functional Completeness
- [ ] CHK-001 BrailleSnake component: Exists at `braille-snake.tsx` with correct frames and interval
- [ ] CHK-002 Agt line spinner: BrailleSnake renders before agent state text in status-panel.tsx

## Behavioral Correctness
- [ ] CHK-003 BrailleSnake animates: Frames cycle `⣾⣽⣻⢿⡿⣟⣯⣷` at 80ms
- [ ] CHK-004 BlockPulse unchanged: Run line still uses BlockPulse with `░▒▓█▓▒` at 150ms

## Scenario Coverage
- [ ] CHK-005 Agent state present: Agt line shows `agt ⣾ {state}` with spinner animating
- [ ] CHK-006 No agent state: No agt line rendered, no BrailleSnake mounted

## Edge Cases & Error Handling
- [ ] CHK-007 Unmount cleanup: BrailleSnake clears interval on unmount (no memory leak)

## Code Quality
- [ ] CHK-008 Pattern consistency: BrailleSnake follows same structure as BlockPulse (useState + useEffect + setInterval + span)
- [ ] CHK-009 No unnecessary duplication: Spinner components are separate files, not a shared generic with config

## Notes

- Check items as you review: `- [x]`
- All items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] CHK-008 **N/A**: {reason}`
