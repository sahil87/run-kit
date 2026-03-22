# Tasks: Back Chevron Menu Toggle

**Change**: 260322-uac4-back-chevron-menu-toggle
**Spec**: `spec.md`
**Intake**: `intake.md`

## Phase 1: Core Implementation

- [x] T001 Update `HamburgerIcon` open-state transforms in `app/frontend/src/components/top-bar.tsx` — change top line from `rotate(45deg) translateY(4.5px)` to chevron-forming rotation (~30deg, translate left), change bottom line from `rotate(-45deg) translateY(-4.5px)` to matching upward chevron stroke. Middle line fade behavior unchanged.

## Phase 2: Tests

- [x] T002 Update `app/frontend/src/components/top-bar.test.tsx` — verify test at line 137 still passes (it checks for SVG navigation toggle, not specific transforms). Add a test that the hamburger button renders with `isOpen` state and the SVG element is present.

## Phase 3: Verification

- [x] T003 Run `cd app/frontend && npx tsc --noEmit` to verify no type errors, then run `cd app/frontend && npx vitest run` to verify all tests pass.

---

## Execution Order

- T001 blocks T002 (tests verify the new transforms)
- T002 blocks T003 (verification runs after implementation + tests)
