# Intake: Tmux Commands Dialog

**Change**: 260328-6xey-tmux-commands-dialog
**Created**: 2026-03-28
**Status**: Draft

## Origin

> Fix copy tmux attach command to include -L server-name flag, and replace direct copy with a Copy tmux commands dialog showing multiple command variants (attach, spawn, detach) with copy icons next to each

One-shot request. No prior discussion.

## Why

The current "Copy: tmux Attach Command" action in the command palette (`app.tsx:426-433`) has two problems:

1. **Missing `-L server-name` flag** — The copied command is `tmux attach-session -t session:window`, which only works for the default tmux server. In run-kit's multi-server architecture, named servers require `-L server-name` to route to the correct socket. Pasting the current command when on a named server silently attaches to the wrong server (or fails if the session name doesn't exist on the default server).

2. **Single command, no discovery** — Users need more than just `attach`. Common operations include spawning a new window in the session (`send-keys`) and detaching (`detach-client`). Currently the user must manually construct these commands. Replacing the single direct-to-clipboard action with a dialog showing all relevant commands makes the full command set discoverable.

## What Changes

### 1. New "Copy tmux commands" Dialog

Replace the direct clipboard write with a dialog that opens when the user selects the command palette action. The dialog shows multiple tmux command variants, each with a copy icon button.

**Commands to show** (when `server` is a named server, not `"default"`):

```
tmux -L {server} attach-session -t {session}:{window}
tmux -L {server} new-window -t {session}
tmux -L {server} detach-client -t {session}
```

**Commands to show** (when server is `"default"`):

```
tmux attach-session -t {session}:{window}
tmux new-window -t {session}
tmux detach-client -t {session}
```

This matches the existing convention where the `"default"` server uses no `-L` flag (per `tmuxExecServer` in the backend — memory: `tmux-sessions.md`).

### 2. Dialog Layout

Use the existing `Dialog` component (`components/dialog.tsx`). Each command variant is a row showing:
- A label describing what the command does (e.g., "Attach", "New window", "Detach")
- The full command in a monospace code block
- A copy icon button that copies just that command to clipboard

The dialog title is "tmux commands" (or similar). Close on Escape, backdrop click (already handled by `Dialog`).

### 3. Command Palette Integration

The existing command palette action `copy-tmux-attach` (id and label) changes:
- **New label**: "Copy: tmux Commands" (plural, reflects dialog with multiple commands)
- **New behavior**: Opens the tmux commands dialog instead of writing directly to clipboard

### 4. Copy Feedback

When a copy icon is clicked, provide brief visual feedback (e.g., icon changes to a checkmark momentarily) so the user knows the copy succeeded.

## Affected Memory

- `run-kit/ui-patterns`: (modify) Document the tmux commands dialog pattern and updated command palette action

## Impact

- **Frontend only** — `app/frontend/src/app.tsx` (command palette action), new dialog component or inline dialog
- **No backend changes** — server name is already available via `useSessionContext()`
- **No new API calls** — all data (server, session, window) already present in frontend state
- **Keyboard-first** — dialog inherits Dialog's Escape-to-close and focus trapping

## Open Questions

None — the scope is clear from the description and existing patterns.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Use existing `Dialog` component for the modal | Reusable component already used throughout `app.tsx` for similar dialogs | S:85 R:90 A:95 D:95 |
| 2 | Certain | Omit `-L` flag when server is `"default"` | Matches `tmuxExecServer` convention documented in tmux-sessions memory | S:90 R:85 A:95 D:95 |
| 3 | Certain | Three command variants: attach, new-window, detach | User explicitly specified "attach, spawn, detach" in the request | S:95 R:90 A:90 D:95 |
| 4 | Confident | Implement as a new component file (`tmux-commands-dialog.tsx`) rather than inline in `app.tsx` | Pattern consistent with other dialogs, keeps `app.tsx` from growing; easily reversed | S:60 R:90 A:80 D:70 |
| 5 | Confident | Copy feedback via temporary checkmark icon swap (1.5-2s timeout) | Standard clipboard feedback pattern; specific duration is a UI polish detail easily adjusted | S:55 R:95 A:75 D:70 |
| 6 | Confident | Attach command includes `:{window}` target, new-window and detach target session only | Attach targets a specific window (the one the user is viewing); new-window and detach operate at session level | S:70 R:90 A:80 D:65 |

6 assumptions (2 certain, 4 confident, 0 tentative, 0 unresolved).
