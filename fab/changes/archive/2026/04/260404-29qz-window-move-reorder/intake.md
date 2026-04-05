# Intake: Window Move & Reorder

**Change**: 260404-29qz-window-move-reorder
**Created**: 2026-04-04
**Status**: Draft

## Origin

> Backlog item [29qz]: "Add CmdK options to move a the current window to the next or previous window (move window left or right). Also allow doing this by dragging the window on the left pane."

Cold intake from backlog — no prior conversation.

## Why

Currently there is no way to reorder windows within a tmux session from the run-kit UI. Users must drop to a terminal and run `tmux swap-window` manually, breaking the keyboard-first workflow. This is a common operation when organizing agent sessions — windows accumulate in creation order, but users want to group related work together. The command palette (CmdK) already has window actions (create, rename, kill, split) but lacks move/reorder, making it an incomplete window management surface.

Adding both CmdK actions and sidebar drag-and-drop covers both the keyboard-first (constitution principle V) and mouse-friendly interaction paths.

## What Changes

### 1. Backend: tmux swap-window wrapper

Add a `SwapWindow` function to `app/backend/internal/tmux/tmux.go` that calls `tmux swap-window -s {session}:{srcIndex} -t {session}:{dstIndex}` via `exec.CommandContext` with a 5-second timeout. This swaps two windows within the same session.

### 2. Backend: new API endpoint

Add `POST /api/sessions/{session}/windows/{index}/move` in `app/backend/api/windows.go`:

```json
// Request body
{ "targetIndex": 3 }
```

The handler calls `SwapWindow(ctx, server, session, currentIndex, targetIndex)`. Returns `200 {"ok": true}` on success. Validates that both source and target window indices exist in the session before swapping.

Register the route in `app/backend/api/router.go` alongside existing window routes.

### 3. Frontend: API client function

Add `moveWindow(server, session, index, targetIndex)` to `app/frontend/src/api/client.ts` that POSTs to the new endpoint.

### 4. Frontend: command palette actions

Add two new actions to `windowActions` in `app/frontend/src/app.tsx`:

- **"Window: Move Left"** — swaps the current window with the window at `currentIndex - 1` (no-op if already first)
- **"Window: Move Right"** — swaps the current window with the window at `currentIndex + 1` (no-op if already last)

Both actions call `moveWindow()` then trigger SSE-driven state refresh (the existing SSE stream already pushes session/window updates when tmux state changes).

### 5. Frontend: sidebar drag-and-drop

Add drag-and-drop reordering to the window list in `app/frontend/src/components/sidebar.tsx`:

- Make window items `draggable` using native HTML5 drag-and-drop (no external library — keeps dependencies minimal per constitution IV)
- Show a visual drop indicator (a thin line between windows) during drag
- On drop, call `moveWindow()` with the source and target indices
- Constrain drag to within the same session (cross-session move is a separate backlog item [dq70])
- Navigation to the moved window after drop (the window's tmux index changes after swap)

## Affected Memory

- `run-kit/architecture`: (modify) Add the new move endpoint to the API table and client function list
- `run-kit/ui-patterns`: (modify) Document the command palette actions and sidebar drag-and-drop interaction

## Impact

- **Backend**: `internal/tmux/tmux.go` (new function), `api/windows.go` (new handler), `api/router.go` (new route)
- **Frontend**: `api/client.ts` (new function), `app.tsx` (new CmdK actions), `components/sidebar.tsx` (drag-and-drop)
- **Tests**: Go unit test for `SwapWindow`, handler test for move endpoint, frontend tests for the new command palette actions and drag behavior
- **No database impact** — state derived from tmux at request time (constitution II)
- **No new dependencies** — uses native HTML5 DnD and existing tmux commands

## Open Questions

- None identified — the scope is clear and self-contained within existing patterns.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Use `tmux swap-window` for the underlying operation | tmux natively supports swap-window; constitution III says wrap, don't reinvent | S:90 R:85 A:95 D:90 |
| 2 | Certain | Use `exec.CommandContext` with 5s timeout | Constitution I mandates this for all subprocess calls | S:95 R:90 A:95 D:95 |
| 3 | Certain | No external DnD library — use native HTML5 drag-and-drop | Constitution IV (minimal surface area) and existing pattern of zero DnD dependencies | S:80 R:85 A:90 D:85 |
| 4 | Confident | Swap semantics (not insert/renumber) for move | Swap is the simplest tmux primitive; insert-and-renumber would cascade index changes affecting open WebSocket connections | S:70 R:70 A:80 D:65 |
| 5 | Confident | POST `/api/sessions/{session}/windows/{index}/move` endpoint shape | Follows existing window endpoint pattern (kill, rename, select all use `/{index}/{verb}`) | S:75 R:80 A:85 D:70 |
| 6 | Confident | No keyboard shortcuts for move actions (CmdK only, no direct hotkey) | Existing CmdK actions don't define keyboard shortcuts; adding them is a separate concern | S:65 R:90 A:70 D:65 |
| 7 | Confident | Constrain drag to within same session | Cross-session move is explicitly a separate backlog item [dq70]; mixing scope would complicate both | S:80 R:75 A:80 D:80 |

7 assumptions (3 certain, 4 confident, 0 tentative, 0 unresolved).
