# Tasks: Close Pane Button

**Change**: 260326-tbmj-close-pane-button
**Spec**: `spec.md`
**Intake**: `intake.md`

## Phase 1: Backend

- [x] T001 [P] Add `KillActivePane` function to `app/backend/internal/tmux/tmux.go` — `KillActivePane(session string, window int, server string) error` using `kill-pane -t session:window`. Silently ignore errors (matching `KillPane` pattern).
- [x] T002 [P] Add `KillActivePane(session string, window int, server string) error` to `TmuxOps` interface in `app/backend/api/router.go`. Add `prodTmuxOps` delegation to `tmux.KillActivePane`.
- [x] T003 Add `handleClosePaneKill` handler in `app/backend/api/windows.go` — validate session name and window index (reuse `parseWindowIndex`), call `s.tmux.KillActivePane`, return `{"ok": true}`. Register route `POST /api/sessions/{session}/windows/{index}/close-pane` in `buildRouter()` in `app/backend/api/router.go`.

## Phase 2: Frontend

- [x] T004 [P] Add `closePane(session: string, index: number)` function to `app/frontend/src/api/client.ts` — POST to `/api/sessions/{session}/windows/{index}/close-pane`, return `Promise<{ ok: boolean }>`.
- [x] T005 [P] Add `ClosePaneButton` component in `app/frontend/src/components/top-bar.tsx` — X icon SVG (14x14, viewBox 0 0 24 24), same button styling as `SplitButton`, calls `closePane(session, windowIndex).catch(() => {})`. Render after the two `SplitButton` instances and before `FixedWidthToggle`, wrapped in `<span className="hidden sm:flex">`.
- [x] T006 Add "Pane: Close" command palette action in `app/frontend/src/app.tsx` — inside the `currentWindow` conditional block, after "Window: Split Horizontal". Calls `closePane(sessionName, currentWindow.index).catch(() => {})`.

## Phase 3: Tests

- [x] T007 [P] Add `mockTmuxOps.KillActivePane` in `app/backend/api/sessions_test.go`. Add test for `handleClosePaneKill` — success case (200 OK) and validation error cases (bad session, bad index).
- [x] T008 [P] Add unit test for `ClosePaneButton` in `app/frontend/src/components/top-bar.test.tsx` (if test file exists) or colocated test — verify render, click calls API, hidden on dashboard.

---

## Execution Order

- T001 and T002 are parallel (different files)
- T003 depends on T001 + T002 (handler uses interface and function)
- T004 and T005 are parallel (different files), both depend on T003 (need API endpoint)
- T006 depends on T004 (imports `closePane`)
- T007 and T008 are parallel, both depend on T003-T006
