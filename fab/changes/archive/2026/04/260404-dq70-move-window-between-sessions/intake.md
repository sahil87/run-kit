# Intake: Move Window Between Sessions

**Change**: 260404-dq70-move-window-between-sessions
**Created**: 2026-04-04
**Status**: Draft

## Origin

> Backlog item [dq70]: "Add CmdK options to move a window to another session. Also allow this by dragging the window out of the current session into another session."

This was explicitly deferred as a non-goal in the earlier within-session move work (backlog [29qz]). The existing codebase has complete within-session window moves (swap-window left/right via CmdK, drag-and-drop within same session in sidebar). This change extends that to cross-session moves.

## Why

Currently a user who wants to reorganize windows across sessions must use raw tmux commands (`tmux move-window -s src:idx -t dst:`). This is invisible to the run-kit UI — the user must know tmux internals. Since run-kit's core value is making tmux accessible via a web UI, cross-session window moves should be a first-class operation reachable via the command palette and drag-and-drop.

Without this, users accumulate windows in the wrong sessions and have no ergonomic way to reorganize.

## What Changes

### 1. Backend: tmux `MoveWindowToSession` function

New function in `app/backend/internal/tmux/tmux.go`:

```go
// MoveWindowToSession moves a window from one session to another on the specified server.
// Uses tmux move-window -s {srcSession}:{srcIndex} -t {dstSession}:
func MoveWindowToSession(srcSession string, srcIndex int, dstSession string, server string) error
```

This wraps `tmux move-window -s {srcSession}:{srcIndex} -t {dstSession}:` — tmux automatically assigns the next available index in the destination session. The source window is removed from the source session.

### 2. Backend: New API endpoint

`POST /api/sessions/{session}/windows/{index}/move-to-session`

Request body:
```json
{ "targetSession": "other-session" }
```

Response: `{ "ok": true }` on success.

Validates both session names and window index. Returns 400 if source and target session are the same (use existing within-session move instead). Handler in `app/backend/api/windows.go`, interface method added to `TmuxOps` in `router.go`.

### 3. Frontend: API client function

New function in `app/frontend/src/api/client.ts`:

```typescript
export async function moveWindowToSession(
  session: string,
  index: number,
  targetSession: string,
): Promise<{ ok: boolean }>
```

### 4. Frontend: CmdK action — "Window: Move to Session..."

New command palette action in `app/frontend/src/app.tsx`:

- **ID**: `move-window-to-session`
- **Label**: `Window: Move to Session...`
- **Condition**: Only visible when a window is selected (`currentWindow` exists) AND there are at least 2 sessions
- **Behavior**: Opens a sub-picker listing all sessions except the current one. Selecting a session calls `moveWindowToSession()`, then navigates to the destination session's dashboard (`/$server/$targetSession`) since the window's new index in the target session isn't known until after the move completes (tmux auto-assigns). The SSE update will reflect the new state.

### 5. Frontend: Cross-session drag-and-drop in sidebar

Extend the existing drag-and-drop in `app/frontend/src/components/sidebar.tsx`:

- **Remove same-session guard**: Currently `handleDragOver` early-returns if `dragSource.session !== sessionName`. This guard should be relaxed to allow cross-session drops.
- **Session-level drop target**: Allow dropping a window on a session header (not just on other windows). When dropped on a session header, call `moveWindowToSession()` to move the window to that session.
- **Window-level cross-session drop**: When a window is dropped on a window in a different session, call `moveWindowToSession()` (the window goes to the target session, tmux assigns the index).
- **Visual feedback**: Use a distinct drop indicator for cross-session drops (e.g., accent border on the session header or a different highlight color) to differentiate from within-session reorder.
- **Navigation after drop**: Navigate to `/$server/$targetSession` (session dashboard) after a cross-session move, since the exact window index is not predetermined.

## Affected Memory

- `run-kit/ui-patterns`: (modify) Document the new CmdK action and cross-session drag-and-drop behavior
- `run-kit/tmux-sessions`: (modify) Document the new `MoveWindowToSession` function and API endpoint

## Impact

- **Backend**: `internal/tmux/tmux.go` (new function), `api/windows.go` (new handler), `api/router.go` (TmuxOps interface extension)
- **Frontend**: `api/client.ts` (new function), `app.tsx` (CmdK action), `components/sidebar.tsx` (drag-and-drop extension)
- **Tests**: Backend unit tests for the new handler and tmux function args, frontend tests for CmdK action visibility and drag-and-drop behavior
- **SSE**: No changes needed — existing SSE polling will pick up session/window state changes after the tmux move-window command executes

## Open Questions

- None — the tmux `move-window` command is well-established and the UI patterns follow existing conventions.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Use `tmux move-window` for cross-session moves | This is the canonical tmux command for this operation. No alternative exists. | S:90 R:95 A:95 D:95 |
| 2 | Certain | Navigate to target session dashboard after cross-session move | tmux auto-assigns window index in destination; we don't know it until SSE updates. Dashboard is the safe landing. | S:80 R:90 A:85 D:90 |
| 3 | Certain | Separate endpoint from existing `/move` | Existing `/move` does within-session swap (different tmux command, different semantics). Mixing would break the existing API contract. | S:85 R:85 A:90 D:90 |
| 4 | Confident | Allow drop on session header for cross-session moves | Natural UX — drag a window to a session name to move it there. Follows common drag-and-drop conventions. | S:70 R:85 A:75 D:70 |
| 5 | Confident | Sub-picker in CmdK for session selection | Existing CmdK actions are direct-execute. A two-step flow (action → session picker) is new but necessary when the target is dynamic. | S:65 R:80 A:70 D:65 |
| 6 | Certain | Return 400 when source and target session are the same | Prevents misuse — within-session moves should use the existing `/move` endpoint | S:85 R:90 A:90 D:95 |

6 assumptions (4 certain, 2 confident, 0 tentative, 0 unresolved).
