# Tasks: Fix tmux scrolling on mobile

**Change**: 260325-8kuf-tmux-mobile-scroll
**Spec**: `spec.md`
**Intake**: `intake.md`

## Phase 1: Core Implementation

- [x] T001 Replace `touch-none` with `touch-pan-y` in `app/frontend/src/components/terminal-client.tsx` className on the terminal container div (line ~350)

## Phase 2: Verification

- [x] T002 Run `cd app/frontend && pnpm build` to confirm no type errors — passed (tsc + vite build clean)
- [x] T003 Run `cd app/frontend && pnpm test` to confirm existing tests pass — 5 pre-existing failures (missing @configs/themes.json import), 84/84 actual tests pass, no regressions from this change

---

## Execution Order

- T001 blocks T002 and T003
- T002 and T003 are independent
