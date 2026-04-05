# Tasks: Bottom Bar Focus Steal Fix

**Change**: 260323-bd6n-bottom-bar-focus-steal
**Spec**: `spec.md`
**Intake**: `intake.md`

## Phase 1: Core Implementation

- [x] T001 Add `onMouseDown={(e) => e.preventDefault()}` to all focus-preserving buttons in `app/frontend/src/components/bottom-bar.tsx` — Escape, Tab, Ctrl toggle, Alt toggle, Fn trigger, Compose, and all Fn menu items (F1–F12, PgUp–Del). Exclude the CmdK button.

## Phase 2: Verification

- [x] T002 Run `cd app/frontend && npx tsc --noEmit` to verify no type errors introduced
- [x] T003 Run existing frontend tests `cd app/frontend && npx vitest run` to verify no regressions (2 pre-existing failures in top-bar.test.tsx, unrelated)

---

## Execution Order

- T001 blocks T002 and T003
- T002 and T003 can run in parallel
