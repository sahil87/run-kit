# Intake: Copy tmux Attach Command

**Change**: 260327-k4l2-copy-tmux-attach-command
**Created**: 2026-03-27
**Status**: Draft

## Origin

> Add a "Copy: tmux Attach Command" option to the command palette. When selected, it copies `tmux attach-session -t <session>:<window>` to the clipboard using the session name and window name from the currently viewed route. This is a frontend-only change.

One-shot request with key decisions pre-resolved in conversation: command format is `tmux attach-session -t <session>:<window>` (single format, not context-dependent), palette label is "Copy: tmux Attach Command" (follows existing "Category: Action" convention), location is command palette only (not breadcrumb, not keyboard shortcut), and session/window names come from current route params.

## Why

When working with run-kit's web UI, users often need to attach to the same tmux session from a terminal outside the browser -- for example, from a local terminal emulator or an SSH session. Currently, the user must manually construct the `tmux attach-session -t session:window` command by remembering (or looking up) the session and window names. This is friction for a common workflow.

If not addressed, users continue to context-switch between the run-kit UI and their terminal, manually typing session and window identifiers that are already visible in the URL. This is error-prone (typos in session names) and slow.

A one-click "copy attach command" action in the command palette removes this friction entirely. It follows the established pattern of utility actions in the palette (e.g., "Config: Reload tmux") and leverages data already available from the route params.

## What Changes

### New Command Palette Action

Add a new `PaletteAction` entry to the `paletteActions` array in `app/frontend/src/app.tsx`:

- **ID**: `copy-tmux-attach`
- **Label**: `Copy: tmux Attach Command`
- **Condition**: Only shown when both `sessionName` and `currentWindow` are available (terminal route `/$server/$session/$window` is active), matching the pattern used by other window-scoped actions like "Window: Rename" and "Window: Kill"
- **`onSelect` behavior**: Constructs the string `tmux attach-session -t {sessionName}:{windowName}` using the route-derived `sessionName` and `currentWindow.name` values, then copies it to the clipboard via `navigator.clipboard.writeText()`

Example constructed command for session `main` and window `editor`:
```
tmux attach-session -t main:editor
```

### Clipboard API Usage

Use `navigator.clipboard.writeText(text)` which is the standard async Clipboard API. This is a fire-and-forget operation (`.catch(() => {})`) matching the existing error-handling pattern for best-effort actions in the codebase (e.g., `splitWindow(...).catch(() => {})`, `closePane(...).catch(() => {})`).

No fallback mechanism for older browsers is needed -- the Clipboard API is supported in all modern browsers and run-kit targets modern browsers only.

### Placement in Palette Actions Array

The new action should be placed in the conditional block gated on `currentWindow` (alongside "Window: Rename", "Window: Kill", split, and close-pane actions), since it requires both session and window context to construct the command.

## Affected Memory

- `run-kit/ui-patterns`: (modify) Document the new "Copy: tmux Attach Command" palette action in the command palette section

## Impact

- **Files touched**: `app/frontend/src/app.tsx` (add one `PaletteAction` entry)
- **Test file**: `app/frontend/src/components/command-palette.test.tsx` (add test for new action)
- **No backend changes**: Frontend-only, no API calls, no new routes
- **No new dependencies**: Uses built-in `navigator.clipboard.writeText()`

## Open Questions

None -- all design decisions were resolved in conversation.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Command format is `tmux attach-session -t <session>:<window>` | Discussed -- user specified single format, not context-dependent | S:95 R:90 A:90 D:95 |
| 2 | Certain | Palette label is "Copy: tmux Attach Command" | Discussed -- user chose this label following existing "Category: Action" convention | S:95 R:95 A:90 D:95 |
| 3 | Certain | Action lives in command palette only | Discussed -- user explicitly excluded breadcrumb and keyboard shortcut | S:95 R:95 A:85 D:95 |
| 4 | Certain | Session and window names come from route params | Discussed -- user specified `$session/$window` route params as the source | S:95 R:90 A:95 D:95 |
| 5 | Certain | Action is conditional on terminal route (session + window present) | Codebase pattern -- all window-scoped palette actions are gated on `currentWindow` | S:90 R:95 A:95 D:90 |
| 6 | Confident | Use `navigator.clipboard.writeText()` with fire-and-forget error handling | Strong codebase signal -- existing actions use `.catch(() => {})` pattern; Clipboard API is standard | S:75 R:90 A:85 D:80 |
| 7 | Confident | Window name (not window index) is used in the attach command | Convention -- `tmux attach-session -t session:window` uses the window name, which is the human-readable identifier; codebase already has `currentWindow.name` available | S:80 R:85 A:80 D:75 |
| 8 | Confident | No visual feedback (toast/notification) after copy | No existing toast/notification system in the codebase; adding one would expand scope beyond the request | S:70 R:85 A:80 D:70 |

8 assumptions (5 certain, 3 confident, 0 tentative, 0 unresolved).
