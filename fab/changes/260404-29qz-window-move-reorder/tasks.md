# Tasks: Window Move & Reorder

**Change**: 260404-29qz-window-move-reorder
**Spec**: `spec.md`
**Intake**: `intake.md`

## Phase 1: Backend

- [x] T001 Add `SwapWindow(session string, srcIndex int, dstIndex int, server string) error` function to `app/backend/internal/tmux/tmux.go` — calls `tmuxExecServer(ctx, server, "swap-window", "-s", "{session}:{srcIndex}", "-t", "{session}:{dstIndex}")` with `withTimeout()`, following the existing `KillWindow`/`RenameWindow` pattern
<!-- clarified: serverArgs is called internally by tmuxExecServer — SwapWindow should not call it separately; follows KillWindow/RenameWindow pattern exactly -->
- [x] T002 Add `SwapWindow` to the `TmuxOps` interface in `app/backend/api/router.go` and implement on `prodTmuxOps` delegating to `tmux.SwapWindow`
- [x] T003 Add `handleWindowMove` handler in `app/backend/api/windows.go` — validates session name, parses window index, decodes `{"targetIndex": N}` body (non-negative integer), calls `s.tmux.SwapWindow`, returns `200 {"ok": true}`
- [x] T004 Register `POST /api/sessions/{session}/windows/{index}/move` route in `app/backend/api/router.go` (`s.handleWindowMove`)

## Phase 2: Frontend API + CmdK

- [x] T005 Add `moveWindow(session, index, targetIndex)` to `app/frontend/src/api/client.ts` — POSTs to `/api/sessions/{session}/windows/{index}/move` with `{ targetIndex }` body using `withServer()`, following `renameWindow` pattern
- [x] T006 Add "Window: Move Left" (id: `move-window-left`) and "Window: Move Right" (id: `move-window-right`) actions to `windowActions` in `app/frontend/src/app.tsx` — conditional on `currentWindow` existing and not at boundary. Boundary check: compute min/max from `currentSession.windows.map(w => w.index)`, exclude Move Left when `currentWindow.index === minIndex`, exclude Move Right when `currentWindow.index === maxIndex`. On select: call `moveWindow(sessionName, currentWindow.index, currentWindow.index ± 1)`, then `navigate({ to: "/$server/$session/$window", params: { server, session: sessionName, window: String(targetIndex) } })`
<!-- clarified: boundary detection uses currentSession.windows indices; navigation uses TanStack Router navigate() with params object per existing codebase pattern -->

## Phase 3: Sidebar Drag-and-Drop

- [x] T007 Add drag-and-drop state and handlers to window items in `app/frontend/src/components/sidebar.tsx` — `draggable={true}`, `onDragStart` sets JSON data `{session, index}`, `onDragOver` shows 2px accent drop indicator for same-session targets only, `onDrop` calls `moveWindow` and navigates, `onDragEnd` cleans up all visual state. No-op on same-position drop

## Phase 4: Tests

- [x] T008 [P] Add Go test for `SwapWindow` in `app/backend/internal/tmux/tmux_test.go` — verify correct tmux args
- [x] T009 [P] Add handler test for `handleWindowMove` in `app/backend/api/windows_test.go` — success, invalid body, invalid index, tmux error cases
- [x] T010 [P] Add frontend tests for move window CmdK actions in `app/frontend/src/app.test.tsx` (new file) — move left/right actions present/absent based on boundary, navigation after move
<!-- clarified: app.test.tsx does not exist yet — must be created; follows colocated test pattern per code-quality.md -->
- [x] T011 [P] Add frontend test for sidebar drag-and-drop in `app/frontend/src/components/sidebar.test.tsx` — drag start data, same-session constraint, drop calls moveWindow

---

## Execution Order

- T001 → T002 → T003 → T004 (backend chain, each depends on previous)
- T005 depends on T004 (needs endpoint to exist for integration)
- T006 depends on T005 (needs `moveWindow` client function)
- T007 depends on T005 (needs `moveWindow` client function)
- T006 and T007 are independent of each other
- T008-T011 are all parallelizable, depend on their respective implementation tasks
