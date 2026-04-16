# Tasks: Pane Panel Spinner Animations

**Change**: 260416-a5ug-pane-panel-spinner-animations
**Spec**: `spec.md`
**Intake**: `intake.md`

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
