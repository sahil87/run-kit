# Tasks: Move Window Between Sessions

**Change**: 260404-dq70-move-window-between-sessions
**Spec**: `spec.md`
**Intake**: `intake.md`

## Phase 1: Setup

- [x] T001 [P] Add `MoveWindowToSession` function in `app/backend/internal/tmux/tmux.go` — wraps `tmux move-window -s {srcSession}:{srcIndex} -t {dstSession}:` using `tmuxExecServer` with `withTimeout()` context
- [x] T002 [P] Add `MoveWindowToSession` to `TmuxOps` interface in `app/backend/api/router.go` and implement on `prodTmuxOps`

## Phase 2: Core Implementation

- [x] T003 Add `handleWindowMoveToSession` handler in `app/backend/api/windows.go` — validates session names, window index, missing `targetSession` field (400 `"targetSession is required"`), same-session rejection (400 `"targetSession must differ from source session"`), JSON decode errors; calls `tmux.MoveWindowToSession`. Register route `POST /api/sessions/{session}/windows/{index}/move-to-session` in `app/backend/api/router.go`
<!-- clarified: added explicit mention of missing-targetSession and JSON-decode validation per spec scenarios and codebase pattern (handleWindowMove) -->
- [x] T004 [P] Add `moveWindowToSession` function in `app/frontend/src/api/client.ts` — POST to `/api/sessions/{session}/windows/{index}/move-to-session` with `{ targetSession }` body via `withServer()`
- [x] T005 [P] Add "Window: Move to {sessionName}" CmdK actions in `app/frontend/src/app.tsx` — dynamically generate one action per other session, gated on `currentWindow` exists and `sessions.length >= 2`. On select: call `moveWindowToSession()` then navigate to `/$server`
- [x] T006 Add cross-session drag-and-drop in `app/frontend/src/components/sidebar.tsx` — session header drop targets with `onDragOver`/`onDrop` handlers for windows from different sessions, accent border visual feedback, calls `moveWindowToSession()` then navigates to `/$server`

## Phase 3: Integration & Edge Cases

- [x] T007 [P] Add backend tests — mock `MoveWindowToSession` in `app/backend/api/sessions_test.go`, test handler in `app/backend/api/windows_test.go` (valid move, same-session rejection, missing targetSession, invalid names). Add tmux arg construction test in `app/backend/internal/tmux/tmux_test.go`
- [x] T008 [P] Add frontend tests — CmdK action visibility tests in `app/frontend/src/app.test.tsx` (2 sessions, single session, no window). Drag-and-drop cross-session tests in `app/frontend/src/components/sidebar.test.tsx`
<!-- clarified: sidebar.test.tsx confirmed to exist — removed conditional phrasing -->

---

## Execution Order

- T001 and T002 are parallel (both setup, no dependency)
- T003 depends on T001 + T002 (handler needs interface method and tmux function)
- T004, T005 are parallel with T003 (frontend, no backend dependency at dev time)
- T006 depends on T004 (uses `moveWindowToSession` client function)
- T007 and T008 are parallel (backend/frontend tests independent)
