# Intake: New Pane Inherits Current Working Directory

**Change**: 260403-xnq5-new-pane-inherit-cwd
**Created**: 2026-04-03
**Status**: Draft

## Origin

> When creating a new pane (via Cmd+K command palette, sidebar "+" button, or top bar "Create window" button), the new pane should start in the current working directory of the previously active pane, not the run-kit project root.
>
> Root cause: `handleCreateWindow()` in `app/frontend/src/app.tsx:275-283` calls `createWindow(session, "zsh")` without passing the `cwd` parameter. The API client (`client.ts:96-110`) already supports an optional `cwd` parameter. The backend (`windows.go:16-70`) accepts `cwd` in the request body. Without it, the backend defaults to `windows[0].WorktreePath` (first window's directory, typically the project root).

One-shot request with detailed root cause analysis provided by the user. The fix path is fully specified.

## Why

When a user navigates to a subdirectory inside a tmux pane (e.g., `cd app/frontend/src`) and then creates a new window, they expect the new window to open in the same directory — not jump back to the project root. This is standard terminal behavior (e.g., iTerm2 "new tab in current directory", tmux `split-window` with `-c '#{pane_current_path}'`).

Currently, when no `cwd` is passed in the create-window API call, the backend falls back to `windows[0].WorktreePath` — the first window's worktree path, which is typically the project root. This means every new pane starts at the root regardless of where the user was working, forcing them to `cd` back to their working location every time.

This is a minor but high-frequency friction point — users create panes often, and the mental overhead of re-navigating adds up.

## What Changes

### Frontend: Pass `currentWindow.worktreePath` to `createWindow()`

In `app/frontend/src/app.tsx`, the `handleCreateWindow` callback currently calls:

```typescript
await createWindow(session, "zsh");
```

This must be updated to pass the current window's live working directory:

```typescript
await createWindow(session, "zsh", currentWindow?.worktreePath);
```

The `currentWindow` variable is already in scope — it is a `useMemo` computed from route params and SSE data (line ~191). Its `worktreePath` field maps to tmux's `#{pane_current_path}`, which reflects the actual current directory of the pane (updated live via SSE), not a static value.

The `createWindow` function in `app/frontend/src/api/client.ts` (lines 96-110) already accepts an optional `cwd?: string` third parameter and conditionally includes it in the request body. No changes needed to the API client.

No changes needed to the backend (`app/backend/api/windows.go`) — it already parses `cwd` from the request body, validates it, and uses it when present.

### All call sites covered

All three UI entry points (sidebar "+" button, top bar "Create window" button, Cmd+K command palette) route through the same `handleCreateWindow` callback, so a single change covers all paths.

## Affected Memory

- `run-kit/ui-patterns`: (modify) Document that new pane creation inherits the active pane's working directory

## Impact

- **`app/frontend/src/app.tsx`** — single line change in `handleCreateWindow` callback
- **No backend changes** — `cwd` parameter already supported end-to-end
- **No API client changes** — `cwd` parameter already wired
- **No new dependencies** — uses existing `currentWindow?.worktreePath` already in scope
- **Risk**: Minimal — `worktreePath` is optional (`currentWindow?.worktreePath`), so if `currentWindow` is null the parameter is `undefined`, and `createWindow` omits it from the request body, falling back to the existing backend default behavior

## Open Questions

None — the fix path is fully specified and all plumbing already exists.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Use `currentWindow?.worktreePath` as the cwd source | This field maps to tmux `#{pane_current_path}` — the live current directory, updated via SSE. It is already in scope in `handleCreateWindow` | S:95 R:90 A:95 D:95 |
| 2 | Certain | No backend or API client changes needed | Both `windows.go` and `client.ts` already support the `cwd` parameter end-to-end — verified by reading source | S:95 R:95 A:95 D:95 |
| 3 | Certain | All three UI entry points are covered by the single handler | Sidebar "+", top bar button, and Cmd+K palette all call `handleCreateWindow` — verified by code inspection | S:90 R:90 A:95 D:95 |
| 4 | Confident | Graceful fallback when `currentWindow` is null | When `currentWindow` is null, `currentWindow?.worktreePath` evaluates to `undefined`, `createWindow` omits `cwd` from the body, and the backend falls back to `windows[0].WorktreePath` — existing behavior preserved | S:85 R:90 A:80 D:85 |
| 5 | Certain | The `handleCreateWindow` dependency array needs updating | Adding `currentWindow?.worktreePath` as a closure dependency means the `useCallback` deps array (currently `[]`) must include `currentWindow` to avoid stale closure | S:80 R:85 A:90 D:90 |

5 assumptions (4 certain, 1 confident, 0 tentative, 0 unresolved).
