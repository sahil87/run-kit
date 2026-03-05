# Tasks: Feature Tests for tmux, Keyboard Nav, and Sessions API

**Change**: 260305-vq7h-feature-tests-tmux-keyboard-api
**Spec**: `spec.md`
**Intake**: `intake.md`

## Phase 1: Core Test Files

- [x] T001 [P] Create `src/lib/__tests__/tmux.test.ts` — mock `child_process.execFile` via `vi.mock`, test `listSessions()` (standard parse, session-group filtering, group-named keep, tmux-not-running) and `listWindows()` (active/idle activity, field parsing, session-not-found)
- [x] T002 [P] Create `src/hooks/__tests__/use-keyboard-nav.test.ts` — use `renderHook` + `fireEvent` from `@testing-library/react`, test j/k navigation with clamping, Enter triggers onSelect, input element skip, itemCount clamp on decrease, custom shortcuts map
- [x] T003 [P] Create `src/app/api/sessions/__tests__/route.test.ts` — mock `@/lib/tmux` via `vi.mock`, test POST handler for all 5 actions (createSession, createWindow, killSession, killWindow, sendKeys) with valid/invalid inputs, unknown action, missing action, tmux error 500

## Phase 2: Verification

- [x] T004 Run `pnpm test` to verify all tests pass
- [x] T005 Run `npx tsc --noEmit` to verify type safety

---

## Execution Order

- T001, T002, T003 are independent — can run in parallel
- T004 depends on T001 + T002 + T003
- T005 depends on T001 + T002 + T003
