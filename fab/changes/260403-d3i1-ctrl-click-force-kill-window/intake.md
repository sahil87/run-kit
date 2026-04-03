# Intake: Ctrl+Click Force Kill Window

**Change**: 260403-d3i1-ctrl-click-force-kill-window
**Created**: 2026-04-03
**Status**: Draft

## Origin

> Right now when you close a window by clicking on the x mark next to it, there is a pop-up which says "Are you sure you want to close" or "Are you sure you want to kill this window? Kill/Cancel". Now if the user is pressing control while clicking on the x mark, we should not have a pop-up like this. We should force kill the window or the session.

One-shot request. No prior conversation or design discussion.

## Why

The sidebar kill buttons (× next to sessions and windows) always show a confirmation dialog before killing. This is a safety feature that prevents accidental destruction, but it adds friction for users who are confident about what they want to kill. Power users who hold Ctrl while clicking are signaling explicit intent — they want the action to happen immediately without interruption.

This follows the same modifier-key pattern already established in the codebase: the ThemeToggle uses Ctrl+Click/Cmd+Click to open the theme selector instead of cycling themes. Extending this convention to kill buttons creates a consistent "Ctrl+Click = power action" mental model.

Without this change, users must always click twice (× then "Kill") to destroy a session or window from the sidebar, even when they're certain about the action.

## What Changes

### Sidebar × Buttons — Bypass Confirmation on Ctrl+Click

The two × buttons in the sidebar (`sidebar.tsx`) currently set a `killTarget` state that triggers a confirmation dialog. When the user holds Ctrl (or Cmd on macOS) while clicking:

1. **Window × button** (line ~260-275 in `sidebar.tsx`): Instead of setting `killTarget`, directly call `killWindowApi(sessionName, windowIndex)` and return. No dialog shown.

2. **Session × button** (line ~177-189 in `sidebar.tsx`): Instead of setting `killTarget`, directly call `killSessionApi(sessionName)` and return. No dialog shown.

The detection is straightforward — check `event.ctrlKey || event.metaKey` in the click handler before setting `killTarget`. If the modifier is held, execute the kill immediately; otherwise, fall through to the existing confirmation flow.

### Implementation Pattern

```tsx
// Window kill button click handler
onClick={(e) => {
  if (e.ctrlKey || e.metaKey) {
    // Force kill — no confirmation
    killWindowApi(session.name, window.index)
    return
  }
  // Existing behavior — show confirmation dialog
  setKillTarget({ type: 'window', session: session.name, index: window.index, windowCount: session.windows.length })
}}
```

Same pattern for the session × button, calling `killSessionApi(session.name)` instead.

### No Backend Changes

The backend `handleWindowKill()` and `handleClosePaneKill()` endpoints already perform the kill unconditionally — the confirmation is purely a frontend concern. No API changes needed.

### No Top Bar Changes

The `ClosePaneButton` in the top bar already kills without confirmation (best-effort, `.catch(() => {})`). This change only affects the sidebar × buttons that currently show the confirmation dialog.

## Affected Memory

- `run-kit/ui-patterns`: (modify) Document the Ctrl+Click force-kill behavior on sidebar × buttons and the broader "Ctrl+Click = power action" convention.

## Impact

- **Frontend only**: `app/frontend/src/components/sidebar.tsx` — modify click handlers for session and window × buttons
- **No backend changes**: existing kill APIs are unchanged
- **No new dependencies**: uses native `MouseEvent.ctrlKey` / `MouseEvent.metaKey`
- **Risk**: Low — additive behavior; default (non-modifier) click flow is unchanged

## Open Questions

None — the scope is clear and the implementation pattern is established.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Use `ctrlKey \|\| metaKey` for modifier detection | Matches existing ThemeToggle pattern in the codebase (top-bar.tsx line ~258-273) | S:90 R:95 A:95 D:95 |
| 2 | Certain | No backend changes needed | Kill endpoints already execute unconditionally; confirmation is frontend-only | S:85 R:95 A:95 D:95 |
| 3 | Certain | No top bar ClosePaneButton changes | It already kills without confirmation — out of scope | S:90 R:95 A:95 D:95 |
| 4 | Confident | Best-effort error handling on force kill (`.catch(() => {})`) | Matches existing patterns (ClosePaneButton, split buttons) — SSE reflects actual state | S:70 R:90 A:85 D:80 |
| 5 | Confident | Apply to both session × and window × buttons | User said "window or session" — both sidebar × buttons get the same treatment | S:80 R:85 A:80 D:85 |

5 assumptions (3 certain, 2 confident, 0 tentative, 0 unresolved).
