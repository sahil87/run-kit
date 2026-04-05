# Tasks: Fix Dashboard and Dropdown Scrollability

**Change**: 260404-xmrw-fix-dashboard-dropdown-scroll
**Spec**: `spec.md`
**Intake**: `intake.md`

## Phase 1: Core Implementation

- [ ] T001 [P] Add `min-h-0` to Dashboard root div in `app/frontend/src/components/dashboard.tsx` (line 34: `flex-1 flex flex-col` → `flex-1 min-h-0 flex flex-col`)
- [ ] T002 [P] Add `max-h-60 overflow-y-auto` to BreadcrumbDropdown menu container in `app/frontend/src/components/breadcrumb-dropdown.tsx` (line 104)

## Phase 2: Tests

- [ ] T003 [P] Add test to `app/frontend/src/components/dashboard.test.tsx` asserting the root element className contains `min-h-0`
- [ ] T004 [P] Add test to `app/frontend/src/components/breadcrumb-dropdown.test.tsx` asserting the open menu container className contains `overflow-y-auto` and `max-h-60`

## Phase 3: Verification

- [ ] T005 Run `cd app/frontend && npx tsc --noEmit` to verify no type errors
- [ ] T006 Run `just test-frontend` to verify all frontend tests pass

---

## Execution Order

- T001 and T002 are independent — run in parallel
- T003 depends on T001 (tests the changed element); T004 depends on T002
- T003 and T004 can run in parallel after their respective source fixes
- T005 and T006 run last after all code and tests are written
