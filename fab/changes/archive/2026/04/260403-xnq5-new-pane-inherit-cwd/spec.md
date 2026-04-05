# Spec: New Pane Inherits Current Working Directory

**Change**: 260403-xnq5-new-pane-inherit-cwd
**Created**: 2026-04-03
**Affected memory**: `docs/memory/run-kit/ui-patterns.md`

## Frontend: Window Creation CWD

### Requirement: New windows SHALL inherit the active pane's working directory

The `handleCreateWindow` callback in `app/frontend/src/app.tsx` SHALL pass `currentWindow?.worktreePath` as the `cwd` argument to `createWindow()`. This ensures new windows start in the same directory as the currently active pane.

The `useCallback` dependency array SHALL include `currentWindow` to prevent stale closures when the active pane's directory changes.

When `currentWindow` is `null` (no active window), the `cwd` parameter SHALL be `undefined`, causing `createWindow()` to omit it from the request body. The backend's existing fallback behavior (using `windows[0].WorktreePath`) is preserved.

No changes are required to the API client (`client.ts`) or backend (`windows.go`) — both already support the `cwd` parameter end-to-end.

#### Scenario: New window inherits active pane directory
- **GIVEN** the user is viewing a window whose pane has `cd`'d to `/home/user/code/my-project/src`
- **WHEN** the user creates a new window (via sidebar "+", top bar button, or Cmd+K palette)
- **THEN** the new window starts in `/home/user/code/my-project/src`

#### Scenario: Fallback when no active window
- **GIVEN** `currentWindow` is `null` (e.g., navigating to a session with no windows)
- **WHEN** the user creates a new window
- **THEN** the backend falls back to `windows[0].WorktreePath` (existing behavior)

#### Scenario: All three UI entry points use the same handler
- **GIVEN** the sidebar "+" button, top bar "Create window" button, and Cmd+K "Window: Create" action
- **WHEN** any of them is triggered
- **THEN** all three route through `handleCreateWindow`, which passes `currentWindow?.worktreePath`

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Use `currentWindow?.worktreePath` as the cwd source | Maps to tmux `#{pane_current_path}` — live cwd updated via SSE. Confirmed from intake #1 | S:95 R:90 A:95 D:95 |
| 2 | Certain | No backend or API client changes needed | Both already support `cwd` end-to-end — verified by reading source. Confirmed from intake #2 | S:95 R:95 A:95 D:95 |
| 3 | Certain | All three UI entry points covered by single handler | Sidebar "+", top bar button, Cmd+K palette all call `handleCreateWindow`. Confirmed from intake #3 | S:90 R:90 A:95 D:95 |
| 4 | Certain | Graceful fallback when `currentWindow` is null | Optional chaining produces `undefined`, `createWindow` omits `cwd`, backend uses existing default. Upgraded from intake #4 (Confident→Certain after spec analysis) | S:90 R:90 A:90 D:90 |
| 5 | Certain | `useCallback` dependency array needs `currentWindow` | Closing over `currentWindow?.worktreePath` requires `currentWindow` in deps to avoid stale closure. Confirmed from intake #5 | S:85 R:85 A:90 D:90 |

5 assumptions (5 certain, 0 confident, 0 tentative, 0 unresolved).
