# Tasks: Hostname in Browser Title

**Change**: 260320-uq0k-hostname-browser-title
**Spec**: `spec.md`
**Intake**: `intake.md`

## Phase 1: Setup

- [x] T001 Add `hostname` field to `Server` struct in `app/backend/api/router.go` and wire `os.Hostname()` in `app/backend/cmd/run-kit/main.go`

## Phase 2: Core Implementation

- [x] T002 [P] Update `handleHealth` in `app/backend/api/health.go` to include `hostname` from `Server.hostname` in the JSON response
- [x] T003 [P] Add `getHealth()` function to `app/frontend/src/api/client.ts` returning `{ status: string; hostname: string }`
- [x] T004 Add `useEffect` in `app/frontend/src/app.tsx` to fetch hostname on mount and set `document.title` based on route params and hostname

## Phase 3: Integration & Edge Cases

- [x] T005 [P] Update `app/backend/api/health_test.go` — verify `hostname` field present in response, test with injected hostname value
- [x] T006 [P] Add frontend test for title behavior — hostname in title on dashboard and terminal routes, empty hostname fallback

---

## Execution Order

- T001 blocks T002 (hostname field must exist before handler can read it)
- T002 and T003 are parallel (backend handler and frontend client are independent)
- T003 blocks T004 (client function must exist before app.tsx can call it)
- T005 and T006 are parallel (backend and frontend tests are independent)
